import { describe, expect, it } from 'vitest';
import { generatedMigrationCatalogue } from '../src/generated/migrations.generated.js';
import { applyMigrationCatalogue } from '../src/runner.js';
import type { DatabaseQueryClient } from '../src/types.js';

describe('database migration runner errors', () => {
  it('normalizes advisory-lock query failures', async () => {
    const client = {
      query: async () => {
        throw Object.assign(new Error('SENSITIVE_CONNECTION_DETAIL_DO_NOT_ECHO'), {
          code: '08006',
          detail: 'CONNECTION_FAILURE',
        });
      },
    } as unknown as DatabaseQueryClient;

    await expect(applyMigrationCatalogue(client, generatedMigrationCatalogue)).rejects.toMatchObject({
      code: 'MIGRATION_LOCK_FAILED',
      databaseCode: '08006',
      databaseDetail: 'CONNECTION_FAILURE',
      message: 'Migration advisory lock could not be acquired',
    });
  });

  it('rolls back an unknown BEGIN acknowledgement before releasing the owned session lock', async () => {
    const calls: string[] = [];
    const client = {
      query: async (sql: string) => {
        calls.push(sql);
        if (sql.startsWith('SELECT pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
        if (sql.includes("current_setting('server_version_num')")) return { rows: [{ server_version_num: 150_018 }] };
        if (sql.startsWith("SELECT to_regclass('customer_agent_meta.schema_migrations')")) {
          return { rows: [{ ledger: null }] };
        }
        if (sql.includes('AS dirty')) return { rows: [{ dirty: false }] };
        if (sql === 'BEGIN') {
          throw Object.assign(new Error('connection secret'), {
            code: '08006',
            detail: 'CONNECTION_FAILURE',
          });
        }
        if (sql === 'ROLLBACK') return { rows: [] };
        if (sql.startsWith('SELECT pg_advisory_unlock')) return { rows: [{ released: true }] };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    } as unknown as DatabaseQueryClient;

    await expect(applyMigrationCatalogue(client, generatedMigrationCatalogue)).rejects.toMatchObject({
      code: 'MIGRATION_APPLY_FAILED',
      migrationId: '0001_extensions',
      databaseCode: '08006',
      databaseDetail: 'CONNECTION_FAILURE',
      message: 'Migration 0001_extensions failed and was rolled back',
    });
    expect(calls).toContain('ROLLBACK');
    expect(calls.indexOf('ROLLBACK')).toBeLessThan(calls.findIndex((sql) => sql.includes('pg_advisory_unlock')));
    expect(calls.at(-1)).toContain('pg_advisory_unlock');
  });

  it('fails closed when an unknown BEGIN acknowledgement cannot be rolled back', async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.startsWith('SELECT pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
        if (sql.includes("current_setting('server_version_num')")) return { rows: [{ server_version_num: 150_018 }] };
        if (sql.startsWith("SELECT to_regclass('customer_agent_meta.schema_migrations')")) {
          return { rows: [{ ledger: null }] };
        }
        if (sql.includes('AS dirty')) return { rows: [{ dirty: false }] };
        if (sql === 'BEGIN') throw Object.assign(new Error('unknown begin'), { code: '08006' });
        if (sql === 'ROLLBACK') throw Object.assign(new Error('unknown rollback'), { code: '08006' });
        if (sql.startsWith('SELECT pg_advisory_unlock')) return { rows: [{ released: true }] };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    } as unknown as DatabaseQueryClient;

    await expect(applyMigrationCatalogue(client, generatedMigrationCatalogue)).rejects.toMatchObject({
      code: 'MIGRATION_ROLLBACK_FAILED',
      migrationId: '0001_extensions',
      message: 'Migration 0001_extensions failed and its transaction could not be confirmed rolled back',
    });
  });
});
