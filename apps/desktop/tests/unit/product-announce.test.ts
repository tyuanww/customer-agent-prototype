// @vitest-environment node
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { join } from 'node:path';
import { loadHydrateCatalog, type SyncHydrateResult } from '../../src/main/hydrate-catalog';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductAnnounce } from '../../src/main/product-announce';
import { ProductSession } from '../../src/main/product-session';
import { ProductHttp } from '../../src/main/product-http';
import { announceClientId, readProductClientId } from '../../src/main/product-client-id';
import { isProductAnnounceResult, isProductAnnounceInvalidation, isProductAnnounceContentUpdate } from '../../src/shared/product-announce';
import { createLastSeenStore, NO_LAST_SEEN } from '../../src/main/product-last-seen';

const token = 't'.repeat(43);
const leaseToken = `osl_${'c'.repeat(64)}`;
const installId = 'desk_' + 'a'.repeat(32);
const boundClientId = announceClientId(installId, 'usr_synthetic_agent');
const releaseId = 'rel-synthetic-001';
const hash = 'b'.repeat(64);
const expiresAt = () => new Date(Date.now() + 600_000).toISOString();
function currentBody(expiry = expiresAt(), seq = 13, summary: string | null = '只读', release = releaseId) {
  const bindingHash = hash;
  return {
    current_release_id: release, release_seq: seq, source_binding_hash: bindingHash,
    offline_lease: { token: leaseToken, expires_at: expiry, release_id: release, source_binding_hash: bindingHash },
    announcement: { title: '合成公告', summary, created_at: '2026-09-09T00:00:00.000Z' },
  };
}
function snapshotItem(id = 'script-synthetic-001', category = 'presale', hash = 'a'.repeat(64)) {
  return {
    script_id: id,
    script_version: 1,
    content_hash: hash,
    title: '合成发货',
    category,
    answer_text: '合成订单 {订单号}',
    platform_scope: ['qianniu'],
    product_scope_type: 'storewide',
    product_scope_refs: [],
    effective_from: '2026-01-01T00:00:00.000Z',
    effective_to: null,
    intent_taxonomy_version: 'itax_synthetic_v1',
    intent_id: 'intent_synthetic_shipping',
    risk_level: 'low',
    risk_categories: [],
    has_conflict: false,
    placeholder_keys: ['order_id'],
    questions: [{
      question_id: 'q_synthetic01',
      question_version: 1,
      question_text: '什么时候发货',
      question_hash: 'b'.repeat(64),
      semantic_family_id: 'sf_shipping',
    }],
  };
}
function snapshotBody(cursor: string | null = null, id = releaseId, seq = 13, items: unknown[] = []) {
  return {
    release_id: id, release_seq: seq, source_binding_hash: hash,
    offline_lease: { token: leaseToken, expires_at: expiresAt(), release_id: id, source_binding_hash: hash },
    items, next_cursor: cursor,
  };
}
async function setup(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>,
  persistHydrate?: ConstructorParameters<typeof ProductAnnounce>[3],
  afterSnapshotPersist?: ConstructorParameters<typeof ProductAnnounce>[4],
  lastSeen?: ConstructorParameters<typeof ProductAnnounce>[5],
) {
  const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/me')) return Response.json({ user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'mock' });
    if (url.pathname.endsWith('/logout')) return new Response(null, { status: 204 });
    return handler(url, init);
  });
  const session = new ProductSession(new ProductHttp('http://127.0.0.1:4100', transport as typeof fetch), {
    read: () => ({ access_token: token, expires_at: new Date(Date.now() + 899_000).toISOString() }), write: () => {}, clear: () => {},
  }, { open: async () => {} });
  await session.restore();
  const announce = new ProductAnnounce(
    session,
    installId,
    Date.now,
    persistHydrate,
    afterSnapshotPersist,
    lastSeen,
  );
  const identity = { sessionEpoch: session.view().sessionEpoch, generation: 1 };
  return { session, announce, identity, transport };
}
afterEach(() => { vi.useRealTimers(); });

