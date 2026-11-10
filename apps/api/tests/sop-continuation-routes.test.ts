import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseContractSchema as parse, type components } from '@customer-agent/contracts/sop-unified';
import { parseContractSchema as parseLegacy } from '@customer-agent/contracts';
import { createMockAuthService } from '../src/auth-service.js';
import { LEGACY_CONTRACT_SET, SOP_CONTRACT_SET } from '../src/content-intake/contract-view.js';
import type { IntakeResult, Reason } from '../src/content-intake/transaction.js';
import { sopContinuationRoutes, type SopCheckResult, type SopContinuationOperations, type SopMediaResource } from '../src/sop-continuation-routes.js';

type C = components['schemas'];
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
const handle = `sct_${'a'.repeat(64)}`;
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN5EAAAAASUVORK5CYII=', 'base64');
const receipt = parse('IntakeSopContinuationReceipt', { continuationId: handle, entitlement: {
  entitlementId: 'synthetic-entitlement', releaseId: 'synthetic-release', shopId: 'synthetic-shop', contextGeneration: 2,
  revocationGeneration: 0, validUntil: '2099-01-01T00:00:00.000Z', scopes: [{ tenantId: 'synthetic-tenant', appId: 'synthetic-app',
    brandId: 'synthetic-brand', shopId: 'synthetic-shop', domain: 'sop', sourceId: 'synthetic-source' }],
} });
function failure(reason: Reason, code: C['IntakeFailure']['code'] = 'CONFLICT'): Exclude<IntakeResult<never>, { ok: true }> {
  return { ok: false, code, reason, diagnosticId: 'synthetic-diagnostic', commit: 'rolled_back' };
}
function action(kind: 'open' | 'observe') {
  return { entitlementId: 'synthetic-entitlement', releaseId: 'synthetic-release', contextGeneration: 2,
    key: { sourceId: 'synthetic-source', flowId: 'synthetic-flow', flowVersion: 1 }, graphDigest: 'b'.repeat(64),
    nodeId: 'synthetic-node', action: kind, edgeId: null, entry: null, continuationId: handle };
}
async function host() {
  const app = Fastify(); apps.push(app);
  const auth = createMockAuthService(), { token } = auth.createMockSession({ user_id: 'synthetic-user', role: 'agent' });
  const operations = {
    negotiate: vi.fn<SopContinuationOperations['negotiate']>(async (): Promise<IntakeResult<true>> => ({ ok: true, value: true })),
    check: vi.fn<SopContinuationOperations['check']>(async (_actor, raw): Promise<IntakeResult<SopCheckResult>> => {
      const request = parse('IntakeSopActionCheck', raw);
      return { ok: true, value: request.action === 'open' ? { kind: 'opened', receipt } : { kind: 'checked' } };
    }),
    renew: vi.fn<SopContinuationOperations['renew']>(async (_actor, raw): Promise<IntakeResult<C['IntakeSopContinuationReceipt']>> => {
      parse('IntakeSopContinuationRenew', raw); return { ok: true, value: receipt };
    }),
    close: vi.fn<SopContinuationOperations['close']>(async (_actor, raw): Promise<IntakeResult<null>> => {
      parse('IntakeSopContinuationClose', raw); return { ok: true, value: null };
    }),
    media: vi.fn<SopContinuationOperations['media']>(async (_actor, resource: SopMediaResource): Promise<IntakeResult<C['IntakeSopMediaPayload']>> => ({
      ok: true, value: parse('IntakeSopMediaPayload', { releaseId: resource.releaseId, entitlementId: 'synthetic-entitlement',
        objectId: resource.objectId, sha256: createHash('sha256').update(image).digest('hex'),
        mime: 'image/png', bytes: image.length, base64: image.toString('base64') }),
    })),
  } satisfies SopContinuationOperations;
  await app.register(sopContinuationRoutes, { auth, continuation: operations });
  await app.ready();
  return { app, operations, headers: { authorization: `Bearer ${token}`, 'x-intake-contract-set': SOP_CONTRACT_SET } };
}

