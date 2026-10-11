import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { createFeishuOrganizationObserver } from '../../src/content-intake/organization/feishu-observer.js';
import { createOrganizationHttpTransport, type OrganizationTokenSupplier } from './http-transport.js';
import { startSyntheticContactDouble } from './synthetic-contact-double.js';

const scope = { tenantId: 'tenant-a', appId: 'app-a' };
const started = Date.parse('2026-10-08T00:00:00.000Z');
type Contact = Awaited<ReturnType<typeof startSyntheticContactDouble>>;
let contact: Contact;

beforeEach(async () => { contact = await startSyntheticContactDouble(); });
afterEach(async () => { await contact.close(); });

function tokens(now: () => number = Date.now): OrganizationTokenSupplier & { issued: string[] } {
  const issued: string[] = [];
  return {
    issued,
    async current() {
      const token = `synthetic-app-token-${issued.length + 1}`;
      issued.push(token);
      return { token, expiresAtMs: now() + 60_000 };
    },
  };
}
function transport(supplier: OrganizationTokenSupplier = tokens(), requestTimeoutMs = 1_000, now?: () => number) {
  return createOrganizationHttpTransport({ origin: contact.origin, tokenSupplier: supplier, requestTimeoutMs, ...(now ? { now } : {}) });
}
function thrown(run: () => unknown): unknown {
  try { run(); return undefined; } catch (error) { return error; }
}
async function observe(supplier = tokens(), nowMs = started) {
  const times = [nowMs, nowMs + 120_000];
  const binding = { ...scope, principalId: 'agent', openId: contact.user.open_id, expectedFactsVersion: 1 };
  return createFeishuOrganizationObserver(scope, transport(supplier), async () => times.shift() ?? nowMs)(binding);
}
async function waitFor(ready: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the synthetic contact double');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
function paths() { return contact.requests.map(request => request.url); }

describe('loopback organization transport', () => {
  it('consumes native HTTP pages through the existing observer and pins the deadline to observation start', async () => {
    const supplier = tokens();
    const result = await observe(supplier);
    expect(result).toMatchObject({ ok: true, snapshot: { principalId: 'agent', expectedFactsVersion: 1,
      departmentIds: ['dept-a'], jobId: 'job-agent', enabled: true,
      checkedAt: new Date(started).toISOString(), validUntil: new Date(started + 300_000).toISOString() },
    provenance: { mappingVersion: 'feishu-contact-job-title-v1', observedUntil: new Date(started + 120_000).toISOString() } });
    expect(paths()).toEqual([
      '/open-apis/contact/v3/users/synthetic-open-agent?user_id_type=open_id&department_id_type=open_department_id',
      '/open-apis/contact/v3/job_titles?page_size=50',
      '/open-apis/contact/v3/job_titles?page_size=50&page_token=second',
      '/open-apis/contact/v3/job_titles?page_size=50',
      '/open-apis/contact/v3/job_titles?page_size=50&page_token=second',
      '/open-apis/contact/v3/users/synthetic-open-agent?user_id_type=open_id&department_id_type=open_department_id',
    ]);
    expect(contact.requests.every(request => request.method === 'GET' && request.authorization === 'Bearer synthetic-app-token-1')).toBe(true);
    expect(supplier.issued).toEqual(['synthetic-app-token-1']);
    expect(JSON.stringify(result)).not.toContain('合成坐席甲');
    expect(JSON.stringify(result)).not.toContain('synthetic-not-a-credential@example.invalid');
    expect(paths().some(url => url.includes('/auth/') || url.includes('tenant_access_token') || url.includes('name='))).toBe(false);
  });

  it('does not let a display name or tenant-manager flag choose the job', async () => {
    contact.user.name = '合成组长';
    const result = await observe();
    expect(result).toMatchObject({ ok: true, snapshot: { jobId: 'job-agent', enabled: true, departmentIds: ['dept-a'] } });
    expect(JSON.stringify(result)).not.toContain('is_tenant_manager');
  });

  it('rejects the wrong namespace before any HTTP request', async () => {
    const binding = { ...scope, principalId: 'agent', openId: contact.user.open_id, expectedFactsVersion: 1 };
    const observeOne = createFeishuOrganizationObserver(scope, transport(), async () => started);
    for (const delta of [{ appId: 'other' }, { tenantId: 'other' }, { expectedFactsVersion: 0 }]) {
      expect(await observeOne({ ...binding, ...delta })).toEqual({ ok: false, reason: 'INVALID_BINDING' });
    }
    expect(contact.requests).toHaveLength(0);
  });

  it('rejects a different open_id even when the display name matches', async () => {
    contact.user.open_id = 'synthetic-other';
    const result = await createFeishuOrganizationObserver(scope, transport(), async () => started)(
      { ...scope, principalId: 'agent', openId: 'synthetic-open-agent', expectedFactsVersion: 1 });
    expect(result).toEqual({ ok: false, reason: 'IDENTITY_MISMATCH' });
    expect(result).not.toHaveProperty('snapshot');
  });

  it.each(['', ' 合成坐席', '合成坐席 '])('does not normalize job title %j from the HTTP body', async title => {
    contact.user.job_title = title;
    expect(await observe()).toMatchObject({ ok: false });
    expect(await observe()).not.toHaveProperty('snapshot');
  });

  it('rejects duplicate names, a disabled title, and a missing job title without a snapshot', async () => {
    contact.pages.second!.items.push({ job_title_id: 'job-copy', name: '合成坐席', status: true });
    expect(await observe()).toEqual({ ok: false, reason: 'JOB_UNRESOLVED' });
    contact.pages.second!.items.pop();
    contact.pages.second!.items[0]!.status = false;
    expect(await observe()).toEqual({ ok: false, reason: 'JOB_UNRESOLVED' });
    delete contact.user.job_title;
    const missing = await observe();
    expect(missing).toEqual({ ok: false, reason: 'INVALID_RESPONSE' });
    expect(missing).not.toHaveProperty('snapshot');
  });

  it('rejects a directory or user that changes between the two HTTP scans', async () => {
    let jobs = 0;
    contact.onRequest = request => {
      if (!request.url.startsWith('/open-apis/contact/v3/job_titles')) return;
      if (++jobs === 3) contact.pages.second!.items[0]!.job_title_id = 'job-other';
    };
    expect(await observe()).toEqual({ ok: false, reason: 'OBSERVATION_CHANGED' });
    jobs = 0;
    contact.pages.second!.items[0]!.job_title_id = 'job-agent';
    let users = 0;
    contact.onRequest = request => {
      if (!request.url.startsWith('/open-apis/contact/v3/users/')) return;
      if (++users === 2) contact.user.department_ids = ['dept-b'];
    };
    const changed = await observe();
    expect(changed).toEqual({ ok: false, reason: 'OBSERVATION_CHANGED' });
    expect(changed).not.toHaveProperty('snapshot');
  });

  it('stops on a bad later page, does not retry it, and hides the provider message', async () => {
    contact.onRequest = request => {
      if (request.url.includes('page_token=second')) contact.mode = { kind: 'status', status: 500, body: '{"msg":"secret-message"}' };
    };
    const result = await observe();
    expect(result).toEqual({ ok: false, reason: 'DEPENDENCY_UNAVAILABLE' });
    expect(JSON.stringify(result)).not.toContain('secret-message');
    expect(paths().filter(url => url.includes('page_token=second'))).toHaveLength(1);
    expect(paths().some(url => url.includes('/auth/'))).toBe(false);
  });

  it('treats a logical Feishu failure, HTTP 429, and HTTP 401 as transport failures without their bodies', async () => {
    contact.mode = { kind: 'status', status: 200, body: '{"code":999,"msg":"secret-message"}' };
    expect(JSON.stringify(await observe())).not.toContain('secret-message');
    contact.mode = { kind: 'status', status: 429, body: '{"msg":"secret-message"}' };
    const limited = transport().user('synthetic-open-agent', new AbortController().signal);
    await expect(limited).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(limited).rejects.toThrow(/^RATE_LIMITED$/);
    contact.requests.splice(0);
    contact.mode = { kind: 'status', status: 401, body: '{"msg":"secret-message"}' };
    const denied = transport().user(contact.user.open_id, new AbortController().signal);
    await expect(denied).rejects.toMatchObject({ code: 'AUTH_REJECTED' });
    await expect(denied).rejects.toThrow('AUTH_REJECTED');
    expect(contact.requests).toHaveLength(1);
  });

  it('does not follow a redirect toward Feishu or retry a destroyed socket', async () => {
    contact.mode = { kind: 'redirect', location: 'https://open.feishu.cn/open-apis/contact/v3/users/synthetic-open-agent' };
    const redirected = transport().user('synthetic-open-agent', new AbortController().signal);
    await expect(redirected).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(redirected).rejects.toThrow(/^UNAVAILABLE$/);
    expect(contact.requests).toHaveLength(1);
    contact.requests.splice(0);
    contact.mode = { kind: 'destroy' };
    await expect(transport().jobTitles(undefined, new AbortController().signal)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(contact.requests).toHaveLength(1);
  });

  it.each([401, 403])('invalidates a rejected supplier credential after HTTP %s without retrying the request', async status => {
    const supplier = tokens();
    const client = transport(supplier);
    const signal = new AbortController().signal;
    contact.mode = { kind: 'status', status, body: '{}' };
    await expect(client.user('synthetic-open-agent', signal)).rejects.toMatchObject({ code: 'AUTH_REJECTED' });
    expect(contact.requests).toHaveLength(1);
    contact.mode = { kind: 'status', status: 200, body: '{}' };
    await client.user('synthetic-open-agent', signal);
    expect(supplier.issued).toHaveLength(2);
    expect(contact.requests.map(request => request.authorization)).toEqual([
      'Bearer synthetic-app-token-1', 'Bearer synthetic-app-token-2',
    ]);
  });

  it('does not let a delayed rejection invalidate a newer issuance with the same token text', async () => {
    let nowMs = started;
    let supplierCalls = 0;
    let rejectOld: (() => void) | undefined;
    const server = createServer((request, response) => {
      if (request.url?.includes('/old?')) rejectOld = () => { response.writeHead(401); response.end('{}'); };
      else { response.writeHead(200); response.end('{}'); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const client = createOrganizationHttpTransport({
        origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requestTimeoutMs: 2_000,
        now: () => nowMs, tokenSupplier: { async current() {
          supplierCalls++;
          return { token: 'synthetic-reissued-token', expiresAtMs: nowMs + 1_000 };
        } },
      });
      const signal = new AbortController().signal;
      const old = client.user('old', signal);
      const rejection = expect(old).rejects.toMatchObject({ code: 'AUTH_REJECTED' });
      await waitFor(() => Boolean(rejectOld));
      nowMs += 1_001;
      await client.user('fresh', signal);
      rejectOld!();
      await rejection;
      await client.user('fresh', signal);
      expect(supplierCalls).toBe(2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it.each([false, true])('times out and ignores a late body after cancellation; timeout before HTTP=%s', async (beforeHttp) => {
    contact.mode = { kind: 'hang' };
    const supplier = tokens();
    const timed = transport(beforeHttp ? { async current() {
      // Force the deadline to win before HTTP; the cancellation below must not
      // assume that this first request was observed by the server.
      await new Promise(resolve => setTimeout(resolve, 80));
      return supplier.current();
    } } : supplier, 40).user('synthetic-open-agent', new AbortController().signal);
    await expect(timed).rejects.toMatchObject({ code: 'TIMED_OUT' });
    contact.release('{"code":0,"msg":"secret-message","data":{}}');
    await expect(timed).rejects.toThrow('TIMED_OUT');
    contact.mode = { kind: 'hang' };
    const controller = new AbortController();
    const priorRequestCount = contact.requests.length;
    const cancelled = transport().user('synthetic-open-agent', controller.signal);
    const rejected = expect(cancelled).rejects.toMatchObject({ code: 'CANCELLED' });
    await waitFor(() => contact.requests.length > priorRequestCount);
    controller.abort();
    await rejected;
    contact.release('{"msg":"secret-message"}');
    await expect(cancelled).rejects.toThrow('CANCELLED');
  });

  it('rejects an already aborted call and an unsafe open id before HTTP', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(transport().user('synthetic-open-agent', controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(contact.requests).toHaveLength(0);
    expect(thrown(() => transport().user('../admin', new AbortController().signal))).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(contact.requests).toHaveLength(0);
  });

  it('enforces the byte budget before returning a body', async () => {
    contact.mode = { kind: 'oversized-header' };
    const startedAt = Date.now();
    await expect(transport().user('synthetic-open-agent', new AbortController().signal)).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    contact.mode = { kind: 'sized-body', bytes: 1_048_576 };
    const exact = await transport().jobTitles(undefined, new AbortController().signal);
    expect(Buffer.byteLength(exact)).toBe(1_048_576);
    contact.mode = { kind: 'sized-body', bytes: 1_048_577, prefix: 'secret-message' };
    const oversized = transport().jobTitles('second', new AbortController().signal);
    await expect(oversized).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    await expect(oversized).rejects.toThrow('RESPONSE_TOO_LARGE');
    contact.mode = { kind: 'chunked-oversized' };
    const streamed = transport().user('synthetic-open-agent', new AbortController().signal);
    await expect(streamed).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    await expect(streamed).rejects.toThrow(/^RESPONSE_TOO_LARGE$/);
    contact.mode = { kind: 'sized-body', bytes: 1_048_577, prefix: 'secret-message' };
    const observed = await observe();
    expect(observed).toEqual({ ok: false, reason: 'DEPENDENCY_UNAVAILABLE' });
    expect(JSON.stringify(observed)).not.toContain('secret-message');
  });

  it('closes a response rejected during header validation without observer cleanup', async () => {
    let responseClosed = false;
    const sockets = new Set<Socket>();
    const server = createServer((_request, response) => {
      response.on('close', () => { responseClosed = true; });
      // Valid HTTP numeric length, but outside this transport's accepted format.
      response.writeHead(200, { 'content-length': '000000000000001' });
      response.flushHeaders();
      // Keep the body pending so success cannot be mistaken for remote closure.
    });
    server.on('connection', socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const client = createOrganizationHttpTransport({
        origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        tokenSupplier: tokens(), requestTimeoutMs: 1_000,
      });
      await expect(client.user('synthetic-open-agent', new AbortController().signal)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
      await waitFor(() => responseClosed);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it('refuses the eleventh job-title call in a published minute and does not reopen the window by rewinding the clock', async () => {
    let nowMs = 1_700_000_000_000;
    const client = transport(tokens(() => nowMs), 1_000, () => nowMs);
    const signal = new AbortController().signal;
    for (let call = 0; call < 10; call += 1) await client.jobTitles(undefined, signal);
    await expect(client.jobTitles(undefined, signal)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(contact.requests).toHaveLength(10);
    nowMs -= 60_000;
    await expect(client.jobTitles(undefined, signal)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(contact.requests).toHaveLength(10);
    nowMs += 120_000;
    await client.jobTitles('second', signal);
    expect(contact.requests).toHaveLength(11);
    expect(contact.requests[10]!.url).toBe('/open-apis/contact/v3/job_titles?page_size=50&page_token=second');
  });

  it('refuses the 51st user call in one second and the 1001st call in one minute', async () => {
    let nowMs = 1_700_000_000_000;
    const client = transport(tokens(() => nowMs), 1_000, () => nowMs);
    const signal = new AbortController().signal;
    for (let call = 0; call < 50; call += 1) await client.user('synthetic-open-agent', signal);
    await expect(client.user('synthetic-open-agent', signal)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(contact.requests).toHaveLength(50);
    nowMs += 1_000;
    await client.user('synthetic-open-agent', signal);
    expect(contact.requests).toHaveLength(51);
    contact.requests.splice(0);
    const minuteBase = 1_700_000_000_000 + 120_000;
    for (let second = 0; second < 20; second += 1) {
      nowMs = minuteBase + second * 1_000;
      for (let call = 0; call < 50; call += 1) await client.user('synthetic-open-agent', signal);
    }
    nowMs = minuteBase + 20_000;
    await expect(client.user('synthetic-open-agent', signal)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(contact.requests).toHaveLength(1_000);
    nowMs = minuteBase + 60_000;
    await client.user('synthetic-open-agent', signal);
    expect(contact.requests).toHaveLength(1_001);
  }, 30_000);

  it('does not let a full job-title window block the separate user window', async () => {
    const nowMs = 1_700_000_000_000;
    const client = transport(tokens(() => nowMs), 1_000, () => nowMs);
    const signal = new AbortController().signal;
    for (let call = 0; call < 10; call += 1) await client.jobTitles(undefined, signal);
    await client.user('agent:one', signal);
    expect(contact.requests.at(-1)!.url).toContain('/open-apis/contact/v3/users/agent%3Aone?');
    expect(contact.requests.at(-1)!.url).toContain('user_id_type=open_id');
    expect(contact.requests.at(-1)!.url).toContain('department_id_type=open_department_id');
  });

  it('asks the supplier again only after expiry and never reads an environment token', async () => {
    let nowMs = 1_700_000_000_000;
    let supplierCalls = 0;
    const supplier: OrganizationTokenSupplier = { async current(signal) {
      if (signal.aborted) throw new Error('secret-token-value');
      supplierCalls += 1;
      return { token: `synthetic-app-token-${supplierCalls}`, expiresAtMs: nowMs + 1_000 };
    } };
    const client = transport(supplier, 1_000, () => nowMs);
    const signal = new AbortController().signal;
    process.env.FEISHU_TENANT_ACCESS_TOKEN = 'env-secret-token';
    try {
      await client.user('synthetic-open-agent', signal);
      nowMs += 500;
      await client.user('synthetic-open-agent', signal);
      expect(supplierCalls).toBe(1);
      nowMs += 600;
      await client.jobTitles(undefined, signal);
      expect(supplierCalls).toBe(2);
      expect(contact.requests.map(request => request.authorization)).toEqual([
        'Bearer synthetic-app-token-1', 'Bearer synthetic-app-token-1', 'Bearer synthetic-app-token-2',
      ]);
      expect(JSON.stringify(contact.requests)).not.toContain('env-secret-token');
    } finally { delete process.env.FEISHU_TENANT_ACCESS_TOKEN; }
    supplierCalls = 0;
    const expired: OrganizationTokenSupplier = { async current() {
      supplierCalls += 1;
      return { token: 'synthetic-app-token', expiresAtMs: nowMs };
    } };
    await expect(transport(expired, 1_000, () => nowMs).user('synthetic-open-agent', signal)).rejects.toMatchObject({ code: 'TOKEN_UNAVAILABLE' });
    expect(supplierCalls).toBe(1);
    const leaking: OrganizationTokenSupplier = { async current() { throw new Error('secret-token-value'); } };
    const failure = transport(leaking).user('synthetic-open-agent', signal);
    await expect(failure).rejects.toMatchObject({ code: 'TOKEN_UNAVAILABLE' });
    await expect(failure).rejects.toThrow(/^TOKEN_UNAVAILABLE$/);
    const unsafe: OrganizationTokenSupplier = { async current() { return { token: 'synthetic app\r\nX: y', expiresAtMs: nowMs + 1_000 }; } };
    await expect(transport(unsafe, 1_000, () => nowMs).user('synthetic-open-agent', signal)).rejects.toMatchObject({ code: 'TOKEN_UNAVAILABLE' });
  });

  it('cancels while the supplier is pending and does not surface its error text', async () => {
    const supplier: OrganizationTokenSupplier = { current: signal => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('secret-token-value')), { once: true });
    }) };
    const controller = new AbortController();
    const pending = transport(supplier, 1_000).user('synthetic-open-agent', controller.signal);
    await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(pending).rejects.toThrow('CANCELLED');
    expect(contact.requests).toHaveLength(0);
  });

  it('refuses non-loopback origins and an unbounded request timeout before fetch', () => {
    const supplier: OrganizationTokenSupplier = { async current() { throw new Error('secret-token-value'); } };
    const credentialed = new URL('http://127.0.0.1:9');
    credentialed.username = 'user';
    credentialed.password = 'pass';
    for (const origin of ['https://open.feishu.cn', 'http://localhost:9', 'http://127.0.0.1', 'http://127.0.0.1:9/extra', credentialed.href]) {
      const error = thrown(() => createOrganizationHttpTransport({ origin, tokenSupplier: supplier, requestTimeoutMs: 1_000 }));
      expect(error).toMatchObject({ code: 'ORIGIN_FORBIDDEN' });
      expect(String(error)).not.toContain('secret-token-value');
    }
    expect(thrown(() => createOrganizationHttpTransport({ origin: contact.origin, tokenSupplier: supplier, requestTimeoutMs: 180_001 }))).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(thrown(() => createOrganizationHttpTransport({ origin: contact.origin, tokenSupplier: supplier, requestTimeoutMs: 0 }))).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('does not turn one page response into further requests and fails a third observation inside the published job-title window', async () => {
    const supplier = tokens();
    await transport(supplier).jobTitles(undefined, new AbortController().signal);
    expect(contact.requests).toHaveLength(1);
    contact.requests.splice(0);
    let nowMs = 1_700_000_000_000;
    const client = transport(tokens(() => nowMs), 1_000, () => nowMs);
    const run = () => createFeishuOrganizationObserver(scope, client, async () => nowMs)(
      { ...scope, principalId: 'agent', openId: contact.user.open_id, expectedFactsVersion: 1 });
    expect(await run()).toMatchObject({ ok: true });
    nowMs += 1_000;
    expect(await run()).toMatchObject({ ok: true });
    nowMs += 1_000;
    const blocked = await run();
    expect(blocked).toEqual({ ok: false, reason: 'DEPENDENCY_UNAVAILABLE' });
    expect(blocked).not.toHaveProperty('snapshot');
  });

  it('preserves a page token with a space instead of trimming it', async () => {
    contact.mode = { kind: 'status', status: 200, body: '{"code":0,"data":{}}' };
    await transport().jobTitles('second token', new AbortController().signal);
    const url = new URL(contact.requests[0]!.url, contact.origin);
    expect(url.searchParams.get('page_size')).toBe('50');
    expect(url.searchParams.get('page_token')).toBe('second token');
    expect(url.searchParams.has('user_id_type')).toBe(false);
  });
});
