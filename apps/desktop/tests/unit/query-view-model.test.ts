import { describe, expect, it } from 'vitest';
import { PRODUCT_ERRORS } from '../../src/shared/product-session';
import type { ProductCandidate } from '../../src/shared/product-search';
import {
  ANNOUNCE_EXPIRED_MESSAGE,
  adoptedPlaceholderValues,
  announceInvalidationEffect,
  contentUpdatedBannerCopy,
  copySuccessErrorMessage,
  rankedScriptsFromProductCandidates,
} from '../../src/renderer/features/search/query-view-model';

function candidate(overrides: Partial<ProductCandidate> = {}): ProductCandidate {
  return {
    rank: 1,
    release_id: 'rel-synthetic',
    script_id: 'script-synthetic',
    script_version: 4,
    content_hash: 'a'.repeat(64),
    title: '合成发货',
    category: 'presale',
    answer_text: '合成订单 {订单号}',
    platform_scope: ['qianniu', 'douyin'],
    product_scope_type: 'storewide',
    product_scope_refs: [],
    effective_from: '2026-01-01T00:00:00Z',
    effective_to: null,
    intent_taxonomy_version: 'itax_synthetic_v1',
    intent_id: 'intent_synthetic_shipping',
    risk_level: 'low',
    risk_categories: [],
    has_conflict: false,
    placeholder_keys: ['order_id'],
    ...overrides,
  } as ProductCandidate;
}

describe('query result view model', () => {
  it('maps product candidates onto the existing Top 3 card shape', () => {
    const [both, douyin, qianniu] = rankedScriptsFromProductCandidates({
      candidates: [
        candidate(),
        candidate({
          rank: 2,
          script_id: 'script-douyin',
          category: 'aftersale',
          platform_scope: ['douyin'],
          effective_to: '2026-12-31T00:00:00Z',
          placeholder_keys: [],
        }),
        candidate({
          rank: 3,
          script_id: 'script-qianniu',
          category: 'product',
          platform_scope: ['qianniu'],
        }),
      ],
      telemetryStatus: 'recorded',
      sessionEpoch: 7,
      generation: 3,
      queryId: '11111111-1111-4111-8111-111111111111',
    });

    expect(both).toMatchObject({
      scriptId: 'script-synthetic',
      domain: '售前',
      platform: '千牛 / 抖音',
      scopeLabel: '合成发货',
      answerText: '合成订单 {订单号}',
      effectiveTo: '',
      rank: 1,
      score: 0,
      matchKind: 'exact',
      matchLabel: '后端候选',
      placeholderKeys: ['order_id'],
      productCopy: {
        sessionEpoch: 7,
        generation: 3,
        queryId: '11111111-1111-4111-8111-111111111111',
        rank: 1,
        scriptId: 'script-synthetic',
        scriptVersion: 4,
        contentHash: 'a'.repeat(64),
      },
    });
    expect(douyin).toMatchObject({
      domain: '售后',
      platform: '抖音',
      effectiveTo: '2026-12-31T00:00:00Z',
      matchLabel: '后端候选',
    });
    expect(qianniu).toMatchObject({ domain: '产品', platform: '千牛' });
  });

  it('labels collection-disabled candidates without treating them as recorded', () => {
    const [item] = rankedScriptsFromProductCandidates({
      candidates: [candidate()],
      telemetryStatus: 'collection_disabled',
      sessionEpoch: 1,
      generation: 1,
      queryId: '22222222-2222-4222-8222-222222222222',
    });
    expect(item?.matchLabel).toBe('后端候选 · 不记录事件');
  });

  it('keeps only filled placeholder values for copy', () => {
    expect(adoptedPlaceholderValues(
      ['order_id', 'date'],
      { order_id: 'A1', date: '' },
    )).toEqual({ order_id: 'A1' });
    expect(adoptedPlaceholderValues(undefined, {})).toEqual({});
  });

  it('mentions an unrecorded copy without calling it sent', () => {
    expect(copySuccessErrorMessage({ eventStatus: 'unrecorded' })).toBe('已复制；事件未记录，请勿重复复制');
    expect(copySuccessErrorMessage({ eventStatus: 'recorded' })).toBe('');
    expect(copySuccessErrorMessage({})).toBe('');
  });

  it('names updated libraries in the fixed domain order', () => {
    expect(contentUpdatedBannerCopy(['aftersale', 'product'])).toBe('产品话术、售后话术已更新');
  });

  it('keeps announce invalidation visible outcomes', () => {
    expect(announceInvalidationEffect({
      reason: 'signed_out',
      sessionBusy: false,
      searchInFlight: false,
      showingQueryContent: true,
    })).toEqual({ announceInvalid: false, errorMessage: '', phase: 'SEARCH_INPUT' });
    expect(announceInvalidationEffect({
      reason: 'expired',
      sessionBusy: true,
      searchInFlight: false,
      showingQueryContent: true,
    })).toEqual({ announceInvalid: false, errorMessage: '', phase: 'SEARCH_INPUT' });
    expect(announceInvalidationEffect({
      reason: 'source_gate',
      sessionBusy: false,
      searchInFlight: false,
      showingQueryContent: true,
    })).toEqual({
      announceInvalid: false,
      errorMessage: PRODUCT_ERRORS.SOURCE_GATE_NOT_READY,
      phase: 'ERROR',
    });
    expect(announceInvalidationEffect({
      reason: 'unavailable',
      sessionBusy: false,
      searchInFlight: false,
      showingQueryContent: false,
    })).toEqual({ announceInvalid: false, errorMessage: '', phase: 'SEARCH_INPUT' });
    expect(announceInvalidationEffect({
      reason: 'unavailable',
      sessionBusy: false,
      searchInFlight: true,
      showingQueryContent: false,
    })).toEqual({
      announceInvalid: false,
      errorMessage: PRODUCT_ERRORS.UNAVAILABLE,
      phase: 'ERROR',
    });
    expect(announceInvalidationEffect({
      reason: 'expired',
      sessionBusy: false,
      searchInFlight: false,
      showingQueryContent: false,
    })).toEqual({ announceInvalid: true, errorMessage: '', phase: 'SEARCH_INPUT' });
    expect(announceInvalidationEffect({
      reason: 'expired',
      sessionBusy: false,
      searchInFlight: false,
      showingQueryContent: true,
    })).toEqual({
      announceInvalid: false,
      errorMessage: ANNOUNCE_EXPIRED_MESSAGE,
      phase: 'ERROR',
    });
    expect(announceInvalidationEffect({
      reason: 'other',
      sessionBusy: false,
      searchInFlight: true,
      showingQueryContent: false,
    })).toEqual({ announceInvalid: false, errorMessage: null, phase: null });
  });
});
