import { randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { AuthenticatedUser } from './auth-service.js';
import { mapDatabaseContractError } from './database-contract-errors.js';
import type { PreparedIdempotencyHashes } from './idempotency.js';
import type { OperationFailureCode } from './operation-result.js';
import {
  createApiRuntimeDiagnostic,
  type ApiRuntimeDiagnosticSink,
} from './runtime-diagnostics.js';
import type { ContentSourceType } from './content-object-store.js';

type ImportAcceptedResponse = components['schemas']['ImportAcceptedResponse'];
type ImportStatusResponse = components['schemas']['ImportStatusResponse'];
type SourceContractReason = components['schemas']['SourceContractReason'];

export type CommitCertainty = 'committed' | 'rolled_back' | 'unknown';

export type ContentImportFailure = Readonly<{
  ok: false;
  code: OperationFailureCode;
  reason?: SourceContractReason;
  commit: CommitCertainty;
}>;

export type ContentImportEnqueueRequest = Readonly<{
  importBatchId: string;
  sourceType: ContentSourceType;
  sourceRef: string;
  sourceSha256: string;
  sourceSizeBytes: number;
  sourceBindings: readonly Readonly<{ domain: string; source_version_id: string }>[];
  actor: AuthenticatedUser;
  idempotencyKey: string;
  requestHashes: PreparedIdempotencyHashes;
  sourceDenial: Readonly<{
    denialKey: string;
    actorSubjectHash: string;
    hashKeyVersion: string;
    diagnosticId: string;
  }>;
}>;

export type ContentImportEnqueueSuccess = Readonly<{
  ok: true;
  commit: 'committed';
  response: ImportAcceptedResponse;
}>;

export type ContentImportStatusSuccess = Readonly<{
  ok: true;
  commit: 'committed';
  status: components['schemas']['ImportStatus'];
  qualityGatePassed: boolean;
  cleanCount: number;
  quarantinedCount: number;
  errorReport: unknown;
  preview: unknown;
}>;

export type ContentImportCancelSuccess = Readonly<{
  ok: true;
  commit: 'committed';
  response: components['schemas']['CancelImportResponse'];
}>;

export type SourceRefRow = Readonly<{
  domain: string;
  source_version_id: string;
  source_ref: string;
}>;

export type ContentImportRepository = Readonly<{
  enqueue: (request: ContentImportEnqueueRequest) => Promise<ContentImportEnqueueSuccess | ContentImportFailure>;
  readStatus: (
    importBatchId: string,
    actor: AuthenticatedUser,
  ) => Promise<ContentImportStatusSuccess | ContentImportFailure>;
  cancel: (
    importBatchId: string,
    reason: string | null,
    actor: AuthenticatedUser,
    idempotencyKey: string,
    requestHashes: PreparedIdempotencyHashes,
  ) => Promise<ContentImportCancelSuccess | ContentImportFailure>;
  readSourceRefs: (sourceVersionIds: readonly string[]) => Promise<readonly SourceRefRow[]>;
}>;

type ImportPool = Pick<Pool, 'connect'>;

interface IdempotencyRow extends QueryResultRow {
  action: 'miss' | 'proceed' | 'replay' | 'conflict';
  response_body: unknown;
  lease_version?: string | number;
}

interface EnqueueRow extends QueryResultRow {
  import_batch_id: string;
  status: string;
  job_id: string;
  source_binding_hash: string;
}

interface StatusRow extends QueryResultRow {
  import_batch_id: string;
  status: string;
  quality_gate_passed: boolean;
  clean_count: number;
  quarantined_count: number;
  error_report: unknown;
}

const ENQUEUE_SCOPE = '/v1/content/import';
const CANCEL_SCOPE = '/v1/content/import/cancel';
const IDEMPOTENCY_LEASE_SECONDS = 60;
const SOURCE_DENIAL_DETAILS = new Set<string>([
  'SOURCE_NOT_REGISTERED',
  'SOURCE_NOT_ELIGIBLE',
  'SOURCE_SUSPENDED',
  'SOURCE_DOMAIN_MISMATCH',
  'SOURCE_SNAPSHOT_MISMATCH',
  'SOURCE_SET_INCOMPLETE',
]);
const SOURCE_DENIAL_FORBIDDEN = new Set<string>([
  'SOURCE_NOT_ELIGIBLE',
  'SOURCE_SUSPENDED',
]);

function failure(
  code: OperationFailureCode,
  commit: CommitCertainty,
  reason?: SourceContractReason,
): ContentImportFailure {
  return Object.freeze(reason === undefined ? { ok: false, code, commit } : { ok: false, code, commit, reason });
}

async function rollback(client: PoolClient): Promise<boolean> {
  try {
    await client.query('ROLLBACK');
    return true;
  } catch {
    return false;
  }
}

function commitCertaintyAfterError(rolledBack: boolean): CommitCertainty {
  return rolledBack ? 'rolled_back' : 'unknown';
}

function sourceReason(error: unknown): SourceContractReason | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const detail = String(Reflect.get(error, 'detail') ?? '');
  return SOURCE_DENIAL_DETAILS.has(detail) ? detail as SourceContractReason : undefined;
}

