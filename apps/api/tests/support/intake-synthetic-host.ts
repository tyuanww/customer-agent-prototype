import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createTemplate, createCsvTemplate, CSV_TEMPLATE_VERSION } from '@customer-agent/content-intake';
import { parseContractSchema, type components } from '@customer-agent/contracts';
// Built production modules are the exact HTTP consumers. This test-only host is
// intentionally outside app.ts/main.ts and does not alter runtime/ACL locks.
import { createProductAuthService, IdentityFailure } from '../../dist/product-auth-service.js';
import { registerProductAuthRoutes } from '../../dist/product-auth-routes.js';
import { registerAuthRoutes } from '../../dist/auth-routes.js';
import { readAuthorizationActions, readStoredRosterPermission } from '../../dist/project-roster-login.js';
import { authenticateRequestHeaders } from '../../dist/auth-service.js';
import { createContentObjectStore } from '../../dist/content-object-store.js';
import { createContentIntakeService } from '../../dist/content-intake/service.js';
import { contentIntakeManagementRoutes } from '../../dist/content-intake/management-http.js';
import { contentIntakeUsageRoutes } from '../../dist/content-intake/usage-http.js';
import { createEventRepository } from '../../dist/event-repository.js';
import { registerSearchRoute } from '../../dist/search-routes.js';
import { IntakeRejection, type IntakePool } from '../../dist/content-intake/transaction.js';
import { createIntakePurposePool, type IntakePurposePool } from '../../dist/content-intake/runtime-pool.js';
import { createRegisteredOrganizationRefresh } from '../../dist/content-intake/organization/registered-refresh.js';
import { nativeOrganizationFixture } from './intake-organization-native.ts';
import { seedIntakeSyntheticDirectory } from './intake-synthetic-directory.ts';
import { INTAKE_SYNTHETIC_IDENTITIES, seedIntakeSyntheticHost } from './intake-synthetic-seed.ts';

type C = components['schemas'];
export type IntakeSyntheticDomain = 'product' | 'campaign' | 'presale' | 'aftersale';
export type IntakeSyntheticIdentity = 'director' | 'enabler' | 'reviewer' | 'agent';
/** One roster principal exists only so the desktop lane can read /v1/auth/job. The four intake
 * identities above stay confirmed-synthetic, because intake routes reject a roster scope. */
export type DesktopSyntheticIdentity = IntakeSyntheticIdentity | 'roster-director' | 'roster-readonly' | 'roster-stale';
export const INTAKE_SYNTHETIC_FAQ = Object.freeze([
  { title: '合成洁面使用', answer: '先取适量合成洁面产品。\n再用清水洗净。' },
  { title: '合成洁面频次', answer: '合成洁面示例：每日一次。\n以示例适用说明为准。' },
  { title: '合成洁面保存', answer: '合成洁面示例：置于阴凉处。\n使用后盖好瓶盖。' },
]);

type SyntheticFileOptions = { missingAnswer?: boolean; answerSuffix?: string; domain?: IntakeSyntheticDomain; missingExpiry?: boolean };
function syntheticRows({ missingAnswer = false, answerSuffix = '', domain = 'product', missingExpiry = false }: SyntheticFileOptions) {
  return INTAKE_SYNTHETIC_FAQ.map((faq, i) => [`faq-${i}`, faq.title, missingAnswer && i === 1 ? '' : faq.answer + answerSuffix,
    '', '', '合成分类', '', '启用', domain === 'campaign' ? '2026-01-01T00:00:00Z' : '', domain === 'campaign' && !missingExpiry ? '2099-01-01T00:00:00Z' : '', '', '合成内部说明', '', '', 'false']);
}
/** Original bytes for native file-picker journeys; all text is synthetic. */
export function createIntakeSyntheticWorkbook(options: SyntheticFileOptions = {}) {
  return createTemplate({ sourceId: 'source-a', brandId: 'brand-a', scope: 'shop-a', domain: options.domain ?? 'product', sheet: 'FAQ', templateVersion: 'faq-p1.1' }, syntheticRows(options));
}
export function createIntakeSyntheticCsv(options: SyntheticFileOptions = {}) {
  return createCsvTemplate({ sourceId: 'source-a', brandId: 'brand-a', scope: 'shop-a', scopeKind: 'shop', domain: options.domain ?? 'product', templateVersion: CSV_TEMPLATE_VERSION },
    syntheticRows(options).map(faq => ({ faq })));
}

