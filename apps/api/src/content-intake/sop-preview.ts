import type { ContentAttachmentStore, ReservedAttachment } from '../content-object-store.js';
import { listPreviews } from './linked-preview.js';
import { sopSqlFailure } from './sop-media.js';
import { IntakeRejection } from './transaction.js';
import type { IntakePreviewItem, IntakePreviewReader } from './usage.js';

function invalid(): never { throw new IntakeRejection('FILE_INVALID', 'VALIDATION'); }
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) return invalid();
  return value as string[];
}
function descriptor(item: Record<string, unknown>): ReservedAttachment {
  if (typeof item.payloadObjectId !== 'string' || !/^obj_[0-9a-f]{64}$/.test(item.payloadObjectId)
    || typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256)
    || !Number.isSafeInteger(item.bytes) || Number(item.bytes) < 1 || Number(item.bytes) > 5 * 1024 * 1024
    || !['image/png', 'image/jpeg', 'image/gif'].includes(String(item.mime))) return invalid();
  return { objectId: item.payloadObjectId, sha256: item.sha256, sizeBytes: Number(item.bytes),
    mime: item.mime as ReservedAttachment['mime'] };
}

/** The release projection is the byte authority for published images. SQL owns
 * the release/row/media linkage; this adapter only decodes what the entitlement
 * already authorized and never exposes the private payload id. */
export function createSopPreviewReader(store: Partial<Pick<ContentAttachmentStore, 'readAttachment'>>): IntakePreviewReader {
  return {
    async list(client, context) {
      const result = await client.query<{ value: { items: unknown[] } }>(
        'SELECT content_intake.read_sop_release_assets($1,$2,$3) AS value',
        [context.principalId, context.entitlementHash, context.sessionTokenHash]).catch(sopSqlFailure);
      const items = result.rows[0]?.value?.items;
      if (!Array.isArray(items)) return invalid();
      return items.map((raw): IntakePreviewItem => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
        const item = raw as Record<string, unknown>, payload = descriptor(item);
        if (typeof item.objectId !== 'string' || !/^med_[0-9a-f]{64}$/.test(item.objectId)
          || typeof item.sourceId !== 'string' || typeof item.rowId !== 'string'
          || (item.familySourceId !== null && typeof item.familySourceId !== 'string') || typeof item.operation !== 'string') return invalid();
        for (const field of ['effectiveFrom', 'effectiveTo']) {
          if (item[field] !== null && (typeof item[field] !== 'string' || !Number.isFinite(Date.parse(item[field] as string)))) return invalid();
        }
        return { objectId: item.objectId, sha256: payload.sha256, sourceId: item.sourceId, rowId: item.rowId,
          mime: payload.mime, sizeBytes: payload.sizeBytes, storage: payload,
          productRefIds: strings(item.productRefIds), scenarioRefIds: strings(item.scenarioRefIds), familySourceId: item.familySourceId ?? '',
          operation: item.operation, effectiveFrom: item.effectiveFrom as string | null, effectiveTo: item.effectiveTo as string | null };
      });
    },
    async read(item) {
      // Only metadata produced by this adapter reaches here; readAttachment still
      // validates the descriptor, exact byte size, magic and digest independently.
      if (!store.readAttachment) return invalid();
      try { return await store.readAttachment(item.storage as ReservedAttachment); }
      catch { return invalid(); }
    },
  };
}

/** Two sources, one authorization decision. A published release answers from the SQL
 * projection, so its bytes survive a restart and a second process. The staged generation
 * is a same-process fallback keyed by the release id, which publication adopts onto the
 * release when the candidate is published. Entries still under review have no release
 * entitlement, so this reader never serves them. */
export function createReleasePreviewReader(store: Partial<Pick<ContentAttachmentStore, 'readAttachment'>>): IntakePreviewReader {
  const released = createSopPreviewReader(store);
  return {
    async list(client, context) {
      const published = await released.list(client, context);
      const seen = new Set(published.map(item => item.objectId));
      const staged = listPreviews(context.releaseId, context.sourceIds)
        .filter(item => !seen.has(item.objectId))
        .map(item => ({ ...item, sizeBytes: item.bytes.length, storage: item.bytes }));
      return [...published, ...staged];
    },
    async read(item) {
      if (Buffer.isBuffer(item.storage)) return item.storage;
      return released.read(item);
    },
  };
}
