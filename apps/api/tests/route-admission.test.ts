import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApiApp } from '../src/app.js';
import { parseApiRuntimeConfig } from '../src/runtime-config.js';
import { unavailableContentImportRepository } from '../src/content-import-repository.js';
import type { ServiceReadinessChecks, ServicePolicyFlags, ServiceRepository } from '../src/service-repository.js';

/** Routes reachable without a session. Each entry is `METHOD path`; anything not listed
 *  here must refuse an anonymous caller. Keep this list literal: a wildcard would let a
 *  newly added public route pass unnoticed, which is the failure this check exists for. */
const PUBLIC_ROUTES = Object.freeze([
  'GET /health',
  'GET /ready',
  // Mock auth exists only in test profiles; the product login routes replace it there.
  'POST /v1/auth/mock-login',
]);

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

describe('route admission', () => {
  const openApps: FastifyInstance[] = [];
  afterEach(async () => {
    await Promise.all(openApps.splice(0).map(async (app) => app.close()));
  });

  it('refuses an anonymous caller on every route that is not explicitly public', async () => {
    const app = createApiApp(parseApiRuntimeConfig({
      CUSTOMER_AGENT_PROFILE: 'test',
      AUTH_MODE: 'mock',
      CUSTOMER_AGENT_API_PORT: '0',
      CUSTOMER_AGENT_BUILD_VERSION: '0.2.0-route-admission',
    }), stubRepository());
    openApps.push(app);
    await app.ready();

    const routes = registeredRoutes(app);
    // A parser or registration regression must not turn this check into a no-op.
    expect(routes.length).toBeGreaterThan(20);

    const publicSet = new Set(PUBLIC_ROUTES);
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
    for (const entry of PUBLIC_ROUTES) {
      if (!routes.some(route => `${route.method} ${route.path}` === entry)) {
        unexpected.push(`stale allowlist entry: ${entry}`);
      }
    }
    expect({ unguarded, unexpected }).toEqual({ unguarded: [], unexpected: [] });
  });

  it('keeps the public allowlist free of anything that mutates state', async () => {
    // A public route that writes would be a worse defect than a missing 401, and reviewers
    // read the allowlist as the complete public surface.
    const mutating = PUBLIC_ROUTES.filter(entry => !entry.startsWith('GET '));
    expect(mutating).toEqual(['POST /v1/auth/mock-login']);
  });
});
