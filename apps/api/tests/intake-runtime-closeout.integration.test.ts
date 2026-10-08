import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { createTemplate } from '@customer-agent/content-intake';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { startIntakeRuntimeCandidate, type RuntimeCandidateConfig } from '../experiments/intake-runtime/runtime-candidate.js';
import { createFeishuIdentityProvider } from '../src/feishu-identity-provider.js';
import { createIntakePurposePool } from '../src/content-intake/runtime-pool.js';
import { createRegisteredOrganizationRefresh } from '../src/content-intake/organization/registered-refresh.js';
import { nativeOrganizationFixture } from './support/intake-organization-native.js';
import { seedIntakeSyntheticHost } from './support/intake-synthetic-seed.js';
import { startSyntheticContactDouble } from '../experiments/intake-organization/synthetic-contact-double.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const scope = { tenantId: 'tenant-a', appId: 'app-a' };
const context = { shopId: 'shop-a', contextGeneration: 1, productIds: [], scenarioIds: [], releaseId: null };
type Candidate = Awaited<ReturnType<typeof startIntakeRuntimeCandidate>>;
describe.skipIf(!enabled)('closed runtime candidate through real auth, HTTP and formal PG15 purposes', () => {
  let pg: Pg15Harness, admin: Client, config: RuntimeCandidateConfig, runtime: Candidate | undefined;
  let contact: Awaited<ReturnType<typeof startSyntheticContactDouble>>;
  let closeIdentity: ReturnType<typeof vi.fn>, oauthCalls: string[];
  const errors: unknown[] = [];
  beforeEach(async () => {
    pg = new Pg15Harness(); pg.start();
    const db = pg.createDatabase('runtime_closeout'); admin = await pg.connect(db.config);
    await applyDatabaseMigrations(admin); await seedIntakeSyntheticHost(admin);
    const logins = { business: 'closeout_business', usage: 'closeout_usage', worker: 'closeout_worker', organization: 'closeout_organization', auth: 'closeout_auth' };
    for (const [purpose, login] of Object.entries(logins)) {
      const capability = purpose === 'auth' ? 'app_backend_auth' : purpose === 'organization' ? 'intake_org_writer' : `intake_${purpose}`;
      await admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT; GRANT ${capability} TO ${login}`);
    }
    contact = await startSyntheticContactDouble(); contact.user.open_id = 'ou_syntheticagent';
    await admin.query("UPDATE backend_identity.subject_bindings SET binding_id='ou_syntheticagent' WHERE user_id='user-agent'");
    const registrationPool = createIntakePurposePool({ ...db.config, user: logins.organization }, 'organization');
    try {
      const registrar = createRegisteredOrganizationRefresh(registrationPool, scope, nativeOrganizationFixture().transport);
      expect(await registrar.register({ principalId: 'agent', openId: contact.user.open_id, expectedBindingVersion: 0,
        validUntil: new Date(Date.now() + 600_000).toISOString() })).toMatchObject({ ok: true });
    } finally { await registrationPool.end(); }
    oauthCalls = []; errors.length = 0;
    const provider = createFeishuIdentityProvider({ clientId: 'synthetic-client', clientSecret: 'synthetic-not-a-secret', redirectUri: 'http://127.0.0.1/callback' },
      (async (input: string | URL | Request) => {
        const url = String(input); oauthCalls.push(url);
        const body = url.includes('/oauth/token') ? { access_token: 'synthetic-oauth-token' }
          : { code: 0, data: { open_id: 'ou_syntheticagent' } };
        const response = new Response(JSON.stringify(body), { status: 200 }); Object.defineProperty(response, 'url', { value: url });
        return response;
      }) as typeof fetch);
    closeIdentity = vi.fn(() => provider.close());
    config = { profile: 'synthetic-candidate', scope, database: { host: pg.socket, port: pg.port, database: db.name, logins },
      objectRoot: path.join(pg.root, 'objects'), identity: { ...scope, provider: { ...provider, close: closeIdentity } },
      organization: { ...scope, origin: contact.origin,
        tokenSupplier: { current: async () => ({ token: 'synthetic-tenant-token', expiresAtMs: Date.now() + 60_000 }) } } };
  }, 60_000);
  afterEach(async () => { await runtime?.close(); runtime = undefined; await contact?.close(); await admin?.end(); pg?.stop(); }, 30_000);
  const start = async () => runtime = await startIntakeRuntimeCandidate(config, (_id, error) => errors.push(error));
  async function json(url: string, init: RequestInit = {}) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  async function login() {
    const verifier = 'v'.repeat(43);
    const created = await json(`${runtime!.address}/v1/auth/login-requests`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_challenge: createHash('sha256').update(verifier).digest('base64url'), challenge_method: 'S256' }) });
    expect(created.status).toBe(201);
    const state = new URL(created.body.authorize_url as string).searchParams.get('state')!;
    const callback = await fetch(`${runtime!.address}/v1/auth/callback?${new URLSearchParams({ state, code: 'synthetic-code' })}`);
    expect(callback.ok).toBe(true);
    const exchanged = await json(`${runtime!.address}/v1/auth/login-requests/${created.body.login_id}/exchange`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_verifier: verifier }) });
    expect(exchanged.status).toBe(200); return exchanged.body.access_token as string;
  }
  const entitlement = (token: string) => json(`${runtime!.address}/v1/intake/entitlements`, { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(context) });
  const facts = async () => (await admin.query("SELECT current_facts_version,revocation_generation,f.* FROM content_intake.principals p JOIN content_intake.principal_facts f ON p.principal_id=f.principal_id AND p.current_facts_version=f.facts_version WHERE p.principal_id='agent'")).rows[0];
  async function noLeakedConnections() {
    await vi.waitFor(async () => expect((await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()")).rows[0].n).toBe(0));
  }
  it('uses existing Feishu identity normalization, native observation, restricted writer, usage and management HTTP', async () => {
    await start(); const token = await login();
    expect(oauthCalls).toHaveLength(2); expect(runtime!.runtimeActivated).toBe(false);
    const original = await runtime!.observe('agent');
    expect(await runtime!.write(original)).toMatchObject({ ok: true });
    expect(await runtime!.write(original)).toMatchObject({ ok: true, status: 'replayed' });
    expect((await facts()).current_facts_version).toBe('2');
    expect((await entitlement(token)).status).toBe(200);
    const denied = await json(`${runtime!.address}/v1/intake/sources/source-a/management-context`, { headers: { authorization: `Bearer ${token}` } });
    expect(denied).toMatchObject({ status: 404, body: { error: { details: { reason: 'SCOPE_DENIED' } } } }); // The OAuth login label never becomes a business grant.
    expect(await json(`${runtime!.address}/v1/intake/sources`, { headers: { 'x-mock-user': 'user-agent', 'x-mock-role': 'owner' } })).toMatchObject({ status: 401 });
    expect(errors).toHaveLength(1); expect(errors[0]).toMatchObject({ reason: 'SCOPE_DENIED' });
    const closing = runtime!.close(); expect(runtime!.close()).toBe(closing); await closing;
    await noLeakedConnections(); expect(closeIdentity).toHaveBeenCalledTimes(1);
    await expect(runtime!.observe('agent')).rejects.toThrow('INTAKE_CANDIDATE_CLOSED');
  });
  it.each(['disabled', 'job', 'department', 'expired'] as const)('fails closed for %s facts after a real session was issued', async change => {
    await start(); const token = await login(); const issued = await entitlement(token); expect(issued.status).toBe(200);
    if (change === 'expired') {
      const shortLease = await runtime!.observe('agent');
      shortLease.snapshot.validUntil = new Date(Date.now() + 300).toISOString();
      expect(await runtime!.write(shortLease)).toMatchObject({ ok: true });
      await vi.waitFor(async () => expect((await entitlement(token)).status).toBe(403));
    } else {
      if (change === 'disabled') contact.user.status.is_resigned = true;
      if (change === 'job') contact.user.job_title = '合成组长';
      if (change === 'department') contact.user.department_ids = ['dept-other'];
      const observation = await runtime!.observe('agent'); expect(await runtime!.write(observation)).toMatchObject({ ok: true });
    }
    const outcome = await entitlement(token);
    // A new job with no exact department/job role mapping, disabled or expired facts cannot issue authority.
    if (change !== 'job') expect(outcome.status).toBe(change === 'department' ? 404 : 403);
    else {
      expect((await facts()).revocation_generation).toBe('1');
      const old = await json(`${runtime!.address}/v1/intake/snapshot?entitlementId=${issued.body.entitlementId}`, { headers: { authorization: `Bearer ${token}` } });
      expect(old).toMatchObject({ status: 403, body: { error: { details: { reason: 'PERMISSION_CHANGED' } } } });
    }
  });
  it('drives the actual business upload queue and worker report finalization through the composed HTTP plugins', async () => {
    const registrarPool = createIntakePurposePool({ host: config.database.host, port: config.database.port,
      database: config.database.database, user: config.database.logins.organization }, 'organization');
    try {
      const registrar = createRegisteredOrganizationRefresh(registrarPool, scope, nativeOrganizationFixture().transport);
      expect(await registrar.register({ principalId: 'enabler', openId: 'enabler', expectedBindingVersion: 0,
        validUntil: new Date(Date.now() + 600_000).toISOString() })).toMatchObject({ ok: true });
    } finally { await registrarPool.end(); }
    config.identity.provider = { ...config.identity.provider, exchange: async () => 'enabler' };
    await start(); const token = await login();
    const workbook = await createTemplate({ sourceId: 'source-a', brandId: 'brand-a', scope: 'shop-a', domain: 'product', sheet: 'FAQ', templateVersion: 'faq-p1.1' },
      [['faq-one', '合成空正文', '', '', '', '分类', '', '启用', '', '', '', '内部说明', '', '', 'false']]);
    const form = new FormData(); form.set('operationId', 'closeout-bad-upload');
    form.set('file', new Blob([new Uint8Array(workbook)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic.xlsx');
    const uploaded = await json(`${runtime!.address}/v1/intake/sources/source-a/objects`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    expect(uploaded.status).toBe(201);
    const received = await json(`${runtime!.address}/v1/intake/sources/source-a/candidates`, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({
        operationId: 'closeout-bad-receive', objectId: uploaded.body.objectId, sourceVersion: 1, baseReleaseId: 'rel_native_base',
        contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null,
      }) });
    expect(received.status).toBe(202);
    await vi.waitFor(async () => {
      const job = await json(`${runtime!.address}/v1/intake/parse-jobs/${received.body.jobId}`, { headers: { authorization: `Bearer ${token}` } });
      expect(job).toMatchObject({ status: 200, body: { state: 'failed', candidateId: null } });
    }, { timeout: 10_000 });
    expect((await admin.query("SELECT count(*) FROM content_intake.objects WHERE purpose='report'")).rows[0].count).toBe('1');
    const report = await fetch(`${runtime!.address}/v1/intake/parse-jobs/${received.body.jobId}/report`, { headers: { authorization: `Bearer ${token}` } });
    expect(report.status).toBe(200); expect(Buffer.from(await report.arrayBuffer()).subarray(0, 2).toString()).toBe('PK');
    expect((await admin.query('SELECT count(*) FROM content_intake.publications')).rows[0].count).toBe('0');
  });
  it('denies an authenticated user outside the assembly tenant/app instead of borrowing a login role', async () => {
    config.scope = { ...scope, appId: 'other-app' };
    config.identity.appId = 'other-app'; config.organization.appId = 'other-app';
    await start(); const token = await login();
    expect(await entitlement(token)).toMatchObject({ status: 401, body: { error: { details: { reason: 'SCOPE_DENIED' } } } });
    expect((await admin.query('SELECT count(*) FROM content_intake.entitlements')).rows[0].count).toBe('0');
  });
  it.each(['missing-job', 'unregistered', 'network'] as const)('keeps old fact deadline unchanged on %s refresh refusal', async failure => {
    await start(); const before = await facts();
    if (failure === 'missing-job') delete contact.user.job_title;
    if (failure === 'network') contact.mode = { kind: 'status', status: 503, body: '' };
    await expect(runtime!.observe(failure === 'unregistered' ? 'director' : 'agent')).rejects.toThrow();
    expect(await facts()).toEqual(before);
  });
  it('aborts in-flight native reads before draining pools and can restart against retained receipts', async () => {
    await start(); const observation = await runtime!.observe('agent'); expect(await runtime!.write(observation)).toMatchObject({ ok: true });
    contact.mode = { kind: 'hang' }; const pending = runtime!.observe('agent');
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(contact.requests.length).toBeGreaterThan(6));
    await runtime!.close(); await rejected; await noLeakedConnections();
    contact.mode = { kind: 'native' }; await start();
    expect(await runtime!.write(observation)).toMatchObject({ ok: true, status: 'replayed' });
    expect((await facts()).current_facts_version).toBe('2');
  });
  it('preserves prototype methods and receiver identity of an admitted identity provider', async () => {
    const original = config.identity.provider;
    class Provider {
      closed = false;
      authorizeUrl(state: string) { if (this.closed) throw new Error('closed'); return original.authorizeUrl(state); }
      exchange(code: string) { if (this.closed) throw new Error('closed'); return original.exchange(code); }
      close() { this.closed = true; original.close(); }
    }
    const instance = new Provider(); config.identity.provider = instance;
    await start(); expect((await entitlement(await login())).status).toBe(200);
    await runtime!.close(); expect(instance.closed).toBe(true); await noLeakedConnections();
  });
  it.each([false, true])('drains the auth pool when provider.close throws (startup refusal: %s)', async startupRefusal => {
    const closeFailure = new Error('synthetic-provider-close-failure');
    closeIdentity.mockImplementation(() => { throw closeFailure; });
    if (startupRefusal) {
      await admin.query('REVOKE app_backend_auth FROM closeout_auth');
      await expect(start()).rejects.toMatchObject({ reason: 'DEPENDENCY_UNAVAILABLE' });
    } else {
      await start(); await login();
      await expect(runtime!.close()).rejects.toMatchObject({ message: 'INTAKE_CANDIDATE_CLOSE_FAILED', errors: [closeFailure] });
      runtime = undefined; // The expected rejected close remains memoized.
    }
    await noLeakedConnections(); expect(closeIdentity).toHaveBeenCalledTimes(1);
  });
  it.each(['wrong-purpose', 'admin', 'auth-role', 'storage'] as const)('releases all resources after %s startup rejection', async failure => {
    if (failure === 'wrong-purpose') [config.database.logins.business, config.database.logins.usage] = [config.database.logins.usage, config.database.logins.business];
    if (failure === 'admin') config.database.logins.business = pg.owner;
    if (failure === 'auth-role') await admin.query('REVOKE app_backend_auth FROM closeout_auth');
    if (failure === 'storage') config.objectRoot = '/dev/null/objects';
    await expect(start()).rejects.toThrow(); await noLeakedConnections(); expect(closeIdentity).toHaveBeenCalledTimes(1);
    expect(contact.requests).toHaveLength(0); expect(oauthCalls).toHaveLength(0);
  });
  it.each(['scope', 'remote-origin', 'duplicate-login', 'profile', 'implicit-database'] as const)('rejects %s configuration before opening resources', async failure => {
    if (failure === 'scope') config.organization.appId = 'wrong-app';
    if (failure === 'remote-origin') config.organization.origin = 'https://open.feishu.cn';
    if (failure === 'duplicate-login') config.database.logins.worker = config.database.logins.business;
    if (failure === 'profile') (config as { profile: string }).profile = 'production';
    if (failure === 'implicit-database') config.database.host = '';
    await expect(start()).rejects.toThrow(); await noLeakedConnections(); expect(closeIdentity).not.toHaveBeenCalled();
    expect(contact.requests).toHaveLength(0); expect(oauthCalls).toHaveLength(0);
  });
});
