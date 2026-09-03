import { parseContractSchema, type components } from '@customer-agent/contracts';
import { mapDatabaseContractError, type DatabaseContractFailure } from './database-contract-errors.js';
import {
  type SearchRepositoryRequest,
  type SearchRepositoryResult,
} from './search-repository.js';
import {
  isEntityFreeGenericSearchText,
  normalizeSearchText,
  unicodeBigramTokens,
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
      candidates: readonly SearchCandidate[];
    }>
  | Readonly<{ ok: false; code: 'SOURCE_GATE_NOT_READY' | DatabaseContractFailure }>;

export type SearchBackend = Readonly<{
  search: (request: SearchBackendRequest) => Promise<SearchBackendResult>;
}>;

type SearchRepositoryPort = Readonly<{
  searchCandidates: (request: SearchRepositoryRequest) => Promise<SearchRepositoryResult>;
}>;

function escapeLikePattern(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function isoTimestamp(value: Date | string): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.valueOf())) throw new Error('Search candidate timestamp is invalid');
  return timestamp.toISOString();
}

export function createSearchBackend(repository: SearchRepositoryPort): SearchBackend {
  return Object.freeze({
    async search(request): Promise<SearchBackendResult> {
      const normalizedQuery = normalizeSearchText(request.normalizedQuery);
      const bigrams = unicodeBigramTokens(normalizedQuery);
      const repositoryRequest = Object.freeze({
        platform: request.platform,
        productContextType: request.productContextType,
        productContextRef: request.productContextRef,
        normalizedQuery,
        bigramTsquery: bigrams.length === 0 ? null : bigrams.join(' & '),
        escapedFallbackPattern: `%${escapeLikePattern(normalizedQuery)}%`,
        topK: request.topK,
        suppressMatches: isEntityFreeGenericSearchText(normalizedQuery),
      }) satisfies SearchRepositoryRequest;

      let result: SearchRepositoryResult;
      try {
        result = await repository.searchCandidates(repositoryRequest);
      } catch (error: unknown) {
        return Object.freeze({ ok: false, code: mapDatabaseContractError(error) });
      }
      if (!result.ok) return result;

      try {
        const candidates = result.candidates.map((candidate) => parseContractSchema('SearchCandidate', {
          rank: candidate.rank,
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
          candidates: Object.freeze(candidates),
        });
      } catch {
        return Object.freeze({ ok: false, code: 'INTERNAL' });
      }
    },
  });
}
