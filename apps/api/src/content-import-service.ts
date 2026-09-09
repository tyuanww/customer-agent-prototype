import { randomBytes } from 'node:crypto';
import { parseContractSchema, validateContractSchema, type components } from '@customer-agent/contracts';
import { Readable } from 'node:stream';
import type { AuthenticatedUser } from './auth-service.js';
import { parseContentImportMultipart } from './content-import-multipart.js';
import {
  CONTENT_IMPORT_BATCH_ID_PATTERN,
  type ContentObjectStore,
  type ContentSourceType,
} from './content-object-store.js';
import type {
  CommitCertainty,
  ContentImportFailure,
  ContentImportRepository,
} from './content-import-repository.js';
import { hmacSafeValue, prepareIdempotencyHashes, type CanonicalJsonValue } from './idempotency.js';
import type { ApiHmacKeyRing } from './runtime-config.js';

type ImportAcceptedResponse = components['schemas']['ImportAcceptedResponse'];
type ImportStatusResponse = components['schemas']['ImportStatusResponse'];
type CancelImportResponse = components['schemas']['CancelImportResponse'];
type AuthoritativeSourceBinding = components['schemas']['AuthoritativeSourceBinding'];

export type ContentImportServiceResult<T> =
  | Readonly<{ ok: true; response: T }>
  | ContentImportFailure;

export type ContentImportService = Readonly<{
  acceptUpload: (request: Readonly<{
    actor: AuthenticatedUser;
    idempotencyKey: string;
    contentType: string;
    body: Readable | Buffer;
    maxBytes?: number;
    timeoutMs?: number;
  }>) => Promise<ContentImportServiceResult<ImportAcceptedResponse>>;
  readStatus: (
    actor: AuthenticatedUser,
    importBatchId: string,
  ) => Promise<ContentImportServiceResult<ImportStatusResponse>>;
  cancel: (request: Readonly<{
    actor: AuthenticatedUser;
    importBatchId: string;
    reason: string | null;
    idempotencyKey: string;
  }>) => Promise<ContentImportServiceResult<CancelImportResponse>>;
}>;

function importBatchId(): string {
  return `imp_${randomBytes(18).toString('base64url')}`;
}

function bindingsBody(
  bindings: readonly AuthoritativeSourceBinding[],
  sha256: string,
  sourceType: ContentSourceType,
): CanonicalJsonValue {
  return {
    source_type: sourceType,
    source_sha256: sha256,
    source_bindings: bindings.map((binding) => ({
      domain: binding.domain,
      source_version_id: binding.source_version_id,
    })),
  };
}

function parseBindings(raw: string): readonly AuthoritativeSourceBinding[] | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 4) return null;
  const bindings: AuthoritativeSourceBinding[] = [];
  const domains = new Set<string>();
  for (const item of parsed) {
    const result = validateContractSchema('AuthoritativeSourceBinding', item);
    if (!result.ok || domains.has(result.value.domain)) return null;
    domains.add(result.value.domain);
    bindings.push(result.value);
  }
  return bindings;
}

async function reclaimIfRolledBack(
  store: ContentObjectStore,
  objectId: string | undefined,
  commit: CommitCertainty,
): Promise<void> {
  if (objectId === undefined || commit !== 'rolled_back') return;
  await store.reclaim(objectId);
}

