import type { QueryResultRow } from 'pg';

export const SEARCH_SCOPED_POOL_LIMIT = 512;

export type SearchRepositoryRequest = Readonly<{
  platform: 'qianniu' | 'douyin';
  productContextType: 'category' | 'sku' | null;
  productContextRef: string | null;
  suppressMatches: boolean;
  poolLimit: number;
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
  questionTexts: readonly string[];
  searchFallbackText: string;
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
  questions: unknown;
  search_fallback_text: string | null;
}

/*
 * The function owns current-release/source/scope/effective-date filtering.
 * This outer statement returns the gated candidate pool; recall, conflict
 * judgement and Top 3 belong to the search module.
 */
export const SEARCH_CANDIDATES_SQL = `
WITH scoped AS MATERIALIZED (
  SELECT *
  FROM public.search_recommendable_scripts($1::text, $2::text, $3::text)
),
candidate_pool AS MATERIALIZED (
  SELECT scoped.*
  FROM scoped
  WHERE scoped.is_candidate
    AND NOT $4::boolean
  ORDER BY scoped.script_id ASC
  LIMIT $5::integer
),
current_context AS (
  SELECT scoped.release_id, scoped.source_binding_hash
  FROM scoped
  LIMIT 1
)
SELECT
  current_context.release_id,
  current_context.source_binding_hash,
  CASE
    WHEN candidate_pool.script_id IS NULL THEN NULL
    ELSE pg_catalog.row_number() OVER (ORDER BY candidate_pool.script_id ASC)::integer
  END AS rank,
  candidate_pool.script_id,
  candidate_pool.script_version,
  candidate_pool.content_hash,
  candidate_pool.title,
  candidate_pool.category,
  candidate_pool.answer_text,
  candidate_pool.platform_scope,
  candidate_pool.product_scope_type,
  candidate_pool.product_scope_refs,
  candidate_pool.effective_from,
  candidate_pool.effective_to,
  candidate_pool.intent_taxonomy_version,
  candidate_pool.intent_id,
  candidate_pool.risk_level,
  candidate_pool.risk_categories,
  candidate_pool.has_conflict,
  candidate_pool.placeholder_keys,
  candidate_pool.questions,
  candidate_pool.search_fallback_text
FROM current_context
LEFT JOIN candidate_pool ON TRUE
ORDER BY candidate_pool.script_id NULLS LAST
`;

function questionTextsFrom(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const texts: string[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue;
    const questionText = Reflect.get(item, 'question_text');
    if (typeof questionText === 'string' && questionText.length > 0) texts.push(questionText);
  }
  return Object.freeze(texts);
}

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
    questionTexts: questionTextsFrom(row.questions),
    searchFallbackText: row.search_fallback_text ?? '',
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
        request.suppressMatches,
        request.poolLimit,
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
