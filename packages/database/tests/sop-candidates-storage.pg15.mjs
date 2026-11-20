import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { applyDatabaseMigrations, applyMigrationPrefix, verifyDatabaseMigrations } from '../dist/index.js';
import { Pg15Harness } from '../dist/testkit/index.js';
import { installSopCandidateSyntheticStorage } from '../candidates/w5_sop_candidates/install.test-only.ts';

const privateSchema = 'w5_sop_candidate_draft';
const apiSchema = 'w5_sop_candidates';
const recordSignature = `${apiSchema}.record_discovery(jsonb,uuid,text,text,text,timestamptz,jsonb)`;
const resolveSignature = `${apiSchema}.resolve_candidate(jsonb,uuid,text)`;
const recordSql = `SELECT ${apiSchema}.record_discovery($1,$2,$3,$4,$5,$6,$7) AS decision`;
const resolveSql = `SELECT * FROM ${apiSchema}.resolve_candidate($1,$2,$3)`;
const roles = ['app_runtime', 'intake_business', 'intake_worker', 'intake_usage', 'intake_org_writer'];
const fixture = {
  candidate_ref: 'sdc_' + 'a'.repeat(64), label: '配送步骤', sop_group: 'shipping',
  source_id: 'synthetic-source', flow_id: 'synthetic-flow', graph_digest: 'b'.repeat(64),
  candidate_id: 'synthetic-candidate', candidate_version: 3, facts_version: 4,
};

