import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { parseContractSchema } from '../../packages/contracts/dist/index.js';
import { readIssueReport } from '../../packages/content-intake/tests/fixtures.ts';
import { createIntakeSyntheticHost, createIntakeSyntheticWorkbook, INTAKE_SYNTHETIC_FAQ } from '../../apps/api/tests/support/intake-synthetic-host.ts';

const cases = [{ profile: 'existing', domain: 'product' }, ...(['product', 'campaign', 'presale', 'aftersale'] as const).map(domain => ({ profile: 'purpose-runtime' as const, domain }))] as const;
for (const { profile, domain } of cases) test(`isolated ${profile}/${domain} HTTP/PG consumes parsed material, quality, confirmed direct, publication and ordinary-seat snapshot`, {
  skip: process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_TEST !== '1', timeout: 60_000,
}, async () => {
  const host = await createIntakeSyntheticHost({ profile, domain });
  const url = `/v1/intake/candidates/${host.candidate.key.candidateId}/versions/${host.candidate.key.version}`;
  const post = (suffix: string, body: unknown) => host.requestAs('enabler', `${url}/${suffix}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  async function json(response: Response, status = 200) {
    const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result;
  }
  try {
    for (const menu of ['authorization', 'sources']) await json(await host.requestAs('enabler', `/v1/intake/${menu}?limit=100`));
    assert.equal((await host.requestAs('agent', url)).status, 404);
    assert.equal(host.candidate.publicationPolicy, 'direct-v1');
    const material = parseContractSchema('IntakeCandidatePage', await json(await host.requestAs('enabler', `${url}/material?limit=100`)));
    assert.equal(material.entries.length, 3);
    const publication = { operationId: 'host-publish', key: host.candidate.key, baseReleaseId: 'rel_native_base', sourceEvidenceVersion: 1,
      confirmed: true, title: '合成宿主发布', summary: '实际 API/PG 验证' };
    assert.equal((await post('publish', publication)).status, 409);
    await json(await post('source-confirmation', { operationId: 'host-source', key: host.candidate.key, expectedEvidenceVersion: 0,
      confirmedVersionKind: 'opaque', confirmedVersionValue: 'synthetic-export-one', acquisition: 'controlled-synthetic-export', objectSha256: host.object.sha256, reason: '合成来源确认' }));
    const deprecated = await json(await post('review', { operationId: 'host-review', key: host.candidate.key, expectedEvidenceVersion: 0 }), 409);
    assert.equal(deprecated.error.details.reason, 'MODE_CONFLICT');
    assert.equal((await post('publish', publication)).status, 409);
    await json(await post('quality/freeze', { operationId: 'host-freeze', key: host.candidate.key }));
    const status = parseContractSchema('IntakeQualityStatus', await json(await host.requestAs('enabler', `${url}/quality?digest=${host.candidate.key.digest}`)));
    const page = parseContractSchema('IntakeQualitySamplePage', await json(await host.requestAs('enabler', `${url}/quality/samples?${new URLSearchParams({ digest: host.candidate.key.digest, viewHash: status.viewHash, phase: 'initial', limit: '100' })}`)));
    assert.equal(page.nextCursor, null); assert.equal(page.items.length, 3);
    const receipt = parseContractSchema('IntakeQualityReceipt', await json(await post('quality/checks', { operationId: 'host-checks', key: host.candidate.key,
      phase: 'initial', checks: page.items.map(row => ({ scriptId: row.scriptId, contentHash: row.contentHash, defect: false, reason: '' })) })));
    assert.equal(receipt.state, 'passed');
    const published = parseContractSchema('IntakeReceipt', await json(await post('publish', publication), 202));
    assert.deepEqual(await json(await post('publish', publication), 202), published);
    const use = { shopId: 'shop-a', productIds: [], scenarioIds: [], contextGeneration: 1, releaseId: null };
    const issue = (body: unknown) => host.requestAs('agent', '/v1/intake/entitlements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await issue({ ...use, shopId: 'shop-b' })).status, 404);
    const entitlement = parseContractSchema('IntakeEntitlement', await json(await issue(use)));
    const snapshot = parseContractSchema('IntakeSnapshot', await json(await host.requestAs('agent', `/v1/intake/snapshot?${new URLSearchParams({ entitlementId: entitlement.entitlementId, limit: '100' })}`)));
    assert.deepEqual(snapshot.faq.map(row => row.entry.answerText).sort(), INTAKE_SYNTHETIC_FAQ.map(row => row.answer).sort());
    assert.equal(material.materialHeader.scope.domain, domain);
    assert.ok(snapshot.faq.every(row => !row.entry.answerText.includes('合成内部说明') && !('internalNote' in row.entry)));
    if (domain === 'campaign') assert.ok(snapshot.faq.every(row => row.entry.effectiveTo !== null && Date.parse(row.entry.effectiveTo) === Date.parse('2099-01-01T00:00:00Z')));
    assert.equal(snapshot.nextCursor, null); assert.ok(snapshot.faq.every(row => row.sourceId === 'source-a'));
    const result = await host.status(); assert.equal(result.publications, 1);
    assert.equal(result.reviewBindings, 0); assert.equal(result.approvalFacts, 0);
    assert.equal(result.pendingApprovals, 0); assert.equal(result.directPublications, 1);
    assert.ok(result.diagnostics.some(d => d.reason === 'MATERIAL_CHANGED'));
    assert.equal(snapshot.releaseId, result.currentReleaseId);
    if (profile === 'purpose-runtime') {
      assert.ok(result.purposeQueries.business! > 10); assert.ok(result.purposeQueries.usage! > 10);
      if (domain === 'campaign') {
        const workbook = await createIntakeSyntheticWorkbook({ domain, missingExpiry: true });
        const form = new FormData(); form.set('operationId', 'missing-expiry-upload');
        form.set('file', new Blob([new Uint8Array(workbook)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic-missing-expiry.xlsx');
        const object = parseContractSchema('IntakeObject', await json(await host.requestAs('enabler', '/v1/intake/sources/source-a/objects', { method: 'POST', body: form }), 201));
        let job = parseContractSchema('IntakeParseJob', await json(await host.requestAs('enabler', '/v1/intake/sources/source-a/candidates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'missing-expiry-receive', objectId: object.objectId, sourceVersion: 1, baseReleaseId: result.currentReleaseId, contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null }) }), 202));
        const deadline = Date.now() + 20_000;
        while (job.state === 'reading' || job.state === 'parsing') {
          assert.ok(Date.now() < deadline, 'invalid campaign parser must settle');
          await new Promise(resolve => setTimeout(resolve, 20));
          job = parseContractSchema('IntakeParseJob', await json(await host.requestAs('enabler', `/v1/intake/parse-jobs/${job.jobId}`)));
        }
        assert.equal(job.state, 'failed'); assert.ok(job.issues.some(issue => issue.code === 'EXPIRY_REQUIRED'));
        const report = await host.requestAs('enabler', `/v1/intake/parse-jobs/${job.jobId}/report`);
        assert.equal(report.status, 200);
        const reportRows = await readIssueReport(Buffer.from(await report.arrayBuffer()));
        assert.equal(reportRows.length, 4); assert.ok(reportRows.slice(1).every(row => row[3] === 'EXPIRY_REQUIRED'));
        const unchanged = await host.status(); assert.equal(unchanged.currentReleaseId, result.currentReleaseId); assert.equal(unchanged.publications, 1); assert.ok(unchanged.purposeQueries.worker! > 0);
      }
      await host.revokeSyntheticQuery();
      assert.equal((await issue(use)).status, 404);
      assert.notEqual((await host.requestAs('agent', `/v1/intake/snapshot?entitlementId=${entitlement.entitlementId}`)).status, 200);
    }
    console.info(JSON.stringify({ status: 'PASS', profile, domain, consumer: 'ordinary-seat', http: 'actual', postgres: 15, publicationPolicy: 'direct-v1', approvalFacts: 0, publications: 1, faq: snapshot.faq.length, multilinePreserved: true }));
  } finally { await host.close(); }
  assert.deepEqual(host.resources(), { closed: true, identityListening: false, poolConnections: profile === 'purpose-runtime' ? [0, 0, 0, 0] : [0] });
  assert.equal(existsSync(host.root), false, 'owned PG, objects and attachments cleaned');
});
