import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApiApp } from '../src/app.js';
import type { ProductAuthService } from '../src/auth-service.js';
import { parseApiRuntimeConfig } from '../src/runtime-config.js';
import { unavailableContentImportRepository } from '../src/content-import-repository.js';
import type { ServiceReadinessChecks, ServicePolicyFlags, ServiceRepository } from '../src/service-repository.js';

/** Routes reachable without a session. Each entry is `METHOD path`; anything not listed
 *  here must refuse an anonymous caller. Keep this list literal: a wildcard would let a
 *  newly added public route pass unnoticed, which is the failure this check exists for. */
const BASE_PUBLIC = ['GET /health', 'GET /ready'];
/** Mock auth exists only in test profiles. */
const MOCK_PUBLIC = Object.freeze([...BASE_PUBLIC, 'POST /v1/auth/mock-login']);
/** The product login handshake is reachable without a session by construction: it is how a
 *  session is created. Each one refuses a malformed body with 400 rather than 401. */
const PRODUCT_PUBLIC = Object.freeze([
  ...BASE_PUBLIC,
  'POST /v1/auth/login-requests',
  'POST /v1/auth/login-requests/:login_id/exchange',
  'GET /v1/auth/callback',
]);

/** The only public routes allowed to write, per profile. Naming them keeps the list honest:
 *  any other mutating public route fails rather than joining a wildcard. */
const PUBLIC_WRITES = Object.freeze({
  mock: ['POST /v1/auth/mock-login'],
  product: [
    'POST /v1/auth/login-requests',
    'POST /v1/auth/login-requests/:login_id/exchange',
  ],
});

const NOT_READY: ServiceReadinessChecks = Object.freeze({
  database: 'ok', schema: 'ok', auth: 'not_ready', storage: 'not_ready', content: 'not_ready',
});

const POLICY_OFF: ServicePolicyFlags = Object.freeze({
  rewrite: false, auto_send: false, autofill_adapter: false, llm_ranker: false,
  metrics_experimental_kpi: false,
});

function stubRepository(): ServiceRepository {
  return {
    readiness: vi.fn<ServiceRepository['readiness']>().mockResolvedValue(NOT_READY),
    readPolicyFlags: vi.fn<ServiceRepository['readPolicyFlags']>().mockResolvedValue(POLICY_OFF),
    searchCandidates: vi.fn<ServiceRepository['searchCandidates']>()
      .mockResolvedValue(Object.freeze({ ok: false, code: 'SOURCE_GATE_NOT_READY' })),
    executeSearch: vi.fn<ServiceRepository['executeSearch']>()
      .mockResolvedValue(Object.freeze({ ok: false, code: 'OVERLOADED' })),
    recordAdoption: vi.fn<ServiceRepository['recordAdoption']>()
      .mockResolvedValue(Object.freeze({ ok: false, code: 'OVERLOADED' })),
    recordEscalation: vi.fn<ServiceRepository['recordEscalation']>()
      .mockResolvedValue(Object.freeze({ ok: false, code: 'OVERLOADED' })),
    contentImport: unavailableContentImportRepository(),
    close: vi.fn<ServiceRepository['close']>().mockResolvedValue(undefined),
  };
}

/** `printRoutes({ commonPrefix: false })` prints a prefix tree, one `name (METHODS)` node
 *  per line, nested under the longest shared path prefix. Rebuild absolute paths by
 *  accumulating the ancestor at depth-1; a node's own text is only a suffix. This is the
 *  only stable way Fastify exposes its table after registration. */
export function registeredRoutes(app: FastifyInstance): { method: string; path: string }[] {
  const printed = app.printRoutes({ commonPrefix: false, includeHooks: false });
  const stack: string[] = [];
  const routes: { method: string; path: string }[] = [];
  for (const line of printed.split('\n')) {
    const marker = line.search(/[├└]── /);
    if (marker < 0 || marker % 4 !== 0) continue;
    const match = /^(.*?) \(([A-Z, ]+)\)$/.exec(line.slice(marker + 4));
    if (!match) continue;
    const depth = marker / 4;
    const path = (depth > 0 ? stack[depth - 1] ?? '' : '') + match[1]!.trim();
    stack[depth] = path;
    stack.length = depth + 1;
    for (const method of match[2]!.split(',').map(value => value.trim())) {
      routes.push({ method, path });
    }
  }
  return routes;
}

const concrete = (path: string): string => path.replace(/:[A-Za-z0-9_]+/g, 'probe');

/** The intake and product-auth routes only register when a product identity service and intake
 *  dependencies are present. They are the most sensitive ones (`grants` writes, publish,
 *  rollback, usage reads), so the sweep has to see them. Nothing here reaches the database: an
 *  anonymous caller is refused by the boundary hook before a handler runs. */
