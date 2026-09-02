import { performance } from 'node:perf_hooks';
import type { QueryResultRow } from 'pg';
import { withExclusiveDatabaseClient } from './client.js';
import { databaseDiagnostic, DatabaseMigrationError } from './errors.js';
import { generatedMigrationCatalogue } from './generated/migrations.generated.js';
import { inspectMigrationCatalogue } from './planner.js';
import { verifyMigrationCatalogue } from './verifier.js';
import type {
  ApplyMigrationsResult,
  AppliedMigrationResult,
  DatabaseClient,
  DatabaseQueryClient,
  ExecutableMigrationCatalogue,
} from './types.js';

interface AdvisoryLockRow extends QueryResultRow {
  acquired: boolean;
}

interface AdvisoryUnlockRow extends QueryResultRow {
  released: boolean;
}

const ADVISORY_LOCK_CLASS = 1_129_531_209;
const ADVISORY_LOCK_KEY = 4;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function commitUnknown(migrationId: string, error: unknown): DatabaseMigrationError {
  const diagnostic = databaseDiagnostic(error);
  return new DatabaseMigrationError(
    'MIGRATION_COMMIT_UNKNOWN',
    `Migration ${migrationId} commit acknowledgement is unknown; reconnect and inspect the ledger before retrying`,
    {
      cause: error,
      migrationId,
      ...(diagnostic.code === undefined ? {} : { databaseCode: diagnostic.code }),
      ...(diagnostic.detail === undefined ? {} : { databaseDetail: diagnostic.detail }),
    },
  );
}

function preserveFailureWithReleaseError(failure: unknown, releaseError: unknown): unknown {
  if (failure instanceof DatabaseMigrationError) {
    return new DatabaseMigrationError(failure.code, failure.message, {
      cause: new AggregateError([failure, releaseError], 'migration and lock release both failed'),
      ...(failure.migrationId === undefined ? {} : { migrationId: failure.migrationId }),
      ...(failure.databaseCode === undefined ? {} : { databaseCode: failure.databaseCode }),
      ...(failure.databaseDetail === undefined ? {} : { databaseDetail: failure.databaseDetail }),
    });
  }
  return new DatabaseMigrationError(
    'MIGRATION_LOCK_RELEASE_FAILED',
    'Migration failed and its advisory lock release could not be confirmed',
    { cause: new AggregateError([failure, releaseError], 'migration and lock release both failed') },
  );
}

async function acquireMigrationLock(client: DatabaseQueryClient, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  do {
    let result;
    try {
      result = await client.query<AdvisoryLockRow>(
        'SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired',
        [ADVISORY_LOCK_CLASS, ADVISORY_LOCK_KEY],
      );
    } catch (error) {
      const diagnostic = databaseDiagnostic(error);
      throw new DatabaseMigrationError(
        'MIGRATION_LOCK_FAILED',
        'Migration advisory lock could not be acquired',
        {
          cause: error,
          ...(diagnostic.code === undefined ? {} : { databaseCode: diagnostic.code }),
          ...(diagnostic.detail === undefined ? {} : { databaseDetail: diagnostic.detail }),
        },
      );
    }
    if (result.rows[0]?.acquired) return;
    await wait(Math.min(50, Math.max(1, deadline - performance.now())));
  } while (performance.now() < deadline);
  throw new DatabaseMigrationError(
    'MIGRATION_LOCK_TIMEOUT',
    `Migration advisory lock was not acquired within ${timeoutMs}ms`,
  );
}

async function releaseMigrationLock(client: DatabaseQueryClient): Promise<void> {
  let result;
  try {
    result = await client.query<AdvisoryUnlockRow>(
      'SELECT pg_advisory_unlock($1::integer, $2::integer) AS released',
      [ADVISORY_LOCK_CLASS, ADVISORY_LOCK_KEY],
    );
  } catch (error) {
    const diagnostic = databaseDiagnostic(error);
    throw new DatabaseMigrationError(
      'MIGRATION_LOCK_RELEASE_FAILED',
      'Migration advisory lock release could not be confirmed',
      {
        cause: error,
        ...(diagnostic.code === undefined ? {} : { databaseCode: diagnostic.code }),
        ...(diagnostic.detail === undefined ? {} : { databaseDetail: diagnostic.detail }),
      },
    );
  }
  if (!result.rows[0]?.released) {
    throw new DatabaseMigrationError(
      'MIGRATION_LOCK_RELEASE_FAILED',
      'Migration advisory lock was not owned by this database session',
    );
  }
}

