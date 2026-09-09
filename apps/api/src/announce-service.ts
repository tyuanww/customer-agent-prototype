import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { AuthenticatedUser } from './auth-service.js';
import { mapDatabaseContractError } from './database-contract-errors.js';
import { hmacSafeValue } from './idempotency.js';
import type { OperationFailureCode } from './operation-result.js';
import {
  createApiRuntimeDiagnostic,
  reportApiRuntimeDiagnostic,
  type ApiRuntimeDiagnosticCode,
  type ApiRuntimeDiagnosticSink,
} from './runtime-diagnostics.js';

type CurrentAnnouncementResponse = components['schemas']['CurrentAnnouncementResponse'];
type SnapshotResponse = components['schemas']['SnapshotResponse'];
type SnapshotItem = components['schemas']['SnapshotItem'];
type PublicSnapshotQuestion = components['schemas']['PublicSnapshotQuestion'];
type SourceContractReason = components['schemas']['SourceContractReason'];

export const ANNOUNCE_LEASE_TTL_SECONDS = 600;

export type AnnounceFailure = Readonly<{
  ok: false;
  code: OperationFailureCode;
  reason?: SourceContractReason;
}>;

export type CurrentAnnouncementResult =
  | Readonly<{ ok: true; status: 200; response: CurrentAnnouncementResponse; etag: string }>
  | Readonly<{
      ok: true;
      status: 304;
      etag: string;
      leaseToken: string;
      leaseExpiresAt: string;
    }>
  | AnnounceFailure;

export type AnnounceService = Readonly<{
  current: (request: Readonly<{
    actor: AuthenticatedUser;
    clientId: string;
    ifNoneMatch?: string;
    leaseToken?: string;
  }>) => Promise<CurrentAnnouncementResult>;
  snapshot: (request: Readonly<{
    actor: AuthenticatedUser;
    clientId: string;
    leaseToken: string;
    releaseId: string;
    cursor: string | null;
    limit: number;
  }>) => Promise<Readonly<{ ok: true; response: SnapshotResponse }> | AnnounceFailure>;
  ack: (request: Readonly<{
    actor: AuthenticatedUser;
    clientId: string;
    releaseId: string;
    releaseSeq: number;
    leaseToken: string;
  }>) => Promise<Readonly<{ ok: true }> | AnnounceFailure>;
  readiness: () => Promise<'ok' | 'not_ready'>;
  close: () => Promise<void>;
}>;

interface CurrentRow extends QueryResultRow {
  current_release_id: string;
  release_seq: string | number;
  source_binding_hash: string;
  offline_lease_token: string;
  lease_expires_at: Date | string;
  announcement_title: string | null;
  announcement_summary: string | null;
  announcement_created_at: Date | string | null;
}

interface SnapshotRow extends QueryResultRow {
  release_id: string;
  release_seq: string | number;
  source_binding_hash: string;
  lease_expires_at: Date | string;
  items_json: unknown;
  next_cursor: string | null;
}

interface LeaseRow extends QueryResultRow {
  release_id: string;
  release_seq: string | number;
  source_binding_hash: string;
  lease_expires_at: Date | string;
}

const CURRENT_AUDITED = new Set<string>(['SOURCE_GATE_NOT_READY']);
const SNAPSHOT_AUDITED = new Set<string>([
  'SOURCE_SUSPENDED',
  'SOURCE_NOT_ELIGIBLE',
  'OFFLINE_LEASE_INVALID',
  'OFFLINE_LEASE_EXPIRED',
  'OFFLINE_LEASE_BINDING_MISMATCH',
  'SOURCE_GATE_NOT_READY',
]);
const ACK_AUDITED = new Set<string>([
  'OFFLINE_LEASE_INVALID',
  'OFFLINE_LEASE_EXPIRED',
  'OFFLINE_LEASE_BINDING_MISMATCH',
  'SOURCE_GATE_NOT_READY',
]);
const LEASE_REASONS = new Set<string>([
  'OFFLINE_LEASE_INVALID',
  'OFFLINE_LEASE_EXPIRED',
  'OFFLINE_LEASE_BINDING_MISMATCH',
]);

function failure(code: OperationFailureCode, reason?: SourceContractReason): AnnounceFailure {
  return Object.freeze(reason === undefined ? { ok: false, code } : { ok: false, code, reason });
}

