import fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductAuthService } from '../src/auth-service.js';
import { IdentityFailure } from '../src/product-auth-service.js';
import { prefersIdentityCallbackHtml, registerProductAuthRoutes } from '../src/product-auth-routes.js';

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function appWith(callback: ProductAuthService['callback']): FastifyInstance {
  const app = fastify({ logger: false });
  const auth = {
    kind: 'product',
    authenticate: async () => null,
    readiness: () => 'ok' as const,
    close: () => undefined,
    createLogin: vi.fn(),
    callback,
    exchange: async () => null,
    issueBoundSession: vi.fn(),
    logout: async () => undefined,
  } as ProductAuthService;
  registerProductAuthRoutes(app, auth);
  openApps.push(app);
  return app;
}

describe('identity callback failure page', () => {
  it('serves a fixed Chinese page to browsers and keeps JSON for API clients', async () => {
    const secret = 'provider-state-must-not-echo';
    const code = 'provider-code-must-not-echo';
    const app = appWith(vi.fn(async () => { throw new IdentityFailure('LOGIN_INVALID'); }));
    const url = `/v1/auth/callback?state=${secret}&code=${code}`;

    const browser = await app.inject({ method: 'GET', url, headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
    expect(browser.statusCode).toBe(400);
    expect(browser.headers['content-type']).toContain('text/html');
    expect(browser.body).toContain('登录没有完成。请关闭此页，回到客户端重新登录。');
    expect(browser.body).not.toContain('Identity request could not be completed');
    expect(browser.body).not.toContain('LOGIN_INVALID');
    expect(browser.body).not.toContain(secret);
    expect(browser.body).not.toContain(code);

    const xhtml = await app.inject({ method: 'GET', url, headers: { accept: 'application/xhtml+xml;q=0.9' } });
    expect(xhtml.statusCode).toBe(400);
    expect(xhtml.headers['content-type']).toContain('text/html');
    expect(xhtml.body).not.toContain(secret);

    const client = await app.inject({ method: 'GET', url });
    expect(client.statusCode).toBe(400);
    expect(client.headers['content-type']).toContain('application/json');
    expect(client.json()).toMatchObject({
      error: { code: 'VALIDATION', message: 'Identity request could not be completed', details: { reason: 'LOGIN_INVALID' } },
    });

    const star = await app.inject({ method: 'GET', url, headers: { accept: '*/*' } });
    expect(star.statusCode).toBe(400);
    expect(star.json().error.details.reason).toBe('LOGIN_INVALID');
  });

  it('keeps a malformed login request as JSON even when the client asks for HTML', async () => {
    const app = appWith(vi.fn(async () => undefined));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login-requests',
      headers: { accept: 'text/html', 'content-type': 'application/json' },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION', details: { reason: 'REQUEST_INVALID' } } });
    expect(response.body).not.toContain('登录请求无效');
  });
});

describe('prefersIdentityCallbackHtml', () => {
  it('matches a browser media type and ignores a wildcard accept', () => {
    expect(prefersIdentityCallbackHtml('text/html')).toBe(true);
    expect(prefersIdentityCallbackHtml(['application/json', 'text/html;q=0.8'])).toBe(true);
    expect(prefersIdentityCallbackHtml('*/*')).toBe(false);
    expect(prefersIdentityCallbackHtml(undefined)).toBe(false);
    expect(prefersIdentityCallbackHtml('application/json')).toBe(false);
  });
});
