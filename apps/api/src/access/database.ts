import type { IntakePool } from '../content-intake/transaction.js';
import {
  createAccessEvaluator,
  parseAccessSnapshot,
  type AccessEvaluator,
} from './evaluator.js';

/** One statement owns the observation snapshot. PostgreSQL gives that statement
 * one stable MVCC view, so an access revision cannot mix two authority states. */
export function createDatabaseAccessEvaluator(pool: IntakePool): AccessEvaluator {
  return createAccessEvaluator(async (actorUserId, actions) => {
    const client = await pool.connect();
    let failed = false;
    try {
      const result = await client.query<{ value: unknown }>(
        'SELECT content_intake.access_snapshot($1, clock_timestamp(), $2::text[]) AS value',
        [actorUserId, actions ?? null],
      );
      return parseAccessSnapshot(result.rows[0]?.value);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      client.release(failed);
    }
  });
}
