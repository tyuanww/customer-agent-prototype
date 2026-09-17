import { IdentityFailure, type SyntheticIdentityProvider } from './product-auth-service.js';

/** Official Feishu OAuth endpoints. Not configurable: arbitrary URLs would be an SSRF seam. */
export const FEISHU_AUTHORIZE_URL = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';
export const FEISHU_TOKEN_URL = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';
export const FEISHU_USER_INFO_URL = 'https://open.feishu.cn/open-apis/authen/v1/user_info';
const OPEN_ID_PATTERN = /^ou_[A-Za-z0-9]{6,64}$/;
const MAX_BODY_BYTES = 4096;

export type FeishuIdentityProviderConfig = Readonly<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}>;

type FetchLike = typeof fetch;

/** Feishu user-access-token exchange. Secrets never enter authorize URLs, logs, or thrown messages. */
export function createFeishuIdentityProvider(
  config: FeishuIdentityProviderConfig,
  fetchImpl: FetchLike = fetch,
): SyntheticIdentityProvider {
  const pending = new Set<AbortController>();
  let closed = false;

  async function readJson(response: Response): Promise<unknown> {
    if (!response.body) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
    }
  }

  function identityFromHttp(status: number): IdentityFailure {
    if (status === 400 || status === 401) return new IdentityFailure('LOGIN_INVALID');
    return new IdentityFailure('DEPENDENCY_UNAVAILABLE');
  }

  return Object.freeze({
    authorizeUrl(state: string) {
      const url = new URL(FEISHU_AUTHORIZE_URL);
      url.searchParams.set('client_id', config.clientId);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('redirect_uri', config.redirectUri);
      url.searchParams.set('state', state);
      url.searchParams.set('scope', 'auth:user.id:read');
      return url.href;
    },
    async exchange(code: string) {
      if (closed) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
      const controller = new AbortController();
      pending.add(controller);
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        const tokenResponse = await fetchImpl(FEISHU_TOKEN_URL, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
            redirect_uri: config.redirectUri,
          }),
        });
        if (!tokenResponse.ok) throw identityFromHttp(tokenResponse.status);
        const tokenBody = await readJson(tokenResponse);
        const accessToken = readAccessToken(tokenBody);
        if (!accessToken) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
        const userResponse = await fetchImpl(FEISHU_USER_INFO_URL, {
          method: 'GET',
          redirect: 'error',
          signal: controller.signal,
          headers: { authorization: `Bearer ${accessToken}` },
        });
        if (!userResponse.ok) throw identityFromHttp(userResponse.status);
        const openId = readOpenId(await readJson(userResponse));
        if (!openId) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
        return openId;
      } catch (error) {
        if (error instanceof IdentityFailure) throw error;
        throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
      } finally {
        clearTimeout(timeout);
        controller.abort();
        pending.delete(controller);
      }
    },
    close() {
      closed = true;
      for (const controller of pending) controller.abort();
      pending.clear();
    },
  });
}

function readAccessToken(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.code !== undefined && record.code !== 0) return undefined;
  if (record.token_type !== undefined && record.token_type !== 'Bearer') return undefined;
  return typeof record.access_token === 'string' && record.access_token.length > 0
    ? record.access_token
    : undefined;
}

function readOpenId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.code !== undefined && record.code !== 0) return undefined;
  const nested = record.data !== undefined && record.data !== null && typeof record.data === 'object'
    && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : record;
  const openId = nested.open_id;
  return typeof openId === 'string' && OPEN_ID_PATTERN.test(openId) ? openId : undefined;
}
