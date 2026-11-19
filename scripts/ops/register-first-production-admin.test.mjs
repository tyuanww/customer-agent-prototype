import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { after, before, test } from 'node:test';
import { applyDatabaseMigrations } from '../../packages/database/dist/index.js';
import { Pg15Harness } from '../../packages/database/dist/testkit/index.js';
import { PG_PORT, stackPortPairForRoot } from '../synthetic-stack/profile.ts';
import { parseArguments, parseEnrollmentRecord, readEnrollmentRecord,
  registerFirstProductionAdmin } from './register-first-production-admin.mjs';

const enabled = process.env.CUSTOMER_AGENT_STACK_PG15_INTEGRATION === '1';
const PIN = 'customer_agent.first_admin_record_sha256';
const PILOT_DATABASE = 'customer_agent_intake_test';
let harness;
let template;
let control;
const clients = [];
const execFileAsync = promisify(execFile);

before(async () => {
  if (!enabled) return;
  harness = new Pg15Harness();
  harness.start();
  template = harness.createDatabase('first_admin_template');
  const initial = await harness.connect(template.config);
  try { await applyDatabaseMigrations(initial); } finally { await initial.end(); }
  control = await connect({ ...template.config, database: 'postgres' });
});

after(async () => {
  await Promise.all(clients.map(client => client.end()));
  const root = harness?.root;
  harness?.stop();
  if (root) assert.equal(existsSync(root), false);
});

function bytes(record) { return Buffer.from(`${JSON.stringify(record, null, 2)}\n`); }
function digest(recordBytes) { return createHash('sha256').update(recordBytes).digest('hex'); }

function record(databaseName, extra = {}) {
  return { purpose: 'customer-agent:first-production-admin', version: 1, databaseName,
    tenantId: 'tenant-enrollment', appId: 'app-enrollment', bindingId: 'binding-dedicated-admin',
    authorizationVersion: '7', departmentId: 'dept-operations',
    verifiedAt: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 60 * 60_000).toISOString(), ...extra };
}

function pilotRecord(extra = {}) {
  const approved = record(PILOT_DATABASE);
  delete approved.bindingId;
  delete approved.authorizationVersion;
  return { ...approved, version: 2, ownerSubjectSha256: '7'.repeat(64),
    ownerDisplayName: 'Synthetic "pilot": administrator', ...extra };
}

async function connect(config) {
  const client = await harness.connect(config);
  clients.push(client);
  return client;
}

async function fixture() {
  const name = `first_admin_${randomUUID().replaceAll('-', '')}`;
  await control.query(`CREATE DATABASE ${control.escapeIdentifier(name)} TEMPLATE ${control.escapeIdentifier(template.name)}`);
  const database = { name, config: { ...template.config, database: name } };
  const client = await connect(database.config);
  const approved = record(database.name);
  await seedIdentity(client, approved);
  return { client, database, approved, recordBytes: bytes(approved) };
}

async function assignDatabaseOwner(client, database, owner) {
  await client.query(`CREATE ROLE ${client.escapeIdentifier(owner)} LOGIN NOSUPERUSER`);
  await client.query(`ALTER DATABASE ${client.escapeIdentifier(database)} OWNER TO ${client.escapeIdentifier(owner)}`);
  await client.query(`GRANT USAGE ON SCHEMA backend_identity,content_intake TO ${client.escapeIdentifier(owner)};
    GRANT ALL ON ALL TABLES IN SCHEMA backend_identity,content_intake,public TO ${client.escapeIdentifier(owner)};
    GRANT EXECUTE ON FUNCTION backend_identity.configure_production_admin_post(text,text,text) TO ${client.escapeIdentifier(owner)}`);
}

async function seedIdentity(client, approved, user = 'user-dedicated-admin') {
  await client.query(`INSERT INTO content_intake.policy_versions(tenant_id,app_id,version)
    VALUES ($1,$2,1) ON CONFLICT DO NOTHING`, [approved.tenantId, approved.appId]);
  await client.query(`INSERT INTO backend_identity.subject_bindings
    (binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role,authorization_version)
    VALUES ($1,'synthetic',$2,$1,$3,repeat('a',64),true,'owner',$4)`,
  [approved.bindingId, approved.tenantId, user, approved.authorizationVersion]);
  await client.query(`INSERT INTO public.app_users(user_id,display_name,role)
    VALUES ($1,'Synthetic dedicated administrator','owner')`, [user]);
}

