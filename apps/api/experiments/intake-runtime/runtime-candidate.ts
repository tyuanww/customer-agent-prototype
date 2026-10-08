import path from 'node:path';
import Fastify from 'fastify';
import { parseContractSchema } from '@customer-agent/contracts';
import type { ProductAuthService } from '../../src/auth-service.js';
import { registerAuthRoutes } from '../../src/auth-routes.js';
import { createProductAuthService, type SyntheticIdentityProvider } from '../../src/product-auth-service.js';
import { registerProductAuthRoutes } from '../../src/product-auth-routes.js';
import { createContentObjectStore } from '../../src/content-object-store.js';
import { createContentIntakeService } from '../../src/content-intake/service.js';
import { createIntakePurposePool, type IntakePurpose, type IntakePurposePool } from '../../src/content-intake/runtime-pool.js';
import { contentIntakeUsageRoutes } from '../../src/content-intake/usage-http.js';
import { contentIntakeManagementRoutes } from '../../src/content-intake/management-http.js';
import { createRegisteredOrganizationRefresh, type RegisteredObservation } from '../../src/content-intake/organization/registered-refresh.js';
import { createOrganizationHttpSessionOwner, createOrganizationHttpTransport, type OrganizationTokenSupplier } from '../intake-organization/http-transport.js';

const purposes = ['business', 'usage', 'worker', 'organization'] as const;
type Scope = { tenantId: string; appId: string };
export type RuntimeCandidateConfig = {
  profile: 'synthetic-candidate';
  scope: Scope;
  /** Explicit local disposable PostgreSQL only; no environment or pg defaults. */
  database: { host: string; port: number; database: string; logins: Record<IntakePurpose | 'auth', string> };
  objectRoot: string;
  identity: Scope & { provider: SyntheticIdentityProvider };
  organization: Scope & { origin: string; tokenSupplier: OrganizationTokenSupplier };
};

/** Validate the complete candidate before acquiring resources. No production mode or remote database is accepted. Identity callbacks are
 * trusted test injections, not independently attested provider capabilities. */
function checked(config: RuntimeCandidateConfig): RuntimeCandidateConfig {
  if (!config || config.profile !== 'synthetic-candidate') throw new Error('INTAKE_CANDIDATE_DISABLED');
  const scope = { tenantId: parseContractSchema('IntakeId', config.scope?.tenantId), appId: parseContractSchema('IntakeId', config.scope?.appId) };
  const db = config.database;
  if (!db || !path.isAbsolute(db.host) || !Number.isSafeInteger(db.port) || db.port < 1 || db.port > 65535
    || typeof db.database !== 'string' || !/^[a-zA-Z0-9_]{1,63}$/.test(db.database)
    || !db.logins || Object.keys(db.logins).sort().join() !== [...purposes, 'auth'].sort().join()
    || Object.values(db.logins).some(value => typeof value !== 'string' || !/^[a-zA-Z0-9_]{1,63}$/.test(value))
    || new Set(Object.values(db.logins)).size !== 5) throw new Error('INTAKE_CANDIDATE_DATABASE');
  if (typeof config.objectRoot !== 'string' || !path.isAbsolute(config.objectRoot)) throw new Error('INTAKE_CANDIDATE_OBJECT_ROOT');
  for (const input of [config.identity, config.organization]) {
    if (!input || input.tenantId !== scope.tenantId || input.appId !== scope.appId) throw new Error('INTAKE_CANDIDATE_SCOPE');
  }
  if (typeof config.identity.provider?.authorizeUrl !== 'function' || typeof config.identity.provider?.exchange !== 'function'
    || typeof config.identity.provider?.close !== 'function' || typeof config.organization.tokenSupplier?.current !== 'function') {
    throw new Error('INTAKE_CANDIDATE_PROVIDER');
  }
  const origin = new URL(config.organization.origin);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.pathname !== '/'
    || origin.username || origin.password || origin.search || origin.hash) throw new Error('INTAKE_CANDIDATE_ORIGIN');
  return { ...config, scope, database: { ...db, logins: { ...db.logins } },
    identity: { ...config.identity }, organization: { ...config.organization, origin: origin.origin } };
}

/** One candidate owner for admission, HTTP queue shutdown, shared organization
 * token/quota state and five independently restricted pools. The production
 * app/server and API package never import this experiment. Callers first install
 * the frozen schema and trusted synthetic bindings; this owner never provisions
 * identities, grants, roles, migration or legacy adoption.
 *
 * Directly adding a mode to server.ts would mix the existing legacy API pool and
 * startup order with four-purpose resources before production is approved. This
 * isolated owner reuses the route/transaction owners without changing that entry.
 * Synthetic provider injection is NOT proof of a real tenant or trusted registrar.
 */
