import type { QueryResultRow } from 'pg';

export type SearchRepositoryRequest = Readonly<{
  platform: 'qianniu' | 'douyin';
  productContextType: 'category' | 'sku' | null;
  productContextRef: string | null;
  normalizedQuery: string;
  bigramTsquery: string | null;
  escapedFallbackPattern: string;
  topK: 1 | 2 | 3;
  suppressMatches: boolean;
}>;

export type SearchRepositoryCandidate = Readonly<{
  rank: number;
  releaseId: string;
  scriptId: string;
  scriptVersion: number;
  contentHash: string;
  title: string;
  category: string;
  answerText: string;
  platformScope: readonly string[];
  productScopeType: string;
  productScopeRefs: readonly string[];
  effectiveFrom: Date | string;
  effectiveTo: Date | string | null;
  intentTaxonomyVersion: string;
  intentId: string;
  riskLevel: string;
  riskCategories: readonly string[];
  hasConflict: boolean;
  placeholderKeys: readonly string[];
}>;

export type SearchRepositoryResult =
  | Readonly<{
      ok: true;
      releaseId: string;
      sourceBindingHash: string;
      candidates: readonly SearchRepositoryCandidate[];
    }>
  | Readonly<{ ok: false; code: 'SOURCE_GATE_NOT_READY' }>;

type SearchQueryClient = Readonly<{
  query: <R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ) => Promise<Readonly<{ rows: R[] }>>;
}>;

interface SearchRow extends QueryResultRow {
  release_id: string;
  source_binding_hash: string;
  rank: number | null;
  script_id: string | null;
  script_version: number | null;
  content_hash: string | null;
  title: string | null;
  category: string | null;
  answer_text: string | null;
  platform_scope: string[] | null;
  product_scope_type: string | null;
  product_scope_refs: string[] | null;
  effective_from: Date | string | null;
  effective_to: Date | string | null;
  intent_taxonomy_version: string | null;
  intent_id: string | null;
  risk_level: string | null;
  risk_categories: string[] | null;
  has_conflict: boolean | null;
  placeholder_keys: string[] | null;
}

/*
 * The function owns current-release/source/scope/effective-date filtering.
 * This outer statement owns bigram primary recall, exact/phrase ranking,
 * fallback-only-on-primary-miss, stable ties and the database-side Top 3.
 */
export const SEARCH_CANDIDATES_SQL = `
WITH scoped AS MATERIALIZED (
  SELECT *
  FROM public.search_recommendable_scripts($1::text, $2::text, $3::text)
),
search_input AS MATERIALIZED (
  SELECT CASE
    WHEN $4::text IS NULL THEN NULL::tsquery
    ELSE pg_catalog.to_tsquery('simple', $4::text)
  END AS ts_query
),
candidate_pool AS MATERIALIZED (
  SELECT scoped.*
  FROM scoped
  WHERE scoped.is_candidate
    AND NOT $8::boolean
),
primary_matches AS MATERIALIZED (
  SELECT candidate_pool.*, search_input.ts_query
  FROM candidate_pool
  CROSS JOIN search_input
  WHERE search_input.ts_query IS NOT NULL
    AND candidate_pool.search_document @@ search_input.ts_query
),
fallback_matches AS MATERIALIZED (
  SELECT candidate_pool.*, NULL::tsquery AS ts_query
  FROM candidate_pool
  WHERE NOT EXISTS (SELECT 1 FROM primary_matches)
    AND candidate_pool.search_fallback_text ILIKE $5::text ESCAPE '\\'
),
matches AS MATERIALIZED (
  SELECT * FROM primary_matches
  UNION ALL
  SELECT * FROM fallback_matches
),
scored AS (
  SELECT
    matches.*,
    EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(matches.questions) AS question(value)
      WHERE pg_catalog.lower(question.value ->> 'question_text') = $6::text
    ) AS exact_question,
    pg_catalog.lower(matches.title) = $6::text AS exact_title,
    EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(matches.questions) AS question(value)
      WHERE pg_catalog.strpos(pg_catalog.lower(question.value ->> 'question_text'), $6::text) > 0
    ) AS phrase_question,
    pg_catalog.strpos(pg_catalog.lower(matches.title), $6::text) > 0 AS phrase_title,
    CASE
      WHEN matches.ts_query IS NULL THEN 0::real
      ELSE pg_catalog.ts_rank_cd(matches.search_document, matches.ts_query)
    END AS text_rank
  FROM matches
),
ranked AS (
  SELECT
    pg_catalog.row_number() OVER (
      ORDER BY
        scored.exact_question DESC,
        scored.exact_title DESC,
        scored.phrase_question DESC,
        scored.phrase_title DESC,
        scored.text_rank DESC,
        scored.script_id ASC
    )::integer AS rank,
    scored.*
  FROM scored
  ORDER BY
    scored.exact_question DESC,
    scored.exact_title DESC,
    scored.phrase_question DESC,
    scored.phrase_title DESC,
    scored.text_rank DESC,
    scored.script_id ASC
  LIMIT $7::integer
),
current_context AS (
  SELECT scoped.release_id, scoped.source_binding_hash
  FROM scoped
  LIMIT 1
)
SELECT
  current_context.release_id,
  current_context.source_binding_hash,
  ranked.rank,
  ranked.script_id,
  ranked.script_version,
  ranked.content_hash,
  ranked.title,
  ranked.category,
  ranked.answer_text,
  ranked.platform_scope,
  ranked.product_scope_type,
  ranked.product_scope_refs,
  ranked.effective_from,
  ranked.effective_to,
  ranked.intent_taxonomy_version,
  ranked.intent_id,
  ranked.risk_level,
  ranked.risk_categories,
  ranked.has_conflict,
  ranked.placeholder_keys
FROM current_context
LEFT JOIN ranked ON TRUE
ORDER BY ranked.rank NULLS LAST
`;

