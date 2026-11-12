import type { Client, ClientConfig } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyMigrationPrefix, inspectDatabaseMigrations, verifyAppliedDatabaseMigrations, verifyDatabaseMigrations } from '../src/index.js';
import { Pg15Harness } from '../src/testkit/index.js';

describe.runIf(process.env.CUSTOMER_AGENT_DB_PG15_INTEGRATION === '1')('applied prefix PostgreSQL 15 proof', () => {
  let harness: Pg15Harness;
  let client: Client;
  let config: ClientConfig;
  beforeAll(async () => {
    harness = new Pg15Harness();
    harness.start();
    config = harness.createDatabase('applied_prefix').config;
    client = await harness.connect(config);
    await applyMigrationPrefix(client, 81);
  }, 120_000);
  afterAll(async () => { await client?.end(); harness?.stop(); }, 60_000);

  it('proves the actual 81 prefix while the full-catalogue verifier still rejects pending migrations', async () => {
    const before = await inspectDatabaseMigrations(client);
    expect(before.state).toBe('PARTIAL');
    await expect(verifyDatabaseMigrations(client)).rejects.toMatchObject({ code: 'MIGRATION_VERIFY_FAILED' });
    const queries = vi.spyOn(client, 'query');
    try {
      const report = await verifyAppliedDatabaseMigrations(client);
      expect(report).toMatchObject({ status: 'PASS', migrationCount: 81 });
      const baselineCount = before.compatibility.priorSignedBaseline?.migrationCount;
      if (baselineCount !== undefined) {
        expect(report.compatibility.priorUpgrade).toContain(`→ ${String(81 - baselineCount)}-migration current suffix`);
      }
      expect(queries.mock.calls[0]?.[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      expect(queries.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    } finally { queries.mockRestore(); }
    expect(await inspectDatabaseMigrations(client)).toEqual(before);
    expect((await client.query('SHOW transaction_read_only')).rows).toEqual([{ transaction_read_only: 'off' }]);
  }, 60_000);

  it('holds one read-only repeatable-read snapshot across concurrent ledger changes', async () => {
    const writer = await harness.connect(config);
    const original = (await writer.query('SELECT migration_sha256 FROM customer_agent_meta.schema_migrations WHERE position=81')).rows[0]?.migration_sha256;
    try {
      const proof = verifyAppliedDatabaseMigrations(client);
      const settings = await client.query(`SELECT current_setting('transaction_isolation') AS isolation,
        current_setting('transaction_read_only') AS read_only, txid_current_if_assigned() AS write_id`);
      expect(settings.rows).toEqual([{ isolation: 'repeatable read', read_only: 'on', write_id: null }]);
      await writer.query("UPDATE customer_agent_meta.schema_migrations SET migration_sha256=repeat('0',64) WHERE position=81");
      expect((await proof).migrationCount).toBe(81);
      await expect(verifyAppliedDatabaseMigrations(client)).rejects.toMatchObject({ code: 'MIGRATION_LEDGER_DRIFT' });
    } finally {
      await writer.query('UPDATE customer_agent_meta.schema_migrations SET migration_sha256=$1 WHERE position=81', [original]);
      await writer.end();
    }
  }, 60_000);

  it.each([
    ['unknown suffix', `INSERT INTO customer_agent_meta.schema_migrations
      SELECT 89,'0089_unknown',migration_sha256,contract_set_id,source_git_sha,source_schema_sha256,applied_at,execution_ms
      FROM customer_agent_meta.schema_migrations WHERE position=81`, 'MIGRATION_LEDGER_DRIFT'],
    ['provenance drift', `UPDATE customer_agent_meta.schema_migrations SET migration_sha256=repeat('0',64) WHERE position=81`, 'MIGRATION_LEDGER_DRIFT'],
    ['gap', 'DELETE FROM customer_agent_meta.schema_migrations WHERE position=80', 'MIGRATION_LEDGER_DRIFT'],
    ['empty ledger', 'DELETE FROM customer_agent_meta.schema_migrations', 'MIGRATION_VERIFY_FAILED'],
    ['physical drift', 'REVOKE EXECUTE ON FUNCTION public.content_question_hash(jsonb) FROM intake_runtime_fn_owner', 'MIGRATION_VERIFY_FAILED'],
  ])('rejects %s and preserves the rejected state', async (_label, mutation, code) => {
    const snapshot = await client.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position');
    await client.query(mutation);
    try {
      const rejected = await client.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position');
      await expect(verifyAppliedDatabaseMigrations(client)).rejects.toMatchObject({ code });
      expect((await client.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position')).rows).toEqual(rejected.rows);
    } finally {
      if (_label === 'physical drift') {
        await client.query('GRANT EXECUTE ON FUNCTION public.content_question_hash(jsonb) TO intake_runtime_fn_owner');
      } else {
        await client.query('DELETE FROM customer_agent_meta.schema_migrations');
        for (const row of snapshot.rows) {
          await client.query(`INSERT INTO customer_agent_meta.schema_migrations
            (position,migration_id,migration_sha256,contract_set_id,source_git_sha,source_schema_sha256,applied_at,execution_ms)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [row.position, row.migration_id, row.migration_sha256, row.contract_set_id, row.source_git_sha, row.source_schema_sha256, row.applied_at, row.execution_ms]);
        }
      }
    }
  }, 60_000);

  it.each([82, 83, 84, 85, 86, 87, 88])('proves the physical schema and exact ledger at committed prefix %i', async count => {
    await applyMigrationPrefix(client, count);
    const before = await inspectDatabaseMigrations(client);
    const report = await verifyAppliedDatabaseMigrations(client);
    expect(report).toMatchObject({ status: 'PASS', migrationCount: count });
    expect(await inspectDatabaseMigrations(client)).toEqual(before);
    if (count < 88) {
      await expect(verifyDatabaseMigrations(client)).rejects.toMatchObject({ code: 'MIGRATION_VERIFY_FAILED' });
    } else {
      expect(await verifyDatabaseMigrations(client)).toMatchObject({ status: 'PASS', migrationCount: count });
    }
  }, 120_000);

  it('rejects a fresh database without creating a ledger or schema', async () => {
    const empty = await harness.connect(harness.createDatabase('empty_proof').config);
    try {
      await expect(verifyAppliedDatabaseMigrations(empty)).rejects.toMatchObject({ code: 'MIGRATION_VERIFY_FAILED' });
      expect((await empty.query("SELECT to_regnamespace('customer_agent_meta') AS ledger")).rows).toEqual([{ ledger: null }]);
    } finally { await empty.end(); }
  });
});