async function seedUnpostedPrincipal(client, approved, id, {
  departmentIds = [approved.departmentId], jobId = 'job-master-account',
  enabled = true, expired = false,
} = {}) {
  const userId = `user-${id}`;
  await seedIdentity(client, { ...approved, bindingId: `binding-${id}` }, userId);
  await client.query("UPDATE backend_identity.subject_bindings SET role='agent' WHERE user_id=$1", [userId]);
  await client.query("UPDATE public.app_users SET role='agent' WHERE user_id=$1", [userId]);
  await client.query('BEGIN');
  try {
    await client.query(`INSERT INTO content_intake.principals
      (principal_id,user_id,tenant_id,app_id,identity_scope,person_key,current_facts_version)
      VALUES ($1,$2,$3,$4,'confirmed-synthetic',$1,1)`,
    [id, userId, approved.tenantId, approved.appId]);
    await client.query(`INSERT INTO content_intake.principal_facts
      (principal_id,facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest)
      VALUES ($1,1,$2,$3,$4,clock_timestamp()-interval '2 hours',
        clock_timestamp()+CASE WHEN $5 THEN interval '-1 hour' ELSE interval '1 hour' END,repeat('c',64))`,
    [id, departmentIds, jobId, enabled, expired]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

// Only synthetic test setup provisions an independent catalog pin. The product
// implementation neither has a pin parameter nor writes this setting.
async function pin(client, database, recordBytes) {
  await client.query(`ALTER DATABASE ${client.escapeIdentifier(database)} SET ${PIN} TO ${client.escapeLiteral(digest(recordBytes))}`);
}

async function snapshot(client) {
  const tables = ['backend_identity.subject_bindings', 'public.app_users', 'content_intake.principals',
    'content_intake.principal_facts', 'content_intake.seat_posts', 'content_intake.role_rules',
    'content_intake.policy_versions', 'content_intake.grants', 'public.change_audits'];
  const result = {};
  for (const table of tables) {
    result[table] = (await client.query(`SELECT pg_catalog.to_jsonb(row) AS value, xmin::text AS version
      FROM ${table} AS row ORDER BY pg_catalog.to_jsonb(row)::text`)).rows;
  }
  return result;
}

async function enroll(client, recordBytes, apply = true) {
  return registerFirstProductionAdmin(client, { recordBytes, apply });
}

async function waitForLock(observer, waiter) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await observer.query(`SELECT wait_event_type='Lock' AS waiting
      FROM pg_catalog.pg_stat_activity WHERE pid=$1`, [waiter.processID])).rows[0]?.waiting) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('enrollment did not wait for the held identity lock');
}

test('strict input accepts only the fixed purpose, exact fields, bounded UTF-8 and UTC lifetime', () => {
  const approved = record('synthetic_database');
  assert.equal(parseEnrollmentRecord(bytes(approved)).record.bindingId, approved.bindingId);
  const invalid = [null, [], { ...approved, extra: true }, { ...approved, version: 2 },
    { ...approved, purpose: 'other' }, { ...approved, authorizationVersion: 7 },
    { ...approved, authorizationVersion: '0' }, { ...approved, authorizationVersion: '9223372036854775808' },
    { ...approved, verifiedAt: '2026-11-18T00:00:00+00:00' },
    { ...approved, validUntil: approved.verifiedAt },
    { ...approved, validUntil: new Date(Date.parse(approved.verifiedAt) + 86_400_001).toISOString() }];
  for (const value of invalid) assert.throws(() => parseEnrollmentRecord(bytes(value)), { code: 'RECORD_INVALID' });
  assert.throws(() => parseEnrollmentRecord(Buffer.from([0xff])), { code: 'RECORD_INVALID' });
  assert.throws(() => parseEnrollmentRecord(Buffer.alloc(16 * 1024 + 1)), { code: 'RECORD_INVALID' });
  assert.throws(() => parseEnrollmentRecord(Buffer.from(JSON.stringify(approved).replace('{', '{"version":1,'))),
    { code: 'RECORD_INVALID' });
});

