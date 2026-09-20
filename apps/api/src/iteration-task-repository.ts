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

type IterationTask = components['schemas']['IterationTask'];
type IterationTaskListResponse = components['schemas']['IterationTaskListResponse'];
type IterationTaskStatus = components['schemas']['IterationTaskStatus'];
type IterationTaskCloseStatus = Extract<IterationTask['resolution'], 'resolved' | 'wont_fix'>;

export type IterationTaskListQuery = Readonly<{
  status?: IterationTaskStatus;
  signalId?: string;
  assigneeRole?: string;
  cursorCreatedAt?: string;
  cursorTaskId?: string;
  limit: number;
}>;

export type PreparedIterationTaskStart = Readonly<{
  actor: AuthenticatedUser;
  taskId: string;
  expectedVersion: number;
  idempotencyKey: string;
  requestHashes: PreparedIdempotencyHashes;
}>;

export type PreparedIterationTaskClose = Readonly<{
  actor: AuthenticatedUser;
  taskId: string;
  expectedVersion: number;
  status: IterationTaskCloseStatus;
  resolutionNote: string;
  idempotencyKey: string;
  requestHashes: PreparedIdempotencyHashes;
}>;

export type IterationTaskRepository = Readonly<{
  list: (
    query: IterationTaskListQuery,
    actor: AuthenticatedUser,
  ) => Promise<OperationResult<IterationTaskListResponse>>;
  start: (request: PreparedIterationTaskStart) => Promise<OperationResult<IterationTask>>;
  close: (request: PreparedIterationTaskClose) => Promise<OperationResult<IterationTask>>;
}>;

type IterationPool = Pick<Pool, 'connect'>;

interface IterationTaskRow {
  task_id: string;
  signal_id: string;
  cluster_key: string;
  sample_query_ids: unknown;
  suspected_cause: string;
  suggested_script_ids: unknown;
  status: string;
  assignee_role: string | null;
  resolution: string | null;
  resolution_note: string | null;
  version: number | string;
  created_at: Date | string;
  updated_at: Date | string;
  resolved_at: Date | string | null;
}

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

const START_SCOPE = '/v1/events/iteration-tasks/start';
const CLOSE_SCOPE = '/v1/events/iteration-tasks/close';
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

function normalizeIdList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
    const item = entry.trim();
    if (item.length < 1) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    items.push(item);
  }
  return items.length > 50 ? null : items;
}

function toContractTask(row: IterationTaskRow): IterationTask {
  const sampleQueryIds = normalizeIdList(row.sample_query_ids);
  const suggestedScriptIds = normalizeIdList(row.suggested_script_ids);
  if (sampleQueryIds === null || suggestedScriptIds === null) {
    throw new Error('ITERATION_TASK_SHAPE');
  }
  const version = typeof row.version === 'number' ? row.version : Number(row.version);
  if (!Number.isInteger(version) || version < 1) throw new Error('ITERATION_TASK_SHAPE');
  const assignee = row.assignee_role === null || row.assignee_role.trim() === ''
    ? null
    : row.assignee_role;
  return parseContractSchema('IterationTask', {
    task_id: row.task_id,
    signal_id: row.signal_id,
    cluster_key: row.cluster_key,
    sample_query_ids: sampleQueryIds,
    suspected_cause: row.suspected_cause,
    suggested_script_ids: suggestedScriptIds,
    status: row.status,
    assignee_role: assignee,
    resolution: row.resolution,
    resolution_note: row.resolution_note,
    version,
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
    resolved_at: row.resolved_at === null ? null : asIso(row.resolved_at),
  });
}

