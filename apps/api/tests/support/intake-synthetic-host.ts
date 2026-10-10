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
import { authenticateRequestHeaders } from '../../dist/auth-service.js';
import { createContentObjectStore } from '../../dist/content-object-store.js';
import { createContentIntakeService } from '../../dist/content-intake/service.js';
import { contentIntakeManagementRoutes } from '../../dist/content-intake/management-http.js';
import { contentIntakeUsageRoutes } from '../../dist/content-intake/usage-http.js';
import { IntakeRejection, type IntakePool } from '../../dist/content-intake/transaction.js';
import { createIntakePurposePool, type IntakePurposePool } from '../../dist/content-intake/runtime-pool.js';
import { createRegisteredOrganizationRefresh } from '../../dist/content-intake/organization/registered-refresh.js';
import { nativeOrganizationFixture } from './intake-organization-native.ts';
import { seedIntakeSyntheticDirectory } from './intake-synthetic-directory.ts';
import { INTAKE_SYNTHETIC_IDENTITIES, seedIntakeSyntheticHost } from './intake-synthetic-seed.ts';

type C = components['schemas'];
export type IntakeSyntheticDomain = 'product' | 'campaign' | 'presale' | 'aftersale';
export type IntakeSyntheticIdentity = 'director' | 'enabler' | 'reviewer' | 'agent';
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
export function createIntakeSyntheticHost(options: { prepareCandidate: false; profile?: SyntheticProfile; domain?: IntakeSyntheticDomain; duplicateShopNames?: boolean; inputFormat?: 'xlsx' | 'csv' }): Promise<HostState>;
export function createIntakeSyntheticHost(options?: { prepareCandidate?: true; profile?: SyntheticProfile; domain?: IntakeSyntheticDomain; duplicateShopNames?: boolean; inputFormat?: 'xlsx' | 'csv' }): Promise<PreparedHost>;
export function createIntakeSyntheticHost(options?: { prepareCandidate?: boolean; profile?: SyntheticProfile; domain?: IntakeSyntheticDomain; duplicateShopNames?: boolean; inputFormat?: 'xlsx' | 'csv' }): Promise<HostState> {
  return startIntakeSyntheticHost(options?.prepareCandidate !== false, options?.profile ?? 'existing', options?.domain ?? 'product', options?.duplicateShopNames ?? false, options?.inputFormat ?? 'xlsx');
}

/** Fresh Unix-socket PG15 + real product-session/HTTP modules. No environment
 * files, existing DB, production factory or real provider is ever consumed.
 * The returned control methods are local test/terminal controls, not HTTP
 * administrative routes. Synthetic data disappears on close; no approval provider is installed. */
async function startIntakeSyntheticHost(prepareCandidate: boolean, profile: SyntheticProfile, domain: IntakeSyntheticDomain, duplicateShopNames: boolean, inputFormat: 'xlsx' | 'csv') {
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
  let apiOrigin = '', identityOrigin = '', selectedIdentity: IntakeSyntheticIdentity = 'enabler';
  const loginCodes = new Map<string, { binding: IntakeSyntheticIdentity; expires: number }>();
  const sessions = new Map<IntakeSyntheticIdentity, string>();
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
  function issueCode(binding: IntakeSyntheticIdentity) {
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
  async function requestAs(actor: IntakeSyntheticIdentity, pathname: string, options: RequestInit = {}) {
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
    admin = await pg.connect(database.config); await applyDatabaseMigrations(admin); await seedIntakeSyntheticHost(admin, domain, inputFormat); await seedIntakeSyntheticDirectory(admin, { duplicateShopNames });
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
    registerProductAuthRoutes(app, auth); registerAuthRoutes(app, auth);
    app.get('/v1/notices/current', async (request, reply) => {
      if (!(await authenticateRequestHeaders(auth!, request.headers))) return reply.code(401).send();
      return reply.code(410).send({ error: { code: 'GONE', message: 'No notice in the synthetic fixture' } });
    });
    const store = createContentObjectStore(path.join(pg.root, 'objects'));
    const report = (id: string, error: unknown) => { diagnostics.push({ id, reason: error instanceof IntakeRejection ? error.reason : 'UNEXPECTED' }); };
    const usage = createContentIntakeService(usagePool, store, report, undefined, { requireProductSession: true });
    await app.register(contentIntakeUsageRoutes, { auth, usage, report });
    await app.register(contentIntakeManagementRoutes, { auth, pool, store, report, ...(terminalPool ? { terminalPool } : {}),
      principalLabels: ({ tenantId, appId, principalId }) => tenantId === 'tenant-a' && appId === 'app-a'
        ? INTAKE_SYNTHETIC_IDENTITIES.find(([id]) => id === principalId)?.[2] ?? null : null });
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
      selectIdentity(value: IntakeSyntheticIdentity) {
        if (!['director', 'enabler', 'reviewer', 'agent'].includes(value)) throw new Error('Unknown synthetic identity'); selectedIdentity = value;
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
