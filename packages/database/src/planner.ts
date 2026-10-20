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

const FROZEN_OCCUPIED_SHA256 = 'c692968890cef90c1f72651901a326a8e816347992c7795d58f56cbcc31d6f37';

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

interface CatalogueSuccessorStep {
  index: number;
  minimumCatalogueLength: number;
  id: string;
  predecessorId?: string;
  requiresPredecessor: string;
}

type CatalogueMigration = ExecutableMigrationCatalogue['migrations'][number];
type SignedSuccessor = ExecutableMigrationCatalogue['compatibility']['repairSuccessor'];

// Named steps after the additive suffix. Repair has no predecessor id.
// Repair and readiness carry signed provenance; every later step also pins the frozen 0042 checksum.
const CATALOGUE_SUCCESSOR_STEPS: readonly CatalogueSuccessorStep[] = [
  {
    index: 39,
    minimumCatalogueLength: 40,
    id: '0040_intake_repair_successor_v1_28',
    requiresPredecessor: 'Repair requires the preceding additive successor',
  },
  {
    index: 40,
    minimumCatalogueLength: 41,
    id: '0041_intake_readiness_v1_29',
    predecessorId: '0040_intake_repair_successor_v1_28',
    requiresPredecessor: 'Readiness requires the preceding repair successor',
  },
  {
    index: 41,
    minimumCatalogueLength: 42,
    id: '0042_intake_occupied_domain_publish',
    predecessorId: '0041_intake_readiness_v1_29',
    requiresPredecessor: 'Occupied-domain publication requires the readiness successor',
  },
  {
    index: 42,
    minimumCatalogueLength: 43,
    id: '0043_intake_publish_default_tenant',
    predecessorId: '0042_intake_occupied_domain_publish',
    requiresPredecessor: 'Default-tenant publication requires the occupied-domain successor',
  },
  {
    index: 43,
    minimumCatalogueLength: 44,
    id: '0044_intake_role_defaults',
    predecessorId: '0043_intake_publish_default_tenant',
    requiresPredecessor: 'Role defaults require the default-tenant successor',
  },
  {
    index: 44,
    minimumCatalogueLength: 45,
    id: '0045_feishu_agent_admit',
    predecessorId: '0044_intake_role_defaults',
    requiresPredecessor: 'Feishu agent admission requires the role-default successor',
  },
  {
    index: 45,
    minimumCatalogueLength: 46,
    id: '0046_project_feishu_roster',
    predecessorId: '0045_feishu_agent_admit',
    requiresPredecessor: 'Roster projection requires the Feishu agent admission',
  },
  {
    index: 46,
    minimumCatalogueLength: 47,
    id: '0047_roster_query_signer',
    predecessorId: '0046_project_feishu_roster',
    requiresPredecessor: 'Query signer requires the roster projection',
  },
  {
    index: 47,
    minimumCatalogueLength: 48,
    id: '0048_roster_store_set',
    predecessorId: '0047_roster_query_signer',
    requiresPredecessor: 'Store set requires the query signer',
  },
  {
    index: 48,
    minimumCatalogueLength: 49,
    id: '0049_roster_lifecycle',
    predecessorId: '0048_roster_store_set',
    requiresPredecessor: 'Roster lifecycle requires the store set',
  },
  {
    index: 49,
    minimumCatalogueLength: 50,
    id: '0050_authorization_sources',
    predecessorId: '0049_roster_lifecycle',
    requiresPredecessor: 'Authorization sources require the roster lifecycle',
  },
  {
    index: 50,
    minimumCatalogueLength: 51,
    id: '0051_publish_source_set',
    predecessorId: '0050_authorization_sources',
    requiresPredecessor: 'Publish source set requires authorization sources',
  },
  {
    index: 51,
    minimumCatalogueLength: 52,
    id: '0052_import_source_set',
    predecessorId: '0051_publish_source_set',
    requiresPredecessor: 'Import source set requires the publish source set',
  },
];

function requiredSuccessorStep(
  predicate: (step: CatalogueSuccessorStep) => boolean,
  label: string,
): CatalogueSuccessorStep {
  const step = CATALOGUE_SUCCESSOR_STEPS.find(predicate);
  if (step === undefined) throw new Error(`Catalogue successor table is missing ${label}`);
  return step;
}

const repairSuccessorStep = requiredSuccessorStep((step) => step.predecessorId === undefined, 'repair');
const readinessSuccessorStep = requiredSuccessorStep((step) => step.predecessorId === repairSuccessorStep.id, 'readiness');
const occupiedSuccessorStep = requiredSuccessorStep((step) => step.predecessorId === readinessSuccessorStep.id, 'occupied-domain');

function sameSignedSuccessor(migration: CatalogueMigration, signed: SignedSuccessor): boolean {
  return signed != null
    && migration.contractSetId === signed.contractSetId
    && migration.sourceGitSha === signed.sourceGitSha
    && migration.sourceSchemaSha256 === signed.sourceSchemaSha256
    && migration.sha256 === signed.migrationSha256;
}