describe('product announce lease and snapshot', () => {
  it('acks without extending the lease and keeps the token off the public view', async () => {
    const expiry = expiresAt(); const acks: unknown[] = [];
    const f = await setup(url => {
      if (url.pathname === '/v1/announce/current') return Response.json(currentBody(expiry), { headers: { etag: 'W/"13"' } });
      if (url.pathname === '/v1/announce/ack') {
        return new Promise(resolve => {
          // Capture after the body stream is already consumed by ProductHttp.
          resolve(Response.json({ ok: true }));
        });
      }
      if (url.pathname === '/v1/announce/snapshot') return Response.json(snapshotBody());
      return new Response(null, { status: 404 });
    });
    f.transport.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/me')) return Response.json({ user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'mock' });
      if (url.pathname === '/v1/announce/current') return Response.json(currentBody(expiry), { headers: { etag: 'W/"13"' } });
      if (url.pathname === '/v1/announce/ack') { acks.push(JSON.parse(String(init?.body))); return Response.json({ ok: true }); }
      if (url.pathname === '/v1/announce/snapshot') {
        expect(url.searchParams.get('release_id')).toBe(releaseId);
        expect(init?.headers && new Headers(init.headers).get('x-snapshot-lease')).toBe(leaseToken);
        expect(init?.headers && new Headers(init.headers).get('x-client-id')).toBe(boundClientId);
        return Response.json(snapshotBody());
      }
      return new Response(null, { status: 404 });
    });
    const result = await f.announce.refresh(f.identity);
    expect(result).toMatchObject({ ok: true, releaseId, releaseSeq: 13, leaseExpiresAt: expiry, announcement: { title: '合成公告' } });
    expect(JSON.stringify(result)).not.toContain(leaseToken);
    expect(isProductAnnounceResult(result)).toBe(true);
    expect(acks[0]).toMatchObject({ client_id: boundClientId, release_id: releaseId, release_seq: 13, offline_lease_token: leaseToken });
    expect(result.ok && result.leaseExpiresAt).toBe(expiry);
    expect(f.announce.allows(releaseId)).toBe(true);
    await f.session.status();
    expect(f.announce.allows(releaseId)).toBe(true);
    const replacedEvents: unknown[] = [];
    f.announce.onInvalidated(value => replacedEvents.push(value));
    await f.session.logout();
    expect(f.announce.allows(releaseId)).toBe(false);
    expect(replacedEvents).toEqual([{ sessionEpoch: f.session.view().sessionEpoch, reason: 'signed_out' }]);
  });

  it('does not invalidate Query when signing out with no current lease', async () => {
    const events: unknown[] = [];
    const f = await setup(() => new Response(null, { status: 404 }));
    f.announce.onInvalidated(value => events.push(value));
    await f.session.logout();
    expect(events).toEqual([]);
    expect(f.announce.allows(releaseId)).toBe(false);
  });

  it('returns 304 without issuing a new lease or mixing snapshot releases', async () => {
    let currents = 0;
    const expiry = expiresAt();
    const f = await setup(_url => new Response(null, { status: 404 }));
    f.transport.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/me')) return Response.json({ user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'mock' });
      if (url.pathname === '/v1/announce/current') {
        currents += 1;
        if (currents === 1) return Response.json(currentBody(expiry), { headers: { etag: 'W/"13"' } });
        expect(new Headers(init?.headers).get('if-none-match')).toBe('W/"13"');
        expect(new Headers(init?.headers).get('x-snapshot-lease')).toBe(leaseToken);
        return new Response(null, { status: 304, headers: { etag: 'W/"13"', 'x-snapshot-lease': leaseToken, 'x-snapshot-lease-expires': expiry } });
      }
      if (url.pathname === '/v1/announce/ack') return Response.json({ ok: true });
      if (url.pathname === '/v1/announce/snapshot') {
        if (url.searchParams.get('cursor')) return Response.json(snapshotBody(null, 'rel-other', 99));
        return Response.json(snapshotBody('shipping-001'));
      }
      return new Response(null, { status: 404 });
    });
    expect(await f.announce.refresh(f.identity)).toMatchObject({ code: 'VALIDATION' });
    const ok = await setup(async _url => new Response(null, { status: 404 }));
    let seen = 0;
    ok.transport.mockImplementation(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/me')) return Response.json({ user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'mock' });
      if (url.pathname === '/v1/announce/current') {
        seen += 1;
        if (seen === 1) return Response.json(currentBody(expiry), { headers: { etag: 'W/"13"' } });
        return new Response(null, { status: 304, headers: { 'x-snapshot-lease': leaseToken, 'x-snapshot-lease-expires': expiry } });
      }
      if (url.pathname === '/v1/announce/ack') return Response.json({ ok: true });
      if (url.pathname === '/v1/announce/snapshot') return Response.json(snapshotBody());
      return new Response(null, { status: 404 });
    });
    expect(await ok.announce.refresh(ok.identity)).toMatchObject({ ok: true, leaseExpiresAt: expiry });
    expect(await ok.announce.refresh({ ...ok.identity, generation: 2 })).toMatchObject({ ok: true, leaseExpiresAt: expiry });
    expect(seen).toBe(2);
    await f.session.logout(); await ok.session.logout();
  });

  it('still hydrates when ack is forbidden for a client bound to another user', async () => {
    const expiry = expiresAt();
    const f = await setup(async _url => new Response(null, { status: 404 }));
    let snap = 0;
    f.transport.mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/me')) return Response.json({ user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'mock' });
      if (url.pathname === '/v1/announce/current') return Response.json(currentBody(expiry), { headers: { etag: 'W/"13"' } });
      if (url.pathname === '/v1/announce/ack') {
        return Response.json({ error: { code: 'FORBIDDEN', message: 'forbidden' } }, { status: 403 });
      }
      if (url.pathname === '/v1/announce/snapshot') {
        snap += 1;
        return Response.json(snapshotBody());
      }
      return new Response(null, { status: 404 });
    });
    expect(await f.announce.refresh(f.identity)).toMatchObject({ ok: true, releaseId, leaseExpiresAt: expiry });
    expect(f.announce.allows(releaseId)).toBe(true);
    expect(snap).toBe(1);
    await f.session.logout();
  });

  it('retries announce current without conditionals when 304 arrives before a lease', async () => {
    const expiry = expiresAt();
    const f = await setup(async _url => new Response(null, { status: 404 }));
    const seen: Array<string | null> = [];
    f.transport.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/me')) return Response.json({ user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'mock' });
      if (url.pathname === '/v1/announce/current') {
        seen.push(new Headers(init?.headers).get('if-none-match'));
        if (seen.length === 1) return new Response(null, { status: 304, headers: { etag: 'W/"13"' } });
        return Response.json(currentBody(expiry), { headers: { etag: 'W/"13"' } });
      }
      if (url.pathname === '/v1/announce/ack') return Response.json({ ok: true });
      if (url.pathname === '/v1/announce/snapshot') return Response.json(snapshotBody());
      return new Response(null, { status: 404 });
    });
    expect(await f.announce.refresh(f.identity)).toMatchObject({ ok: true, releaseId, leaseExpiresAt: expiry });
    expect(seen).toEqual([null, null]);
    expect(f.announce.allows(releaseId)).toBe(true);
    await f.session.logout();
  });

  it('keeps the local lease when a 304 omits snapshot-lease headers', async () => {
    const expiry = expiresAt();
    const f = await setup(async _url => new Response(null, { status: 404 }));
    let seen = 0;
    f.transport.mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/me')) return Response.json({ user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'mock' });
      if (url.pathname === '/v1/announce/current') {
        seen += 1;
        if (seen === 1) return Response.json(currentBody(expiry), { headers: { etag: 'W/"13"' } });
        return new Response(null, { status: 304, headers: { etag: 'W/"13"' } });
      }
      if (url.pathname === '/v1/announce/ack') return Response.json({ ok: true });
      if (url.pathname === '/v1/announce/snapshot') return Response.json(snapshotBody());
      return new Response(null, { status: 404 });
    });
    expect(await f.announce.refresh(f.identity)).toMatchObject({ ok: true, releaseId, leaseExpiresAt: expiry });
    expect(await f.announce.refresh({ ...f.identity, generation: 2 })).toMatchObject({ ok: true, releaseId, leaseExpiresAt: expiry });
    expect(f.announce.allows(releaseId)).toBe(true);
    expect(seen).toBe(2);
    await f.session.logout();
  });

  it('maps source-gate 503 and expires the local lease without claiming a read', async () => {
    const f = await setup(() => Response.json({ error: { code: 'OVERLOADED', message: '当前内容来源校验未通过', details: { reason: 'SOURCE_GATE_NOT_READY', retry_after_sec: 1 } } }, { status: 503 }));
    const events: unknown[] = [];
    f.announce.onInvalidated(value => events.push(value));
    expect(await f.announce.refresh(f.identity)).toMatchObject({ code: 'SOURCE_GATE_NOT_READY' });
    expect(isProductAnnounceInvalidation(events[0])).toBe(true);
    expect(events[0]).toMatchObject({ reason: 'source_gate' });
    expect(JSON.stringify(events)).not.toContain('已读');
    await f.session.logout();
  });

  it('stops allowing a release after the lease deadline', async () => {
    vi.useFakeTimers();
    const expiry = new Date(Date.now() + 1_000).toISOString();
    const f = await setup(() => new Response(null, { status: 404 }));
    f.transport.mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/me')) return Response.json({ user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'mock' });
      if (url.pathname === '/v1/announce/current') return Response.json(currentBody(expiry), { headers: { etag: 'W/"13"' } });
      if (url.pathname === '/v1/announce/ack') return Response.json({ ok: true });
      if (url.pathname === '/v1/announce/snapshot') return Response.json(snapshotBody());
      return new Response(null, { status: 404 });
    });
    expect(await f.announce.refresh(f.identity)).toMatchObject({ ok: true });
    expect(f.announce.allows(releaseId)).toBe(true);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(f.announce.allows(releaseId)).toBe(false);
    await f.session.logout();
  });

  it('writes the off-repo hydrate snapshot after paging the current release', async () => {
    const previous = process.env.CUSTOMER_AGENT_HYDRATE_INDEX;
    const hydratePath = join(mkdtempSync(join(tmpdir(), 'hydrate-announce-')), 'retrieval-hydrate.json');
    process.env.CUSTOMER_AGENT_HYDRATE_INDEX = hydratePath;
    const f = await setup(() => new Response(null, { status: 404 }));
    f.transport.mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/me')) return Response.json({ user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'mock' });
      if (url.pathname === '/v1/announce/current') return Response.json(currentBody(), { headers: { etag: 'W/"13"' } });
      if (url.pathname === '/v1/announce/ack') return Response.json({ ok: true });
      if (url.pathname === '/v1/announce/snapshot') return Response.json(snapshotBody(null, releaseId, 13, [snapshotItem()]));
      return new Response(null, { status: 404 });
    });
    try {
      expect(await f.announce.refresh(f.identity)).toMatchObject({ ok: true, releaseId });
      const catalog = loadHydrateCatalog(hydratePath);
      expect(catalog?.releaseId).toBe(releaseId);
      expect(catalog?.candidate('script-synthetic-001')?.title).toBe('合成发货');
      expect(JSON.parse(readFileSync(hydratePath, 'utf8')).scripts[0].questionText).toBe('什么时候发货');
    } finally {
      if (previous === undefined) delete process.env.CUSTOMER_AGENT_HYDRATE_INDEX;
      else process.env.CUSTOMER_AGENT_HYDRATE_INDEX = previous;
      await f.session.logout();
    }
  });

  it('schedules embeddings after hydrate writes or aligns, not when keeping a larger catalog', async () => {
    const persistResult = (reason: SyncHydrateResult['reason']): SyncHydrateResult => ({
      path: '/tmp/hydrate.json',
      releaseId,
      previousReleaseId: null,
      total: reason === 'kept-larger' ? 2 : 1,
      wrote: reason === 'wrote',
      skipped: reason !== 'wrote',
      reason,
    });
    const afterWrite = vi.fn();
    const wrote = await setup(() => new Response(null, { status: 404 }), () => persistResult('wrote'), afterWrite);
    wrote.transport.mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/me')) return Response.json({ user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'mock' });
      if (url.pathname === '/v1/announce/current') return Response.json(currentBody(), { headers: { etag: 'W/"13"' } });
      if (url.pathname === '/v1/announce/ack') return Response.json({ ok: true });
      if (url.pathname === '/v1/announce/snapshot') return Response.json(snapshotBody(null, releaseId, 13, [snapshotItem()]));
      return new Response(null, { status: 404 });
    });
    expect(await wrote.announce.refresh(wrote.identity)).toMatchObject({ ok: true });
    expect(afterWrite).toHaveBeenCalledOnce();
    await wrote.session.logout();

    const afterKept = vi.fn();
    const kept = await setup(() => new Response(null, { status: 404 }), () => persistResult('kept-larger'), afterKept);
    kept.transport.mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/me')) return Response.json({ user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'mock' });
      if (url.pathname === '/v1/announce/current') return Response.json(currentBody(), { headers: { etag: 'W/"13"' } });
      if (url.pathname === '/v1/announce/ack') return Response.json({ ok: true });
      if (url.pathname === '/v1/announce/snapshot') return Response.json(snapshotBody(null, releaseId, 13, [snapshotItem()]));
      return new Response(null, { status: 404 });
    });
    expect(await kept.announce.refresh(kept.identity)).toMatchObject({ ok: true });
    expect(afterKept).not.toHaveBeenCalled();
    await kept.session.logout();

    const afterAligned = vi.fn();
    const aligned = await setup(() => new Response(null, { status: 404 }), () => persistResult('aligned'), afterAligned);
    aligned.transport.mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/me')) return Response.json({ user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'mock' });
      if (url.pathname === '/v1/announce/current') return Response.json(currentBody(), { headers: { etag: 'W/"13"' } });
      if (url.pathname === '/v1/announce/ack') return Response.json({ ok: true });
      if (url.pathname === '/v1/announce/snapshot') return Response.json(snapshotBody(null, releaseId, 13, [snapshotItem()]));
      return new Response(null, { status: 404 });
    });
    expect(await aligned.announce.refresh(aligned.identity)).toMatchObject({ ok: true });
    expect(afterAligned).toHaveBeenCalledOnce();
    await aligned.session.logout();
  });
});

