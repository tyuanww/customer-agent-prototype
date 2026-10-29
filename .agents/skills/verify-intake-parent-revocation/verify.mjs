import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use the repository Node.js 24 runtime');
assert(process.argv.length <= 3, 'Usage: node .agents/skills/verify-intake-parent-revocation/verify.mjs [report.json]');
const output = process.argv[2] ? path.resolve(process.argv[2]) : null;
const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
assert.equal(execFileSync(packageManager, ['--version'], { cwd: root, encoding: 'utf8' }).trim(), '11.19.0');
execFileSync(packageManager, ['--filter', '@customer-agent/database', 'check:generated'], { cwd: root, stdio: 'pipe' });
execFileSync(packageManager, ['--filter', '@customer-agent/database', 'build:runtime'], { cwd: root, stdio: 'pipe' });
const { Pg15Harness } = await import(pathToFileURL(path.join(root, 'packages/database/dist/testkit/index.js')));
const { applyDatabaseMigrations } = await import(pathToFileURL(path.join(root, 'packages/database/dist/index.js')));
const covered = [
  'packages/database/overlays/0055_grant_steward_required.sql',
  'packages/database/overlays/0057_role_ceiling.sql',
  'packages/database/overlays/0060_grant_issuer_authority.sql',
  'packages/database/overlays/0074_authorization_deadline_engineer.sql',
  'packages/database/overlays/0075_authorization_deadline_source_null.sql',
  'packages/database/overlays/0076_authorization_decision.sql',
  'packages/database/overlays/0077_manual_identity_grants.sql',
  'packages/database/migrations/manifest.generated.json',
  'packages/database/src/generated/migrations.generated.ts',
  'packages/database/src/verifier.ts',
  'packages/database/src/runner.ts',
  'apps/api/src/content-intake/authority.ts',
  'apps/api/src/content-intake/candidate.ts',
  'apps/api/src/content-intake/discovery.ts',
  'apps/api/src/content-intake/usage.ts',
  'apps/api/src/project-roster-login.ts',
];
const roles = ['director', 'manager', 'supervisor', 'lead', 'engineer', 'agent', 'enabler'];
const actions = ['query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback'];
const states = [];
for (const role of roles) for (const action of actions) for (const steward of [true, false])
  for (const childRevoked of [false, true]) for (const facts of ['live', 'disabled', 'expired'])
    states.push({ role, action, steward, childRevoked, facts });
