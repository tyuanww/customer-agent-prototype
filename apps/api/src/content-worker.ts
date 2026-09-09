import { createHash, randomBytes } from 'node:crypto';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { ContentObjectStore } from './content-object-store.js';
import {
  parkedRowPayload,
  parseImportFile,
  qualityTargets,
  selectionManifestHash,
} from './content-normalize.js';
import type { ApiDatabaseBootstrapConfig } from './runtime-config.js';

export type ContentWorker = Readonly<{
  runOnce: () => Promise<'idle' | 'parked' | 'finished' | 'failed'>;
  close: () => Promise<void>;
}>;

export type ContentWorkerOptions = Readonly<{
  intentTaxonomyVersion: string;
  intentId: string;
  leaseOwner?: string;
  leaseSeconds?: number;
  reviewCommitment?: Readonly<{
    leadSubject: string;
    managerSubject: string;
    evidenceId: string;
  }>;
}>;

interface ClaimRow extends QueryResultRow {
  claimed_job_id: string;
  claimed_job_type: string;
  job_payload: Record<string, unknown>;
  claimed_lease_version: string | number;
}

const RETRY_CODES = new Set([
  'VALIDATION_FAILED',
  'SOURCE_UNREADABLE',
  'HASH_MISMATCH',
  'UNSUPPORTED_FORMAT',
  'STORAGE_UNAVAILABLE',
]);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function payloadText(payload: unknown, key: string): string | undefined {
  if (payload === null || typeof payload !== 'object') return undefined;
  const value = Reflect.get(payload, key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function retryCode(error: unknown): string {
  const message = error !== null && typeof error === 'object'
    ? String(Reflect.get(error, 'message') ?? 'VALIDATION_FAILED')
    : 'VALIDATION_FAILED';
  const code = message.split(':')[0] ?? 'VALIDATION_FAILED';
  if (RETRY_CODES.has(code)) return code;
  if (code === 'CONTENT_CONTRACT_INVALID' || code === 'ROW_LIMIT_EXCEEDED' || code === 'CONTENT_TOO_LARGE') {
    return 'VALIDATION_FAILED';
  }
  return 'VALIDATION_FAILED';
}

/**
 * Independent import worker. It claims one job, never holds a DB transaction
 * across parse I/O, and only freeze/park/finish through fenced SQL.
 *
 * Parked content_hash is the frozen join key and must equal finalize's
 * post-review governance snapshot. Reviewer hashes are therefore a synthetic
 * pre-commitment: they are hashed into content_hash but never written into
 * parked JSON (REVIEW_EVIDENCE_TRUST_BOUNDARY).
 */
export function createContentWorker(
  config: ApiDatabaseBootstrapConfig,
  store: ContentObjectStore,
  options: ContentWorkerOptions,
): ContentWorker {
  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    statement_timeout: 8_000,
    query_timeout: 10_000,
    idle_in_transaction_session_timeout: 10_000,
    application_name: 'cs-ai-synthetic-content-worker',
    maxLifetimeSeconds: 300,
  });
  const leaseOwner = options.leaseOwner ?? `worker_${randomBytes(8).toString('hex')}`;
  const leaseSeconds = options.leaseSeconds ?? 60;
  const review = options.reviewCommitment === undefined ? undefined : {
    leadHash: sha256(options.reviewCommitment.leadSubject),
    managerHash: sha256(options.reviewCommitment.managerSubject),
    evidence: options.reviewCommitment.evidenceId,
  };
  let closed = false;

  async function withRole<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const admission = await client.query<{ allowed: boolean }>(`SELECT
        login.rolcanlogin AND NOT login.rolsuper
        AND NOT capability.rolcanlogin AND pg_has_role(login.oid, capability.oid, 'MEMBER')
        AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=login.oid AND m.roleid<>capability.oid)
        AS allowed FROM pg_roles login CROSS JOIN pg_roles capability
        WHERE login.rolname=current_user AND capability.rolname='app_backend_worker'`);
      if (admission.rows[0]?.allowed !== true) throw new Error('WORKER_ROLE_INVALID');
      await client.query('SET LOCAL ROLE app_backend_worker');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { broken = true; }
      throw error;
    } finally {
      client.release(broken);
    }
  }

  async function failJob(
    jobId: string,
    leaseVersion: string | number,
    code: string,
  ): Promise<void> {
    await withRole(async (client) => {
      await client.query(
        'SELECT public.retry_content_import_validation($1,$2,$3,$4,$5)',
        [jobId, leaseOwner, leaseVersion, 5, code],
      );
    });
  }

  return Object.freeze({
    async runOnce() {
      if (closed) return 'idle';
      const claimed = await withRole(async (client) => {
        const rows = await client.query<ClaimRow>(
          'SELECT * FROM public.claim_content_import_validation($1,$2)',
          [leaseOwner, leaseSeconds],
        );
        return rows.rows[0];
      }).catch(() => undefined);
      if (!claimed) return 'idle';
      const payload = claimed.job_payload ?? {};
      const batchId = payloadText(payload, 'import_batch_id');
      const revision = payloadText(payload, 'review_revision');
      const objectId = payloadText(payload, 'source_ref');
      if (!batchId) return 'failed';
      try {
        if (revision) {
          await withRole(async (client) => {
            await client.query('SELECT backend_review.finish($1,$2,$3,$4)', [
              claimed.claimed_job_id, leaseOwner, claimed.claimed_lease_version, batchId,
            ]);
          });
          return 'finished';
        }
        if (!objectId) {
          await failJob(claimed.claimed_job_id, claimed.claimed_lease_version, 'SOURCE_UNREADABLE');
          return 'failed';
        }
        await withRole(async (client) => {
          await client.query(
            'SELECT public.heartbeat_content_import_validation($1,$2,$3,$4)',
            [claimed.claimed_job_id, leaseOwner, claimed.claimed_lease_version, leaseSeconds],
          );
        });
        const bytes = await store.readPayload(objectId).catch(() => {
          throw new Error('SOURCE_UNREADABLE');
        });
        const sourceType = bytes.length >= 4
          && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
          ? 'excel' as const
          : 'csv' as const;
        const rows = parseImportFile(bytes, sourceType, {
          intentTaxonomyVersion: options.intentTaxonomyVersion,
          intentId: options.intentId,
          ...(review === undefined ? {} : { review }),
        });
        const ordinary = rows.filter((row) => row.risk_level !== 'high' && !row.has_conflict).length;
        const mandatory = rows.length - ordinary;
        const targets = qualityTargets(ordinary);
        const seed = sha256(`seed:${batchId}:${claimed.claimed_job_id}`);
        const planId = `qplan_${randomBytes(12).toString('hex')}`;
        const cutoff = new Date(Date.now() - 1_000).toISOString();
        const objectKey = `review/${objectId}`;
        const rowsJson = JSON.stringify(rows.map(parkedRowPayload));
        const selectionHash = selectionManifestHash(rows, seed, targets.initial, targets.expanded);
        await withRole(async (client) => {
          await client.query(
            'SELECT public.heartbeat_content_import_validation($1,$2,$3,$4)',
            [claimed.claimed_job_id, leaseOwner, claimed.claimed_lease_version, leaseSeconds],
          );
          await client.query(
            `SELECT * FROM public.freeze_content_quality_review_plan(
              $1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
            [
              claimed.claimed_job_id, leaseOwner, claimed.claimed_lease_version, batchId, planId,
              'quality-sampling-v1', cutoff, rows.length, ordinary, mandatory, seed,
              selectionHash, 'sha256-ranked-v1', rowsJson,
            ],
          );
          await client.query(
            'SELECT backend_review.park($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',
            [
              claimed.claimed_job_id, leaseOwner, claimed.claimed_lease_version, batchId, planId,
              objectKey, createHash('sha256').update(bytes).digest('hex'), bytes.length,
              rowsJson,
            ],
          );
        });
        return 'parked';
      } catch (error) {
        await failJob(claimed.claimed_job_id, claimed.claimed_lease_version, retryCode(error)).catch(() => undefined);
        return 'failed';
      }
    },
    close() {
      closed = true;
      return pool.end();
    },
  });
}
