import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFeishuIdentityProvider,
  FEISHU_AUTHORIZE_URL,
  FEISHU_TOKEN_URL,
  FEISHU_USER_INFO_URL,
} from '../src/feishu-identity-provider.js';

const config = Object.freeze({
  clientId: 'cli_aaaaaaaaaaaaaaaa',
  clientSecret: 'test-feishu-secret-material-0001',
  redirectUri: 'https://oauth.test.invalid/v1/auth/callback',
});
const openId = 'ou_8f5c2a0000000001';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('feishu identity provider', () => {
  it('builds the official authorize URL without leaking the client secret', () => {
    const provider = createFeishuIdentityProvider(config);
    const url = new URL(provider.authorizeUrl('opaque-state'));
    expect(`${url.origin}${url.pathname}`).toBe(FEISHU_AUTHORIZE_URL);
    expect(url.searchParams.get('client_id')).toBe(config.clientId);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    expect(url.searchParams.get('state')).toBe('opaque-state');
    expect(url.searchParams.get('scope')).toBe('auth:user.id:read');
    expect(url.href).not.toContain(config.clientSecret);
    provider.close();
  });

  it('exchanges a code for the Feishu open_id used as binding_id', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === FEISHU_TOKEN_URL) {
        expect(init?.redirect).toBe('error');
        const body = JSON.parse(String(init?.body)) as Record<string, string>;
        expect(body).toEqual({
          grant_type: 'authorization_code',
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code: 'one-time-code',
          redirect_uri: config.redirectUri,
        });
        return jsonResponse({ code: 0, token_type: 'Bearer', access_token: 'user-access-token' });
      }
      if (url === FEISHU_USER_INFO_URL) {
        expect(init?.headers).toMatchObject({ authorization: 'Bearer user-access-token' });
        return jsonResponse({ code: 0, data: { open_id: openId } });
      }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    const provider = createFeishuIdentityProvider(config, fetchImpl);
    expect(await provider.exchange('one-time-code')).toBe(openId);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    provider.close();
    await expect(provider.exchange('one-time-code')).rejects.toMatchObject({ reason: 'DEPENDENCY_UNAVAILABLE' });
  });

  it('treats rejected codes as LOGIN_INVALID and transport faults as unavailable', async () => {
    const unauthorized = createFeishuIdentityProvider(config, async () => new Response('', { status: 401 }));
    try { await expect(unauthorized.exchange('code')).rejects.toMatchObject({ reason: 'LOGIN_INVALID' }); }
    finally { unauthorized.close(); }
    const unavailable = createFeishuIdentityProvider(config, async () => new Response('', { status: 503 }));
    try { await expect(unavailable.exchange('code')).rejects.toMatchObject({ reason: 'DEPENDENCY_UNAVAILABLE' }); }
    finally { unavailable.close(); }
  });

  it.each([
    { code: 0, token_type: 'Bearer' },
    { code: 1, token_type: 'Bearer', access_token: 'user-access-token' },
  ])('fails closed when the token receipt is not a bearer access token', async (body) => {
    const provider = createFeishuIdentityProvider(config, async () => jsonResponse(body));
    try { await expect(provider.exchange('code')).rejects.toMatchObject({ reason: 'DEPENDENCY_UNAVAILABLE' }); }
    finally { provider.close(); }
  });

  it.each([
    { code: 0, data: { open_id: 'not-an-open-id' } },
    { code: 0, data: { user_id: openId } },
    { code: 1, data: { open_id: openId } },
  ])('fails closed when user_info does not yield a Feishu open_id', async (body) => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === FEISHU_TOKEN_URL) {
        return jsonResponse({ code: 0, token_type: 'Bearer', access_token: 'user-access-token' });
      }
      return jsonResponse(body);
    }) as unknown as typeof fetch;
    const provider = createFeishuIdentityProvider(config, fetchImpl);
    try { await expect(provider.exchange('code')).rejects.toMatchObject({ reason: 'DEPENDENCY_UNAVAILABLE' }); }
    finally { provider.close(); }
  });

  it('does not follow redirects from Feishu endpoints', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 302, headers: { location: 'https://example.com' } })) as unknown as typeof fetch;
    const provider = createFeishuIdentityProvider(config, fetchImpl);
    try {
      await expect(provider.exchange('code')).rejects.toMatchObject({ reason: 'DEPENDENCY_UNAVAILABLE' });
      expect(fetchImpl).toHaveBeenCalledWith(FEISHU_TOKEN_URL, expect.objectContaining({ redirect: 'error' }));
    } finally { provider.close(); }
  });
});
