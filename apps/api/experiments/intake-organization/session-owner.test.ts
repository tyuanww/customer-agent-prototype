import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createFeishuOrganizationObserver } from './feishu-observer.js';
import { createOrganizationHttpSessionOwner, createOrganizationHttpTransport, type OrganizationAppToken } from './http-transport.js';
import { startSyntheticContactDouble } from './synthetic-contact-double.js';

const scope = { tenantId: 'tenant-a', appId: 'app-a' };
let contact: Awaited<ReturnType<typeof startSyntheticContactDouble>>;
beforeEach(async () => { contact = await startSyntheticContactDouble(); });
afterEach(async () => { await contact.close(); });
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

describe('application-owned organization transport sessions', () => {
  it('shares single-flight credentials while one caller cancels; revocation rotates without clearing quota', async () => {
    let resolveToken!: (token: OrganizationAppToken) => void, calls = 0;
    const owner = createOrganizationHttpSessionOwner({ tokenTimeoutMs: 1_000, supplier: () => ({ current: async () => {
      calls += 1; return new Promise<OrganizationAppToken>(resolve => { resolveToken = resolve; });
    } }) });
    const session = owner.session(scope);
    const first = createOrganizationHttpTransport({ origin: contact.origin, session, requestTimeoutMs: 2_000 });
    const second = createOrganizationHttpTransport({ origin: contact.origin, session: owner.session(scope), requestTimeoutMs: 2_000 });
    const cancel = new AbortController();
    const a = first.jobTitles(undefined, cancel.signal), b = second.jobTitles(undefined, new AbortController().signal);
    await tick(); cancel.abort();
    await expect(a).rejects.toMatchObject({ code: 'CANCELLED' });
    resolveToken({ token: 'synthetic-one', expiresAtMs: Date.now() + 60_000 });
    await b;
    expect(calls).toBe(1);
    for (let index = 0; index < 9; index++) await first.jobTitles(undefined, new AbortController().signal);
    session.invalidate();
    const fresh = createOrganizationHttpTransport({ origin: contact.origin, session: owner.session(scope), requestTimeoutMs: 2_000 });
    const denied = fresh.jobTitles(undefined, new AbortController().signal);
    await tick(); resolveToken({ token: 'synthetic-two', expiresAtMs: Date.now() + 60_000 });
    await expect(denied).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(contact.requests).toHaveLength(10);
    expect(calls).toBe(2);
  });

  it('bounds an uncooperative token supplier and rejects a late token after revocation', async () => {
    let resolveToken!: (token: OrganizationAppToken) => void;
    const owner = createOrganizationHttpSessionOwner({ tokenTimeoutMs: 30, supplier: () => ({ current: () => new Promise(resolve => { resolveToken = resolve; }) }) });
    const session = owner.session(scope);
    const pending = session.current(new AbortController().signal);
    await tick(); session.invalidate();
    await expect(pending).rejects.toMatchObject({ code: 'TOKEN_UNAVAILABLE' });
    resolveToken({ token: 'synthetic-late', expiresAtMs: Date.now() + 60_000 });
    await tick();
    expect(() => session.assertCurrent({ token: 'synthetic-late' })).toThrow('TOKEN_UNAVAILABLE');
    await expect(session.current(new AbortController().signal)).rejects.toMatchObject({ code: 'TOKEN_UNAVAILABLE' });
    expect(contact.requests).toHaveLength(0);
  });

  it('separates app quota and checks token expiry again after reading the HTTP response', async () => {
    let now = 1_700_000_000_000;
    const owner = createOrganizationHttpSessionOwner({ tokenTimeoutMs: 1_000, now: () => now,
      supplier: () => ({ current: async () => ({ token: 'synthetic-token', expiresAtMs: now + 1_000 }) }) });
    const client = (appId: string) => createOrganizationHttpTransport({ origin: contact.origin, session: owner.session({ ...scope, appId }), requestTimeoutMs: 1_000 });
    for (let index = 0; index < 10; index++) await client('app-a').jobTitles(undefined, new AbortController().signal);
    await expect(client('app-a').jobTitles(undefined, new AbortController().signal)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await client('app-b').jobTitles(undefined, new AbortController().signal);
    contact.onRequest = () => { now += 1_000; };
    await expect(client('app-b').user(contact.user.open_id, new AbortController().signal)).rejects.toMatchObject({ code: 'TOKEN_UNAVAILABLE' });
  });

  it.each([200, 401])('fences a late HTTP %s from a revoked issuance even if token text repeats', async status => {
    let firstResponse: ServerResponse | undefined, calls = 0;
    const server = createServer((_req, response) => {
      if (!firstResponse) { firstResponse = response; return; }
      response.writeHead(200); response.end('{}');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const owner = createOrganizationHttpSessionOwner({ tokenTimeoutMs: 1_000, supplier: () => ({ current: async () => {
      calls++; return { token: 'synthetic-repeated-token', expiresAtMs: Date.now() + 60_000 };
    } }) });
    const session = owner.session(scope);
    const client = createOrganizationHttpTransport({ origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, session, requestTimeoutMs: 2_000 });
    try {
      const old = client.user('synthetic-agent', new AbortController().signal);
      const deadline = Date.now() + 1_000;
      while (!firstResponse && Date.now() < deadline) await tick();
      expect(firstResponse).toBeDefined();
      session.invalidate();
      await client.user('synthetic-agent', new AbortController().signal);
      const current = await session.current(new AbortController().signal);
      firstResponse!.writeHead(status); firstResponse!.end('{}');
      await expect(old).rejects.toMatchObject({ code: status === 401 ? 'AUTH_REJECTED' : 'TOKEN_UNAVAILABLE' });
      expect(() => session.assertCurrent(current)).not.toThrow();
      await client.user('synthetic-agent', new AbortController().signal);
      expect(calls).toBe(2);
    } finally {
      owner.close(); server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it('closes the unique owner and rejects pending supply plus future borrowed clients', async () => {
    const owner = createOrganizationHttpSessionOwner({ tokenTimeoutMs: 1_000,
      supplier: () => ({ current: async () => new Promise<OrganizationAppToken>(() => undefined) }) });
    const session = owner.session(scope), pending = session.current(new AbortController().signal);
    await tick(); owner.close();
    await expect(pending).rejects.toMatchObject({ code: 'TOKEN_UNAVAILABLE' });
    await expect(session.current(new AbortController().signal)).rejects.toMatchObject({ code: 'TOKEN_UNAVAILABLE' });
    expect(() => session.reserve('jobs')).toThrow('TOKEN_UNAVAILABLE');
    expect(() => owner.session(scope)).toThrow('TOKEN_UNAVAILABLE');
    let supplierCalls = 0;
    const closedBeforeStart = createOrganizationHttpSessionOwner({ tokenTimeoutMs: 1_000,
      supplier: () => ({ current: async () => { supplierCalls++; return { token: 'synthetic-token', expiresAtMs: Date.now() + 60_000 }; } }) });
    const queued = closedBeforeStart.session(scope).current(new AbortController().signal);
    closedBeforeStart.close();
    await expect(queued).rejects.toMatchObject({ code: 'TOKEN_UNAVAILABLE' });
    expect(supplierCalls).toBe(0);
  });

  it('does not let a late rejection of an expired lease cancel its pending replacement', async () => {
    let now = 1_700_000_000_000, calls = 0;
    let resolveNext!: (token: OrganizationAppToken) => void;
    const owner = createOrganizationHttpSessionOwner({ tokenTimeoutMs: 1_000, now: () => now,
      supplier: () => ({ current: async () => ++calls === 1 ? { token: 'synthetic-same', expiresAtMs: now + 1_000 }
        : new Promise<OrganizationAppToken>(resolve => { resolveNext = resolve; }) }) });
    const session = owner.session(scope), old = await session.current(new AbortController().signal);
    now += 1_000;
    const replacement = session.current(new AbortController().signal);
    await tick(); session.invalidate(old);
    resolveNext({ token: 'synthetic-same', expiresAtMs: now + 1_000 });
    const fresh = await replacement;
    expect(() => session.assertCurrent(fresh)).not.toThrow();
    expect(() => session.assertCurrent(old)).toThrow('TOKEN_UNAVAILABLE');
    owner.close();
  });

  it.each([5, 6])('handles %i directory pages with the explicit complete five-page scan budget', async pageCount => {
    contact.pages.first = { items: [{ job_title_id: 'j1', name: '合成坐席', status: true }], has_more: true, page_token: 'p2' };
    for (let page = 2; page <= pageCount; page++) contact.pages[`p${page}`] = {
      items: [{ job_title_id: `j${page}`, name: `合成岗位${page}`, status: true }], has_more: page < pageCount, ...(page < pageCount ? { page_token: `p${page + 1}` } : {}),
    };
    const owner = createOrganizationHttpSessionOwner({ tokenTimeoutMs: 1_000,
      supplier: () => ({ current: async () => ({ token: 'synthetic-token', expiresAtMs: Date.now() + 60_000 }) }) });
    const transport = createOrganizationHttpTransport({ origin: contact.origin, session: owner.session(scope), requestTimeoutMs: 1_000 });
    const observe = createFeishuOrganizationObserver(scope, transport, async () => Date.now(), 5);
    const result = await observe({ ...scope, principalId: 'agent', openId: contact.user.open_id, expectedFactsVersion: 1 });
    expect(result).toMatchObject(pageCount === 5 ? { ok: true, snapshot: { jobId: 'j1' } } : { ok: false, reason: 'INCOMPLETE_DIRECTORY' });
    expect(contact.requests.filter(r => r.url.includes('job_titles'))).toHaveLength(pageCount === 5 ? 10 : 5);
    expect(contact.requests.some(r => r.url.includes('page_token=p6'))).toBe(false);
  });
});
