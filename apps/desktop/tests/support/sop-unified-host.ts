import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseContractSchema } from '@customer-agent/contracts/sop-unified';
import { parseContractSchema as parseV12 } from '@customer-agent/contracts/sop-resource-disable';
import { SOP_RESOURCE_CONTRACT, SOP_UNIFIED_CONTRACT, type SopContractVersion, type SopSchemas } from '../../src/shared/sop-unified';
import { unifiedFixture } from './sop-unified-fixture';

/** Contract-shaped loopback double. It asserts desktop consumption only, with no database. */
export async function startUnifiedHost(version: SopContractVersion = 'v11') {
  const fixture = unifiedFixture();
  const requests: { path: string; query: Record<string, string>; headers: Record<string, string | string[] | undefined>; body: unknown }[] = [];
  const continuations = new Map<string, { releaseId: string; dead: boolean; binding: string }>();
  const queries = new Map<string, { request: SopSchemas['MenokinSopQuerySopQueryRequest']; response: SopSchemas['MenokinSopQuerySopQueryResponse'] }>();
  const issued = new Map<string, SopSchemas['IntakeEntitlement']>();
  const openingBindings = new Map<string, string>();
  const state = { authorized: true, disabled: false, expiredSession: false, ttl: 240_000, releaseId: fixture.entitlement.releaseId,
    mediaFault: '' as '' | 'hash' | 'bytes' | 'mime' | 'release' | 'object' | 'entitlement' | 'corrupt' | 'unavailable',
    dropQuery: false, dropOpen: false, dropClose: false, closeUnavailable: false, queryPadding: 0, mediaDelayMs: 0, mediaDelays: {} as Record<string, number>, mediaFaultObject: '', mediaConcurrent: 0, mediaMaxConcurrent: 0, delay: null as Promise<void> | null, role: 'agent' as 'agent' | 'coach' | 'owner' };
  let serial = 0;
  const entitlement = (releaseId: string, contextGeneration: number): SopSchemas['IntakeEntitlement'] => ({ ...fixture.entitlement,
    entitlementId: `synthetic-entitlement-${++serial}`, releaseId, contextGeneration, validUntil: new Date(Date.now() + state.ttl).toISOString() });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://synthetic.invalid');
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), headers: { ...req.headers }, body });
    const send = (value: unknown, status = 200) => {
      res.statusCode = status;
      const padding = url.pathname === '/v1/sop/query' ? ' '.repeat(state.queryPadding) : '';
      res.end(status === 204 ? undefined : JSON.stringify(value) + padding);
    };
    const deny = (reason: string, status = 403) => send({ error: { code: status === 409 ? 'CONFLICT' : 'FORBIDDEN', message: '合成测试拒绝', details: { reason, diagnosticId: 'synthetic-diagnostic' } } }, status);
    res.setHeader('content-type', 'application/json');
    const contract = version === 'v12' ? SOP_RESOURCE_CONTRACT : SOP_UNIFIED_CONTRACT;
    if (req.headers['x-intake-contract-set'] !== contract) { deny('UPGRADE_REQUIRED', 409); return; }
    res.setHeader('x-intake-contract-set', contract);
    if (state.delay) await state.delay;
    if (state.expiredSession) { deny('LEASE_EXPIRED', 401); return; }
    if (url.pathname === '/v1/intake/sop/continuations/close') {
      if (state.closeUnavailable) { req.socket.destroy(); return; }
      const input = parseContractSchema('IntakeSopContinuationClose', body);
      const active = continuations.get(input.continuationId); if (active) active.dead = true;
      if (state.dropClose) { req.socket.destroy(); return; }
      send(null, 204); return;
    }
    if (!state.authorized) { deny('PERMISSION_CHANGED'); return; }
    if (url.pathname === '/v1/intake/sources') {
      send({ items: [{ scope: fixture.entitlement.scopes[0], version: 1, templateVersion: 'sop-manual-authoring-v1.1', ruleVersion: 'sop-task-graph-v2', mappingVersion: 'sop-manual-to-task-graph-v2', structureDigest: 'b'.repeat(64), contentIntakeMode: 'v2-preview', modeVersion: 1 }], nextCursor: null }); return;
    }
    if (url.pathname === '/v1/intake/entitlements') {
      if (!body || typeof body !== 'object' || !('contextGeneration' in body) || typeof body.contextGeneration !== 'number') { deny('FILE_INVALID'); return; }
      const value = entitlement(state.releaseId, body.contextGeneration);
      issued.set(value.entitlementId, value);
      send(value); return;
    }
    if (url.pathname === '/v1/sop/query') {
      if (version === 'v12') {
        const input = parseV12('MenokinSopQuerySopQueryRequest', body);
        const ordinary = issued.get(input.entitlement_id);
        if (!ordinary || ordinary.shopId !== input.shop_id || Date.parse(ordinary.validUntil) <= Date.now()) { deny('SCOPE_DENIED'); return; }
        const previous = queries.get(input.request_id);
        if (previous && JSON.stringify(previous.request) !== JSON.stringify(input)) { deny('IDEMPOTENCY_CONFLICT', 409); return; }
        const response = previous?.response ?? parseV12('MenokinSopQuerySopQueryResponse', {
          status: 'ready', request_id: input.request_id, release_id: state.releaseId,
          lease_expires_at: new Date(Date.now() + state.ttl).toISOString(), result: fixture.result, reasons: [],
        });
        queries.set(input.request_id, { request: structuredClone(input), response: structuredClone(response) });
        if (state.dropQuery) { req.socket.destroy(); return; }
        send(response); return;
      }
      const input = parseContractSchema('MenokinSopQuerySopQueryRequest', body);
      send({ status: 'ready', request_id: input.request_id, release_id: state.releaseId, lease_expires_at: new Date(Date.now() + state.ttl).toISOString(), result: fixture.result, reasons: [] }, 200); return;
    }
    if (url.pathname === '/v1/intake/sop/check') {
      const input = version === 'v12' ? parseV12('IntakeSopActionCheck', body) : parseContractSchema('IntakeSopActionCheck', body);
      const existing = continuations.get(input.continuationId);
      const immutable = JSON.stringify([input.releaseId, input.key, input.graphDigest]);
      if (state.disabled || existing?.dead || (existing && existing.binding !== immutable)) { deny('SOP_SNAPSHOT_INVALID', 409); return; }
      if (input.action === 'open') {
        if ('queryRequestId' in input) {
          const proof = typeof input.queryRequestId === 'string' ? queries.get(input.queryRequestId) : null;
          const binding = JSON.stringify([input.queryRequestId, input.entitlementId]);
          if (existing ? openingBindings.get(input.continuationId) !== binding
            : !proof || proof.request.entitlement_id !== input.entitlementId || proof.response.release_id !== input.releaseId) {
            deny('SOP_SNAPSHOT_INVALID', 409); return;
          }
          openingBindings.set(input.continuationId, binding);
        }
        if (!existing && input.releaseId !== state.releaseId) { deny('SOP_RELEASE_CHANGED', 409); return; }
        continuations.set(input.continuationId, { releaseId: input.releaseId, dead: false, binding: immutable });
        if (state.dropOpen) { req.socket.destroy(); return; }
        send({ continuationId: input.continuationId, entitlement: entitlement(input.releaseId, input.contextGeneration) }); return;
      }
      if (!existing) { deny('SOP_SNAPSHOT_INVALID', 409); return; }
      send(null, 204); return;
    }
    if (url.pathname === '/v1/intake/sop/continuations/renew') {
      const input = parseContractSchema('IntakeSopContinuationRenew', body), existing = continuations.get(input.continuationId);
      if (!existing || existing.dead || state.disabled) { deny('SOP_SNAPSHOT_INVALID', 409); return; }
      send({ continuationId: input.continuationId, entitlement: entitlement(existing.releaseId, input.contextGeneration) }); return;
    }
    if (url.pathname.includes('/media/')) {
      const mediaPath = decodeURIComponent(url.pathname);
      state.mediaConcurrent++;
      state.mediaMaxConcurrent = Math.max(state.mediaMaxConcurrent, state.mediaConcurrent);
      res.once('close', () => { state.mediaConcurrent--; });
      const objectId = mediaPath.split('/').at(-1)!;
      const delay = state.mediaDelays[objectId] ?? state.mediaDelayMs;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (!state.authorized) { deny('PERMISSION_CHANGED'); return; }
      const existing = continuations.get(String(req.headers['x-sop-continuation']));
      const media = fixture.result.media.find(({ binding }) => binding.objectId === objectId
        && url.searchParams.get('sourceId') === binding.flowKey.sourceId
        && url.searchParams.get('flowId') === binding.flowKey.flowId
        && url.searchParams.get('resourceId') === binding.resourceId
        && url.searchParams.get('ownerKind') === (binding.entry ? 'entry' : binding.graphTarget!.kind)
        && url.searchParams.get('ownerId') === (binding.entry ? binding.entry.businessEntryId : binding.graphTarget!.id));
      if (!existing || existing.dead || state.disabled || !media || !mediaPath.includes(`/releases/${existing.releaseId}/`)) {
        deny('SOP_SNAPSHOT_INVALID', 409); return;
      }
      const payload = { releaseId: existing.releaseId, entitlementId: url.searchParams.get('entitlementId'), objectId: media.binding.objectId,
        sha256: media.binding.sha256, mime: media.binding.mime, bytes: fixture.image.length, base64: fixture.image.toString('base64') };
      const fault = !state.mediaFaultObject || state.mediaFaultObject === objectId ? state.mediaFault : '';
      if (fault === 'unavailable') { deny('SOP_MEDIA_UNAVAILABLE', 503); return; }
      if (fault === 'hash') payload.sha256 = 'f'.repeat(64);
      if (fault === 'bytes') payload.bytes++;
      if (fault === 'mime') payload.mime = 'image/gif';
      if (fault === 'release') payload.releaseId = 'synthetic-wrong-release';
      if (fault === 'object') payload.objectId = 'synthetic-wrong-object';
      if (fault === 'entitlement') payload.entitlementId = 'synthetic-wrong-entitlement';
      if (fault === 'corrupt') payload.base64 = Buffer.from('synthetic corrupt image').toString('base64');
      send(payload); return;
    }
    deny('FILE_INVALID', 404);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { fixture, state, requests, continuations, queries, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
