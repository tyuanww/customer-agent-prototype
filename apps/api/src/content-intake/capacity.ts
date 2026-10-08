import type { PoolClient } from 'pg';
import { CONTENT_UPLOAD_MAX_BYTES, type ContentObjectStore, type ContentSourceType, type PersistedContentObject } from '../content-object-store.js';
import { IntakeRejection, type IntakePool } from './transaction.js';

export const INTAKE_TEMPORARY_BYTES = 1024 * 1024 * 1024;
type Query = Pick<PoolClient, 'query'>;
type Purpose = 'input' | 'report' | 'review-package';

/** Private admission owner. Every file is charged before writing, then adopted in
 * its business transaction. It never guesses whether an interrupted command
 * committed. No lease expiry authorizes historical deletion. Disk I/O stays
 * outside the existing content lock; releasing is a tombstone against adoption. */
export function createIntakeCapacity(pool: IntakePool, store: ContentObjectStore,
  report: (error: unknown) => void) {
  async function transaction<T>(work: (client: Query) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s'");
      await client.query('SELECT backend_review.lock_content()');
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      broken = true;
      try { await client.query('ROLLBACK'); } catch { /* Keep all charges on uncertain outcomes. */ }
      throw error;
    } finally { client.release(broken); }
  }
  async function discard(objectId: string): Promise<void> {
    const claimed = await transaction(async client => {
      // An adopted object protects all downstream candidate, approval, publication
      // and receipt references. Their retention policy is deliberately separate.
      const changed = await client.query(`UPDATE content_intake.object_reservations r
        SET state='releasing',updated_at=clock_timestamp() WHERE object_id=$1
        AND state IN ('reserved','persisted','releasing')
        AND NOT EXISTS (SELECT 1 FROM content_intake.objects o WHERE o.object_id=r.object_id)
        RETURNING object_id`, [objectId]);
      return changed.rowCount === 1;
    });
    if (!claimed) return;
    // Failed/retained deletion continues consuming the entire reservation. A
    // subsequent retry is safe; released is recorded only after disk confirms.
    if (await store.reclaim(objectId) !== 'reclaimed') return;
    await transaction(async client => {
      await client.query(`UPDATE content_intake.object_reservations SET state='released',updated_at=clock_timestamp()
        WHERE object_id=$1 AND state='releasing'`, [objectId]);
    });
  }
  return {
    async persist(userId: string, sourceId: string | null, purpose: Purpose,
      bytes: AsyncIterable<Buffer>, type: ContentSourceType, maxBytes = CONTENT_UPLOAD_MAX_BYTES): Promise<PersistedContentObject> {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > INTAKE_TEMPORARY_BYTES) throw new IntakeRejection('FILE_LIMIT', 'VALIDATION');
      let admitted: string | undefined;
      let object: PersistedContentObject;
      try {
        object = await store.persist(bytes, type, { maxBytes, beforeWrite: async objectId => {
          await transaction(async client => {
            const found = await client.query<{ principal_id: string; tenant_id: string; app_id: string }>(
              `SELECT p.principal_id,p.tenant_id,p.app_id FROM content_intake.principals p WHERE user_id=$1
                AND ($2::text IS NULL OR EXISTS(SELECT 1 FROM content_intake.sources s
                  JOIN content_intake.scopes k USING(scope_id) WHERE s.source_id=$2
                  AND k.tenant_id=p.tenant_id AND k.app_id=p.app_id))`, [userId, sourceId]);
            const who = found.rows[0];
            if (!who) throw new IntakeRejection('SCOPE_DENIED', 'FORBIDDEN');
            const used = await client.query<{ bytes: string }>(`SELECT
              (SELECT coalesce(sum(bytes),0) FROM content_intake.objects WHERE tenant_id=$1) +
              (SELECT coalesce(sum(reserved_bytes),0) FROM content_intake.object_reservations
                WHERE tenant_id=$1 AND state IN ('reserved','persisted','releasing')) AS bytes`, [who.tenant_id]);
            if (Number(used.rows[0]!.bytes) + maxBytes > INTAKE_TEMPORARY_BYTES) throw new IntakeRejection('QUOTA_EXCEEDED', 'RATE_LIMITED');
            await client.query(`INSERT INTO content_intake.object_reservations
              (object_id,tenant_id,app_id,actor_id,source_id,purpose,reserved_bytes,state)
              VALUES ($1,$2,$3,$4,$5,$6,$7,'reserved')`,
            [objectId, who.tenant_id, who.app_id, who.principal_id, sourceId, purpose, maxBytes]);
          });
          admitted = objectId;
        } });
      } catch (error) {
        if (admitted) {
          try { await discard(admitted); } catch (cleanup) { report(cleanup); }
        }
        throw error;
      }
      // A lost response here retains the file and its charge. Do not hand an
      // uncertain persisted object to a business transaction or release it.
      await transaction(async client => {
        const changed = await client.query(`UPDATE content_intake.object_reservations
          SET state='persisted',actual_bytes=$2,sha256=$3,updated_at=clock_timestamp()
          WHERE object_id=$1 AND state='reserved' AND reserved_bytes >= $2`, [object.objectId, object.sizeBytes, object.sha256]);
        if (changed.rowCount !== 1) throw new IntakeRejection('COMMIT_UNKNOWN');
      });
      return object;
    },
    /** Call after inserting the object, under the business transaction's content
     * lock. Metadata and purpose must match; any mismatch rolls back both writes. */
    async adopt(client: Query, object: PersistedContentObject): Promise<void> {
      const changed = await client.query(`UPDATE content_intake.object_reservations r
        SET state='adopted',updated_at=clock_timestamp() FROM content_intake.objects o
        WHERE r.object_id=$1 AND o.object_id=r.object_id AND r.state='persisted'
        AND r.sha256=$2 AND r.actual_bytes=$3 AND o.sha256=r.sha256 AND o.bytes=r.actual_bytes
        AND o.source_id IS NOT DISTINCT FROM r.source_id AND o.actor_id=r.actor_id
        AND o.tenant_id=r.tenant_id AND o.app_id=r.app_id AND o.purpose=r.purpose`,
      [object.objectId, object.sha256, object.sizeBytes]);
      if (changed.rowCount !== 1) throw new IntakeRejection('COMMIT_UNKNOWN');
    },
    discard,
  };
}
export type IntakeCapacity = ReturnType<typeof createIntakeCapacity>;

/** Read-only operational projection. Reserved/persisted may be in flight or have
 * an unknown commit; no timestamp turns them into deletion candidates. Only
 * explicit failed/replayed writes enter releasing. History has no approved TTL. */
export async function intakeCapacityDryRun(client: Query) {
  const result = await client.query<{ state: string; objects: string; charged_bytes: string }>(`SELECT state,count(*)::text objects,
    coalesce(sum(CASE WHEN state IN ('reserved','persisted','releasing') THEN reserved_bytes ELSE 0 END),0)::text charged_bytes
    FROM content_intake.object_reservations GROUP BY state ORDER BY state`);
  const objects = await client.query<{ objects: string; bytes: string }>(
    'SELECT count(*)::text objects,coalesce(sum(bytes),0)::text bytes FROM content_intake.objects');
  return { mode: 'dry-run' as const, retentionPolicy: 'pending-approval' as const,
    historicalDeletionAllowed: false, registered: objects.rows[0]!, reservations: result.rows,
    protections: ['registered-references', 'active-or-unknown-write', 'unregistered-disk-object'],
    retryableState: 'releasing' };
}