type HostState = Awaited<ReturnType<typeof startIntakeSyntheticHost>>;
type PreparedHost = HostState & { candidate: C['IntakeCandidate']; object: C['IntakeObject'] };
type SyntheticProfile = 'existing' | 'purpose-runtime';
type HostOptions = { profile?: SyntheticProfile; domain?: IntakeSyntheticDomain; duplicateShopNames?: boolean; inputFormat?: 'xlsx' | 'csv'; includeSopSource?: boolean };
export function createIntakeSyntheticHost(options: { prepareCandidate: false; } & HostOptions): Promise<HostState>;
export function createIntakeSyntheticHost(options?: { prepareCandidate?: true; } & HostOptions): Promise<PreparedHost>;
export function createIntakeSyntheticHost(options?: { prepareCandidate?: boolean; } & HostOptions): Promise<HostState> {
  return startIntakeSyntheticHost(options?.prepareCandidate !== false, options?.profile ?? 'existing', options?.domain ?? 'product', options?.duplicateShopNames ?? false, options?.inputFormat ?? 'xlsx', options?.includeSopSource ?? false);
}

/** Fresh Unix-socket PG15 + real product-session/HTTP modules. No environment
 * files, existing DB, production factory or real provider is ever consumed.
 * The returned control methods are local test/terminal controls, not HTTP
 * administrative routes. Synthetic data disappears on close; no approval provider is installed. */