function anonymousProductAuth(): ProductAuthService {
  return {
    kind: 'product',
    authenticate: async () => null,
    readiness: () => 'ok' as const,
    close: () => undefined,
    createLogin: vi.fn(),
    callback: vi.fn(async () => null),
    exchange: async () => null,
    issueBoundSession: vi.fn(),
    logout: async () => undefined,
  } as unknown as ProductAuthService;
}

function unreachablePool(): never {
  return {
    connect: async () => { throw new Error('route admission must not reach the database'); },
    end: async () => undefined,
    totalCount: 0,
  } as never;
}

const INTAKE_DEPENDENCIES = Object.freeze({
  business: unreachablePool(),
  usage: unreachablePool(),
  worker: unreachablePool(),
  store: {
    persist: async () => { throw new Error('unreachable'); },
    readPayload: async () => { throw new Error('unreachable'); },
    verify: async () => false,
    writeReceipt: async () => undefined,
    readReceipt: async () => null,
    reclaim: async () => 'reclaimed' as const,
    readiness: async () => 'not_ready' as const,
    rootDirectory: '/tmp/unused',
  },
});

describe('route admission', () => {
  const openApps: FastifyInstance[] = [];
  afterEach(async () => {
    await Promise.all(openApps.splice(0).map(async (app) => app.close()));
  });

  it.each([
    { profile: 'mock' as const, allowlist: MOCK_PUBLIC, intakeRoutes: false },
    { profile: 'product' as const, allowlist: PRODUCT_PUBLIC, intakeRoutes: true },
  ])('refuses an anonymous caller on every route that is not explicitly public ($profile profile)', async ({ profile, allowlist, intakeRoutes }) => {
    const product = profile === 'product';
    const app = createApiApp(parseApiRuntimeConfig({
      CUSTOMER_AGENT_PROFILE: 'test',
      AUTH_MODE: 'mock',
      ...(product ? { AUTH_SESSION_MODE: 'product' } : {}),
      CUSTOMER_AGENT_API_PORT: '0',
      CUSTOMER_AGENT_BUILD_VERSION: '0.2.0-route-admission',
    }), stubRepository(),
    /* diagnosticSink */ undefined, /* providedAuthService */ product ? anonymousProductAuth() : undefined,
    /* policyAdmin */ undefined, /* search */ undefined, /* event */ undefined,
    /* contentImport */ undefined, /* contentReview */ undefined, /* contentRelease */ undefined,
    /* announce */ undefined, /* iterationTask */ undefined, /* opsLoop */ undefined,
    /* accessLog */ undefined, /* notice */ undefined,
    /* intakeDependencies */ product ? INTAKE_DEPENDENCIES : undefined);
    openApps.push(app);
    await app.ready();

    const routes = registeredRoutes(app);
    // A parser or registration regression must not turn this check into a no-op.
    expect(routes.length).toBeGreaterThan(20);
    // The intake routes are the sensitive half. In the product profile their absence would
    // mean this sweep silently covers nothing there, so it fails rather than skips.
    if (intakeRoutes) {
      expect(routes.filter(({ path }) => path.startsWith('/v1/intake/')).length).toBeGreaterThan(20);
    }

    const publicSet = new Set(allowlist);
    const unexpected: string[] = [];
    const unguarded: string[] = [];
    for (const { method, path } of routes) {
      const key = `${method} ${path}`;
      if (publicSet.has(key)) continue;
      if (method !== 'GET' && method !== 'HEAD' && method !== 'POST'
        && method !== 'PATCH' && method !== 'PUT' && method !== 'DELETE') continue;
      // No authorization header and no body: the refusal must come from admission, not
      // from body validation, which is why the expected status is exactly 401.
      const response = await app.inject({ method: method as 'GET', url: concrete(path) });
      if (response.statusCode !== 401) unguarded.push(`${key} -> ${response.statusCode}`);
    }
    // Routes registered here that are not in the whitelist but do refuse are fine only if
    // they are listed; surface any whitelist entry that no longer exists as a stale entry.
    for (const entry of allowlist) {
      if (!routes.some(route => `${route.method} ${route.path}` === entry)) {
        unexpected.push(`stale allowlist entry: ${entry}`);
      }
    }
    expect({ unguarded, unexpected }).toEqual({ unguarded: [], unexpected: [] });
  });

  it.each([
    { profile: 'mock' as const, allowlist: MOCK_PUBLIC },
    { profile: 'product' as const, allowlist: PRODUCT_PUBLIC },
  ])('keeps the public allowlist free of anything that mutates state ($profile profile)', ({ profile, allowlist }) => {
    // A public route that writes would be a worse defect than a missing 401, and reviewers
    // read the allowlist as the complete public surface. Only the named login handshake may
    // write; anything else appearing here has to be argued for explicitly.
    const mutating = allowlist.filter(entry => !entry.startsWith('GET '));
    expect([...mutating].sort()).toEqual([...PUBLIC_WRITES[profile]].sort());
  });
});
