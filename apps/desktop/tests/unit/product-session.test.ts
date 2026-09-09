// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductSession, type SessionStore } from '../../src/main/product-session';
import { ProductHttp } from '../../src/main/product-http';
import { isProductSessionResult } from '../../src/shared/product-session';

const token = 't'.repeat(43);
const user = { user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'mock' };
function fixture(options: { store?: Partial<SessionStore>; respond?: (path: string) => Response | Promise<Response> } = {}) {
  const stored = { access_token: token, expires_at: new Date(Date.now() + 899_000).toISOString() };
  const store = { read: vi.fn(() => null as unknown), write: vi.fn(), clear: vi.fn(), ...options.store };
  const requests: { path: string; init: RequestInit }[] = [];
  const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname; requests.push({ path, init: init ?? {} });
    if (options.respond) return options.respond(path);
    if (path === '/v1/auth/login-requests') return Response.json({ login_id: `login_${'i'.repeat(43)}`, authorize_url: 'http://127.0.0.1:4101/authorize?state=s', expires_at: new Date(Date.now() + 300_000).toISOString() }, { status: 201 });
    if (path.endsWith('/exchange')) return Response.json({ ...stored, token_type: 'Bearer' });
    if (path.endsWith('/logout')) return new Response(null, { status: 204 });
    return Response.json(user);
  }) as unknown as typeof fetch;
  const window = { open: vi.fn(async () => {}) };
  const session = new ProductSession(new ProductHttp('http://127.0.0.1:4100', transport), store, window);
  return { session, store, requests, stored, window };
}
afterEach(() => vi.useRealTimers());
describe('product session lifetime', () => {
  it('uses PKCE without projecting credentials and revokes repeat logout safely', async () => {
    const f = fixture(); const login = await f.session.login();
    expect(login).toMatchObject({ ok: true, signedIn: true, role: 'agent', authMode: 'mock' });
    expect(isProductSessionResult(login)).toBe(true);
    expect(JSON.stringify(login)).not.toContain(token);
    const challenge = JSON.parse(f.requests[0].init.body as string).client_challenge;
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
  it('clears local state on revoked session, even when the service is unavailable', async () => {
    const f = fixture(); await f.session.login();
    vi.spyOn(f.session.http, 'request').mockRejectedValue(new Error('sensitive-provider-token'));
    const result = await f.session.status();
    expect(result).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(JSON.stringify(result)).not.toContain('sensitive'); expect(f.session.view().signedIn).toBe(false);
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
  it('clears memory immediately before a slow remote logout finishes', async () => {
    const f = fixture(); await f.session.login(); let done!: () => void;
    vi.spyOn(f.session.http, 'request').mockImplementation(() => new Promise(resolve => { done = () => resolve({ status: 204, value: null }); }));
    const pending = f.session.logout(); expect(f.session.view().signedIn).toBe(false); done(); await pending;
  });
  it('rejects secret fields in public payloads', () => {
    expect(isProductSessionResult({ ...fixture().session.view(), access_token: token })).toBe(false);
  });
});
describe('loopback transport', () => {
  it.each(['https://example.com', 'http://localhost:4100', 'http://127.0.0.1:4100/path'])('rejects %s', origin => {
    expect(() => new ProductHttp(origin)).toThrow();
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
});
