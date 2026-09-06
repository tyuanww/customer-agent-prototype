import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DatabaseMigrationError } from '../src/errors.js';
import { generatedMigrationCatalogue } from '../src/generated/migrations.generated.js';
import {
  assertMigrationCatalogue,
  deriveMigrationStatus,
  inspectMigrationCatalogue,
  planMigrationCatalogue,
} from '../src/planner.js';
import type { DatabaseQueryClient, ExecutableMigrationCatalogue } from '../src/types.js';

function ledgerRow(index: number) {
  const migration = generatedMigrationCatalogue.migrations[index];
  if (!migration) throw new Error(`missing generated migration ${index}`);
  return {
    position: migration.position,
    migration_id: migration.id,
    migration_sha256: migration.sha256,
    contract_set_id: migration.contractSetId,
    source_git_sha: migration.sourceGitSha,
    source_schema_sha256: migration.sourceSchemaSha256,
    applied_at: new Date('2026-09-02T00:00:00.000Z'),
    execution_ms: index + 1,
  };
}

describe('database migration planner', () => {
  it('plans only the missing suffix for partial and complete ledgers', () => {
    const partial = deriveMigrationStatus([ledgerRow(0), ledgerRow(1)], generatedMigrationCatalogue);
    expect(partial.state).toBe('PARTIAL');
    expect(partial.pending[0]?.id).toBe('0003_events_and_metrics');
    expect(planMigrationCatalogue(partial).migrations).toHaveLength(10);

    const complete = deriveMigrationStatus(
      generatedMigrationCatalogue.migrations.map((_, index) => ledgerRow(index)),
      generatedMigrationCatalogue,
    );
    expect(complete.state).toBe('COMPLETE');
    expect(planMigrationCatalogue(complete).migrations).toEqual([]);
    expect(complete.compatibility.priorUpgrade).toBe(
      'SUPPORTED · immutable 9-migration baseline → 3-migration current suffix',
    );
  });

  it('accepts the exact v1.12 ledger prefix and plans only the reviewed v1.13/v1.14 suffix', () => {
    const prior = generatedMigrationCatalogue.compatibility.priorSignedBaseline;
    if (!prior) throw new Error('generated catalogue must declare the v1.12 baseline');
    const baselineRows = generatedMigrationCatalogue.migrations
      .slice(0, prior.migrationCount)
      .map((_, index) => ledgerRow(index));
    const status = deriveMigrationStatus(baselineRows, generatedMigrationCatalogue);

    expect(status.state).toBe('PARTIAL');
    expect(status.pending.map(({ id }) => id)).toEqual([
      '0010_search_projection_v1_13',
      '0011_search_no_hit_context_v1_14',
      '0012_owner_acceptance_v1_15',
    ]);
    expect(status.applied.every(({ contractSetId }) => contractSetId.includes('schema-1.12-'))).toBe(true);
  });

  it.each([
    ['gap', [ledgerRow(1)]],
    ['unknown', [...generatedMigrationCatalogue.migrations.map((_, index) => ledgerRow(index)), { ...ledgerRow(0), position: 10, migration_id: '0010_unknown' }]],
    ['checksum', [{ ...ledgerRow(0), migration_sha256: '0'.repeat(64) }]],
    ['provenance', [{ ...ledgerRow(0), source_git_sha: '0'.repeat(40) }]],
  ])('fails closed for %s ledger drift', (_label, rows) => {
    expect(() => deriveMigrationStatus(rows, generatedMigrationCatalogue)).toThrowError(
      expect.objectContaining<Partial<DatabaseMigrationError>>({ code: 'MIGRATION_LEDGER_DRIFT' }),
    );
  });

  it('rejects an in-memory catalogue whose SQL no longer matches its checksum', () => {
    const first = generatedMigrationCatalogue.migrations[0];
    if (!first) throw new Error('missing first migration');
    const sql = `${first.sql}\n-- tampered`;
    const catalogue = {
      ...generatedMigrationCatalogue,
      migrations: [{ ...first, sql, sha256: createHash('sha256').update(first.sql).digest('hex') }],
    } as ExecutableMigrationCatalogue;
    expect(() => assertMigrationCatalogue(catalogue)).toThrowError(
      expect.objectContaining<Partial<DatabaseMigrationError>>({ code: 'MIGRATION_CATALOGUE_INVALID' }),
    );
  });

  it('normalizes status-query failures without echoing connection details', async () => {
    const client = {
      query: async () => {
        throw Object.assign(new Error('SENSITIVE_CONNECTION_DETAIL_DO_NOT_ECHO'), {
          code: '08006',
          detail: 'CONNECTION_FAILURE',
        });
      },
    } as unknown as DatabaseQueryClient;

    await expect(inspectMigrationCatalogue(client, generatedMigrationCatalogue)).rejects.toMatchObject({
      code: 'MIGRATION_STATUS_FAILED',
      databaseCode: '08006',
      databaseDetail: 'CONNECTION_FAILURE',
      message: 'Database migration status could not be read safely',
    });
  });

  it('rejects non-PostgreSQL-15 servers before reading or adopting a ledger', async () => {
    const client = {
      query: async () => ({ rows: [{ server_version_num: 160_000 }] }),
    } as unknown as DatabaseQueryClient;

    await expect(inspectMigrationCatalogue(client, generatedMigrationCatalogue)).rejects.toMatchObject({
      code: 'MIGRATION_SERVER_UNSUPPORTED',
      message: 'PostgreSQL 15 is required; server reports major 16',
    });
  });

  it('projects a fresh catalogue to public metadata without executable SQL', async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes("current_setting('server_version_num')")) {
          return { rows: [{ server_version_num: 150_018 }] };
        }
        if (sql.startsWith("SELECT to_regclass('customer_agent_meta.schema_migrations')")) {
          return { rows: [{ ledger: null }] };
        }
        if (sql.includes('AS dirty')) return { rows: [{ dirty: false }] };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    } as unknown as DatabaseQueryClient;

    const status = await inspectMigrationCatalogue(client, generatedMigrationCatalogue);
    expect(status.state).toBe('FRESH');
    expect(status.pending).toHaveLength(12);
    expect(status.pending.every((migration) => !('sql' in migration))).toBe(true);
  });
});
