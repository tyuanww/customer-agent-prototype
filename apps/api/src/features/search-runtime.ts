/**
 * Search and event capability on the shared runtime pool.
 *
 * Hides two decisions the composition entry should not repeat: how a closed
 * repository fails (SQLSTATE 08003 for candidate reads, OVERLOADED for event
 * writes), and which tables, functions, and search-boundary objects the
 * readiness proof must see before search is trustworthy.
 *
 * Stays in apps/api. The grants and the 08003/OVERLOADED split are this
 * Application API's search contract, not a reusable retrieval algorithm.
 */
import type { Pool } from 'pg';
import type { ApiRuntimeDiagnosticSink } from '../runtime-diagnostics.js';
import {
  createEventRepository,
  type EventRepository,
} from '../event-repository.js';
import {
  createSearchRepository,
  type SearchRepositoryRequest,
  type SearchRepositoryResult,
} from '../search-repository.js';
import type {
  RuntimeFunctionGrant,
  RuntimeRelationGrant,
} from '../ports/runtime-grants.js';

type SearchPool = Pick<Pool, 'query' | 'connect'>;

function closedRead(): Error {
  return Object.assign(new Error('Runtime repository is closed'), { code: '08003' });
}

function closedWrite(): Readonly<{ ok: false; code: 'OVERLOADED' }> {
  return Object.freeze({ ok: false, code: 'OVERLOADED' });
}

export const SEARCH_RELATION_GRANTS = Object.freeze([
  ['query_events', 'SELECT'],
  ['candidate_impressions', 'SELECT'],
  ['adoption_events', 'SELECT'],
  ['escalate_actions', 'SELECT'],
  ['query_events', 'INSERT'],
  ['candidate_impressions', 'INSERT'],
  ['adoption_events', 'INSERT'],
  ['escalate_actions', 'INSERT'],
] as const satisfies readonly RuntimeRelationGrant[]);

export const SEARCH_FUNCTION_GRANTS = Object.freeze([
  'public.record_runtime_source_denial_audit(text,text,text,text,text,text,text,text,text,text)',
  'public.search_recommendable_scripts(text,text,text)',
] as const satisfies readonly RuntimeFunctionGrant[]);

/** Functions whose bodies are hashed into the search-boundary manifest. */
export const SEARCH_BOUNDARY_FUNCTIONS = Object.freeze([
  'public.search_recommendable_scripts(text,text,text)',
  'public.content_scope_matches(text[],text,text[],text,text,text)',
  'public.content_questions_source_assets_are_active(jsonb)',
  'public.content_questions_are_valid(jsonb)',
  'public.content_question_hash(jsonb)',
  'public.content_public_questions(jsonb)',
  'public.jsonb_jcs(jsonb)',
  'public.content_utc_timestamp_text(timestamp with time zone)',
  'public.digest(bytea,text)',
  'public.owner_acceptance_release_ready(text)',
  'public.owner_acceptance_active_record(text,text,text)',
  'public.owner_acceptance_sources_ready(text,jsonb)',
  'public.owner_acceptance_instant(jsonb)',
] as const satisfies readonly RuntimeFunctionGrant[]);

/** Views included in the same manifest, after the function bodies. */
export const SEARCH_BOUNDARY_VIEWS = Object.freeze([
  'v_release_source_gate',
  'v_scripts_recommendable',
] as const);

export const SEARCH_BOUNDARY_MANIFEST_SIZE = SEARCH_BOUNDARY_FUNCTIONS.length
  + SEARCH_BOUNDARY_VIEWS.length;

export const SEARCH_BOUNDARY_MANIFEST_SHA256 = 'cf33ad08f0e6ef34dfa6f212e69aaac151a69603d69ee52db32c9e7bd02333ec';

export type SearchRuntime = Readonly<{
  searchCandidates: (request: SearchRepositoryRequest) => Promise<SearchRepositoryResult>;
  executeSearch: EventRepository['executeSearch'];
  recordAdoption: EventRepository['recordAdoption'];
  recordEscalation: EventRepository['recordEscalation'];
}>;

export function createSearchRuntime(
  pool: SearchPool,
  diagnosticSink: ApiRuntimeDiagnosticSink,
  isClosed: () => boolean,
): SearchRuntime {
  const searchRepository = createSearchRepository(pool);
  // undefined keeps lease-id generation inside the event repository.
  const eventRepository = createEventRepository(pool, undefined, diagnosticSink);
  return Object.freeze({
    async searchCandidates(request) {
      if (isClosed()) throw closedRead();
      return searchRepository.search(request);
    },
    async executeSearch(request) {
      if (isClosed()) return closedWrite();
      return eventRepository.executeSearch(request);
    },
    async recordAdoption(request) {
      if (isClosed()) return closedWrite();
      return eventRepository.recordAdoption(request);
    },
    async recordEscalation(request) {
      if (isClosed()) return closedWrite();
      return eventRepository.recordEscalation(request);
    },
  });
}
