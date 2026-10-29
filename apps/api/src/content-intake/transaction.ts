import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ContractValidationError, type components } from '@customer-agent/contracts';
import type { AuthenticatedUser } from '../auth-service.js';
import { authenticatedProductSession } from '../product-auth-service.js';
import { canonicalJson, type CanonicalJsonValue } from '../idempotency.js';

export type Reason = components['schemas']['IntakeFailure']['details']['reason'];
export class IntakeRejection extends Error {
  constructor(readonly reason: Reason, readonly code: components['schemas']['IntakeFailure']['code'] = 'CONFLICT') {
    super(reason);
  }
}
export type IntakeResult<T> = { ok: true; value: T } | {
  ok: false; code: components['schemas']['IntakeFailure']['code']; reason: Reason;
  commit: 'rolled_back' | 'unknown'; diagnosticId: string;
};
export type IntakePool = Pick<Pool, 'connect'>;
type Queryable = Pick<PoolClient, 'query'>;
/** Policy owners register the validity they consumed. The transaction owner checks
 * the earliest deadline after all writes, including the receipt, before COMMIT. */
export type IntakeTransaction = Queryable & {
  validUntil: (deadline: number) => void;
  /** Register a database-only invariant check under this transaction's lock.
   * Runs after work/receipt writes and before final authority/time checks. */
  beforeCommit: (check: () => Promise<void>) => void;
};
export type Principal = {
  id: string; userId: string; tenantId: string; appId: string; identityScope: string; personKey: string;
  factsVersion: number; generation: number; enabled: boolean; checkedAt: number; validUntil: number;
  role: 'agent' | 'enabler' | 'lead' | 'supervisor' | 'manager' | 'director' | 'engineer' | null;
};

/** Lock the authentication module's private session reference until this read or
 * write commits. An actor-shaped DTO, including a clone, is not a session. */
export async function lockProductSession(client: Pick<IntakeTransaction, 'query' | 'validUntil'>, actor: AuthenticatedUser): Promise<{hash: string; validUntil: number}> {
  const hash = authenticatedProductSession(actor);
  if (!hash) throw new IntakeRejection('SCOPE_DENIED', 'UNAUTHORIZED');
  const result = await client.query<{ expires_at: Date }>(
    'SELECT intake_runtime.lock_product_session($1,$2) AS expires_at', [hash, actor.user_id]).catch(error => {
    if (error instanceof Error && 'code' in error && error.code === 'ZA003' && error.message === 'SESSION_UNAVAILABLE') {
      throw new IntakeRejection('SCOPE_DENIED', 'UNAUTHORIZED');
    }
    throw error;
  });
  if (!result.rows[0]) throw new IntakeRejection('SCOPE_DENIED', 'UNAUTHORIZED');
  const validUntil = result.rows[0].expires_at.getTime();
  client.validUntil(validUntil);
  return { hash, validUntil };
}

export async function clock(client: Queryable): Promise<number> {
  const { rows } = await client.query<{ time: Date }>('SELECT clock_timestamp() AS time');
  return rows[0]!.time.getTime();
}

type PrincipalRow = {
  principal_id: string; user_id: string; tenant_id: string; app_id: string; identity_scope: string;
  person_key: string; current_facts_version: string; revocation_generation: string; enabled: boolean;
  checked_at: Date; valid_until: Date; roles: Principal['role'][];
};
// This module owns identity/facts/role projection for both command actors and
// bounded directory pages. Login role is never a business authority.
function principalProjection(relation: 'content_intake.principals' | 'registered'): string {
  return `SELECT p.*, (f.enabled AND b.enabled) AS enabled,
      f.checked_at, f.valid_until,
      ARRAY(SELECT DISTINCT r.role FROM content_intake.role_rules r WHERE r.tenant_id=p.tenant_id
        AND r.app_id=p.app_id AND r.job_id=f.job_id AND r.department_id=ANY(f.department_ids)) AS roles
    FROM ${relation} p JOIN content_intake.principal_facts f
      ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
    JOIN backend_identity.subject_bindings b ON b.user_id=p.user_id`;
}
function projectedPrincipal(row: PrincipalRow): Principal {
  return { id: row.principal_id, userId: row.user_id, tenantId: row.tenant_id, appId: row.app_id,
    identityScope: row.identity_scope, personKey: row.person_key, factsVersion: Number(row.current_facts_version),
    generation: Number(row.revocation_generation), enabled: row.enabled, checkedAt: row.checked_at.getTime(),
    validUntil: row.valid_until.getTime(),
    role: row.roles.length === 1 ? row.roles[0]! : null };
}

