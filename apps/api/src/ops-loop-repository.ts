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

type InaccuracyReportResponse = components['schemas']['InaccuracyReportResponse'];
type SopCatalogResponse = components['schemas']['SopCatalogResponse'];
type SopNode = components['schemas']['SopNode'];
type SopImportAccepted = components['schemas']['SopImportAccepted'];
type ScriptMutationResponse = components['schemas']['ScriptMutationResponse'];
type RetrievalMetrics = components['schemas']['RetrievalMetrics'];
type RetrievalWindow = components['schemas']['RetrievalWindow'];
type SoftwareRelease = components['schemas']['SoftwareRelease'];
type SoftwareReleaseList = components['schemas']['SoftwareReleaseList'];

export const OPS_LOOP_PRODUCT_SESSION_ID = 'default';

export type PreparedInaccuracyReport = Readonly<{
  actor: AuthenticatedUser;
  queryId: string;
  scriptId: string;
  scriptVersion: number | null;
  rank: number | null;
  contentHash: string | null;
  idempotencyKey: string;
  requestHashes: PreparedIdempotencyHashes;
}>;

export type PreparedSopImport = Readonly<{
  actor: AuthenticatedUser;
  nodes: readonly Readonly<{
    node_id: string;
    parent_node_id: string | null;
    title: string;
    body: string;
    sort_key: number;
  }>[];
  idempotencyKey: string;
  requestHashes: PreparedIdempotencyHashes;
}>;

export type PreparedSopPatch = Readonly<{
  actor: AuthenticatedUser;
  nodeId: string;
  expectedVersion: number;
  title: string | null;
  body: string | null;
  sortKey: number | null;
  idempotencyKey: string;
  requestHashes: PreparedIdempotencyHashes;
}>;

export type PreparedSopDelete = Readonly<{
  actor: AuthenticatedUser;
  nodeId: string;
  expectedVersion: number;
  idempotencyKey: string;
  requestHashes: PreparedIdempotencyHashes;
}>;

export type PreparedScriptMutation = Readonly<{
  actor: AuthenticatedUser;
  scriptId: string;
  action: 'patch' | 'delete';
  expectedVersion: number;
  title: string | null;
  answerText: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  idempotencyKey: string;
  requestHashes: PreparedIdempotencyHashes;
}>;

export type OpsLoopRepository = Readonly<{
  recordInaccuracy: (request: PreparedInaccuracyReport) => Promise<OperationResult<InaccuracyReportResponse>>;
  readSopCatalog: (actor: AuthenticatedUser) => Promise<OperationResult<SopCatalogResponse>>;
  importSopCatalog: (request: PreparedSopImport) => Promise<OperationResult<SopImportAccepted>>;
  patchSopNode: (request: PreparedSopPatch) => Promise<OperationResult<SopNode>>;
  deleteSopNode: (request: PreparedSopDelete) => Promise<OperationResult<SopNode>>;
  mutateScript: (request: PreparedScriptMutation) => Promise<OperationResult<ScriptMutationResponse>>;
  readRetrievalMetrics: (
    actor: AuthenticatedUser,
    window: RetrievalWindow,
  ) => Promise<OperationResult<RetrievalMetrics>>;
  listSoftwareReleases: (actor: AuthenticatedUser) => Promise<OperationResult<SoftwareReleaseList>>;
  currentSoftwareRelease: (actor: AuthenticatedUser) => Promise<OperationResult<SoftwareRelease>>;
}>;

type OpsPool = Pick<Pool, 'connect'>;

interface IdempotencyRow extends QueryResultRow {
  action: 'miss' | 'proceed' | 'replay' | 'conflict';
  status_code: number | null;
  response_body: unknown;
  detail: string;
  lease_version?: string | number;
}

