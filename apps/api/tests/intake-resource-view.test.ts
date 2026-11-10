import { describe, expect, it } from 'vitest';
import { LEGACY_CONTRACT_SET, RESOURCE_CONTRACT_SET, SOP_CONTRACT_SET, intakeView,
  parseContractSchema, selectIntakeView, withIntakeView } from '../src/content-intake/contract-view.js';
import { assertQuerySelection, openingProof, querySelection } from '../src/content-intake/sop-command.js';

const query = { sop_group: '税收相关规则', shop_id: 'synthetic-shop', query_text: '合成查询',
  context_generation: 'opaque-合成', request_id: '11111111-1111-4111-8111-111111111111' };
const opening = { entitlementId: 'synthetic-entitlement', releaseId: 'synthetic-release', contextGeneration: 7,
  key: { sourceId: 'synthetic-source', flowId: 'synthetic-flow', flowVersion: 1 }, graphDigest: 'a'.repeat(64),
  nodeId: 'start', action: 'open', edgeId: null, entry: null, continuationId: `sct_${'b'.repeat(64)}` };

describe('exact resource-disable view', () => {
  it('retains old exact IDs and selects only the deployed successor ID', () => {
    expect(selectIntakeView([])).toBe('legacy');
    expect(selectIntakeView([LEGACY_CONTRACT_SET])).toBe('legacy');
    expect(selectIntakeView([SOP_CONTRACT_SET])).toBe('graph');
    expect(selectIntakeView([RESOURCE_CONTRACT_SET])).toBe('resource-disable');
    for (const headers of [[''], [RESOURCE_CONTRACT_SET, RESOURCE_CONTRACT_SET],
      [RESOURCE_CONTRACT_SET.replace(/.{12}$/, 'ffffffffffff')], [RESOURCE_CONTRACT_SET.toUpperCase()]]) {
      expect(selectIntakeView(headers)).toBe('unsupported');
    }
  });

  it('requires the original entitlement only in the exact successor query view', () => {
    withIntakeView('graph', () => {
      expect(parseContractSchema('MenokinSopQuerySopQueryRequest', query)).toEqual(query);
      expect(() => parseContractSchema('MenokinSopQuerySopQueryRequest', { ...query, entitlement_id: 'synthetic-e' })).toThrow();
    });
    withIntakeView('resource-disable', () => {
      expect(() => parseContractSchema('MenokinSopQuerySopQueryRequest', query)).toThrow();
      expect(parseContractSchema('MenokinSopQuerySopQueryRequest', { ...query, entitlement_id: 'synthetic-e' }))
        .toEqual({ ...query, entitlement_id: 'synthetic-e' });
    });
  });

  it('requires exact Q for successor open and null Q for other actions while preserving v11', () => {
    withIntakeView('graph', () => {
      expect(parseContractSchema('IntakeSopActionCheck', opening)).toEqual(opening);
      expect(() => parseContractSchema('IntakeSopActionCheck', { ...opening, queryRequestId: query.request_id })).toThrow();
    });
    withIntakeView('resource-disable', () => {
      expect(() => parseContractSchema('IntakeSopActionCheck', opening)).toThrow();
      expect(() => parseContractSchema('IntakeSopActionCheck', { ...opening, queryRequestId: null })).toThrow();
      expect(parseContractSchema('IntakeSopActionCheck', { ...opening, queryRequestId: query.request_id }))
        .toHaveProperty('queryRequestId', query.request_id);
      expect(parseContractSchema('IntakeSopActionCheck', { ...opening, action: 'observe', queryRequestId: null }))
        .toHaveProperty('queryRequestId', null);
      expect(() => parseContractSchema('IntakeSopActionCheck', { ...opening, action: 'observe', queryRequestId: query.request_id })).toThrow();
    });
  });

  it('restores asynchronous view scope without changing the caller default', async () => {
    await withIntakeView('resource-disable', async () => {
      await Promise.resolve();
      expect(intakeView()).toBe('resource-disable');
      await withIntakeView('graph', async () => { expect(intakeView()).toBe('graph'); });
      expect(intakeView()).toBe('resource-disable');
    });
    expect(intakeView()).toBe('legacy');
  });

  it('normalizes selection and proof without converting opaque or numeric generations', () => {
    withIntakeView('resource-disable', () => {
      const parsed = parseContractSchema('MenokinSopQuerySopQueryRequest', { ...query, entitlement_id: 'synthetic-e' });
      expect(querySelection(parsed)).toEqual({ kind: 'current-entitlement', entitlementId: 'synthetic-e' });
      const selection = { shopId: 'synthetic-shop', contextGeneration: 17,
        productIds: ['synthetic-one', 'synthetic-two'], scenarioIds: ['synthetic-scenario'] };
      expect(() => assertQuerySelection(parsed, selection)).not.toThrow();
      expect(selection.scenarioIds).toEqual(['synthetic-scenario']);
      expect(parsed.context_generation).toBe('opaque-合成');
      expect(() => assertQuerySelection({ ...parsed, product_context: { type: 'sku', ref: 'unselected' } }, selection)).toThrow('SCOPE_DENIED');
      expect(openingProof(parseContractSchema('IntakeSopActionCheck', { ...opening, queryRequestId: query.request_id })))
        .toEqual({ kind: 'explicit-ready-query', queryRequestId: query.request_id });
    });
    withIntakeView('graph', () => {
      expect(querySelection(parseContractSchema('MenokinSopQuerySopQueryRequest', query))).toMatchObject({ kind: 'legacy-request' });
      expect(openingProof(parseContractSchema('IntakeSopActionCheck', opening))).toEqual({ kind: 'legacy-inferred' });
    });
  });
});