/** Called under the content lock. */
export async function principal(client: Queryable, selector: { userId: string } | { id: string }): Promise<Principal> {
  const byUser = 'userId' in selector;
  const { rows } = await client.query<PrincipalRow>(`${principalProjection('content_intake.principals')}
    WHERE ${byUser ? 'p.user_id' : 'p.principal_id'}=$1`, [byUser ? selector.userId : selector.id]);
  if (!rows[0]) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  return projectedPrincipal(rows[0]);
}

/** At most limit identities plus one lookahead, including ineligible targets.
 * Resolve confirmed identity/current facts in one join, never N+1 per person.
 * Call under the same content lock after authorizing the directory's source. */
export async function registeredPrincipalPage(client: Queryable, who: Principal, after: string, limit: number): Promise<(Principal & { displayName: string | null; hasNewIdentityActivity: boolean })[]> {
  const { rows } = await client.query<PrincipalRow & { display_name: string | null; has_new_identity_activity: boolean }>(`WITH registered AS MATERIALIZED (
      SELECT * FROM content_intake.principals WHERE tenant_id=$1 AND app_id=$2 AND principal_id COLLATE "C">$3 COLLATE "C"
      ORDER BY principal_id COLLATE "C" LIMIT $4), projected AS (
      ${principalProjection('registered')})
    SELECT projected.*, account.display_name,
      CASE WHEN projected.identity_scope='confirmed-hangzhou'
        THEN content_intake.principal_has_new_identity_activity(projected.principal_id) ELSE false END AS has_new_identity_activity FROM projected
    LEFT JOIN public.app_users account ON account.user_id=projected.user_id
    ORDER BY projected.principal_id COLLATE "C"`, [who.tenantId, who.appId, after, limit + 1]);
  return rows.map(row => ({ ...projectedPrincipal(row), displayName: row.display_name, hasNewIdentityActivity: row.has_new_identity_activity }));
}

const PRINCIPAL_FACT_WINDOW_MS = 24 * 60 * 60 * 1000;

type PrincipalFactWindowMs = number & { readonly __brand: 'PrincipalFactWindowMs' };

function isPrincipalFactWindowMs(value: number): value is PrincipalFactWindowMs {
  return value === PRINCIPAL_FACT_WINDOW_MS;
}

export const principalFactWindowMs = (() => {
  if (!isPrincipalFactWindowMs(PRINCIPAL_FACT_WINDOW_MS)) {
    throw new Error('principal fact window');
  }
  return PRINCIPAL_FACT_WINDOW_MS;
})();

export function requireFresh(p: Principal, now: number): void {
  if (!p.enabled || p.checkedAt > now || now >= p.validUntil || p.validUntil > p.checkedAt + principalFactWindowMs) {
    throw new IntakeRejection('ORG_FACTS_UNAVAILABLE', 'FORBIDDEN');
  }
}

const requestDigest = (request: CanonicalJsonValue): string =>
  `intake-request-v1:${createHash('sha256').update(canonicalJson(request)).digest('hex')}`;

/** Multi-phase commands consult the same durable receipt before doing external I/O.
 * Call under lock_content; a receipt recovers the original result, never authorizes a new write. */
export async function intakeReplay<T>(client: Queryable, actor: Principal, command: string,
  request: CanonicalJsonValue, operationId: string, decode: (value: unknown) => T): Promise<{ value: T } | null> {
  const prior = await client.query<{ request_hash: string; response: unknown }>(
    'SELECT request_hash,response FROM backend_review.receipts WHERE actor_user_id=$1 AND operation=$2 AND request_key=$3',
    [actor.userId, `intake:${command}`, operationId]);
  if (!prior.rows[0]) return null;
  if (prior.rows[0].request_hash !== requestDigest(request)) throw new IntakeRejection('IDEMPOTENCY_CONFLICT');
  return { value: decode(prior.rows[0].response) };
}

/** No connection string or production registration: only the isolated synthetic runner
 * currently supplies this pool. New application ACL stays sealed until all P2 gates pass.
 * Every writer takes the existing global content lock first; no remote I/O in callbacks. */
