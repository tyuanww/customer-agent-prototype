import { createHash } from 'node:crypto';
import { desktopFetch } from './desktop-fetch.ts';

const PKCE_VERIFIER = 'v'.repeat(43);
const REVIEW_EVIDENCE = 'EVD-STACK-REVIEW-001';
const QUALITY_EVIDENCE = 'EVD-STACK-QUALITY-001';
const BINDINGS = ['synthetic_coach', 'synthetic_owner', 'synthetic_quality'] as const;
const FEISHU_AUTHORIZE_HOSTS = new Set(['accounts.feishu.cn', 'open.feishu.cn']);

function loopbackPort(name: string, fallback: string): string {
  const raw = process.env[name] ?? fallback;
  return /^[0-9]+$/.test(raw) ? raw : fallback;
}

function reviewLoginUrl(): string {
  return `http://127.0.0.1:${loopbackPort('CUSTOMER_AGENT_REVIEW_LOGIN_PORT', '43112')}/v1/auth/review-login`;
}

function loopbackApiOrigin(): string {
  return `http://127.0.0.1:${loopbackPort('CUSTOMER_AGENT_API_PORT', '43110')}`;
}

function feishuAuthorizeLocation(location: string): boolean {
  try {
    const url = new URL(location);
    return url.protocol === 'https:' && FEISHU_AUTHORIZE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export type ReviewFetch = typeof fetch;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => ({}));
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function callbackFromAuthorize(location: string, apiOrigin: string, bindingId: string): URL | null {
  let callback: URL;
  try {
    callback = new URL(location, apiOrigin);
  } catch {
    return null;
  }
  let api: URL;
  try {
    api = new URL(apiOrigin);
  } catch {
    return null;
  }
  if (callback.origin !== api.origin) return null;
  if (!callback.pathname.includes('/v1/auth/callback')) return null;
  callback.searchParams.set('code', bindingId);
  return callback;
}

async function loginAs(
  apiOrigin: string,
  bindingId: string,
  transport: ReviewFetch,
): Promise<{ token: string; reviewOrigin: string }> {
  const challenge = createHash('sha256').update(PKCE_VERIFIER).digest('base64url');
  const created = await transport(`${apiOrigin}/v1/auth/login-requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_challenge: challenge, challenge_method: 'S256' }),
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (created.status !== 201) throw new Error(`login-requests ${String(created.status)}`);
  const login = await readJson(created);
  if (typeof login.login_id !== 'string' || typeof login.authorize_url !== 'string') {
    throw new Error('login-requests missing authorize_url');
  }
  const authorize = await transport(login.authorize_url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(5_000),
  });
  const location = authorize.headers.get('location');
  if (!location) throw new Error('authorize did not redirect');
  const callback = callbackFromAuthorize(location, apiOrigin, bindingId);
  if (!callback) {
    if (!feishuAuthorizeLocation(location)) throw new Error('authorize is not the synthetic callback');
    return { token: await loginReviewActor(bindingId, transport), reviewOrigin: loopbackApiOrigin() };
  }
  const callbackResponse = await transport(callback, {
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (!callbackResponse.ok) throw new Error(`auth callback HTTP ${String(callbackResponse.status)}`);
  const exchanged = await transport(`${apiOrigin}/v1/auth/login-requests/${login.login_id}/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_verifier: PKCE_VERIFIER }),
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (exchanged.status !== 200) throw new Error(`exchange HTTP ${String(exchanged.status)}`);
  const session = await readJson(exchanged);
  if (typeof session.access_token !== 'string') throw new Error('exchange returned no access_token');
  return { token: session.access_token, reviewOrigin: apiOrigin };
}

async function waitForRevision(
  apiOrigin: string,
  token: string,
  batchId: string,
  transport: ReviewFetch,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await transport(`${apiOrigin}/v1/admin/content/reviews?limit=100`, {
      headers: { authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) {
      const body = await readJson(response);
      const items = Array.isArray(body.items) ? body.items : [];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        if (row.batch_id === batchId && typeof row.review_revision === 'string') {
          return row.review_revision;
        }
      }
    }
    await sleep(500);
  }
  throw new Error(`review queue missed ${batchId}`);
}