test('W5 private storage and narrow usage functions on disposable PostgreSQL 15', { timeout: 120_000 }, async t => {
  const pg = new Pg15Harness();
  pg.start();
  const clients = [];
  t.after(async () => {
    try {
      await Promise.all(clients.map(client => client.end()));
    } finally {
      pg.stop();
    }
  });
  const config = pg.createDatabase('w5_sop_candidates').config;
  const admin = await pg.connect(config);
  clients.push(admin);
  await applyMigrationPrefix(admin, 89);
  await assert.rejects(installSopCandidateSyntheticStorage(admin, pg), /ledger is pending|ledger is incomplete|ledger .* not complete/i);
  assert.equal((await admin.query('SELECT to_regnamespace($1) AS schema', [privateSchema])).rows[0].schema, null);
  await applyDatabaseMigrations(admin);
  assert.equal((await verifyDatabaseMigrations(admin)).migrationCount, 90);
  const baseline = await admin.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position');
  const managed = await admin.query(`
    SELECT p.oid::regprocedure::text AS signature, pg_get_functiondef(p.oid) AS definition, p.proacl::text AS acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname = 'content_intake' ORDER BY signature
  `);
  assert.equal((await admin.query('SELECT to_regnamespace($1) AS schema', [privateSchema])).rows[0].schema, null);
  await installSopCandidateSyntheticStorage(admin, pg);
  assert.deepEqual((await admin.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position')).rows, baseline.rows);
  assert.deepEqual((await admin.query(`
    SELECT p.oid::regprocedure::text AS signature, pg_get_functiondef(p.oid) AS definition, p.proacl::text AS acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname = 'content_intake' ORDER BY signature
  `)).rows, managed.rows);
  await assert.rejects(verifyDatabaseMigrations(admin), /exact database object\/owner manifest/);

  for (const role of roles) {
    const { rows: [acl] } = await admin.query(`
      SELECT has_schema_privilege($1,$2,'USAGE') AS private_use,
        has_schema_privilege($1,$3,'USAGE') AS api_use,
        has_table_privilege($1,($2||'.discovery')::regclass,'SELECT,INSERT,UPDATE,DELETE') AS discoveries,
        has_table_privilege($1,($2||'.candidate')::regclass,'SELECT,INSERT,UPDATE,DELETE') AS candidates,
        has_function_privilege($1,$4,'EXECUTE') AS record,
        has_function_privilege($1,$5,'EXECUTE') AS resolve,
        has_function_privilege($1,$4,'EXECUTE WITH GRANT OPTION') AS can_grant_record,
        has_function_privilege($1,$5,'EXECUTE WITH GRANT OPTION') AS can_grant_resolve
    `, [role, privateSchema, apiSchema, recordSignature, resolveSignature]);
    const usage = role === 'intake_usage';
    assert.deepEqual(acl, { private_use: false, api_use: usage, discoveries: false, candidates: false,
      record: usage, resolve: usage, can_grant_record: false, can_grant_resolve: false }, role);
  }
  assert.deepEqual((await admin.query(`
    SELECT p.proname, p.prosecdef, p.proconfig,
      pg_get_userbyid(p.proowner) AS owner,
      EXISTS (SELECT FROM aclexplode(p.proacl) WHERE grantee = 0 AND privilege_type = 'EXECUTE') AS public_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname = $1 ORDER BY p.proname
  `, [apiSchema])).rows, ['record_discovery', 'resolve_candidate'].map(proname => ({
    proname, prosecdef: true, proconfig: ['search_path=pg_catalog, pg_temp'], owner: 'intake_runtime_fn_owner', public_execute: false,
  })));

  const usage = await pg.connect(config);
  clients.push(usage);
  await usage.query('SET ROLE intake_usage');
  await assert.rejects(usage.query(`SELECT count(*) FROM ${privateSchema}.candidate`), error => error.code === '42501');
  const now = Date.now();
  const authority = {
    session_hash: 'a'.repeat(64), principal_id: 'synthetic-agent', entitlement_hash: 'b'.repeat(64),
    release_id: 'rel_w5', authority_binding: 'c'.repeat(64),
    valid_until: new Date(now + 90_000), session_expires_at: new Date(now + 120_000),
  };
  const requestId = randomUUID();
  const fingerprint = 'd'.repeat(64);
  const generation = 'ctx-1';
  const deadline = new Date(now + 60_000);
  const replay = [authority, requestId, fingerprint, generation, null, null, '[]'];
  assert.equal((await usage.query(recordSql, replay)).rows[0].decision, null);
  const save = [authority, requestId, fingerprint, generation, 'candidates', deadline, JSON.stringify([fixture])];
  const { rows: [{ decision }] } = await usage.query(recordSql, save);
  assert.deepEqual(decision, { status: 'candidates', request_id: requestId, release_id: 'rel_w5',
    expires_at: deadline.toISOString().replace('Z', '000Z'), candidates: [{ candidate_ref: fixture.candidate_ref, label: fixture.label }] });
  assert.deepEqual((await usage.query(recordSql, replay)).rows[0].decision, decision);
  await assert.rejects(usage.query(recordSql, [authority, requestId, 'e'.repeat(64), ...replay.slice(3)]), error => error.code === 'W5001');

  assert.deepEqual((await usage.query(resolveSql, [authority, requestId, fixture.candidate_ref])).rows, [{
    sop_group: fixture.sop_group, source_id: fixture.source_id, flow_id: fixture.flow_id, graph_digest: fixture.graph_digest,
    candidate_id: fixture.candidate_id, candidate_version: '3', facts_version: '4', context_generation: generation, expires_at: deadline,
  }]);
  for (const mismatched of [{ entitlement_hash: 'e'.repeat(64) }, { session_hash: 'f'.repeat(64) }, { release_id: 'rel_other' }]) {
    assert.deepEqual((await usage.query(resolveSql, [{ ...authority, ...mismatched }, requestId, fixture.candidate_ref])).rows, []);
  }
  assert.deepEqual((await usage.query(resolveSql, [authority, requestId, 'sdc_' + 'f'.repeat(64)])).rows, []);

  const rollbackId = randomUUID();
  const invalid = [authority, rollbackId, fingerprint, generation, 'candidates', deadline,
    JSON.stringify([fixture, { ...fixture, candidate_ref: 'sdc_' + 'f'.repeat(64) }])];
  await assert.rejects(usage.query(recordSql, invalid), error => error.code === '23505');
  assert.equal((await usage.query(recordSql, [authority, rollbackId, ...replay.slice(2)])).rows[0].decision, null);

  await admin.query(`UPDATE ${privateSchema}.discovery SET issued_at=clock_timestamp()-interval '3 seconds',
    expires_at=clock_timestamp()-interval '1 second' WHERE request_id=$1`, [requestId]);
  await assert.rejects(usage.query(resolveSql, [authority, requestId, fixture.candidate_ref]), error => error.code === 'W5002');
  await assert.rejects(usage.query(recordSql, replay), error => error.code === 'W5002');
  await assert.rejects(usage.query(recordSql, [authority, requestId, 'e'.repeat(64), ...replay.slice(3)]), error => error.code === 'W5001');
  assert.deepEqual((await usage.query(resolveSql, [{ ...authority, entitlement_hash: 'e'.repeat(64) }, requestId, fixture.candidate_ref])).rows, []);

  await usage.query(recordSql, [authority, randomUUID(), fingerprint, generation, 'no_match', deadline, '[]']);
  assert.equal((await admin.query(`SELECT count(*)::int AS found FROM ${privateSchema}.discovery WHERE request_id=$1`, [requestId])).rows[0].found, 1);
  await admin.query(`UPDATE ${privateSchema}.discovery SET session_expires_at=clock_timestamp()-interval '500 milliseconds' WHERE request_id=$1`, [requestId]);
  await usage.query(recordSql, [authority, randomUUID(), fingerprint, generation, 'no_match', deadline, '[]']);
  for (const table of ['discovery', 'candidate']) {
    const column = table === 'discovery' ? 'request_id' : 'discovery_request_id';
    assert.equal((await admin.query(`SELECT count(*)::int AS found FROM ${privateSchema}.${table} WHERE ${column}=$1`, [requestId])).rows[0].found, 0);
  }
});