const harness = new Pg15Harness();
let client;
const report = {
  property: 'After a parent allocation is revoked, neither authorization function may authorize its child business grant.',
  evidenceKind: 'bounded exhaustive execution of real PostgreSQL functions; not an unbounded proof',
  bounds: { principals: 2, tenantApps: 1, scopes: 1, sources: 1, parentGrants: 1, childGrants: 1,
    roles, actions, stewardStates: 2, childRevocationStates: 2, factsStates: 3, cases: states.length },
  node: process.version,
  generatedCatalogueVerified: true,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceHashes: Object.fromEntries(covered.map(file => [file, createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex')])),
  bootstrap: { ok: false },
};

async function decisions() {
  const { rows } = await client.query(`SELECT
    content_intake.authorization_deadline('proof-reader',$1,'proof-scope','proof-source',$2) IS NOT NULL AS deadline,
    EXISTS (SELECT 1 FROM content_intake.authorization_sources('proof-reader',$1,$2)
      WHERE scope_id='proof-scope' AND source_id='proof-source') AS sources`, [current.action, instant]);
  return rows[0];
}
let current;
let instant;

async function scenario(state) {
  current = state;
  await client.query('BEGIN');
  try {
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    await client.query(`INSERT INTO content_intake.role_rules(tenant_id,app_id,department_id,job_id,policy_version,role)
      VALUES ('proof-tenant','proof-app','proof-reader-dept','proof-reader-job',1,$1)`, [state.role]);
    await client.query(`UPDATE content_intake.principals SET current_facts_version=2 WHERE principal_id='proof-reader'`);
    const until = new Date(instant.getTime() + (state.facts === 'expired' ? -1000 : 240000));
    await client.query(`INSERT INTO content_intake.principal_facts
      (principal_id,facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest)
      VALUES ('proof-reader',2,ARRAY['proof-reader-dept'],'proof-reader-job',$1,$2,$3,repeat('ab',32))`,
    [state.facts !== 'disabled', new Date(instant.getTime() - 30000), until]);
    await client.query(`INSERT INTO content_intake.grants
      (grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
      VALUES ('proof-parent','allocation','proof-issuer','proof-issuer','proof-tenant','proof-app','proof-scope',$1,$2,$3,'synthetic parent','proof-issuer')`,
    [state.action, new Date(instant.getTime() - 60000), new Date(instant.getTime() + 3600000)]);
    await client.query(`INSERT INTO content_intake.grants
      (grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,
       revoked_at,reason,steward_id,parent_grant_id,policy_version,store_set_version)
      SELECT 'proof-child','business','proof-issuer','proof-reader','proof-tenant','proof-app','proof-scope',
        'proof-source',$1,$2,$3,$4,'synthetic child',$5,'proof-parent',
        CASE WHEN $1='query' THEN version ELSE NULL END,CASE WHEN $1='query' THEN 1 ELSE NULL END
      FROM content_intake.policy_versions WHERE tenant_id='proof-tenant' AND app_id='proof-app'`,
    [state.action, new Date(instant.getTime() - 15000), new Date(instant.getTime() + 300000),
      state.childRevoked ? new Date(instant.getTime() - 1000) : null, state.steward ? 'proof-issuer' : null]);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    const before = await decisions();
    await client.query(`UPDATE content_intake.grants SET revoked_at=$1,version=version+1,
      last_change_reason='synthetic parent revocation' WHERE grant_id='proof-parent'`, [instant]);
    const after = await decisions();
    return { ...state, before, after };
  } finally {
    await client.query('ROLLBACK');
  }
}

async function sweep() {
  const results = [];
  for (const state of states) results.push(await scenario(state));
  assert(results.some(row => row.before.deadline && row.before.sources), 'No positive authorized case; fixture is vacuous');
  return results;
}

try {
  harness.start();
  const database = harness.createDatabase('parent_revocation_proof');
  client = await harness.connect(database.config);
  report.postgres = (await client.query('SHOW server_version')).rows[0].server_version;
  await applyDatabaseMigrations(client);
  report.bootstrap = { ok: true };
  const definitions = await client.query(`SELECT proname,pg_get_functiondef(p.oid) AS definition,
      md5(pg_get_functiondef(p.oid)) AS md5 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='content_intake' AND proname IN ('authorization_deadline','authorization_sources') ORDER BY proname`);
  report.functions = definitions.rows.map(({ proname, md5 }) => ({ proname, md5 }));
  const original = definitions.rows.find(row => row.proname === 'authorization_sources').definition;
  instant = new Date((await client.query('SELECT clock_timestamp() AS at')).rows[0].at);
  await client.query('BEGIN');
  await client.query('SET CONSTRAINTS ALL DEFERRED');
  await client.query(`INSERT INTO content_intake.policy_versions(tenant_id,app_id,version) VALUES ('proof-tenant','proof-app',1);
    INSERT INTO content_intake.scopes(scope_id,tenant_id,app_id,brand_id,shop_id,domain)
      VALUES ('proof-scope','proof-tenant','proof-app','proof-brand',NULL,'product');
    INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode)
      VALUES ('proof-source','proof-scope',1,'v2-preview');
    INSERT INTO content_intake.source_mappings(source_id,version,template_version,rule_version,mapping_version,structure_digest)
      VALUES ('proof-source',1,'faq-p1.1','intake-p1.1','faq-map',repeat('ab',32));
    INSERT INTO content_intake.store_sets(tenant_id,app_id,version,approved_at,provenance)
      VALUES ('proof-tenant','proof-app',1,clock_timestamp(),'synthetic bounded verification');
    INSERT INTO content_intake.store_set_members(tenant_id,app_id,version,scope_id,source_id,content_valid_until)
      VALUES ('proof-tenant','proof-app',1,'proof-scope','proof-source',clock_timestamp()+interval '1 day');
    INSERT INTO content_intake.store_set_current(tenant_id,app_id,version) VALUES ('proof-tenant','proof-app',1);
    INSERT INTO content_intake.role_rules(tenant_id,app_id,department_id,job_id,policy_version,role)
      VALUES ('proof-tenant','proof-app','proof-issuer-dept','proof-issuer-job',1,'director');`);
  for (const kind of ['issuer', 'reader']) {
    const id = `proof-${kind}`;
    await client.query(`INSERT INTO backend_identity.subject_bindings
      (binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
      VALUES ($1,'synthetic','proof-tenant',$1,$1,repeat('ab',32),true,'owner');`, [id]);
    await client.query(`INSERT INTO content_intake.principals
      (principal_id,user_id,tenant_id,app_id,identity_scope,person_key,current_facts_version)
      VALUES ($1::text,$1::text,'proof-tenant','proof-app','confirmed-synthetic',$1::text,1)`, [id]);
    await client.query(`INSERT INTO content_intake.principal_facts
      (principal_id,facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest)
      VALUES ($1,1,ARRAY[$2],$3,true,$4,$5,repeat('ab',32))`,
    [id, `${id}-dept`, `${id}-job`, new Date(instant.getTime() - 60000), new Date(instant.getTime() + 3600000)]);
  }
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  await client.query('COMMIT');
  const baseline = await sweep();
  const violations = baseline.filter(row => row.after.deadline || row.after.sources);
  const witness = { role: 'director', action: 'query', steward: true, childRevoked: false, facts: 'live' };
  assert.deepEqual((await scenario(witness)).after, { deadline: false, sources: false });
  const guard = /ancestor\.revoked_at\s+IS\s+NULL/g;
  assert.equal([...original.matchAll(guard)].length, 1, 'Mutation anchor changed; review the actual SQL');
  let broken;
  try {
    await client.query(original.replace(guard, 'TRUE /* synthetic mutation: ancestor revocation guard removed */'));
    broken = await scenario(witness);
    assert(broken.after.deadline || broken.after.sources, 'Checker missed the real-code mutation');
  } finally {
    await client.query(original);
  }
  const restored = await sweep();
  assert.deepEqual(restored, baseline, 'Restoration changed the baseline');
  report.result = { checked: baseline.length, violations: violations.length,
    positiveBefore: baseline.filter(row => row.before.deadline && row.before.sources).length,
    counterexamples: violations, mutationCaught: true, mutationWitness: broken, restoredBaselineIdentical: true };
  process.exitCode = report.bootstrap.ok && violations.length === 0 ? 0 : 1;
} catch (error) {
  report.executionError = { name: error.name, message: error.message, code: error.code,
    detail: error.detail, position: error.position, stack: error.stack };
  process.exitCode = 2;
} finally {
  await client?.end();
  harness.stop();
  report.finishedAt = new Date().toISOString();
  report.temporaryClusterRemoved = true;
  if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ bootstrap: report.bootstrap, checked: report.result?.checked,
    violations: report.result?.violations, mutationCaught: report.result?.mutationCaught,
    restored: report.result?.restoredBaselineIdentical, executionError: report.executionError,
    temporaryClusterRemoved: report.temporaryClusterRemoved, output }, null, 2));
}