export function createIntakeTransactions(pool: IntakePool,
  report: (diagnosticId: string, error: unknown) => void = () => undefined,
  options: { requireProductSession?: boolean } = {}) {
  return async function run<T>(actor: AuthenticatedUser, command: string,
    request: CanonicalJsonValue | null, operationId: string | null,
    work: (client: IntakeTransaction, actor: Principal) => Promise<T>,
    decode: (value: unknown) => T,
  ): Promise<IntakeResult<T>> {
    let client: PoolClient | undefined;
    let committing = false;
    let broken = false;
    const diagnosticId = `intake_${randomUUID()}`;
    try {
      client = await pool.connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='5s'");
      await client.query('SELECT backend_review.lock_content()');
      const deadline = await clock(client) + 5_000;
      let authorityDeadline = Infinity;
      const finalChecks: (() => Promise<void>)[] = [];
      const transaction: IntakeTransaction = { query: client.query.bind(client),
        beforeCommit(check) { finalChecks.push(check); },
        validUntil(until) {
          if (!Number.isFinite(until)) throw new IntakeRejection('PERMISSION_CHANGED');
          authorityDeadline = Math.min(authorityDeadline, until);
        } };
      if (options.requireProductSession) await lockProductSession(transaction, actor);
      const who = await principal(client, { userId: actor.user_id });
      requireFresh(who, await clock(client));
      // Reuse the backend's permanent receipt namespace. Unlike the HTTP 24h
      // cache this also recovers grant/admission commands after a lost response.
      const operation = `intake:${command}`;
      // These permanent, server-private command bindings follow the existing
      // backend_review SHA-256 receipts; they must outlive HTTP HMAC key rotation.
      const requestHash = request === null ? null : requestDigest(request);
      if (operationId !== null && requestHash !== null) {
        const prior = await intakeReplay(client, who, command, request!, operationId, decode);
        if (prior) {
          if (await clock(client) >= Math.min(authorityDeadline, deadline, who.validUntil)) {
            throw new IntakeRejection('PERMISSION_CHANGED', 'FORBIDDEN');
          }
          committing = true;
          await client.query('COMMIT');
          return { ok: true, value: prior.value };
        }
      }
      const value = decode(await work(transaction, who));
      if (operationId !== null && requestHash !== null) await client.query(
        'INSERT INTO backend_review.receipts(actor_user_id,operation,request_key,request_hash,response) VALUES ($1,$2,$3,$4,$5::jsonb)',
        [who.userId, operation, operationId, requestHash, JSON.stringify(value)]);
      for (const check of finalChecks) await check();
      // Time spent queued or executing cannot borrow validity from transaction start.
      requireFresh(await principal(client, { id: who.id }), await clock(client));
      const now = await clock(client);
      if (now >= authorityDeadline) throw new IntakeRejection('PERMISSION_CHANGED', 'FORBIDDEN');
      if (now >= deadline) throw new IntakeRejection('PERMISSION_CHANGED', 'OVERLOADED');
      committing = true;
      await client.query('COMMIT');
      return { ok: true, value };
    } catch (error) {
      let rollbackFailure: unknown;
      if (client && !committing) {
        try { await client.query('ROLLBACK'); } catch (failure) { broken = true; rollbackFailure = failure; }
      } else if (client) broken = true;
      try { report(diagnosticId, rollbackFailure === undefined ? error
        : new AggregateError([error, rollbackFailure], 'intake transaction rollback failed')); }
      catch { /* Diagnostics must not change transaction certainty. */ }
      // A failed ROLLBACK cannot certify absence of a receipt or write either.
      // Keep the public code/reason aligned with the unknown commit state.
      if (committing || broken) return { ok: false, code: 'OVERLOADED', reason: 'COMMIT_UNKNOWN', commit: 'unknown', diagnosticId };
      const rejection = error instanceof IntakeRejection ? error
        : error instanceof Error && 'code' in error && error.code === 'ZA003' && error.message === 'SOURCE_FORMAT_MISMATCH'
          ? new IntakeRejection('SOURCE_FORMAT_MISMATCH', 'VALIDATION')
          : error instanceof ContractValidationError ? new IntakeRejection('FILE_INVALID', 'VALIDATION')
          : new IntakeRejection('COMMIT_UNKNOWN', 'INTERNAL_ERROR');
      return { ok: false, code: rejection.code, reason: rejection.reason, commit: 'rolled_back', diagnosticId };
    } finally {
      client?.release(broken);
    }
  };
}
