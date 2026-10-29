import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Pg15Harness } from '../../packages/database/dist/testkit/index.js';
import { applyDatabaseMigrations } from '../../packages/database/dist/index.js';
import { createSeatPasswordFile } from '../../apps/api/src/content-intake/seat-password-file.ts';
import { buildAccount, loadPasswordAccounts, passwordMatches, seatBindingIdFor } from './identity-admission.ts';
import { bindMenokinTestIdentities } from './menokin-test-binding.ts';
import { bindKnownPrincipal } from '../../apps/api/src/content-intake/bind-known-principal.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'password-entry-test-'));
const previousRoot = process.env.CUSTOMER_AGENT_STACK_ROOT;
process.env.CUSTOMER_AGENT_STACK_ROOT = root;
const { passwordBindingAllowedFromStack: lookup } = await import('./seat-binding-lookup.ts');
const profileFile = path.join(root, 'profile.json');
const password = 'synthetic-password-entry-test';
const usernames = ['normal', '_seat', '-seat', 'A'.repeat(64)];
let harness;
let database;
let owner;
let profile;

before(async () => {
  harness = new Pg15Harness();
  harness.start();
  database = harness.createDatabase('password_entry');
  owner = await harness.connect(database.config);
  await applyDatabaseMigrations(owner);
  await owner.query('CREATE ROLE stack_intake_business LOGIN NOINHERIT');
  await owner.query('GRANT intake_business TO stack_intake_business');
  profile = {
    version: 1, stackRoot: root, databaseName: database.name,
    apiOrigin: 'http://127.0.0.1:43100', identityOrigin: 'http://127.0.0.1:43101',
    pgSocketDirectory: harness.socket, pgPort: harness.port,
  };
  writeFileSync(profileFile, JSON.stringify(profile));
  await owner.query('BEGIN');
  try {
    await owner.query(`INSERT INTO content_intake.policy_versions VALUES ('tenant-test','app-test',1);
      INSERT INTO content_intake.role_rules VALUES
        ('tenant-test','app-test','dept-seat','job-seat',1,'agent'),
        ('tenant-test','app-test','dept-admin','job-master-account',1,'director')`);
    for (const [index, username] of ['master.admin', ...usernames].entries()) {
      const admin = index === 0;
      const binding = admin ? 'binding-master' : seatBindingIdFor(username);
      await owner.query(`INSERT INTO backend_identity.subject_bindings
        (binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
        VALUES ($1,'synthetic','tenant-test',$2,$3,$4,true,$5)`,
      [binding, username, `user-${index}`, String(index).repeat(64), admin ? 'owner' : 'agent']);
      await owner.query(`INSERT INTO content_intake.principals
        (principal_id,user_id,tenant_id,app_id,identity_scope,person_key,current_facts_version)
        VALUES ($1,$2,'tenant-test','app-test',$3,$4,1)`,
      [`person-${index}`, `user-${index}`, admin ? 'production-admin' : 'confirmed-synthetic', `person-key-${index}`]);
      await owner.query(`INSERT INTO content_intake.principal_facts
        (principal_id,facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest)
        VALUES ($1,1,ARRAY[$2],$3,true,clock_timestamp(),clock_timestamp()+interval '1 hour',repeat('f',64))`,
      [`person-${index}`, admin ? 'dept-admin' : 'dept-seat', admin ? 'job-master-account' : 'job-seat']);
      await owner.query(`INSERT INTO content_intake.seat_posts
        (principal_id,tenant_id,app_id,department_id,job_id,assigned_by)
        VALUES ($1,'tenant-test','app-test',$2,$3,'password-entry-test')`,
      [`person-${index}`, admin ? 'dept-admin' : 'dept-seat', admin ? 'job-master-account' : 'job-seat']);
    }
    await owner.query('COMMIT');
  } catch (error) {
    await owner.query('ROLLBACK');
    throw error;
  }
}, { timeout: 120000 });

after(async () => {
  try { await owner?.end(); }
  finally {
    try { harness?.stop(); }
    finally {
      rmSync(root, { recursive: true, force: true });
      if (previousRoot === undefined) delete process.env.CUSTOMER_AGENT_STACK_ROOT;
      else process.env.CUSTOMER_AGENT_STACK_ROOT = previousRoot;
    }
  }
});

