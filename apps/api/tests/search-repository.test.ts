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
    private_source_ref: 'must-not-cross-repository-port',
  };
}

const request = Object.freeze({
  platform: 'qianniu' as const,
  productContextType: null,
  productContextRef: null,
  normalizedQuery: '什么时候发货',
  bigramTsquery: '什么 & 么时 & 时候 & 候发 & 发货',
  escapedFallbackPattern: '%什么时候发货%',
  topK: 3 as const,
  suppressMatches: false,
});

describe('search repository', () => {
  it('executes one parameterized ranking statement and maps only the internal candidate tuple', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [candidateRow()] });
    const repository = createSearchRepository({ query } as never);

    const result = await repository.search(request);

    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(SEARCH_CANDIDATES_SQL, [
      'qianniu', null, null, request.bigramTsquery, '%什么时候发货%', '什么时候发货', 3, false,
    ]);
    expect(SEARCH_CANDIDATES_SQL).toContain('LIMIT $7::integer');
    expect(SEARCH_CANDIDATES_SQL).toContain("ILIKE $5::text ESCAPE '\\'");
    expect(SEARCH_CANDIDATES_SQL).toContain('NOT EXISTS (SELECT 1 FROM primary_matches)');
    expect(SEARCH_CANDIDATES_SQL).toContain('AND NOT $8::boolean');
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