describe('frozen continuation HTTP framing', () => {
  it('returns the frozen open/renew receipts and empty 204 check/close responses', async () => {
    const f = await host();
    for (const [url, payload, status] of [
      ['/v1/intake/sop/check', action('open'), 200], ['/v1/intake/sop/check', action('observe'), 204],
      ['/v1/intake/sop/continuations/renew', { continuationId: handle, contextGeneration: 2 }, 200],
      ['/v1/intake/sop/continuations/close', { continuationId: handle }, 204],
    ] as const) {
      const response = await f.app.inject({ method: 'POST', url, headers: f.headers, payload });
      expect(response.statusCode).toBe(status);
      expect(response.headers['cache-control']).toBe('no-store'); expect(response.headers['x-intake-contract-set']).toBe(SOP_CONTRACT_SET);
      if (status === 204) expect(response.body).toBe('');
      else expect(parse('IntakeSopContinuationReceipt', response.json())).toEqual(receipt);
    }
  });

  it('authenticates before negotiation and protects all graph-only commands from unselected views', async () => {
    const f = await host();
    const url = '/v1/intake/sop/continuations/close', payload = { continuationId: handle };
    expect((await f.app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    expect(f.operations.negotiate).not.toHaveBeenCalled();
    for (const view of [undefined, LEGACY_CONTRACT_SET, '', 'unsupported', `${SOP_CONTRACT_SET}, ${SOP_CONTRACT_SET}`]) {
      const headers: Record<string, string> = { authorization: f.headers.authorization };
      if (view !== undefined) headers['x-intake-contract-set'] = view;
      f.operations.negotiate.mockResolvedValueOnce(failure('SCOPE_DENIED', 'NOT_FOUND'));
      const denied = await f.app.inject({ method: 'POST', url, headers, payload });
      expect(denied.statusCode).toBe(404); expect(parseLegacy('IntakeError', denied.json()).error.details.reason).toBe('SCOPE_DENIED');
      const upgrade = await f.app.inject({ method: 'POST', url, headers, payload });
      expect(upgrade.statusCode).toBe(409); expect(parseLegacy('IntakeError', upgrade.json()).error.details.reason).toBe('UPGRADE_REQUIRED');
      expect(upgrade.body).not.toContain('synthetic-release');
    }
    expect(f.operations.close).not.toHaveBeenCalled();
  });

  it('passes the complete media address and preserves a repeated continuation header for rejection', async () => {
    const f = await host();
    const query = 'entitlementId=synthetic-entitlement&sourceId=synthetic-source&flowId=synthetic-flow&ownerKind=task&ownerId=synthetic-node&resourceId=synthetic-resource';
    const response = await f.app.inject({ method: 'GET', url: `/v1/intake/sop/releases/synthetic-release/media/synthetic-media?${query}`,
      headers: { ...f.headers, 'x-sop-continuation': [handle, handle] } });
    expect(response.statusCode).toBe(200); parse('IntakeSopMediaPayload', response.json());
    const resource = f.operations.media.mock.calls[0]![1];
    expect(resource).toMatchObject({ releaseId: 'synthetic-release', objectId: 'synthetic-media',
      query: { sourceId: 'synthetic-source', ownerKind: 'task', ownerId: 'synthetic-node', resourceId: 'synthetic-resource' } });
    expect(resource.continuationHeaders).not.toEqual([handle]);
  });

  it('uses the media operation expiry status and never includes protected bytes on failure', async () => {
    const f = await host();
    const url = '/v1/intake/sop/releases/synthetic-release/media/synthetic-media';
    for (const [reason, status] of [['LEASE_EXPIRED', 410], ['SOP_MEDIA_UNAVAILABLE', 503]] as const) {
      f.operations.media.mockResolvedValueOnce(failure(reason));
      const response = await f.app.inject({ method: 'GET', url, headers: f.headers });
      expect(response.statusCode).toBe(status); expect(parse('IntakeError', response.json()).error.details.reason).toBe(reason);
      expect(response.body).not.toContain('base64');
    }
  });

  it('maps live authorization and dependency failures to the declared action responses', async () => {
    const f = await host();
    for (const [reason, code, status] of [
      ['PERMISSION_CHANGED', 'FORBIDDEN', 404], ['ORG_FACTS_UNAVAILABLE', 'FORBIDDEN', 503],
      ['LEASE_EXPIRED', 'FORBIDDEN', 409], ['COMMIT_UNKNOWN', 'INTERNAL_ERROR', 503],
    ] as const) {
      f.operations.check.mockResolvedValueOnce(failure(reason, code));
      const response = await f.app.inject({ method: 'POST', url: '/v1/intake/sop/check', headers: f.headers, payload: action('observe') });
      expect(response.statusCode).toBe(status); parse('IntakeError', response.json());
      expect(response.body).not.toContain('synthetic-release');
    }
  });
  it('returns the declared unavailable response for unexpected command or negotiation failures', async () => {
    const f = await host();
    f.operations.check.mockRejectedValueOnce(new Error('synthetic internal check failure'));
    const command = await f.app.inject({ method: 'POST', url: '/v1/intake/sop/check', headers: f.headers, payload: action('open') });
    expect(command.statusCode).toBe(503);
    expect(parse('IntakeError', command.json()).error.code).toBe('OVERLOADED');
    expect(command.body).not.toContain('internal check failure');
    f.operations.negotiate.mockRejectedValueOnce(new Error('synthetic internal negotiation failure'));
    const negotiated = await f.app.inject({ method: 'POST', url: '/v1/intake/sop/continuations/close',
      headers: { ...f.headers, 'x-intake-contract-set': 'unsupported' }, payload: { continuationId: handle } });
    expect(negotiated.statusCode).toBe(503);
    expect(negotiated.body).not.toContain(handle);
  });

});