test('NOINHERIT denies the direct query; the existing capability allows it without owner rights', async (t) => {
  const client = await harness.connect({ ...database.config, user: 'stack_intake_business' });
  try {
    const roles = await client.query(`SELECT rolname,rolinherit,rolsuper FROM pg_roles
      WHERE rolname IN ('stack_intake_business','intake_business') ORDER BY rolname`);
    assert.equal(roles.rows.length, 2);
    assert.equal(roles.rows.find(row => row.rolname === 'stack_intake_business').rolinherit, false);
    assert.ok(roles.rows.every(row => row.rolsuper === false));
    await assert.rejects(client.query("SELECT content_intake.password_login_allowed('binding-master')"),
      (error) => { t.diagnostic(`direct LOGIN query: ${error.code} ${error.message}`); return error.code === '42501'; });
    await client.query('SET ROLE intake_business');
    assert.deepEqual((await client.query('SELECT session_user, current_user')).rows[0],
      { session_user: 'stack_intake_business', current_user: 'intake_business' });
    assert.equal((await client.query("SELECT content_intake.password_login_allowed('binding-master') AS allowed")).rows[0].allowed, true);
    await assert.rejects(client.query('SELECT * FROM backend_identity.subject_bindings'), { code: '42501' });
    await client.query('RESET ROLE');
    await assert.rejects(client.query("SELECT content_intake.password_login_allowed('binding-master')"), { code: '42501' });
  } finally { await client.end(); }
});

test('default production lookup accepts the controlled master and creates no grants', async (t) => {
  const result = await lookup('binding-master');
  t.diagnostic(`default master lookup: ${result}`);
  assert.equal(result, true);
  assert.equal((await owner.query('SELECT count(*)::int AS count FROM content_intake.grants')).rows[0].count, 0);
});

for (const username of usernames) {
  test(`real writer → reader → default lookup accepts ${username}`, async () => {
    const file = path.join(root, `account-${username}.json`);
    const binding = seatBindingIdFor(username);
    const writer = createSeatPasswordFile(file);
    writer.upsert(username, binding, password);
    const account = loadPasswordAccounts(file).get(username);
    assert.ok(account, 'the reader must retain a valid writer account even when it is the only row');
    assert.equal(account.bindingId, binding);
    assert.equal(passwordMatches(account, password), true);
    assert.equal(passwordMatches(account, 'wrong-password'), false);
    assert.equal(await lookup(account.bindingId), true);
    writer.upsert(username, binding, `${password}-reset`);
    const reset = loadPasswordAccounts(file).get(username);
    assert.equal(passwordMatches(reset, password), false);
    assert.equal(passwordMatches(reset, `${password}-reset`), true);
    assert.equal(await lookup(reset.bindingId), true);
  });
}

test('reader preserves existing dotted admin login alongside writer-created underscore and hyphen names', async () => {
  const file = path.join(root, 'mixed.json');
  writeFileSync(file, JSON.stringify([buildAccount('master.admin', 'binding-master', password)]));
  const writer = createSeatPasswordFile(file);
  for (const username of ['_seat', '-seat']) writer.upsert(username, seatBindingIdFor(username), password);
  const accounts = loadPasswordAccounts(file);
  assert.equal(accounts.size, 3);
  for (const account of accounts.values()) {
    assert.equal(passwordMatches(account, password), true);
    assert.equal(await lookup(account.bindingId), true);
  }
});

test('reader rejects invalid usernames and credentials while retaining a valid row', () => {
  const file = path.join(root, 'invalid.json');
  const good = buildAccount('normal', 'synthetic_seat_normal', password);
  const invalid = ['', '.seat', 'a b', 'a/b', 'a:b', '中文', 'a'.repeat(65)];
  writeFileSync(file, JSON.stringify([
    good, ...invalid.map(username => ({ ...good, username })),
    { ...good, username: 'bad-salt', salt: 'not-hex' },
    { ...good, username: 'bad-hash', hash: 'not-hex' },
    { ...good, username: 'bad-binding', bindingId: '../owner' },
  ]));
  assert.deepEqual([...loadPasswordAccounts(file).keys()], ['normal']);
});

test('default lookup rejects unknown, disabled, role-mismatched and missing-post bindings', async () => {
  assert.equal(await lookup('not-registered'), false);
  const binding = seatBindingIdFor('_seat');
  try {
    await owner.query('UPDATE backend_identity.subject_bindings SET enabled=false WHERE binding_id=$1', [binding]);
    assert.equal(await lookup(binding), false);
    await owner.query("UPDATE backend_identity.subject_bindings SET enabled=true,role='owner' WHERE binding_id=$1", [binding]);
    assert.equal(await lookup(binding), false);
  } finally {
    await owner.query("UPDATE backend_identity.subject_bindings SET enabled=true,role='agent' WHERE binding_id=$1", [binding]);
  }
  await owner.query("DELETE FROM content_intake.seat_posts WHERE principal_id='person-2'");
  try { assert.equal(await lookup(binding), false); }
  finally {
    await owner.query(`INSERT INTO content_intake.seat_posts
      (principal_id,tenant_id,app_id,department_id,job_id,assigned_by)
      VALUES ('person-2','tenant-test','app-test','dept-seat','job-seat','password-entry-test')`);
  }
});

