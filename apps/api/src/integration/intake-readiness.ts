import type { IntakePool } from '../content-intake/transaction.js';
import { releaseDeadline } from '../content-intake/usage.js';

/** Checks the currently published intake catalog through the same whole-release
 * gates used when issuing a query entitlement. Per-user and per-SOP eligibility
 * remains owned by the normal request transactions. Every call reads live state. */
export async function inspectCurrentIntakeRelease(pool: IntakePool): Promise<Readonly<{
  releaseId: string;
  validUntil: number;
}>> {
  const client = await pool.connect();
  let failed = true;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '2000ms'");
    const current = await client.query<{ release_id: string; tenant_id: string }>(`
      SELECT release.release_id, release.tenant_id
      FROM public.content_current current
      JOIN public.content_releases release ON release.release_id=current.current_release_id
      WHERE current.id=1
    `);
    const release = current.rows[0];
    if (!release) throw new Error('INTAKE_CATALOG_UNAVAILABLE');
    const validUntil = await releaseDeadline(client, release.release_id, release.tenant_id);
    const clock = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
    if (validUntil <= clock.rows[0]!.now.getTime()) throw new Error('INTAKE_CATALOG_EXPIRED');
    await client.query('COMMIT');
    failed = false;
    return { releaseId: release.release_id, validUntil };
  } finally {
    // A failed transaction is discarded with its connection, so callers never
    // inherit an open snapshot after a deadline or provenance rejection.
    client.release(failed);
  }
}
