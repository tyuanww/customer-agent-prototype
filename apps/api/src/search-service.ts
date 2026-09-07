import { parseContractSchema, type components } from '@customer-agent/contracts';
import { mapDatabaseContractError, type DatabaseContractFailure } from './database-contract-errors.js';
import {
  judgeSearch,
  type SearchDisplayDecision,
} from './search-decision.js';
import {
  SEARCH_SCOPED_POOL_LIMIT,
  type SearchRepositoryCandidate,
  type SearchRepositoryRequest,
  type SearchRepositoryResult,
} from './search-repository.js';
import {
  isEntityFreeGenericSearchText,
  normalizeSearchText,
} from './search-text.js';

type SearchCandidate = components['schemas']['SearchCandidate'];

export type SearchBackendRequest = Readonly<{
  normalizedQuery: string;
  platform: 'qianniu' | 'douyin';
  productContextType: 'category' | 'sku' | null;
  productContextRef: string | null;
  topK: 1 | 2 | 3;
}>;

export type SearchBackendResult =
  | Readonly<{
      ok: true;
      releaseId: string;
      sourceBindingHash: string;
      decision: SearchDisplayDecision;
      candidates: readonly SearchCandidate[];
    }>
  | Readonly<{ ok: false; code: 'SOURCE_GATE_NOT_READY' | DatabaseContractFailure }>;

export type SearchBackend = Readonly<{
  search: (request: SearchBackendRequest) => Promise<SearchBackendResult>;
}>;

type SearchRepositoryPort = Readonly<{
  searchCandidates: (request: SearchRepositoryRequest) => Promise<SearchRepositoryResult>;
}>;

function isoTimestamp(value: Date | string): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.valueOf())) throw new Error('Search candidate timestamp is invalid');
  return timestamp.toISOString();
}

function toJudgable(candidate: SearchRepositoryCandidate) {
  return Object.freeze({
    scriptId: candidate.scriptId,
    title: candidate.title,
    answerText: candidate.answerText,
    questionTexts: candidate.questionTexts,
    searchFallbackText: candidate.searchFallbackText,
  });
}

export function displayOutcomeFromSearchResult(
  result: SearchBackendResult,
): SearchDisplayDecision {
  if (!result.ok) {
    if (result.code === 'SOURCE_GATE_NOT_READY') return 'reject';
    throw new Error(`search backend failed: ${result.code}`);
  }
  return result.decision;
}

export function createSearchBackend(repository: SearchRepositoryPort): SearchBackend {
  return Object.freeze({
    async search(request): Promise<SearchBackendResult> {
      const normalizedQuery = normalizeSearchText(request.normalizedQuery);
      const repositoryRequest = Object.freeze({
        platform: request.platform,
        productContextType: request.productContextType,
        productContextRef: request.productContextRef,
        suppressMatches: isEntityFreeGenericSearchText(normalizedQuery),
        poolLimit: SEARCH_SCOPED_POOL_LIMIT,
      }) satisfies SearchRepositoryRequest;

      let result: SearchRepositoryResult;
      try {
        result = await repository.searchCandidates(repositoryRequest);
      } catch (error: unknown) {
        return Object.freeze({ ok: false, code: mapDatabaseContractError(error) });
      }
      if (!result.ok) return result;

      try {
        const judged = judgeSearch(normalizedQuery, result.candidates.map(toJudgable));
        const byId = new Map(result.candidates.map((candidate) => [candidate.scriptId, candidate]));
        const selected = judged.shownScriptIds
          .map((scriptId) => byId.get(scriptId))
          .filter((candidate): candidate is SearchRepositoryCandidate => candidate !== undefined)
          .slice(0, request.topK);
        const decision: SearchDisplayDecision = selected.length > 0 ? 'show' : judged.decision;
        const candidates = selected.map((candidate, index) => parseContractSchema('SearchCandidate', {
          rank: index + 1,
          release_id: candidate.releaseId,
          script_id: candidate.scriptId,
          script_version: candidate.scriptVersion,
          content_hash: candidate.contentHash,
          title: candidate.title,
          category: candidate.category,
          answer_text: candidate.answerText,
          platform_scope: [...candidate.platformScope],
          product_scope_type: candidate.productScopeType,
          product_scope_refs: [...candidate.productScopeRefs],
          effective_from: isoTimestamp(candidate.effectiveFrom),
          effective_to: candidate.effectiveTo === null ? null : isoTimestamp(candidate.effectiveTo),
          intent_taxonomy_version: candidate.intentTaxonomyVersion,
          intent_id: candidate.intentId,
          risk_level: candidate.riskLevel,
          risk_categories: [...candidate.riskCategories],
          has_conflict: candidate.hasConflict,
          placeholder_keys: [...candidate.placeholderKeys],
        }));
        return Object.freeze({
          ok: true,
          releaseId: result.releaseId,
          sourceBindingHash: result.sourceBindingHash,
          decision,
          candidates: Object.freeze(candidates),
        });
      } catch {
        return Object.freeze({ ok: false, code: 'INTERNAL' });
      }
    },
  });
}
