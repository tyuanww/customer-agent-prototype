// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseContractSchema as parseV12 } from '@customer-agent/contracts/sop-resource-disable';
import type { ProductSessionResult, ProductSessionView } from '../../src/shared/product-session';
import { SopUnifiedRuntime } from '../../src/main/sop-unified-runtime';
import { SopUnifiedPort, type SopUnifiedSession } from '../../src/main/sop-unified-port';
import { ProductHttp, ProductHttpError } from '../../src/main/product-http';
import { isSopUnifiedProjection, type SopContractVersion } from '../../src/shared/sop-unified';
import { ContentIntakeUsage } from '../../src/main/content-intake-usage';
import { startUnifiedHost } from '../support/sop-unified-host';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup(decode = true, version: SopContractVersion = 'v11') {
  const host = await startUnifiedHost(version), copies: string[] = [];
  const http = new ProductHttp(host.origin);
  const listeners = new Set<(state: ProductSessionResult) => void>(), logoutListeners = new Set<() => void>();
  let signedIn = true, epoch = 1, principalId = 'synthetic-user';
  const view = (): ProductSessionView => ({ ok: true, enabled: true, signedIn, sessionEpoch: epoch,
    userId: signedIn ? principalId : null, role: signedIn ? host.state.role : null, authMode: signedIn ? 'mock' : null,
    expiresAt: signedIn ? new Date(Date.now() + 600_000).toISOString() : null, displayName: signedIn ? '合成坐席' : null, job: null });
  const session: SopUnifiedSession = { view,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    onExplicitLogout: listener => { logoutListeners.add(listener); return () => { logoutListeners.delete(listener); }; },
    request: (_epoch, path, options) => http.request(path, { ...options, token: 'synthetic-test-token' }),
  };
  const usage = new ContentIntakeUsage(session, text => copies.push(text));
  usage.select({ shopId: host.fixture.entitlement.shopId, productIds: ['product-b', 'product-a'], scenarioIds: ['scenario-b', 'scenario-a'] });
  const port = new SopUnifiedPort(session, bytes => decode && bytes.equals(host.fixture.image), version);
  const runtime = new SopUnifiedRuntime(port, text => copies.push(text), signal => usage.qualify(signal, 'sop'));
  cleanups.push(() => usage.dispose());
  cleanups.push(host.close, async () => { await runtime.finish(); await runtime.dispose(); });
  await runtime.open(1);
  const startQuery = () => runtime.command({ kind: 'query', shopKey: runtime.projection().shops[0]!.key, group: '品质售后SOP', text: '合成完整流程' });
  const ready = () => {
    const projection = runtime.projection(); expect(isSopUnifiedProjection(projection)).toBe(true);
    if (projection.state !== 'ready') throw new Error(`Expected ready, got ${projection.state}: ${projection.notice}`);
    return projection;
  };
  const settledMedia = () => vi.waitFor(() => {
    const projection = runtime.projection();
    if (projection.state === 'ready') expect(projection.node.media.some(media => media.state === 'loading')).toBe(false);
  }, { timeout: 10_000 });
  const query = async () => {
    const result = await startQuery();
    await settledMedia();
    return result;
  };
  const changeSession = (value: boolean, userId = principalId) => { signedIn = value; principalId = userId; epoch++; for (const listener of listeners) listener(view()); };
  return { ...host, port, usage, runtime, query, startQuery, settledMedia, ready, copies, changeSession,
    logout: () => { for (const listener of logoutListeners) listener(); changeSession(false); } };
}