async function rollback(client: DatabaseQueryClient, migrationId: string, original: unknown): Promise<never> {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    throw new DatabaseMigrationError(
      'MIGRATION_ROLLBACK_FAILED',
      `Migration ${migrationId} failed and its transaction could not be confirmed rolled back`,
      { cause: new AggregateError([original, rollbackError], 'migration and rollback both failed'), migrationId },
    );
  }
  const diagnostic = databaseDiagnostic(original);
  throw new DatabaseMigrationError(
    'MIGRATION_APPLY_FAILED',
    `Migration ${migrationId} failed and was rolled back`,
    {
      cause: original,
      migrationId,
      ...(diagnostic.code === undefined ? {} : { databaseCode: diagnostic.code }),
      ...(diagnostic.detail === undefined ? {} : { databaseDetail: diagnostic.detail }),
    },
  );
}

async function beginMigration(client: DatabaseQueryClient, migrationId: string): Promise<void> {
  try {
    await client.query('BEGIN');
  } catch (error) {
    await rollback(client, migrationId, error);
  }
}

export async function applyMigrationCatalogue(
  client: DatabaseQueryClient,
  catalogue: ExecutableMigrationCatalogue,
  {
    lockTimeoutMs = 5_000,
    verifyBeforeUnlock,
  }: Readonly<{
    lockTimeoutMs?: number;
    verifyBeforeUnlock?: (client: DatabaseQueryClient) => Promise<void>;
  }> = {},
): Promise<ApplyMigrationsResult> {
  if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 1 || lockTimeoutMs > 300_000) {
    throw new DatabaseMigrationError(
      'MIGRATION_CATALOGUE_INVALID',
      'Migration lock timeout must be an integer between 1 and 300000ms',
    );
  }

  let lockOwned = false;
  let result: ApplyMigrationsResult | undefined;
  let failure: unknown;
  try {
    await acquireMigrationLock(client, lockTimeoutMs);
    lockOwned = true;
    const before = await inspectMigrationCatalogue(client, catalogue);
    const pending = catalogue.migrations.slice(before.applied.length);
    const applied: AppliedMigrationResult[] = [];

    // One session owns the lock. Each migration and its ledger row share one
    // transaction, so a crash leaves either the previous prefix or the next
    // complete prefix—never an untracked half-applied step.
    for (const migration of pending) {
      const startedAt = performance.now();
      await beginMigration(client, migration.id);
      let executionMs = 0;
      try {
        await client.query(migration.sql);
        executionMs = Math.max(0, Math.round(performance.now() - startedAt));
        await client.query(
          `INSERT INTO customer_agent_meta.schema_migrations (
             position, migration_id, migration_sha256, contract_set_id,
             source_git_sha, source_schema_sha256, execution_ms
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            migration.position,
            migration.id,
            migration.sha256,
            catalogue.contractSetId,
            catalogue.sourceGitSha,
            catalogue.sourceSchemaSha256,
            executionMs,
          ],
        );
      } catch (error) {
        await rollback(client, migration.id, error);
      }
      try {
        await client.query('COMMIT');
      } catch (error) {
        throw commitUnknown(migration.id, error);
      }
      applied.push(Object.freeze({ id: migration.id, position: migration.position, executionMs }));
    }

    const after = await inspectMigrationCatalogue(client, catalogue);
    if (after.state !== 'COMPLETE') {
      throw new DatabaseMigrationError(
        'MIGRATION_LEDGER_DRIFT',
        'Migration application ended without a complete trusted ledger prefix',
      );
    }
    if (verifyBeforeUnlock) await verifyBeforeUnlock(client);
    result = Object.freeze({ before: before.state, applied: Object.freeze(applied), after });
  } catch (error) {
    failure = error;
  } finally {
    if (lockOwned) {
      try {
        await releaseMigrationLock(client);
      } catch (releaseError) {
        failure = failure ? preserveFailureWithReleaseError(failure, releaseError) : releaseError;
      }
    }
  }

  if (failure) throw failure;
  if (!result) {
    throw new DatabaseMigrationError('MIGRATION_APPLY_FAILED', 'Migration application produced no result');
  }
  return result;
}

export function applyDatabaseMigrations(
  client: DatabaseClient,
  options?: Readonly<{ lockTimeoutMs?: number }>,
): Promise<ApplyMigrationsResult> {
  return withExclusiveDatabaseClient(client, (lockedClient) => (
    applyMigrationCatalogue(lockedClient, generatedMigrationCatalogue, {
      ...(options ?? {}),
      verifyBeforeUnlock: async (migrationClient) => {
        await verifyMigrationCatalogue(migrationClient);
      },
    })
  ));
}