async function loadReviewItems(
  apiOrigin: string,
  token: string,
  batchId: string,
  revision: string,
  transport: ReviewFetch,
): Promise<readonly { scriptId: string; contentHash: string }[]> {
  const items: { scriptId: string; contentHash: string }[] = [];
  for (let after = 0; ;) {
    const page = await transport(
      `${apiOrigin}/v1/admin/content/reviews/${batchId}?review_revision=${encodeURIComponent(revision)}&after=${String(after)}&limit=100`,
      {
        headers: { authorization: `Bearer ${token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!page.ok) throw new Error(`review page HTTP ${String(page.status)}`);
    const body = await readJson(page);
    const pageItems = Array.isArray(body.items) ? body.items : [];
    for (const item of pageItems) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (typeof row.script_id === 'string' && typeof row.content_hash === 'string') {
        items.push({ scriptId: row.script_id, contentHash: row.content_hash });
      }
    }
    const next = body.next_after;
    if (typeof next !== 'number' || pageItems.length === 0) break;
    after = next;
  }
  if (items.length === 0) throw new Error(`review page for ${batchId} has no items`);
  return items;
}

async function loginReviewActor(bindingId: string, transport: ReviewFetch): Promise<string> {
  const response = await transport(reviewLoginUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ binding_id: bindingId }),
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`review login HTTP ${String(response.status)}`);
  const session = await readJson(response);
  if (typeof session.access_token !== 'string') throw new Error('review login returned no access_token');
  return session.access_token;
}

/**
 * Drive the frozen dual-review chain the same way stack seed does.
 * Uses synthetic_coach / synthetic_owner / synthetic_quality.
 * A Feishu authorize URL does not receive those binding ids. The desktop
 * asks the loopback review login for the same three actors, then sends
 * those tokens only to the loopback API.
 */
export async function completeSyntheticParkedReview(
  apiOrigin: string,
  batchId: string,
  transport: ReviewFetch = desktopFetch,
): Promise<boolean> {
  if (!/^imp_[A-Za-z0-9_-]{1,128}$/.test(batchId)) return false;
  try {
    const leadLogin = await loginAs(apiOrigin, BINDINGS[0], transport);
    const reviewOrigin = leadLogin.reviewOrigin;
    const revision = await waitForRevision(reviewOrigin, leadLogin.token, batchId, transport, 15_000);
    const items = await loadReviewItems(reviewOrigin, leadLogin.token, batchId, revision, transport);
    const managerLogin = await loginAs(apiOrigin, BINDINGS[1], transport);
    for (const [index, item] of items.entries()) {
      for (const [token, key] of [[leadLogin.token, 'lead'], [managerLogin.token, 'manager']] as const) {
        const decision = await transport(`${reviewOrigin}/v1/admin/content/reviews/${batchId}/decisions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'idempotency-key': `dec-${key}-${batchId}-${String(index)}`,
          },
          body: JSON.stringify({
            review_revision: revision,
            script_id: item.scriptId,
            content_hash: item.contentHash,
            decision: 'approved',
            evidence_id: REVIEW_EVIDENCE,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(5_000),
        });
        if (!decision.ok) throw new Error(`decision ${key} HTTP ${String(decision.status)}`);
      }
    }
    const qualityLogin = await loginAs(apiOrigin, BINDINGS[2], transport);
    const evidence = await transport(`${reviewOrigin}/v1/admin/content/reviews/${batchId}/quality-evidence`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${qualityLogin.token}`,
        'content-type': 'application/json',
        'idempotency-key': `quality-${batchId}`,
      },
      body: JSON.stringify({
        review_revision: revision,
        phase: 'initial',
        evidence_id: QUALITY_EVIDENCE,
        checks: items.map((item) => ({
          script_id: item.scriptId,
          content_hash: item.contentHash,
          defect: false,
        })),
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    if (!evidence.ok) throw new Error(`quality evidence HTTP ${String(evidence.status)}`);
    const resume = await transport(`${reviewOrigin}/v1/admin/content/reviews/${batchId}/resume`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${qualityLogin.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ review_revision: revision }),
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    if (!resume.ok) throw new Error(`resume HTTP ${String(resume.status)}`);
    return true;
  } catch {
    return false;
  }
}
