import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createBoundedDenialAudit } from '../src/access/audit.js';
import { installAccessAdmission } from '../src/access/admission.js';
import {
  createAccessEvaluator,
  type AccessEvaluation,
  type AccessSnapshot,
} from '../src/access/evaluator.js';
import { registerAccessRoutes } from '../src/access/routes.js';
import { createMockAuthService } from '../src/auth-service.js';

const at = '2026-11-05T10:00:00Z';

function snapshot(allowed: boolean): AccessSnapshot {
  return {
    present: true,
    principalId: 'principal-1',
    tenantId: 'tenant-1',
    appId: 'app-1',
    factsVersion: 1,
    revocationGeneration: allowed ? 0 : 1,
    policyVersion: 1,
    storeSetVersion: 1,
    facts: {
      enabled: true,
      checkedAt: at,
      validUntil: '2026-11-05T10:04:00Z',
    },
    roles: ['director'],
    roleActions: ['query', 'publish'],
    mayAllocate: false,
    accountsManage: {
      allowed,
      validUntil: allowed ? '2026-11-05T10:03:00Z' : null,
    },
    allowedSources: allowed ? [{
      scope: {
        kind: 'source',
        tenantId: 'tenant-1',
        appId: 'app-1',
        brandId: 'brand-1',
        shopId: 'shop-1',
        domain: 'product',
        sourceId: 'source-1',
      } as AccessSnapshot['allowedSources'][number]['scope'],
      action: 'query',
      validUntil: '2026-11-05T10:03:00Z',
    }] : [],
    allocationSources: [],
    evidence: {
      revokedGrant: !allowed,
      expiredGrant: false,
      sourceOutsideSet: false,
      storeSetChanged: false,
    },
    revisionSeed: `seed-${allowed ? 'allowed' : 'denied'}`,
    resolvedAt: at,
  };
}

describe('access admission', () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('allows the declared action and denies a different action without disclosing the route resource', async () => {
    const app = Fastify({ logger: false, exposeHeadRoutes: false });
    apps.push(app);
    const auth = createMockAuthService();
    const evaluator = createAccessEvaluator(async () => snapshot(true));
    installAccessAdmission(app, {
      authService: auth,
      evaluator,
      profile: 'mock',
      assertPublicRoutes: false,
    });
    app.get('/health', async () => ({ ok: true }));
    app.post('/v1/search', async () => ({ found: 'source-1' }));
    app.post('/v1/content/publish', async () => ({ published: true }));
    await app.ready();
    const token = auth.createMockSession({ user_id: 'user-1', role: 'owner' }).token;
    const headers = { authorization: `Bearer ${token}` };

    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/v1/search', headers })).json())
      .toEqual({ found: 'source-1' });
    const denied = await app.inject({ method: 'POST', url: '/v1/content/publish', headers });
    expect(denied.statusCode).toBe(403);
    expect(denied.body).not.toContain('source-1');
    expect(denied.body).not.toContain('tenant-1');
  });

  it('keeps an admitted handler running but rejects every new request after revocation', async () => {
    const app = Fastify({ logger: false, exposeHeadRoutes: false });
    apps.push(app);
    const auth = createMockAuthService();
    let revoked = false;
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const evaluations: AccessEvaluation[] = [];
    const evaluator = createAccessEvaluator(async () => {
      const value = snapshot(!revoked);
      return value;
    });
    installAccessAdmission(app, {
      authService: auth,
      evaluator,
      profile: 'mock',
      assertPublicRoutes: false,
    });
    app.post('/v1/search', async () => {
      await blocked;
      return { admitted: true };
    });
    await app.ready();
    const token = auth.createMockSession({ user_id: 'user-1', role: 'owner' }).token;
    const headers = { authorization: `Bearer ${token}` };
    const admitted = app.inject({ method: 'POST', url: '/v1/search', headers });
    await new Promise((resolve) => setTimeout(resolve, 5));
    revoked = true;
    const late = await app.inject({ method: 'POST', url: '/v1/search', headers });
    expect(late.statusCode).toBe(403);
    release();
    expect((await admitted).json()).toEqual({ admitted: true });
    evaluations.push(await evaluator.evaluate('user-1'));
    expect(evaluations[0]?.denyReason).toBe('REVOKED_GRANT');
  });

  it('fails closed for unknown declarations, stale sessions, and bounded duplicate denial audit', async () => {
    const unknown = Fastify({ logger: false, exposeHeadRoutes: false });
    apps.push(unknown);
    const auth = createMockAuthService();
    installAccessAdmission(unknown, {
      authService: auth,
      evaluator: createAccessEvaluator(async () => snapshot(true)),
      profile: 'mock',
      assertPublicRoutes: false,
    });
    expect(() => unknown.get('/v1/not-declared', async () => ({ ok: true })))
      .toThrowError('ACCESS_ROUTE_POLICY_MISSING');

    const app = Fastify({ logger: false, exposeHeadRoutes: false });
    apps.push(app);
    const records: string[] = [];
    const audit = createBoundedDenialAudit({
      maxEntries: 8,
      windowMs: 10_000,
      write: (entry) => records.push(`${entry.route}:${entry.accessRevision}:${entry.reason}`),
    });
    installAccessAdmission(app, {
      authService: auth,
      evaluator: createAccessEvaluator(async () => snapshot(false)),
      profile: 'mock',
      denialAudit: audit,
      assertPublicRoutes: false,
    });
    app.post('/v1/search', async () => ({ ok: true }));
    await app.ready();
    const token = auth.createMockSession({ user_id: 'user-1', role: 'owner' }).token;
    const headers = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: 'POST', url: '/v1/search', headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/v1/search', headers })).statusCode).toBe(403);
    expect(records).toHaveLength(1);
    await auth.close();
    expect((await app.inject({ method: 'POST', url: '/v1/search', headers })).statusCode).toBe(401);
  });

  it('serves three non-interchangeable projections over the session boundary', async () => {
    const app = Fastify({ logger: false, exposeHeadRoutes: false });
    apps.push(app);
    const auth = createMockAuthService();
    const evaluator = createAccessEvaluator(async () => snapshot(true));
    installAccessAdmission(app, {
      authService: auth,
      evaluator,
      profile: 'mock',
      assertPublicRoutes: false,
    });
    registerAccessRoutes(app, evaluator, auth);
    await app.ready();
    const token = auth.createMockSession({ user_id: 'user-1', role: 'owner' }).token;
    const headers = { authorization: `Bearer ${token}` };

    const query = (await app.inject({ method: 'GET', url: '/v1/access/query', headers })).json();
    expect(Object.keys(query).sort()).toEqual([
      'accessRevision', 'denyReason', 'expiresAt', 'factsVersion',
      'policyVersion', 'revocationGeneration', 'scopes', 'state', 'storeSetVersion',
    ]);
    const settings = (await app.inject({ method: 'GET', url: '/v1/access/settings', headers })).json();
    expect(settings).toMatchObject({ state: 'open', grants: 'closed', accounts: 'open' });
    const admin = await app.inject({ method: 'GET', url: '/v1/access/admin', headers });
    expect(admin.statusCode).toBe(200);
    expect(Object.keys(admin.json()).sort()).toEqual([
      'accessRevision', 'accounts', 'denyReason', 'expiresAt', 'grants',
      'policyVersion', 'role', 'state',
    ]);
  });
});