describe('Main unified SOP consumer over real loopback HTTP', () => {
  it('projects full task, ordinal confirmation, knowledge/resource owners and independently copies exact scripts', async () => {
    const h = await setup(); expect((await h.query()).ok).toBe(true);
    let projection = h.ready();
    expect(projection.node.requirements.map(item => item.ordinal)).toEqual([1, 2]);
    expect(projection.node.media.map(item => item.owner)).toEqual(['task', 'knowledge', 'entry']);
    expect(projection.node.knowledge[1]).toMatchObject({ resource: 'resource-knowledge', owner: 'knowledge' });
    expect(projection.node.scripts.map(script => script.relation)).toEqual(['alternative', 'complementary']);
    expect(projection.node.canAdvance).toBe(false);
    const next = projection.node.nextKey;
    expect((await h.runtime.command({ kind: 'next', key: next })).ok).toBe(false);
    expect(h.requests.filter(r => r.path.endsWith('/check') && JSON.stringify(r.body).includes('"action":"next"'))).toHaveLength(0);
    await h.runtime.command({ kind: 'refresh' });
    for (let index = 0; index < 2; index++) {
      projection = h.ready();
      expect((await h.runtime.command({ kind: 'copy', key: projection.node.scripts[index]!.key })).ok).toBe(true);
      expect(h.ready().node.title).toBe('合成资料核对');
    }
    expect(h.copies).toEqual(h.fixture.result.entries.map(row => row.entry.answerText));
    for (let index = 0; index < 2; index++) {
      projection = h.ready(); await h.runtime.command({ kind: 'confirm', key: projection.node.requirements[index]!.key });
    }
    projection = h.ready(); expect(projection.node.canAdvance).toBe(true);
    await h.runtime.command({ kind: 'next', key: projection.node.nextKey });
    projection = h.ready(); expect(projection.node.kind).toBe('decision');
    expect(projection.node.choices.map(choice => choice.criterion)).toEqual(['合成记录明确包含标记', '现有合成记录不足以判断']);
    expect(projection.node.choices[1]!.unableToDetermine).toBe(true);
    await h.runtime.command({ kind: 'choose', key: projection.node.choices[1]!.key });
    expect(h.ready().node.kind).toBe('terminal');
    expect(JSON.stringify(h.ready())).not.toMatch(/continuationId|entitlementId|preview_handle|graph_digest|source_ref|sct_/);
  });
  it.each(['task', 'knowledge'] as const)('consumes one resource reused by task and %s owners over HTTP without leaking the prior owner image', async ownerKind => {
    const h = await setup();
    const first = structuredClone(h.fixture.result.media[0]!);
    const second = structuredClone(first);
    first.binding.alt = '合成起点资源图片';
    second.binding.alt = '合成判断资源图片';
    second.binding.graphTarget = { kind: ownerKind, id: ownerKind === 'task' ? 'decision' : 'decision-knowledge' };
    if (ownerKind === 'knowledge') h.fixture.result.flow.nodes[1]!.body.knowledge = [
      { id: 'decision-knowledge', title: '合成判断知识', body: '仅供判断任务读取。', audience: 'agent' },
    ];
    h.fixture.result.media = [first, second];
    expect((await h.query()).ok).toBe(true);
    expect(h.ready().node.media).toHaveLength(1);
    expect(h.ready().node.media[0]).toMatchObject({ alt: first.binding.alt, owner: 'task', state: 'ready' });
    const priorKey = h.ready().node.media[0]!.key;
    for (const item of h.ready().node.requirements) await h.runtime.command({ kind: 'confirm', key: item.key });
    expect((await h.runtime.command({ kind: 'next', key: h.ready().node.nextKey })).ok).toBe(true);
    await h.settledMedia();
    expect(h.ready().node.media).toHaveLength(1);
    expect(h.ready().node.media[0]).toMatchObject({ alt: second.binding.alt, owner: ownerKind, state: 'ready' });
    expect(h.ready().node.media[0]!.key).not.toBe(priorKey);
    expect((await h.runtime.command({ kind: 'media', key: priorKey })).ok).toBe(false);
    const reads = h.requests.filter(request => request.path.includes('/media/'));
    expect(reads).toHaveLength(2);
    expect(reads[0]!.path).toBe(reads[1]!.path);
    expect(reads.map(read => [read.query.ownerKind, read.query.ownerId, read.query.resourceId])).toEqual([
      ['task', 'start', first.binding.resourceId],
      [ownerKind, second.binding.graphTarget!.id, first.binding.resourceId],
    ]);
  });
  it('keeps binding audience local when task and customer-entry owners share an image', async () => {
    const h = await setup();
    const first = structuredClone(h.fixture.result.media[0]!);
    const second = structuredClone(first);
    Reflect.deleteProperty(second.binding, 'graphTarget');
    second.binding.entry = h.fixture.result.flow.nodes[0]!.body.scripts[0]!.entry;
    second.binding.audience = 'customer';
    h.fixture.result.media = [first, second];
    expect((await h.query()).ok).toBe(true);
    expect(h.ready().node.media.map(media => [media.owner, media.state])).toEqual([['task', 'ready'], ['entry', 'ready']]);
    expect((await h.runtime.command({ kind: 'copy', key: h.ready().node.scripts[0]!.key })).ok).toBe(true);
    expect(h.copies).toEqual([h.fixture.result.entries[0]!.entry.answerText]);
  });
  it.each(['same-owner-position', 'same-binding-second-position', 'object-bytes'] as const)('blocks inconsistent %s before media reads over HTTP', async defect => {
    const h = await setup();
    const first = structuredClone(h.fixture.result.media[0]!);
    const second = structuredClone(first);
    if (defect === 'same-owner-position') {
      second.binding.resourceId = 'other-resource'; second.binding.objectId = 'other-object';
    }
    if (defect === 'same-binding-second-position') second.binding.ordinal = 2;
    if (defect === 'object-bytes') {
      second.binding.graphTarget = { kind: 'task', id: 'decision' }; second.binding.bytes++;
    }
    h.fixture.result.media = [first, second];
    expect((await h.query()).ok).toBe(false);
    expect(h.runtime.projection()).toMatchObject({ state: 'blocked', node: null });
    expect(h.requests.filter(request => request.path.includes('/media/'))).toHaveLength(0);
    expect(h.copies).toEqual([]);
  });
  it.each(['hash', 'bytes', 'mime', 'release', 'object', 'entitlement', 'corrupt'] as const)('blocks required media with %s failure, then visibly recovers', async fault => {
    const h = await setup(); h.state.mediaFault = fault; await h.query();
    const projection = h.ready(); expect(projection.node.canAdvance).toBe(false); expect(projection.node.scripts.every(script => !script.canCopy)).toBe(true);
    expect(projection.notice).toContain('必需图片');
    expect((await h.runtime.command({ kind: 'copy', key: projection.node.scripts[0]!.key })).ok).toBe(false);
    expect(h.copies).toEqual([]);
    h.state.mediaFault = ''; expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(true);
    await h.settledMedia();
    expect(h.ready().node.media.every(media => media.image !== null)).toBe(true);
  });
  it.each(['permission', 'risk', 'source'] as const)('blocks a new flow with missing %s facts, irrespective of safe-looking text', async missing => {
    const h = await setup();
    if (missing === 'permission') h.fixture.result.permissions = [];
    if (missing === 'risk') Reflect.deleteProperty(h.fixture.result.permissions[0]!, 'risk_level');
    if (missing === 'source') h.fixture.entitlement.scopes = [];
    expect((await h.query()).ok).toBe(false);
    expect(h.runtime.projection()).toMatchObject({ state: 'blocked', node: null });
    expect(h.copies).toEqual([]);
  });
  it('refuses copy_allowed false even when renderer submits its opaque key', async () => {
    const h = await setup(); h.fixture.result.permissions[0]!.copy_allowed = false; await h.query();
    const script = h.ready().node.scripts[0]!; expect(script.canCopy).toBe(false);
    expect((await h.runtime.command({ kind: 'copy', key: script.key })).ok).toBe(false); expect(h.copies).toEqual([]);
  });
  it('does not clear or replace a running graph when a new release is published', async () => {
    const h = await setup(); await h.query();
    await h.runtime.command({ kind: 'confirm', key: h.ready().node.requirements[0]!.key });
    const continuation = [...h.continuations.keys()][0]!;
    h.state.releaseId = 'synthetic-release-2';
    expect(h.ready().node.requirements[0]!.confirmed).toBe(true);
    await h.runtime.command({ kind: 'refresh' });
    expect(h.ready().node.requirements[0]!.confirmed).toBe(true);
    expect(h.continuations.get(continuation)?.releaseId).toBe('synthetic-release-1');
    expect(h.requests.filter(request => request.path === '/v1/sop/query')).toHaveLength(1);
  });
  it('keeps a reported required image failure blocked until explicit verified retry', async () => {
    const h = await setup(); await h.query();
    await h.runtime.command({ kind: 'media-failed', key: h.ready().node.media[0]!.key });
    const node = h.ready().node; expect(node.media[0]!.image).toBeNull(); expect(node.scripts[0]!.canCopy).toBe(false);
    expect((await h.runtime.command({ kind: 'copy', key: node.scripts[0]!.key })).ok).toBe(false);
    expect(h.copies).toEqual([]);
    await h.runtime.command({ kind: 'media', key: node.media[0]!.key });
    await h.settledMedia();
    expect(h.ready().node.media[0]!.image).not.toBeNull();
    expect((await h.runtime.command({ kind: 'copy', key: h.ready().node.scripts[0]!.key })).ok).toBe(true);
  });
  it('blocks valid-hash bytes when native image decoding cannot deliver the image', async () => {
    const h = await setup(false); await h.query();
    expect(h.ready().node.media.every(media => media.image === null)).toBe(true);
    expect(h.ready().node.scripts.every(script => !script.canCopy)).toBe(true); expect(h.copies).toEqual([]);
  });
  it('renews after the original short entitlement and media preview expire', async () => {
    const h = await setup(); await h.query(); const now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now + 301_000);
    expect(h.runtime.projection()).toMatchObject({ state: 'paused', node: null });
    expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(true);
    await h.settledMedia();
    expect(h.ready().node.media.every(media => media.image !== null)).toBe(true);
  });
  it('terminates at original content expiry and cannot renew it', async () => {
    const h = await setup(); h.fixture.result.flow.header.effectiveTo = new Date(Date.now() + 60_000).toISOString(); await h.query();
    const now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now + 61_000);
    expect(h.runtime.projection()).toMatchObject({ state: 'ended', node: null });
    expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(false);
  });
  it.each([false, true])('expires an image with required=%s independently of protected text', async required => {
    const h = await setup();
    const expiresAt = new Date(Date.now() + 1000).toISOString();
    for (const media of h.fixture.result.media) { media.expires_at = expiresAt; media.binding.required = required; }
    await h.query();
    for (let index = 0; index < 2; index++) await h.runtime.command({ kind: 'confirm', key: h.ready().node.requirements[index]!.key });
    const now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now + 2000);
    const projection = h.ready(); expect(projection.node.media.every(media => media.image === null)).toBe(true);
    expect(projection.node.canAdvance).toBe(!required);
    expect((await h.runtime.command({ kind: 'next', key: projection.node.nextKey })).ok).toBe(!required);
    if (required) {
      const reads = vi.spyOn(h.port, 'media');
      expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(true);
      await h.settledMedia();
    expect(h.ready().node.media.every(media => media.image !== null)).toBe(true);
      expect(reads.mock.calls.every(([input]) => input.media.expires_at === expiresAt && input.context.kind === 'live-continuation')).toBe(true);
      expect(h.fixture.result.media.every(media => media.expires_at === expiresAt)).toBe(true);
    } else expect(h.ready().node.kind).toBe('decision');
  });
  it('consumes valid opaque identifiers containing embedded periods through the narrow HTTP port', async () => {
    const h = await setup(); h.state.releaseId = 'synthetic.release..one';
    h.fixture.result.media[0]!.binding.objectId = 'synthetic.image..one';
    expect((await h.query()).ok).toBe(true);
    await h.settledMedia();
    expect(h.ready().node.media.every(media => media.image !== null)).toBe(true);
    expect((await h.runtime.command({ kind: 'copy', key: h.ready().node.scripts[0]!.key })).ok).toBe(true);
  });
  it('rejects a schema-valid query response exceeding the frozen 1 MiB transport budget', async () => {
    const h = await setup(); h.state.queryPadding = 1_048_576;
    expect((await h.query()).ok).toBe(false);
    expect(h.runtime.projection().node).toBeNull(); expect(h.copies).toEqual([]);
    expect(h.requests.some(request => request.path === '/v1/intake/sop/check')).toBe(false);
  });
  it('finishes slow required images without a whole-flow five-second timeout', async () => {
    const h = await setup(); h.state.mediaDelayMs = 2000;
    expect((await h.startQuery()).ok).toBe(true);
    expect(h.ready().busy).toBe(false);
    expect(h.ready().node.media.every(media => media.state === 'loading')).toBe(true);
    await vi.waitFor(() => expect(h.ready().node.media.every(media => media.image !== null)).toBe(true), { timeout: 10_000 });
  }, 15_000);
  it('keeps a legal batch beyond five seconds bounded and preserves confirmation progress', async () => {
    const h = await setup();
    for (let index = 4; index <= 5; index++) {
      const media = structuredClone(h.fixture.result.media[0]!);
      media.binding.objectId = `synthetic-image-${index}`;
      media.binding.resourceId = `synthetic-resource-${index}`;
      media.binding.ordinal = index;
      h.fixture.result.media.push(media);
    }
    h.state.mediaDelayMs = 2000;
    expect((await h.startQuery()).ok).toBe(true);
    const initial = h.ready().node;
    expect((await h.runtime.command({ kind: 'copy', key: initial.scripts[0]!.key })).ok).toBe(false);
    for (const item of initial.requirements) await h.runtime.command({ kind: 'confirm', key: item.key });
    expect(h.ready().node.canAdvance).toBe(false);
    await vi.waitFor(() => expect(h.ready().node.media.filter(media => media.state === 'ready')).toHaveLength(2), { timeout: 3000 });
    const first = h.ready().node.media[0]!;
    expect(h.ready().node.requirements.every(item => item.confirmed)).toBe(true);
    await h.settledMedia();
    expect(h.ready().node.media.every(media => media.state === 'ready')).toBe(true);
    expect(h.ready().node.media[0]).toEqual(first);
    expect(h.state.mediaMaxConcurrent).toBe(2);
    expect(h.requests.filter(request => request.path.includes('/media/'))).toHaveLength(5);
    expect((await h.runtime.command({ kind: 'copy', key: initial.scripts[0]!.key })).ok).toBe(true);
    expect(h.ready().node.canAdvance).toBe(true);
  }, 12_000);
  it('copies and advances while optional images are still loading and fences the prior node', async () => {
    const h = await setup();
    for (const media of h.fixture.result.media) media.binding.required = false;
    h.state.mediaDelayMs = 200;
    await h.startQuery();
    const old = h.ready().node;
    expect(old.media.every(media => media.state === 'loading')).toBe(true);
    expect(old.scripts.every(script => script.canCopy)).toBe(true);
    expect((await h.runtime.command({ kind: 'copy', key: old.scripts[0]!.key })).ok).toBe(true);
    for (const item of old.requirements) await h.runtime.command({ kind: 'confirm', key: item.key });
    expect((await h.runtime.command({ kind: 'next', key: old.nextKey })).ok).toBe(true);
    expect(h.ready().node).toMatchObject({ kind: 'decision', media: [] });
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(h.ready().node).toMatchObject({ kind: 'decision', media: [] });
    expect((await h.runtime.command({ kind: 'media', key: old.media[0]!.key })).ok).toBe(false);
    expect((await h.runtime.command({ kind: 'copy', key: old.scripts[0]!.key })).ok).toBe(false);
    expect(h.requests.filter(request => request.path.includes('/media/'))).toHaveLength(2);
    expect(h.copies).toEqual([h.fixture.result.entries[0]!.entry.answerText]);
  });
  it.each(['hash', 'unavailable'] as const)('retains verified peers after resource %s failure and retries only that image with a new handle', async fault => {
    const h = await setup();
    h.state.mediaFault = fault; h.state.mediaFaultObject = 'synthetic-image-3';
    await h.query();
    const before = h.ready().node.media;
    expect(before.map(media => media.state)).toEqual(['ready', 'ready', 'unavailable']);
    h.state.mediaFault = '';
    expect((await h.runtime.command({ kind: 'media', key: before[2]!.key })).ok).toBe(true);
    expect(h.ready().node.media.slice(0, 2)).toEqual(before.slice(0, 2));
    await h.settledMedia();
    const after = h.ready().node.media;
    expect(after[2]!.state).toBe('ready'); expect(after[2]!.key).not.toBe(before[2]!.key);
    expect((await h.runtime.command({ kind: 'media', key: before[2]!.key })).ok).toBe(false);
    const paths = h.requests.filter(request => request.path.includes('/media/')).map(request => request.path);
    expect(paths.filter(path => path.endsWith('/synthetic-image-1'))).toHaveLength(1);
    expect(paths.filter(path => path.endsWith('/synthetic-image-2'))).toHaveLength(1);
    expect(paths.filter(path => path.endsWith('/synthetic-image-3'))).toHaveLength(2);
  });
  it.each(['revoke', 'session', 'close', 'logout'] as const)('cancels progressive reads on %s and discards late protected data', async change => {
    const h = await setup(); h.state.mediaDelayMs = 150;
    await h.startQuery();
    const key = h.ready().node.media[0]!.key;
    await vi.waitFor(() => expect(h.requests.filter(request => request.path.includes('/media/'))).toHaveLength(2));
    if (change === 'revoke') { h.state.authorized = false; await h.runtime.command({ kind: 'refresh' }); }
    if (change === 'session') h.changeSession(false);
    if (change === 'close') expect((await h.runtime.finish()).ok).toBe(true);
    if (change === 'logout') h.logout();
    expect(h.runtime.projection().node).toBeNull();
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(h.runtime.projection().node).toBeNull(); expect(h.copies).toEqual([]);
    expect((await h.runtime.command({ kind: 'media', key })).ok).toBe(false);
    expect(h.requests.filter(request => request.path.includes('/media/'))).toHaveLength(2);
  });
  it.each([false, true])('expires verified images during later reads with required=%s and refuses late expired bytes', async required => {
    const h = await setup();
    for (const media of h.fixture.result.media) {
      media.binding.required = required;
      media.expires_at = new Date(Date.now() + 1000).toISOString();
    }
    h.state.mediaDelays['synthetic-image-3'] = 1400;
    await h.startQuery();
    await vi.waitFor(() => expect(h.ready().node.media.filter(media => media.state === 'ready')).toHaveLength(2));
    for (const item of h.ready().node.requirements) await h.runtime.command({ kind: 'confirm', key: item.key });
    const oldKey = h.ready().node.media[0]!.key;
    await h.settledMedia();
    expect(h.ready().node.media.every(media => media.state === 'unavailable' && media.image === null)).toBe(true);
    expect(h.ready().node.canAdvance).toBe(!required);
    expect((await h.runtime.command({ kind: 'copy', key: h.ready().node.scripts[0]!.key })).ok).toBe(!required);
    expect((await h.runtime.command({ kind: 'media', key: oldKey })).ok).toBe(false);
  });
  it('suspends detected transport failure at the per-image deadline and restores confirmed progress', async () => {
    const h = await setup();
    h.fixture.result.media[2]!.binding.required = false;
    h.state.mediaDelays['synthetic-image-3'] = 5200;
    await h.startQuery();
    await vi.waitFor(() => expect(h.ready().node.media.filter(media => media.state === 'ready')).toHaveLength(2));
    for (const item of h.ready().node.requirements) await h.runtime.command({ kind: 'confirm', key: item.key });
    await vi.waitFor(() => expect(h.runtime.projection()).toMatchObject({ state: 'paused', node: null }), { timeout: 6000 });
    expect(h.copies).toEqual([]);
    h.state.mediaDelays['synthetic-image-3'] = 0;
    expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(true); await h.settledMedia();
    expect(h.ready().node.requirements.every(item => item.confirmed)).toBe(true);
    expect(h.ready().node.media.every(media => media.state === 'ready')).toBe(true);
  }, 8000);
  it('removes verified peers at their own expiry timer and reads again under fresh authority', async () => {
    const h = await setup();
    for (const media of h.fixture.result.media) media.expires_at = new Date(Date.now() + 1000).toISOString();
    await h.query();
    const old = h.ready().node.media[1]!.key;
    vi.useFakeTimers({ shouldClearNativeTimers: true, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    await h.runtime.command({ kind: 'media-failed', key: h.ready().node.media[0]!.key });
    const notified = vi.fn(); h.runtime.subscribe(notified);
    await vi.advanceTimersByTimeAsync(1001);
    expect(notified).toHaveBeenCalled();
    expect(h.ready().node.media.every(media => media.state === 'unavailable')).toBe(true);
    expect((await h.runtime.command({ kind: 'media', key: old })).ok).toBe(false);
    vi.useRealTimers();
    const reads = vi.spyOn(h.port, 'media');
    expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(true);
    await h.settledMedia();
    expect(h.ready().node.media.every(media => media.state === 'ready')).toBe(true);
    expect(reads.mock.calls.every(([input]) => input.context.kind === 'live-continuation')).toBe(true);
  });
  it('consumes the contract maximum of 500 media through the same bounded queue', async () => {
    const h = await setup();
    const template = structuredClone(h.fixture.result.media[0]!);
    for (let index = 0; index < 5; index++) h.fixture.result.flow.nodes[0]!.body.knowledge.push({
      id: `batch-owner-${index}`, title: `合成批量知识${index}`, body: '仅用于五百图合成回归。', audience: 'agent',
    });
    h.fixture.result.media = Array.from({ length: 500 }, (_, index) => ({ ...structuredClone(template),
      binding: { ...template.binding, objectId: `synthetic-batch-${index}`, resourceId: `synthetic-resource-${index}`, ordinal: index % 100 + 1,
        graphTarget: { kind: 'knowledge', id: `batch-owner-${Math.floor(index / 100)}` } },
    }));
    await h.startQuery(); await h.settledMedia();
    expect(h.ready().node.media).toHaveLength(500);
    expect(h.ready().node.media.every(media => media.state === 'ready')).toBe(true);
    expect(h.state.mediaMaxConcurrent).toBeGreaterThan(0);
    expect(h.state.mediaMaxConcurrent).toBeLessThanOrEqual(2);
    expect(h.requests.filter(request => request.path.includes('/media/'))).toHaveLength(500);
  }, 12_000);
  it('loads required images before optional peers without hiding authorized text', async () => {
    const h = await setup();
    for (const media of h.fixture.result.media) media.binding.required = false;
    h.fixture.result.media[2]!.binding.required = true; h.state.mediaDelayMs = 100;
    await h.startQuery();
    expect(h.ready().node.instruction).toBe(h.fixture.result.flow.nodes[0]!.body.instruction);
    await vi.waitFor(() => expect(h.requests.filter(request => request.path.includes('/media/'))).toHaveLength(2));
    expect(h.requests.filter(request => request.path.includes('/media/')).some(request => request.path.endsWith('/synthetic-image-3'))).toBe(true);
    await vi.waitFor(() => expect(h.ready().node.scripts[0]!.canCopy).toBe(true));
    expect(h.ready().node.media.some(media => media.state === 'loading')).toBe(true);
  });
  it('retains verified peers across a live renewal and cancels the older in-flight read', async () => {
    const h = await setup(); h.state.mediaDelays['synthetic-image-3'] = 200;
    const reads = vi.spyOn(h.port, 'media');
    await h.startQuery();
    await vi.waitFor(() => expect(h.ready().node.media.filter(media => media.state === 'ready')).toHaveLength(2));
    const before = h.ready().node.media, originalExpiry = h.fixture.result.media[2]!.expires_at;
    h.state.releaseId = 'synthetic-release-2';
    expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(true);
    expect(h.ready().node.media.slice(0, 2).map(media => media.image)).toEqual(before.slice(0, 2).map(media => media.image));
    expect((await h.runtime.command({ kind: 'media', key: before[2]!.key })).ok).toBe(false);
    await h.settledMedia();
    const repeated = reads.mock.calls.filter(([input]) => input.media.binding.objectId === 'synthetic-image-3');
    expect(repeated).toHaveLength(2);
    expect(repeated[0]![0].context.kind).toBe('query-preview');
    expect(repeated[1]![0].context.kind).toBe('live-continuation');
    expect(repeated[1]![0].entitlement.entitlementId).not.toBe(repeated[0]![0].entitlement.entitlementId);
    expect(repeated[1]![0].media.expires_at).toBe(originalExpiry);
    expect(repeated[1]![0].entitlement.releaseId).toBe('synthetic-release-1');
    expect(h.requests.filter(request => request.path.endsWith('/synthetic-image-1'))).toHaveLength(1);
    expect(h.requests.filter(request => request.path.endsWith('/synthetic-image-2'))).toHaveLength(1);
  });
  it('hides the graph when a pending media GET reports revocation', async () => {
    const h = await setup(); h.state.mediaDelayMs = 150;
    await h.startQuery();
    await vi.waitFor(() => expect(h.requests.filter(request => request.path.includes('/media/'))).toHaveLength(2));
    h.state.authorized = false;
    await vi.waitFor(() => expect(h.runtime.projection()).toMatchObject({ state: 'paused', node: null }));
    expect(h.copies).toEqual([]);
    expect(h.requests.filter(request => request.path.includes('/media/'))).toHaveLength(2);
  });
  it('never lends an old release image to new flow handles after restart', async () => {
    const h = await setup(); await h.query();
    const old = h.ready().node.media[0]!.key;
    h.state.releaseId = 'synthetic-release-2'; h.state.mediaFault = 'hash';
    expect((await h.runtime.restart()).ok).toBe(true); await h.settledMedia();
    expect(h.ready().node.media.every(media => media.state === 'unavailable' && media.image === null)).toBe(true);
    expect((await h.runtime.command({ kind: 'media', key: old })).ok).toBe(false);
    expect(h.ready().node.media.every(media => media.key !== old)).toBe(true);
  });
  it.each(['copy', 'next'] as const)('rechecks required media after an awaited %s authorization', async action => {
    const h = await setup();
    for (const media of h.fixture.result.media) media.expires_at = new Date(Date.now() + 1000).toISOString();
    await h.query();
    for (const item of h.ready().node.requirements) await h.runtime.command({ kind: 'confirm', key: item.key });
    const node = h.ready().node, count = h.requests.length;
    let release!: () => void;
    h.state.delay = new Promise<void>(resolve => { release = resolve; });
    const pending = h.runtime.command({ kind: action, key: action === 'copy' ? node.scripts[0]!.key : node.nextKey });
    await vi.waitFor(() => expect(h.requests.slice(count).some(request => request.path.endsWith('/check'))).toBe(true));
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 2000);
    release(); expect((await pending).ok).toBe(false);
    expect(h.ready().node.title).toBe(node.title); expect(h.copies).toEqual([]);
    expect(h.ready().node.media.every(media => media.image === null)).toBe(true);
  });
  it('shows recoverable suspension for an unexpected progressive worker failure', async () => {
    const h = await setup(); vi.spyOn(h.port, 'media').mockRejectedValueOnce(new Error('synthetic unexpected decoder failure'));
    await h.startQuery();
    await vi.waitFor(() => expect(h.runtime.projection()).toMatchObject({ state: 'paused', node: null }));
    expect(h.runtime.projection().notice).toContain('图片展示暂时中断'); expect(h.copies).toEqual([]);
  });
  it('suspends on revoked authority and restores progress on a new grant and new release', async () => {
    const h = await setup(); await h.query();
    await h.runtime.command({ kind: 'confirm', key: h.ready().node.requirements[0]!.key });
    h.state.authorized = false;
    await h.runtime.command({ kind: 'copy', key: h.ready().node.scripts[0]!.key });
    expect(h.runtime.projection()).toMatchObject({ state: 'paused', node: null });
    h.state.authorized = true; h.state.releaseId = 'synthetic-release-2';
    expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(true);
    expect(h.ready().node.requirements[0]!.confirmed).toBe(true);
    expect([...h.continuations.values()][0]!.releaseId).toBe('synthetic-release-1');
    await h.settledMedia();
    await h.runtime.command({ kind: 'copy', key: h.ready().node.scripts[1]!.key });
    expect(h.copies).toEqual([h.fixture.result.entries[1]!.entry.answerText]);
  });
  it('keeps a natural-expiry continuation hidden until server-approved reauthentication', async () => {
    const h = await setup(); await h.query();
    await h.runtime.command({ kind: 'confirm', key: h.ready().node.requirements[0]!.key });
    h.changeSession(false); expect(h.runtime.projection()).toMatchObject({ state: 'paused', node: null });
    h.changeSession(true); expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(true);
    expect(h.ready().node.requirements[0]!.confirmed).toBe(true);
    h.logout(); h.changeSession(true);
    expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(false);
    expect(h.runtime.projection().node).toBeNull();
  });
  it('does not expose original content to a different account after login', async () => {
    const h = await setup(); await h.query(); h.changeSession(false); h.changeSession(true, 'different-synthetic-user');
    expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(false);
    expect(h.runtime.projection()).toMatchObject({ state: 'paused', node: null }); expect(h.copies).toEqual([]);
  });
  it('uses the renewed current scope and never reuses an old scope on failure', async () => {
    const h = await setup(); await h.query(); const scopes = h.fixture.entitlement.scopes;
    h.fixture.entitlement.scopes = []; expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(false);
    expect(h.runtime.projection()).toMatchObject({ state: 'paused', node: null });
    h.fixture.entitlement.scopes = scopes; expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(true);
    expect(h.ready().node.title).toBe('合成资料核对');
  });
  it('does not revive disable then reenable or reuse stale action handles', async () => {
    const h = await setup(); await h.query(); const key = h.ready().node.scripts[0]!.key;
    h.state.disabled = true; await h.runtime.command({ kind: 'refresh' });
    expect(h.runtime.projection()).toMatchObject({ state: 'ended', node: null });
    h.state.disabled = false; expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(false);
    await h.query(); expect((await h.runtime.command({ kind: 'copy', key })).ok).toBe(false); expect(h.copies).toEqual([]);
  });
  it('discards a continuation after the server permanently ends its pinned release', async () => {
    const h = await setup(true, 'v12');
    await h.query();
    const key = h.ready().node.scripts[0]!.key;
    vi.spyOn(h.port, 'renew').mockRejectedValueOnce(new ProductHttpError('STALE', 'SOP_RELEASE_CHANGED'));
    expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(false);
    expect(h.runtime.projection()).toMatchObject({ state: 'ended', node: null });
    expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(false);
    await h.query();
    expect((await h.runtime.command({ kind: 'copy', key })).ok).toBe(false);
    expect(h.copies).toEqual([]);
  });
  it('hides after display deadline and renews using a fresh full entitlement', async () => {
    const h = await setup(); await h.query(); const now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now + 31_000);
    expect(h.runtime.projection()).toMatchObject({ state: 'paused', node: null });
    expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(true);
    expect(h.ready().node.title).toBe('合成资料核对');
  });
  it.each([false, true])('discards destroyed-window progress when close transport unavailable=%s', async unavailable => {
    const h = await setup(); await h.query();
    for (const item of h.ready().node.requirements) await h.runtime.command({ kind: 'confirm', key: item.key });
    const old = h.ready().node;
    expect(old.requirements.every(item => item.confirmed)).toBe(true);
    const continuation = [...h.continuations.keys()][0]!;
    h.state.closeUnavailable = unavailable;
    h.runtime.invalidate();
    await vi.waitFor(() => expect(h.requests.filter(request => request.path.endsWith('/continuations/close'))).toHaveLength(1));
    await vi.waitFor(() => expect(h.runtime.projection().busy).toBe(false));
    expect(h.runtime.projection().state, `close transport unavailable=${unavailable}`).toBe('ended');
    expect(h.runtime.projection().node).toBeNull();
    expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(false);
    expect((await h.runtime.restart()).ok).toBe(false);
    expect((await h.runtime.command({ kind: 'copy', key: old.scripts[0]!.key })).ok).toBe(false);
    expect((await h.runtime.command({ kind: 'media', key: old.media[0]!.key })).ok).toBe(false);
    expect(h.continuations.get(continuation)?.dead).toBe(!unavailable);
    h.state.closeUnavailable = false;
    await h.runtime.open(2);
    expect(h.runtime.projection()).toMatchObject({ state: 'idle', node: null, sessionId: 2 });
    expect((await h.query()).ok).toBe(true);
    expect(h.ready().node.requirements.every(item => !item.confirmed)).toBe(true);
    expect(h.ready().node.scripts[0]!.key).not.toBe(old.scripts[0]!.key);
    expect([...h.continuations.keys()]).toHaveLength(2);
    expect(h.copies).toEqual([]);
  });
  it('discards a pending explicit-close retry when its native window is destroyed', async () => {
    const h = await setup(); await h.query();
    await h.runtime.command({ kind: 'confirm', key: h.ready().node.requirements[0]!.key });
    h.state.closeUnavailable = true;
    expect((await h.runtime.finish()).ok).toBe(false);
    expect(h.runtime.projection()).toMatchObject({ state: 'closing', node: null });
    h.runtime.invalidate();
    expect(h.runtime.projection()).toMatchObject({ state: 'ended', node: null });
    expect((await h.runtime.restart()).ok).toBe(false);
    await vi.waitFor(() => expect(h.requests.filter(request => request.path.endsWith('/continuations/close'))).toHaveLength(2));
    h.state.closeUnavailable = false;
    await h.runtime.open(2); expect(h.runtime.projection().state).toBe('idle');
    await h.query(); expect(h.ready().node.requirements.every(item => !item.confirmed)).toBe(true);
  });
  it('aborts an in-flight copy on native destruction even when remote close cannot arrive', async () => {
    const h = await setup(); await h.query();
    const key = h.ready().node.scripts[0]!.key, count = h.requests.length;
    let release!: () => void;
    h.state.delay = new Promise<void>(resolve => { release = resolve; });
    const pending = h.runtime.command({ kind: 'copy', key });
    await vi.waitFor(() => expect(h.requests.slice(count).some(request => request.path.endsWith('/check'))).toBe(true));
    h.state.closeUnavailable = true; h.runtime.invalidate();
    expect(h.runtime.projection()).toMatchObject({ state: 'ended', node: null });
    release(); expect((await pending).ok).toBe(false);
    expect(h.copies).toEqual([]);
    await vi.waitFor(() => expect(h.requests.some(request => request.path.endsWith('/continuations/close'))).toBe(true));
    h.state.closeUnavailable = false;
    await h.runtime.open(2); expect(h.runtime.projection().state).toBe('idle');
    expect((await h.runtime.command({ kind: 'copy', key })).ok).toBe(false);
  });
  it('recovers a lost open and close with the original CSPRNG continuation and binding', async () => {
    const h = await setup(); h.state.dropOpen = true; expect((await h.query()).ok).toBe(false);
    expect(h.runtime.projection().state).toBe('paused');
    const original = [...h.continuations.keys()][0]!; expect(original).toMatch(/^sct_[0-9a-f]{64}$/);
    h.state.dropOpen = false; expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(true);
    expect([...h.continuations.keys()]).toEqual([original]);
    h.state.dropClose = true; expect((await h.runtime.finish()).ok).toBe(false);
    expect(h.runtime.projection()).toMatchObject({ state: 'closing', node: null });
    h.state.dropClose = false; expect((await h.runtime.finish()).ok).toBe(true);
    expect([...h.continuations.keys()]).toEqual([original]);
    expect(h.continuations.get(original)?.dead).toBe(true);
  });
  it('restarts by closing the original continuation before opening current release', async () => {
    const h = await setup(); await h.query(); const first = [...h.continuations.keys()][0]!;
    h.state.releaseId = 'synthetic-release-2'; expect((await h.runtime.restart()).ok).toBe(true);
    expect(h.continuations.get(first)?.dead).toBe(true);
    expect([...h.continuations.values()].filter(active => !active.dead).map(active => active.releaseId)).toEqual(['synthetic-release-2']);
    expect(h.ready().node.requirements.every(item => !item.confirmed)).toBe(true);
  });
  it('rejects expired or cross-flow media descriptors before any clipboard write', async () => {
    const h = await setup(); h.fixture.result.media[0]!.expires_at = '2020-01-01T00:00:00Z'; await h.query();
    expect(h.ready().node.scripts.every(script => !script.canCopy)).toBe(true);
    await h.runtime.finish(); h.fixture.result.media[0]!.binding.flowKey = { ...h.fixture.result.flow.header.key, flowId: 'other-flow' };
    expect((await h.query()).ok).toBe(false); expect(h.runtime.projection().node).toBeNull(); expect(h.copies).toEqual([]);
  });
  it('discards an in-flight copy after explicit logout', async () => {
    const h = await setup(); await h.query(); let release!: () => void;
    h.state.delay = new Promise<void>(resolve => { release = resolve; });
    const pending = h.runtime.command({ kind: 'copy', key: h.ready().node.scripts[0]!.key });
    await vi.waitFor(() => expect(h.requests.some(r => r.path.includes('/media/'))).toBe(true));
    h.logout(); release(); await pending;
    expect(h.copies).toEqual([]); expect(h.runtime.projection().node).toBeNull();
  });
});

