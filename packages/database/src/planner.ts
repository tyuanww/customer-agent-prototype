import { createHash } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { databaseDiagnostic, DatabaseMigrationError } from './errors.js';
import { generatedMigrationCatalogue } from './generated/migrations.generated.js';
import { withExclusiveDatabaseClient } from './client.js';
import type {
  AppliedMigration,
  DatabaseClient,
  DatabaseQueryClient,
  DatabaseMigration,
  ExecutableMigrationCatalogue,
  MigrationPlan,
  MigrationStatus,
} from './types.js';

interface LedgerPresenceRow extends QueryResultRow {
  ledger: string | null;
}

interface ServerVersionRow extends QueryResultRow {
  server_version_num: number;
}

interface DirtyDatabaseRow extends QueryResultRow {
  dirty: boolean;
}

interface LedgerRow extends QueryResultRow {
  position: number;
  migration_id: string;
  migration_sha256: string;
  contract_set_id: string;
  source_git_sha: string;
  source_schema_sha256: string;
  applied_at: Date | string;
  execution_ms: number;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const MIGRATION_ID_PATTERN = /^[0-9]{4}_[a-z0-9_]+$/;
const CONTRACT_SET_ID_PATTERN = /^cs-ai-c11-openapi-\d+\.\d+\.\d+-schema-\d+\.\d+-[0-9a-f]{12}$/;

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function catalogueError(message: string): never {
  throw new DatabaseMigrationError('MIGRATION_CATALOGUE_INVALID', message);
}

export function assertMigrationCatalogue(catalogue: ExecutableMigrationCatalogue): void {
  const prior = catalogue.compatibility.priorSignedBaseline;
  if (
    catalogue.schema !== 'customer-agent-database-migrations/v2'
    || !CONTRACT_SET_ID_PATTERN.test(catalogue.contractSetId)
    || !GIT_SHA_PATTERN.test(catalogue.sourceGitSha)
    || !HASH_PATTERN.test(catalogue.sourceSchemaSha256)
    || catalogue.compatibility.current !== 'N'
    || (prior !== null && (
      !CONTRACT_SET_ID_PATTERN.test(prior.contractSetId)
      || !GIT_SHA_PATTERN.test(prior.sourceGitSha)
      || !HASH_PATTERN.test(prior.sourceSchemaSha256)
      || !Number.isSafeInteger(prior.migrationCount)
      || prior.migrationCount < 1
      || prior.migrationCount >= catalogue.migrations.length
    ))
    || catalogue.migrations.length === 0
  ) {
    catalogueError('Migration catalogue identity or compatibility metadata is invalid');
  }

  const ids = new Set<string>();
  for (const [index, migration] of catalogue.migrations.entries()) {
    if (
      migration.position !== index + 1
      || !MIGRATION_ID_PATTERN.test(migration.id)
      || !migration.id.startsWith(`${String(index + 1).padStart(4, '0')}_`)
      || ids.has(migration.id)
      || !HASH_PATTERN.test(migration.sha256)
      || !CONTRACT_SET_ID_PATTERN.test(migration.contractSetId)
      || !GIT_SHA_PATTERN.test(migration.sourceGitSha)
      || !HASH_PATTERN.test(migration.sourceSchemaSha256)
      || migration.sha256 !== sha256(migration.sql)
      || migration.bytes !== Buffer.byteLength(migration.sql)
      || !migration.sql.startsWith('-- GENERATED FILE.')
      || migration.sourceRanges.some(({ startLine, endLine }) => (
        !Number.isSafeInteger(startLine)
        || !Number.isSafeInteger(endLine)
        || startLine < 1
        || endLine < startLine
      ))
    ) {
      catalogueError(`Migration catalogue entry ${migration.id || index + 1} is invalid`);
    }
    const expectedProvenance = prior !== null && index < prior.migrationCount ? prior : catalogue;
    if (
      migration.contractSetId !== expectedProvenance.contractSetId
      || migration.sourceGitSha !== expectedProvenance.sourceGitSha
      || migration.sourceSchemaSha256 !== expectedProvenance.sourceSchemaSha256
    ) {
      catalogueError(`Migration catalogue provenance changes outside the declared baseline boundary at ${migration.id}`);
    }
    ids.add(migration.id);
  }
}

function freezeStatus(
  state: MigrationStatus['state'],
  applied: readonly AppliedMigration[],
  pending: readonly DatabaseMigration[],
  catalogue: ExecutableMigrationCatalogue,
): MigrationStatus {
  return Object.freeze({
    state,
    applied: Object.freeze([...applied]),
    pending: Object.freeze([...pending]),
    compatibility: Object.freeze({
      current: 'N' as const,
      priorSignedBaseline: catalogue.compatibility.priorSignedBaseline === null
        ? null
        : Object.freeze({ ...catalogue.compatibility.priorSignedBaseline }),
      priorUpgrade: catalogue.compatibility.priorSignedBaseline === null
        ? 'N/A · no prior signed baseline'
        : `SUPPORTED · immutable ${catalogue.compatibility.priorSignedBaseline.migrationCount}-migration baseline → ${catalogue.migrations.length - catalogue.compatibility.priorSignedBaseline.migrationCount}-migration current suffix`,
    }),
  });
}

function migrationMetadata(migration: ExecutableMigrationCatalogue['migrations'][number]): DatabaseMigration {
  const { sql: _sql, ...metadata } = migration;
  return Object.freeze(metadata);
}

function ledgerDrift(message: string): never {
  throw new DatabaseMigrationError('MIGRATION_LEDGER_DRIFT', message);
}

export function deriveMigrationStatus(
  rows: readonly LedgerRow[],
  catalogue: ExecutableMigrationCatalogue,
): MigrationStatus {
  assertMigrationCatalogue(catalogue);
  const applied: AppliedMigration[] = [];
  for (const [index, row] of rows.entries()) {
    const expected = catalogue.migrations[index];
    if (!expected) ledgerDrift(`Migration ledger contains unknown position ${row.position}`);
    if (row.position !== index + 1 || row.position !== expected.position || row.migration_id !== expected.id) {
      ledgerDrift(`Migration ledger order drift at position ${row.position}`);
    }
    if (
      row.migration_sha256 !== expected.sha256
      || row.contract_set_id !== expected.contractSetId
      || row.source_git_sha !== expected.sourceGitSha
      || row.source_schema_sha256 !== expected.sourceSchemaSha256
    ) {
      ledgerDrift(`Migration ledger provenance drift at ${expected.id}`);
    }
    if (!Number.isInteger(row.execution_ms) || row.execution_ms < 0) {
      ledgerDrift(`Migration ledger execution metadata drift at ${expected.id}`);
    }
    const appliedAt = new Date(row.applied_at);
    if (Number.isNaN(appliedAt.valueOf())) {
      ledgerDrift(`Migration ledger timestamp drift at ${expected.id}`);
    }
    applied.push(Object.freeze({
      position: row.position,
      id: row.migration_id,
      sha256: row.migration_sha256,
      contractSetId: row.contract_set_id,
      sourceGitSha: row.source_git_sha,
      sourceSchemaSha256: row.source_schema_sha256,
      appliedAt: appliedAt.toISOString(),
      executionMs: row.execution_ms,
    }));
  }
  const pending = catalogue.migrations.slice(applied.length).map(migrationMetadata);
  return freezeStatus(pending.length === 0 ? 'COMPLETE' : 'PARTIAL', applied, pending, catalogue);
}

export async function inspectMigrationCatalogue(
  client: DatabaseQueryClient,
  catalogue: ExecutableMigrationCatalogue,
): Promise<MigrationStatus> {
  assertMigrationCatalogue(catalogue);
  try {
    const server = await client.query<ServerVersionRow>(
      "SELECT current_setting('server_version_num')::int AS server_version_num",
    );
    const serverVersion = server.rows[0]?.server_version_num;
    const serverMajor = typeof serverVersion === 'number' && Number.isSafeInteger(serverVersion)
      ? Math.trunc(serverVersion / 10_000)
      : 0;
    if (serverMajor !== 15) {
      throw new DatabaseMigrationError(
        'MIGRATION_SERVER_UNSUPPORTED',
        `PostgreSQL 15 is required; server reports major ${serverMajor || 'unknown'}`,
      );
    }
    const presence = await client.query<LedgerPresenceRow>(
      "SELECT to_regclass('customer_agent_meta.schema_migrations')::text AS ledger",
    );
    if (!presence.rows[0]?.ledger) {
      const dirty = await client.query<DirtyDatabaseRow>(`
        SELECT (
          to_regnamespace('customer_agent_meta') IS NOT NULL
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_namespace namespace
            WHERE namespace.nspname NOT IN ('public','pg_catalog','information_schema')
              AND namespace.nspname !~ '^pg_(toast|temp)(_|$)'
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class relation
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'public'
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc procedure
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
            WHERE namespace.nspname = 'public'
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_type type_object
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = type_object.typnamespace
            WHERE namespace.nspname = 'public'
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_operator operator_object
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = operator_object.oprnamespace
            WHERE namespace.nspname = 'public'
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_collation collation_object
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = collation_object.collnamespace
            WHERE namespace.nspname = 'public'
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_conversion conversion_object
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = conversion_object.connamespace
            WHERE namespace.nspname = 'public'
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_statistic_ext statistic_object
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = statistic_object.stxnamespace
            WHERE namespace.nspname = 'public'
          )
          OR EXISTS (
            SELECT 1 FROM pg_catalog.pg_extension WHERE extname <> 'plpgsql'
          )
          OR EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger)
          OR EXISTS (SELECT 1 FROM pg_catalog.pg_publication)
          OR EXISTS (SELECT 1 FROM pg_catalog.pg_foreign_server)
          OR EXISTS (SELECT 1 FROM pg_catalog.pg_foreign_data_wrapper)
          OR EXISTS (SELECT 1 FROM pg_catalog.pg_cast WHERE oid >= 16384)
          OR EXISTS (
            SELECT 1 FROM pg_catalog.pg_language
            WHERE lanname NOT IN ('internal','c','sql','plpgsql')
          )
        ) AS dirty
      `);
      if (dirty.rows[0]?.dirty) {
        throw new DatabaseMigrationError(
          'MIGRATION_UNTRACKED_SCHEMA',
          'Database is not empty but has no trusted customer-agent migration ledger',
        );
      }
      return freezeStatus('FRESH', [], catalogue.migrations.map(migrationMetadata), catalogue);
    }

    const ledger = await client.query<LedgerRow>(`
      SELECT
        position,
        migration_id,
        migration_sha256,
        contract_set_id,
        source_git_sha,
        source_schema_sha256,
        applied_at,
        execution_ms
      FROM customer_agent_meta.schema_migrations
      ORDER BY position
    `);
    return deriveMigrationStatus(ledger.rows, catalogue);
  } catch (error) {
    if (error instanceof DatabaseMigrationError) throw error;
    const diagnostic = databaseDiagnostic(error);
    throw new DatabaseMigrationError(
      'MIGRATION_STATUS_FAILED',
      'Database migration status could not be read safely',
      {
        cause: error,
        ...(diagnostic.code === undefined ? {} : { databaseCode: diagnostic.code }),
        ...(diagnostic.detail === undefined ? {} : { databaseDetail: diagnostic.detail }),
      },
    );
  }
}

export function planMigrationCatalogue(status: MigrationStatus): MigrationPlan {
  return Object.freeze({
    from: status.state,
    migrations: Object.freeze([...status.pending]),
  });
}

export function inspectDatabaseMigrations(client: DatabaseClient): Promise<MigrationStatus> {
  return withExclusiveDatabaseClient(client, (lockedClient) => (
    inspectMigrationCatalogue(lockedClient, generatedMigrationCatalogue)
  ));
}

export function planDatabaseMigrations(status: MigrationStatus): MigrationPlan {
  return planMigrationCatalogue(status);
}
