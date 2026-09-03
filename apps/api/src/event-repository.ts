import { randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { AuthenticatedUser } from './auth-service.js';
import { mapDatabaseContractError } from './database-contract-errors.js';
import type { PreparedIdempotencyHashes } from './idempotency.js';
import type { OperationResult } from './operation-result.js';
import {
  createApiRuntimeDiagnostic,
  type ApiRuntimeDiagnosticSink,
} from './runtime-diagnostics.js';
import { createSearchRepository } from './search-repository.js';
import { createSearchBackend } from './search-service.js';
import type { PreparedSearchOperation } from './search-routes.js';

type SearchResponse = components['schemas']['SearchResponse'];
type AdoptionEventRequest = components['schemas']['AdoptionEventRequest'];
type AdoptionEventResponse = components['schemas']['AdoptionEventResponse'];
type EscalationRequest = components['schemas']['EscalationRequest'];
type EscalationResponse = components['schemas']['EscalationResponse'];

export type PreparedAdoptionOperation = Readonly<{
  actor: AuthenticatedUser;
  idempotencyKey: string;
  requestHashes: PreparedIdempotencyHashes;
  event: AdoptionEventRequest;
}>;

export type PreparedEscalationOperation = Readonly<{
  actor: AuthenticatedUser;
  idempotencyKey: string;
  requestHashes: PreparedIdempotencyHashes;
  event: EscalationRequest;
}>;

export type EventRepository = Readonly<{
  executeSearch: (request: PreparedSearchOperation) => Promise<OperationResult<SearchResponse>>;
  recordAdoption: (
    request: PreparedAdoptionOperation,
  ) => Promise<OperationResult<AdoptionEventResponse>>;
  recordEscalation: (
    request: PreparedEscalationOperation,
  ) => Promise<OperationResult<EscalationResponse>>;
}>;

type EventPool = Pick<Pool, 'connect'>;

interface IdempotencyRow extends QueryResultRow {
  action: 'miss' | 'proceed' | 'replay' | 'conflict';
  status_code: number | null;
  response_body: unknown;
  detail: string;
  lease_version?: string | number;
}

type ClaimedIdempotency =
  | Readonly<{ action: 'proceed'; leaseVersion: string | number; requestHash: string; version: string }>
  | Readonly<{ action: 'replay'; responseBody: unknown }>
  | Readonly<{ action: 'conflict' }>
  | Readonly<{ action: 'failure'; code: 'INTERNAL' | 'OVERLOADED' }>;

const SEARCH_SCOPE = '/v1/search';
const ADOPTION_SCOPE = '/v1/events/adoption';
const ESCALATION_SCOPE = '/v1/events/escalate';
const IDEMPOTENCY_LEASE_SECONDS = 60;

function failure(code: Exclude<OperationResult<never>, { ok: true }>['code']) {
  return Object.freeze({ ok: false as const, code });
}

function isSourceGateFailure(error: unknown): boolean {
  return error !== null && typeof error === 'object'
    && (Reflect.get(error, 'code') === 'ZA004'
      || Reflect.get(error, 'detail') === 'SOURCE_GATE_NOT_READY');
}

function isTelemetryOnlyFailure(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = Reflect.get(error, 'code');
  return code === '42501'
    || (typeof code === 'string' && (
      code.startsWith('08')
      || code === '40001'
      || code === '40P01'
      || code === '53300'
      || code === '53400'
      || code === '55P03'
      || code === '57014'
      || code === '57P01'
      || code === '57P02'
      || code === '57P03'
    ));
}

async function rollback(client: PoolClient): Promise<boolean> {
  try {
    await client.query('ROLLBACK');
    return true;
  } catch {
    return false;
  }
}

function replayResponse<T extends 'SearchResponse' | 'AdoptionEventResponse' | 'EscalationResponse'>(
  schema: T,
  responseBody: unknown,
): components['schemas'][T] | null {
  try {
    return parseContractSchema(schema, responseBody);
  } catch {
    return null;
  }
}

async function claimIdempotency(
  client: PoolClient,
  scope: string,
  key: string,
  userId: string,
  hashes: PreparedIdempotencyHashes,
  leaseOwner: string,
): Promise<ClaimedIdempotency> {
  const versionResult = await client.query<{ version: string | null }>(
    'SELECT public.idempotency_request_hash_version($1, $2, $3) AS version',
    [scope, key, userId],
  );
  const version = versionResult.rows[0]?.version ?? hashes.currentVersion;
  const requestHash = hashes.hashes[version];
  if (requestHash === undefined) return Object.freeze({ action: 'failure', code: 'INTERNAL' });

  const lookup = await client.query<IdempotencyRow>(
    'SELECT * FROM public.idempotency_lookup($1, $2, $3, $4, $5)',
    [scope, key, userId, requestHash, version],
  );
  const lookupRow = lookup.rows[0];
  if (lookupRow?.action === 'replay') {
    return Object.freeze({ action: 'replay', responseBody: lookupRow.response_body });
  }
  if (lookupRow?.action === 'conflict') return Object.freeze({ action: 'conflict' });

  const claimed = await client.query<IdempotencyRow>(
    'SELECT * FROM public.idempotency_claim($1, $2, $3, $4, $5, $6, $7)',
    [scope, key, userId, requestHash, version, leaseOwner, IDEMPOTENCY_LEASE_SECONDS],
  );
  const row = claimed.rows[0];
  if (row?.action === 'replay') {
    return Object.freeze({ action: 'replay', responseBody: row.response_body });
  }
  if (row?.action === 'conflict') return Object.freeze({ action: 'conflict' });
  if (row?.action !== 'proceed' || row.lease_version === undefined) {
    return Object.freeze({ action: 'failure', code: 'INTERNAL' });
  }
  return Object.freeze({
    action: 'proceed',
    leaseVersion: row.lease_version,
    requestHash,
    version,
  });
}

async function completeIdempotency(
  client: PoolClient,
  scope: string,
  key: string,
  leaseOwner: string,
  leaseVersion: string | number,
  response: unknown,
): Promise<void> {
  await client.query(
    'SELECT public.idempotency_complete($1, $2, $3, $4, 200, $5::jsonb, TRUE)',
    [scope, key, leaseOwner, leaseVersion, JSON.stringify(response)],
  );
}

async function readQueryOwnership(
  client: PoolClient,
  queryId: string,
  userId: string,
): Promise<'owned' | 'missing' | 'forbidden'> {
  const result = await client.query<{ user_id: string }>(
    'SELECT user_id FROM public.query_events WHERE query_id = $1',
    [queryId],
  );
  const row = result.rows[0];
  if (!row) return 'missing';
  return row.user_id === userId ? 'owned' : 'forbidden';
}

export function createEventRepository(
  pool: EventPool,
  leaseOwner = `api_${randomUUID().replaceAll('-', '')}`,
  diagnosticSink: ApiRuntimeDiagnosticSink = () => undefined,
): EventRepository {
  function reportFailure(error: unknown): void {
    try {
      diagnosticSink(createApiRuntimeDiagnostic('EVENT_TRANSACTION_FAILED', error));
    } catch {
      // Diagnostics are observational and never replace the stable operation result.
    }
  }

  async function recordSourceDenial(request: PreparedSearchOperation): Promise<void> {
    const auditClient = await pool.connect();
    let releaseAsBroken = false;
    try {
      await auditClient.query('BEGIN');
      await auditClient.query(
        `SELECT public.record_runtime_source_denial_audit(
          $1, 'search', 'SOURCE_GATE_NOT_READY', $2, $3, $4, NULL, NULL, NULL, $5
        )`,
        [
          request.sourceDenial.denialKey,
          request.sourceDenial.actorSubjectHash,
          request.sourceDenial.hashKeyVersion,
          request.actor.role,
          request.sourceDenial.diagnosticId,
        ],
      );
      await auditClient.query('COMMIT');
    } catch (error) {
      releaseAsBroken = !(await rollback(auditClient));
      throw error;
    } finally {
      auditClient.release(releaseAsBroken);
    }
  }

  return Object.freeze({
    async executeSearch(request): Promise<OperationResult<SearchResponse>> {
      if (request.collectionMode !== 'synthetic') return failure('POLICY_DENIED');
      const client = await pool.connect().catch(() => null);
      if (client === null) return failure('OVERLOADED');
      let searchResponse: SearchResponse | null = null;
      let sourceDenied = false;
      let allowStatelessFallback = false;
      let releaseAsBroken = false;
      try {
        await client.query('BEGIN');
        const claim = await claimIdempotency(
          client,
          SEARCH_SCOPE,
          request.queryId,
          request.actor.user_id,
          request.requestHashes,
          leaseOwner,
        );
        if (claim.action === 'replay') {
          const response = replayResponse('SearchResponse', claim.responseBody);
          await client.query('COMMIT');
          return response === null ? failure('INTERNAL') : Object.freeze({ ok: true, response });
        }
        if (claim.action === 'conflict') {
          releaseAsBroken = !(await rollback(client));
          return failure('CONFLICT');
        }
        if (claim.action === 'failure') {
          releaseAsBroken = !(await rollback(client));
          return failure(claim.code);
        }

        const startedAt = performance.now();
        const backend = createSearchBackend({
          searchCandidates: createSearchRepository(client).search,
        });
        const search = await backend.search(request.search);
        if (!search.ok) {
          releaseAsBroken = !(await rollback(client));
          if (search.code === 'SOURCE_GATE_NOT_READY') {
            sourceDenied = true;
          } else {
            return failure(search.code);
          }
        } else {
          searchResponse = parseContractSchema('SearchResponse', {
            query_id: request.queryId,
            hit_status: search.candidates.length === 0 ? 'no_hit' : 'hit',
            release_id: search.releaseId,
            source_binding_hash: search.sourceBindingHash,
            telemetry_status: 'recorded',
            candidates: [...search.candidates],
          });
          allowStatelessFallback = true;
          await client.query(
            `INSERT INTO public.query_events(
              query_id, user_id, parent_query_id, interaction_reason,
              request_hash, request_hash_key_version,
              query_text_redacted, query_text_hash, hash_key_version, text_storage_status,
              collection_mode, detected_platform, platform, platform_source,
              product_context_type, product_context_ref_hash, product_context_hash_key_version,
              redaction_policy_version, hit_status, latency_ms, release_id,
              text_expires_at, event_expires_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6,
              NULL, NULL, $7, 'suppressed',
              $8, $9, $10, $11,
              $12, $13, $14,
              $15, $16, $17, $18,
              NULL, NULL
            )`,
            [
              request.queryId,
              request.actor.user_id,
              request.parentQueryId,
              request.interactionReason,
              claim.requestHash,
              claim.version,
              request.queryHashKeyVersion,
              request.collectionMode,
              request.detectedPlatform,
              request.search.platform,
              request.platformSource,
              request.search.productContextType,
              request.productContextRefHash,
              request.search.productContextRef === null ? null : request.queryHashKeyVersion,
              request.redactionPolicyVersion,
              search.candidates.length === 0 ? 'no_hit' : 'hit',
              Math.max(0, Math.round(performance.now() - startedAt)),
              search.releaseId,
            ],
          );
          for (const candidate of search.candidates) {
            await client.query(
              `INSERT INTO public.candidate_impressions(
                query_id, rank, release_id, script_id, script_version, content_hash, score
              ) VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
              [
                request.queryId,
                candidate.rank,
                candidate.release_id,
                candidate.script_id,
                candidate.script_version,
                candidate.content_hash,
              ],
            );
          }
          await completeIdempotency(
            client,
            SEARCH_SCOPE,
            request.queryId,
            leaseOwner,
            claim.leaseVersion,
            searchResponse,
          );
          // From this point a transport error can mean COMMIT succeeded on the
          // server. Never describe that ambiguous outcome as a zero-write result.
          allowStatelessFallback = false;
          await client.query('COMMIT');
          return Object.freeze({ ok: true, response: searchResponse });
        }
      } catch (error: unknown) {
        releaseAsBroken = !(await rollback(client));
        if (isSourceGateFailure(error)) {
          sourceDenied = true;
        } else if (searchResponse !== null && allowStatelessFallback && isTelemetryOnlyFailure(error)) {
          return Object.freeze({
            ok: true,
            response: parseContractSchema('SearchResponse', {
              ...searchResponse,
              telemetry_status: 'collection_disabled',
            }),
          });
        } else {
          const code = mapDatabaseContractError(error);
          if (code === 'INTERNAL') reportFailure(error);
          return failure(code);
        }
      } finally {
        client.release(releaseAsBroken);
      }
      if (sourceDenied) {
        await recordSourceDenial(request).catch((error: unknown) => {
          try {
            diagnosticSink(createApiRuntimeDiagnostic('SOURCE_DENIAL_AUDIT_FAILED', error));
          } catch {
            // Reporting remains observational; source rejection is still fail-closed.
          }
        });
        return failure('SOURCE_GATE_NOT_READY');
      }
      return failure('INTERNAL');
    },

    async recordAdoption(request): Promise<OperationResult<AdoptionEventResponse>> {
      const client = await pool.connect().catch(() => null);
      if (client === null) return failure('OVERLOADED');
      let releaseAsBroken = false;
      try {
        await client.query('BEGIN');
        const claim = await claimIdempotency(
          client,
          ADOPTION_SCOPE,
          request.idempotencyKey,
          request.actor.user_id,
          request.requestHashes,
          leaseOwner,
        );
        if (claim.action === 'replay') {
          const response = replayResponse('AdoptionEventResponse', claim.responseBody);
          await client.query('COMMIT');
          return response === null ? failure('INTERNAL') : Object.freeze({ ok: true, response });
        }
        if (claim.action === 'conflict') {
          releaseAsBroken = !(await rollback(client));
          return failure('CONFLICT');
        }
        if (claim.action === 'failure') {
          releaseAsBroken = !(await rollback(client));
          return failure(claim.code);
        }
        const ownership = await readQueryOwnership(client, request.event.query_id, request.actor.user_id);
        if (ownership !== 'owned') {
          releaseAsBroken = !(await rollback(client));
          return failure(ownership === 'missing' ? 'NOT_FOUND' : 'FORBIDDEN');
        }
        const terminal = await client.query(
          'SELECT 1 FROM public.adoption_events WHERE query_id = $1',
          [request.event.query_id],
        );
        if (terminal.rowCount !== 0) {
          releaseAsBroken = !(await rollback(client));
          return failure('CONFLICT');
        }
        if (request.event.outcome === 'adopted') {
          const candidate = await client.query(
            `SELECT 1 FROM public.candidate_impressions
             WHERE query_id = $1 AND rank = $2 AND script_id = $3`,
            [request.event.query_id, request.event.chosen_rank, request.event.chosen_script_id],
          );
          if (candidate.rowCount === 0) {
            releaseAsBroken = !(await rollback(client));
            return failure('NOT_FOUND');
          }
        }
        await client.query(
          `INSERT INTO public.adoption_events(
            query_id, user_id, outcome, chosen_rank, chosen_script_id, push_method
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            request.event.query_id,
            request.actor.user_id,
            request.event.outcome,
            request.event.chosen_rank,
            request.event.chosen_script_id,
            request.event.push_method,
          ],
        );
        const response = parseContractSchema('AdoptionEventResponse', {
          ok: true,
          query_id: request.event.query_id,
        });
        await completeIdempotency(
          client,
          ADOPTION_SCOPE,
          request.idempotencyKey,
          leaseOwner,
          claim.leaseVersion,
          response,
        );
        await client.query('COMMIT');
        return Object.freeze({ ok: true, response });
      } catch (error: unknown) {
        releaseAsBroken = !(await rollback(client));
        const code = mapDatabaseContractError(error);
        if (code === 'INTERNAL') reportFailure(error);
        return failure(code);
      } finally {
        client.release(releaseAsBroken);
      }
    },

    async recordEscalation(request): Promise<OperationResult<EscalationResponse>> {
      const client = await pool.connect().catch(() => null);
      if (client === null) return failure('OVERLOADED');
      let releaseAsBroken = false;
      try {
        await client.query('BEGIN');
        const claim = await claimIdempotency(
          client,
          ESCALATION_SCOPE,
          request.idempotencyKey,
          request.actor.user_id,
          request.requestHashes,
          leaseOwner,
        );
        if (claim.action === 'replay') {
          const response = replayResponse('EscalationResponse', claim.responseBody);
          await client.query('COMMIT');
          return response === null ? failure('INTERNAL') : Object.freeze({ ok: true, response });
        }
        if (claim.action === 'conflict') {
          releaseAsBroken = !(await rollback(client));
          return failure('CONFLICT');
        }
        if (claim.action === 'failure') {
          releaseAsBroken = !(await rollback(client));
          return failure(claim.code);
        }
        const ownership = await readQueryOwnership(client, request.event.query_id, request.actor.user_id);
        if (ownership !== 'owned') {
          releaseAsBroken = !(await rollback(client));
          return failure(ownership === 'missing' ? 'NOT_FOUND' : 'FORBIDDEN');
        }
        const escalateId = `esc_${randomUUID().replaceAll('-', '')}`;
        const inserted = await client.query<{ escalate_id: string }>(
          `INSERT INTO public.escalate_actions(escalate_id, query_id, action, user_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (query_id, action) DO NOTHING
           RETURNING escalate_id`,
          [escalateId, request.event.query_id, request.event.action, request.actor.user_id],
        );
        const existing = inserted.rows[0]?.escalate_id === undefined
          ? await client.query<{ escalate_id: string; user_id: string }>(
            `SELECT escalate_id, user_id FROM public.escalate_actions
             WHERE query_id = $1 AND action = $2`,
            [request.event.query_id, request.event.action],
          )
          : null;
        if (existing?.rows[0] !== undefined
          && existing.rows[0].user_id !== request.actor.user_id) {
          releaseAsBroken = !(await rollback(client));
          return failure('INTERNAL');
        }
        const stableEscalateId = inserted.rows[0]?.escalate_id ?? existing?.rows[0]?.escalate_id;
        if (stableEscalateId === undefined) {
          releaseAsBroken = !(await rollback(client));
          return failure('INTERNAL');
        }
        const response = parseContractSchema('EscalationResponse', {
          escalate_id: stableEscalateId,
          query_id: request.event.query_id,
          action: request.event.action,
        });
        await completeIdempotency(
          client,
          ESCALATION_SCOPE,
          request.idempotencyKey,
          leaseOwner,
          claim.leaseVersion,
          response,
        );
        await client.query('COMMIT');
        return Object.freeze({ ok: true, response });
      } catch (error: unknown) {
        releaseAsBroken = !(await rollback(client));
        const code = mapDatabaseContractError(error);
        if (code === 'INTERNAL') reportFailure(error);
        return failure(code);
      } finally {
        client.release(releaseAsBroken);
      }
    },
  });
}
