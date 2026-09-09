import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { AuthenticatedUser } from './auth-service.js';
import { mapDatabaseContractError } from './database-contract-errors.js';
import { hmacSafeValue, prepareIdempotencyHashes, type PreparedIdempotencyHashes } from './idempotency.js';
import type { OperationFailureCode } from './operation-result.js';
import {
  createApiRuntimeDiagnostic,
  type ApiRuntimeDiagnosticSink,
} from './runtime-diagnostics.js';
import type { ApiDatabaseBootstrapConfig, ApiHmacKeyRing } from './runtime-config.js';

type PublishRequest = components['schemas']['PublishRequest'];
type PublishResponse = components['schemas']['PublishResponse'];
type RollbackRequest = components['schemas']['RollbackRequest'];
type RollbackResponse = components['schemas']['RollbackResponse'];
type SourceContractReason = components['schemas']['SourceContractReason'];

export type CommitCertainty = 'committed' | 'rolled_back' | 'unknown';

export type ContentReleaseFailure = Readonly<{
  ok: false;
  code: OperationFailureCode;
  reason?: SourceContractReason;
  commit: CommitCertainty;
}>;

export type ContentReleaseService = Readonly<{
  publish: (request: Readonly<{
    actor: AuthenticatedUser;
    idempotencyKey: string;
    body: PublishRequest;
  }>) => Promise<Readonly<{ ok: true; response: PublishResponse }> | ContentReleaseFailure>;
  rollback: (request: Readonly<{
    actor: AuthenticatedUser;
    idempotencyKey: string;
    body: RollbackRequest;
  }>) => Promise<Readonly<{ ok: true; response: RollbackResponse }> | ContentReleaseFailure>;
  close: () => Promise<void>;
}>;

interface IdempotencyRow extends QueryResultRow {
  action: 'miss' | 'proceed' | 'replay' | 'conflict';
  response_body: unknown;
  lease_version?: string | number;
}

interface PublishRow extends QueryResultRow {
  release_id: string;
  release_seq: string | number;
  announcement_id: string;
  source_binding_hash: string;
}

interface RollbackRow extends PublishRow {
  rollback_of_release_id: string;
}

const PUBLISH_SCOPE = '/v1/content/publish';
const ROLLBACK_SCOPE = '/v1/content/rollback';
const IDEMPOTENCY_LEASE_SECONDS = 60;
const AUDITED = new Set<string>([
  'SOURCE_SET_INCOMPLETE',
  'SOURCE_BINDING_HASH_MISMATCH',
  'SOURCE_NOT_ELIGIBLE',
  'SOURCE_SUSPENDED',
  'SOURCE_BASE_RELEASE_STALE',
]);
const FORBIDDEN_REASONS = new Set<string>(['SOURCE_NOT_ELIGIBLE', 'SOURCE_SUSPENDED']);

function failure(
  code: OperationFailureCode,
  commit: CommitCertainty,
  reason?: SourceContractReason,
): ContentReleaseFailure {
  return Object.freeze(reason === undefined ? { ok: false, code, commit } : { ok: false, code, commit, reason });
}

async function rollbackTxn(client: PoolClient): Promise<boolean> {
  try {
    await client.query('ROLLBACK');
    return true;
  } catch {
    return false;
  }
}

function detailOf(error: unknown): string {
  if (error === null || typeof error !== 'object') return '';
  return String(Reflect.get(error, 'detail') ?? '');
}

function sqlState(error: unknown): string {
  if (error === null || typeof error !== 'object') return '';
  return String(Reflect.get(error, 'code') ?? '');
}

function releaseFailure(error: unknown, commit: CommitCertainty): ContentReleaseFailure {
  const detail = detailOf(error);
  if (FORBIDDEN_REASONS.has(detail) || sqlState(error) === 'ZA004') {
    return failure('FORBIDDEN', commit, AUDITED.has(detail) ? detail as SourceContractReason : undefined);
  }
  if (detail === 'SOURCE_BASE_RELEASE_STALE' || detail === 'SOURCE_BINDING_HASH_MISMATCH') {
    return failure('CONFLICT', commit, detail);
  }
  if (AUDITED.has(detail) || detail === 'GOVERNANCE_HASH_MISMATCH' || detail === 'QUALITY_GATE_NOT_PASSED') {
    return failure('VALIDATION', commit, detail as SourceContractReason);
  }
  return failure(mapDatabaseContractError(error), commit);
}

async function claimIdempotency(
  client: PoolClient,
  scope: string,
  key: string,
  userId: string,
  hashes: PreparedIdempotencyHashes,
  leaseOwner: string,
): Promise<
  | Readonly<{ action: 'proceed'; leaseVersion: string | number }>
  | Readonly<{ action: 'replay'; responseBody: unknown }>
  | Readonly<{ action: 'conflict' }>
  | Readonly<{ action: 'failure'; code: 'INTERNAL' | 'OVERLOADED' }>
