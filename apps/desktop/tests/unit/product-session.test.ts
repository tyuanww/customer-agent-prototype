// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductSession, type SessionStore } from '../../src/main/product-session';
import { ProductHttp, ProductHttpError } from '../../src/main/product-http';
import { isProductSessionResult, type JobSnapshot } from '../../src/shared/product-session';

const token = 't'.repeat(43);
const user = { user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'mock' };
function fixture(options: {
  store?: Partial<SessionStore>;
  respond?: (path: string) => Response | Promise<Response>;
  identity?: { user_id: string; role: string; auth_mode: string };
  jobSnapshotFor?: (userId: string) => JobSnapshot | null;
} = {}) {
  const stored = { access_token: token, expires_at: new Date(Date.now() + 899_000).toISOString() };
  const store = { read: vi.fn(() => null as unknown), write: vi.fn(), clear: vi.fn(), ...options.store };
  const requests: { path: string; init: RequestInit }[] = [];
  const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.signal?.aborted) {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
    const path = new URL(String(url)).pathname; requests.push({ path, init: init ?? {} });
    if (options.respond) return options.respond(path);
    if (path === '/v1/auth/login-requests') return Response.json({ login_id: `login_${'i'.repeat(43)}`, authorize_url: 'http://127.0.0.1:4101/authorize?state=s', expires_at: new Date(Date.now() + 300_000).toISOString() }, { status: 201 });
    if (path.endsWith('/exchange')) return Response.json({ ...stored, token_type: 'Bearer' });
    if (path.endsWith('/logout')) return new Response(null, { status: 204 });
    return Response.json(options.identity ?? user);
  }) as unknown as typeof fetch;
  const window = { open: vi.fn(async (_url?: string, _operation?: AbortController) => {}) };
  const session = new ProductSession(new ProductHttp('http://127.0.0.1:4100', transport), store, window, undefined, options.jobSnapshotFor);
  return { session, store, requests, stored, window };
}
const one = (name: string) => [{ name, enabled: true }];
afterEach(() => vi.useRealTimers());
describe('product session lifetime', () => {
  it('uses PKCE without projecting credentials and revokes repeat logout safely', async () => {
    const f = fixture(); const login = await f.session.login();
    expect(login).toMatchObject({ ok: true, signedIn: true, role: 'agent', authMode: 'mock', displayName: '坐席' });
    expect(isProductSessionResult(login)).toBe(true);
    expect(JSON.stringify(login)).not.toContain(token);
    const created = JSON.parse(f.requests[0].init.body as string);
    expect(created.challenge_method).toBe('S256');
    const challenge = created.client_challenge;
    const verifier = JSON.parse(f.requests[1].init.body as string).client_verifier;
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(verifier).not.toEqual(challenge);
    expect(f.store.write).toHaveBeenCalledWith(f.stored);
    expect(await f.session.logout()).toMatchObject({ signedIn: false });
    expect(await f.session.logout()).toMatchObject({ signedIn: false });
    expect(f.requests.filter(r => r.path.endsWith('/logout'))).toHaveLength(1);
  });
  it('drops late login after logout', async () => {
    const f = fixture(); let finish!: () => void;
    f.window.open.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.session.login(); await vi.waitFor(() => expect(f.window.open).toHaveBeenCalled());
    await f.session.logout(); finish(); await pending;
    expect(f.session.view().signedIn).toBe(false); expect(f.store.write).not.toHaveBeenCalled();
  });
  it('replaces an unfinished login so a second click can finish', async () => {
    const f = fixture();
    let opened = 0;
    f.window.open.mockImplementation((_url, operation) => new Promise((resolve, reject) => {
      const attempt = ++opened;
      const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (operation?.signal.aborted) { abort(); return; }
      operation?.signal.addEventListener('abort', abort, { once: true });
      if (attempt > 1) resolve();
    }));
    const first = f.session.login();
    await vi.waitFor(() => expect(f.window.open).toHaveBeenCalledTimes(1));
    const second = f.session.login();
    await expect(second).resolves.toMatchObject({ ok: true, signedIn: true });
    await expect(first).resolves.toMatchObject({ ok: false, code: 'STALE' });
    expect(f.session.view().signedIn).toBe(true);
    expect(f.store.write).toHaveBeenCalledTimes(1);
  });
  it('starts a fresh authorization after a failed callback and lets the next login succeed', async () => {
    let attempt = 0;
    const f = fixture({ respond: (path) => {
      if (path === '/v1/auth/login-requests') {
        attempt += 1;
        return Response.json({
          login_id: `login_${String(attempt).repeat(43)}`,
          authorize_url: `http://127.0.0.1:4101/authorize?state=attempt-${attempt}`,
          expires_at: new Date(Date.now() + 300_000).toISOString(),
        }, { status: 201 });
      }
      if (path.endsWith('/exchange')) return Response.json({ ...f.stored, token_type: 'Bearer' });
      return Response.json(user);
    }});
    f.window.open.mockRejectedValueOnce(new ProductHttpError('UNAVAILABLE'));

    await expect(f.session.login()).resolves.toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(f.session.view().signedIn).toBe(false);
    await expect(f.session.login()).resolves.toMatchObject({ ok: true, signedIn: true });
    expect(f.requests.filter(request => request.path === '/v1/auth/login-requests')).toHaveLength(2);
    expect(f.window.open.mock.calls.map(([url]) => new URL(url!).searchParams.get('state')))
      .toEqual(['attempt-1', 'attempt-2']);
  });
  it('cancels exchange when the login window aborts after opening the browser', async () => {
    const f = fixture();
    f.window.open.mockImplementation(async (_url, operation) => { operation?.abort(); });
    expect(await f.session.login()).toMatchObject({ ok: false, code: 'CANCELLED' });
    expect(f.session.view().signedIn).toBe(false);
  });
  it('keeps a delayed old status below the newly logged-in epoch', async () => {
    const f = fixture(); await f.session.login();
    const real = f.session.http.request.bind(f.session.http); let finish!: () => void;
    vi.spyOn(f.session.http, 'request').mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ status: 200, value: user }); })).mockImplementation(real);
    const status = f.session.status(); await f.session.logout(); const login = await f.session.login();
    finish(); const old = await status;
    expect(old).toMatchObject({ ok: false, code: 'STALE' });
    expect(old.sessionEpoch).toBeLessThan(login.sessionEpoch); expect(f.session.view().signedIn).toBe(true);
    await f.session.logout();
  });
  it('does not restore unverified local role or an expired token', async () => {
    const f = fixture({ store: { read: () => ({ access_token: token, expires_at: new Date(Date.now() - 1).toISOString() }) } });
    expect(await f.session.restore()).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    expect(f.session.view().signedIn).toBe(false);
  });
  it('clears local state when the server rejects the session', async () => {
    const f = fixture(); await f.session.login();
    vi.spyOn(f.session.http, 'request').mockRejectedValue(new ProductHttpError('UNAUTHORIZED'));
    const result = await f.session.status();
    expect(result).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    expect(f.session.view().signedIn).toBe(false);
  });
  it('keeps the signed-in session when a status check cannot reach the service', async () => {
    const f = fixture(); await f.session.login();
    vi.spyOn(f.session.http, 'request').mockRejectedValue(new Error('sensitive-provider-token'));
    const result = await f.session.status();
    expect(result.ok && result.signedIn).toBe(true);
    expect(JSON.stringify(result)).not.toContain('sensitive');
  });
  it('fails closed when encrypted persistence is unavailable', async () => {
    const f = fixture({ store: { write: () => { throw new Error('secure storage unavailable'); } } });
    expect(await f.session.login()).toMatchObject({ ok: false }); expect(f.session.view().signedIn).toBe(false);
  });
  it('invalidates expired sessions and notifies renderers', async () => {
    vi.useFakeTimers(); const f = fixture(); const event = vi.fn(); f.session.subscribe(event);
    await f.session.login(); await vi.advanceTimersByTimeAsync(900_000);
    expect(f.session.view().signedIn).toBe(false); expect(event).toHaveBeenLastCalledWith(expect.objectContaining({ signedIn: false }));
  });
  it('notifies expiry while the initial job lookup is still pending', async () => {
    vi.useFakeTimers();
    const f = fixture(); f.stored.expires_at = new Date(Date.now() + 2_000).toISOString();
    f.session.enableRemoteJobObservation();
    const event = vi.fn(); f.session.subscribe(event);
    const original = f.session.http.request.bind(f.session.http);
    let finishJob!: () => void;
    vi.spyOn(f.session.http, 'request').mockImplementation((path, options) => path === '/v1/auth/job'
      ? new Promise(resolve => { finishJob = () => resolve({ status: 200, value: null }); })
      : original(path, options));
    const pending = f.session.login();
    await vi.waitFor(() => expect(finishJob).toBeTypeOf('function'));
    expect(isProductSessionResult(f.session.view())).toBe(true);
    const before = event.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(event.mock.calls.length).toBeGreaterThan(before);
    expect(event).toHaveBeenLastCalledWith(expect.objectContaining({ signedIn: false }));
    finishJob();
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'STALE' });
  });
  it('clears a session that expires while it is being saved', async () => {
    vi.useFakeTimers();
    const f = fixture(); f.stored.expires_at = new Date(Date.now() + 5_000).toISOString();
    const event = vi.fn(); f.session.subscribe(event);
    vi.spyOn(f.store, 'write').mockImplementation(() => { vi.setSystemTime(Date.now() + 7_000); });
    await expect(f.session.login()).resolves.toMatchObject({ ok: false, code: 'STALE' });
    expect(event).toHaveBeenLastCalledWith(expect.objectContaining({ signedIn: false }));
    expect(f.store.clear).toHaveBeenCalledTimes(2);
    expect(f.session.view().signedIn).toBe(false);
  });
  it('does not apply a delayed job lookup to a newer login', async () => {
    const f = fixture(); f.session.enableRemoteJobObservation();
    const original = f.session.http.request.bind(f.session.http);
    let finishOldJob!: () => void, jobs = 0;
    const job = (title: string) => ({ title, directory: one(title), permission_state: 'ready', message: null,
      actions: { query: true, import: false, publish: false, rollback: false } });
    vi.spyOn(f.session.http, 'request').mockImplementation((path, options) => {
      if (path !== '/v1/auth/job') return original(path, options);
      jobs += 1;
      return jobs === 1 ? new Promise(resolve => { finishOldJob = () => resolve({ status: 200, value: job('客服总监') }); })
        : Promise.resolve({ status: 200, value: job('客服坐席') });
    });
    const oldLogin = f.session.login();
    await vi.waitFor(() => expect(finishOldJob).toBeTypeOf('function'));
    await f.session.logout();
    expect(await f.session.login()).toMatchObject({ ok: true, signedIn: true, job: { title: '客服坐席' } });
    finishOldJob();
    await expect(oldLogin).resolves.toMatchObject({ ok: false, code: 'STALE' });
    expect(f.session.view()).toMatchObject({ signedIn: true, job: { title: '客服坐席' } });
    await f.session.logout();
  });
  it('does not let an older status lookup overwrite a later status', async () => {
    const f = fixture(); f.session.enableRemoteJobObservation();
    const original = f.session.http.request.bind(f.session.http);
    let finishOldJob!: () => void, jobs = 0;
    const job = (title: string) => ({ title, directory: one(title), permission_state: 'ready', message: null,
      actions: { query: true, import: false, publish: false, rollback: false } });
    vi.spyOn(f.session.http, 'request').mockImplementation((path, options) => {
      if (path !== '/v1/auth/job') return original(path, options);
      jobs += 1;
      return jobs === 2 ? new Promise(resolve => { finishOldJob = () => resolve({ status: 200, value: job('客服总监') }); })
        : Promise.resolve({ status: 200, value: job('客服坐席') });
    });
    await f.session.login();
    const oldStatus = f.session.status();
    await vi.waitFor(() => expect(finishOldJob).toBeTypeOf('function'));
    expect(await f.session.status()).toMatchObject({ ok: true, job: { title: '客服坐席' } });
    finishOldJob();
    await expect(oldStatus).resolves.toMatchObject({ ok: true, signedIn: true, job: { title: '客服坐席' } });
    expect(f.session.view()).toMatchObject({ signedIn: true, job: { title: '客服坐席' } });
    await f.session.logout();
  });
  it('notifies role changes before waiting for the updated job', async () => {
    const f = fixture(); f.session.enableRemoteJobObservation();
    const original = f.session.http.request.bind(f.session.http);
    const events = vi.fn(); f.session.subscribe(events);
    let identity = 0, jobs = 0, finishJob!: () => void;
    const job = { title: '客服坐席', directory: one('客服坐席'), permission_state: 'ready', message: null,
      actions: { query: true, import: false, publish: false, rollback: false } };
    vi.spyOn(f.session.http, 'request').mockImplementation((path, options) => {
      if (path === '/v1/auth/me') return Promise.resolve({ status: 200, value: { ...user, role: ++identity === 1 ? 'agent' : 'coach' } });
      if (path === '/v1/auth/job') return ++jobs === 2
        ? new Promise(resolve => { finishJob = () => resolve({ status: 200, value: job }); })
        : Promise.resolve({ status: 200, value: job });
      return original(path, options);
    });
    await f.session.login(); events.mockClear();
    const first = f.session.status();
    await vi.waitFor(() => expect(finishJob).toBeTypeOf('function'));
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ signedIn: true, role: 'coach',
      job: expect.objectContaining({ status: 'unresolved', reason: 'missing', rights: expect.objectContaining({ search: false }) }) }));
    expect(events.mock.calls.every(([state]) => isProductSessionResult(state))).toBe(true);
    expect(await f.session.status()).toMatchObject({ ok: true, role: 'coach' });
    finishJob();
    await expect(first).resolves.toMatchObject({ ok: true, role: 'coach' });
    await f.session.logout();
  });
  it('does not accept an older identity after a newer identity was observed', async () => {
    const f = fixture(); f.session.enableRemoteJobObservation();
    const original = f.session.http.request.bind(f.session.http);
    let identities = 0, jobs = 0, finishIdentity!: () => void, finishJob!: () => void;
    const job = { title: '客服坐席', directory: one('客服坐席'), permission_state: 'ready', message: null,
      actions: { query: true, import: false, publish: false, rollback: false } };
    vi.spyOn(f.session.http, 'request').mockImplementation((path, options) => {
      if (path === '/v1/auth/me') return ++identities === 2
        ? new Promise(resolve => { finishIdentity = () => resolve({ status: 200, value: { ...user, role: 'owner' } }); })
        : Promise.resolve({ status: 200, value: user });
      if (path === '/v1/auth/job') return ++jobs === 2
        ? new Promise(resolve => { finishJob = () => resolve({ status: 200, value: job }); })
        : Promise.resolve({ status: 200, value: job });
      return original(path, options);
    });
    await f.session.login();
    const old = f.session.status();
    await vi.waitFor(() => expect(finishIdentity).toBeTypeOf('function'));
    const recent = f.session.status();
    await vi.waitFor(() => expect(finishJob).toBeTypeOf('function'));
    finishIdentity();
    await expect(old).resolves.toMatchObject({ ok: true, signedIn: true, role: 'agent' });
    expect(f.session.view()).toMatchObject({ signedIn: true, role: 'agent' });
    finishJob();
    await expect(recent).resolves.toMatchObject({ ok: true, role: 'agent' });
    await f.session.logout();
  });
  it('returns the current session when its role changes during login', async () => {
    const f = fixture(); f.session.enableRemoteJobObservation();
    const original = f.session.http.request.bind(f.session.http);
    let identities = 0, jobs = 0, finishJob!: () => void;
    const job = { title: '客服坐席', directory: one('客服坐席'), permission_state: 'ready', message: null,
      actions: { query: true, import: false, publish: false, rollback: false } };
    vi.spyOn(f.session.http, 'request').mockImplementation((path, options) => {
      if (path === '/v1/auth/me') return Promise.resolve({ status: 200, value: { ...user, role: ++identities === 1 ? 'agent' : 'coach' } });
      if (path === '/v1/auth/job') return ++jobs === 1
        ? new Promise(resolve => { finishJob = () => resolve({ status: 200, value: job }); })
        : Promise.resolve({ status: 200, value: job });
      return original(path, options);
    });
    const login = f.session.login();
    await vi.waitFor(() => expect(finishJob).toBeTypeOf('function'));
    expect(await f.session.status()).toMatchObject({ ok: true, role: 'coach' });
    finishJob();
    await expect(login).resolves.toMatchObject({ ok: true, signedIn: true, role: 'coach' });
    await f.session.logout();
  });
  it('clears memory immediately before a slow remote logout finishes', async () => {
    const f = fixture(); await f.session.login(); let done!: () => void;
    vi.spyOn(f.session.http, 'request').mockImplementation(() => new Promise(resolve => { done = () => resolve({ status: 204, value: null }); }));
    const pending = f.session.logout(); expect(f.session.view().signedIn).toBe(false); done(); await pending;
  });
  it('rejects secret fields in public payloads', () => {
    expect(isProductSessionResult({ ...fixture().session.view(), access_token: token })).toBe(false);
  });
  it('accepts contracted feishu auth_mode on login and restore', async () => {
    const identity = { user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'feishu' };
    const loggedIn = fixture({ identity });
    expect(await loggedIn.session.login()).toMatchObject({ ok: true, signedIn: true, authMode: 'feishu' });
    expect(loggedIn.session.view().authMode).toBe('feishu');
    const restored = fixture({ identity, store: { read: () => loggedIn.stored } });
    expect(await restored.session.restore()).toMatchObject({ ok: true, signedIn: true, authMode: 'feishu' });
    expect(restored.session.view().authMode).toBe('feishu');
  });
  it('rejects unknown auth_mode from /v1/auth/me', async () => {
    const f = fixture({ identity: { user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'saml' } });
    expect(await f.session.login()).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    expect(f.session.view().signedIn).toBe(false);
  });
  it('reads the current notice and submits an explicit idempotent decision', async () => {
    const notice = {
      notice: {
        version: 'pilot-notice-v1',
        content: '试点采集告知正文',
        content_hash: 'a'.repeat(64),
        published_at: new Date().toISOString(),
      },
      decision: null,
      decided_at: null,
    };
    const f = fixture({ respond: (path) => {
      if (path === '/v1/auth/login-requests') return Response.json({ login_id: `login_${'i'.repeat(43)}`, authorize_url: 'http://127.0.0.1:4101/authorize?state=s', expires_at: new Date(Date.now() + 300_000).toISOString() }, { status: 201 });
      if (path.endsWith('/exchange')) return Response.json({ ...f.stored, token_type: 'Bearer' });
      if (path === '/v1/auth/me') return Response.json(user);
      if (path === '/v1/notices/current') return Response.json(notice);
      if (path.endsWith('/decision')) return Response.json({ ok: true, version: 'pilot-notice-v1', decision: 'accepted', decided_at: new Date().toISOString() });
      if (path.endsWith('/logout')) return new Response(null, { status: 204 });
      return Response.json(user);
    }});
    await expect(f.session.login()).resolves.toMatchObject({ ok: true, signedIn: true });
    const current = await f.session.currentNotice();
    expect(current).toMatchObject({ ok: true, decision: null, notice: { version: 'pilot-notice-v1' } });
    const decided = await f.session.decideNotice({ version: 'pilot-notice-v1', decision: 'accepted' });
    expect(decided).toMatchObject({ ok: true, decision: 'accepted', version: 'pilot-notice-v1' });
    const request = f.requests.find((entry) => entry.path.endsWith('/decision'));
    expect(request?.init.method).toBe('POST');
    expect(request?.init.headers).toEqual(expect.objectContaining({ 'idempotency-key': expect.any(String) }));
    expect(JSON.stringify(current)).not.toContain(f.stored.access_token);
  });
  it('fails notice decisions closed when the version is unsafe', async () => {
    const f = fixture();
    await f.session.login();
    await expect(f.session.decideNotice({ version: '../notice', decision: 'accepted' })).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(f.requests.some((entry) => entry.path.includes('notice'))).toBe(false);
  });
});
describe('job observation from a signed-out session', () => {
  it('starts signed out and resolves AI赋能工程师 on login and restore', async () => {
    const snapshot: JobSnapshot = {
      title: 'AI赋能工程师',
      directory: one('AI赋能工程师'),
      actions: { query: false, import: false, publish: true, rollback: false },
    };
    const loggedIn = fixture({ jobSnapshotFor: () => snapshot });
    expect(loggedIn.session.view()).toMatchObject({ signedIn: false, job: null });
    const login = await loggedIn.session.login();
    expect(login).toMatchObject({
      ok: true,
      signedIn: true,
      job: {
        status: 'resolved',
        title: 'AI赋能工程师',
        role: 'engineer',
        label: 'AI赋能工程师',
        rights: { publish: true, grant: true, uploadSop: true, search: false, readCatalog: false },
      },
    });
    expect(isProductSessionResult(login)).toBe(true);
    const restored = fixture({ jobSnapshotFor: () => snapshot, store: { read: () => loggedIn.stored } });
    expect(restored.session.view().signedIn).toBe(false);
    expect(await restored.session.restore()).toMatchObject({
      ok: true,
      signedIn: true,
      job: { status: 'resolved', role: 'engineer', rights: { publish: true, grant: true } },
    });
  });

  it('keeps SOP upload and the job-table rights when the server publish bit is false', async () => {
    // `grant` is the job-table right and `publish` is the server bit. 客服总监 holds the job-table
    // right even when the server bit is false, and the sensitive-content gate reads that right.
    const f = fixture({
      identity: { user_id: 'usr_synthetic_owner', role: 'owner', auth_mode: 'feishu' },
      jobSnapshotFor: () => ({
        title: '客服总监',
        directory: one('客服总监'),
        actions: { query: true, import: false, publish: false, rollback: false },
      }),
    });
    expect(await f.session.login()).toMatchObject({
      ok: true,
      job: {
        status: 'resolved',
        rights: { publish: false, grant: true, uploadSop: true, search: true, readCatalog: true },
        actions: { query: true, import: false, publish: false, rollback: false },
      },
    });
  });

  it('keeps 普通客服 off publish and off query until the roster state is ready', async () => {
    const closed = fixture({ jobSnapshotFor: () => ({ title: '普通客服', directory: one('普通客服') }) });
    expect(await closed.session.login()).toMatchObject({
      ok: true,
      job: {
        status: 'resolved',
        role: 'agent',
        rights: { publish: false, grant: false, uploadSop: false, search: false, readCatalog: false },
      },
    });
    const open = fixture({
      jobSnapshotFor: () => ({
        title: '普通客服',
        directory: one('普通客服'),
        permissionState: 'ready',
        actions: { query: true, import: false, publish: false, rollback: false },
      }),
    });
    expect(await open.session.login()).toMatchObject({
      ok: true,
      job: {
        permission: 'ready',
        notice: null,
        rights: { publish: false, grant: false, uploadSop: false, search: true, readCatalog: true },
      },
    });
  });

  it('shows the fixed denial sentence when the permission state is not ready', async () => {
    const f = fixture({
      jobSnapshotFor: () => ({ title: '客服坐席', directory: one('客服坐席'), permissionState: 'revoked' }),
    });
    expect(await f.session.login()).toMatchObject({
      ok: true,
      role: 'agent',
      job: {
        status: 'resolved',
        role: 'agent',
        permission: 'revoked',
        notice: '没有权限，请找人开通。',
        rights: { publish: false, grant: false, uploadSop: false, search: false, readCatalog: false },
      },
    });
  });

  it('keeps a missing, blank, unknown, or duplicate title unresolved with no rights', async () => {
    const cases: Array<{ snapshot: JobSnapshot | null; reason: 'missing' | 'blank' | 'unknown' | 'duplicate' }> = [
      { snapshot: null, reason: 'missing' },
      { snapshot: { title: '   ', directory: one('客服总监') }, reason: 'blank' },
      { snapshot: { title: '服务赋能师', directory: one('服务赋能师') }, reason: 'unknown' },
      { snapshot: { title: '客服总监', directory: [{ name: '客服总监', enabled: true }, { name: '客服总监', enabled: true }] }, reason: 'duplicate' },
    ];
    for (const { snapshot, reason } of cases) {
      const f = fixture({
        identity: { user_id: 'usr_synthetic_owner', role: 'owner', auth_mode: 'feishu' },
        jobSnapshotFor: () => snapshot,
      });
      expect(f.session.view().signedIn).toBe(false);
      const login = await f.session.login();
      expect(login).toMatchObject({
        ok: true,
        signedIn: true,
        role: 'owner',
        job: {
          status: 'unresolved',
          reason,
          label: '职务未识别',
          rights: { publish: false, grant: false, uploadSop: false, search: false, readCatalog: false },
        },
      });
      expect(isProductSessionResult(login)).toBe(true);
    }
  });
});
describe('loopback transport', () => {
  it.each(['http://example.com', 'http://localhost:4100', 'http://127.0.0.1:4100/path', 'https://127.0.0.1'])('rejects %s', origin => {
    expect(() => new ProductHttp(origin)).toThrow();
  });
  it('accepts an https public hostname', () => {
    expect(new ProductHttp('https://example.com').origin).toBe('https://example.com');
  });
  it('rejects userinfo in the configured origin', () => {
    const url = new URL('http://127.0.0.1:4100'); url.username = 'synthetic';
    expect(() => new ProductHttp(url.href)).toThrow();
  });
  it('does not follow redirects or expose server errors', async () => {
    const transport = vi.fn(async () => new Response('secret SQL', { status: 503 })) as unknown as typeof fetch;
    const http = new ProductHttp('http://127.0.0.1:4100', transport);
    await expect(http.request('/v1/auth/me')).rejects.toMatchObject({ code: 'OVERLOADED', message: '服务繁忙，请稍后重试' });
    expect(transport).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: 'error' }));
  });
  it('maps source-gate 503 and keeps 304 bodies empty', async () => {
    const gate = vi.fn(async () => Response.json({ error: { code: 'OVERLOADED', message: '当前内容来源校验未通过', details: { reason: 'SOURCE_GATE_NOT_READY' } } }, { status: 503 })) as unknown as typeof fetch;
    await expect(new ProductHttp('http://127.0.0.1:4100', gate).request('/v1/announce/current')).rejects.toMatchObject({ code: 'SOURCE_GATE_NOT_READY' });
    const notModified = vi.fn(async () => new Response(null, { status: 304, headers: { 'x-snapshot-lease': `osl_${'c'.repeat(64)}`, 'x-snapshot-lease-expires': '2026-09-09T00:10:00.000Z' } })) as unknown as typeof fetch;
    await expect(new ProductHttp('http://127.0.0.1:4100', notModified).request('/v1/announce/current')).resolves.toMatchObject({ status: 304, value: null });
  });
});
