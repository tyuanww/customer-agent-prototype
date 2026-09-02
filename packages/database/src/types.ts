import type { Client } from 'pg';

/** A checked-out, already connected node-postgres session. `pg.Pool` is intentionally incompatible. */
export type DatabaseClient = Client;

/** Internal query seam for deterministic unit tests; never re-exported from the package entrypoint. */
export type DatabaseQueryClient = Pick<Client, 'query'>;

export type SourceRange = Readonly<{
  startLine: number;
  endLine: number;
}>;

export type DatabaseMigration = Readonly<{
  position: number;
  id: string;
  sha256: string;
  bytes: number;
  sourceRanges: readonly SourceRange[];
}>;

export type ExecutableDatabaseMigration = DatabaseMigration & Readonly<{
  sql: string;
}>;

export type ExecutableMigrationCatalogue = Readonly<{
  schema: 'customer-agent-database-migrations/v1';
  contractSetId: string;
  sourceGitSha: string;
  sourceSchemaSha256: string;
  compatibility: Readonly<{
    current: 'N';
    priorSignedBaseline: null;
  }>;
  migrations: readonly ExecutableDatabaseMigration[];
}>;

export type AppliedMigration = Readonly<{
  position: number;
  id: string;
  sha256: string;
  contractSetId: string;
  sourceGitSha: string;
  sourceSchemaSha256: string;
  appliedAt: string;
  executionMs: number;
}>;

export type MigrationStatus = Readonly<{
  state: 'FRESH' | 'PARTIAL' | 'COMPLETE';
  applied: readonly AppliedMigration[];
  pending: readonly DatabaseMigration[];
  compatibility: Readonly<{
    current: 'N';
    priorSignedBaseline: null;
    priorUpgrade: 'N/A · no prior signed baseline';
  }>;
}>;

export type MigrationPlan = Readonly<{
  from: 'FRESH' | 'PARTIAL' | 'COMPLETE';
  migrations: readonly DatabaseMigration[];
}>;

export type AppliedMigrationResult = Readonly<{
  id: string;
  position: number;
  executionMs: number;
}>;

export type ApplyMigrationsResult = Readonly<{
  before: MigrationStatus['state'];
  applied: readonly AppliedMigrationResult[];
  after: MigrationStatus;
}>;

export type DatabaseVerificationReport = Readonly<{
  status: 'PASS';
  migrationCount: number;
  inventory: Readonly<{
    tables: number;
    views: number;
    functions: number;
    pgcrypto: string;
    pgTrgm: string;
  }>;
  capabilityRoles: Readonly<{
    total: number;
    safe: number;
    memberships: number;
  }>;
  acl: Readonly<{
    runtimeReleaseItemsRead: false;
    runtimeBackingViewRead: false;
    runtimeControlledSearchExecute: true;
    publicLedgerSchemaUsage: false;
    publicLedgerRead: false;
  }>;
  phase1PolicyHardOff: true;
  compatibility: MigrationStatus['compatibility'];
}>;