async function rollbackTxn(client: PoolClient): Promise<boolean> {
  try {
    await client.query('ROLLBACK');
    return true;
  } catch {
    return false;
  }
}

function unwrapError(error: unknown): unknown {
  if (Array.isArray(error) && error.length > 0) return unwrapError(error[0]);
  if (error !== null && typeof error === 'object') {
    const cause = Reflect.get(error, 'cause');
    if (cause !== undefined) return unwrapError(cause);
  }
  return error;
}

function fieldOf(error: unknown, name: string): string {
  const unwrapped = unwrapError(error);
  if (unwrapped === null || typeof unwrapped !== 'object') return '';
  const value = Reflect.get(unwrapped, name);
  return value === undefined || value === null ? '' : String(value).trim();
}

function sqlStateOf(error: unknown): string {
  const direct = fieldOf(error, 'code');
  if (/^[0-9A-Z]{5}$/.test(direct)) return direct;
  if (error === null || typeof error !== 'object') return '';
  const fields = Reflect.get(error, 'fields');
  if (fields === null || typeof fields !== 'object') return '';
  const nested = Reflect.get(fields, 'C') ?? Reflect.get(fields, 'code');
  const state = nested === undefined || nested === null ? '' : String(nested).trim();
  return /^[0-9A-Z]{5}$/.test(state) ? state : '';
}

function contractReason(error: unknown): string {
  const detail = fieldOf(error, 'detail');
  if (LEASE_REASONS.has(detail)
    || detail === 'SOURCE_GATE_NOT_READY'
    || detail === 'SOURCE_SUSPENDED'
    || detail === 'SOURCE_NOT_ELIGIBLE'
    || detail === 'FORBIDDEN'
    || detail === 'VALIDATION'
    || detail === 'NOT_FOUND') {
    return detail;
  }
  const message = (error instanceof Error ? error.message : fieldOf(error, 'message')).trim().toLowerCase();
  if (message.includes('expired')) return 'OFFLINE_LEASE_EXPIRED';
  if (message.includes('binding')) return 'OFFLINE_LEASE_BINDING_MISMATCH';
  if (message.includes('belongs to another')) return 'FORBIDDEN';
  if (message.includes('not ready') || message.includes('source gate')) return 'SOURCE_GATE_NOT_READY';
  if (message.includes('offline lease')) return 'OFFLINE_LEASE_INVALID';
  return detail;
}

function asIso(value: unknown): string {
  const timestamp = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(timestamp.valueOf())) throw new Error('TIMESTAMP_INVALID');
  return timestamp.toISOString();
}

function weakEtag(releaseSeq: number): string {
  return `W/"${releaseSeq}"`;
}

function mapQuestion(value: unknown): PublicSnapshotQuestion | null {
  if (value === null || typeof value !== 'object') return null;
  const questionId = Reflect.get(value, 'question_id');
  const questionVersion = Reflect.get(value, 'question_version');
  const questionText = Reflect.get(value, 'question_text');
  const questionHash = Reflect.get(value, 'question_hash');
  const semanticFamilyId = Reflect.get(value, 'semantic_family_id');
  if (typeof questionId !== 'string'
    || typeof questionText !== 'string'
    || typeof questionHash !== 'string'
    || typeof semanticFamilyId !== 'string') {
    return null;
  }
  return parseContractSchema('PublicSnapshotQuestion', {
    question_id: questionId,
    question_version: Number(questionVersion),
    question_text: questionText,
    question_hash: questionHash,
    semantic_family_id: semanticFamilyId,
  });
}