> {
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
  if (lookup.rows[0]?.action === 'replay') {
    return Object.freeze({ action: 'replay', responseBody: lookup.rows[0].response_body });
  }
  if (lookup.rows[0]?.action === 'conflict') return Object.freeze({ action: 'conflict' });
  const claimed = await client.query<IdempotencyRow>(
    'SELECT * FROM public.idempotency_claim($1, $2, $3, $4, $5, $6, $7)',
    [scope, key, userId, requestHash, version, leaseOwner, IDEMPOTENCY_LEASE_SECONDS],
  );
  const row = claimed.rows[0];
  if (row?.action === 'replay') return Object.freeze({ action: 'replay', responseBody: row.response_body });
  if (row?.action === 'conflict') return Object.freeze({ action: 'conflict' });
  if (row?.action !== 'proceed' || row.lease_version === undefined) {
    return Object.freeze({ action: 'failure', code: 'INTERNAL' });
  }
  return Object.freeze({ action: 'proceed', leaseVersion: row.lease_version });
}

export function createContentReleaseServiceForPool(
  pool: Pick<Pool, 'connect' | 'end'>,
  idempotencyHmac: ApiHmacKeyRing,
  logHash: Readonly<{ version: string; key: string }>,
  ownsPool: boolean,
  diagnosticSink: ApiRuntimeDiagnosticSink = () => undefined,
): ContentReleaseService {
  const leaseOwner = `api_${randomUUID().replaceAll('-', '')}`;

  function report(error: unknown): void {
    try {
      diagnosticSink(createApiRuntimeDiagnostic('CONTENT_RELEASE_FAILED', error));
    } catch {
      // Observational.
    }
  }

  async function withAdmin<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const admission = await client.query<{ allowed: boolean }>(`SELECT
        login.rolcanlogin AND NOT login.rolsuper
        AND NOT capability.rolcanlogin AND pg_has_role(login.oid, capability.oid, 'MEMBER')
        AS allowed FROM pg_roles login CROSS JOIN pg_roles capability
        WHERE login.rolname=current_user AND capability.rolname='app_content_admin'`);
      if (admission.rows[0]?.allowed !== true) throw new Error('ADMIN_ROLE_INVALID');
      await client.query('SET LOCAL ROLE app_content_admin');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      const rolledBack = await rollbackTxn(client);
      broken = !rolledBack;
      throw error;
    } finally {
      client.release(broken);
    }
  }

  async function recordDenial(
    operation: 'content_publish' | 'content_rollback',
    actor: AuthenticatedUser,
    reason: SourceContractReason,
    key: string,
  ): Promise<boolean> {
    const actorSubjectHash = hmacSafeValue(`actor:${actor.user_id}`, logHash.version, logHash.key);
    const denialDigest = hmacSafeValue(`source-denial:${operation}:${actor.user_id}:${key}`, logHash.version, logHash.key);
    const diagnosticDigest = hmacSafeValue(`diagnostic:${operation}:${actor.user_id}:${key}`, logHash.version, logHash.key);
    try {
      await withAdmin(async (client) => {
        await client.query(
          `SELECT public.record_admin_source_denial_audit($1,$2,$3,$4,$5,$6,NULL,NULL,NULL,$7)`,
          [
            `sda_${denialDigest}`, operation, reason, actorSubjectHash, logHash.version, actor.role,
            `diag_${diagnosticDigest.slice(0, 32)}`,
          ],
        );
      });
      return true;
    } catch (error) {
      report(error);
      return false;
    }
  }

  async function run(
    scope: string,
    actor: AuthenticatedUser,
    idempotencyKey: string,
    hashes: PreparedIdempotencyHashes,
    execute: (client: PoolClient) => Promise<unknown>,
    parse: (row: unknown) => unknown,
  ): Promise<Readonly<{ ok: true; response: unknown }> | ContentReleaseFailure> {
    if (actor.role !== 'owner') return failure('FORBIDDEN', 'rolled_back');
    const client = await pool.connect().catch(() => null);
    if (client === null) return failure('OVERLOADED', 'rolled_back');
    let broken = false;
    let denied: SourceContractReason | undefined;
    try {
      await client.query('BEGIN');
      const admission = await client.query<{ allowed: boolean }>(`SELECT
        login.rolcanlogin AND NOT login.rolsuper
        AND NOT capability.rolcanlogin AND pg_has_role(login.oid, capability.oid, 'MEMBER')
        AS allowed FROM pg_roles login CROSS JOIN pg_roles capability
        WHERE login.rolname=current_user AND capability.rolname='app_content_admin'`);
      if (admission.rows[0]?.allowed !== true) {
        await rollbackTxn(client);
        return failure('FORBIDDEN', 'rolled_back');
      }
      await client.query('SET LOCAL ROLE app_content_admin');
      // content_releases has a deferred set-complete trigger that runs at
      // COMMIT as this role, so the admin login must be able to read the
      // release-set tables. Frozen EXECUTE-only ACL is not sufficient.
      const claim = await claimIdempotency(client, scope, idempotencyKey, actor.user_id, hashes, leaseOwner);
      if (claim.action === 'replay') {
        await client.query('COMMIT');
        return Object.freeze({ ok: true, response: parse(claim.responseBody) });
      }
      if (claim.action === 'conflict') {
        const rolledBack = await rollbackTxn(client);
        broken = !rolledBack;
        return failure('CONFLICT', rolledBack ? 'rolled_back' : 'unknown');
      }
      if (claim.action === 'failure') {
        const rolledBack = await rollbackTxn(client);
        broken = !rolledBack;
        return failure(claim.code, rolledBack ? 'rolled_back' : 'unknown');
      }
      const row = await execute(client);
      const response = parse(row);
      await client.query(
        'SELECT public.idempotency_complete($1,$2,$3,$4,200,$5::jsonb,TRUE)',
        [scope, idempotencyKey, leaseOwner, claim.leaseVersion, JSON.stringify(response)],
      );
      try {
        await client.query('COMMIT');
      } catch (error) {
        broken = true;
        report(error);
        return failure(mapDatabaseContractError(error) === 'FORBIDDEN' ? 'FORBIDDEN' : 'OVERLOADED', 'unknown');
      }
      return Object.freeze({ ok: true, response });
    } catch (error: unknown) {
      const rolledBack = await rollbackTxn(client);
      broken = !rolledBack;
      const mapped = releaseFailure(error, rolledBack ? 'rolled_back' : 'unknown');
      if (mapped.reason && AUDITED.has(mapped.reason)) denied = mapped.reason;
      else if (mapped.code === 'INTERNAL') report(error);
      if (!denied) return mapped;
      if (!rolledBack) return failure('OVERLOADED', 'unknown');
    } finally {
      client.release(broken);
    }
    if (denied === undefined) return failure('INTERNAL', 'unknown');
    const audited = await recordDenial(scope === PUBLISH_SCOPE ? 'content_publish' : 'content_rollback', actor, denied, idempotencyKey);
    if (!audited) return failure('OVERLOADED', 'rolled_back');
    return failure(FORBIDDEN_REASONS.has(denied) ? 'FORBIDDEN' : denied === 'SOURCE_BASE_RELEASE_STALE' || denied === 'SOURCE_BINDING_HASH_MISMATCH' ? 'CONFLICT' : 'VALIDATION', 'rolled_back', denied);
  }

  return Object.freeze({
    async publish(request) {
      const hashes = prepareIdempotencyHashes({
        import_batch_id: request.body.import_batch_id,
        title: request.body.title,
        summary: request.body.summary,
      }, idempotencyHmac);
      const result = await run(PUBLISH_SCOPE, request.actor, request.idempotencyKey, hashes, async (client) => {
        const rows = await client.query<PublishRow>(
          'SELECT * FROM public.publish_content_release($1,$2,$3,$4,$5)',
          [request.body.import_batch_id, request.body.title, request.body.summary, request.actor.user_id, request.actor.role],
        );
        return rows.rows[0];
      }, (row) => {
        const value = row as PublishRow;
        return parseContractSchema('PublishResponse', {
          release_id: value.release_id,
          release_seq: Number(value.release_seq),
          announcement_id: value.announcement_id,
          source_binding_hash: value.source_binding_hash,
        });
      });
      return result as Readonly<{ ok: true; response: PublishResponse }> | ContentReleaseFailure;
    },
    async rollback(request) {
      const hashes = prepareIdempotencyHashes({
        target_release_id: request.body.target_release_id,
        title: request.body.title,
        summary: request.body.summary,
      }, idempotencyHmac);
      const result = await run(ROLLBACK_SCOPE, request.actor, request.idempotencyKey, hashes, async (client) => {
        const rows = await client.query<RollbackRow>(
          'SELECT * FROM public.rollback_content_release($1,$2,$3,$4,$5)',
          [request.body.target_release_id, request.body.title, request.body.summary, request.actor.user_id, request.actor.role],
        );
        return rows.rows[0];
      }, (row) => {
        const value = row as RollbackRow;
        return parseContractSchema('RollbackResponse', {
          release_id: value.release_id,
          release_seq: Number(value.release_seq),
          announcement_id: value.announcement_id,
          source_binding_hash: value.source_binding_hash,
          rollback_of_release_id: value.rollback_of_release_id,
        });
      });
      return result as Readonly<{ ok: true; response: RollbackResponse }> | ContentReleaseFailure;
    },
    close: () => ownsPool ? pool.end() : Promise.resolve(),
  });
}

export function createContentReleaseService(
  config: ApiDatabaseBootstrapConfig,
  idempotencyHmac: ApiHmacKeyRing,
  logHash: Readonly<{ version: string; key: string }>,
): ContentReleaseService {
  return createContentReleaseServiceForPool(new Pool({
    connectionString: config.connectionString,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    statement_timeout: 30_000,
    query_timeout: 30_000,
    idle_in_transaction_session_timeout: 10_000,
    application_name: 'cs-ai-synthetic-content-release',
    maxLifetimeSeconds: 300,
  }), idempotencyHmac, logHash, true);
}
