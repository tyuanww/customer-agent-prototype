import assert from 'node:assert/strict';
import { parseContractSchema } from '@customer-agent/contracts';
import type { IntakeSyntheticHost } from '../../../api/tests/support/intake-synthetic-host.ts';

export async function publishPreparedFaq(host: {
  candidate: IntakeSyntheticHost['candidate'] | null;
  object: IntakeSyntheticHost['object'] | null;
  requestAs: IntakeSyntheticHost['requestAs'];
}, domain: string) {
  assert.ok(host.candidate && host.object, 'The fixture must prepare a FAQ workbook');
  const key = host.candidate.key;
  const url = `/v1/intake/candidates/${key.candidateId}/versions/${key.version}`;
  async function json(response: Response) {
    const value: unknown = await response.json();
    assert.ok(response.ok, JSON.stringify(value));
    return value;
  }
  const post = async (suffix: string, body: unknown) => json(await host.requestAs('enabler', `${url}/${suffix}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  await post('source-confirmation', { operationId: 'workspace-source', key, expectedEvidenceVersion: 0,
    confirmedVersionKind: 'opaque', confirmedVersionValue: 'synthetic-workspace-export', acquisition: 'controlled-synthetic-export',
    objectSha256: host.object.sha256, reason: '合成工作台验收来源' });
  await post('quality/freeze', { operationId: 'workspace-freeze', key });
  const quality = parseContractSchema('IntakeQualityStatus', await json(await host.requestAs('enabler', `${url}/quality?digest=${key.digest}`)));
  const query = new URLSearchParams({ digest: key.digest, viewHash: quality.viewHash, phase: 'initial', limit: '100' });
  const samples = parseContractSchema('IntakeQualitySamplePage', await json(await host.requestAs('enabler', `${url}/quality/samples?${query}`)));
  assert.equal(samples.nextCursor, null);
  assert.equal(samples.items.length, 3);
  await post('quality/checks', { operationId: 'workspace-checks', key, phase: 'initial',
    checks: samples.items.map(row => ({ scriptId: row.scriptId, contentHash: row.contentHash, defect: false, reason: '' })) });
  const receipt = parseContractSchema('IntakeReceipt', await post('publish', { operationId: 'workspace-publish', key,
    baseReleaseId: 'rel_native_base', sourceEvidenceVersion: 1, confirmed: true, title: '合成工作台发布', summary: domain }));
  assert.equal(receipt.state, 'published');
  return receipt;
}
