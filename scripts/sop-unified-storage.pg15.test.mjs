import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import test from 'node:test';
import { Pg15Harness, verifyMigrationPrefix } from '../packages/database/dist/testkit/index.js';
import { applyMigrationPrefix, verifyDatabaseMigrations } from '../packages/database/dist/index.js';
import { verifyIngestedCorrectedSopUnifiedContractSet } from './customer-agent-contract-set.mjs';

test('unified storage preserves the actual prefix and remains unregistered with the formal verifier', { timeout: 180000 }, async t => {
  const pg = new Pg15Harness();
  let client;
  try {
    pg.start();
    const database = pg.createDatabase('sop_unified_storage');
    client = await pg.connect(database.config);
    const server = (await client.query("SELECT current_setting('data_directory') AS data,inet_server_addr() IS NULL AS socket_only,current_setting('listen_addresses') AS tcp,current_setting('server_version_num')::int AS version")).rows[0];
    assert.equal(realpathSync(server.data), realpathSync(pg.data));
    assert.equal(server.socket_only, true);
    assert.equal(server.tcp, '');
    assert.equal(Math.trunc(server.version / 10000), 15);
    await applyMigrationPrefix(client, 83);
    await verifyMigrationPrefix(client, 83);
    const before = (await client.query('SELECT migration_id,migration_sha256 FROM customer_agent_meta.schema_migrations ORDER BY position')).rows;
    const manifest = JSON.parse(readFileSync(new URL('../packages/database/migrations/manifest.generated.json', import.meta.url)));
    assert.equal(before.length, 83);
    assert.equal(before.at(-1).migration_id, manifest.migrations[82].id);
    const unified = verifyIngestedCorrectedSopUnifiedContractSet();
    const storage = readFileSync(new URL(`../contracts/upstream/customer-agent/${unified.contract_set_id}/storage.v1.sql`, import.meta.url), 'utf8');
    assert.doesNotMatch(storage, /^\s*(BEGIN|COMMIT);/m);
    await client.query('BEGIN');
    try {
      await client.query(storage);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    await t.test('prefix receipts remain intact and graph tables start empty', async () => {
      assert.deepEqual((await client.query('SELECT migration_id,migration_sha256 FROM customer_agent_meta.schema_migrations ORDER BY position')).rows, before);
      for (const table of ['sop_graph_versions', 'sop_graph_quality_targets', 'sop_graph_release_lineage', 'sop_active_uses', 'sop_query_leases']) {
        assert.equal((await client.query(`SELECT count(*)::int AS n FROM content_intake.${table}`)).rows[0].n, 0);
      }
    });
    await t.test('lineage binds the original deferred publication', async () => {
      const row = (await client.query("SELECT contype,condeferrable,condeferred,convalidated,confrelid::regclass::text AS target FROM pg_constraint WHERE conname='sop_graph_original_publication_fk'")).rows[0];
      assert.deepEqual(row, { contype: 'f', condeferrable: true, condeferred: true, convalidated: true, target: 'content_intake.publications' });
    });
    await t.test('runtime cannot issue or validate leases or write active flows', async () => {
      const row = (await client.query("SELECT has_function_privilege('app_runtime','content_intake.issue_sop_query_lease(text,text,text,uuid,text,text,timestamptz,timestamptz,bigint)','EXECUTE') AS issue,has_function_privilege('app_runtime','content_intake.validate_sop_query_lease(text,text,text,uuid,bigint)','EXECUTE') AS validate,has_table_privilege('app_runtime','content_intake.sop_active_uses','INSERT') AS active_write")).rows[0];
      assert.deepEqual(row, { issue: false, validate: false, active_write: false });
      await client.query('SET ROLE intake_runtime_fn_owner');
      try {
        await assert.rejects(client.query("SELECT content_intake.issue_sop_query_lease('sopl_'||repeat('a',64),repeat('b',64),'synthetic-release','00000000-0000-4000-8000-000000000001',repeat('c',64),'context-a',clock_timestamp(),clock_timestamp()+interval '301 seconds',0)"), error => error.code === '22023');
      } finally { await client.query('RESET ROLE'); }
    });
    await t.test('formal migration verifier rejects the unregistered DDL', async () => {
      await assert.rejects(verifyDatabaseMigrations(client), error => error.code === 'MIGRATION_VERIFY_FAILED');
    });
  } finally {
    if (client) await client.end();
    pg.stop();
  }
});
