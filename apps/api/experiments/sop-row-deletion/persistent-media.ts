import type { ContentAttachmentStore, ReservedAttachment } from '../../src/content-object-store.js';
import type { IntakePreviewItem, IntakePreviewReader } from '../../src/content-intake/usage.js';
import { IntakeRejection } from '../../src/content-intake/transaction.js';
import { sopSqlFailure } from './media-lifecycle.js';

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

/** Candidate-only adapter. SQL owns immutable release/row linkage, the existing
 * usage owner retains session, lease and selection authorization. No file path
 * or private payload ID is exposed by usage's response encoder. */
export function createSopPreviewReader(store: Pick<ContentAttachmentStore, 'readAttachment'>): IntakePreviewReader {
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
      try { return await store.readAttachment(item.storage as ReservedAttachment); }
      catch { return invalid(); }
    },
  };
}