test('test-owner records bind the approved subject and display name without accepting a supplied binding', () => {
  const approved = pilotRecord();
  const parsed = parseEnrollmentRecord(bytes(approved));
  assert.equal(parsed.pilotOwner.displayName, approved.ownerDisplayName);
  assert.equal(parsed.record.bindingId, parsed.pilotOwner.bindingId);
  assert.equal(parsed.record.authorizationVersion, '1');
  assert.equal(parseEnrollmentRecord(bytes(pilotRecord({
    validUntil: new Date(Date.parse(approved.validUntil) + 1000).toISOString(),
  }))).record.bindingId, parsed.record.bindingId);
  assert.notEqual(parseEnrollmentRecord(bytes(pilotRecord({
    ownerSubjectSha256: '8'.repeat(64),
  }))).record.bindingId, parsed.record.bindingId);
  for (const invalid of [
    pilotRecord({ bindingId: 'existing-owner' }),
    pilotRecord({ ownerSubjectSha256: 'not-a-hash' }),
    pilotRecord({ ownerDisplayName: '  ' }),
    pilotRecord({ ownerDisplayName: 'A\u0000B' }),
    pilotRecord({ ownerDisplayName: '华'.repeat(65) }),
  ]) assert.throws(() => parseEnrollmentRecord(bytes(invalid)), { code: 'RECORD_INVALID' });
  const duplicate = JSON.stringify(approved).replace('{', '{"ownerDisplayName":"fabricated",');
  assert.throws(() => parseEnrollmentRecord(Buffer.from(duplicate)), { code: 'RECORD_INVALID' });
});

test('CLI defaults to preview, cannot supply pin/identity overrides, and rejects duplicate options', () => {
  assert.deepEqual(parseArguments(['--record', '/tmp/approved.json']),
    { record: '/tmp/approved.json', apply: false, help: false });
  assert.equal(parseArguments(['--record', '/tmp/approved.json', '--apply']).apply, true);
  for (const args of [[], ['--record', 'relative.json'], ['--record', '/tmp/a', '--pin', 'x'],
    ['--record', '/tmp/a', '--binding', 'x'], ['--record', '/tmp/a', '--apply', '--apply']]) {
    assert.throws(() => parseArguments(args), { code: 'ARGUMENTS_INVALID' });
  }
});

test('record files must be bounded regular files and not symlinks', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'first-admin-record-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'approved.json');
  const link = path.join(root, 'alias.json');
  const value = bytes(record('synthetic_database'));
  writeFileSync(file, value);
  assert.deepEqual(readEnrollmentRecord(file), value);
  symlinkSync(file, link);
  for (const bad of [link, root, path.join(root, 'absent')]) {
    assert.throws(() => readEnrollmentRecord(bad), { code: 'RECORD_INVALID' });
  }
});

