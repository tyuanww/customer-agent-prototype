// @vitest-environment node
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductAnnounce } from '../../src/main/product-announce';
import { ProductSession } from '../../src/main/product-session';
import { ProductHttp } from '../../src/main/product-http';
import { readProductClientId } from '../../src/main/product-client-id';
import { isProductAnnounceResult, isProductAnnounceInvalidation } from '../../src/shared/product-announce';

const token = 't'.repeat(43);
const leaseToken = `osl_${'c'.repeat(64)}`;
const releaseId = 'rel-synthetic-001';
const hash = 'b'.repeat(64);
const expiresAt = () => new Date(Date.now() + 600_000).toISOString();
function currentBody(expiry = expiresAt(), seq = 13) {
  return {
    current_release_id: releaseId, release_seq: seq, source_binding_hash: hash,
    offline_lease: { token: leaseToken, expires_at: expiry, release_id: releaseId, source_binding_hash: hash },
    announcement: { title: '合成公告', summary: '只读', created_at: '2026-09-09T00:00:00.000Z' },
  };
}
function snapshotBody(cursor: string | null = null, id = releaseId, seq = 13) {
  return {
    release_id: id, release_seq: seq, source_binding_hash: hash,
    offline_lease: { token: leaseToken, expires_at: expiresAt(), release_id: id, source_binding_hash: hash },
    items: [], next_cursor: cursor,
  };
}
async function setup(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
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
  const announce = new ProductAnnounce(session, 'desk_' + 'a'.repeat(32));
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
        return Response.json(snapshotBody());
      }
      return new Response(null, { status: 404 });
    });
    const result = await f.announce.refresh(f.identity);
    expect(result).toMatchObject({ ok: true, releaseId, releaseSeq: 13, leaseExpiresAt: expiry, announcement: { title: '合成公告' } });
    expect(JSON.stringify(result)).not.toContain(leaseToken);
    expect(isProductAnnounceResult(result)).toBe(true);
    expect(acks[0]).toMatchObject({ client_id: 'desk_' + 'a'.repeat(32), release_id: releaseId, release_seq: 13, offline_lease_token: leaseToken });
    expect(result.ok && result.leaseExpiresAt).toBe(expiry);
    expect(f.announce.allows(releaseId)).toBe(true);
    await f.session.status();
    expect(f.announce.allows(releaseId)).toBe(true);
    await f.session.logout();
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
});

describe('install-stable client id', () => {
  it('reuses a generated plaintext identifier and rejects renderer-shaped values', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'desktop-client-id-'));
    const first = readProductClientId(directory);
    expect(first).toMatch(/^desk_[0-9a-f]{32}$/);
    expect(readProductClientId(directory)).toBe(first);
    expect(readFileSync(path.join(directory, 'product-client-id'), 'utf8')).toContain(first);
  });
});
