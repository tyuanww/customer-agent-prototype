import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { parseContractSchema } from '../../packages/contracts/dist/index.js';
import { createIntakeSyntheticHost, INTAKE_SYNTHETIC_FAQ } from '../../apps/api/tests/support/intake-synthetic-host.ts';

test('isolated real HTTP/PG consumes parsed material, quality, confirmed direct, publication and ordinary-seat snapshot', {
  skip: process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_TEST !== '1', timeout: 60_000,
}, async () => {
  const host = await createIntakeSyntheticHost();
  const url = `/v1/intake/candidates/${host.candidate.key.candidateId}/versions/${host.candidate.key.version}`;
  const post = (suffix: string, body: unknown) => host.requestAs('enabler', `${url}/${suffix}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  async function json(response: Response, status = 200) {
    const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result;
  }
  try {
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
    assert.equal(snapshot.nextCursor, null); assert.ok(snapshot.faq.every(row => row.sourceId === 'source-a'));
    const result = await host.status(); assert.equal(result.publications, 1);
    assert.equal(result.reviewBindings, 0); assert.equal(result.approvalFacts, 0);
    assert.equal(result.pendingApprovals, 0); assert.equal(result.directPublications, 1);
    assert.ok(result.diagnostics.some(d => d.reason === 'MATERIAL_CHANGED'));
    assert.equal(snapshot.releaseId, result.currentReleaseId);
    console.info(JSON.stringify({ status: 'PASS', consumer: 'ordinary-seat', http: 'actual', postgres: 15, publicationPolicy: 'direct-v1', approvalFacts: 0, publications: 1, faq: snapshot.faq.length, multilinePreserved: true }));
  } finally { await host.close(); }
  assert.equal(existsSync(host.root), false, 'owned PG, objects and attachments cleaned');
});
