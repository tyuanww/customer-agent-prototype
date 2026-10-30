import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { parseContractSchema } from '../../packages/contracts/dist/index.js';
import { createSyntheticSopWorkbook } from '../../packages/content-intake/dist/workbook.js';
import { createIntakeSyntheticHost } from '../../apps/api/tests/support/intake-synthetic-host.ts';
import { ContentIntakeUsage } from '../../apps/desktop/src/main/content-intake-usage.ts';

// Cross-application assembly belongs here, not in API tests. The API host owns
// the disposable database and sessions; this runner only consumes HTTP and the
// real Main adapter. It proves copy/preview semantics, not native OS clipboard UI.
test('SOP upload → quality → confirmed publication → second-seat Main copy and protected preview', {
  skip: process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_TEST !== '1', timeout: 60_000,
}, async () => {
  const host = await createIntakeSyntheticHost({ prepareCandidate: false, includeSopSource: true });
  let consumer: ContentIntakeUsage | undefined;
  async function json(response: Response, status = 200) {
    const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value;
  }
  const post = (path: string, body: unknown, identity: 'enabler' | 'reviewer' = 'enabler') => host.requestAs(identity, path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const { bytes, png } = await createSyntheticSopWorkbook();
    const form = new FormData(); form.set('operationId', 'sop-consumer-upload');
    form.set('file', new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic-sop.xlsx');
    const object = parseContractSchema('IntakeObject', await json(await host.requestAs('enabler', '/v1/intake/sources/source-sop/objects', { method: 'POST', body: form }), 201));
    let job = parseContractSchema('IntakeParseJob', await json(await post('/v1/intake/sources/source-sop/candidates', {
      operationId: 'sop-consumer-receive', objectId: object.objectId, sourceVersion: 1, baseReleaseId: 'rel_native_base',
      contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null,
    }), 202));
    const deadline = Date.now() + 20_000;
    while (job.state === 'reading' || job.state === 'parsing') {
      assert.ok(Date.now() < deadline, 'parser must settle');
      await new Promise(resolve => setTimeout(resolve, 20));
      job = parseContractSchema('IntakeParseJob', await json(await host.requestAs('enabler', `/v1/intake/parse-jobs/${job.jobId}`)));
    }
    assert.equal(job.state, 'validated', JSON.stringify(job.issues));
    const url = `/v1/intake/candidates/${job.candidateId}/versions/${job.candidateVersion}`;
    const candidate = parseContractSchema('IntakeCandidate', await json(await host.requestAs('enabler', url)));
    await json(await post(`${url}/source-confirmation`, { operationId: 'sop-consumer-source', key: candidate.key, expectedEvidenceVersion: 0,
      confirmedVersionKind: 'opaque', confirmedVersionValue: 'synthetic-export-one', acquisition: 'controlled-synthetic-export',
      objectSha256: object.sha256, reason: '合成来源确认' }));
    await json(await post(`${url}/quality/freeze`, { operationId: 'sop-consumer-freeze', key: candidate.key }, 'reviewer'));
    const quality = parseContractSchema('IntakeQualityStatus', await json(await host.requestAs('reviewer', `${url}/quality?digest=${candidate.key.digest}`)));
    const samples = parseContractSchema('IntakeQualitySamplePage', await json(await host.requestAs('reviewer', `${url}/quality/samples?${new URLSearchParams({ digest: candidate.key.digest, viewHash: quality.viewHash, phase: 'initial', limit: '100' })}`)));
    assert.equal(samples.nextCursor, null); assert.equal(samples.items.length, 3);
    const checked = parseContractSchema('IntakeQualityReceipt', await json(await post(`${url}/quality/checks`, {
      operationId: 'sop-consumer-checks', key: candidate.key, phase: 'initial',
      checks: samples.items.map(row => ({ scriptId: row.scriptId, contentHash: row.contentHash, defect: false, reason: '' })),
    }, 'reviewer')));
    assert.equal(checked.state, 'passed');
    const published = parseContractSchema('IntakeReceipt', await json(await post(`${url}/publish`, {
      operationId: 'sop-consumer-publish', key: candidate.key, baseReleaseId: 'rel_native_base', sourceEvidenceVersion: 1,
      confirmed: true, title: '合成 SOP 发布', summary: '文字和辅助图片',
    }), 202));
    const clipboard: string[] = [];
    consumer = new ContentIntakeUsage({
      view: () => ({ signedIn: true, sessionEpoch: 1 }), subscribe: () => () => undefined,
      request: async (_epoch, path, options) => {
        const init: RequestInit = { signal: options.signal };
        if (options.body !== undefined) {
          init.method = 'POST'; init.headers = { 'content-type': 'application/json' }; init.body = JSON.stringify(options.body);
        }
        const response = await host.requestAs('agent', path, init);
        const value = await response.json();
        if (!response.ok) throw { code: value.error?.code, reason: value.error?.details?.reason };
        return { value };
      },
    }, text => clipboard.push(text));
    consumer.select({ shopId: 'shop-a', productIds: [], scenarioIds: [] });
    const catalog = await consumer.refresh();
    const projection = catalog.read();
    assert.equal(projection?.releaseId, published.releaseId);
    const row = projection!.faq.find(row => row.entry.answerText.includes('合成文字'));
    assert.ok(row); assert.deepEqual(await catalog.copy(row.key), { copied: true });
    assert.equal(clipboard.at(-1), row.entry.answerText); assert.ok(!clipboard.at(-1)!.includes(png.toString('base64')));
    const objectId = `med_${createHash('sha256').update('source-sop').update('\0').update(png).digest('hex')}`;
    const seen = await catalog.preview(objectId);
    assert.equal(seen.mime, 'image/png'); assert.deepEqual(seen.bytes, png);
    assert.ok(!JSON.stringify(projection).includes(png.toString('base64')));
    await assert.rejects(catalog.preview(`med_${'ab'.repeat(32)}`));
    const state = await host.status(); assert.equal(state.publications, 1); assert.equal(state.approvalFacts, 0);
    assert.ok(state.requests.some(path => path === '/v1/intake/preview'));
    console.info(JSON.stringify({ status: 'PASS', postgres: 15, http: 'actual', source: 'synthetic-six-sheet-xlsx', consumer: 'ContentIntakeUsage', copied: 'text-only', preview: 'system-bytes', nativeClipboard: 'not-tested' }));
  } finally { consumer?.dispose(); await host.close(); }
  assert.equal(existsSync(host.root), false);
  const resources = host.resources();
  assert.equal(resources.closed, true);
  assert.equal(resources.identityListening, false);
  assert.ok(resources.poolConnections.length > 0 && resources.poolConnections.every(count => count === 0));
});
