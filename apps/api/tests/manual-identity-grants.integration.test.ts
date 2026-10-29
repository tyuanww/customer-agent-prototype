import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Client, ClientConfig } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations, applyMigrationPrefix } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createGrants, changeGrant, previewGrants } from '../src/content-intake/authority.js';
import { principal, registeredPrincipalPage, type IntakeTransaction } from '../src/content-intake/transaction.js';
import { attachFeishuLogin } from '../src/feishu-login-link.js';
import { createProductAuthService } from '../src/product-auth-service.js';
import { forgetJobSnapshot, rememberJobSnapshot } from '../src/feishu-job-snapshot.js';
import {
  CANDIDATE_DISPLAY_LABEL,
  projectRosterLogin,
  readStoredRosterPermission,
  rosterPrincipalId,
  type RosterCandidateProfile,
} from '../src/project-roster-login.js';
import { createSyntheticIdentityProvider } from '../src/synthetic-identity-provider.js';
import { buildAccount } from '../../../scripts/synthetic-stack/identity-admission.js';
import { createPasswordIdentityServer } from '../../../scripts/synthetic-stack/password-identity-server.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const HOME = Object.freeze({ tenantId: 'tenant-test', appId: 'app-test' });
const CANDIDATE: RosterCandidateProfile = Object.freeze({
  ...HOME,
  departmentId: 'dept-candidate',
  jobId: 'job-candidate-agent',
});
const ADMIN_BINDING = 'binding-manual-admin';
const ADMIN_PRINCIPAL = 'principal-manual-admin';
const ADMIN_USER = 'user-manual-admin';
const ADMIN_LOGIN = 'manual-admin';
const ADMIN_PASSWORD = 'synthetic-admin-password';
const VERIFIER = 'v'.repeat(43);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function transaction(client: Client): IntakeTransaction {
  return Object.assign(client, { validUntil() {}, beforeCommit() {} });
}

async function waitForPrincipalLock(observer: Client, waiter: number, blocker: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ waiting: boolean }>(`SELECT
      state='active' AND wait_event_type='Lock'
        AND $2::integer=ANY(pg_catalog.pg_blocking_pids(pid)) AS waiting
      FROM pg_catalog.pg_stat_activity WHERE pid=$1`, [waiter, blocker]);
    if (result.rows[0]?.waiting) return;
  }
  throw new Error(`Backend ${waiter} did not wait for blocker ${blocker}`);
}

async function seedManualQuery(client: Client, principalId: string): Promise<void> {
  await client.query(`INSERT INTO content_intake.grants(
    grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,
    starts_at,expires_at,reason,parent_grant_id,policy_version,store_set_version,steward_id)
    SELECT 'manual-lifecycle-query','business','principal-seed-issuer',
      $1::content_intake.identifier,$2::content_intake.identifier,$3::content_intake.identifier,
      'scope-one','source-one','query',clock_timestamp()-interval '1 minute',
      clock_timestamp()+interval '1 hour','人工生命周期测试授权。',
      'allocation-seed-query',policy.version,store.version,'principal-seed-issuer'
    FROM content_intake.policy_versions policy
    JOIN content_intake.store_set_current store USING (tenant_id,app_id)
    WHERE policy.tenant_id=$2 AND policy.app_id=$3`,
  [principalId, HOME.tenantId, HOME.appId]);
}

async function lifecycleState(client: Client, principalId: string) {
  const facts = await client.query<{ enabled: boolean; facts_version: string }>(`
    SELECT facts.enabled,facts.facts_version::text
    FROM content_intake.principals person
    JOIN content_intake.principal_facts facts ON facts.principal_id=person.principal_id
      AND facts.facts_version=person.current_facts_version
    WHERE person.principal_id=$1`, [principalId]);
  const sources = await client.query(`SELECT DISTINCT source_id
    FROM content_intake.authorization_sources($1,'query',clock_timestamp()) ORDER BY source_id`, [principalId]);
  const grants = await client.query(`SELECT grant_id,version::text,revoked_at
    FROM content_intake.grants WHERE recipient_id=$1 ORDER BY grant_id`, [principalId]);
  return { facts: facts.rows[0], sources: sources.rows, grants: grants.rows };
}

