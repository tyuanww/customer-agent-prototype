import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import test from 'node:test';
import { Pg15Harness } from '../dist/testkit/index.js';
import { applyDatabaseMigrations, applyMigrationPrefix, verifyDatabaseMigrations } from '../dist/index.js';
import { applyMigrationCatalogue } from '../dist/runner.js';
import { verifyReadinessSuccessor } from '../dist/verifier.js';
import { generatedMigrationCatalogue as catalogue } from '../dist/generated/migrations.generated.js';

const prefix = { ...catalogue, migrations: catalogue.migrations.slice(0, 83) };
const graphTables = ['sop_graph_versions', 'sop_graph_media_bindings', 'sop_graph_quality_targets',
  'sop_graph_quality_checks', 'sop_graph_release_lineage', 'sop_graph_release_media',
  'sop_active_uses', 'sop_graph_disable_events', 'sop_query_leases'];
const receipts = async client => (await client.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position')).rows;
const faqState = async client => (await client.query(`
  SELECT 'function' AS kind, p.oid::regprocedure::text AS name, pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','content_intake') AND p.proname NOT LIKE 'sop_graph_%'
    AND p.proname NOT IN ('issue_sop_query_lease','validate_sop_query_lease','sop_query_lease_immutable')
  UNION ALL
  SELECT 'current', 'public.content_current', coalesce(jsonb_agg(to_jsonb(c))::text,'[]') FROM public.content_current c
  ORDER BY kind,name`)).rows;

async function expectNoUnifiedStorage(client) {
  for (const name of graphTables) {
    assert.equal((await client.query('SELECT to_regclass($1)::text AS name', [`content_intake.${name}`])).rows[0].name, null);
  }
  assert.equal((await client.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='content_intake' AND table_name='entitlements' AND column_name='sop_continuation_hash'")).rows[0].n, 0);
  assert.equal((await receipts(client)).length, 83);
}

test('formal unified SOP migration on isolated PostgreSQL 15', { timeout: 180000 }, async t => {
  const pg = new Pg15Harness();
  const clients = [];
  const clusters = [pg];
  async function database(label) {
    const cluster = clients.length === 0 ? pg : new Pg15Harness();
    if (cluster !== pg) { cluster.start(); clusters.push(cluster); }
    const client = await cluster.connect(cluster.createDatabase(label).config);
    clients.push(client);
    return client;
  }
  t.after(async () => {
    const results = await Promise.allSettled(clients.map(client => client.end()));
    results.push(...await Promise.allSettled(clusters.map(async cluster => cluster.stop())));
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length > 0) throw new AggregateError(errors, 'Temporary PostgreSQL cleanup failed');
  });
  pg.start();
  const client = await database('sop_unified_upgrade');
  const identity = (await client.query("SELECT current_setting('data_directory') AS data, inet_server_addr() IS NULL AS socket_only, current_setting('listen_addresses') AS tcp, current_setting('server_version_num')::int AS version")).rows[0];
  assert.equal(realpathSync(identity.data), realpathSync(pg.data));
  assert.equal(identity.socket_only, true);
  assert.equal(identity.tcp, '');
  assert.equal(Math.trunc(identity.version / 10000), 15);
  await applyMigrationPrefix(client, 83);
  assert.equal((await verifyReadinessSuccessor(client, prefix)).status, 'PASS');
  const before = await receipts(client);
  const faqBefore = await faqState(client);

  await t.test('upgrades the actual 83 receipts once and preserves FAQ functions and current', async () => {
    const result = await applyDatabaseMigrations(client);
    assert.deepEqual(result.applied.map(entry => entry.id), ['0084_sop_unified_storage']);
    assert.deepEqual((await receipts(client)).slice(0, 83), before);
    assert.deepEqual(await faqState(client), faqBefore);
    assert.equal((await verifyDatabaseMigrations(client)).migrationCount, 84);
    for (const name of graphTables) {
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM content_intake.${name}`)).rows[0].n, 0);
    }
    const after = await receipts(client);
    assert.deepEqual((await applyDatabaseMigrations(client)).applied, []);
    assert.deepEqual(await receipts(client), after);
  });

  await t.test('retains the original deferred publication FK, restricted ACL and five minute bound', async () => {
    const fk = (await client.query("SELECT contype,condeferrable,condeferred,convalidated,confrelid::regclass::text AS target FROM pg_constraint WHERE conname='sop_graph_original_publication_fk'")).rows[0];
    assert.deepEqual(fk, { contype: 'f', condeferrable: true, condeferred: true, convalidated: true, target: 'content_intake.publications' });
    for (const role of ['app_runtime', 'intake_business', 'intake_worker', 'intake_usage']) {
      for (const name of graphTables) {
        const privileges = (await client.query('SELECT has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\') AS allowed', [role, `content_intake.${name}`])).rows[0];
        assert.equal(privileges.allowed, false, `${role} ${name}`);
      }
    }
    const issue = 'content_intake.issue_sop_query_lease(text,text,text,uuid,text,text,timestamptz,timestamptz,bigint)';
    const validate = 'content_intake.validate_sop_query_lease(text,text,text,uuid,bigint)';
    assert.equal((await client.query("SELECT has_function_privilege('app_runtime',$1,'EXECUTE') AS allowed", [issue])).rows[0].allowed, false);
    assert.equal((await client.query("SELECT has_function_privilege('app_runtime',$1,'EXECUTE') AS allowed", [validate])).rows[0].allowed, false);
    await client.query('SET ROLE intake_runtime_fn_owner');
    try {
      await assert.rejects(client.query("SELECT content_intake.issue_sop_query_lease('sopl_'||repeat('a',64),repeat('b',64),'synthetic-release','00000000-0000-4000-8000-000000000001',repeat('c',64),'context-a',clock_timestamp(),clock_timestamp()+interval '301 seconds',0)"), error => error.code === '22023');
      await assert.rejects(client.query("SELECT content_intake.issue_sop_query_lease('sopl_'||repeat('a',64),repeat('b',64),'synthetic-release','00000000-0000-4000-8000-000000000001',repeat('c',64),'context-a','2026-11-09T00:00:00Z','2026-11-09T00:05:00Z',0)"), error => error.code === '23503');
    } finally { await client.query('RESET ROLE'); }
  });

  await t.test('formal verifier rejects FK, owner, function, trigger, ACL and receipt tampering', async () => {
    for (const mutation of [
      'ALTER TABLE content_intake.sop_graph_release_lineage DROP CONSTRAINT sop_graph_original_publication_fk',
      'ALTER TABLE content_intake.sop_graph_versions OWNER TO gate_owner',
      "ALTER FUNCTION content_intake.issue_sop_query_lease(text,text,text,uuid,text,text,timestamptz,timestamptz,bigint) SECURITY INVOKER",
      'ALTER TABLE content_intake.sop_graph_versions DISABLE TRIGGER immutable',
      'GRANT SELECT ON content_intake.sop_graph_versions TO app_runtime',
      "UPDATE customer_agent_meta.schema_migrations SET migration_sha256=repeat('0',64) WHERE position=84",
    ]) {
      await client.query('BEGIN');
      try {
        await client.query(mutation);
        await assert.rejects(verifyDatabaseMigrations(client), error => ['MIGRATION_VERIFY_FAILED', 'MIGRATION_LEDGER_DRIFT'].includes(error.code), mutation);
      } finally { await client.query('ROLLBACK'); }
    }
    assert.equal((await verifyDatabaseMigrations(client)).status, 'PASS');
  });

  await t.test('rolls back all DDL when the receipt insert fails and retries with the same catalogue', async () => {
    const retry = await database('sop_unified_retry');
    await applyMigrationPrefix(retry, 83);
    const beforeRetry = await receipts(retry);
    let injected = false;
    const interrupted = { query: async (...args) => {
      if (!injected && typeof args[0] === 'string' && args[0].includes('INSERT INTO customer_agent_meta.schema_migrations') && args[1]?.[0] === 84) {
        injected = true;
        return retry.query('SELECT 1 / 0');
      }
      return retry.query(...args);
    } };
    await assert.rejects(applyMigrationCatalogue(interrupted, catalogue), error => error.code === 'MIGRATION_APPLY_FAILED' && error.migrationId === '0084_sop_unified_storage' && error.databaseCode === '22012');
    assert.equal(injected, true);
    await expectNoUnifiedStorage(retry);
    assert.deepEqual(await receipts(retry), beforeRetry);
    assert.equal((await verifyReadinessSuccessor(retry, prefix)).status, 'PASS');
    assert.deepEqual((await applyDatabaseMigrations(retry)).applied.map(entry => entry.id), ['0084_sop_unified_storage']);
    assert.deepEqual((await applyDatabaseMigrations(retry)).applied, []);
    assert.equal((await verifyDatabaseMigrations(retry)).status, 'PASS');
  });

  await t.test('recovers an unknown commit acknowledgement from the durable ledger', async () => {
    const unknown = await database('sop_unified_commit_unknown');
    await applyMigrationPrefix(unknown, 83);
    let committed = false;
    const lostAcknowledgement = { query: async (...args) => {
      const result = await unknown.query(...args);
      if (args[0] === 'COMMIT' && !committed) {
        committed = true;
        throw new Error('Synthetic commit acknowledgement loss after server commit');
      }
      return result;
    } };
    await assert.rejects(applyMigrationCatalogue(lostAcknowledgement, catalogue), error => error.code === 'MIGRATION_COMMIT_UNKNOWN');
    const { host, port, user, database: name } = unknown.connectionParameters;
    await unknown.end();
    const reconnected = await pg.connect({ host, port, user, database: name });
    clients.push(reconnected);
    assert.equal((await receipts(reconnected)).length, 84);
    assert.deepEqual((await applyDatabaseMigrations(reconnected)).applied, []);
    assert.equal((await verifyDatabaseMigrations(reconnected)).status, 'PASS');
  });

  await t.test('rejects a manual old graph before mutation and preserves its data on every retry', async () => {
    const conflict = await database('sop_unified_conflict');
    await applyMigrationPrefix(conflict, 83);
    await conflict.query('CREATE TABLE content_intake.sop_graph_versions (marker text); INSERT INTO content_intake.sop_graph_versions VALUES (\'synthetic-old-install\')');
    const beforeConflict = await receipts(conflict);
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(applyDatabaseMigrations(conflict), error => error.code === 'MIGRATION_APPLY_FAILED' && error.cause?.code === 'MIGRATION_VERIFY_FAILED');
      assert.deepEqual(await receipts(conflict), beforeConflict);
      assert.deepEqual((await conflict.query('SELECT marker FROM content_intake.sop_graph_versions')).rows, [{ marker: 'synthetic-old-install' }]);
      assert.equal((await conflict.query("SELECT to_regclass('content_intake.sop_active_uses') AS name")).rows[0].name, null);
    }
  });

  await t.test('keeps the frozen legacy query candidate independently installable on 83', async () => {
    const legacy = await database('sop_query');
    await applyMigrationPrefix(legacy, 83);
    assert.equal((await verifyReadinessSuccessor(legacy, prefix)).status, 'PASS');
    const sql = readFileSync(new URL('../candidates/0084_sop_query/candidate.generated.sql', import.meta.url), 'utf8');
    await legacy.query('BEGIN');
    try { await legacy.query(sql); await legacy.query('COMMIT'); }
    catch (error) { await legacy.query('ROLLBACK'); throw error; }
    assert.equal((await receipts(legacy)).length, 83);
    assert.equal((await legacy.query("SELECT to_regprocedure('content_intake.sop_query_normalize(text)') IS NOT NULL AS installed")).rows[0].installed, true);
    await assert.rejects(applyDatabaseMigrations(legacy), error => error.code === 'MIGRATION_APPLY_FAILED');
  });

  await t.test('fresh installation uses the same formal 84 catalogue', async () => {
    const fresh = await database('sop_unified_fresh');
    assert.equal((await applyDatabaseMigrations(fresh)).applied.length, 84);
    assert.equal((await verifyDatabaseMigrations(fresh)).status, 'PASS');
  });
});
