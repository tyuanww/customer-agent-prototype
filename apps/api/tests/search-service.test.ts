import { describe, expect, it, vi } from 'vitest';
import type { SearchRepositoryCandidate } from '../src/search-repository.js';
import { createSearchBackend } from '../src/search-service.js';

function candidate(overrides: Partial<SearchRepositoryCandidate> = {}): SearchRepositoryCandidate {
  return {
    rank: 1,
    releaseId: 'rel-synthetic-001',
    scriptId: 'script-synthetic-001',
    scriptVersion: 1,
    contentHash: 'a'.repeat(64),
    title: '合成退款标题',
    category: 'product',
    answerText: '合成回答原文',
    questionTexts: ['合成退款标题'],
    searchFallbackText: '合成退款标题',
    platformScope: ['qianniu'],
    productScopeType: 'storewide',
    productScopeRefs: [],
    effectiveFrom: '2026-09-01T00:00:00Z',
    effectiveTo: null,
    intentTaxonomyVersion: 'itax_synthetic_v1',
    intentId: 'intent_synthetic_product',
    riskLevel: 'low',
    riskCategories: [],
    hasConflict: false,
    placeholderKeys: [],
    ...overrides,
  };
}

const request = Object.freeze({
  normalizedQuery: '  Ａ％_\\退款  ',
  platform: 'qianniu' as const,
  productContextType: null,
  productContextRef: null,
  topK: 3 as const,
});

describe('search backend', () => {
  it.each([
    '合成粉扑R不接触面板吗，合成粉扑R浸水',
    '合成粉扑R浸水，合成粉扑R不接触面板吗',
    '合成粉扑R不接触面板。浸水吗',
    '合成粉扑R不接触面板.浸水吗',
  ])('does not waive an independent conflicting assertion: %s', async (normalizedQuery) => {
    const backend = createSearchBackend({ searchCandidates: async () => ({
      ok: true, releaseId: 'rel-synthetic-001', sourceBindingHash: 'b'.repeat(64),
      candidates: [candidate({
        title: '合成粉扑R接触说明', answerText: '合成粉扑R接触面板；不浸水；收纳时保持干燥。',
        questionTexts: ['合成粉扑R怎么收纳'], searchFallbackText: '合成粉扑R接触说明',
      })],
    }) });
    await expect(backend.search({ ...request, normalizedQuery })).resolves.toMatchObject({ ok: true, candidates: [] });
  });

  it.each([
    ['合成粉扑R不接触面板吗', 'show'],
    ['合成粉扑R不接触面板，对吗', 'show'],
    ['合成粉扑R不接触面板', 'reject'],
    ['合成粉扑S不接触面板吗', 'reject'],
    ['合成粉扑R不接触玻璃吗', 'reject'],
  ])('uses only existing candidate fields for %s', async (normalizedQuery, decision) => {
    const answer = '合成粉扑R接触面板；收纳时保持干燥。';
    const backend = createSearchBackend({
      searchCandidates: async () => ({
        ok: true,
        releaseId: 'rel-synthetic-001',
        sourceBindingHash: 'b'.repeat(64),
        candidates: [candidate({
          title: '合成粉扑R接触说明', answerText: answer,
          questionTexts: ['合成粉扑R怎么收纳'], searchFallbackText: '合成粉扑R接触说明',
        })],
      }),
    });
    const result = await backend.search({ ...request, normalizedQuery });
    expect(result).toMatchObject({ ok: true, decision });
    if (!result.ok) throw new Error(result.code);
    expect(result.candidates).toHaveLength(decision === 'show' ? 1 : 0);
    if (decision === 'show') expect(result.candidates[0]?.answer_text).toBe(answer);
    expect(JSON.stringify(result)).not.toMatch(/annotation|queryFacts|sourceFacts|requiresClarification/);
  });

  it('builds deterministic bigrams/escaped fallback and explicitly maps the public whitelist', async () => {
    const searchCandidates = vi.fn().mockResolvedValue({
      ok: true,
      releaseId: 'rel-synthetic-001',
      sourceBindingHash: 'b'.repeat(64),
      candidates: [{ ...candidate(), reviewerEvidence: 'must-not-cross' }],
    });
    const backend = createSearchBackend({ searchCandidates });

    const result = await backend.search(request);

    expect(searchCandidates).toHaveBeenCalledWith({
      platform: 'qianniu',
      productContextType: null,
      productContextRef: null,
      suppressMatches: false,
      poolLimit: 512,
    });
    expect(result).toMatchObject({
      ok: true,
      candidates: [{
        rank: 1,
        script_id: 'script-synthetic-001',
        answer_text: '合成回答原文',
        effective_from: '2026-09-01T00:00:00.000Z',
      }],
    });
    expect(JSON.stringify(result)).not.toContain('reviewerEvidence');
  });

  it('preserves release context while suppressing entity-free generic intent matches', async () => {
    const searchCandidates = vi.fn().mockResolvedValue({
      ok: true,
      releaseId: 'rel-synthetic-001',
      sourceBindingHash: 'b'.repeat(64),
      candidates: [],
    });
    const backend = createSearchBackend({ searchCandidates });

    await backend.search({ ...request, normalizedQuery: '请问怎么用呢' });

    expect(searchCandidates).toHaveBeenCalledWith(expect.objectContaining({
      suppressMatches: true,
      poolLimit: 512,
    }));
  });

  it('uses escaped fallback only for a one-code-point query', async () => {
    const searchCandidates = vi.fn().mockResolvedValue({
      ok: true,
      releaseId: 'rel-synthetic-001',
      sourceBindingHash: 'b'.repeat(64),
      candidates: [],
    });
    const backend = createSearchBackend({ searchCandidates });
    await backend.search({ ...request, normalizedQuery: '%' });
    expect(searchCandidates).toHaveBeenCalledWith(expect.objectContaining({
      suppressMatches: false,
      poolLimit: 512,
    }));
  });

  it.each([
    [{ code: 'ZA001', detail: 'SEARCH_SCOPE_INVALID' }, 'VALIDATION'],
    [{ code: 'ZA005', detail: 'FORBIDDEN' }, 'FORBIDDEN'],
    [{ code: 'ZA002', detail: 'NOT_FOUND' }, 'NOT_FOUND'],
    [{ code: 'ZA003', detail: 'CONFLICT' }, 'CONFLICT'],
    [{ code: '08006' }, 'OVERLOADED'],
    [new Error('private SQL and DSN'), 'INTERNAL'],
  ])('normalizes database failures without reflecting private errors', async (error, expectedCode) => {
    const backend = createSearchBackend({
      searchCandidates: vi.fn().mockRejectedValue(error),
    });
    await expect(backend.search(request)).resolves.toEqual({ ok: false, code: expectedCode });
  });

  it('fails closed when an internal row cannot satisfy the public candidate contract', async () => {
    const backend = createSearchBackend({
      searchCandidates: vi.fn().mockResolvedValue({
        ok: true,
        releaseId: 'rel-synthetic-001',
        sourceBindingHash: 'b'.repeat(64),
        candidates: [candidate({ category: 'private-category' })],
      }),
    });
    await expect(backend.search(request)).resolves.toEqual({ ok: false, code: 'INTERNAL' });
  });
});
