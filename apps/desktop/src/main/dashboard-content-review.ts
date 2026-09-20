import { createHash } from 'node:crypto';
import { desktopFetch } from './desktop-fetch.ts';

const PKCE_VERIFIER = 'v'.repeat(43);
const REVIEW_EVIDENCE = 'EVD-STACK-REVIEW-001';
const QUALITY_EVIDENCE = 'EVD-STACK-QUALITY-001';
const BINDINGS = ['synthetic_coach', 'synthetic_owner', 'synthetic_quality'] as const;

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
): Promise<string> {
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
  if (!callback) throw new Error('authorize is not the synthetic callback');
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
  return session.access_token;
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

/**
 * Drive the frozen dual-review chain the same way stack seed does.
 * Uses synthetic_coach / synthetic_owner / synthetic_quality.
 * Feishu authorize URLs fail closed (no synthetic callback).
 */
export async function completeSyntheticParkedReview(
  apiOrigin: string,
  batchId: string,
  transport: ReviewFetch = desktopFetch,
): Promise<boolean> {
  if (!/^imp_[A-Za-z0-9_-]{1,128}$/.test(batchId)) return false;
  try {
    const lead = await loginAs(apiOrigin, BINDINGS[0], transport);
    const revision = await waitForRevision(apiOrigin, lead, batchId, transport, 15_000);
    const items = await loadReviewItems(apiOrigin, lead, batchId, revision, transport);
    const manager = await loginAs(apiOrigin, BINDINGS[1], transport);
    for (const [index, item] of items.entries()) {
      for (const [token, key] of [[lead, 'lead'], [manager, 'manager']] as const) {
        const decision = await transport(`${apiOrigin}/v1/admin/content/reviews/${batchId}/decisions`, {
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
    const quality = await loginAs(apiOrigin, BINDINGS[2], transport);
    const evidence = await transport(`${apiOrigin}/v1/admin/content/reviews/${batchId}/quality-evidence`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${quality}`,
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
    const resume = await transport(`${apiOrigin}/v1/admin/content/reviews/${batchId}/resume`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${quality}`,
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
