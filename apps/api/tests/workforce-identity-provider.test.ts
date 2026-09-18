import { describe, expect, it, vi } from 'vitest';
import { FEISHU_AUTHORIZE_URL, FEISHU_TOKEN_URL } from '../src/feishu-identity-provider.js';
import { createWorkforceIdentityProvider } from '../src/workforce-identity-provider.js';

describe('workforce identity provider', () => {
  it('uses Feishu for authorize_url and the password server for one-time codes', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'http://127.0.0.1:43101/exchange') {
        return Response.json({ provider: 'synthetic', binding_id: 'synthetic_agent' });
      }
      if (url === FEISHU_TOKEN_URL) {
        return Response.json({ code: 0, access_token: 'u-token', token_type: 'Bearer' });
      }
      return new Response('missing', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const provider = createWorkforceIdentityProvider(
      {
        clientId: 'cli_aaaaaaaaaaaaaaaa',
        clientSecret: 'test-feishu-secret-material-0001',
        redirectUri: 'https://oauth.test.invalid/v1/auth/callback',
      },
      'http://127.0.0.1:43101',
      'http://127.0.0.1:43100/v1/auth/callback',
    );
    const authorize = new URL(provider.authorizeUrl('state-1'));
    expect(`${authorize.origin}${authorize.pathname}`).toBe(FEISHU_AUTHORIZE_URL);
    expect(await provider.exchange('one-time-code')).toBe('synthetic_agent');
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('http://127.0.0.1:43101/exchange');
    provider.close();
    vi.unstubAllGlobals();
  });
});