function requireCandidateRow(row: SearchRow): SearchRepositoryCandidate {
  if (
    row.rank === null
    || row.script_id === null
    || row.script_version === null
    || row.content_hash === null
    || row.title === null
    || row.category === null
    || row.answer_text === null
    || row.platform_scope === null
    || row.product_scope_type === null
    || row.product_scope_refs === null
    || row.effective_from === null
    || row.intent_taxonomy_version === null
    || row.intent_id === null
    || row.risk_level === null
    || row.risk_categories === null
    || row.has_conflict === null
    || row.placeholder_keys === null
  ) {
    throw new Error('Search repository returned a partial candidate row');
  }
  return Object.freeze({
    rank: row.rank,
    releaseId: row.release_id,
    scriptId: row.script_id,
    scriptVersion: row.script_version,
    contentHash: row.content_hash,
    title: row.title,
    category: row.category,
    answerText: row.answer_text,
    platformScope: Object.freeze([...row.platform_scope]),
    productScopeType: row.product_scope_type,
    productScopeRefs: Object.freeze([...row.product_scope_refs]),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    intentTaxonomyVersion: row.intent_taxonomy_version,
    intentId: row.intent_id,
    riskLevel: row.risk_level,
    riskCategories: Object.freeze([...row.risk_categories]),
    hasConflict: row.has_conflict,
    placeholderKeys: Object.freeze([...row.placeholder_keys]),
  });
}

export function createSearchRepository(client: SearchQueryClient): Readonly<{
  search: (request: SearchRepositoryRequest) => Promise<SearchRepositoryResult>;
}> {
  return Object.freeze({
    async search(request): Promise<SearchRepositoryResult> {
      const result = await client.query<SearchRow>(SEARCH_CANDIDATES_SQL, [
        request.platform,
        request.productContextType,
        request.productContextRef,
        request.bigramTsquery,
        request.escapedFallbackPattern,
        request.normalizedQuery,
        request.topK,
        request.suppressMatches,
      ]);
      const context = result.rows[0];
      if (!context) return Object.freeze({ ok: false, code: 'SOURCE_GATE_NOT_READY' });
      const candidates = result.rows
        .filter((row) => row.rank !== null)
        .map(requireCandidateRow);
      return Object.freeze({
        ok: true,
        releaseId: context.release_id,
        sourceBindingHash: context.source_binding_hash,
        candidates: Object.freeze(candidates),
      });
    },
  });
}
