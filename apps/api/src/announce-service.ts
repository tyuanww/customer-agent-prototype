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

function ownContractCode(error: unknown): string {
  if (error === null || typeof error !== 'object') return '';
  const code = Reflect.get(error, 'code');
  const text = code === undefined || code === null ? '' : String(code).trim();
  return /^[0-9A-Z]{5}$/.test(text) ? text : '';
}

function ownContractDetail(error: unknown): string {
  if (error === null || typeof error !== 'object') return '';
  const detail = Reflect.get(error, 'detail');
  return detail === undefined || detail === null ? '' : String(detail).trim();
}

function unwrapError(error: unknown): unknown {
  if (Array.isArray(error) && error.length > 0) return unwrapError(error[0]);
  if (error !== null && typeof error === 'object') {
    if (ownContractCode(error) !== '' || ownContractDetail(error) !== '') return error;
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

function isBrokenClient(error: unknown): boolean {
  const state = sqlStateOf(error);
  if (state.startsWith('08') || state === '57P01' || state === '57P02' || state === '57P03') {
    return true;
  }
  const code = fieldOf(error, 'code');
  if (code.startsWith('ECONN') || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'EPIPE') {
    return true;
  }
  const message = (error instanceof Error ? error.message : fieldOf(error, 'message')).toLowerCase();
  return message.includes('timeout')
    || message.includes('deadline')
    || message.includes('terminated')
    || message.includes('hang up');
}

/**
 * True when a read failed without the database giving a verdict.
 *
 * `pg` enforces `query_timeout` / `statement_timeout` from the client side. When
 * the timer wins, it discards whatever the server was about to send and raises a
 * bare `Error` — `pg/client.js` builds `new Error('Query read timeout')` with no
 * `code`, no `detail` and no `fields`. A lease denial that was already travelling
 * (SQLSTATE `ZA004`, DETAIL `OFFLINE_LEASE_*`) is replaced by that shapeless
 * error, so `announceFailure` loses its only discriminator and any statement
 * still in flight becomes indistinguishable from a genuine internal fault.
 *
 * Such a read is *undetermined*, not forbidden and not broken: the same request
 * may succeed once the database is responsive again. Callers must therefore
 * retry it and, once retries are exhausted, report a retryable status — never
 * `FORBIDDEN` (which would tell an agent their lease is void, and would audit a
 * denial that the database never issued) and never `INTERNAL` (which hides a
 * transient overload behind a server-fault status).
 *
 * This deliberately does NOT consult `isBrokenClient`: a client whose socket was
 * torn down still reports a retryable condition, but the two decisions are
 * separate — one picks the pooled connection to discard, this one picks the
 * status. Keeping them apart is what stops a connection error from being
 * rewritten as an invalid lease (see the `socket hang up` case).
 */
function isUndeterminedRead(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : fieldOf(error, 'message')).toLowerCase();
  // `query read timeout` is pg's client-side timer. Server-side
  // `statement_timeout` also reports SQLSTATE 57014, which mapDatabaseContractError
  // already folds into OVERLOADED; matching the message keeps that true even when
  // the SQLSTATE is lost the same way.
  return message.includes('query read timeout') || message.includes('statement timeout');
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
  // A read the database never answered carries no verdict. Report it as
  // retryable rather than internal, so a timeout is never surfaced as a server
  // fault. Checked after every contract reason so a real ZA005/ZA001 denial that
  // happens to travel with a slow statement still wins.
  if (isUndeterminedRead(unwrapped) || isUndeterminedRead(error)) return failure('OVERLOADED');
  return failure(mapDatabaseContractError(unwrapped));
}

/**
 * Recover the verdict a timed-out snapshot read never delivered.
 *
 * The frozen contract for `/v1/announce/snapshot` is explicit: an invalid,
 * mismatched or expired lease returns 403 with `OFFLINE_LEASE_INVALID` and never
 * a partial snapshot. A `query_timeout` makes the server unable to tell *which*
 * of those it is — the SQLSTATE that would have said so was discarded by `pg`
 * before it reached this process (see `isUndeterminedRead`).
 *
 * Answering 503 there would be honest about the uncertainty but would break the
 * contract for the common case, and guessing 403 would fabricate a denial the
 * database never issued — including a bogus `source_denial_audits` row. So ask
 * again, cheaply: `validate_snapshot_offline_lease` is a `SECURITY DEFINER`
 * function that resolves the lease by primary key on `lease_token_hash` plus the
 * client/user/release binding, without the paging join that made the original
 * statement slow. It gives a definite verdict on a fresh round trip.
 *
 * Runs on its own pooled client so it is never queued behind the statement that
 * already timed out. Any failure here (including another timeout) stays
 * undetermined and yields `undefined`, leaving the caller on the retryable path.
 */
async function revalidateLeaseAfterTimeout(
  pool: Pick<Pool, 'connect' | 'query' | 'end'>,
  request: Readonly<{
    leaseToken: string;
    clientId: string;
    userId: string;
    releaseId: string;
  }>,
): Promise<AnnounceFailure | undefined> {
  const client = await pool.connect().catch(() => null);
  if (client === null) return undefined;
  let broken = false;
  try {
    await client.query(
      'SELECT * FROM public.validate_snapshot_offline_lease($1,$2,$3,$4)',
      [request.leaseToken, request.clientId, request.userId, request.releaseId],
    );
    // The lease validated: the timeout was environmental, not a denial. Leave it
    // to the caller to report a retryable status.
    return undefined;
  } catch (error) {
    const mapped = announceFailure(error, 'announce_snapshot');
    broken = isBrokenClient(error);
    if (mapped.reason !== undefined && SNAPSHOT_AUDITED.has(mapped.reason)) return mapped;
    return undefined;
  } finally {
    client.release(broken);
  }
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
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const client = await pool.connect().catch((error: unknown) => {
        report(error, 'ANNOUNCE_AUDIT_CONNECT_FAILED');
        return null;
      });
      if (client === null) continue;
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
        if (failureCode === 'ANNOUNCE_AUDIT_BEGIN_FAILED') broken = true;
        else return false;
      } finally {
        client.release(broken);
      }
    }
    return false;
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
      let broken = false;
      let denied: AnnounceFailure | undefined;
      try {
        const result = await client.query<CurrentRow>(
          'SELECT * FROM public.read_current_announcement_with_lease($1,$2,$3)',
          [request.clientId, request.actor.user_id, ANNOUNCE_LEASE_TTL_SECONDS],
        );
        const row = result.rows[0];
        if (row === undefined) {
          denied = failure('SOURCE_GATE_NOT_READY', 'SOURCE_GATE_NOT_READY');
        } else {
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
        }
      } catch (error) {
        broken = isBrokenClient(error) || isUndeterminedRead(error);
        const mapped = announceFailure(error, 'announce_current');
        if (mapped.reason !== undefined && CURRENT_AUDITED.has(mapped.reason)) {
          denied = mapped;
        } else {
          if (mapped.code === 'INTERNAL' || mapped.code === 'OVERLOADED') report(error);
          return mapped;
        }
      } finally {
        client.release(broken);
      }
      if (denied === undefined) return failure('INTERNAL');
      return deny(
        'announce_current',
        request.actor,
        denied,
        request.clientId,
        null,
        null,
      );
    },

    async snapshot(request) {
      const requestId = `${request.clientId}:${request.releaseId}`;
      let lastInfra: AnnounceFailure | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const client = await pool.connect().catch((error: unknown) => {
          report(error, 'ANNOUNCE_CONNECT_FAILED');
          return null;
        });
        if (client === null) {
          lastInfra = failure('OVERLOADED');
          continue;
        }
        let broken = false;
        let denied: AnnounceFailure | undefined;
        try {
          const result = await client.query<SnapshotRow>(
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
          const row = result.rows[0];
          if (row === undefined) return failure('NOT_FOUND');
          if (row.lease_expires_at === null || row.lease_expires_at === undefined
            || row.release_id === undefined || row.release_id === null) {
            denied = failure('FORBIDDEN', 'OFFLINE_LEASE_INVALID');
          } else {
            try {
              return Object.freeze({ ok: true as const, response: mapSnapshot(row, request.leaseToken) });
            } catch (error) {
              report(error);
              denied = failure('FORBIDDEN', 'OFFLINE_LEASE_INVALID');
            }
          }
        } catch (error) {
          const mapped = announceFailure(error, 'announce_snapshot');
          broken = isBrokenClient(error) || mapped.code === 'INTERNAL' || mapped.code === 'OVERLOADED';
          // A genuine fault and an undetermined read both deserve a diagnostic:
          // the transient one is exactly what an operator needs to see when this
          // endpoint starts returning 503 under load.
          if (mapped.code === 'INTERNAL' || mapped.code === 'OVERLOADED') report(error);
          if (mapped.reason !== undefined && SNAPSHOT_AUDITED.has(mapped.reason)) {
            denied = mapped;
          } else if (mapped.code === 'OVERLOADED' && isUndeterminedRead(error)) {
            // The paging read timed out before the database could rule on the
            // lease. Ask again on a separate client so the endpoint can still
            // honour the contract's 403 for a lease that really is invalid,
            // instead of reporting the uncertainty as a retryable 503.
            const revalidated = await revalidateLeaseAfterTimeout(pool, {
              leaseToken: request.leaseToken,
              clientId: request.clientId,
              userId: request.actor.user_id,
              releaseId: request.releaseId,
            });
            if (revalidated !== undefined) denied = revalidated;
            else lastInfra = mapped;
          } else if (mapped.code === 'INTERNAL' || mapped.code === 'OVERLOADED') {
            lastInfra = mapped;
          } else {
            return mapped;
          }
        } finally {
          client.release(broken);
        }
        if (denied !== undefined) {
          return deny(
            'announce_snapshot',
            request.actor,
            denied,
            requestId,
            request.releaseId,
            null,
          );
        }
      }
      return lastInfra ?? failure('OVERLOADED');
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
          if (mapped.code === 'INTERNAL' || mapped.code === 'OVERLOADED') report(error);
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