type ClaimedIdempotency =
  | Readonly<{ action: 'proceed'; leaseVersion: string | number }>
  | Readonly<{ action: 'replay'; responseBody: unknown }>
  | Readonly<{ action: 'conflict' }>
  | Readonly<{ action: 'failure'; code: 'INTERNAL' | 'OVERLOADED' }>;

const INACCURACY_SCOPE = '/v1/inaccuracy-reports';
const SOP_IMPORT_SCOPE = '/v1/sop/import';
const SOP_PATCH_SCOPE = '/v1/sop/nodes/patch';
const SOP_DELETE_SCOPE = '/v1/sop/nodes/delete';
const SCRIPT_MUTATE_SCOPE = '/v1/content/scripts/mutate';
const IDEMPOTENCY_LEASE_SECONDS = 60;

function failure(code: Exclude<OperationResult<never>, { ok: true }>['code']) {
  return Object.freeze({ ok: false as const, code });
}

async function rollback(client: PoolClient): Promise<boolean> {
  try {
    await client.query('ROLLBACK');
    return true;
  } catch {
    return false;
  }
}

function asIso(value: Date | string): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.valueOf())) throw new Error('TIMESTAMP_INVALID');
  return timestamp.toISOString();
}

function toSopNode(row: QueryResultRow): SopNode {
  return parseContractSchema('SopNode', {
    node_id: row.node_id,
    parent_node_id: row.parent_node_id ?? null,
    title: row.title,
    body: row.body,
    sort_key: Number(row.sort_key),
    version: Number(row.version),
    lifecycle: row.lifecycle,
  });
}

function toSoftwareRelease(row: QueryResultRow): SoftwareRelease {
  return parseContractSchema('SoftwareRelease', {
    version: row.version,
    platform: row.platform,
    sha256: row.sha256,
    download_url: row.download_url,
    created_at: asIso(row.created_at as Date | string),
    signed: row.signed === true,
  });
}

