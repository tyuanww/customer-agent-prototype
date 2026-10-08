import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import { validateContractSchema, type components } from '@customer-agent/contracts';
import type { ProductAuthService } from '../src/auth-service.js';
import { contentIntakeUsageRoutes } from '../src/content-intake/usage-http.js';
import type { IntakeResult } from '../src/content-intake/transaction.js';

type C = components['schemas'];
const actor = Object.freeze({ user_id: 'synthetic-user', role: 'agent' as const, auth_mode: 'mock' as const });
const request = { shopId: 'shop-a', contextGeneration: 1, releaseId: null, productIds: [], scenarioIds: [] };
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
async function host(result: IntakeResult<C['IntakeEntitlement']> = { ok: true, value: {
  entitlementId: 'synthetic-id', releaseId: 'synthetic-release', shopId: 'shop-a', contextGeneration: 1,
  revocationGeneration: 0, validUntil: new Date(Date.now() + 60_000).toISOString(), scopes: [],
} }) {
  const auth = { authenticate: vi.fn(async ({ authorization }: { authorization?: unknown }) => authorization === 'Bearer synthetic-token' ? actor : null) } as unknown as ProductAuthService;
  const issueEntitlement = vi.fn(async () => result);
  const snapshot = vi.fn(async (): Promise<IntakeResult<C['IntakeSnapshot']>> => ({ ok: false,
    code: 'VALIDATION', reason: 'FILE_INVALID', commit: 'rolled_back', diagnosticId: 'synthetic-diagnostic' }));
  const authorizations = vi.fn(async (): Promise<IntakeResult<C['IntakeAuthorization']>> => ({ ok: true, value: {
    factsVersion: 1, revocationGeneration: 0, policyVersion: 1, validUntil: new Date(Date.now()+60_000).toISOString(), capabilities: [], nextCursor: null,
  } }));
  const sources = vi.fn(async (): Promise<IntakeResult<C['IntakeSourceList']>> => ({ ok: true, value: { items: [], nextCursor: null } }));
  const report = vi.fn();
  const app = Fastify({ logger: false, exposeHeadRoutes: false }); apps.push(app);
  await app.register(contentIntakeUsageRoutes, { auth, usage: { issueEntitlement, snapshot, authorizations, sources, vocabulary: async () => ({ ok: true, value: { items: [], nextCursor: null } }) }, report });
  return { app, auth, issueEntitlement, snapshot, authorizations, sources, report };
}
const headers = { authorization: 'Bearer synthetic-token' };

it('requires authentication before parsing and preserves the private actor object identity', async () => {
  const f = await host();
  const denied = await f.app.inject({ method: 'POST', url: '/v1/intake/entitlements', payload: '{', headers: { 'content-type': 'application/json' } });
  expect(denied.statusCode).toBe(401); expect(validateContractSchema('IntakeError', denied.json()).ok).toBe(true);
  expect(f.issueEntitlement).not.toHaveBeenCalled();
  const accepted = await f.app.inject({ method: 'POST', url: '/v1/intake/entitlements', headers, payload: request });
  expect(accepted.statusCode).toBe(200); expect(validateContractSchema('IntakeEntitlement', accepted.json()).ok).toBe(true);
  expect(accepted.headers['cache-control']).toBe('no-store');
  expect(f.issueEntitlement).toHaveBeenCalledWith(actor, request);
  expect((f.issueEntitlement.mock.calls as unknown[][])[0]![0]).toBe(actor);
});

it.each([
  ['VALIDATION', 400], ['UNAUTHORIZED', 401], ['FORBIDDEN', 403], ['NOT_FOUND', 404],
  ['CONFLICT', 409], ['RATE_LIMITED', 429], ['OVERLOADED', 503], ['INTERNAL_ERROR', 500],
] as const)('serializes %s as a formal error with HTTP %s', async (code, status) => {
  const f = await host({ ok: false, code, reason: 'SCOPE_DENIED', commit: 'unknown', diagnosticId: 'synthetic-diagnostic' });
  const response = await f.app.inject({ method: 'POST', url: '/v1/intake/entitlements', headers, payload: request });
  expect(response.statusCode).toBe(status);
  expect(validateContractSchema('IntakeError', response.json()).ok).toBe(true);
  expect(response.json().error).toMatchObject({ code, details: { reason: 'SCOPE_DENIED', diagnosticId: 'synthetic-diagnostic' } });
  expect(response.body).not.toContain('commit');
});

