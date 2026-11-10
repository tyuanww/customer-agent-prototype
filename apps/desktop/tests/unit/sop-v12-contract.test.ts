// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CONTRACT_PROVENANCE, validateContractSchema } from '@customer-agent/contracts/sop-resource-disable';
import { isSopUnifiedCommand, SOP_RESOURCE_CONTRACT } from '../../src/shared/sop-unified';

const requestId = '10000000-0000-4000-8000-000000000001';
const query = { sop_group: '品质售后SOP', shop_id: 'shop-a', query_text: '合成完整流程',
  context_generation: 'opaque-ui-generation', request_id: requestId };
const opening = { entitlementId: 'ordinary-e', releaseId: 'release-a', contextGeneration: 7,
  key: { sourceId: 'source-a', flowId: 'flow-a', flowVersion: 1 }, graphDigest: 'a'.repeat(64), nodeId: 'task-a',
  action: 'open', edgeId: null, entry: null, continuationId: `sct_${'a'.repeat(64)}` };

describe('formal v12 request consumption', () => {
  it('uses the selected generated provenance for the exact wire header', () => {
    expect(SOP_RESOURCE_CONTRACT).toBe(CONTRACT_PROVENANCE.contract_set_id);
  });
  it('requires the ordinary E reference while retaining opaque query generation', () => {
    expect(validateContractSchema('MenokinSopQuerySopQueryRequest', query).ok).toBe(false);
    expect(validateContractSchema('MenokinSopQuerySopQueryRequest', { ...query, entitlement_id: 'ordinary-e' }).ok).toBe(true);
  });
  it('requires an original query UUID for open and explicit null for other actions', () => {
    expect(validateContractSchema('IntakeSopActionCheck', opening).ok).toBe(false);
    expect(validateContractSchema('IntakeSopActionCheck', { ...opening, queryRequestId: null }).ok).toBe(false);
    expect(validateContractSchema('IntakeSopActionCheck', { ...opening, queryRequestId: requestId }).ok).toBe(true);
    expect(validateContractSchema('IntakeSopActionCheck', { ...opening, action: 'observe', queryRequestId: requestId }).ok).toBe(false);
    expect(validateContractSchema('IntakeSopActionCheck', { ...opening, action: 'observe', queryRequestId: null }).ok).toBe(true);
  });
  it('rejects renderer-selected entitlement, query or continuation identities', () => {
    const intent = { kind: 'query', shopKey: 'opaque-shop', group: '品质售后SOP', text: '合成完整流程' };
    expect(isSopUnifiedCommand(intent)).toBe(true);
    for (const authority of [{ entitlement_id: 'ordinary-e' }, { queryRequestId: requestId }, { continuationId: opening.continuationId }]) {
      expect(isSopUnifiedCommand({ ...intent, ...authority })).toBe(false);
    }
  });
});