function replaySchema<Name extends 'InaccuracyReportResponse' | 'SopImportAccepted' | 'SopNode' | 'ScriptMutationResponse'>(
  name: Name,
  responseBody: unknown,
): components['schemas'][Name] | null {
  try {
    return parseContractSchema(name, responseBody);
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
  return Object.freeze({ action: 'proceed', leaseVersion: row.lease_version });
}

async function completeIdempotency(
  client: PoolClient,
  scope: string,
  key: string,
  leaseOwner: string,
  leaseVersion: string | number,
  statusCode: number,
  response: unknown,
): Promise<void> {
  await client.query(
    'SELECT public.idempotency_complete($1, $2, $3, $4, $5, $6::jsonb, TRUE)',
    [scope, key, leaseOwner, leaseVersion, statusCode, JSON.stringify(response)],
  );
}

export function createOpsLoopRepository(
  pool: OpsPool,
  leaseOwner = `api_${randomUUID().replaceAll('-', '')}`,
  diagnosticSink: ApiRuntimeDiagnosticSink = () => undefined,
): OpsLoopRepository {
  function reportFailure(error: unknown): void {
    try {
      diagnosticSink(createApiRuntimeDiagnostic('OPS_LOOP_FAILED', error));
    } catch {
      // Diagnostics never replace the stable operation result.
    }
  }

  async function mutate<T>(
    scope: string,
    actorId: string,
    hashes: PreparedIdempotencyHashes,
    idempotencyKey: string,
    statusCode: number,
    replay: (body: unknown) => T | null,
    execute: (client: PoolClient) => Promise<T>,
  ): Promise<OperationResult<T>> {
    const client = await pool.connect().catch(() => null);
    if (client === null) return failure('OVERLOADED');
    let releaseAsBroken = false;
    try {
      await client.query('BEGIN');
      const claim = await claimIdempotency(client, scope, idempotencyKey, actorId, hashes, leaseOwner);
      if (claim.action === 'replay') {
        const response = replay(claim.responseBody);
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
      const response = await execute(client);
      await completeIdempotency(client, scope, idempotencyKey, leaseOwner, claim.leaseVersion, statusCode, response);
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
  }

  async function read<T>(execute: (client: PoolClient) => Promise<T>): Promise<OperationResult<T>> {
    const client = await pool.connect().catch(() => null);
    if (client === null) return failure('OVERLOADED');
    try {
      return Object.freeze({ ok: true, response: await execute(client) });
    } catch (error: unknown) {
      const code = mapDatabaseContractError(error);
      if (code === 'INTERNAL') reportFailure(error);
      return failure(code);
    } finally {
      client.release();
    }
  }

  return Object.freeze({
    recordInaccuracy(request) {
      return mutate(
        INACCURACY_SCOPE,
        request.actor.user_id,
        request.requestHashes,
        request.idempotencyKey,
        200,
        (body) => replaySchema('InaccuracyReportResponse', body),
        async (client) => {
          const result = await client.query(
            `SELECT ok, query_id, script_id
             FROM ops_loop.record_inaccuracy_report($1,$2,$3,$4,$5,$6,$7)`,
            [
              request.queryId,
              request.scriptId,
              request.scriptVersion,
              request.rank,
              request.contentHash,
              request.actor.user_id,
              request.actor.role,
            ],
          );
          const row = result.rows[0];
          if (!row) throw new Error('OPS_LOOP_SHAPE');
          return parseContractSchema('InaccuracyReportResponse', {
            ok: true,
            query_id: row.query_id,
            script_id: row.script_id,
          });
        },
      );
    },

    readSopCatalog(actor) {
      if (actor.role !== 'coach' && actor.role !== 'owner') return Promise.resolve(failure('FORBIDDEN'));
      return read(async (client) => {
        const result = await client.query(
          `SELECT node_id, parent_node_id, title, body, sort_key, version, lifecycle
           FROM ops_loop.read_sop_catalog($1, $2)`,
          [OPS_LOOP_PRODUCT_SESSION_ID, actor.role],
        );
        return parseContractSchema('SopCatalogResponse', {
          product_session_id: OPS_LOOP_PRODUCT_SESSION_ID,
          items: result.rows.map((row) => toSopNode(row)),
        });
      });
    },

    importSopCatalog(request) {
      if (request.actor.role !== 'coach' && request.actor.role !== 'owner') {
        return Promise.resolve(failure('FORBIDDEN'));
      }
      return mutate(
        SOP_IMPORT_SCOPE,
        request.actor.user_id,
        request.requestHashes,
        request.idempotencyKey,
        202,
        (body) => replaySchema('SopImportAccepted', body),
        async (client) => {
          const result = await client.query(
            `SELECT ok, product_session_id, node_count
             FROM ops_loop.import_sop_catalog($1, $2::jsonb, $3, $4)`,
            [
              OPS_LOOP_PRODUCT_SESSION_ID,
              JSON.stringify(request.nodes),
              request.actor.user_id,
              request.actor.role,
            ],
          );
          const row = result.rows[0];
          if (!row) throw new Error('OPS_LOOP_SHAPE');
          return parseContractSchema('SopImportAccepted', {
            ok: true,
            product_session_id: row.product_session_id,
            node_count: Number(row.node_count),
          });
        },
      );
    },

    patchSopNode(request) {
      if (request.actor.role !== 'coach' && request.actor.role !== 'owner') {
        return Promise.resolve(failure('FORBIDDEN'));
      }
      return mutate(
        SOP_PATCH_SCOPE,
        request.actor.user_id,
        request.requestHashes,
        request.idempotencyKey,
        200,
        (body) => replaySchema('SopNode', body),
        async (client) => {
          const result = await client.query(
            `SELECT node_id, parent_node_id, title, body, sort_key, version, lifecycle
             FROM ops_loop.patch_sop_node($1,$2,$3,$4,$5,$6)`,
            [
              request.nodeId,
              request.expectedVersion,
              request.title,
              request.body,
              request.sortKey,
              request.actor.role,
            ],
          );
          const row = result.rows[0];
          if (!row) throw new Error('OPS_LOOP_SHAPE');
          return toSopNode(row);
        },
      );
    },

    deleteSopNode(request) {
      if (request.actor.role !== 'owner') return Promise.resolve(failure('FORBIDDEN'));
      return mutate(
        SOP_DELETE_SCOPE,
        request.actor.user_id,
        request.requestHashes,
        request.idempotencyKey,
        200,
        (body) => replaySchema('SopNode', body),
        async (client) => {
          const result = await client.query(
            `SELECT node_id, parent_node_id, title, body, sort_key, version, lifecycle
             FROM ops_loop.delete_sop_node($1,$2,$3)`,
            [request.nodeId, request.expectedVersion, request.actor.role],
          );
          const row = result.rows[0];
          if (!row) throw new Error('OPS_LOOP_SHAPE');
          return toSopNode(row);
        },
      );
    },

    mutateScript(request) {
      if (request.actor.role !== 'owner') return Promise.resolve(failure('FORBIDDEN'));
      return mutate(
        SCRIPT_MUTATE_SCOPE,
        request.actor.user_id,
        request.requestHashes,
        request.idempotencyKey,
        200,
        (body) => replaySchema('ScriptMutationResponse', body),
        async (client) => {
          const result = await client.query(
            `SELECT ok, script_id, mutation_id, review_status
             FROM ops_loop.mutate_script($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              request.scriptId,
              request.action,
              request.expectedVersion,
              request.title,
              request.answerText,
              request.effectiveFrom,
              request.effectiveTo,
              request.actor.user_id,
              request.actor.role,
            ],
          );
          const row = result.rows[0];
          if (!row) throw new Error('OPS_LOOP_SHAPE');
          return parseContractSchema('ScriptMutationResponse', {
            ok: true,
            script_id: row.script_id,
            mutation_id: row.mutation_id,
            review_status: 'pending_review',
          });
        },
      );
    },

    readRetrievalMetrics(actor, window) {
      if (actor.role !== 'coach' && actor.role !== 'owner') return Promise.resolve(failure('FORBIDDEN'));
      return read(async (client) => {
        const result = await client.query(
          `SELECT no_hit_rate, copy_complete_rate, open_task_count,
                  current_release_script_count, metric_window, release_id
           FROM ops_loop.read_retrieval_metrics($1, $2)`,
          [window, actor.role],
        );
        const row = result.rows[0];
        if (!row) throw new Error('OPS_LOOP_SHAPE');
        return parseContractSchema('RetrievalMetrics', {
          no_hit_rate: Number(row.no_hit_rate),
          copy_complete_rate: Number(row.copy_complete_rate),
          open_task_count: Number(row.open_task_count),
          current_release_script_count: Number(row.current_release_script_count),
          window: row.metric_window,
          release_id: row.release_id ?? null,
        });
      });
    },

    listSoftwareReleases(actor) {
      if (actor.role !== 'owner') return Promise.resolve(failure('FORBIDDEN'));
      return read(async (client) => {
        const result = await client.query(
          `SELECT version, platform, sha256, download_url, created_at, signed
           FROM ops_loop.list_software_releases($1)`,
          [actor.role],
        );
        return parseContractSchema('SoftwareReleaseList', {
          items: result.rows.map((row) => toSoftwareRelease(row)),
        });
      });
    },

    currentSoftwareRelease(actor) {
      if (actor.role !== 'owner') return Promise.resolve(failure('FORBIDDEN'));
      return read(async (client) => {
        const result = await client.query(
          `SELECT version, platform, sha256, download_url, created_at, signed
           FROM ops_loop.current_software_release($1)`,
          [actor.role],
        );
        const row = result.rows[0];
        if (!row) throw new Error('OPS_LOOP_SHAPE');
        return toSoftwareRelease(row);
      });
    },
  });
}
