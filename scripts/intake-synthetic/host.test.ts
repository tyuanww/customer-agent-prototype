import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { parseContractSchema } from '../../packages/contracts/dist/index.js';
import { createIntakeSyntheticHost, INTAKE_SYNTHETIC_FAQ } from '../../apps/api/tests/support/intake-synthetic-host.ts';

test('isolated real HTTP/PG consumes parsed material, manual approval, quality, publication and ordinary-seat snapshot', {
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
    assert.throws(() => host.approveReview(), /Exactly one pending/);
    const material = parseContractSchema('IntakeCandidatePage', await json(await host.requestAs('enabler', `${url}/material?limit=100`)));
    assert.equal(material.entries.length, 3);
    const publication = { operationId: 'host-publish', key: host.candidate.key, baseReleaseId: 'rel_native_base', sourceEvidenceVersion: 1,
      approvalEvidenceVersion: 1, title: '合成宿主发布', summary: '实际 API/PG 验证' };
    assert.equal((await post('publish', publication)).status, 409);
    await json(await post('source-confirmation', { operationId: 'host-source', key: host.candidate.key, expectedEvidenceVersion: 0,
      confirmedVersionKind: 'opaque', confirmedVersionValue: 'synthetic-export-one', acquisition: 'controlled-synthetic-export', objectSha256: host.object.sha256, reason: '合成来源确认' }));
    const review = parseContractSchema('IntakeReview', await json(await post('review', { operationId: 'host-review', key: host.candidate.key, expectedEvidenceVersion: 0 }), 202));
    // Creation binds the instance; only an explicit observation records facts.
    assert.equal(review.state, 'unavailable', JSON.stringify(await host.status())); assert.equal((await host.status()).pendingApprovals, 1);
    const waiting = parseContractSchema('IntakeReview', await json(await post('review/refresh', { operationId: 'host-review-pending', key: host.candidate.key, expectedEvidenceVersion: 1 }), 202));
    assert.equal(waiting.state, 'pending');
    assert.equal((await post('publish', publication)).status, 409);
    host.approveReview();
    const approved = parseContractSchema('IntakeReview', await json(await post('review/refresh', { operationId: 'host-review-refresh', key: host.candidate.key, expectedEvidenceVersion: 1 }), 202));
    assert.equal(approved.state, 'approved');
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
    assert.deepEqual(result.diagnostics.map(d => d.reason), ['SCOPE_DENIED', 'SOURCE_MISMATCH', 'AWAITING_APPROVAL', 'MATERIAL_CHANGED', 'SCOPE_DENIED']);
    assert.equal(snapshot.releaseId, result.currentReleaseId);
    console.info(JSON.stringify({ status: 'PASS', consumer: 'ordinary-seat', http: 'actual', postgres: 15, approval: 'manual-synthetic-transport', publications: 1, faq: snapshot.faq.length, multilinePreserved: true }));
  } finally { await host.close(); }
  assert.equal(existsSync(host.root), false, 'owned PG, objects and attachments cleaned');
});
