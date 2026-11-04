import type { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '../src/runner.js';
import { Pg15Harness } from '../src/testkit/index.js';
import {
  READ_ONLY_SNAPSHOT_SQL,
  collectSnapshot,
  evaluateSnapshot,
} from '../../../scripts/ops/production-intake-tenancy.mjs';

const enabled = process.env.CUSTOMER_AGENT_DB_PG15_INTEGRATION === '1';

describe.skipIf(!enabled)('production intake tenancy preflight on PostgreSQL 15', () => {
  let harness: Pg15Harness;
  let client: Client;

  beforeEach(async () => {
    harness = new Pg15Harness();
    harness.start();
    const database = harness.createDatabase('production_intake_tenancy');
    client = await harness.connect(database.config);
    await applyDatabaseMigrations(client);
  }, 60_000);

  afterEach(async () => {
    await client.end();
    harness.stop();
  });

  it('executes the aggregate queries against real active and historical batches', async () => {
    await client.query('BEGIN');
    try {
      await client.query(`
        INSERT INTO backend_identity.subject_bindings(
          binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role
        ) VALUES (
          'preflight-actor', 'synthetic', 'tenant-preflight', 'preflight-actor',
          'usr-preflight', repeat('a', 64), true, 'owner'
        );
        INSERT INTO content_intake.principals(
          principal_id, user_id, tenant_id, app_id, identity_scope, person_key,
          current_facts_version
        ) VALUES (
          'preflight-principal', 'usr-preflight', 'tenant-preflight', 'app-preflight',
          'confirmed-synthetic', 'preflight-person', 1
        );
        INSERT INTO content_intake.principal_facts(
          principal_id, facts_version, department_ids, job_id, enabled,
          checked_at, valid_until, facts_digest
        ) VALUES (
          'preflight-principal', 1, ARRAY['dept-preflight'], 'job-preflight', TRUE,
          clock_timestamp() - interval '1 second',
          clock_timestamp() + interval '4 minutes', repeat('d', 64)
        );
        INSERT INTO public.import_batches(
          import_batch_id, source_type, source_binding_hash, status, actor_user_id, tenant_id
        ) VALUES
          ('batch-active', 'csv', repeat('a', 64), 'staged', 'usr-preflight', 'default'),
          ('batch-historical', 'csv', repeat('b', 64), 'published', 'usr-preflight', 'default')
      `);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    expect((await client.query(`
      SELECT import_batch_id, tenant_id
      FROM public.import_batches
      WHERE import_batch_id IN ('batch-active', 'batch-historical')
      ORDER BY import_batch_id
    `)).rows).toEqual([
      { import_batch_id: 'batch-active', tenant_id: 'tenant-preflight' },
      { import_batch_id: 'batch-historical', tenant_id: 'tenant-preflight' },
    ]);
    await client.query(READ_ONLY_SNAPSHOT_SQL);
    const report = evaluateSnapshot(await collectSnapshot(client));
    const transaction = await client.query(
      'SELECT current_setting($1) AS isolation, current_setting($2) AS read_only',
      ['transaction_isolation', 'transaction_read_only'],
    );
    expect(transaction.rows).toEqual([{ isolation: 'repeatable read', read_only: 'on' }]);
    await client.query('ROLLBACK');
    expect(report).toMatchObject({
      schema: 'customer-agent-production-intake-tenancy/v1',
      ok: false,
      status: 'blocked',
      activeBatchCount: 1,
      historicalDefaultBatchCount: 0,
      blockers: [
        'ACTIVE_IMPORT_BATCH_SOURCE_MISSING',
        'CURRENT_RELEASE_MISSING',
      ],
    });
  });
});
