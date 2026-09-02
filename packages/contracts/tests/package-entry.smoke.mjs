import assert from 'node:assert/strict';
import test from 'node:test';

const validSearchRequest = Object.freeze({
  query_id: '5a5d8ff9-a23e-4c04-b902-64d0e33502cf',
  parent_query_id: null,
  interaction_reason: 'original',
  query_text: '退款进度',
  collection_mode: 'synthetic',
  detected_platform: 'qianniu',
  platform: 'qianniu',
  platform_source: 'manual',
  product_context_type: null,
  product_context_ref: null,
  top_k: 3,
});

test('compiled package exports load in the supported Node runtime', async () => {
  const contracts = await import('@customer-agent/contracts');
  const provenance = await import('@customer-agent/contracts/provenance');

  assert.equal(contracts.CONTRACT_PROVENANCE.runtime_activated, false);
  assert.equal(provenance.CONTRACT_PROVENANCE.runtime_activated, false);
  assert.equal(contracts.validateContractSchema('SearchRequest', validSearchRequest).ok, true);
});
