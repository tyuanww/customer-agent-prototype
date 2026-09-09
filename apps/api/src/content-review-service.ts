import { Pool } from 'pg';
import { parseContractSchema } from '@customer-agent/contracts';
import { IdentityFailure } from './product-auth-service.js';
import type { ApiDatabaseBootstrapConfig } from './runtime-config.js';

export type ContentReviewService = Readonly<{
  list: (token: string, cursor: string | null, limit: number) => Promise<unknown>;
  page: (token: string, batchId: string, revision: string, after: number, limit: number) => Promise<unknown>;
  decide: (token: string, batchId: string, key: string, body: unknown) => Promise<unknown>;
  quality: (token: string, batchId: string, key: string, body: unknown) => Promise<unknown>;
  resume: (token: string, batchId: string, revision: string) => Promise<unknown>;
  cancel: (token: string, batchId: string) => Promise<unknown>;
  close: () => Promise<void>;
}>;

function identityFailure(error: unknown): IdentityFailure {
  if (error instanceof IdentityFailure) return error;
  if (error !== null && typeof error === 'object') {
    const sqlState = String(Reflect.get(error, 'code') ?? '');
    const tokens = [
      String(Reflect.get(error, 'message') ?? ''),
      String(Reflect.get(error, 'detail') ?? ''),
    ];
    if (tokens.includes('SESSION_INVALID')) return new IdentityFailure('SESSION_INVALID');
    if (tokens.includes('CAPABILITY_DENIED') || sqlState === 'ZA005') {
      return new IdentityFailure('CAPABILITY_DENIED');
    }
    if (tokens.includes('LOGIN_INVALID') || tokens.includes('VALIDATION') || sqlState === 'ZA001') {
      return new IdentityFailure('REQUEST_INVALID');
    }
    if (sqlState === 'ZA003' || sqlState === 'ZA006' || tokens.some((token) => [
      'REVIEW_STALE', 'IDEMPOTENCY_CONFLICT', 'REVIEW_CANCELLED',
      'QUALITY_GATE_NOT_PASSED', 'REVIEW_EVIDENCE_MISSING',
    ].includes(token))) {
      return new IdentityFailure('LOGIN_CONSUMED');
    }
  }
  return new IdentityFailure('DEPENDENCY_UNAVAILABLE');
}

function asIso(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function createContentReviewService(config: ApiDatabaseBootstrapConfig): ContentReviewService {
  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    statement_timeout: 8_000,
    query_timeout: 10_000,
    idle_in_transaction_session_timeout: 10_000,
    application_name: 'cs-ai-synthetic-content-review',
    maxLifetimeSeconds: 300,
  });

  async function query<T>(sql: string, values: unknown[]): Promise<T> {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const admission = await client.query<{ allowed: boolean }>(`SELECT
        login.rolcanlogin AND NOT login.rolsuper
        AND NOT capability.rolcanlogin AND pg_has_role(login.oid, capability.oid, 'MEMBER')
        AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=login.oid AND m.roleid<>capability.oid)
        AS allowed FROM pg_roles login CROSS JOIN pg_roles capability
        WHERE login.rolname=current_user AND capability.rolname='app_backend_review'`);
      if (admission.rows[0]?.allowed !== true) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
      await client.query('SET LOCAL ROLE app_backend_review');
      const result = await client.query(sql, values);
      await client.query('COMMIT');
      return result.rows[0] as T;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { broken = true; }
      throw identityFailure(error);
    } finally {
      client.release(broken);
    }
  }

  return Object.freeze({
    async list(token, cursor, limit) {
      const row = await query<{ list: unknown }>('SELECT backend_review.list($1,$2,$3) AS list', [token, cursor, limit]);
      return parseContractSchema('ReviewList', row.list);
    },
    async page(token, batchId, revision, after, limit) {
      const row = await query<{ page: unknown }>('SELECT backend_review.page($1,$2,$3,$4,$5) AS page', [
        token, batchId, revision, after, limit,
      ]);
      return parseContractSchema('ReviewPage', row.page);
    },
    async decide(token, batchId, key, body) {
      const value = parseContractSchema('ReviewDecision', body);
      const row = await query<{ decision: Record<string, unknown> }>(
        'SELECT backend_review.decision($1,$2,$3,$4,$5,$6,$7,$8) AS decision',
        [token, batchId, value.review_revision, key, value.script_id, value.content_hash, value.decision, value.evidence_id],
      );
      const decision = row.decision;
      return parseContractSchema('ReviewReceipt', {
        receipt_id: decision.receipt_id,
        batch_id: decision.batch_id,
        review_revision: decision.review_revision,
        recorded_at: asIso(decision.recorded_at),
      });
    },
    async quality(token, batchId, key, body) {
      const value = parseContractSchema('QualityEvidence', body);
      const row = await query<{ quality: Record<string, unknown> }>(
        'SELECT backend_review.quality($1,$2,$3,$4,$5,$6::jsonb,$7) AS quality',
        [token, batchId, value.review_revision, key, value.phase, JSON.stringify(value.checks), value.evidence_id],
      );
      const quality = row.quality;
      return parseContractSchema('QualityReceipt', {
        receipt_id: quality.receipt_id,
        batch_id: quality.batch_id,
        review_revision: quality.review_revision,
        recorded_at: asIso(quality.recorded_at),
        quality_state: quality.quality_state,
      });
    },
    async resume(token, batchId, revision) {
      const row = await query<{ job_id: string }>('SELECT backend_review.resume($1,$2,$3) AS job_id', [
        token, batchId, revision,
      ]);
      return parseContractSchema('ReviewResumed', { job_id: row.job_id });
    },
    async cancel(token, batchId) {
      await query('SELECT backend_review.cancel($1,$2)', [token, batchId]);
      return parseContractSchema('CancelImportResponse', {
        ok: true, import_batch_id: batchId, status: 'failed',
      });
    },
    close: () => pool.end(),
  });
}