it.each(['{', JSON.stringify({ text: 'x'.repeat(65_536) })])('normalizes parser and body-limit failures without echoing payload', async payload => {
  const f = await host();
  const response = await f.app.inject({ method: 'POST', url: '/v1/intake/entitlements', headers: { ...headers, 'content-type': 'application/json' }, payload });
  expect(response.statusCode).toBe(400); expect(validateContractSchema('IntakeError', response.json()).ok).toBe(true);
  expect(f.issueEntitlement).not.toHaveBeenCalled();
  expect(response.body.length).toBeLessThan(512);
});

it('retains duplicate and unknown query fields for strict rejection; only decodes a single decimal limit', async () => {
  const f = await host();
  for (const query of ['entitlementId=a&limit=100', 'entitlementId=a&limit=1&limit=2', 'entitlementId=a&sessionId=spoof&limit=1e2']) {
    const response = await f.app.inject({ url: `/v1/intake/snapshot?${query}`, headers });
    expect(response.statusCode).toBe(400);
  }
  expect(f.snapshot).toHaveBeenNthCalledWith(1, actor, { entitlementId: 'a', limit: 100 });
  expect(f.snapshot).toHaveBeenNthCalledWith(2, actor, { entitlementId: 'a', limit: ['1', '2'] });
  expect(f.snapshot).toHaveBeenNthCalledWith(3, actor, { entitlementId: 'a', sessionId: 'spoof', limit: '1e2' });
});

it.each([false, true])('hides provider details even when the diagnostic sink fails (%s)', async sinkFails => {
  const f = await host(); const error = new Error('private-provider-token');
  if (sinkFails) f.report.mockImplementationOnce(() => { throw new Error('private-diagnostic-sink'); });
  f.issueEntitlement.mockRejectedValueOnce(error);
  const response = await f.app.inject({ method: 'POST', url: '/v1/intake/entitlements', headers, payload: request });
  expect(response.statusCode).toBe(500); expect(validateContractSchema('IntakeError', response.json()).ok).toBe(true);
  expect(response.body).not.toContain('private-');
  expect(f.report).toHaveBeenCalledWith(response.json().error.details.diagnosticId, error);
});

it('rejects extra POST query parameters rather than silently dropping them', async () => {
  const f = await host();
  const response = await f.app.inject({ method: 'POST', url: '/v1/intake/entitlements?userId=spoof', headers, payload: request });
  expect(response.statusCode).toBe(400); expect(validateContractSchema('IntakeError', response.json()).ok).toBe(true);
  expect(f.issueEntitlement).not.toHaveBeenCalled();
});


it.each([['authorization', 'authorizations', 'IntakeAuthorization'], ['sources', 'sources', 'IntakeSourceList']] as const)(
  'serves the sealed %s list with the same authenticated identity and strict query handoff', async (route, method, schema) => {
    const f = await host();
    expect((await f.app.inject({ url: `/v1/intake/${route}` })).statusCode).toBe(401);
    expect(f[method]).not.toHaveBeenCalled();
    const response = await f.app.inject({ url: `/v1/intake/${route}?limit=1&cursor=test`, headers });
    expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
    expect(validateContractSchema(schema, response.json()).ok).toBe(true);
    expect((f[method].mock.calls as unknown[][])[0]).toEqual([actor, { limit: 1, cursor: 'test' }]);
    await f.app.inject({ url: `/v1/intake/${route}?limit=1&limit=2&userId=spoof`, headers });
    expect((f[method].mock.calls as unknown[][])[1]).toEqual([actor, { limit: ['1', '2'], userId: 'spoof' }]);
    expect((await f.app.inject({ method: 'HEAD', url: `/v1/intake/${route}`, headers })).statusCode).toBe(404);
  });