export async function startIntakeRuntimeCandidate(raw: RuntimeCandidateConfig,
  report: (diagnosticId: string, error: unknown) => void = () => undefined) {
  const config = checked(raw);
  const pools = {} as Record<IntakePurpose, IntakePurposePool>;
  const app = Fastify({ logger: false, exposeHeadRoutes: false, routerOptions: { maxParamLength: 128 } });
  const stopping = new AbortController();
  const tasks = new Set<Promise<unknown>>();
  let auth: ProductAuthService | undefined;
  let closed = false, providerClosed = false;
  let closing: Promise<void> | undefined;
  const providerCloseErrors: unknown[] = [];
  const provider: SyntheticIdentityProvider = {
    authorizeUrl: state => config.identity.provider.authorizeUrl(state),
    exchange: code => config.identity.provider.exchange(code),
    close() {
      if (providerClosed) return;
      providerClosed = true;
      // The existing auth owner ends its pool after this synchronous callback.
      // A provider failure must not skip that end(), including failed admission
      // before auth is assigned. Surface it after all owned resources drain.
      try { config.identity.provider.close(); } catch (error) { providerCloseErrors.push(error); }
    },
  };
  const organizationSessions = createOrganizationHttpSessionOwner({
    supplier: () => config.organization.tokenSupplier, tokenTimeoutMs: 2_000,
  });
  function own<T>(operation: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error('INTAKE_CANDIDATE_CLOSED'));
    const task = Promise.resolve().then(() => {
      if (closed) throw new Error('INTAKE_CANDIDATE_CLOSED');
      return operation();
    });
    tasks.add(task); void task.then(() => tasks.delete(task), () => tasks.delete(task));
    return task;
  }
  function close(): Promise<void> {
    if (closing) return closing;
    closed = true; stopping.abort(); organizationSessions.close();
    closing = (async () => {
      // Close/settle HTTP and observations before draining pools. Every owner is
      // closed even if another owner's close fails; original startup error wins.
      const stopped = await Promise.allSettled([app.close(), ...tasks]);
      const released = await Promise.allSettled([
        Promise.resolve().then(() => auth ? auth.close() : provider.close()),
        ...Object.values(pools).map(pool => pool.end()),
      ]);
      const failures = [...stopped.slice(0, 1), ...released].filter(item => item.status === 'rejected');
      const errors = [...failures.map(item => item.reason), ...providerCloseErrors];
      if (errors.length) throw new AggregateError(errors, 'INTAKE_CANDIDATE_CLOSE_FAILED');
    })();
    return closing;
  }
  try {
    for (const purpose of purposes) {
      pools[purpose] = createIntakePurposePool({ host: config.database.host, port: config.database.port,
        database: config.database.database, user: config.database.logins[purpose], password: 'synthetic-candidate-only', ssl: false, max: 2,
        connectionTimeoutMillis: 2_000, statement_timeout: 5_000, query_timeout: 6_000,
        idle_in_transaction_session_timeout: 10_000 }, purpose, error => report('intake_pool', error));
      const client = await pools[purpose].connect(); client.release();
    }
    const authUrl = new URL(`postgresql://localhost/${config.database.database}`);
    authUrl.username = config.database.logins.auth; authUrl.password = 'synthetic-candidate-only';
    authUrl.search = new URLSearchParams({ host: config.database.host, port: String(config.database.port) }).toString();
    auth = await createProductAuthService({ connectionString: authUrl.href, poolMax: 2,
      connectionTimeoutMs: 2_000, readinessTimeoutMs: 3_000 }, provider, 'mock');
    const store = createContentObjectStore(config.objectRoot);
    if (await store.readiness() !== 'ok') throw new Error('INTAKE_CANDIDATE_STORAGE');
    const refresh = createRegisteredOrganizationRefresh(pools.organization, config.scope, createOrganizationHttpTransport({
      origin: config.organization.origin, requestTimeoutMs: 2_000, session: organizationSessions.session(config.scope),
    }));
    registerProductAuthRoutes(app, auth); registerAuthRoutes(app, auth);
    const productAuth = auth;
    // The OAuth callback owns code -> trusted subject binding -> user_id. Intake
    // additionally requires that user's live registration in this assembly scope.
    // Preserve the exact private actor object; the existing transaction rechecks
    // session, current facts and authority, rather than trusting this admission.
    const intakeAuth: ProductAuthService = { ...productAuth, async authenticate(credentials) {
      const actor = await productAuth.authenticate(credentials);
      if (!actor || closed) return null;
      const client = await pools.organization.connect();
      try {
        const registered = await client.query(`SELECT 1 FROM content_intake.principals p
          JOIN intake_organization.current_bindings c USING(tenant_id,app_id,principal_id)
          JOIN intake_organization.bindings b USING(tenant_id,app_id,principal_id,binding_version)
          WHERE p.user_id=$1 AND p.tenant_id=$2 AND p.app_id=$3 AND b.enabled AND b.valid_until>clock_timestamp()`,
        [actor.user_id, config.scope.tenantId, config.scope.appId]);
        return !closed && registered.rowCount === 1 ? actor : null;
      } finally { client.release(); }
    } };
    const usage = createContentIntakeService(pools.usage, store, report, undefined, { requireProductSession: true });
    await app.register(contentIntakeUsageRoutes, { auth: intakeAuth, usage, report });
    await app.register(contentIntakeManagementRoutes, { auth: intakeAuth, pool: pools.business, terminalPool: pools.worker, store, report });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    return Object.freeze({ address, profile: 'synthetic-candidate' as const, runtimeActivated: false as const, close,
      /** Trusted local control, never an HTTP route. Retain the returned immutable
       * observation for write retry; a new observation is not commit recovery. */
      observe: (principalId: string) => own(() => refresh.observe(principalId, stopping.signal)),
      write: (observation: RegisteredObservation) => own(() => refresh.write(observation)),
    });
  } catch (error) {
    try { await close(); } catch { /* Preserve startup refusal; every resource was offered cleanup. */ }
    throw error;
  }
}
