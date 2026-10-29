import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Pg15Harness } from '../../packages/database/dist/testkit/index.js';
import { applyDatabaseMigrations } from '../../packages/database/dist/index.js';
import { createGrants, changeGrant } from '../../apps/api/dist/content-intake/authority.js';
import { principal } from '../../apps/api/dist/content-intake/transaction.js';
import { bootstrapIssuerAuthority, parseArguments } from './bootstrap-issuer-authority.mjs';

const signer = `sys_query_${createHash('sha256').update('tenant-test:app-test').digest('hex')}`.slice(0,72);
const command = ['--principal', 'admin', '--actions', 'query', '--scopes', 'scope-one', '--sources', 'source-one', '--expires-days', '1'];
let harness;
let database;

before(async () => {
  harness = new Pg15Harness();
  harness.start();
  database = harness.createDatabase('issuer_bootstrap');
  const client = await harness.connect(database.config);
  try {
    await applyDatabaseMigrations(client);
    await client.query('CREATE ROLE stack_owner SUPERUSER LOGIN');
  } finally { await client.end(); }
}, { timeout: 120000 });
after(() => harness?.stop());

async function seed(client) {
  await client.query(`TRUNCATE content_intake.principals, content_intake.scopes,
    content_intake.policy_versions, content_intake.role_rules, content_intake.store_sets CASCADE`);
  await client.query(`DELETE FROM public.app_users;
    DELETE FROM backend_identity.subject_bindings`);
  await client.query('BEGIN');
  try {
    await client.query(`
      INSERT INTO content_intake.policy_versions VALUES ('tenant-test','app-test',1);
      INSERT INTO content_intake.role_rules VALUES
        ('tenant-test','app-test','dept-candidate','job-candidate',1,'agent');
      INSERT INTO content_intake.scopes(scope_id,tenant_id,app_id,brand_id,shop_id,domain) VALUES
        ('scope-one','tenant-test','app-test','brand-one','shop-one','product'),
        ('scope-other','tenant-test','app-test','brand-one','shop-two','product'),
        ('scope-foreign','tenant-other','app-test','brand-one','shop-one','product');
      INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode) VALUES
        ('source-one','scope-one',1,'v2-preview'), ('source-two','scope-one',1,'v2-preview'),
        ('source-other','scope-other',1,'v2-preview'), ('source-foreign','scope-foreign',1,'v2-preview');
      INSERT INTO content_intake.source_mappings(source_id,version,template_version,rule_version,mapping_version,structure_digest)
        SELECT source_id,1,'faq-p1.1','intake-p1.1','mapping-p1.1',repeat('a',64) FROM content_intake.sources;
      INSERT INTO content_intake.store_sets(tenant_id,app_id,version,approved_at,provenance)
        VALUES ('tenant-test','app-test',1,clock_timestamp(),'bootstrap-test');
      INSERT INTO content_intake.store_set_current VALUES ('tenant-test','app-test',1);
      INSERT INTO content_intake.store_set_members(tenant_id,app_id,version,scope_id,source_id,content_valid_until)
        SELECT 'tenant-test','app-test',1,scope_id,source_id,clock_timestamp()+interval '3 days'
        FROM content_intake.sources WHERE source_id IN ('source-one','source-two','source-other');
      INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role) VALUES
        ('binding-admin','synthetic','tenant-test','admin','user-admin',repeat('a',64),true,'owner'),
        ('binding-signer','synthetic','tenant-test','signer','user-signer',repeat('b',64),true,'owner');
      INSERT INTO public.app_users(user_id,display_name,role,is_active) VALUES ('user-admin','测试主账号','owner',true);
      INSERT INTO content_intake.principals(principal_id,user_id,tenant_id,app_id,identity_scope,person_key,current_facts_version) VALUES
        ('admin','user-admin','tenant-test','app-test','production-admin','admin',1),
        ('${signer}','user-signer','tenant-test','app-test','content-intake-system','query-signer',1);
      INSERT INTO content_intake.principal_facts(principal_id,facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest)
        SELECT principal_id,1,ARRAY['dept-old'],'job-old',true,clock_timestamp()-interval '1 minute',
          clock_timestamp()+interval '1 hour',repeat('c',64) FROM content_intake.principals;
    `);
    assert.equal((await client.query("SELECT backend_identity.configure_production_admin_post('admin','dept-master','test') AS status")).rows[0].status, 'configured');
    assert.equal((await client.query("SELECT content_intake.project_seat_login('binding-admin') AS status")).rows[0].status, 'projected');
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

async function fixture(work) {
  const client = await harness.connect(database.config);
  try { await seed(client); await work(client); }
  finally { await client.end(); }
}

async function state(client) {
  return (await client.query(`SELECT
    (SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY grant_id),'[]') FROM content_intake.grants g) AS grants,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY principal_id) FROM content_intake.principals p) AS principals,
    (SELECT jsonb_agg(to_jsonb(f) ORDER BY principal_id,facts_version) FROM content_intake.principal_facts f) AS facts`)).rows[0];
}
async function deniedUnchanged(client, argv, pattern) {
  const before = await state(client);
  await assert.rejects(bootstrapIssuerAuthority(client, argv), pattern);
  assert.deepEqual(await state(client), before);
}
async function allowed(client, person = 'admin', action = 'query') {
  return (await client.query('SELECT source_id FROM content_intake.authorization_sources($1,$2,clock_timestamp()) ORDER BY source_id',
    [person, action])).rows.map(row => row.source_id);
}

function newFacts(values = {}, id = 'admin') {
  return `WITH moved AS (
    UPDATE content_intake.principals SET current_facts_version=current_facts_version+1
      WHERE principal_id='${id}' RETURNING principal_id,current_facts_version
  ) INSERT INTO content_intake.principal_facts
    SELECT f.principal_id,m.current_facts_version,${values.departments ?? 'f.department_ids'},
      ${values.job ?? 'f.job_id'},f.enabled,${values.checked ?? 'f.checked_at'},
      ${values.until ?? 'f.valid_until'},f.facts_digest
    FROM moved m JOIN content_intake.principal_facts f ON f.principal_id=m.principal_id
      AND f.facts_version=m.current_facts_version-1`;
}

test('requires explicit source/action/scope selections and finite input', () => {
  for (const args of [
    ['--principal','admin','--sources','source-one'],
    [...command,'--actions','review'],
    command.map(v => v === 'query' ? 'query,' : v),
    command.map(v => v === '1' ? 'Infinity' : v),
    command.map(v => v === 'source-one' ? '*' : v),
  ]) assert.throws(() => parseArguments(args));
});

test('creates only selected roots; repeat keeps ids, deadlines and generations unchanged', () => fixture(async client => {
  assert.deepEqual(await allowed(client), []);
  const result = await bootstrapIssuerAuthority(client, command);
  assert.equal(result.created, 2);
  assert.deepEqual(await allowed(client), ['source-one']);
  const before = await state(client);
  assert.equal(before.grants.every(g => g.recipient_id === 'admin' && g.parent_grant_id === null && g.source_id === 'source-one'), true);
  assert.equal(before.grants.find(g => g.kind === 'business').issuer_id, signer);
  assert.equal((await bootstrapIssuerAuthority(client, command.map(v => v === '1' ? '30' : v))).created, 0);
  assert.deepEqual(await state(client), before);
}));

test('legacy allocation-only invocation remains allocation-only and source mode reuses its root', () => fixture(async client => {
  const allocation = command.slice(0,6);
  assert.equal((await bootstrapIssuerAuthority(client, allocation)).created, 1);
  assert.deepEqual(await allowed(client), []);
  assert.equal((await bootstrapIssuerAuthority(client, command)).created, 1);
  assert.equal((await state(client)).grants.length, 2);
}));

test('all supported actions use existing grant constraints without granting another principal', () => fixture(async client => {
  const actions = 'query,content-manage,import,source-confirm,review,publish,candidate-cancel,rollback';
  assert.equal((await bootstrapIssuerAuthority(client, command.map(v => v === 'query' ? actions : v))).created, 16);
  for (const action of actions.split(',')) assert.deepEqual(await allowed(client, 'admin', action), ['source-one']);
  assert.deepEqual(await allowed(client, signer), []);
}));

test('dry-run reports the complete plan in a read-only transaction and writes nothing', () => fixture(async client => {
  const before = await state(client);
  const result = await bootstrapIssuerAuthority(client, [...command, '--dry-run']);
  assert.equal(result.status, 'DRY_RUN');
  assert.equal(result.created, 0);
  assert.equal(result.wouldCreate, 2);
  assert.deepEqual(await state(client), before);
}));

test('scope mismatch, unknown source and foreign tenant fail closed', () => fixture(async client => {
  for (const replacement of ['source-other', 'source-missing', 'source-foreign']) {
    await deniedUnchanged(client, command.map(v => v === 'source-one' ? replacement : v), /source/);
  }
  await deniedUnchanged(client, command.map(v => v === 'scope-one' ? 'scope-foreign' : v), /scope/);
}));

test('non-owner is rejected even when it is another superuser', () => fixture(async client => {
  await client.query('SET ROLE stack_owner');
  try { await deniedUnchanged(client, command, /database owner/); }
  finally { await client.query('RESET ROLE'); }
}));

test('controlled post, binding, account and current facts are mandatory', () => fixture(async client => {
  for (const mutation of [
    "UPDATE backend_identity.subject_bindings SET enabled=false WHERE binding_id='binding-admin'",
    "UPDATE public.app_users SET is_active=false WHERE user_id='user-admin'",
    "DELETE FROM content_intake.seat_posts WHERE principal_id='admin'",
    newFacts({ checked: "clock_timestamp()-interval '2 hours'", until: "clock_timestamp()-interval '1 hour'" }),
    newFacts({ departments: "ARRAY['dept-other']" }),
    "UPDATE content_intake.role_rules SET role='agent' WHERE job_id='job-master-account'",
  ]) {
    await seed(client);
    await client.query(mutation);
    await deniedUnchanged(client, command, /production-admin|controlled master post/);
  }
}));

test('a second enabled admin fails uniqueness', () => fixture(async client => {
  await client.query('BEGIN');
  await client.query(`
    INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
      VALUES ('binding-second','synthetic','tenant-test','second','user-second',repeat('e',64),true,'owner');
    INSERT INTO content_intake.principals SELECT 'second','user-second',tenant_id,app_id,identity_scope,'second',current_facts_version,0
      FROM content_intake.principals WHERE principal_id='admin';
    INSERT INTO content_intake.principal_facts SELECT 'second',facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest
      FROM content_intake.principal_facts WHERE principal_id='admin';
  `);
  await client.query('COMMIT');
  await deniedUnchanged(client, command, /unique enabled production-admin/);
}));

test('missing policy, store membership, expired content and absent signer all reject without writes', () => fixture(async client => {
  for (const mutation of [
    'DELETE FROM content_intake.policy_versions',
    'DELETE FROM content_intake.store_set_current',
    "DELETE FROM content_intake.store_set_members WHERE source_id='source-one'",
    "UPDATE content_intake.store_set_members SET content_valid_until=clock_timestamp()-interval '1 minute'",
    "UPDATE backend_identity.subject_bindings SET enabled=false WHERE binding_id='binding-signer'",
  ]) {
    await seed(client);
    await client.query(mutation);
    await deniedUnchanged(client, command, /policy|membership|signer/);
  }
}));

test('an expired initial root is not replaced', () => fixture(async client => {
  await client.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,
    starts_at,expires_at,reason,steward_id)
    VALUES ('expired-root','allocation','admin','admin','tenant-test','app-test','scope-one','source-one','query',
      clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day','expired initial root','admin')`);
  await deniedUnchanged(client, command, /existing authority/);
}));

test('revoked or policy-stale roots are not renewed', () => fixture(async client => {
  for (const mutation of [
    "UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=2,last_change_reason='revoked test'",
    'UPDATE content_intake.policy_versions SET version=version+1',
  ]) {
    await seed(client);
    await bootstrapIssuerAuthority(client, command);
    await client.query(mutation);
    await deniedUnchanged(client, command, /existing authority/);
  }
}));

test('a changed store set does not reissue a stamped root', () => fixture(async client => {
  await bootstrapIssuerAuthority(client, command);
  await client.query(`INSERT INTO content_intake.store_sets(tenant_id,app_id,version,approved_at,provenance)
    VALUES ('tenant-test','app-test',2,clock_timestamp(),'changed-store-test');
    INSERT INTO content_intake.store_set_members
      SELECT tenant_id,app_id,2,scope_id,source_id,content_valid_until FROM content_intake.store_set_members WHERE version=1;
    UPDATE content_intake.store_set_current SET version=2`);
  await deniedUnchanged(client, command, /existing authority/);
}));

test('parented business authority cannot silently become a stable root', () => fixture(async client => {
  await bootstrapIssuerAuthority(client, command.slice(0,6));
  await client.query(newFacts({ departments: "ARRAY['dept-master']", job: "'job-master-account'" }, signer));
  await client.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,
      starts_at,expires_at,reason,steward_id)
    VALUES ('signer-parent','allocation','${signer}','${signer}','tenant-test','app-test','scope-one','source-one','query',
      clock_timestamp()-interval '1 day',clock_timestamp()+interval '2 days','test parent','${signer}');
    INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,
      starts_at,expires_at,reason,steward_id,parent_grant_id,policy_version,store_set_version)
    VALUES ('inherited-business','business','${signer}','admin','tenant-test','app-test','scope-one','source-one','query',
      clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','test inherited','${signer}','signer-parent',
        (SELECT version FROM content_intake.policy_versions WHERE tenant_id='tenant-test' AND app_id='app-test'),1)`);
  assert.deepEqual(await allowed(client), ['source-one']);
  await deniedUnchanged(client, command, /existing authority/);
}));

test('insert failure rolls back the earlier root and generation', () => fixture(async client => {
  await client.query(`CREATE FUNCTION public.reject_bootstrap_business() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.kind='business' THEN RAISE EXCEPTION 'injected business failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_bootstrap_business BEFORE INSERT ON content_intake.grants
      FOR EACH ROW EXECUTE FUNCTION public.reject_bootstrap_business()`);
  try { await deniedUnchanged(client, command, /injected business failure/); }
  finally { await client.query('DROP TRIGGER reject_bootstrap_business ON content_intake.grants; DROP FUNCTION public.reject_bootstrap_business()'); }
}));

test('concurrent bootstrap calls converge to a single pair of roots', () => fixture(async client => {
  const other = await harness.connect(database.config);
  try {
    const results = await Promise.all([bootstrapIssuerAuthority(client, command), bootstrapIssuerAuthority(other, command)]);
    assert.deepEqual(results.map(r => r.created).sort(), [0,2]);
    assert.equal((await state(client)).grants.length, 2);
  } finally { await other.end(); }
}));

test('admin can issue candidate query through API authority; revoke and bootstrap do not revive it', () => fixture(async client => {
  await bootstrapIssuerAuthority(client, command);
  await client.query("SELECT backend_identity.admit_feishu_agent('ou_bootstrapcandidate')");
  assert.equal((await client.query(`SELECT content_intake.project_feishu_candidate(
    'usr_ou_bootstrapcandidate','tenant-test','app-test','ou_bootstrapcandidate',
    'dept-candidate','job-candidate') AS status`)).rows[0].status, 'registered');
  const candidate = (await client.query("SELECT principal_id FROM content_intake.principals WHERE identity_scope='feishu-candidate'")).rows[0].principal_id;
  assert.deepEqual(await allowed(client, candidate), []);
  const tx = Object.assign(client, { validUntil() {}, beforeCommit() {} });
  let grantRequest;
  await client.query('BEGIN');
  try {
    await client.query('SELECT backend_review.lock_content()');
    await client.query('SET LOCAL ROLE intake_business');
    const admin = await principal(tx, { id: 'admin' });
    const recipient = await principal(tx, { id: candidate });
    const now = Date.now();
    const policyVersion = Number((await client.query("SELECT version FROM content_intake.policy_versions WHERE tenant_id='tenant-test' AND app_id='app-test'")).rows[0].version);
    grantRequest = { issuerFactsVersion: admin.factsVersion, policyVersion, items: [{
      kind: 'business', recipientPrincipalId: candidate, recipientFactsVersion: recipient.factsVersion,
      action: 'query', scope: { tenantId: 'tenant-test', appId: 'app-test', brandId: 'brand-one', shopId: 'shop-one', domain: 'product', sourceId: 'source-one' },
      startsAt: new Date(now).toISOString(), expiresAt: new Date(now+3600000).toISOString(), reason: '主账号授权测试',
    }] };
    const grants = await createGrants(tx, admin, grantRequest);
    assert.deepEqual(await allowed(client, candidate), ['source-one']);
    await changeGrant(tx, admin, grants.items[0].grantId, { change: 'revoke', expectedVersion: 1, stewardPrincipalId: null, reason: '主账号撤销测试' });
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  assert.deepEqual(await allowed(client, candidate), []);
  const before = await state(client);
  await bootstrapIssuerAuthority(client, command);
  assert.deepEqual(await state(client), before);
  assert.deepEqual(await allowed(client, candidate), []);
  await client.query('BEGIN');
  try {
    await client.query('SELECT backend_review.lock_content()');
    await client.query('SET LOCAL ROLE intake_business');
    await createGrants(tx, await principal(tx, { id: 'admin' }), grantRequest);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  assert.deepEqual(await allowed(client, candidate), ['source-one']);
  await client.query(`UPDATE content_intake.grants SET revoked_at=clock_timestamp(),
    version=version+1,last_change_reason='root revocation test'
    WHERE kind='allocation' AND recipient_id='admin'`);
  assert.deepEqual(await allowed(client, candidate), []);
  await deniedUnchanged(client, command, /existing authority/);
  assert.deepEqual(await allowed(client, candidate), []);
}));

test('real CLI consumes an isolated stack profile and produces a read-only plan', () => fixture(async client => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'bootstrap-profile-'));
  try {
    await client.query(`ALTER DATABASE "${database.name}" OWNER TO stack_owner`);
    writeFileSync(path.join(root,'profile.json'), JSON.stringify({ databaseName: database.name,
      pgPort: database.config.port, pgSocketDirectory: database.config.host }));
    const before = await state(client);
    const output = execFileSync(process.execPath, ['scripts/ops/bootstrap-issuer-authority.mjs', ...command, '--dry-run'], {
      encoding: 'utf8', env: { ...process.env, CUSTOMER_AGENT_STACK_ROOT: root }, timeout: 20000,
    });
    assert.equal(JSON.parse(output).wouldCreate, 2);
    assert.deepEqual(await state(client), before);
  } finally {
    await client.query(`ALTER DATABASE "${database.name}" OWNER TO gate_owner`);
    rmSync(root, { recursive: true, force: true });
  }
}));