async function startIntakeSyntheticHost(prepareCandidate: boolean, profile: SyntheticProfile, domain: IntakeSyntheticDomain, duplicateShopNames: boolean, inputFormat: 'xlsx' | 'csv', includeSopSource: boolean) {
  if (includeSopSource && (prepareCandidate || domain !== 'product' || inputFormat !== 'xlsx')) throw new Error('SOP fixture requires an unprepared product/XLSX host');
  const pg = new Pg15Harness();
  let admin: Awaited<ReturnType<Pg15Harness['connect']>> | undefined;
  let pool: IntakePool | undefined;
  let usagePool: IntakePool | undefined, terminalPool: IntakePool | undefined;
  const ownedPools: (Pool | IntakePurposePool)[] = [];
  const purposeQueries: Record<string, number> = {};
  function ownPool(raw: Pool | IntakePurposePool, purpose: string): IntakePool {
    ownedPools.push(raw); purposeQueries[purpose] = 0;
    return { connect: async () => {
      const client = await raw.connect();
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return (sql: string, parameters?: unknown[]) => { purposeQueries[purpose] = purposeQueries[purpose]! + 1; return target.query(sql, parameters); };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    } };
  }
  let auth: Awaited<ReturnType<typeof createProductAuthService>> | undefined;
  const app = Fastify({ logger: false, exposeHeadRoutes: false, routerOptions: { maxParamLength: 128 } });
  let apiOrigin = '', identityOrigin = '', selectedIdentity: DesktopSyntheticIdentity = 'enabler';
  const loginCodes = new Map<string, { binding: DesktopSyntheticIdentity; expires: number }>();
  const sessions = new Map<DesktopSyntheticIdentity, string>();
  const diagnostics: { id: string; reason: string }[] = [];
  const requests: string[] = [];
  const identity = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.headers.host !== new URL(identityOrigin).host || request.method !== 'GET'
      || url.pathname !== '/authorize' || [...url.searchParams.keys()].some(k => k !== 'state')
      || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('state') ?? '')) {
      response.writeHead(400); response.end('Synthetic identity request rejected'); return;
    }
    let code: string;
    try { code = issueCode(selectedIdentity); }
    catch { response.writeHead(429); response.end('Synthetic login budget exceeded'); return; }
    const callback = new URL('/v1/auth/callback', apiOrigin);
    callback.searchParams.set('state', url.searchParams.get('state')!); callback.searchParams.set('code', code);
    response.writeHead(302, { location: callback.href, 'cache-control': 'no-store' }); response.end();
  });
  function issueCode(binding: DesktopSyntheticIdentity) {
    for (const [key, value] of loginCodes) if (value.expires <= Date.now()) loginCodes.delete(key);
    if (loginCodes.size >= 100) throw new Error('Synthetic login budget exceeded');
    const code = randomBytes(32).toString('base64url');
    loginCodes.set(code, { binding, expires: Date.now() + 60_000 }); return code;
  }
  let closed = false;
  async function close() {
    if (closed) return; closed = true;
    const failures: unknown[] = [];
    for (const cleanup of [() => app.close(), () => new Promise<void>((resolve, reject) => {
      if (!identity.listening) { resolve(); return; }
      identity.closeAllConnections(); identity.close(error => error ? reject(error) : resolve());
    }), () => auth?.close(), ...ownedPools.map(pool => () => pool.end()), () => admin?.end(), () => pg.stop()]) {
      try { await cleanup(); } catch (error) { failures.push(error); }
    }
    sessions.clear(); loginCodes.clear();
    if (failures.length) throw new AggregateError(failures, 'Synthetic host cleanup failed');
  }
  async function requestAs(actor: DesktopSyntheticIdentity, pathname: string, options: RequestInit = {}) {
    if (!/^\/v1\/[A-Za-z0-9/?=&%._-]+$/.test(pathname)) throw new Error('Only local v1 requests are accepted');
    let token = sessions.get(actor);
    if (!token) {
      const verifier = randomBytes(32).toString('base64url');
      const created = parseContractSchema('LoginCreated', await (await fetch(`${apiOrigin}/v1/auth/login-requests`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_challenge: createHash('sha256').update(verifier).digest('base64url'), challenge_method: 'S256' }), signal: AbortSignal.timeout(15_000), redirect: 'error',
      })).json());
      const callback = new URL('/v1/auth/callback', apiOrigin);
      callback.searchParams.set('state', new URL(created.authorize_url).searchParams.get('state')!); callback.searchParams.set('code', issueCode(actor));
      const authorized = await fetch(callback, { signal: AbortSignal.timeout(15_000), redirect: 'error' }); if (!authorized.ok) throw new Error(`Synthetic callback failed: ${authorized.status}`);
      const session = parseContractSchema('LoginSession', await (await fetch(`${apiOrigin}/v1/auth/login-requests/${created.login_id}/exchange`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_verifier: verifier }), signal: AbortSignal.timeout(15_000), redirect: 'error',
      })).json());
      token = session.access_token; sessions.set(actor, token);
    }
    const headers = new Headers(options.headers); headers.set('authorization', `Bearer ${token}`);
    return fetch(`${apiOrigin}${pathname}`, { ...options, headers, signal: options.signal ?? AbortSignal.timeout(15_000), redirect: 'error' });
  }
  try {
    pg.start(); const database = pg.createDatabase('intake_desktop');
    admin = await pg.connect(database.config); await applyDatabaseMigrations(admin);
    await admin.query('BEGIN');
    await admin.query('SET CONSTRAINTS ALL DEFERRED');
    // /v1/auth/job only answers for a roster principal, and the intake routes only accept a
    // confirmed-synthetic one. Keep the four intake identities as they are and add a single
    // roster principal that the desktop lane signs in as.
    await admin.query(`INSERT INTO backend_identity.subject_bindings(
        binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
      VALUES ('roster-director','synthetic','tenant-a','roster-director','user-roster-director',repeat('a',64),true,'owner')`);
    await admin.query(`INSERT INTO content_intake.principals VALUES
        ('roster-director','user-roster-director','tenant-a','app-a','feishu-job-roster','roster-director',1,0)`);
    await admin.query(`INSERT INTO content_intake.principal_facts VALUES
        ('roster-director',1,ARRAY['dept-a'],'job-customer-service-director',true,
         statement_timestamp()-interval '1 second',statement_timestamp()+interval '299 seconds',repeat('a',64))`);
    await admin.query(`INSERT INTO content_intake.role_rules(
        tenant_id, app_id, department_id, job_id, policy_version, role)
      VALUES ('tenant-a','app-a','dept-a','job-customer-service-director',1,'director')
      ON CONFLICT DO NOTHING`);
    await admin.query('COMMIT');
    // The role rule above bumps the policy version, so it has to settle before the shared seed
    // stamps any query grant with the version a reader will compare against.
    await seedIntakeSyntheticHost(admin, domain, inputFormat, includeSopSource); await seedIntakeSyntheticDirectory(admin, { duplicateShopNames });
    // The workbench buttons read authorization_sources. Seed one approved store set and add
    // live rows for the actions the workbench calls, without rewriting the shared intake fixture
    // (grants are append-only, so a NULL policy version cannot be repaired in place).
    await admin.query(`INSERT INTO content_intake.store_sets(tenant_id, app_id, version, approved_at, provenance)
      VALUES ('tenant-a','app-a',1,clock_timestamp(),'synthetic')
      ON CONFLICT (tenant_id, app_id, version) DO NOTHING`);
    await admin.query(`INSERT INTO content_intake.store_set_current(tenant_id, app_id, version)
      VALUES ('tenant-a','app-a',1)
      ON CONFLICT (tenant_id, app_id) DO UPDATE SET version = 1`);
    await admin.query(`INSERT INTO content_intake.store_set_members(
        tenant_id, app_id, version, scope_id, source_id, content_valid_until)
      VALUES
        ('tenant-a','app-a',1,'scope-a','source-a',clock_timestamp()+interval '1 day'),
        ('tenant-a','app-a',1,'scope-b','source-b',clock_timestamp()+interval '1 day')
      ON CONFLICT (tenant_id, app_id, version, scope_id, source_id) DO NOTHING`);
    // The permission page lists a scope only when the signed-in principal may allocate there,
    // so the roster principal gets its own allocation rows. Allocation may be self-held.
    await admin.query(`INSERT INTO content_intake.grants(
        grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, action,
        starts_at, expires_at, reason, steward_id)
      SELECT 'alloc-roster-' || action, 'allocation', 'director', 'roster-director',
        'tenant-a','app-a','scope-a', action,
        clock_timestamp()-interval '2 days', clock_timestamp()+interval '1 hour','合成名单分配','director'
      FROM unnest(ARRAY['query','content-manage','import','source-confirm','review','publish','candidate-cancel','rollback']::text[]) AS action`);
    // Query needs a policy version and a store set version; the other actions only need the grant.
    await admin.query(`INSERT INTO content_intake.grants(
        grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
        starts_at, expires_at, reason, steward_id, parent_grant_id, policy_version, store_set_version)
      VALUES ('business-roster-query','business','director','roster-director',
        'tenant-a','app-a','scope-a','source-a','query',
        clock_timestamp()-interval '1 minute', clock_timestamp()+interval '4 minutes','合成名单查询','director','root-query',
        (SELECT version FROM content_intake.policy_versions WHERE tenant_id='tenant-a' AND app_id='app-a'), 1)`);
    for (const action of ['import', 'publish', 'rollback']) {
      await admin.query(`INSERT INTO content_intake.grants(
          grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
          starts_at, expires_at, reason, steward_id, parent_grant_id)
        VALUES ($1,'business','director','roster-director','tenant-a','app-a','scope-a','source-a',$2,
          clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 minutes','合成名单授权','director',$3)`,
      [`business-roster-${action}`, action, `root-${action}`]);
    }
    // A second roster principal with the same director title but a query grant only. The
    // workbench has to hide every write control for it and show the denial sentence, which is
    // the review state the operator asked to see. Its own transaction defers the
    // principal-current-facts foreign key the same way the first roster principal does.
    await admin.query('BEGIN');
    await admin.query('SET CONSTRAINTS ALL DEFERRED');
    await admin.query(`INSERT INTO backend_identity.subject_bindings(
        binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
      VALUES ('roster-readonly','synthetic','tenant-a','roster-readonly','user-roster-readonly',repeat('a',64),true,'owner')`);
    await admin.query(`INSERT INTO content_intake.principals VALUES
        ('roster-readonly','user-roster-readonly','tenant-a','app-a','feishu-job-roster','roster-readonly',1,0)`);
    await admin.query(`INSERT INTO content_intake.principal_facts VALUES
        ('roster-readonly',1,ARRAY['dept-a'],'job-customer-service-director',true,
         statement_timestamp()-interval '1 second',statement_timestamp()+interval '299 seconds',repeat('a',64))`);
    // Allocations make the permission page list a scope, so the missing button can only be
    // explained by the publish bit, not by an empty scope list.
    await admin.query(`INSERT INTO content_intake.grants(
        grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, action,
        starts_at, expires_at, reason, steward_id)
      SELECT 'alloc-roster-readonly-' || action, 'allocation', 'director', 'roster-readonly',
        'tenant-a','app-a','scope-a', action,
        clock_timestamp()-interval '2 days', clock_timestamp()+interval '1 hour','合成只读分配','director'
      FROM unnest(ARRAY['query','content-manage','import','source-confirm','review','publish','candidate-cancel','rollback']::text[]) AS action`);
    await admin.query(`INSERT INTO content_intake.grants(
        grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
        starts_at, expires_at, reason, steward_id, parent_grant_id, policy_version, store_set_version)
      VALUES ('business-roster-readonly-query','business','director','roster-readonly',
        'tenant-a','app-a','scope-a','source-a','query',
        clock_timestamp()-interval '1 minute', clock_timestamp()+interval '4 minutes','合成只读查询','director','root-query',
        (SELECT version FROM content_intake.policy_versions WHERE tenant_id='tenant-a' AND app_id='app-a'), 1)`);
    // A third roster principal with the same title and a live query grant, but a facts window
    // that has already closed. The source set drops every row for it, so search must report the
    // stale sentence rather than the denial: the two refusals have different causes and
    // different owners.
    await admin.query('BEGIN');
    await admin.query('SET CONSTRAINTS ALL DEFERRED');
    await admin.query(`INSERT INTO backend_identity.subject_bindings(
        binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
      VALUES ('roster-stale','synthetic','tenant-a','roster-stale','user-roster-stale',repeat('a',64),true,'owner')`);
    await admin.query(`INSERT INTO content_intake.principals VALUES
        ('roster-stale','user-roster-stale','tenant-a','app-a','feishu-job-roster','roster-stale',1,0)`);
    await admin.query(`INSERT INTO content_intake.principal_facts VALUES
        ('roster-stale',1,ARRAY['dept-a'],'job-customer-service-director',true,
         statement_timestamp()-interval '4 minutes',statement_timestamp()-interval '1 minute',repeat('a',64))`);
    await admin.query(`INSERT INTO content_intake.grants(
        grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, action,
        starts_at, expires_at, reason, steward_id)
      VALUES ('alloc-roster-stale-query','allocation','director','roster-stale',
        'tenant-a','app-a','scope-a','query',
        clock_timestamp()-interval '2 days', clock_timestamp()+interval '1 hour','合成过期分配','director')`);
    await admin.query(`INSERT INTO content_intake.grants(
        grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
        starts_at, expires_at, reason, steward_id, parent_grant_id, policy_version, store_set_version)
      VALUES ('business-roster-stale-query','business','director','roster-stale',
        'tenant-a','app-a','scope-a','source-a','query',
        clock_timestamp()-interval '1 minute', clock_timestamp()+interval '4 minutes','合成过期查询','director','root-query',
        (SELECT version FROM content_intake.policy_versions WHERE tenant_id='tenant-a' AND app_id='app-a'), 1)`);
    await admin.query('COMMIT');
    await admin.query('CREATE ROLE synthetic_intake_auth LOGIN NOINHERIT; GRANT app_backend_auth TO synthetic_intake_auth');
    if (profile === 'purpose-runtime') {
      const roles = {} as Record<'business' | 'usage' | 'worker' | 'organization', IntakePool>;
      for (const purpose of ['business', 'usage', 'worker', 'organization'] as const) {
        const capability = purpose === 'organization' ? 'intake_org_writer' : `intake_${purpose}`, login = `synthetic_${purpose}`;
        await admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; GRANT ${capability} TO ${login}`);
        roles[purpose] = ownPool(createIntakePurposePool({ ...database.config, user: login, max: 2 }, purpose, () => { diagnostics.push({ id: `synthetic-pool-${purpose}`, reason: 'IDLE_CONNECTION_FAILED' }); }), purpose);
        const checked = await roles[purpose].connect(); checked.release();
      }
      pool = roles.business; usagePool = roles.usage;
      // Only invented native-shaped input is supplied here; no provider HTTP or credentials.
      const refresh = createRegisteredOrganizationRefresh(roles.organization, { tenantId: 'tenant-a', appId: 'app-a' }, nativeOrganizationFixture().transport);
      const registered = await refresh.register({ principalId: 'agent', openId: 'synthetic-open-agent', expectedBindingVersion: 0, validUntil: new Date(Date.now() + 600_000).toISOString() });
      if (!registered.ok) throw new Error(`Synthetic organization registration failed: ${registered.reason}`);
      const refreshed = await refresh.write(await refresh.observe('agent'));
      if (!refreshed.ok) throw new Error(`Synthetic organization refresh failed: ${refreshed.reason}`);
      terminalPool = roles.worker;
    } else {
      pool = ownPool(new Pool({ ...database.config, max: 4 }), 'existing');
      usagePool = pool;
    }
    await new Promise<void>((resolve, reject) => { identity.once('error', reject); identity.listen(0, '127.0.0.1', () => resolve()); });
    identityOrigin = `http://127.0.0.1:${(identity.address() as AddressInfo).port}`;
    auth = await createProductAuthService({ connectionString: `postgresql://synthetic_intake_auth@localhost/${database.name}?${new URLSearchParams({ host: pg.socket, port: String(pg.port) })}`,
      poolMax: 2, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000 }, {
      authorizeUrl: state => `${identityOrigin}/authorize?state=${state}`,
      exchange: async code => { const value = loginCodes.get(code); loginCodes.delete(code);
        if (!value || value.expires <= Date.now()) throw new IdentityFailure('LOGIN_INVALID'); return value.binding; }, close: () => undefined,
    }, 'mock');
    app.addHook('onRequest', async (request, reply) => {
      if (request.headers.host !== new URL(apiOrigin).host) return reply.code(403).send();
      // Paths only: never retain credentials, auth codes, state or request bodies.
      if (requests.length < 1000) requests.push(request.url.split('?')[0]!);
    });
    registerProductAuthRoutes(app, auth);
    registerAuthRoutes(app, auth, async (userId) => readStoredRosterPermission(admin!, userId), async (userId) => readAuthorizationActions(admin!, userId));
    // The real search door, on a real app_runtime LOGIN: the search function is executable
    // only by that capability, so the lanes cannot borrow the intake pools. The keys are
    // throwaway fixture material and are never printed. The login inherits app_runtime
    // rather than taking it with SET ROLE, because the event repository runs as the session.
    await admin!.query('CREATE ROLE synthetic_search_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; GRANT app_runtime TO synthetic_search_runtime');
    const searchPool = new Pool({ ...database.config, user: 'synthetic_search_runtime', max: 4 });
    ownedPools.push(searchPool);
    const searchEvents = createEventRepository(searchPool, 'synthetic_host_search');
    registerSearchRoute(app, auth, {
      operation: { execute: (request) => searchEvents.executeSearch(request) },
      logHash: { version: 'hmac-log-v1', key: 'synthetic-host-log-hash-material-0001' },
      idempotencyHmac: { currentVersion: 'hmac-idempotency-v1',
        keys: { 'hmac-idempotency-v1': 'synthetic-host-idempotency-material-0001' } },
    });
    app.get('/v1/notices/current', async (request, reply) => {
      if (!(await authenticateRequestHeaders(auth!, request.headers))) return reply.code(401).send();
      return reply.code(410).send({ error: { code: 'GONE', message: 'No notice in the synthetic fixture' } });
    });
    const store = createContentObjectStore(path.join(pg.root, 'objects'));
    const report = (id: string, error: unknown) => { diagnostics.push({ id, reason: error instanceof IntakeRejection ? error.reason : 'UNEXPECTED' }); };
    const usage = createContentIntakeService(usagePool, store, report, undefined, { requireProductSession: true });
    await app.register(contentIntakeUsageRoutes, { auth, usage, report });
    await app.register(contentIntakeManagementRoutes, { auth, pool, store, report, ...(terminalPool ? { terminalPool } : {}),
      // Every principal that can appear in the grant-recipient directory needs a label, or the
      // directory fails closed. The roster identities are added here for that reason only.
      principalLabels: ({ tenantId, appId, principalId }) => tenantId === 'tenant-a' && appId === 'app-a'
        ? INTAKE_SYNTHETIC_IDENTITIES.find(([id]) => id === principalId)?.[2]
          ?? (principalId === 'roster-director' ? '合成名单总监'
            : principalId === 'roster-readonly' ? '合成只读总监'
            : null)
        : null });
    apiOrigin = await app.listen({ host: '127.0.0.1', port: 0 });
    let prepared: { candidate: C['IntakeCandidate']; object: C['IntakeObject'] } | null = null;
    if (prepareCandidate) {
      const workbook = inputFormat === 'csv' ? createIntakeSyntheticCsv({ domain }) : await createIntakeSyntheticWorkbook({ domain });
      const form = new FormData(); form.set('operationId', 'synthetic-prepare-upload'); form.set('file', new Blob([new Uint8Array(workbook)], {
        type: inputFormat === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }), `synthetic-faq.${inputFormat}`);
      const checkedJson = async (response: Response, label: string) => {
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(`Synthetic ${label} failed (${response.status}): ${JSON.stringify(body)}`);
        return body;
      };
      const uploaded = parseContractSchema('IntakeObject', await checkedJson(await requestAs('enabler', '/v1/intake/sources/source-a/objects', { method: 'POST', body: form }), 'upload'));
      const receive = await requestAs('enabler', '/v1/intake/sources/source-a/candidates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        operationId: 'synthetic-prepare-receive', objectId: uploaded.objectId, sourceVersion: 1, baseReleaseId: 'rel_native_base',
        contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null,
      }) });
      let job = parseContractSchema('IntakeParseJob', await checkedJson(receive, 'receive'));
      const deadline = Date.now() + 20_000;
      while (job.state === 'reading' || job.state === 'parsing') {
        if (Date.now() >= deadline) throw new Error('Synthetic parser did not settle');
        await new Promise(resolve => setTimeout(resolve, 20));
        job = parseContractSchema('IntakeParseJob', await checkedJson(await requestAs('enabler', `/v1/intake/parse-jobs/${job.jobId}`), 'parse'));
      }
      if (job.state !== 'validated') throw new Error(`Synthetic parsing failed: ${JSON.stringify(job.issues)}`);
      const candidate = parseContractSchema('IntakeCandidate', await checkedJson(await requestAs('enabler', `/v1/intake/candidates/${job.candidateId}/versions/${job.candidateVersion}`), 'candidate'));
      prepared = { candidate, object: uploaded };
    }
    const facts = await admin.query('SELECT min(valid_until) AS expires FROM content_intake.principal_facts');
    return {
      apiOrigin, identityOrigin, root: pg.root, expiresAt: (facts.rows[0].expires as Date).toISOString(),
      candidate: prepared?.candidate ?? null, object: prepared?.object ?? null, requestAs,
      selectIdentity(value: DesktopSyntheticIdentity) {
        if (!['director', 'enabler', 'reviewer', 'agent', 'roster-director', 'roster-readonly', 'roster-stale'].includes(value)) throw new Error('Unknown synthetic identity'); selectedIdentity = value;
      },
      /** Revoke one principal's live query grant. The grant history is append-only, so this
       * is a versioned revoke rather than a delete, exactly like the product path. */
      async revokeQueryFor(principalId: string) {
        if (closed) throw new Error('Synthetic host is closed');
        const revoked = await admin!.query(
          `UPDATE content_intake.grants
             SET version = version + 1, revoked_at = clock_timestamp(),
                 last_change_reason = 'synthetic lane revoke'
           WHERE recipient_id = $1 AND action = 'query' AND revoked_at IS NULL
           RETURNING grant_id`, [principalId]);
        return revoked.rowCount ?? 0;
      },
      /** Close one principal's facts window without waiting out its lease. Fact history is
       * append-only, so this appends a new version whose window has already passed and points
       * the principal at it, which is what a real refresh would have produced. */
      async expireFactsFor(principalId: string) {
        if (closed) throw new Error('Synthetic host is closed');
        const current = await admin!.query<{ current_facts_version: string }>(
          'SELECT current_facts_version FROM content_intake.principals WHERE principal_id = $1', [principalId]);
        const version = Number(current.rows[0]?.current_facts_version);
        if (!Number.isSafeInteger(version) || version < 1) return false;
        await admin!.query('BEGIN');
        try {
          await admin!.query(`INSERT INTO content_intake.principal_facts(
              principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest)
            VALUES ($1, $2, ARRAY['dept-a'], 'job-customer-service-director', true,
              statement_timestamp()-interval '4 minutes', statement_timestamp()-interval '1 minute', repeat('a',64))
            ON CONFLICT (principal_id, facts_version) DO NOTHING`, [principalId, version + 1]);
          await admin!.query(
            'UPDATE content_intake.principals SET current_facts_version = $2 WHERE principal_id = $1',
            [principalId, version + 1]);
          await admin!.query('COMMIT');
          return true;
        } catch (error) {
          await admin!.query('ROLLBACK').catch(() => undefined);
          throw error;
        }
      },
      async revokeSyntheticQuery() {
        if (closed || profile !== 'purpose-runtime') throw new Error('Synthetic runtime control unavailable');
        await admin!.query(`UPDATE content_intake.grants SET version=version+1,revoked_at=clock_timestamp(),last_change_reason='synthetic acceptance revoke'
          WHERE grant_id='business-agent-query' AND revoked_at IS NULL`);
      },
      resources() { return { closed, identityListening: identity.listening, poolConnections: ownedPools.map(pool => pool.totalCount) }; },
      async status() {
        const current = await admin!.query('SELECT current_release_id FROM public.content_current WHERE id=1');
        const published = await admin!.query('SELECT count(*)::integer AS count FROM content_intake.publications');
        const evidence=await admin!.query(`SELECT (SELECT count(*)::integer FROM content_intake.review_bindings) AS bindings,
          (SELECT count(*)::integer FROM content_intake.approval_facts) AS facts,
          (SELECT count(*)::integer FROM content_intake.publications WHERE publication_policy='direct-v1') AS direct,
          (SELECT count(*)::integer FROM content_intake.review_bindings r LEFT JOIN content_intake.approval_current c USING(review_request_id)
            LEFT JOIN content_intake.approval_facts f USING(review_request_id,facts_version) WHERE f.state IS DISTINCT FROM 'approved') AS pending`);
        return { profile, domain, inputFormat, purposeQueries: { ...purposeQueries }, currentReleaseId: current.rows[0].current_release_id as string, publications: published.rows[0].count as number,
          pendingApprovals: evidence.rows[0].pending as number, reviewBindings: evidence.rows[0].bindings as number,
          approvalFacts: evidence.rows[0].facts as number, directPublications: evidence.rows[0].direct as number,
          diagnostics: [...diagnostics], requests: [...requests] };
      },
      close,
    };
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Synthetic host startup and cleanup failed'); }
    throw error;
  }
}

export type IntakeSyntheticHost = Awaited<ReturnType<typeof createIntakeSyntheticHost>>;
export type IntakeSyntheticCandidate = C['IntakeCandidate'];