function replayTask(responseBody: unknown): IterationTask | null {
  try {
    return parseContractSchema('IterationTask', responseBody);
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

export function createIterationTaskRepository(
  pool: IterationPool,
  leaseOwner = `api_${randomUUID().replaceAll('-', '')}`,
  diagnosticSink: ApiRuntimeDiagnosticSink = () => undefined,
): IterationTaskRepository {
  function reportFailure(error: unknown): void {
    try {
      diagnosticSink(createApiRuntimeDiagnostic('ITERATION_TASK_FAILED', error));
    } catch {
      // Diagnostics are observational and never replace the stable operation result.
    }
  }

  async function mutate(
    scope: string,
    request: PreparedIterationTaskStart | PreparedIterationTaskClose,
    execute: (client: PoolClient) => Promise<IterationTaskRow>,
  ): Promise<OperationResult<IterationTask>> {
    const client = await pool.connect().catch(() => null);
    if (client === null) return failure('OVERLOADED');
    let releaseAsBroken = false;
    try {
      await client.query('BEGIN');
      const claim = await claimIdempotency(
        client,
        scope,
        request.idempotencyKey,
        request.actor.user_id,
        request.requestHashes,
        leaseOwner,
      );
      if (claim.action === 'replay') {
        const response = replayTask(claim.responseBody);
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
      const response = toContractTask(await execute(client));
      await completeIdempotency(
        client,
        scope,
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
  }

  return Object.freeze({
    async list(query, actor): Promise<OperationResult<IterationTaskListResponse>> {
      if (actor.role !== 'coach' && actor.role !== 'owner') return failure('FORBIDDEN');
      const client = await pool.connect().catch(() => null);
      if (client === null) return failure('OVERLOADED');
      const values: unknown[] = [];
      const where: string[] = [];
      if (query.status !== undefined) {
        values.push(query.status);
        where.push(`status = $${values.length}`);
      }
      if (query.signalId !== undefined) {
        values.push(query.signalId);
        where.push(`signal_id = $${values.length}`);
      }
      if (query.assigneeRole !== undefined) {
        values.push(query.assigneeRole);
        where.push(`assignee_role = $${values.length}`);
      }
      if (query.cursorCreatedAt !== undefined && query.cursorTaskId !== undefined) {
        values.push(query.cursorCreatedAt, query.cursorTaskId);
        where.push(
          `(created_at, task_id) < ($${values.length - 1}::timestamptz, $${values.length}::text)`,
        );
      }
      values.push(query.limit + 1);
      const sql = `
        SELECT task_id, signal_id, cluster_key, sample_query_ids, suspected_cause,
               suggested_script_ids, status, assignee_role, resolution, resolution_note,
               version, created_at, updated_at, resolved_at
        FROM public.iteration_tasks
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY created_at DESC, task_id DESC
        LIMIT $${values.length}
      `;
      try {
        const result = await client.query<IterationTaskRow>(sql, values);
        const rows = result.rows;
        const hasMore = rows.length > query.limit;
        const page = hasMore ? rows.slice(0, query.limit) : rows;
        const items = page.map(toContractTask);
        const last = items[items.length - 1];
        return Object.freeze({
          ok: true,
          response: parseContractSchema('IterationTaskListResponse', {
            items,
            next_cursor: hasMore && last
              ? Buffer.from(`${last.created_at}|${last.task_id}`, 'utf8').toString('base64url')
              : null,
          }),
        });
      } catch (error: unknown) {
        const code = mapDatabaseContractError(error);
        if (code === 'INTERNAL') reportFailure(error);
        return failure(code);
      } finally {
        client.release();
      }
    },

    start(request) {
      return mutate(START_SCOPE, request, async (client) => {
        const started = await client.query<IterationTaskRow>(
          'SELECT * FROM public.start_iteration_task($1, $2, $3, $4)',
          [request.taskId, request.expectedVersion, request.actor.user_id, request.actor.role],
        );
        const row = started.rows[0];
        if (!row) throw new Error('ITERATION_TASK_SHAPE');
        return row;
      });
    },

    close(request) {
      return mutate(CLOSE_SCOPE, request, async (client) => {
        const closed = await client.query<IterationTaskRow>(
          'SELECT * FROM public.close_iteration_task($1, $2, $3, $4, $5, $6)',
          [
            request.taskId,
            request.expectedVersion,
            request.status,
            request.resolutionNote,
            request.actor.user_id,
            request.actor.role,
          ],
        );
        const row = closed.rows[0];
        if (!row) throw new Error('ITERATION_TASK_SHAPE');
        return row;
      });
    },
  });
}