function mapSnapshotItem(value: unknown): SnapshotItem | null {
  if (value === null || typeof value !== 'object') return null;
  const questionsRaw = Reflect.get(value, 'questions');
  if (!Array.isArray(questionsRaw)) return null;
  const questions: PublicSnapshotQuestion[] = [];
  for (const entry of questionsRaw) {
    const mapped = mapQuestion(entry);
    if (mapped === null) return null;
    questions.push(mapped);
  }
  const effectiveTo = Reflect.get(value, 'effective_to');
  return parseContractSchema('SnapshotItem', {
    script_id: Reflect.get(value, 'script_id'),
    script_version: Number(Reflect.get(value, 'script_version')),
    content_hash: Reflect.get(value, 'content_hash'),
    title: Reflect.get(value, 'title'),
    category: Reflect.get(value, 'category'),
    answer_text: Reflect.get(value, 'answer_text'),
    platform_scope: Reflect.get(value, 'platform_scope'),
    product_scope_type: Reflect.get(value, 'product_scope_type'),
    product_scope_refs: Reflect.get(value, 'product_scope_refs'),
    effective_from: asIso(Reflect.get(value, 'effective_from')),
    effective_to: effectiveTo === null ? null : asIso(effectiveTo),
    intent_taxonomy_version: Reflect.get(value, 'intent_taxonomy_version'),
    intent_id: Reflect.get(value, 'intent_id'),
    risk_level: Reflect.get(value, 'risk_level'),
    risk_categories: Reflect.get(value, 'risk_categories'),
    has_conflict: Reflect.get(value, 'has_conflict'),
    placeholder_keys: Reflect.get(value, 'placeholder_keys'),
    questions,
  });
}

function mapCurrent(row: CurrentRow): CurrentAnnouncementResponse {
  const releaseSeq = Number(row.release_seq);
  const announcement = row.announcement_title === null || row.announcement_created_at === null
    ? null
    : {
      title: row.announcement_title,
      summary: row.announcement_summary,
      created_at: asIso(row.announcement_created_at),
    };
  return parseContractSchema('CurrentAnnouncementResponse', {
    current_release_id: row.current_release_id,
    release_seq: releaseSeq,
    source_binding_hash: row.source_binding_hash,
    offline_lease: {
      token: row.offline_lease_token,
      expires_at: asIso(row.lease_expires_at),
      release_id: row.current_release_id,
      source_binding_hash: row.source_binding_hash,
    },
    announcement,
  });
}

function mapSnapshot(row: SnapshotRow, leaseToken: string): SnapshotResponse {
  const raw = row.items_json;
  const itemsRaw = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw;
  if (!Array.isArray(itemsRaw)) throw new Error('SNAPSHOT_ITEMS_INVALID');
  const items: SnapshotItem[] = [];
  for (const entry of itemsRaw) {
    const mapped = mapSnapshotItem(entry);
    if (mapped === null) throw new Error('SNAPSHOT_ITEM_INVALID');
    items.push(mapped);
  }
  return parseContractSchema('SnapshotResponse', {
    release_id: row.release_id,
    release_seq: Number(row.release_seq),
    source_binding_hash: row.source_binding_hash,
    offline_lease: {
      token: leaseToken,
      expires_at: asIso(row.lease_expires_at),
      release_id: row.release_id,
      source_binding_hash: row.source_binding_hash,
    },
    items,
    next_cursor: row.next_cursor,
  });
}

function announceFailure(
  error: unknown,
  operation: 'announce_current' | 'announce_snapshot' | 'announce_ack',
): AnnounceFailure {
  const unwrapped = unwrapError(error);
  const reason = contractReason(unwrapped);
  const state = sqlStateOf(unwrapped);
  if (LEASE_REASONS.has(reason) || reason === 'SOURCE_SUSPENDED' || reason === 'SOURCE_NOT_ELIGIBLE') {
    return failure('FORBIDDEN', reason as SourceContractReason);
  }
  if (reason === 'SOURCE_GATE_NOT_READY' || (state === 'ZA004' && operation === 'announce_current')) {
    return failure(operation === 'announce_ack' ? 'FORBIDDEN' : 'SOURCE_GATE_NOT_READY', 'SOURCE_GATE_NOT_READY');
  }
  if (state === 'ZA004') {
    return failure('FORBIDDEN', 'OFFLINE_LEASE_INVALID');
  }
  if (reason === 'FORBIDDEN') return failure('FORBIDDEN');
  if (reason === 'VALIDATION') return failure('VALIDATION');
  if (reason === 'NOT_FOUND') return failure('NOT_FOUND');
  return failure(mapDatabaseContractError(error));
}

