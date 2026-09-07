import { describe, expect, it, vi } from 'vitest';
import {
  createSearchRepository,
  SEARCH_CANDIDATES_SQL,
} from '../src/search-repository.js';

const context = Object.freeze({
  release_id: 'rel-synthetic-001',
  source_binding_hash: 'b'.repeat(64),
});

function candidateRow() {
  return {
    ...context,
    rank: 1,
    script_id: 'script-synthetic-001',
    script_version: 3,
    content_hash: 'a'.repeat(64),
    title: '合成发货时效',
    category: 'presale',
    answer_text: '这是合成回答。',
    platform_scope: ['qianniu', 'douyin'],
    product_scope_type: 'storewide',
    product_scope_refs: [],
    effective_from: new Date('2026-09-01T00:00:00.000Z'),
    effective_to: null,
    intent_taxonomy_version: 'itax_synthetic_v1',
    intent_id: 'intent_synthetic_shipping',
    risk_level: 'low',
    risk_categories: [],
    has_conflict: false,
    placeholder_keys: [],
    questions: [{ question_text: '合成发货时效' }],
    search_fallback_text: '合成发货时效',
    private_source_ref: 'must-not-cross-repository-port',
  };
}

const request = Object.freeze({
  platform: 'qianniu' as const,
  productContextType: null,
  productContextRef: null,
  suppressMatches: false,
  poolLimit: 512,
});

describe('search repository', () => {
  it('executes one parameterized ranking statement and maps only the internal candidate tuple', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [candidateRow()] });
    const repository = createSearchRepository({ query } as never);

    const result = await repository.search(request);

    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(SEARCH_CANDIDATES_SQL, [
      'qianniu', null, null, false, 512,
    ]);
    expect(SEARCH_CANDIDATES_SQL).toContain('LIMIT $5::integer');
    expect(SEARCH_CANDIDATES_SQL).toContain('AND NOT $4::boolean');
    expect(SEARCH_CANDIDATES_SQL).toContain('search_recommendable_scripts($1::text, $2::text, $3::text)');
    expect(result.ok && result.candidates[0]?.questionTexts).toEqual(['合成发货时效']);
    expect(result).toMatchObject({
      ok: true,
      releaseId: context.release_id,
      sourceBindingHash: context.source_binding_hash,
      candidates: [{ rank: 1, scriptId: 'script-synthetic-001' }],
    });
    expect(JSON.stringify(result)).not.toContain('private_source_ref');
  });

  it('distinguishes a ready no-hit sentinel from a source-gate denial', async () => {
    const noHit = createSearchRepository({
      query: vi.fn().mockResolvedValue({ rows: [{
        ...context,
        ...Object.fromEntries([
          'rank', 'script_id', 'script_version', 'content_hash', 'title', 'category',
          'answer_text', 'platform_scope', 'product_scope_type', 'product_scope_refs',
          'effective_from', 'effective_to', 'intent_taxonomy_version', 'intent_id',
          'risk_level', 'risk_categories', 'has_conflict', 'placeholder_keys',
          'questions', 'search_fallback_text',
        ].map((key) => [key, null])),
      }] }),
    } as never);
    await expect(noHit.search(request)).resolves.toEqual({
      ok: true,
      releaseId: context.release_id,
      sourceBindingHash: context.source_binding_hash,
      candidates: [],
    });

    const denied = createSearchRepository({
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as never);
    await expect(denied.search(request)).resolves.toEqual({
      ok: false,
      code: 'SOURCE_GATE_NOT_READY',
    });
  });

  it('fails closed when PostgreSQL returns a partial candidate projection', async () => {
    const repository = createSearchRepository({
      query: vi.fn().mockResolvedValue({ rows: [{ ...candidateRow(), content_hash: null }] }),
    } as never);
    await expect(repository.search(request)).rejects.toThrow(/partial candidate row/);
  });
});