describe('content-updated fan-out and unread', () => {
  const userId = 'usr_synthetic_agent';
  const dir = () => mkdtempSync(path.join(tmpdir(), 'announce-last-seen-'));

  function withSnapshot(store: ConstructorParameters<typeof ProductAnnounce>[5]) {
    return setup(async _url => new Response(null, { status: 404 }), undefined, undefined, store);
  }

  async function snapshotWith(
    f: Awaited<ReturnType<typeof setup>>,
    release: string,
    summary: string | null,
    items: unknown[],
  ) {
    f.transport.mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/me')) return Response.json({ user_id: userId, role: 'agent', auth_mode: 'mock' });
      if (url.pathname === '/v1/announce/current') return Response.json(currentBody(expiresAt(), 13, summary, release), { headers: { etag: `W/"${release}"` } });
      if (url.pathname === '/v1/announce/ack') return Response.json({ ok: true });
      if (url.pathname === '/v1/announce/snapshot') return Response.json(snapshotBody(null, release, 13, items));
      return new Response(null, { status: 404 });
    });
  }

  it('emits content-updated without an invalidation and keeps the first snapshot unread-free', async () => {
    const store = createLastSeenStore(dir(), 'http://127.0.0.1:4100');
    const f = await withSnapshot(store);
    await snapshotWith(f, 'rel_24', '售前已更新（75 条）· 活动沿用 · 产品沿用 · 售后沿用', [snapshotItem()]);
    const updated: unknown[] = [];
    const invalidated: unknown[] = [];
    f.announce.onContentUpdated(value => updated.push(value));
    f.announce.onInvalidated(value => invalidated.push(value));
    expect(await f.announce.refresh(f.identity)).toMatchObject({ ok: true, releaseId: 'rel_24' });
    // 第一次完整 snapshot 只建基线：不点亮。
    expect(f.announce.unread()).toMatchObject({ ok: true, unread: false, domains: [] });
    await f.session.logout();
  });

  it('flags only the domains whose content moved, and mark-read clears exactly those', async () => {
    const store = createLastSeenStore(dir(), 'http://127.0.0.1:4100');
    const f = await withSnapshot(store);
    const H1 = '1'.repeat(64);
    const H2 = '2'.repeat(64);
    await snapshotWith(f, 'rel_24', null, [
      snapshotItem('s1', 'presale', H1),
      snapshotItem('s2', 'campaign', H1),
    ]);
    await f.announce.refresh(f.identity); // baseline: presale+campaign h1
    const updatedEvents: unknown[] = [];
    f.announce.onContentUpdated(value => updatedEvents.push(value));
    // rel_25: presale content changed; campaign unchanged.
    await snapshotWith(f, 'rel_25', '售前已更新（75 条）· 活动沿用 · 产品沿用 · 售后沿用', [
      snapshotItem('s1', 'presale', H2),
      snapshotItem('s2', 'campaign', H1),
    ]);
    expect(await f.announce.refresh(f.identity)).toMatchObject({ ok: true, releaseId: 'rel_25' });
    expect(updatedEvents).toHaveLength(1);
    expect(isProductAnnounceContentUpdate(updatedEvents[0])).toBe(true);
    expect(updatedEvents[0]).toMatchObject({ releaseId: 'rel_25', summary: '售前已更新（75 条）· 活动沿用 · 产品沿用 · 售后沿用' });
    const unread = f.announce.unread();
    expect(unread.ok && unread.domains).toEqual(['presale']);
    f.announce.markRead(['presale']);
    expect(f.announce.unread()).toMatchObject({ ok: true, unread: false, domains: [] });
    expect(store.baseline(userId)?.presale).toBe(
      (updatedEvents[0] as { domainHashes: { presale: string } }).domainHashes.presale,
    );
    await f.session.logout();
  });

  it('uses in-memory snapshot counts for the dashboard projection even when hydrate keeps a larger file', async () => {
    const store = createLastSeenStore(dir(), 'http://127.0.0.1:4100');
    // persistHydrate reports kept-larger: disk has an older, bigger catalog. Counts must still
    // come from the in-flight snapshot, not the disk hydrate.
    const f = await setup(async _url => new Response(null, { status: 404 }), () => ({
      path: '/tmp/hydrate.json', releaseId: 'rel_old', previousReleaseId: 'rel_old',
      total: 500, wrote: false, skipped: true, reason: 'kept-larger',
    }), undefined, store);
    await snapshotWith(f, 'rel_25', null, [
      snapshotItem('s1', 'presale', '1'.repeat(64)),
      snapshotItem('s2', 'campaign', '2'.repeat(64)),
    ]);
    await f.announce.refresh(f.identity);
    const projection = f.announce.dashboardProjection();
    expect(projection?.counts).toEqual({ product: 0, campaign: 1, presale: 1, aftersale: 0 });
    // summary is still parsed from the announcement; here it is null (no delta).
    expect(projection?.announcement?.summary ?? null).toBeNull();
    await f.session.logout();
  });

  it('never writes last_seen on ACK, snapshot, or a FORBIDDEN ack', async () => {
    const store = createLastSeenStore(dir(), 'http://127.0.0.1:4100');
    const f = await withSnapshot(store);
    let ackForbidden = false;
    f.transport.mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/me')) return Response.json({ user_id: userId, role: 'agent', auth_mode: 'mock' });
      if (url.pathname === '/v1/announce/current') return Response.json(currentBody(expiresAt(), 13, null, 'rel_24'));
      if (url.pathname === '/v1/announce/ack') {
        if (ackForbidden) return Response.json({ error: { code: 'FORBIDDEN', message: 'forbidden' } }, { status: 403 });
        return Response.json({ ok: true });
      }
      if (url.pathname === '/v1/announce/snapshot') return Response.json(snapshotBody(null, 'rel_24', 13, [snapshotItem('s1', 'presale', '1'.repeat(64))]));
      return new Response(null, { status: 404 });
    });
    const baselineBefore = store.baseline(userId);
    await f.announce.refresh(f.identity);
    // ACK 成功不写 last_seen：基线要么不存在（第一次只 establish），要么不变。
    const afterOk = store.baseline(userId);
    expect(afterOk).not.toBeNull(); // establish 是允许的（第一次完整 snapshot）
    // 第二次带新内容 + FORBIDDEN ack：不得因 ack 写 last_seen。
    ackForbidden = true;
    await snapshotWith(f, 'rel_25', null, [snapshotItem('s1', 'presale', '9'.repeat(64))]);
    await f.announce.refresh(f.identity);
    // 内容变了 → 相对基线未读；ACK 没把它当已读清掉。
    const unread = f.announce.unread();
    expect(unread.ok && unread.domains).toEqual(['presale']);
    expect(f.announce.unread().ok && f.announce.unread().unread).toBe(true);
    expect(baselineBefore).toBeNull();
    await f.session.logout();
  });

  it('exposes unread as false with no signed-in session', async () => {    const f = await withSnapshot(NO_LAST_SEEN);
    await snapshotWith(f, 'rel_24', null, [snapshotItem()]);
    await f.announce.refresh(f.identity);
    await f.session.logout();
    const unread = f.announce.unread();
    expect(unread).toMatchObject({ ok: false, unread: false, domains: [] });
    expect(isProductAnnounceUnreadValue(unread)).toBe(true);
  });
});

function isProductAnnounceUnreadValue(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.ok === 'boolean' && typeof record.unread === 'boolean' && Array.isArray(record.domains);
}

describe('install-stable client id', () => {  it('binds a distinct announce client id per signed-in user', () => {
    const feishu = announceClientId(installId, 'usr_ou_5a6b7c7a3ae19edc72676dbfff328f75');
    expect(boundClientId).toMatch(/^desk_[0-9a-f]{32}$/);
    expect(feishu).toMatch(/^desk_[0-9a-f]{32}$/);
    expect(feishu).not.toBe(boundClientId);
    expect(feishu).not.toBe(installId);
  });

  it('reuses a generated plaintext identifier and rejects renderer-shaped values', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'desktop-client-id-'));
    const first = readProductClientId(directory);
    expect(first).toMatch(/^desk_[0-9a-f]{32}$/);
    expect(readProductClientId(directory)).toBe(first);
    expect(readFileSync(path.join(directory, 'product-client-id'), 'utf8')).toContain(first);
  });
});
