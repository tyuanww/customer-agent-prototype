import {
  parseContractSchema,
  validateContractSchema,
  type components,
} from '@customer-agent/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  authenticateRequestHeaders,
  type AuthenticatedUser,
  type AuthService,
} from './auth-service.js';
import {
  sendConflict,
  sendForbiddenOrPolicyDenied,
  sendInternalError,
  sendNotFound,
  sendOverloaded,
  sendSourceGateNotReady,
  sendUnauthorized,
  sendValidationError,
} from './contract-http-errors.js';
import { redactQueryText } from './request-boundary.js';
import { validateSearchTextBoundary } from './request-boundary.js';
import { hmacRedactedQuery, normalizeSearchText } from './search-text.js';
import type { SearchBackendRequest } from './search-service.js';

type SearchRequest = components['schemas']['SearchRequest'];
type SearchResponse = components['schemas']['SearchResponse'];

export type PreparedSearchOperation = Readonly<{
  actor: AuthenticatedUser;
  queryId: string;
  parentQueryId: string | null;
  interactionReason: 'original' | 'reselection';
  collectionMode: SearchRequest['collection_mode'];
  detectedPlatform: SearchRequest['detected_platform'];
  platformSource: SearchRequest['platform_source'];
  search: SearchBackendRequest;
  redactionPolicyVersion: string;
  queryHash: string;
  queryHashKeyVersion: string;
}>;

export type SearchOperationResult =
  | Readonly<{ ok: true; response: SearchResponse }>
  | Readonly<{
      ok: false;
      code:
        | 'VALIDATION'
        | 'FORBIDDEN'
        | 'POLICY_DENIED'
        | 'NOT_FOUND'
        | 'CONFLICT'
        | 'SOURCE_GATE_NOT_READY'
        | 'OVERLOADED'
        | 'INTERNAL';
    }>;

export type SearchOperation = Readonly<{
  execute: (request: PreparedSearchOperation) => Promise<SearchOperationResult>;
}>;

export type SearchRouteDependencies = Readonly<{
  operation: SearchOperation;
  logHash: Readonly<{ version: string; key: string }>;
}>;

export function createUnavailableSearchOperation(): SearchOperation {
  return Object.freeze({
    execute: async () => Object.freeze({ ok: false, code: 'OVERLOADED' as const }),
  });
}

function isSupportedTopK(value: number): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3;
}

function sendOperationFailure(reply: FastifyReply, result: Exclude<SearchOperationResult, { ok: true }>) {
  if (result.code === 'VALIDATION') return sendValidationError(reply);
  if (result.code === 'FORBIDDEN' || result.code === 'POLICY_DENIED') {
    return sendForbiddenOrPolicyDenied(reply, result.code);
  }
  if (result.code === 'NOT_FOUND') return sendNotFound(reply);
  if (result.code === 'CONFLICT') return sendConflict(reply);
  if (result.code === 'SOURCE_GATE_NOT_READY') return sendSourceGateNotReady(reply);
  if (result.code === 'OVERLOADED') return sendOverloaded(reply);
  return sendInternalError(reply);
}

export function registerSearchRoute(
  app: FastifyInstance,
  authService: AuthService,
  dependencies?: SearchRouteDependencies,
): void {
  app.post('/v1/search', async (request, reply) => {
    const actor = authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);

    const rawQueryText = request.body !== null && typeof request.body === 'object'
      ? Reflect.get(request.body, 'query_text')
      : undefined;
    if (typeof rawQueryText !== 'string' || !validateSearchTextBoundary(rawQueryText).ok) {
      return sendValidationError(reply);
    }
    const contract = validateContractSchema('SearchRequest', request.body);
    if (!contract.ok) return sendValidationError(reply);
    if (contract.value.platform !== 'qianniu' && contract.value.platform !== 'douyin') {
      return sendValidationError(reply);
    }
    if (!isSupportedTopK(contract.value.top_k)) return sendValidationError(reply);
    if (contract.value.platform_source === 'native_integration') {
      return sendForbiddenOrPolicyDenied(reply, 'POLICY_DENIED');
    }
    if (dependencies === undefined) return sendOverloaded(reply);

    const redacted = redactQueryText(contract.value.query_text);
    const prepared = Object.freeze({
      actor,
      queryId: contract.value.query_id,
      parentQueryId: contract.value.parent_query_id,
      interactionReason: contract.value.interaction_reason,
      collectionMode: contract.value.collection_mode,
      detectedPlatform: contract.value.detected_platform,
      platformSource: contract.value.platform_source,
      search: Object.freeze({
        normalizedQuery: normalizeSearchText(redacted.text),
        platform: contract.value.platform,
        productContextType: contract.value.product_context_type,
        productContextRef: contract.value.product_context_ref,
        topK: contract.value.top_k,
      }),
      redactionPolicyVersion: redacted.policyVersion,
      queryHash: hmacRedactedQuery(
        redacted.text,
        dependencies.logHash.version,
        dependencies.logHash.key,
      ),
      queryHashKeyVersion: dependencies.logHash.version,
    }) satisfies PreparedSearchOperation;
    const result = await dependencies.operation.execute(prepared);
    if (!result.ok) return sendOperationFailure(reply, result);

    reply.header('cache-control', 'no-store');
    return parseContractSchema('SearchResponse', {
      query_id: result.response.query_id,
      hit_status: result.response.hit_status,
      release_id: result.response.release_id,
      source_binding_hash: result.response.source_binding_hash,
      telemetry_status: result.response.telemetry_status,
      candidates: result.response.candidates.map((candidate) => ({
        rank: candidate.rank,
        release_id: candidate.release_id,
        script_id: candidate.script_id,
        script_version: candidate.script_version,
        content_hash: candidate.content_hash,
        title: candidate.title,
        category: candidate.category,
        answer_text: candidate.answer_text,
        platform_scope: [...candidate.platform_scope],
        product_scope_type: candidate.product_scope_type,
        product_scope_refs: [...candidate.product_scope_refs],
        effective_from: candidate.effective_from,
        effective_to: candidate.effective_to,
        intent_taxonomy_version: candidate.intent_taxonomy_version,
        intent_id: candidate.intent_id,
        risk_level: candidate.risk_level,
        risk_categories: [...candidate.risk_categories],
        has_conflict: candidate.has_conflict,
        placeholder_keys: [...candidate.placeholder_keys],
      })),
    });
  });
}