export function createAnnounceServiceForPool(
  pool: Pick<Pool, 'connect' | 'query' | 'end'>,
  logHash: Readonly<{ version: string; key: string }>,
  ownsPool: boolean,
  diagnosticSink: ApiRuntimeDiagnosticSink = reportApiRuntimeDiagnostic,
): AnnounceService {
  function report(error: unknown, code: ApiRuntimeDiagnosticCode = 'ANNOUNCE_FAILED'): void {
    try {
      diagnosticSink(createApiRuntimeDiagnostic(code, error));
    } catch {
      // Observational.
    }
  }

  async function recordDenial(
    operation: 'announce_current' | 'announce_snapshot' | 'announce_ack',
    actor: AuthenticatedUser,
    reason: SourceContractReason,
    requestId: string,
    releaseId: string | null,
    sourceBindingHash: string | null,
  ): Promise<boolean> {
    const actorSubjectHash = hmacSafeValue(`actor:${actor.user_id}`, logHash.version, logHash.key);
    const denialDigest = hmacSafeValue(
      `source-denial:${operation}:${actor.user_id}:${requestId}:${reason}`,
      logHash.version,
      logHash.key,
    );
    const diagnosticDigest = hmacSafeValue(
      `diagnostic:${operation}:${actor.user_id}:${requestId}`,
      logHash.version,
      logHash.key,
    );
    const client = await pool.connect().catch((error: unknown) => {
      report(error, 'ANNOUNCE_AUDIT_CONNECT_FAILED');
      return null;
    });
    if (client === null) return false;
    let broken = false;
    let failureCode: ApiRuntimeDiagnosticCode = 'ANNOUNCE_AUDIT_BEGIN_FAILED';
    try {
      await client.query('BEGIN');
      failureCode = 'ANNOUNCE_AUDIT_WRITE_FAILED';
      await client.query(
        `SELECT public.record_runtime_source_denial_audit($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9)`,
        [
          `sda_${denialDigest}`,
          operation,
          reason,
          actorSubjectHash,
          logHash.version,
          actor.role,
          releaseId,
          sourceBindingHash,
          `diag_${diagnosticDigest.slice(0, 32)}`,
        ],
      );
      failureCode = 'ANNOUNCE_AUDIT_COMMIT_FAILED';
      await client.query('COMMIT');
      return true;
    } catch (error) {
      report(error, failureCode);
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        broken = true;
        report(rollbackError, 'ANNOUNCE_AUDIT_ROLLBACK_FAILED');
      }
      return false;
    } finally {
      client.release(broken);
    }
  }

  async function deny(
    operation: 'announce_current' | 'announce_snapshot' | 'announce_ack',
    actor: AuthenticatedUser,
    mapped: AnnounceFailure,
    requestId: string,
    releaseId: string | null,
    sourceBindingHash: string | null,
  ): Promise<AnnounceFailure> {
    const audited = operation === 'announce_current'
      ? CURRENT_AUDITED
      : operation === 'announce_snapshot' ? SNAPSHOT_AUDITED : ACK_AUDITED;
    if (mapped.reason === undefined || !audited.has(mapped.reason)) {
      if (mapped.code === 'INTERNAL') report(new Error(mapped.code));
      return mapped;
    }
    const written = await recordDenial(
      operation, actor, mapped.reason, requestId, releaseId, sourceBindingHash,
    );
    if (!written) return failure('OVERLOADED');
    return mapped;
  }

  return Object.freeze({
    async current(request) {
      const client = await pool.connect().catch((error: unknown) => {
        report(error, 'ANNOUNCE_CONNECT_FAILED');
        return null;
      });
      if (client === null) return failure('OVERLOADED');
      try {
        const result = await client.query<CurrentRow>(
          'SELECT * FROM public.read_current_announcement_with_lease($1,$2,$3)',
          [request.clientId, request.actor.user_id, ANNOUNCE_LEASE_TTL_SECONDS],
        );
        const row = result.rows[0];
        if (row === undefined) {
          return deny(
            'announce_current',
            request.actor,
            failure('SOURCE_GATE_NOT_READY', 'SOURCE_GATE_NOT_READY'),
            request.clientId,
            null,
            null,
          );
        }
        const response = mapCurrent(row);
        const etag = weakEtag(response.release_seq);
        if (request.ifNoneMatch === etag && request.leaseToken !== undefined) {
          try {
            const lease = await client.query<LeaseRow>(
              'SELECT * FROM public.validate_snapshot_offline_lease($1,$2,$3,$4)',
              [request.leaseToken, request.clientId, request.actor.user_id, response.current_release_id],
            );
            const valid = lease.rows[0];
            if (valid !== undefined && Number(valid.release_seq) === response.release_seq) {
              return Object.freeze({
                ok: true as const,
                status: 304 as const,
                etag,
                leaseToken: request.leaseToken,
                leaseExpiresAt: asIso(valid.lease_expires_at),
              });
            }
          } catch {
            // Stale or invalid conditional lease falls through to a fresh 200.
          }
        }
        return Object.freeze({ ok: true as const, status: 200 as const, response, etag });
      } catch (error) {
        return deny(
          'announce_current',
          request.actor,
          announceFailure(error, 'announce_current'),
          request.clientId,
          null,
          null,
        );
      } finally {
        client.release(false);
      }
    },

    async snapshot(request) {
      const client = await pool.connect().catch((error: unknown) => {
        report(error, 'ANNOUNCE_CONNECT_FAILED');
        return null;
      });
      if (client === null) return failure('OVERLOADED');
      try {
        let result;
        try {
          result = await client.query<SnapshotRow>(
            'SELECT * FROM public.read_snapshot_page($1,$2,$3,$4,$5,$6)',
            [
              request.leaseToken,
              request.clientId,
              request.actor.user_id,
              request.releaseId,
              request.cursor,
              request.limit,
            ],
          );
        } catch (error) {
          let mapped = announceFailure(error, 'announce_snapshot');
          if (mapped.code === 'INTERNAL') {
            report(error);
            mapped = failure('FORBIDDEN', 'OFFLINE_LEASE_INVALID');
          }
          return deny(
            'announce_snapshot',
            request.actor,
            mapped,
            `${request.clientId}:${request.releaseId}`,
            request.releaseId,
            null,
          );
        }
        const row = result.rows[0];
        if (row === undefined) return failure('NOT_FOUND');
        if (row.lease_expires_at === null || row.lease_expires_at === undefined
          || row.release_id === undefined || row.release_id === null) {
          return deny(
            'announce_snapshot',
            request.actor,
            failure('FORBIDDEN', 'OFFLINE_LEASE_INVALID'),
            `${request.clientId}:${request.releaseId}`,
            request.releaseId,
            null,
          );
        }
        try {
          return Object.freeze({ ok: true as const, response: mapSnapshot(row, request.leaseToken) });
        } catch (error) {
          report(error);
          return deny(
            'announce_snapshot',
            request.actor,
            failure('FORBIDDEN', 'OFFLINE_LEASE_INVALID'),
            `${request.clientId}:${request.releaseId}`,
            request.releaseId,
            null,
          );
        }
      } finally {
        client.release(false);
      }
    },

    async ack(request) {
      const client = await pool.connect().catch((error: unknown) => {
        report(error, 'ANNOUNCE_CONNECT_FAILED');
        return null;
      });
      if (client === null) return failure('OVERLOADED');
      let broken = false;
      let denied: AnnounceFailure | undefined;
      try {
        await client.query('BEGIN');
        await client.query(
          'SELECT public.ack_client_release($1,$2,$3,$4,$5)',
          [
            request.clientId,
            request.actor.user_id,
            request.releaseId,
            request.releaseSeq,
            request.leaseToken,
          ],
        );
        await client.query('COMMIT');
        return Object.freeze({ ok: true as const });
      } catch (error) {
        const rolledBack = await rollbackTxn(client);
        broken = !rolledBack;
        const mapped = announceFailure(error, 'announce_ack');
        if (mapped.reason && ACK_AUDITED.has(mapped.reason)) {
          if (!rolledBack) return failure('OVERLOADED');
          denied = mapped;
        } else {
          if (mapped.code === 'INTERNAL') report(error);
          return mapped;
        }
      } finally {
        client.release(broken);
      }
      if (denied === undefined) return failure('INTERNAL');
      return deny(
        'announce_ack',
        request.actor,
        denied,
        `${request.clientId}:${request.releaseId}:${String(request.releaseSeq)}`,
        request.releaseId,
        null,
      );
    },

    async readiness() {
      try {
        await pool.query(
          `SELECT 1 FROM public.search_recommendable_scripts('qianniu', NULL, NULL) LIMIT 1`,
        );
        return 'ok';
      } catch {
        return 'not_ready';
      }
    },

    close: () => ownsPool ? pool.end() : Promise.resolve(),
  });
}