// This lane consumes real loopback HTTP and formal v12 schemas. The host is a contract double.
describe('v12 Main query and continuation binding', () => {
  it('uses the complete current ordinary E and keeps Q and numeric generation distinct', async () => {
    const h = await setup(true, 'v12');
    expect((await h.query()).ok).toBe(true);
    const issue = h.requests.find(request => request.path === '/v1/intake/entitlements')!;
    expect(issue.body).toEqual({ shopId: h.fixture.entitlement.shopId,
      productIds: ['product-a', 'product-b'], scenarioIds: ['scenario-a', 'scenario-b'], contextGeneration: 1, releaseId: null });
    const query = parseV12('MenokinSopQuerySopQueryRequest', h.requests.find(request => request.path === '/v1/sop/query')!.body);
    const opening = parseV12('IntakeSopActionCheck', h.requests.find(request => request.path.endsWith('/check'))!.body);
    expect(opening.entitlementId).toBe(query.entitlement_id);
    expect(opening.queryRequestId).toBe(query.request_id);
    expect(opening.contextGeneration).toBe(1);
    expect(query.context_generation).not.toBe(String(opening.contextGeneration));
    expect(query.context_generation).not.toBe(query.request_id);
    expect(JSON.stringify(h.ready())).not.toContain(query.request_id);
    expect(JSON.stringify(h.ready())).not.toContain(query.entitlement_id);
    expect((await h.runtime.command({ kind: 'copy', key: h.ready().node.scripts[0]!.key })).ok).toBe(true);
    const copy = parseV12('IntakeSopActionCheck', h.requests.filter(request => request.path.endsWith('/check')).at(-1)!.body);
    expect(copy).toMatchObject({ action: 'copy', queryRequestId: null });
    expect(copy.entitlementId).not.toBe(opening.entitlementId);
    expect(h.copies).toEqual([h.fixture.result.entries[0]!.entry.answerText]);
  });

  it('retries a lost query response with its original Q, E, body and committed result', async () => {
    const h = await setup(true, 'v12');
    h.state.dropQuery = true;
    expect((await h.startQuery()).ok).toBe(false);
    expect(h.runtime.projection()).toMatchObject({ state: 'paused', node: null });
    const original = h.requests.find(request => request.path === '/v1/sop/query')!.body;
    h.state.dropQuery = false;
    expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(true);
    await h.settledMedia();
    expect(h.requests.filter(request => request.path === '/v1/sop/query').map(request => request.body)).toEqual([original, original]);
    expect(h.requests.filter(request => request.path === '/v1/intake/entitlements')).toHaveLength(1);
    expect(h.queries.size).toBe(1);
    expect(h.ready().node.title).toBe(h.fixture.result.flow.nodes[0]!.body.title);
  });

  it('replays a committed open using original Q and E after short expiry and a new publication', async () => {
    const h = await setup(true, 'v12');
    h.state.dropOpen = true;
    expect((await h.startQuery()).ok).toBe(false);
    const original = parseV12('IntakeSopActionCheck', h.requests.find(request => request.path.endsWith('/check'))!.body);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 300_001);
    h.state.releaseId = 'synthetic-new-current'; h.state.dropOpen = false;
    expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(true);
    await h.settledMedia();
    const replay = parseV12('IntakeSopActionCheck', h.requests.filter(request => request.path.endsWith('/check')).at(-1)!.body);
    expect(replay).toEqual(original);
    expect(h.requests.filter(request => request.path === '/v1/sop/query')).toHaveLength(1);
    expect(h.requests.filter(request => request.path.endsWith('/renew'))).toHaveLength(0);
    expect(h.continuations.get(original.continuationId)?.releaseId).toBe(original.releaseId);
    expect(h.ready().state).toBe('ready');
  });

  it('keeps active progress when the Query owner changes selection and renews with null Q', async () => {
    const h = await setup(true, 'v12'); await h.query();
    await h.runtime.command({ kind: 'confirm', key: h.ready().node.requirements[0]!.key });
    h.usage.select({ shopId: h.fixture.entitlement.shopId, productIds: ['different-product'], scenarioIds: [] });
    h.state.releaseId = 'synthetic-new-current';
    expect((await h.runtime.command({ kind: 'refresh' })).ok).toBe(true);
    expect(h.ready().node.requirements[0]!.confirmed).toBe(true);
    const observe = parseV12('IntakeSopActionCheck', h.requests.filter(request => request.path.endsWith('/check')).at(-1)!.body);
    expect(observe).toMatchObject({ action: 'observe', queryRequestId: null, releaseId: h.fixture.entitlement.releaseId });
    const renew = h.requests.find(request => request.path.endsWith('/renew'))!;
    expect(Object.keys(parseV12('IntakeSopContinuationRenew', renew.body)).sort()).toEqual(['contextGeneration', 'continuationId']);
  });

  it.each(['selection', 'destroy'] as const)('rejects a delayed ready after %s without opening or copying it', async change => {
    const h = await setup(true, 'v12');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const query = h.port.query.bind(h.port);
    vi.spyOn(h.port, 'query').mockImplementation(async (...args) => { const response = await query(...args); await gate; return response; });
    const pending = h.startQuery();
    await vi.waitFor(() => expect(h.queries.size).toBe(1));
    if (change === 'selection') h.usage.select({ shopId: h.fixture.entitlement.shopId, productIds: ['new-product'], scenarioIds: [] });
    else h.runtime.invalidate();
    release(); expect((await pending).ok).toBe(false);
    expect(h.runtime.projection().node).toBeNull();
    expect(h.requests.filter(request => request.path.endsWith('/check'))).toHaveLength(0);
    expect(h.copies).toEqual([]);
  });

  it('allocates a new Q and ordinary E for a new user query at the same graph digest', async () => {
    const h = await setup(true, 'v12'); await h.query();
    expect((await h.query()).ok).toBe(true);
    const queries = h.requests.filter(request => request.path === '/v1/sop/query').map(request => parseV12('MenokinSopQuerySopQueryRequest', request.body));
    expect(queries).toHaveLength(2);
    expect(queries[1]!.request_id).not.toBe(queries[0]!.request_id);
    expect(queries[1]!.entitlement_id).not.toBe(queries[0]!.entitlement_id);
    expect(h.queries.size).toBe(2);
    expect(h.continuations.size).toBe(2);
  });
});