test('failed SET ROLE and unavailable profile/database fail closed without owner fallback', async () => {
  await owner.query('REVOKE intake_business FROM stack_intake_business');
  try { assert.equal(await lookup('binding-master'), false); }
  finally { await owner.query('GRANT intake_business TO stack_intake_business'); }
  assert.equal(await lookup('binding-master'), true);
  const saved = readFileSync(profileFile);
  try {
    rmSync(profileFile);
    assert.equal(await lookup('binding-master'), false);
    writeFileSync(profileFile, JSON.stringify({ ...profile, databaseName: 'missing_password_test_database' }));
    assert.equal(await lookup('binding-master'), false);
  } finally { writeFileSync(profileFile, saved); }
});

test('restarting an existing Menokin test stack preserves short, expired and revoked grants', async () => {
  const { seedReferenceData } = await import('./bootstrap.ts');
  const isolated = new Pg15Harness();
  let client;
  try {
    isolated.start();
    const db = isolated.createDatabase('menokin_restart');
    client = await isolated.connect(db.config);
    await applyDatabaseMigrations(client);
    await seedReferenceData(client);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM content_intake.scopes
      WHERE tenant_id='tenant-menokin' AND app_id='app-customer-agent' AND domain<>'sop'`)).rows[0].count, 4);
    for (const [id, job, role] of [['owner', 'director', 'director'], ['coach', 'lead', 'lead'], ['agent', 'agent', 'agent']]) {
      await bindKnownPrincipal(client, { principalId: `synthetic_${id}`, userId: `usr_synthetic_${id}`,
        tenantId: 'tenant-menokin', appId: 'app-customer-agent', identityScope: 'confirmed-synthetic',
        personKey: `synthetic_${id}`, departmentIds: ['dept-menokin'], jobId: `job-${job}` });
      await client.query(`INSERT INTO content_intake.role_rules VALUES
        ('tenant-menokin','app-customer-agent','dept-menokin',$1,1,$2)`, [`job-${job}`, role]);
    }
    for (const [domain, source, parentMinutes, childMinutes] of [['product', 'faq', 10, 5], ['presale', 'presale', -1, -2]]) {
      const rootId = `menokin-root2-scope-menokin-${domain}-query`;
      await client.query(`INSERT INTO content_intake.grants
        (grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
        VALUES ($1,'allocation','synthetic_owner','synthetic_owner','tenant-menokin','app-customer-agent',$2,'query',
          clock_timestamp()-interval '1 hour',clock_timestamp()+$3*interval '1 minute','合成历史根授权','synthetic_owner')`,
      [rootId, `scope-menokin-${domain}`, parentMinutes]);
      for (const person of ['agent', 'coach']) await client.query(`INSERT INTO content_intake.grants
        (grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
        VALUES ($1,'business','synthetic_owner',$2,'tenant-menokin','app-customer-agent',$3,$4,'query',
          clock_timestamp()-interval '10 minutes',clock_timestamp()+$5*interval '1 minute','合成历史子授权','synthetic_owner',$6)`,
      [`menokin-${person}2-scope-menokin-${domain}-query`, `synthetic_${person}`, `scope-menokin-${domain}`, `src-menokin-${source}`, childMinutes, rootId]);
    }
    await bindMenokinTestIdentities(client, db.name);
    const saved = await client.query(`SELECT to_jsonb(g) AS row FROM content_intake.grants g ORDER BY grant_id`);
    // A BEFORE INSERT trigger runs even for a conflicting primary key. Reproduce that
    // exact failure using an oversized hypothetical child, without changing the stored row.
    await assert.rejects(client.query(`INSERT INTO content_intake.grants
      SELECT (jsonb_populate_record(NULL::content_intake.grants,to_jsonb(g)||
        jsonb_build_object('expires_at',clock_timestamp()+interval '3 days'))).*
      FROM content_intake.grants g WHERE grant_id='menokin-agent2-scope-menokin-product-query'
      ON CONFLICT (grant_id) DO NOTHING`), /GRANT_PARENT_MISMATCH/);
    await client.query(`UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,
      last_change_reason='合成重启撤权验收' WHERE grant_id='menokin-agent2-scope-menokin-product-query'`);
    const before = await client.query(`SELECT to_jsonb(g) AS row FROM content_intake.grants g ORDER BY grant_id`);
    const history = await client.query('SELECT count(*)::int AS count FROM content_intake.grant_history');
    await bindMenokinTestIdentities(client, db.name);
    assert.deepEqual((await client.query(`SELECT to_jsonb(g) AS row FROM content_intake.grants g ORDER BY grant_id`)).rows, before.rows);
    assert.deepEqual((await client.query('SELECT count(*)::int AS count FROM content_intake.grant_history')).rows, history.rows);
    assert.equal(saved.rows.length, before.rows.length);
  } finally {
    try { await client?.end(); } finally { isolated.stop(); }
  }
}, { timeout: 120000 });