function isUnknownCommitError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' && (code.startsWith('08') || code === '57P01' || code === '57P02');
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

export function unavailableContentImportRepository(): ContentImportRepository {
  const unavailable = async (): Promise<ContentImportFailure> => failure('OVERLOADED', 'rolled_back');
  return Object.freeze({
    enqueue: unavailable,
    readStatus: unavailable,
    cancel: unavailable,
    readSourceRefs: async () => [],
  });
}

export function createContentImportRepository(
  pool: ImportPool,
  diagnosticSink: ApiRuntimeDiagnosticSink = () => undefined,
  leaseOwner = `api_${randomUUID().replaceAll('-', '')}`,
): ContentImportRepository {
  function report(error: unknown): void {
    try {
      diagnosticSink(createApiRuntimeDiagnostic('CONTENT_IMPORT_FAILED', error));
    } catch {
      // Diagnostics never replace the HTTP contract.
    }
  }

  async function recordSourceDenial(
    request: ContentImportEnqueueRequest,
    reason: SourceContractReason,
    sourceVersionId: string | null,
  ): Promise<boolean> {
    const audit = await pool.connect().catch(() => null);
    if (audit === null) return false;
    let broken = false;
    try {
      await audit.query('BEGIN');
      await audit.query(
        `SELECT public.record_runtime_source_denial_audit(
          $1, 'content_import', $2, $3, $4, $5, NULL, $6, NULL, $7
        )`,
        [
          request.sourceDenial.denialKey,
          reason,
          request.sourceDenial.actorSubjectHash,
          request.sourceDenial.hashKeyVersion,
          request.actor.role,
          sourceVersionId,
          request.sourceDenial.diagnosticId,
        ],
      );
      await audit.query('COMMIT');
      return true;
    } catch (error) {
      broken = !(await rollback(audit));
      try {
        diagnosticSink(createApiRuntimeDiagnostic('SOURCE_DENIAL_AUDIT_FAILED', error));
      } catch {
        // Observational.
      }
      return false;
    } finally {
      audit.release(broken);
    }
  }

  return Object.freeze({
    async enqueue(request): Promise<ContentImportEnqueueSuccess | ContentImportFailure> {
      const client = await pool.connect().catch(() => null);
      if (client === null) return failure('OVERLOADED', 'rolled_back');
      let broken = false;
      let denied: SourceContractReason | undefined;
      let deniedSource: string | null = request.sourceBindings[0]?.source_version_id ?? null;
      try {
        await client.query('BEGIN');
        const claim = await claimIdempotency(
          client,
          ENQUEUE_SCOPE,
          request.idempotencyKey,
          request.actor.user_id,
          request.requestHashes,
          leaseOwner,
        );
        if (claim.action === 'replay') {
          const response = parseContractSchema('ImportAcceptedResponse', claim.responseBody);
          await client.query('COMMIT');
          return Object.freeze({ ok: true, commit: 'committed', response });
        }
        if (claim.action === 'conflict') {
          const rolledBack = await rollback(client);
          broken = !rolledBack;
          return failure('CONFLICT', commitCertaintyAfterError(rolledBack));
        }
        if (claim.action === 'failure') {
          const rolledBack = await rollback(client);
          broken = !rolledBack;
          return failure(claim.code, commitCertaintyAfterError(rolledBack));
        }
        const result = await client.query<EnqueueRow>(
          `SELECT * FROM public.enqueue_content_import($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
          [
            request.importBatchId,
            request.sourceType === 'csv' ? 'csv' : 'excel',
            request.sourceRef,
            request.sourceSha256,
            request.sourceSizeBytes,
            JSON.stringify(request.sourceBindings),
            request.actor.user_id,
            request.actor.role,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new Error('enqueue returned no row');
        const response = parseContractSchema('ImportAcceptedResponse', {
          import_batch_id: row.import_batch_id,
          status: 'validating',
          source_binding_hash: row.source_binding_hash,
        });
        await client.query(
          'SELECT public.idempotency_complete($1, $2, $3, $4, 202, $5::jsonb, TRUE)',
          [ENQUEUE_SCOPE, request.idempotencyKey, leaseOwner, claim.leaseVersion, JSON.stringify(response)],
        );
        try {
          await client.query('COMMIT');
        } catch (error) {
          broken = true;
          return failure(isUnknownCommitError(error) ? 'OVERLOADED' : 'INTERNAL', 'unknown');
        }
        return Object.freeze({ ok: true, commit: 'committed', response });
      } catch (error: unknown) {
        const rolledBack = await rollback(client);
        broken = !rolledBack;
        denied = sourceReason(error);
        if (denied) deniedSource = request.sourceBindings[0]?.source_version_id ?? null;
        if (!denied) {
          const code = mapDatabaseContractError(error);
          if (code === 'INTERNAL') report(error);
          return failure(code, commitCertaintyAfterError(rolledBack));
        }
        if (!rolledBack) return failure('OVERLOADED', 'unknown');
      } finally {
        client.release(broken);
      }
      if (denied === undefined) return failure('INTERNAL', 'unknown');
      const audited = await recordSourceDenial(request, denied, deniedSource);
      if (!audited) return failure('OVERLOADED', 'rolled_back');
      return failure(
        SOURCE_DENIAL_FORBIDDEN.has(denied) ? 'FORBIDDEN' : 'VALIDATION',
        'rolled_back',
        denied,
      );
    },

    async readStatus(importBatchId, actor) {
      const client = await pool.connect().catch(() => null);
      if (client === null) return failure('OVERLOADED', 'rolled_back');
      try {
        const status = await client.query<StatusRow>(
          'SELECT * FROM public.read_content_import_status($1, $2, $3)',
          [importBatchId, actor.user_id, actor.role],
        );
        const row = status.rows[0];
        if (!row) return failure('NOT_FOUND', 'committed');
        const preview = await client.query<{ rows_json: unknown }>(
          'SELECT rows_json FROM public.read_content_import_preview($1, $2, $3, NULL, 100)',
          [importBatchId, actor.user_id, actor.role],
        );
        return Object.freeze({
          ok: true,
          commit: 'committed',
          status: row.status as components['schemas']['ImportStatus'],
          qualityGatePassed: row.quality_gate_passed,
          cleanCount: row.clean_count,
          quarantinedCount: row.quarantined_count,
          errorReport: row.error_report,
          preview: preview.rows[0]?.rows_json ?? [],
        });
      } catch (error: unknown) {
        const code = mapDatabaseContractError(error);
        if (code === 'INTERNAL') report(error);
        return failure(code, 'rolled_back');
      } finally {
        client.release();
      }
    },

    async cancel(importBatchId, reason, actor, idempotencyKey, requestHashes) {
      const client = await pool.connect().catch(() => null);
      if (client === null) return failure('OVERLOADED', 'rolled_back');
      let broken = false;
      try {
        await client.query('BEGIN');
        const claim = await claimIdempotency(
          client,
          CANCEL_SCOPE,
          idempotencyKey,
          actor.user_id,
          requestHashes,
          leaseOwner,
        );
        if (claim.action === 'replay') {
          const response = parseContractSchema('CancelImportResponse', claim.responseBody);
          await client.query('COMMIT');
          return Object.freeze({ ok: true, commit: 'committed', response });
        }
        if (claim.action === 'conflict') {
          broken = !(await rollback(client));
          return failure('CONFLICT', commitCertaintyAfterError(!broken));
        }
        if (claim.action === 'failure') {
          broken = !(await rollback(client));
          return failure(claim.code, commitCertaintyAfterError(!broken));
        }
        await client.query(
          'SELECT public.cancel_content_import($1, $2, $3, $4)',
          [importBatchId, reason, actor.user_id, actor.role],
        );
        const response = parseContractSchema('CancelImportResponse', {
          ok: true,
          import_batch_id: importBatchId,
          status: 'failed',
        });
        await client.query(
          'SELECT public.idempotency_complete($1, $2, $3, $4, 200, $5::jsonb, TRUE)',
          [CANCEL_SCOPE, idempotencyKey, leaseOwner, claim.leaseVersion, JSON.stringify(response)],
        );
        try {
          await client.query('COMMIT');
        } catch (error) {
          broken = true;
          return failure(isUnknownCommitError(error) ? 'OVERLOADED' : 'INTERNAL', 'unknown');
        }
        return Object.freeze({ ok: true, commit: 'committed', response });
      } catch (error: unknown) {
        const rolledBack = await rollback(client);
        broken = !rolledBack;
        const code = mapDatabaseContractError(error);
        if (code === 'INTERNAL') report(error);
        return failure(code, commitCertaintyAfterError(rolledBack));
      } finally {
        client.release(broken);
      }
    },

    async readSourceRefs(sourceVersionIds) {
      if (sourceVersionIds.length === 0) return [];
      const client = await pool.connect().catch(() => null);
      if (client === null) return [];
      try {
        const result = await client.query<SourceRefRow>(
          `SELECT domain, source_version_id, source_ref
           FROM public.authoritative_source_versions
           WHERE source_version_id = ANY($1::text[])`,
          [sourceVersionIds],
        );
        return result.rows.map((row) => Object.freeze({
          domain: row.domain,
          source_version_id: row.source_version_id,
          source_ref: row.source_ref,
        }));
      } catch {
        return [];
      } finally {
        client.release();
      }
    },
  });
}

export type { ImportStatusResponse };
