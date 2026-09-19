import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFeishuIdentityProvider,
  FEISHU_AUTHORIZE_URL,
  FEISHU_TOKEN_URL,
  FEISHU_USER_INFO_URL,
} from '../src/feishu-identity-provider.js';

const persistOperatorDisplayName = vi.hoisted(() => vi.fn());
vi.mock('../src/operator-display-names.js', () => ({ persistOperatorDisplayName }));

const config = Object.freeze({
  clientId: 'cli_aaaaaaaaaaaaaaaa',
  clientSecret: 'test-feishu-secret-material-0001',
  redirectUri: 'https://oauth.test.invalid/v1/auth/callback',
});
const openId = 'ou_8f5c2a0000000001';

function jsonResponse(body: unknown, url: string, status = 200) {
  const response = new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

function statusResponse(status: number, url: string) {
  const response = new Response('', { status });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

function redirectResponse(location: string, url: string) {
  const response = new Response('', { status: 302, headers: { location } });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

afterEach(() => {
  persistOperatorDisplayName.mockReset();
  vi.unstubAllGlobals();
});

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
        return jsonResponse({ code: 0, token_type: 'Bearer', access_token: 'user-access-token' }, FEISHU_TOKEN_URL);
      }
      if (url === FEISHU_USER_INFO_URL) {
        expect(init?.redirect).toBe('manual');
        expect(init?.headers).toMatchObject({ authorization: 'Bearer user-access-token' });
        return jsonResponse({ code: 0, data: { open_id: openId, name: '合成姓名' } }, FEISHU_USER_INFO_URL);
      }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    const provider = createFeishuIdentityProvider(config, fetchImpl);
    expect(await provider.exchange('one-time-code')).toBe(openId);
    expect(persistOperatorDisplayName).toHaveBeenCalledWith(`usr_${openId}`, '合成姓名');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    provider.close();
    await expect(provider.exchange('one-time-code')).rejects.toMatchObject({ reason: 'DEPENDENCY_UNAVAILABLE' });
  });

  it('treats rejected codes as LOGIN_INVALID and transport faults as unavailable', async () => {
    const unauthorized = createFeishuIdentityProvider(config, async () => statusResponse(401, FEISHU_TOKEN_URL));
    try { await expect(unauthorized.exchange('code')).rejects.toMatchObject({ reason: 'LOGIN_INVALID' }); }
    finally { unauthorized.close(); }
    const unavailable = createFeishuIdentityProvider(config, async () => statusResponse(503, FEISHU_TOKEN_URL));
    try { await expect(unavailable.exchange('code')).rejects.toMatchObject({ reason: 'DEPENDENCY_UNAVAILABLE' }); }
    finally { unavailable.close(); }
  });

  it.each([
    { code: 0, token_type: 'Bearer' },
    { code: 1, token_type: 'Bearer', access_token: 'user-access-token' },
  ])('fails closed when the token receipt is not a bearer access token', async (body) => {
    const provider = createFeishuIdentityProvider(config, async () => jsonResponse(body, FEISHU_TOKEN_URL));
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
        return jsonResponse({ code: 0, token_type: 'Bearer', access_token: 'user-access-token' }, FEISHU_TOKEN_URL);
      }
      return jsonResponse(body, FEISHU_USER_INFO_URL);
    }) as unknown as typeof fetch;
    const provider = createFeishuIdentityProvider(config, fetchImpl);
    try { await expect(provider.exchange('code')).rejects.toMatchObject({ reason: 'DEPENDENCY_UNAVAILABLE' }); }
    finally { provider.close(); }
  });

  it('accepts a Feishu token receipt larger than 4KB', async () => {
    const accessToken = `u-${'a'.repeat(5000)}`;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === FEISHU_TOKEN_URL) {
        return jsonResponse({
          code: 0,
          token_type: 'Bearer',
          access_token: accessToken,
          refresh_token: `r-${'b'.repeat(2000)}`,
        }, FEISHU_TOKEN_URL);
      }
      return jsonResponse({ code: 0, data: { open_id: openId } }, FEISHU_USER_INFO_URL);
    }) as unknown as typeof fetch;
    const provider = createFeishuIdentityProvider(config, fetchImpl);
    try {
      expect(await provider.exchange('one-time-code')).toBe(openId);
    } finally {
      provider.close();
    }
  });

  it('rejects a Feishu response that settles on a non-Feishu host', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(
      { code: 0, token_type: 'Bearer', access_token: 'user-access-token' },
      'https://example.com/stolen',
    )) as unknown as typeof fetch;
    const provider = createFeishuIdentityProvider(config, fetchImpl);
    try {
      await expect(provider.exchange('code')).rejects.toMatchObject({ reason: 'DEPENDENCY_UNAVAILABLE' });
      expect(fetchImpl).toHaveBeenCalledWith(FEISHU_TOKEN_URL, expect.objectContaining({ redirect: 'error' }));
    } finally { provider.close(); }
  });

  it('accepts a Feishu response that settles on accounts.feishu.cn', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === FEISHU_TOKEN_URL) {
        return jsonResponse(
          { code: 0, token_type: 'Bearer', access_token: 'user-access-token' },
          'https://accounts.feishu.cn/open-apis/authen/v2/oauth/token',
        );
      }
      return jsonResponse({ code: 0, data: { open_id: openId } }, FEISHU_USER_INFO_URL);
    }) as unknown as typeof fetch;
    const provider = createFeishuIdentityProvider(config, fetchImpl);
    try {
      expect(await provider.exchange('one-time-code')).toBe(openId);
    } finally { provider.close(); }
  });

  it('rejects a Feishu response whose final URL cannot be parsed', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(
      { code: 0, token_type: 'Bearer', access_token: 'user-access-token' },
      'not a url',
    )) as unknown as typeof fetch;
    const provider = createFeishuIdentityProvider(config, fetchImpl);
    try {
      await expect(provider.exchange('code')).rejects.toMatchObject({ reason: 'DEPENDENCY_UNAVAILABLE' });
    } finally { provider.close(); }
  });

  it('rejects a Feishu response with an empty URL', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(
      { code: 0, token_type: 'Bearer', access_token: 'user-access-token' },
      '',
    )) as unknown as typeof fetch;
    const provider = createFeishuIdentityProvider(config, fetchImpl);
    try {
      await expect(provider.exchange('code')).rejects.toMatchObject({ reason: 'DEPENDENCY_UNAVAILABLE' });
    } finally { provider.close(); }
  });

  it('rejects a Feishu response that settles on http', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(
      { code: 0, token_type: 'Bearer', access_token: 'user-access-token' },
      'http://open.feishu.cn/open-apis/authen/v2/oauth/token',
    )) as unknown as typeof fetch;
    const provider = createFeishuIdentityProvider(config, fetchImpl);
    try {
      await expect(provider.exchange('code')).rejects.toMatchObject({ reason: 'DEPENDENCY_UNAVAILABLE' });
    } finally { provider.close(); }
  });

  it('follows one allowlisted user_info hop and keeps the bearer token', async () => {
    const hopped = `${FEISHU_USER_INFO_URL}?via=accounts`;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === FEISHU_TOKEN_URL) {
        return jsonResponse({ code: 0, token_type: 'Bearer', access_token: 'user-access-token' }, FEISHU_TOKEN_URL);
      }
      if (url === FEISHU_USER_INFO_URL) {
        expect(init?.redirect).toBe('manual');
        return redirectResponse(hopped, FEISHU_USER_INFO_URL);
      }
      if (url === hopped) {
        expect(init?.redirect).toBe('error');
        expect(init?.headers).toMatchObject({ authorization: 'Bearer user-access-token' });
        return jsonResponse({ code: 0, data: { open_id: openId } }, hopped);
      }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    const provider = createFeishuIdentityProvider(config, fetchImpl);
    try {
      expect(await provider.exchange('one-time-code')).toBe(openId);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally { provider.close(); }
  });

  it('does not follow a user_info hop off Feishu', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === FEISHU_TOKEN_URL) {
        return jsonResponse({ code: 0, token_type: 'Bearer', access_token: 'user-access-token' }, FEISHU_TOKEN_URL);
      }
      return redirectResponse('https://example.com/stolen', FEISHU_USER_INFO_URL);
    }) as unknown as typeof fetch;
    const provider = createFeishuIdentityProvider(config, fetchImpl);
    try {
      await expect(provider.exchange('code')).rejects.toMatchObject({ reason: 'DEPENDENCY_UNAVAILABLE' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally { provider.close(); }
  });

  it('reads a delayed response body after the request timer is cleared', async () => {
    const payload = new TextEncoder().encode(JSON.stringify({
      code: 0, token_type: 'Bearer', access_token: 'user-access-token',
    }));
    const fetchImpl = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      if (String(input) === FEISHU_TOKEN_URL) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            queueMicrotask(() => {
              controller.enqueue(payload);
              controller.close();
            });
          },
        });
        const response = new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
        Object.defineProperty(response, 'url', { value: FEISHU_TOKEN_URL });
        return response;
      }
      return jsonResponse({ code: 0, data: { open_id: openId } }, FEISHU_USER_INFO_URL);
    }) as unknown as typeof fetch;
    const provider = createFeishuIdentityProvider(config, fetchImpl);
    try {
      expect(await provider.exchange('one-time-code')).toBe(openId);
    } finally { provider.close(); }
  });

  it('retries a user_info TypeError once', async () => {
    let userInfoCalls = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === FEISHU_TOKEN_URL) {
        return jsonResponse({ code: 0, token_type: 'Bearer', access_token: 'user-access-token' }, FEISHU_TOKEN_URL);
      }
      userInfoCalls += 1;
      if (userInfoCalls === 1) {
        const error = new TypeError('fetch failed');
        Object.assign(error, { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
        throw error;
      }
      return jsonResponse({ code: 0, data: { open_id: openId } }, FEISHU_USER_INFO_URL);
    }) as unknown as typeof fetch;
    const provider = createFeishuIdentityProvider(config, fetchImpl);
    try {
      expect(await provider.exchange('one-time-code')).toBe(openId);
      expect(userInfoCalls).toBe(2);
    } finally { provider.close(); }
  });

  it('still logs in when writing the display name fails', async () => {
    persistOperatorDisplayName.mockImplementation(() => {
      throw new Error('disk');
    });
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === FEISHU_TOKEN_URL) {
        return jsonResponse({ code: 0, token_type: 'Bearer', access_token: 'user-access-token' }, FEISHU_TOKEN_URL);
      }
      return jsonResponse({ code: 0, data: { open_id: openId, name: '合成姓名' } }, FEISHU_USER_INFO_URL);
    }) as unknown as typeof fetch;
    const provider = createFeishuIdentityProvider(config, fetchImpl);
    try {
      expect(await provider.exchange('one-time-code')).toBe(openId);
    } finally {
      persistOperatorDisplayName.mockReset();
      provider.close();
    }
  });
});
