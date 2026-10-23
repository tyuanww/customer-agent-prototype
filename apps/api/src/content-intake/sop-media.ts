import type { AuthenticatedUser } from '../auth-service.js';
import type { ContentAttachmentStore, LockedContentObject, ReservedAttachment } from '../content-object-store.js';
import { getJob } from './candidate.js';
import { mediaObjectId } from './linked-preview.js';
import { digest } from './material.js';
import { IntakeRejection, type IntakeResult, type createIntakeTransactions } from './transaction.js';

/** SQL-owned reservation facts. The media identity is derived from the adopted
 * input source and the exact bytes; callers never supply either descriptor. */
export type SopMediaReservation = { objectId: string; mediaObjectId: string; sourceId: string; sha256: string;
  bytes: number; mime: ReservedAttachment['mime']; state: 'reserved' | 'persisted' | 'adopted' | 'releasing' | 'released' };
type Run = ReturnType<typeof createIntakeTransactions>;

export function decodeSopMediaReservation(value: unknown): SopMediaReservation {
  const row = value as SopMediaReservation;
  if (!row || !/^obj_[0-9a-f]{64}$/.test(row.objectId) || !/^med_[0-9a-f]{64}$/.test(row.mediaObjectId)
    || !/^[0-9a-f]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > 5 * 1024 * 1024
    || !['image/png', 'image/jpeg', 'image/gif'].includes(row.mime)
    || !['reserved', 'persisted', 'adopted', 'releasing', 'released'].includes(row.state)) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  return row;
}

/** SQL raises business rejections as SQLSTATE classes; the API maps them once
 * here so every SOP media call reports the same reason for the same failure. */
export function sopSqlFailure(error: unknown): never {
  if (error instanceof Error && 'code' in error) {
    if (error.code === 'ZA001') throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
    if (error.code === 'ZA003') {
      if (error.message === 'QUOTA_EXCEEDED') throw new IntakeRejection('QUOTA_EXCEEDED', 'RATE_LIMITED');
      if (error.message === 'SCOPE_DENIED') throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
      if (['MATERIAL_CHANGED', 'SOURCE_MISMATCH', 'BASE_CHANGED', 'COMMIT_UNKNOWN'].includes(error.message)) {
        const rejection = new IntakeRejection(error.message as 'MATERIAL_CHANGED'); rejection.cause = error; throw rejection;
      }
    }
  }
  throw error;
}

export function attachmentDescriptor(row: Pick<SopMediaReservation, 'objectId' | 'sha256' | 'bytes' | 'mime'>): ReservedAttachment {
  return { objectId: row.objectId, sha256: row.sha256, sizeBytes: row.bytes, mime: row.mime };
}

/** One fixed (job, media) reservation is the unit of recovery. The filesystem
 * capability owns exclusion even when the database connection disappears. SQL
 * owns quota/state/authorization; no quota or orphan policy is duplicated here. */
export function createSopMediaLifecycle(run: Run, store: ContentAttachmentStore) {
  const call = (actor: AuthenticatedUser, jobId: string,
    action: 'reserve' | 'complete' | 'begin-release' | 'complete-release', args: unknown[]) =>
    run(actor, `sop-media-${action}`, null, null, async (client, who) => {
      // SQL checks entry authority, while authorize also binds its deadline to
      // the transaction's final clock check. Cleanup deliberately needs only
      // the original reservation identity, even after import is revoked.
      if (action === 'reserve' || action === 'complete') await getJob(client, who, jobId);
      const names = { reserve: 'reserve_sop_media_payload', complete: 'complete_sop_media_payload',
        'begin-release': 'begin_sop_media_release', 'complete-release': 'complete_sop_media_release' } as const;
      const parameters = [who.id, jobId, ...args];
      const value = (await client.query<{ value: unknown }>(
        `SELECT content_intake.${names[action]}(${parameters.map((_, i) => `$${i + 1}`).join(',')}) AS value`, parameters)
        .catch(sopSqlFailure)).rows[0]?.value;
      return decodeSopMediaReservation(value);
    }, decodeSopMediaReservation);
  const releaseLocked = async (actor: AuthenticatedUser, jobId: string, reservation: SopMediaReservation,
    locked: LockedContentObject): Promise<IntakeResult<SopMediaReservation>> => {
    const begun = await call(actor, jobId, 'begin-release', [reservation.mediaObjectId, reservation.objectId]);
    if (!begun.ok || begun.value.state !== 'releasing') return begun;
    if (await locked.reclaim() !== 'reclaimed') throw new IntakeRejection('MATERIAL_CHANGED');
    return call(actor, jobId, 'complete-release', [reservation.mediaObjectId, reservation.objectId]);
  };
  const cleanupFailure = async (actor: AuthenticatedUser, jobId: string, reservation: SopMediaReservation,
    locked: LockedContentObject, original: unknown): Promise<void> => {
    try {
      const released = await releaseLocked(actor, jobId, reservation, locked);
      if (!released.ok) throw released;
    } catch (cleanup) {
      // Preserve both diagnostics. A failed/unknown release remains charged; no
      // retry, TTL, lock stealing or unguarded file deletion is attempted here.
      throw new AggregateError([original, cleanup], 'SOP_MEDIA_WRITE_AND_RELEASE_FAILED');
    }
  };
  return {
    async persist(actor: AuthenticatedUser, jobId: string, sourceId: string, bytes: Buffer, mime: ReservedAttachment['mime']): Promise<IntakeResult<SopMediaReservation>> {
      const args = [mediaObjectId(sourceId, bytes), digest(bytes), bytes.length, mime];
      const reserved = await call(actor, jobId, 'reserve', args);
      if (!reserved.ok) return reserved;
      return store.withObjectLock(reserved.value.objectId, async locked => {
        // The first COMMIT obtains a stable key; after the file lock, recheck the
        // authoritative state. Cleanup uses the already-known descriptor even
        // when current import authority has been revoked in the meantime.
        const current = await call(actor, jobId, 'reserve', args);
        if (!current.ok) {
          if (current.commit === 'rolled_back') await cleanupFailure(actor, jobId, reserved.value, locked, current);
          return current;
        }
        if (current.value.objectId !== reserved.value.objectId || current.value.sourceId !== sourceId
          || ['releasing', 'released'].includes(current.value.state)) throw new IntakeRejection('MATERIAL_CHANGED');
        const expected = attachmentDescriptor(current.value);
        try {
          if (current.value.state === 'reserved') await locked.persistAttachment(expected, bytes);
          else await locked.readAttachment(expected);
        } catch (error) {
          await cleanupFailure(actor, jobId, current.value, locked, error);
          throw error;
        }
        if (current.value.state !== 'reserved') return current;
        const completed = await call(actor, jobId, 'complete', [current.value.mediaObjectId, current.value.objectId]);
        if (!completed.ok && completed.commit === 'rolled_back') await cleanupFailure(actor, jobId, current.value, locked, completed);
        return completed;
      });
    },
    async release(actor: AuthenticatedUser, jobId: string, reservation: SopMediaReservation): Promise<IntakeResult<SopMediaReservation>> {
      return store.withObjectLock(reservation.objectId, locked => releaseLocked(actor, jobId, reservation, locked));
    },
  };
}