test('PostgreSQL 15 first administrator enrollment boundary', { skip: !enabled }, async t => {
  await t.test('requires the independently stored exact raw digest, not a session setting', async () => {
    const { client, database, recordBytes } = await fixture();
    const original = await snapshot(client);
    await client.query('SELECT set_config($1,$2,false)', [PIN, digest(recordBytes)]);
    await assert.rejects(enroll(client, recordBytes), { code: 'APPROVAL_PIN_MISMATCH' });
    await client.query(`ALTER ROLE ${client.escapeIdentifier(harness.owner)}
      IN DATABASE ${client.escapeIdentifier(database.name)} SET ${PIN} TO ${client.escapeLiteral(digest(recordBytes))}`);
    await assert.rejects(enroll(client, recordBytes), { code: 'APPROVAL_PIN_MISMATCH' });
    await pin(client, database.name, Buffer.from('unapproved'));
    await assert.rejects(enroll(client, recordBytes), { code: 'APPROVAL_PIN_MISMATCH' });
    await pin(client, database.name, recordBytes);
    await assert.rejects(enroll(client, Buffer.concat([recordBytes, Buffer.from(' ')])), { code: 'APPROVAL_PIN_MISMATCH' });
    assert.deepEqual(await snapshot(client), original);
  });

  await t.test('preview is read-only, first apply configures the actual 0077 post and never writes a grant', async () => {
    const { client, database, approved, recordBytes } = await fixture();
    await pin(client, database.name, recordBytes);
    const before = await snapshot(client);
    await assert.rejects(registerFirstProductionAdmin(client, { recordBytes, apply: 'false' }),
      { code: 'ARGUMENTS_INVALID' });
    const preview = await enroll(client, recordBytes, false);
    assert.equal(preview.status, 'preview');
    assert.deepEqual(await snapshot(client), before);
    const result = await enroll(client, recordBytes);
    assert.equal(result.status, 'registered');
    const post = (await client.query(`SELECT * FROM content_intake.seat_posts WHERE principal_id=$1`,
      [result.principalId])).rows[0];
    assert.equal(post.job_id, 'job-master-account');
    assert.equal(post.department_id, approved.departmentId);
    assert.equal(post.assigned_by, `first-admin:${digest(recordBytes)}`);
    const first = (await client.query(`SELECT * FROM content_intake.principal_facts WHERE principal_id=$1`,
      [result.principalId])).rows[0];
    assert.equal(first.facts_digest, digest(recordBytes));
    assert.equal(first.checked_at.toISOString(), approved.verifiedAt);
    assert.equal(first.valid_until.toISOString(), approved.validUntil);
    assert.equal((await client.query('SELECT content_intake.password_login_allowed($1) AS allowed',
      [approved.bindingId])).rows[0].allowed, true);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM content_intake.grants')).rows[0].n, 0);
    const applied = await snapshot(client);
    assert.deepEqual(applied['backend_identity.subject_bindings'], before['backend_identity.subject_bindings']);
    assert.deepEqual(applied['public.app_users'], before['public.app_users']);
    assert.equal((await enroll(client, recordBytes)).status, 'already-registered');
    assert.deepEqual(await snapshot(client), applied);
    assert.equal((await client.query('SELECT content_intake.project_seat_login($1) AS result',
      [approved.bindingId])).rows[0].result, 'projected');
    const afterLogin = await snapshot(client);
    assert.equal((await enroll(client, recordBytes)).status, 'already-registered');
    assert.deepEqual(await snapshot(client), afterLogin);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM content_intake.grants')).rows[0].n, 0);
  });

  await t.test('rejects nonowners and accepts an ordinary nonsuperuser database/object owner', async () => {
    const { client, database, recordBytes } = await fixture();
    await pin(client, database.name, recordBytes);
    await client.query('CREATE ROLE first_admin_unprivileged LOGIN');
    const unprivileged = await connect({ ...database.config, user: 'first_admin_unprivileged' });
    await assert.rejects(enroll(unprivileged, recordBytes), { code: 'DATABASE_OWNER_REQUIRED' });
    await assignDatabaseOwner(client, database.name, 'first_admin_maintenance');
    const owner = await connect({ ...database.config, user: 'first_admin_maintenance' });
    assert.equal((await owner.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper, false);
    assert.equal((await enroll(owner, recordBytes)).status, 'registered');
  });

  await t.test('rejects wrong home, stale binding version, disabled and ordinary accounts, missing accounts and demo identities', async () => {
    const { client, database, approved, recordBytes } = await fixture();
    await pin(client, database.name, recordBytes);
    const mutations = [
      ["UPDATE backend_identity.subject_bindings SET role='agent'", 'BINDING_NOT_ELIGIBLE'],
      ["UPDATE backend_identity.subject_bindings SET enabled=false", 'BINDING_NOT_ELIGIBLE'],
      ["UPDATE backend_identity.subject_bindings SET authorization_version=8", 'BINDING_NOT_ELIGIBLE'],
      ["UPDATE backend_identity.subject_bindings SET tenant='other-tenant'", 'BINDING_NOT_ELIGIBLE'],
      ["UPDATE public.app_users SET role='agent'", 'ACCOUNT_NOT_ELIGIBLE'],
      ["UPDATE public.app_users SET is_active=false", 'ACCOUNT_NOT_ELIGIBLE'],
      ['DELETE FROM public.app_users', 'ACCOUNT_NOT_ELIGIBLE'],
    ];
    for (const [sql, code] of mutations) {
      await client.query(sql);
      await assert.rejects(enroll(client, recordBytes), { code });
      await client.query(`UPDATE backend_identity.subject_bindings
        SET role='owner',enabled=true,authorization_version=7,tenant=$1`, [approved.tenantId]);
      await client.query(`INSERT INTO public.app_users(user_id,role,is_active)
        VALUES ('user-dedicated-admin','owner',true)
        ON CONFLICT (user_id) DO UPDATE SET role='owner',is_active=true`);
    }
    const demo = { ...approved, bindingId: 'synthetic_owner' };
    await seedIdentity(client, demo, 'usr_synthetic_owner');
    await pin(client, database.name, bytes(demo));
    await assert.rejects(enroll(client, bytes(demo)), { code: 'BINDING_NOT_ELIGIBLE' });
    for (const bindingId of ['synthetic_seat_reserved', `sys-query-binding-${'b'.repeat(64)}`]) {
      const reserved = { ...approved, bindingId };
      await seedIdentity(client, reserved, `reserved-user-${bindingId.slice(-8)}`);
      await pin(client, database.name, bytes(reserved));
      await assert.rejects(enroll(client, bytes(reserved)), { code: 'BINDING_NOT_ELIGIBLE' });
    }
    const ordinaryName = { ...approved, bindingId: 'demo-owner' };
    await seedIdentity(client, ordinaryName, 'demo-user');
    await pin(client, database.name, bytes(ordinaryName));
    assert.equal((await enroll(client, bytes(ordinaryName))).status, 'registered');
  });

  await t.test('refuses an occupied identity and all historical/disabled production administrators', async () => {
    const { client, database, approved, recordBytes } = await fixture();
    await pin(client, database.name, recordBytes);
    await client.query('BEGIN');
    await client.query(`INSERT INTO content_intake.principals
      (principal_id,user_id,tenant_id,app_id,identity_scope,person_key,current_facts_version)
      VALUES ('existing-seat','user-dedicated-admin',$1,$2,'confirmed-synthetic','existing-seat',1)`,
    [approved.tenantId, approved.appId]);
    await client.query(`INSERT INTO content_intake.principal_facts
      (principal_id,facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest)
      VALUES ('existing-seat',1,ARRAY['dept-seat'],'job-seat',false,
      clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',repeat('a',64)); COMMIT`);
    const original = await snapshot(client);
    await assert.rejects(enroll(client, recordBytes), { code: 'REGISTRATION_CONFLICT' });
    assert.deepEqual(await snapshot(client), original);
    const other = { ...approved, bindingId: 'other-admin', tenantId: 'other-tenant', appId: 'other-app' };
    await seedIdentity(client, other, 'other-user');
    await client.query('BEGIN');
    await client.query(`INSERT INTO content_intake.principals
      (principal_id,user_id,tenant_id,app_id,identity_scope,person_key,current_facts_version)
      VALUES ('historic-admin','other-user',$1,$2,'production-admin','historic',1)`,
    [other.tenantId, other.appId]);
    await client.query(`INSERT INTO content_intake.principal_facts
      (principal_id,facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest)
      VALUES ('historic-admin',1,ARRAY['dept-historic'],'job-master-account',false,
      clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',repeat('b',64)); COMMIT`);
    const fresh = { ...approved, bindingId: 'fresh-owner', tenantId: 'fresh-tenant', appId: 'fresh-app' };
    await seedIdentity(client, fresh, 'fresh-user');
    await pin(client, database.name, bytes(fresh));
    await assert.rejects(enroll(client, bytes(fresh)), { code: 'REGISTRATION_CONFLICT' });
  });

  await t.test('refuses shared master-job facts without a seat, including stale or disabled siblings', async () => {
    for (const state of [{ enabled: true, expired: false }, { enabled: true, expired: true },
      { enabled: false, expired: true }]) {
      const { client, database, approved, recordBytes } = await fixture();
      await seedUnpostedPrincipal(client, approved, 'unposted-sibling', {
        ...state, departmentIds: ['dept-unrelated', approved.departmentId],
      });
      await pin(client, database.name, recordBytes);
      const before = await snapshot(client);
      assert.equal(before['content_intake.seat_posts'].length, 0);
      for (const apply of [false, true]) {
        await assert.rejects(enroll(client, recordBytes, apply), { code: 'MASTER_POST_CONFLICT' });
        assert.deepEqual(await snapshot(client), before);
      }
      assert.equal(before['content_intake.role_rules'].length, 0);
      assert.equal(before['content_intake.grants'].length, 0);
    }
  });

  await t.test('allows regular identities whose current facts do not share the master rule tuple', async () => {
    const { client, database, approved, recordBytes } = await fixture();
    await seedUnpostedPrincipal(client, approved, 'other-department', { departmentIds: ['dept-other'] });
    await seedUnpostedPrincipal(client, { ...approved, tenantId: 'tenant-other' }, 'other-tenant');
    await seedUnpostedPrincipal(client, { ...approved, appId: 'app-other' }, 'other-app');
    await seedUnpostedPrincipal(client, approved, 'other-job', { jobId: 'job-seat' });
    await pin(client, database.name, recordBytes);
    const before = await snapshot(client);
    assert.equal((await enroll(client, recordBytes, false)).status, 'preview');
    assert.deepEqual(await snapshot(client), before);
    assert.equal((await enroll(client, recordBytes)).status, 'registered');
    const after = await snapshot(client);
    for (const table of ['backend_identity.subject_bindings', 'public.app_users', 'content_intake.grants']) {
      assert.deepEqual(after[table], before[table]);
    }
    assert.equal(after['content_intake.role_rules'].length, 1);
    assert.equal(after['content_intake.seat_posts'].length, 1);
  });

  await t.test('replay also refuses a newly overlapping sibling and leaves the registered state unchanged', async () => {
    const { client, database, approved, recordBytes } = await fixture();
    await pin(client, database.name, recordBytes);
    assert.equal((await enroll(client, recordBytes)).status, 'registered');
    await seedUnpostedPrincipal(client, approved, 'late-sibling');
    const before = await snapshot(client);
    for (const apply of [false, true]) {
      await assert.rejects(enroll(client, recordBytes, apply), { code: 'MASTER_POST_CONFLICT' });
      assert.deepEqual(await snapshot(client), before);
    }
  });

  await t.test('rolls back every product row when existing post configuration fails', async () => {
    const { client, database, recordBytes } = await fixture();
    await pin(client, database.name, recordBytes);
    const before = await snapshot(client);
    await client.query(`CREATE FUNCTION public.reject_first_admin_post() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$;
      CREATE TRIGGER reject_first_admin BEFORE INSERT ON content_intake.seat_posts
      FOR EACH ROW EXECUTE FUNCTION public.reject_first_admin_post()`);
    await assert.rejects(enroll(client, recordBytes), { code: 'REGISTRATION_FAILED' });
    assert.deepEqual(await snapshot(client), before);
    await client.query('DROP TRIGGER reject_first_admin ON content_intake.seat_posts');
    assert.equal((await enroll(client, recordBytes)).status, 'registered');
  });

  await t.test('rejects expired/future records and a database mismatch without changing any row', async () => {
    const { client, database, approved } = await fixture();
    const before = await snapshot(client);
    const invalid = [
      [{ ...approved, verifiedAt: new Date(Date.now() - 7200_000).toISOString(),
        validUntil: new Date(Date.now() - 3600_000).toISOString() }, 'APPROVAL_NOT_CURRENT'],
      [{ ...approved, verifiedAt: new Date(Date.now() + 3600_000).toISOString(),
        validUntil: new Date(Date.now() + 7200_000).toISOString() }, 'APPROVAL_NOT_CURRENT'],
      [{ ...approved, databaseName: 'wrong-database' }, 'DATABASE_MISMATCH'],
    ];
    for (const [value, code] of invalid) {
      await pin(client, database.name, bytes(value));
      await assert.rejects(enroll(client, bytes(value)), { code });
    }
    assert.deepEqual(await snapshot(client), before);
  });

  await t.test('two simultaneous copies of one approved record create exactly once', async () => {
    const { client, database, recordBytes } = await fixture();
    await pin(client, database.name, recordBytes);
    const second = await connect(database.config);
    const results = await Promise.all([enroll(client, recordBytes), enroll(second, recordBytes)]);
    assert.deepEqual(results.map(value => value.status).sort(), ['already-registered', 'registered']);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM content_intake.principals')).rows[0].n, 1);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM content_intake.principal_facts')).rows[0].n, 1);
  });

  await t.test('an expired original record cannot renew an already registered administrator', async () => {
    const { client, database, approved } = await fixture();
    const at = (await client.query('SELECT clock_timestamp() AS at')).rows[0].at.getTime();
    const short = bytes({ ...approved, verifiedAt: new Date(at - 60_000).toISOString(),
      validUntil: new Date(at + 1_000).toISOString() });
    await pin(client, database.name, short);
    assert.equal((await enroll(client, short)).status, 'registered');
    const before = await snapshot(client);
    await client.query('SELECT pg_sleep(1.1)');
    await assert.rejects(enroll(client, short), { code: 'APPROVAL_NOT_CURRENT' });
    assert.deepEqual(await snapshot(client), before);
  });

  await t.test('concurrent different ownership requests cannot register a second global administrator', async () => {
    const { client, database, approved, recordBytes } = await fixture();
    const other = { ...approved, bindingId: 'second-binding', tenantId: 'second-tenant', appId: 'second-app' };
    const otherBytes = bytes(other);
    await seedIdentity(client, other, 'second-user');
    const second = await connect(database.config);
    await pin(client, database.name, recordBytes);
    const results = await Promise.allSettled([enroll(client, recordBytes), enroll(second, otherBytes)]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].reason.code, 'APPROVAL_PIN_MISMATCH');
    await pin(client, database.name, otherBytes);
    await assert.rejects(enroll(second, otherBytes), { code: 'REGISTRATION_CONFLICT' });
    assert.equal((await client.query('SELECT count(*)::int AS n FROM content_intake.principals')).rows[0].n, 1);
  });

  await t.test('re-reads the approval pin and binding only after lock waits', async () => {
    const { client, database, recordBytes } = await fixture();
    await pin(client, database.name, recordBytes);
    const waiter = await connect(database.config);
    const observer = await connect(database.config);
    for (const changed of ['pin', 'binding']) {
      await pin(client, database.name, recordBytes);
      await client.query('BEGIN; LOCK TABLE backend_identity.subject_bindings IN SHARE ROW EXCLUSIVE MODE');
      const pending = enroll(waiter, recordBytes).then(value => ({ value }), error => ({ error }));
      await waitForLock(observer, waiter);
      if (changed === 'pin') await pin(observer, database.name, Buffer.from('changed-approval'));
      else await client.query('UPDATE backend_identity.subject_bindings SET authorization_version=8');
      await client.query('COMMIT');
      const result = await pending;
      assert.equal(result.error?.code, changed === 'pin' ? 'APPROVAL_PIN_MISMATCH' : 'BINDING_NOT_ELIGIBLE');
    }
    assert.equal((await client.query('SELECT count(*)::int AS n FROM content_intake.principals')).rows[0].n, 0);
  });

  await t.test('a pinned test-owner record registers once alongside the system query signer', async () => {
    await control.query(`CREATE DATABASE ${control.escapeIdentifier(PILOT_DATABASE)}
      TEMPLATE ${control.escapeIdentifier(template.name)}`);
    const client = await connect({ ...template.config, database: PILOT_DATABASE });
    const approved = pilotRecord();
    const recordBytes = bytes(approved);
    const execute = (environment = 'wsl-test', apply = true) =>
      registerFirstProductionAdmin(client, { recordBytes, apply, environment });
    const empty = await snapshot(client);
    await assert.rejects(execute(), { code: 'APPROVAL_PIN_MISMATCH' });
    await pin(control, PILOT_DATABASE, recordBytes);
    await assert.rejects(execute('production'), { code: 'PILOT_OWNER_PROFILE_REQUIRED' });
    await assert.rejects(execute('synthetic-local'), { code: 'PILOT_OWNER_PROFILE_REQUIRED' });
    await assert.rejects(execute(), { code: 'POLICY_REQUIRED' });
    assert.deepEqual(await snapshot(client), empty);

    await client.query(`INSERT INTO content_intake.policy_versions(tenant_id,app_id,version)
      VALUES ($1,$2,1)`, [approved.tenantId, approved.appId]);
    assert.equal((await client.query(`SELECT content_intake.issue_roster_query($1,$2,$3) AS status`,
      ['unregistered-pilot-recipient', approved.tenantId, approved.appId])).rows[0].status, 'registered');
    await client.query(`INSERT INTO backend_identity.subject_bindings
      (binding_id,provider,tenant,subject,user_id,subject_hash,role,enabled)
      VALUES ('previous-owner','synthetic',$1,'previous-owner','previous-owner',repeat('c',64),'owner',false)`,
    [approved.tenantId]);
    const withDisabledOwner = await snapshot(client);
    await assert.rejects(execute(), { code: 'PILOT_OWNER_CONFLICT' });
    assert.deepEqual(await snapshot(client), withDisabledOwner);
    await client.query("DELETE FROM backend_identity.subject_bindings WHERE binding_id='previous-owner'");
    const before = await snapshot(client);
    assert.equal(before['backend_identity.subject_bindings'].length, 1);
    assert.equal(before['public.app_users'].length, 0);
    assert.equal(before['content_intake.seat_posts'].length, 0);
    assert.equal(before['content_intake.grants'].length, 0);

    const signerUserId = before['backend_identity.subject_bindings'][0].value.user_id;
    await client.query(`INSERT INTO public.app_users(user_id,display_name,role)
      VALUES ($1,'Synthetic conflicting owner','owner')`, [signerUserId]);
    const withSignerAccount = await snapshot(client);
    await assert.rejects(execute(), { code: 'PILOT_OWNER_CONFLICT' });
    assert.deepEqual(await snapshot(client), withSignerAccount);
    await client.query('DELETE FROM public.app_users WHERE user_id=$1', [signerUserId]);
    assert.deepEqual(await snapshot(client), before);

    const preview = await execute('wsl-test', false);
    assert.equal(preview.status, 'preview');
    assert.deepEqual(await snapshot(client), before);

    await client.query(`ALTER TABLE content_intake.principal_facts
      ADD CONSTRAINT pilot_test_reject_fact CHECK (job_id <> 'job-master-account')`);
    await assert.rejects(execute(), { code: 'REGISTRATION_FAILED' });
    assert.deepEqual(await snapshot(client), before);
    await client.query('ALTER TABLE content_intake.principal_facts DROP CONSTRAINT pilot_test_reject_fact');

    const created = await execute();
    assert.equal(created.status, 'registered');
    assert.equal(created.bindingId, preview.bindingId);
    const afterApply = await snapshot(client);
    for (const [table, id] of [
      ['backend_identity.subject_bindings', 'binding_id'],
      ['content_intake.principals', 'principal_id'],
      ['content_intake.principal_facts', 'principal_id'],
    ]) {
      assert.equal(before[table].length, 1);
      const [signer] = before[table];
      assert.deepEqual(afterApply[table].filter(row => row.value[id] === signer.value[id]), [signer]);
    }
    assert.deepEqual(afterApply['content_intake.grants'], before['content_intake.grants']);
    const row = (await client.query(`SELECT a.display_name, a.role, a.is_active, p.identity_scope,
        content_intake.password_login_allowed(b.binding_id) AS can_login
      FROM backend_identity.subject_bindings b JOIN public.app_users a ON a.user_id=b.user_id
      JOIN content_intake.principals p ON p.user_id=b.user_id
      WHERE b.binding_id=$1`, [created.bindingId])).rows[0];
    assert.deepEqual(row, { display_name: approved.ownerDisplayName, role: 'owner', is_active: true,
      identity_scope: 'production-admin', can_login: true });
    assert.equal((await execute()).status, 'already-registered');
    assert.deepEqual(await snapshot(client), afterApply);
  });

  await t.test('the real CLI previews then applies against an isolated stack profile', async () => {
    // Keep the canonical Unix socket path below PostgreSQL's platform limit;
    // macOS's per-user temporary directory can already be very long.
    const root = realpathSync(mkdtempSync('/tmp/first-admin-cli-'));
    const socket = path.join(root, 'data', 'pg15-socket');
    const isolated = new Pg15Harness({ port: PG_PORT, socketDirectory: socket });
    let client;
    try {
      isolated.start();
      const database = isolated.createDatabase('first_admin_cli');
      client = await isolated.connect(database.config);
      await applyDatabaseMigrations(client);
      const approved = record(database.name);
      const recordBytes = bytes(approved);
      await seedIdentity(client, approved);
      await pin(client, database.name, recordBytes);
      await assignDatabaseOwner(client, database.name, 'stack_owner');
      const ports = stackPortPairForRoot(root);
      writeFileSync(path.join(root, 'profile.json'), JSON.stringify({ version: 1,
        createdAt: new Date().toISOString(), stackRoot: root, databaseName: database.name,
        apiOrigin: `http://127.0.0.1:${ports.api}`, identityOrigin: `http://127.0.0.1:${ports.identity}`,
        apiPort: ports.api, identityPort: ports.identity, pgPort: PG_PORT,
        pgSocketDirectory: socket, objectStoreDirectory: path.join(root, 'objects'), clientId: 'synthetic-client' }));
      const recordFile = path.join(root, 'approved.json');
      writeFileSync(recordFile, recordBytes);
      const invoke = async extra => JSON.parse((await execFileAsync(process.execPath,
        [new URL('./register-first-production-admin.mjs', import.meta.url).pathname,
          '--record', recordFile, ...extra],
        { env: { ...process.env, CUSTOMER_AGENT_STACK_ROOT: root }, timeout: 20_000 })).stdout);
      const before = await snapshot(client);
      assert.equal((await invoke([])).status, 'preview');
      assert.deepEqual(await snapshot(client), before);
      assert.equal((await invoke(['--apply'])).status, 'registered');
      const afterApply = await snapshot(client);
      assert.equal((await invoke(['--apply'])).status, 'already-registered');
      assert.deepEqual(await snapshot(client), afterApply);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM content_intake.grants')).rows[0].n, 0);
    } finally {
      await client?.end();
      isolated.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