function matchesCatalogueSuccessorStep(
  step: CatalogueSuccessorStep,
  index: number,
  migration: CatalogueMigration,
  catalogue: ExecutableMigrationCatalogue,
  repair: SignedSuccessor,
  readiness: SignedSuccessor,
): boolean {
  if (
    index !== step.index
    || catalogue.migrations.length < step.minimumCatalogueLength
    || migration.id !== step.id
    || (step.predecessorId !== undefined && catalogue.migrations[step.index - 1]?.id !== step.predecessorId)
  ) {
    return false;
  }
  if (step === repairSuccessorStep) return sameSignedSuccessor(migration, repair);
  if (step === readinessSuccessorStep) {
    const repairMigration = catalogue.migrations[repairSuccessorStep.index];
    return sameSignedSuccessor(migration, readiness)
      && repair != null
      && repairMigration?.sha256 === repair.migrationSha256;
  }
  if (readiness == null) return false;
  const occupiedChecksum = step === occupiedSuccessorStep
    ? migration.sha256
    : catalogue.migrations[occupiedSuccessorStep.index]?.sha256;
  return occupiedChecksum === FROZEN_OCCUPIED_SHA256;
}

export function assertMigrationCatalogue(catalogue: ExecutableMigrationCatalogue): void {
  const prior = catalogue.compatibility.priorSignedBaseline;
  const reviewedUpgrades = catalogue.compatibility.priorReviewedUpgrades;
  if (
    catalogue.schema !== 'customer-agent-database-migrations/v2'
    || !CONTRACT_SET_ID_PATTERN.test(catalogue.contractSetId)
    || !GIT_SHA_PATTERN.test(catalogue.sourceGitSha)
    || !HASH_PATTERN.test(catalogue.sourceSchemaSha256)
    || catalogue.compatibility.current !== 'N'
    || !Array.isArray(reviewedUpgrades)
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

  let precedingMigrationCount = prior?.migrationCount ?? 0;
  let precedingSchemaSha256 = prior?.sourceSchemaSha256;
  const reviewedIds = new Set([catalogue.contractSetId, ...(prior ? [prior.contractSetId] : [])]);
  for (const upgrade of reviewedUpgrades) {
    if (
      prior === null
      || !CONTRACT_SET_ID_PATTERN.test(upgrade.contractSetId)
      || !GIT_SHA_PATTERN.test(upgrade.sourceGitSha)
      || !HASH_PATTERN.test(upgrade.sourceSchemaSha256)
      || !Number.isSafeInteger(upgrade.migrationCount)
      || upgrade.migrationCount < precedingMigrationCount
      || (upgrade.migrationCount === precedingMigrationCount && upgrade.sourceSchemaSha256 !== precedingSchemaSha256)
      || upgrade.migrationCount > catalogue.migrations.length
      || reviewedIds.has(upgrade.contractSetId)
      // A reviewed HTTP-only contract may retain the complete SQL catalogue.
      // Equal historical counts are safe only for identical predecessor DDL
      // and a distinct source contract, including after a product overlay.
      // Every migration still has its exact provenance/hash checked below.
      || (upgrade.migrationCount === catalogue.migrations.length
        && (upgrade.sourceSchemaSha256 !== catalogue.sourceSchemaSha256 || upgrade.contractSetId === catalogue.contractSetId))
    ) {
      catalogueError('Migration catalogue reviewed-upgrade metadata is invalid');
    }
    precedingMigrationCount = upgrade.migrationCount;
    precedingSchemaSha256 = upgrade.sourceSchemaSha256;
    reviewedIds.add(upgrade.contractSetId);
  }

  const ids = new Set<string>();
  let successorSuffix = false;
  const repair = catalogue.compatibility.repairSuccessor;
  const readiness = catalogue.compatibility.readinessSuccessor;
  const successor = catalogue.compatibility.additiveSuccessor ?? null;
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
    const expectedProvenance = prior !== null && index < prior.migrationCount
      ? prior
      : reviewedUpgrades.find(({ migrationCount }) => index < migrationCount) ?? catalogue;
    const matchesSuccessor = successor !== null
      && migration.contractSetId === successor.contractSetId
      && migration.sourceGitSha === successor.sourceGitSha
      && migration.sourceSchemaSha256 === successor.sourceSchemaSha256
      && successor.contractSetId !== catalogue.contractSetId;
    if (
      index === occupiedSuccessorStep.index
      && migration.id === occupiedSuccessorStep.id
      && migration.sha256 !== FROZEN_OCCUPIED_SHA256
    ) {
      catalogueError('Frozen occupied-domain migration 0042 drifted');
    }
    const step = CATALOGUE_SUCCESSOR_STEPS.find((candidate) => candidate.index === index);
    let matchesRepair = false;
    let matchesReadiness = false;
    if (step !== undefined && matchesCatalogueSuccessorStep(step, index, migration, catalogue, repair, readiness)) {
      if (!successorSuffix) catalogueError(step.requiresPredecessor);
      matchesRepair = step === repairSuccessorStep;
      matchesReadiness = step === readinessSuccessorStep;
      successorSuffix = true;
    } else if (matchesSuccessor) successorSuffix = true;
    else if (successorSuffix) catalogueError(`Migration catalogue successor suffix is interrupted at ${migration.id}`);
    if (
      !matchesSuccessor && !matchesRepair && !matchesReadiness
      && (migration.contractSetId !== expectedProvenance.contractSetId
      || migration.sourceGitSha !== expectedProvenance.sourceGitSha
      || migration.sourceSchemaSha256 !== expectedProvenance.sourceSchemaSha256)
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
