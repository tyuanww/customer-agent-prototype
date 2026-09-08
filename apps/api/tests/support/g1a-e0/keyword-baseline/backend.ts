import type { Client } from 'pg';
import type { SearchBackend } from '../../../../src/search-service.js';
import { createSearchRepository } from './search-repository.js';
import { createSearchBackend } from './search-service.js';

/** Historical ranking is isolated from current judgeSearch and generic-query policy.
 * The decision added here describes search display only, never downstream action.
 */
export function createKeywordBaseline(client: Client): SearchBackend {
  const repository = createSearchRepository(client as never);
  const baseline = createSearchBackend({ searchCandidates: repository.search });
  return Object.freeze({
    async search(request) {
      const result = await baseline.search(request);
      if (!result.ok) return result;
      return Object.freeze({ ...result, decision: result.candidates.length > 0 ? 'show' as const : 'clarify_or_no_result' as const });
    },
  });
}