async function seedBase(client: Client, migrate = true): Promise<void> {
  if (migrate) await applyDatabaseMigrations(client);
  await client.query('BEGIN');
  try {
    await client.query(`INSERT INTO content_intake.policy_versions(tenant_id,app_id,version)
      VALUES ($1,$2,1)`, [HOME.tenantId, HOME.appId]);
    await client.query(`INSERT INTO content_intake.role_rules(
      tenant_id,app_id,department_id,job_id,policy_version,role)
      VALUES ($1,$2,'dept-candidate','job-candidate-agent',1,'agent'),
             ($1,$2,'dept-admin','job-director',1,'director')`,
    [HOME.tenantId, HOME.appId]);
    await client.query(`INSERT INTO content_intake.scopes(
      scope_id,tenant_id,app_id,brand_id,shop_id,domain)
      VALUES ('scope-one',$1,$2,'brand-one','shop-one','product')`, [HOME.tenantId, HOME.appId]);
    await client.query(`INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode)
      VALUES ('source-one','scope-one',1,'v2-preview')`);
    await client.query(`INSERT INTO content_intake.source_mappings(
      source_id,version,template_version,rule_version,mapping_version,structure_digest)
      VALUES ('source-one',1,'faq-p1.1','intake-p1.1','mapping-p1.1',repeat('a',64))`);
    await client.query(`INSERT INTO content_intake.store_sets(
      tenant_id,app_id,version,approved_at,provenance)
      VALUES ($1,$2,1,clock_timestamp(),'manual-identity-test')`, [HOME.tenantId, HOME.appId]);
    await client.query(`INSERT INTO content_intake.store_set_current(tenant_id,app_id,version)
      VALUES ($1,$2,1)`, [HOME.tenantId, HOME.appId]);
    await client.query(`INSERT INTO content_intake.store_set_members(
      tenant_id,app_id,version,scope_id,source_id,content_valid_until)
      VALUES ($1,$2,1,'scope-one','source-one',clock_timestamp()+interval '1 day')`,
    [HOME.tenantId, HOME.appId]);
    await client.query(`INSERT INTO backend_identity.subject_bindings(
      binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
      VALUES ($1,'synthetic',$2,'Manual Admin',$3,repeat('a',64),true,'owner')`,
    [ADMIN_BINDING, HOME.tenantId, ADMIN_USER]);
    await client.query(`INSERT INTO content_intake.principals(
      principal_id,user_id,tenant_id,app_id,identity_scope,person_key,current_facts_version)
      VALUES ($1,$2,$3,$4,'production-admin','manual-admin',1)`,
    [ADMIN_PRINCIPAL, ADMIN_USER, HOME.tenantId, HOME.appId]);
    await client.query(`INSERT INTO content_intake.principal_facts(
      principal_id,facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest)
      VALUES ($1,1,ARRAY['dept-admin'],'job-director',true,
        clock_timestamp()-interval '23 hours',clock_timestamp()-interval '22 hours',repeat('b',64))`,
    [ADMIN_PRINCIPAL]);
    await client.query(`INSERT INTO public.app_users(user_id,display_name,role,is_active)
      VALUES ($1,'主账号测试', 'owner', true)`, [ADMIN_USER]);
    await client.query(`INSERT INTO content_intake.grants(
      grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
      VALUES ('allocation-admin-query','allocation',$1,$1,$2,$3,'scope-one','query',
        clock_timestamp()-interval '1 day',clock_timestamp()+interval '2 days','管理员根授权。',$1)`,
    [ADMIN_PRINCIPAL, HOME.tenantId, HOME.appId]);
    await client.query(`INSERT INTO backend_identity.subject_bindings(
      binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
      VALUES ('binding-seed-issuer','synthetic',$1,'Seed Issuer','user-seed-issuer',repeat('c',64),true,'owner')`,
    [HOME.tenantId]);
    await client.query(`INSERT INTO content_intake.principals(
      principal_id,user_id,tenant_id,app_id,identity_scope,person_key,current_facts_version)
      VALUES ('principal-seed-issuer','user-seed-issuer',$1,$2,'content-intake-system','seed-issuer',1)`,
    [HOME.tenantId, HOME.appId]);
    await client.query(`INSERT INTO content_intake.principal_facts(
      principal_id,facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest)
      VALUES ('principal-seed-issuer',1,ARRAY['dept-admin'],'job-director',true,
        clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',repeat('d',64))`);
    await client.query(`INSERT INTO content_intake.grants(
      grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
      VALUES ('allocation-seed-query','allocation','principal-seed-issuer','principal-seed-issuer',
        $1,$2,'scope-one','query',clock_timestamp()-interval '1 day',clock_timestamp()+interval '2 days',
        '种子签发人的根授权','principal-seed-issuer')`, [HOME.tenantId, HOME.appId]);
    await client.query(`INSERT INTO content_intake.grants(
      grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,
      starts_at,expires_at,reason,parent_grant_id,policy_version,store_set_version,steward_id)
      SELECT 'business-admin-source','business','principal-seed-issuer',
        $1::content_intake.identifier,$2::content_intake.identifier,$3::content_intake.identifier,
        'scope-one','source-one','query',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day',
        '管理员来源授权。','allocation-seed-query',policy.version,1,'principal-seed-issuer'
      FROM content_intake.policy_versions policy
      WHERE policy.tenant_id=$2::content_intake.identifier
        AND policy.app_id=$3::content_intake.identifier`,
    [ADMIN_PRINCIPAL, HOME.tenantId, HOME.appId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

describe.skipIf(!enabled)('manual identity grant lifecycle on PostgreSQL 15', () => {
  let harness: Pg15Harness;
  let client: Client;
  let databaseConfig: ClientConfig;

  beforeEach(async () => {
    harness = new Pg15Harness();
    harness.start();
    const db = harness.createDatabase('manual_identity');
    databaseConfig = db.config;
    client = await harness.connect(databaseConfig);
    await seedBase(client);
  }, 120_000);

  afterEach(async () => {
    await client?.end();
    harness?.stop();
  }, 60_000);

  it('stores a new verified name for the directory without coupling query authority to account reads', async () => {
    const openId = 'ou_nameregistration01';
    await client.query('SET ROLE app_backend_auth');
    try {
      await client.query('SELECT backend_identity.admit_feishu_agent($1)', [openId]);
      expect((await client.query('SELECT backend_identity.set_operator_display_name($1,$2) AS status',
        [openId, '已登录测试人员'])).rows[0]?.status).toBe('updated');
      expect((await client.query('SELECT backend_identity.set_operator_display_name($1,$2) AS status',
        ['missing-binding', '不存在人员'])).rows[0]?.status).toBe('missing');
    } finally { await client.query('RESET ROLE'); }
    expect((await client.query('SELECT display_name,role,is_active FROM public.app_users WHERE user_id=$1',
      [`usr_${openId}`])).rows[0]).toEqual({ display_name: '已登录测试人员', role: 'agent', is_active: true });
    await projectRosterLogin(client, openId, HOME, CANDIDATE);
    await client.query('SET ROLE intake_business');
    try {
      const who = await principal(client, { id: ADMIN_PRINCIPAL });
      expect((await registeredPrincipalPage(client, who, '', 100))
        .find(person => person.id === rosterPrincipalId(openId))?.displayName).toBe('已登录测试人员');
      await expect(client.query('SELECT role FROM public.app_users')).rejects.toMatchObject({ code: '42501' });
    } finally { await client.query('RESET ROLE'); }
    await client.query('SET ROLE intake_usage');
    try {
      expect((await principal(client, { id: rosterPrincipalId(openId) })).enabled).toBe(true);
      await expect(client.query('SELECT display_name FROM public.app_users')).rejects.toMatchObject({ code: '42501' });
    } finally { await client.query('RESET ROLE'); }
    await client.query("UPDATE public.app_users SET role='coach',is_active=false WHERE user_id=$1", [`usr_${openId}`]);
    await client.query('SET ROLE app_backend_auth');
    try {
      await client.query('SELECT backend_identity.set_operator_display_name($1,$2)', [openId, '更新姓名']);
    } finally { await client.query('RESET ROLE'); }
    expect((await client.query('SELECT display_name,role,is_active FROM public.app_users WHERE user_id=$1',
      [`usr_${openId}`])).rows[0]).toEqual({ display_name: '更新姓名', role: 'coach', is_active: false });
    expect((await client.query('SELECT count(*)::int AS count FROM content_intake.grants WHERE recipient_id=$1',
      [rosterPrincipalId(openId)])).rows[0]?.count).toBe(0);
  });

  it('enforces the master account through database configuration and renews 24h facts on login', async () => {
    const configured = await client.query<{ status: string }>(
      "SELECT backend_identity.configure_production_admin_post($1,'dept-admin','root-test') AS status",
      [ADMIN_PRINCIPAL],
    );
    expect(configured.rows[0]?.status).toBe('configured');
    expect((await client.query<{ allowed: boolean }>(`SELECT
      pg_catalog.has_function_privilege(
        'intake_business',
        'backend_identity.configure_production_admin_post(text,text,text)',
        'EXECUTE') AS intake_business,
      pg_catalog.has_function_privilege(
        'app_backend_auth',
        'backend_identity.configure_production_admin_post(text,text,text)',
        'EXECUTE') AS app_backend_auth,
      pg_catalog.has_function_privilege(
        'app_runtime',
        'backend_identity.configure_production_admin_post(text,text,text)',
        'EXECUTE') AS app_runtime`)).rows[0]).toEqual({
      intake_business: false,
      app_backend_auth: false,
      app_runtime: false,
    });
    expect((await client.query(`SELECT
      pg_catalog.has_function_privilege(
        'app_backend_auth',
        'backend_identity.set_operator_display_name(text,text)',
        'EXECUTE') AS app_backend_auth,
      pg_catalog.has_function_privilege(
        'intake_business',
        'backend_identity.set_operator_display_name(text,text)',
        'EXECUTE') AS intake_business`)).rows[0]).toEqual({
      app_backend_auth: true,
      intake_business: false,
    });

    const authLogin = 'manual_auth_login';
    const businessLogin = 'manual_business_login';
    await client.query(`CREATE ROLE ${authLogin} LOGIN NOINHERIT;
      GRANT app_backend_auth TO ${authLogin};
      CREATE ROLE ${businessLogin} LOGIN NOINHERIT;
      GRANT intake_business TO ${businessLogin}`);

    const databaseName = (await client.query<{ name: string }>('SELECT current_database() AS name')).rows[0]!.name;
    const connection = (user: string) => `postgresql://${user}@localhost/${databaseName}?${new URLSearchParams({
      host: harness.socket,
      port: String(harness.port),
    })}`;
    const business = await harness.connect({
      host: harness.socket,
      port: harness.port,
      database: databaseName,
      user: businessLogin,
    });
    await business.query('SET ROLE intake_business');
    const directory = mkdtempSync(path.join(os.tmpdir(), 'manual-identity-'));
    const accountsFile = path.join(directory, 'password-accounts.json');
    writeFileSync(accountsFile, `${JSON.stringify([
      buildAccount(ADMIN_LOGIN, ADMIN_BINDING, ADMIN_PASSWORD),
    ])}\n`, { mode: 0o600 });
    const port = await freePort();
    const passwordServer = createPasswordIdentityServer({
      port,
      accountsFile,
      bindingAllowed: async (bindingId) => {
        const result = await business.query<{ allowed: boolean }>(
          'SELECT content_intake.password_login_allowed($1) AS allowed',
          [bindingId],
        );
        return result.rows[0]?.allowed === true;
      },
    });
    const provider = createSyntheticIdentityProvider(
      `http://127.0.0.1:${String(port)}`,
      'http://127.0.0.1:43100/v1/auth/callback',
    );
    const auth = await createProductAuthService(
      { connectionString: connection(authLogin), poolMax: 2, connectionTimeoutMs: 2_000, readinessTimeoutMs: 3_000 },
      provider,
      'mock',
      undefined,
      async (bindingId) => {
        const projected = await business.query<{ status: string }>(
          'SELECT content_intake.project_seat_login($1) AS status',
          [bindingId],
        );
        expect(projected.rows[0]?.status).toBe('projected');
      },
    );
    try {
      await passwordServer.listen();
      const login = await auth.createLogin(CHALLENGE);
      const state = new URL(login.authorize_url).searchParams.get('state');
      expect(state).toBeTruthy();
      const password = await fetch(`http://127.0.0.1:${String(port)}/password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: ADMIN_LOGIN, password: ADMIN_PASSWORD }),
      });
      expect(password.status).toBe(200);
      const code = (await password.json() as { code: string }).code;
      await auth.callback(state!, code);
      const session = await auth.exchange(login.login_id, VERIFIER);
      expect(session).not.toBeNull();
      expect((await auth.authenticate({ authorization: `Bearer ${session!.access_token}` }))?.role).toBe('owner');

      const facts = await client.query<{
        job_id: string; department_ids: string[]; duration_seconds: number; display_name: string | null;
      }>(`SELECT facts.job_id,facts.department_ids,
          extract(epoch FROM facts.valid_until-facts.checked_at)::int AS duration_seconds,
          app_users.display_name
        FROM content_intake.principals person
        JOIN content_intake.principal_facts facts
          ON facts.principal_id=person.principal_id AND facts.facts_version=person.current_facts_version
        LEFT JOIN public.app_users ON app_users.user_id=person.user_id
        WHERE person.principal_id=$1`, [ADMIN_PRINCIPAL]);
      expect(facts.rows[0]).toEqual({
        job_id: 'job-master-account',
        department_ids: ['dept-admin'],
        duration_seconds: 86_400,
        display_name: '主账号测试',
      });
      const signedInAdmin = await principal(transaction(business), { id: ADMIN_PRINCIPAL });
      expect((await registeredPrincipalPage(business, signedInAdmin, '', 100))
        .find(person => person.id === ADMIN_PRINCIPAL)?.displayName).toBe('主账号测试');

      const policyVersion = Number(facts.rows[0]
        ? (await client.query<{ version: string }>(
          'SELECT version::text FROM content_intake.policy_versions WHERE tenant_id=$1 AND app_id=$2',
          [HOME.tenantId, HOME.appId],
        )).rows[0]?.version
        : 0);
      const administrator = await principal(transaction(client), { id: ADMIN_PRINCIPAL });
      const administrativeRecipient = await principal(transaction(client), { id: 'principal-seed-issuer' });
      await expect(previewGrants(transaction(client), administrator, {
        operationId: 'admin-delegation-preview',
        issuerFactsVersion: administrator.factsVersion,
        policyVersion,
        items: [{
          kind: 'delegation',
          recipientPrincipalId: administrativeRecipient.id,
          recipientFactsVersion: administrativeRecipient.factsVersion,
          action: 'query',
          scope: {
            tenantId: HOME.tenantId,
            appId: HOME.appId,
            brandId: 'brand-one',
            shopId: 'shop-one',
            domain: 'product',
            sourceId: 'source-one',
          },
          startsAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          reason: '管理员委派预览。',
        }],
      })).resolves.toMatchObject({
        items: [{ kind: 'delegation', action: 'query', recipientPrincipalId: 'principal-seed-issuer' }],
      });

      await client.query('UPDATE backend_identity.subject_bindings SET enabled=false WHERE binding_id=$1', [ADMIN_BINDING]);
      expect((await auth.authenticate({ authorization: `Bearer ${session!.access_token}` }))).toBeNull();
      const refused = await fetch(`http://127.0.0.1:${String(port)}/password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: ADMIN_LOGIN, password: ADMIN_PASSWORD }),
      });
      expect(refused.status).toBe(401);
    } finally {
      await auth.close();
      await passwordServer.close().catch(() => undefined);
      await business.end();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 180_000);

  it('registers a minimum Feishu candidate, never grants on login, and never revives a revoked manual grant', async () => {
    const openId = 'ou_manualcandidate01';
    await client.query('SELECT backend_identity.admit_feishu_agent($1)', [openId]);
    const logged = await projectRosterLogin(client, openId, HOME, CANDIDATE);
    expect(logged).toBe('registered');
    expect(await readStoredRosterPermission(client, `usr_${openId}`)).toEqual({
      title: CANDIDATE_DISPLAY_LABEL,
      state: 'denied',
    });
    expect((await client.query(
      'SELECT count(*)::int AS count FROM content_intake.grants WHERE recipient_id=$1',
      [rosterPrincipalId(openId)],
    )).rows[0]?.count).toBe(0);

    await client.query(
      "SELECT backend_identity.configure_production_admin_post($1,'dept-admin','root-test')",
      [ADMIN_PRINCIPAL],
    );
    await client.query('SELECT content_intake.project_seat_login($1)', [ADMIN_BINDING]);
    const issuer = await principal(transaction(client), { id: ADMIN_PRINCIPAL });
    const recipient = await principal(transaction(client), { id: rosterPrincipalId(openId) });
    const policy = await client.query<{ version: string }>(
      'SELECT version::text FROM content_intake.policy_versions WHERE tenant_id=$1 AND app_id=$2',
      [HOME.tenantId, HOME.appId],
    );
    const policyVersion = Number(policy.rows[0]?.version);
    expect(Number.isSafeInteger(policyVersion)).toBe(true);
    const granted = await createGrants(transaction(client), issuer, {
      operationId: 'manual-grant-one',
      issuerFactsVersion: issuer.factsVersion,
      policyVersion,
      items: [{
        kind: 'business',
        recipientPrincipalId: recipient.id,
        recipientFactsVersion: recipient.factsVersion,
        action: 'query',
        scope: {
          tenantId: HOME.tenantId,
          appId: HOME.appId,
          brandId: 'brand-one',
          shopId: 'shop-one',
          domain: 'product',
          sourceId: 'source-one',
        },
        startsAt: new Date(Date.now() - 1_000).toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        reason: '人工查询授权。',
      }],
    });
    const grant = granted.items[0]!;
    expect((await client.query<{ until: Date | null }>(
      `SELECT content_intake.authorization_deadline($1,'query','scope-one','source-one',clock_timestamp()) AS until`,
      [recipient.id],
    )).rows[0]?.until).not.toBeNull();

    const revoked = await changeGrant(transaction(client), issuer, grant.grantId, {
      operationId: 'manual-revoke-one',
      expectedVersion: grant.version,
      change: 'revoke',
      stewardPrincipalId: issuer.id,
      reason: '人工撤销。',
    });
    expect(revoked.revokedAt).not.toBeNull();
    expect(await projectRosterLogin(client, openId, HOME, CANDIDATE)).toBe('registered');
    expect((await client.query<{ until: Date | null }>(
      `SELECT content_intake.authorization_deadline($1,'query','scope-one','source-one',clock_timestamp()) AS until`,
      [recipient.id],
    )).rows[0]?.until).toBeNull();
    expect((await client.query<{ revoked: boolean }>(
      'SELECT revoked_at IS NOT NULL AS revoked FROM content_intake.grants WHERE grant_id=$1',
      [grant.grantId],
    )).rows[0]?.revoked).toBe(true);

    await expect(previewGrants(transaction(client), recipient, {
      operationId: 'candidate-escalation',
      issuerFactsVersion: recipient.factsVersion,
      policyVersion,
      items: [{
        kind: 'business',
        recipientPrincipalId: issuer.id,
        recipientFactsVersion: issuer.factsVersion,
        action: 'query',
        scope: {
          tenantId: HOME.tenantId,
          appId: HOME.appId,
          brandId: 'brand-one',
          shopId: 'shop-one',
          domain: 'product',
          sourceId: 'source-one',
        },
        startsAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        reason: '不应被允许。',
      }],
    })).rejects.toMatchObject({ reason: 'REDELEGATION_DENIED' });
  }, 120_000);

  it('binds the candidate to the exact open id and preserves a disabled state across fallback', async () => {
    const exact = 'ou_exactcandidate1';
    const different = 'ou_othercandidate1';
    await client.query('SELECT backend_identity.admit_feishu_agent($1)', [exact]);
    await client.query('SELECT backend_identity.admit_feishu_agent($1)', [different]);

    const mismatch = await client.query<{ status: string }>(`SELECT
      content_intake.project_feishu_candidate(
        $1,$2,$3,$4,'dept-candidate','job-candidate-agent') AS status`,
    [`usr_${exact}`, HOME.tenantId, HOME.appId, different]);
    expect(mismatch.rows[0]?.status).toBe('missing');

    await expect(projectRosterLogin(client, exact, HOME, CANDIDATE)).resolves.toBe('registered');
    rememberJobSnapshot(exact, {
      title: '客服坐席',
      directory: [{ name: '客服坐席', enabled: false }],
      departmentIds: ['dept-candidate'],
      departed: true,
    });
    await expect(projectRosterLogin(client, exact, HOME, CANDIDATE)).resolves.toBe('revoked');
    forgetJobSnapshot(exact);
    await expect(projectRosterLogin(client, exact, HOME, CANDIDATE)).resolves.toBe('revoked');
    const facts = await client.query<{ enabled: boolean }>(`
      SELECT facts.enabled
      FROM content_intake.principals person
      JOIN content_intake.principal_facts facts
        ON facts.principal_id=person.principal_id
       AND facts.facts_version=person.current_facts_version
      WHERE person.principal_id=$1`, [rosterPrincipalId(exact)]);
    expect(facts.rows).toEqual([{ enabled: false }]);
    forgetJobSnapshot(exact);
    forgetJobSnapshot(different);
  }, 120_000);

  it('keeps withdrawal effective when candidate fallback waits on the principal lock', async () => {
    const openId = 'ou_candidaterace01';
    const principalId = rosterPrincipalId(openId);
    const fallback = await harness.connect(databaseConfig);
    const observer = await harness.connect(databaseConfig);
    let pending: Promise<unknown> | undefined;
    try {
      await client.query('SELECT backend_identity.admit_feishu_agent($1)', [openId]);
      expect(await projectRosterLogin(client, openId, HOME, CANDIDATE)).toBe('registered');
      await seedManualQuery(client, principalId);
      const before = await lifecycleState(client, principalId);
      expect(before.facts?.enabled).toBe(true);
      expect(before.sources).toEqual([{ source_id: 'source-one' }]);
      expect(before.grants).toEqual([{ grant_id: 'manual-lifecycle-query', version: '1', revoked_at: null }]);
      const blocker = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      const waiter = (await fallback.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      await fallback.query("SET statement_timeout='15s'");
      await fallback.query('SET ROLE intake_business');
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE intake_business');
      expect((await client.query(`SELECT content_intake.withdraw_feishu_roster($1,$2,$3) AS status`,
        [openId, HOME.tenantId, HOME.appId])).rows).toEqual([{ status: 'revoked' }]);
      pending = projectRosterLogin(fallback, openId, HOME, CANDIDATE)
        .then(status => ({ status }), error => ({ error }));
      await waitForPrincipalLock(observer, waiter, blocker);
      await client.query('COMMIT');
      expect(await pending).toEqual({ status: 'revoked' });
      const after = await lifecycleState(client, principalId);
      expect(after).toEqual({
        facts: { enabled: false, facts_version: '2' }, sources: [], grants: before.grants,
      });
      expect((await client.query(`SELECT facts_version::text,enabled FROM content_intake.principal_facts
        WHERE principal_id=$1 ORDER BY facts_version`, [principalId])).rows).toEqual([
        { facts_version: '1', enabled: true }, { facts_version: '2', enabled: false },
      ]);
    } finally {
      await client.query('ROLLBACK');
      await pending;
      await fallback.end();
      await observer.end();
      forgetJobSnapshot(openId);
    }
  }, 120_000);

  it('renews expired enabled linked seats but rejects password projection after a locked withdrawal', async () => {
    const openId = 'ou_linkedlifecycle01';
    const principalId = 'seat_lifecycle';
    const bindingId = 'synthetic_seat_lifecycle';
    const password = await harness.connect(databaseConfig);
    const observer = await harness.connect(databaseConfig);
    let pending: Promise<unknown> | undefined;
    try {
      await client.query("SELECT backend_identity.configure_production_admin_post($1,'dept-admin','root-test')", [ADMIN_PRINCIPAL]);
      await client.query('SELECT content_intake.project_seat_login($1)', [ADMIN_BINDING]);
      await client.query('SET ROLE intake_business');
      try {
        const created = await client.query(`SELECT * FROM backend_identity.create_seat($1,$2,$3,$4,$5,$6,$7)`,
          ['lifecycle', '生命周期测试坐席', '客服', HOME.tenantId, HOME.appId, 'dept-candidate', ADMIN_USER]);
        expect(created.rows[0]).toMatchObject({ out_principal_id: principalId, out_binding_id: bindingId });
        expect(await attachFeishuLogin(client, { openId, principalId })).toBe('attached');
      } finally { await client.query('RESET ROLE'); }
      await seedManualQuery(client, principalId);
      await client.query('BEGIN');
      try {
        await client.query(`WITH versioned AS (
          UPDATE content_intake.principals SET current_facts_version=current_facts_version+1
          WHERE principal_id=$1 RETURNING principal_id,current_facts_version
        ) INSERT INTO content_intake.principal_facts(
          principal_id,facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest)
        SELECT principal_id,current_facts_version,ARRAY['dept-candidate'],'job-seat',true,
          clock_timestamp()-interval '26 hours',clock_timestamp()-interval '2 hours',repeat('e',64)
        FROM versioned`, [principalId]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      const expired = await lifecycleState(client, principalId);
      expect(expired.facts?.enabled).toBe(true);
      expect(expired.sources).toEqual([]);
      await password.query('SET ROLE intake_business');
      expect((await password.query('SELECT content_intake.password_login_allowed($1) AS allowed', [bindingId])).rows)
        .toEqual([{ allowed: true }]);
      expect((await password.query('SELECT content_intake.project_seat_login($1) AS status', [bindingId])).rows)
        .toEqual([{ status: 'projected' }]);
      const renewed = await lifecycleState(client, principalId);
      expect(renewed.facts).toEqual({ enabled: true, facts_version: '3' });
      expect(renewed.sources).toEqual([{ source_id: 'source-one' }]);
      expect(renewed.grants).toEqual(expired.grants);
      const blocker = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      const waiter = (await password.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      await password.query("SET statement_timeout='15s'");
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE intake_business');
      expect((await client.query(`SELECT content_intake.withdraw_feishu_roster($1,$2,$3) AS status`,
        [openId, HOME.tenantId, HOME.appId])).rows).toEqual([{ status: 'revoked' }]);
      pending = password.query('SELECT content_intake.project_seat_login($1) AS status', [bindingId])
        .then(result => result.rows, error => ({ error }));
      await waitForPrincipalLock(observer, waiter, blocker);
      await client.query('COMMIT');
      expect(await pending).toEqual([{ status: 'missing' }]);
      expect((await password.query('SELECT content_intake.password_login_allowed($1) AS allowed', [bindingId])).rows)
        .toEqual([{ allowed: false }]);
      expect((await password.query('SELECT content_intake.project_seat_login($1) AS status', [bindingId])).rows)
        .toEqual([{ status: 'missing' }]);
      expect(await lifecycleState(client, principalId)).toEqual({
        facts: { enabled: false, facts_version: '4' }, sources: [], grants: renewed.grants,
      });
      expect((await client.query('SELECT enabled FROM backend_identity.subject_bindings WHERE binding_id=$1', [bindingId])).rows)
        .toEqual([{ enabled: true }]);
      expect((await client.query('SELECT principal_id FROM content_intake.principals WHERE principal_id=$1',
        [rosterPrincipalId(openId)])).rows).toEqual([]);
    } finally {
      await client.query('ROLLBACK');
      await pending;
      await password.end();
      await observer.end();
      forgetJobSnapshot(openId);
    }
  }, 120_000);

  it('promotes an enabled candidate through verified directory projection without allowing identity rewrites', async () => {
    const openId = 'ou_candidatepromotion01';
    const principalId = rosterPrincipalId(openId);
    try {
      await client.query(`INSERT INTO content_intake.role_rules(
        tenant_id,app_id,department_id,job_id,policy_version,role)
        SELECT tenant_id,app_id,'dept-candidate','job-customer-service-seat',version,'agent'
        FROM content_intake.policy_versions WHERE tenant_id=$1 AND app_id=$2`, [HOME.tenantId, HOME.appId]);
      await client.query('SELECT backend_identity.admit_feishu_agent($1)', [openId]);
      expect(await projectRosterLogin(client, openId, HOME, CANDIDATE)).toBe('registered');
      const identitySql = `SELECT principal_id,user_id,tenant_id,app_id,identity_scope,person_key
        FROM content_intake.principals WHERE principal_id=$1`;
      const before = (await client.query(identitySql, [principalId])).rows[0];
      expect(before.identity_scope).toBe('feishu-candidate');
      expect((await lifecycleState(client, principalId)).facts?.enabled).toBe(true);
      const grantsBefore = (await client.query('SELECT * FROM content_intake.grants ORDER BY grant_id')).rows;
      for (const role of ['intake_business', 'app_backend_auth', 'intake_usage']) {
        await client.query(`SET ROLE ${role}`);
        try {
          await expect(client.query(`UPDATE content_intake.principals
            SET identity_scope='feishu-job-roster',current_facts_version=current_facts_version+1
            WHERE principal_id=$1`, [principalId])).rejects.toMatchObject({ code: '42501' });
        } finally { await client.query('RESET ROLE'); }
      }
      await client.query(`CREATE ROLE manual_identity_writer NOLOGIN;
        GRANT USAGE ON SCHEMA content_intake TO manual_identity_writer;
        GRANT SELECT,UPDATE ON content_intake.principals TO manual_identity_writer`);
      await client.query('SET ROLE manual_identity_writer');
      try {
        await expect(client.query(`UPDATE content_intake.principals
          SET identity_scope='feishu-job-roster',current_facts_version=current_facts_version+1
          WHERE principal_id=$1`, [principalId])).rejects.toMatchObject({ code: 'ZA003', message: 'IDENTITY_IMMUTABLE' });
      } finally { await client.query('RESET ROLE'); }
      for (const column of ['principal_id', 'user_id', 'tenant_id', 'app_id', 'person_key']) {
        await expect(client.query(`UPDATE content_intake.principals
          SET identity_scope='feishu-job-roster',current_facts_version=current_facts_version+1,
            ${column}='rewritten-identity' WHERE principal_id=$1`, [principalId]))
          .rejects.toMatchObject({ code: 'ZA003', message: 'IDENTITY_IMMUTABLE' });
      }
      await expect(client.query(`UPDATE content_intake.principals SET identity_scope='feishu-job-roster'
        WHERE principal_id=$1`, [principalId])).rejects.toMatchObject({ code: 'ZA003', message: 'IDENTITY_IMMUTABLE' });
      rememberJobSnapshot(openId, {
        title: '客服坐席', directory: [{ name: '客服坐席', enabled: true }], departmentIds: ['dept-candidate'],
      });
      await client.query('SET ROLE intake_business');
      try {
        expect(await projectRosterLogin(client, openId, HOME, CANDIDATE)).toBe('registered');
      } finally { await client.query('RESET ROLE'); }
      expect((await client.query(identitySql, [principalId])).rows).toEqual([
        { ...before, identity_scope: 'feishu-job-roster' },
      ]);
      expect((await client.query('SELECT principal_id FROM content_intake.principals WHERE user_id=$1',
        [`usr_${openId}`])).rows).toEqual([{ principal_id: principalId }]);
      expect(await lifecycleState(client, principalId)).toEqual({
        facts: { enabled: true, facts_version: '2' }, sources: [], grants: [],
      });
      expect((await client.query('SELECT * FROM content_intake.grants ORDER BY grant_id')).rows).toEqual(grantsBefore);
      await expect(client.query(`UPDATE content_intake.principals
        SET identity_scope='feishu-candidate',current_facts_version=current_facts_version+1
        WHERE principal_id=$1`, [principalId])).rejects.toMatchObject({ code: 'ZA003', message: 'IDENTITY_IMMUTABLE' });
    } finally { forgetJobSnapshot(openId); }
  }, 120_000);

  it('retires only exact legacy automatic query grants and keeps manual grants live', async () => {
    const upgradeHarness = new Pg15Harness();
    upgradeHarness.start();
    const upgradeClient = await upgradeHarness.connect(
      upgradeHarness.createDatabase('manual_identity_upgrade').config,
    );
    try {
      await applyMigrationPrefix(upgradeClient, 75);
      await seedBase(upgradeClient, false);
      const openId = 'ou_legacyrecipient1';
      const recipientId = rosterPrincipalId(openId);
      await upgradeClient.query('SELECT backend_identity.admit_feishu_agent($1)', [openId]);
      const issued = await upgradeClient.query<{ status: string }>(`
        SELECT content_intake.issue_roster_query($1,$2,$3) AS status`,
      [recipientId, HOME.tenantId, HOME.appId]);
      expect(issued.rows[0]?.status).toBe('projected');
      const automatic = await upgradeClient.query<{ grant_id: string; reason: string }>(`
        SELECT grant_id,reason FROM content_intake.grants
        WHERE recipient_id=$1 AND kind='business' AND action='query'
        ORDER BY reason`, [recipientId]);
      expect(automatic.rows.map(row => row.reason).sort()).toEqual([
        '职位名单系统签发。', '飞书登录按来源签发。',
      ].sort());
      const manual = [
        { grant_id: 'legacy-human-roster-reason', reason: '职位名单系统签发。' },
        { grant_id: 'legacy-human-feishu-reason', reason: '飞书登录按来源签发。' },
        { grant_id: 'legacy-human-query', reason: '人工查询授权。' },
      ];
      for (const row of manual) await upgradeClient.query(`INSERT INTO content_intake.grants(
        grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,
        starts_at,expires_at,reason,parent_grant_id,policy_version,store_set_version,steward_id,roster_job_id)
        SELECT $1::content_intake.identifier,'business','principal-seed-issuer',
          $2::content_intake.identifier,$3::content_intake.identifier,$4::content_intake.identifier,
          'scope-one','source-one','query',
          clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day',$5,
          'allocation-seed-query',policy.version,store.version,'principal-seed-issuer','job-director'
        FROM content_intake.policy_versions policy
        JOIN content_intake.store_set_current store
          ON store.tenant_id=policy.tenant_id AND store.app_id=policy.app_id
        WHERE policy.tenant_id=$3 AND policy.app_id=$4`,
      [row.grant_id, recipientId, HOME.tenantId, HOME.appId, row.reason]);

      const before = await upgradeClient.query<{ grant_id: string; version: string; revoked: boolean }>(`
        SELECT grant_id,version::text,revoked_at IS NOT NULL AS revoked
        FROM content_intake.grants
        WHERE recipient_id=$1 AND kind='business' AND action='query'`, [recipientId]);
      expect(before.rows).toHaveLength(5);
      expect(before.rows).toEqual(expect.arrayContaining([...automatic.rows, ...manual].map(row => ({
        grant_id: row.grant_id, version: '1', revoked: false,
      }))));

      await applyDatabaseMigrations(upgradeClient);
      const after = await upgradeClient.query<{ grant_id: string; reason: string; version: string; revoked: boolean }>(`
        SELECT grant_id,reason,version::text,revoked_at IS NOT NULL AS revoked
        FROM content_intake.grants
        WHERE recipient_id=$1 AND kind='business' AND action='query'`, [recipientId]);
      expect(after.rows).toHaveLength(5);
      expect(after.rows).toEqual(expect.arrayContaining([
        ...automatic.rows.map(row => ({ ...row, version: '2', revoked: true })),
        ...manual.map(row => ({ ...row, version: '1', revoked: false })),
      ]));
      const execute = await upgradeClient.query<{ allowed: boolean }>(`SELECT
        pg_catalog.has_function_privilege(
          'intake_business',
          'content_intake.issue_roster_query(text,text,text)',
          'EXECUTE') AS allowed`);
      expect(execute.rows[0]?.allowed).toBe(false);
    } finally {
      await upgradeClient.end();
      upgradeHarness.stop();
    }
  }, 120_000);
});
