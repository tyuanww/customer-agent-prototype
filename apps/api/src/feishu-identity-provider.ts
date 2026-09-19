import { IdentityFailure, type SyntheticIdentityProvider } from './product-auth-service.js';
import { persistOperatorDisplayName } from './operator-display-names.js';

/** Official Feishu OAuth endpoints. Not configurable: arbitrary URLs would be an SSRF seam. */
export const FEISHU_AUTHORIZE_URL = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';
export const FEISHU_TOKEN_URL = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';
export const FEISHU_USER_INFO_URL = 'https://open.feishu.cn/open-apis/authen/v1/user_info';
const OPEN_ID_PATTERN = /^ou_[A-Za-z0-9]{6,64}$/;
/** Feishu user_access_token JSON is often 1–2KB and can grow with scope; 4KB truncates a real receipt. */
const MAX_BODY_BYTES = 32_768;
const FEISHU_RESPONSE_HOSTS = new Set(['open.feishu.cn', 'accounts.feishu.cn']);

export type FeishuIdentityProviderConfig = Readonly<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}>;

type FetchLike = typeof fetch;

function redactTransportText(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, '[url]').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function transportLabel(error: unknown): string {
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(error.name);
    if (error.message) parts.push(redactTransportText(error.message));
  } else parts.push('unknown');
  if (error !== null && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code) {
    parts.push(String((error as { code: unknown }).code));
  }
  const cause = error !== null && typeof error === 'object' && 'cause' in error
    ? (error as { cause: unknown }).cause
    : undefined;
  if (cause instanceof Error) {
    parts.push(`cause=${cause.name}`);
    if (cause.message) parts.push(redactTransportText(cause.message));
  }
  if (cause !== null && typeof cause === 'object' && cause !== undefined && 'code' in cause
    && (cause as { code: unknown }).code) {
    parts.push(String((cause as { code: unknown }).code));
  }
  return parts.join(' ');
}

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

  function assertFeishuUrl(parsed: URL): void {
    if (parsed.protocol !== 'https:' || (parsed.port !== '' && parsed.port !== '443')
      || !FEISHU_RESPONSE_HOSTS.has(parsed.hostname)) {
      throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
    }
  }

  function assertFeishuResponseHost(response: Response): void {
    const raw = response.url;
    if (!raw) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
    }
    assertFeishuUrl(parsed);
  }

  async function timed<T>(op: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    pending.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      return await op(controller.signal);
    } finally {
      clearTimeout(timeout);
      pending.delete(controller);
    }
  }

  async function once<T>(step: string, op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      if (error instanceof IdentityFailure) throw error;
      console.info(`[api] feishu identity transport retry ${step}: ${transportLabel(error)}`);
      return await op();
    }
  }

  async function fetchUserInfo(accessToken: string, signal: AbortSignal): Promise<Response> {
    const headers = { authorization: `Bearer ${accessToken}` };
    const first = await fetchImpl(FEISHU_USER_INFO_URL, {
      method: 'GET', redirect: 'manual', signal, headers,
    });
    if (first.status >= 300 && first.status < 400) {
      const location = first.headers.get('location');
      if (!location) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
      let next: URL;
      try {
        next = new URL(location, FEISHU_USER_INFO_URL);
      } catch {
        throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
      }
      assertFeishuUrl(next);
      const second = await fetchImpl(next.href, {
        method: 'GET', redirect: 'error', signal, headers,
      });
      assertFeishuResponseHost(second);
      return second;
    }
    assertFeishuResponseHost(first);
    return first;
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
      try {
        const tokenBody = await once('token', () => timed(async (signal) => {
          const tokenResponse = await fetchImpl(FEISHU_TOKEN_URL, {
            method: 'POST',
            redirect: 'error',
            signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              grant_type: 'authorization_code',
              client_id: config.clientId,
              client_secret: config.clientSecret,
              code,
              redirect_uri: config.redirectUri,
            }),
          });
          assertFeishuResponseHost(tokenResponse);
          if (!tokenResponse.ok) throw identityFromHttp(tokenResponse.status);
          return readJson(tokenResponse);
        }));
        const accessToken = readAccessToken(tokenBody);
        if (!accessToken) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
        const userBody = await once('user_info', () => timed(async (signal) => {
          const userResponse = await fetchUserInfo(accessToken, signal);
          if (!userResponse.ok) throw identityFromHttp(userResponse.status);
          return readJson(userResponse);
        }));
        const openId = readOpenId(userBody);
        if (!openId) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
        const name = readDisplayName(userBody);
        if (name) {
          try {
            persistOperatorDisplayName(`usr_${openId}`.slice(0, 128), name);
          } catch (error) {
            // Display name is best-effort; a write failure must not fail login.
            const persistName = error instanceof Error ? error.name : 'unknown';
            console.info(`[api] operator display name persist failed: ${persistName}`);
          }
        }
        return openId;
      } catch (error) {
        if (error instanceof IdentityFailure) throw error;
        console.info(`[api] feishu identity transport failed: ${transportLabel(error)}`);
        throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
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
  if (record.token_type !== undefined && String(record.token_type).toLowerCase() !== 'bearer') return undefined;
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

function readDisplayName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const nested = record.data !== undefined && record.data !== null && typeof record.data === 'object'
    && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : record;
  const name = nested.name;
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim().slice(0, 64);
  return trimmed.length > 0 ? trimmed : undefined;
}