export function createContentImportService(
  store: ContentObjectStore,
  repository: ContentImportRepository,
  idempotencyHmac: ApiHmacKeyRing,
  logHash: Readonly<{ version: string; key: string }>,
): ContentImportService {
  return Object.freeze({
    async acceptUpload(request) {
      if (request.actor.role !== 'coach' && request.actor.role !== 'owner') {
        return Object.freeze({ ok: false, code: 'FORBIDDEN', commit: 'rolled_back' });
      }
      let persisted: Awaited<ReturnType<ContentObjectStore['persist']>> | undefined;
      let committed = false;
      try {
        if (!request.contentType.toLowerCase().startsWith('multipart/form-data')) {
          return Object.freeze({ ok: false, code: 'VALIDATION', commit: 'rolled_back' });
        }
        const limits = {
          ...(request.maxBytes === undefined ? {} : { maxFileBytes: request.maxBytes }),
          ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
        };
        const form = await parseContentImportMultipart(
          Buffer.isBuffer(request.body) ? Readable.from(request.body) : request.body,
          request.contentType,
          limits,
        );
        const bindings = parseBindings(form.sourceBindingsJson);
        if (bindings === null) {
          return Object.freeze({ ok: false, code: 'VALIDATION', commit: 'rolled_back' });
        }
        persisted = await store.persist(form.file, form.sourceType, {
          ...(request.maxBytes === undefined ? {} : { maxBytes: request.maxBytes }),
          ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
        });
        const readable = await store.verify(persisted.objectId, persisted.sha256, persisted.sizeBytes);
        if (!readable) {
          await store.reclaim(persisted.objectId);
          return Object.freeze({ ok: false, code: 'OVERLOADED', commit: 'rolled_back' });
        }
        const batchId = importBatchId();
        const actorSubjectHash = hmacSafeValue(
          `actor:${request.actor.user_id}`,
          logHash.version,
          logHash.key,
        );
        const denialDigest = hmacSafeValue(
          `source-denial:${request.actor.user_id}:${batchId}`,
          logHash.version,
          logHash.key,
        );
        const diagnosticDigest = hmacSafeValue(
          `diagnostic:${request.actor.user_id}:${batchId}`,
          logHash.version,
          logHash.key,
        );
        const result = await repository.enqueue({
          importBatchId: batchId,
          sourceType: persisted.sourceType,
          sourceRef: persisted.objectId,
          sourceSha256: persisted.sha256,
          sourceSizeBytes: persisted.sizeBytes,
          sourceBindings: bindings,
          actor: request.actor,
          idempotencyKey: request.idempotencyKey,
          requestHashes: prepareIdempotencyHashes(
            bindingsBody(bindings, persisted.sha256, persisted.sourceType),
            idempotencyHmac,
          ),
          sourceDenial: Object.freeze({
            denialKey: `sda_${denialDigest}`,
            actorSubjectHash,
            hashKeyVersion: logHash.version,
            diagnosticId: `diag_${diagnosticDigest.slice(0, 32)}`,
          }),
        });
        if (!result.ok) {
          await reclaimIfRolledBack(store, persisted.objectId, result.commit);
          return result;
        }
        committed = true;
        const existingReceipt = await store.readReceipt(result.response.import_batch_id);
        if (existingReceipt !== null) {
          await store.reclaim(persisted.objectId);
        } else {
          await store.writeReceipt({
            importBatchId: result.response.import_batch_id,
            objectId: persisted.objectId,
            sourceType: persisted.sourceType,
            sha256: persisted.sha256,
            sizeBytes: persisted.sizeBytes,
            sourceBindingHash: result.response.source_binding_hash,
            sourceBindings: bindings,
          });
        }
        return Object.freeze({ ok: true, response: result.response });
      } catch (error: unknown) {
        const validation = error instanceof Error && (
          error.message === 'CONTENT_UPLOAD_TOO_LARGE'
          || error.message === 'CONTENT_UPLOAD_TIMEOUT'
          || error.message === 'CONTENT_UPLOAD_TYPE'
          || error.message === 'CONTENT_UPLOAD_EMPTY'
          || error.message === 'CONTENT_UPLOAD_MULTIPART'
        );
        if (!committed) await reclaimIfRolledBack(store, persisted?.objectId, 'rolled_back');
        return Object.freeze({
          ok: false,
          code: validation ? 'VALIDATION' as const : 'OVERLOADED' as const,
          commit: committed ? 'unknown' as const : 'rolled_back' as const,
        });
      }
    },

    async readStatus(actor, importBatchId) {
      if (actor.role !== 'coach' && actor.role !== 'owner') {
        return Object.freeze({ ok: false, code: 'FORBIDDEN', commit: 'rolled_back' });
      }
      if (!CONTENT_IMPORT_BATCH_ID_PATTERN.test(importBatchId)) {
        return Object.freeze({ ok: false, code: 'VALIDATION', commit: 'rolled_back' });
      }
      const status = await repository.readStatus(importBatchId, actor);
      if (!status.ok) return status;
      const receipt = await store.readReceipt(importBatchId);
      if (receipt === null) {
        return Object.freeze({ ok: false, code: 'OVERLOADED', commit: 'committed' as const });
      }
      const refs = await repository.readSourceRefs(
        receipt.sourceBindings.map((binding) => binding.source_version_id),
      );
      const sourceBindings = receipt.sourceBindings.map((binding) => {
        const ref = refs.find((row) => row.source_version_id === binding.source_version_id
          && row.domain === binding.domain);
        return {
          domain: binding.domain,
          source_version_id: binding.source_version_id,
          source_ref: ref?.source_ref,
        };
      });
      if (sourceBindings.some((binding) => binding.source_ref === undefined)) {
        return Object.freeze({ ok: false, code: 'OVERLOADED', commit: 'committed' as const });
      }
      const payload = {
        import_batch_id: importBatchId,
        status: status.status,
        base_release_id: null,
        source_binding_hash: receipt.sourceBindingHash,
        source_bindings: sourceBindings,
        error_report: status.status === 'failed' ? status.errorReport : null,
        staged_count: 0,
        clean_count: status.cleanCount,
        quarantined_count: status.quarantinedCount,
        quality_gate_passed: status.qualityGatePassed,
        quality_review: null,
        preview: Array.isArray(status.preview) ? [] : [],
      };
      return Object.freeze({
        ok: true,
        response: parseContractSchema('ImportStatusResponse', payload),
      });
    },

    async cancel(request) {
      if (request.actor.role !== 'coach' && request.actor.role !== 'owner') {
        return Object.freeze({ ok: false, code: 'FORBIDDEN', commit: 'rolled_back' });
      }
      if (!CONTENT_IMPORT_BATCH_ID_PATTERN.test(request.importBatchId)) {
        return Object.freeze({ ok: false, code: 'VALIDATION', commit: 'rolled_back' });
      }
      return repository.cancel(
        request.importBatchId,
        request.reason,
        request.actor,
        request.idempotencyKey,
        prepareIdempotencyHashes({
          import_batch_id: request.importBatchId,
          reason: request.reason,
        }, idempotencyHmac),
      );
    },
  });
}
