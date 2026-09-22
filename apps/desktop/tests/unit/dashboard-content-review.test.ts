// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { completeSyntheticParkedReview } from '../../src/main/dashboard-content-review';

const origin = 'http://127.0.0.1:43100';
const batchId = 'imp_rev_1';
const revision = 'ab'.repeat(32);
const token = 't'.repeat(43);

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

it('returns false when authorize redirects off the synthetic callback', async () => {
  const transport = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/v1/auth/login-requests') && !url.includes('exchange')) {
      return jsonResponse(201, {
        login_id: `login_${'a'.repeat(43)}`,
        authorize_url: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=s',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
    }
    return new Response(null, {
      status: 302,
      headers: { location: 'https://accounts.feishu.cn/next' },
    });
  }) as unknown as typeof fetch;
  expect(await completeSyntheticParkedReview(origin, batchId, transport)).toBe(false);
});

it('approves lead and manager then records quality and resume', async () => {
  const seen: string[] = [];
  const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    seen.push(`${method} ${url}`);
    if (url.endsWith('/v1/auth/login-requests') && method === 'POST' && !url.includes('exchange')) {
      return jsonResponse(201, {
        login_id: `login_${'b'.repeat(43)}`,
        authorize_url: `${origin}/synthetic/authorize?state=s`,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
    }
    if (url.includes('/synthetic/authorize')) {
      return new Response(null, {
        status: 302,
        headers: { location: `${origin}/v1/auth/callback?state=s&code=x` },
      });
    }
    if (url.includes('/v1/auth/callback')) {
      return new Response('<html></html>', { status: 200 });
    }
    if (url.includes('/exchange')) {
      return jsonResponse(200, {
        access_token: token,
        token_type: 'Bearer',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
    }
    if (url.includes('/v1/admin/content/reviews?limit=100')) {
      return jsonResponse(200, {
        items: [{
          batch_id: batchId,
          review_revision: revision,
          state: 'waiting',
          candidate_count: 1,
        }],
        next_cursor: null,
      });
    }
    if (url.includes(`/v1/admin/content/reviews/${batchId}?review_revision=`)) {
      return jsonResponse(200, {
        batch_id: batchId,
        review_revision: revision,
        items: [{
          script_id: 'upl00001',
          content_hash: 'cd'.repeat(32),
        }],
        next_after: null,
        total: 1,
      });
    }
    if (url.endsWith(`/v1/admin/content/reviews/${batchId}/decisions`)) {
      return jsonResponse(200, { ok: true });
    }
    if (url.endsWith(`/v1/admin/content/reviews/${batchId}/quality-evidence`)) {
      return jsonResponse(200, {
        receipt_id: 'rcpt_1',
        batch_id: batchId,
        review_revision: revision,
        recorded_at: new Date().toISOString(),
        quality_state: 'passed',
      });
    }
    if (url.endsWith(`/v1/admin/content/reviews/${batchId}/resume`)) {
      return jsonResponse(200, { job_id: 'job_1' });
    }
    return jsonResponse(404, {});
  }) as unknown as typeof fetch;

  expect(await completeSyntheticParkedReview(origin, batchId, transport)).toBe(true);
  expect(seen.some((row) => row.includes('/decisions'))).toBe(true);
  expect(seen.some((row) => row.includes('/quality-evidence'))).toBe(true);
  expect(seen.some((row) => row.includes('/resume'))).toBe(true);
});

it('uses the loopback review login when authorize leaves the API origin', async () => {
  const seen: string[] = [];
  const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    seen.push(`${method} ${url}`);
    if (url.endsWith('/v1/auth/login-requests') && method === 'POST' && !url.includes('exchange')) {
      return jsonResponse(201, {
        login_id: `login_${'c'.repeat(43)}`,
        authorize_url: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=s',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
    }
    if (url.includes('accounts.feishu.cn')) {
      return new Response(null, { status: 302, headers: { location: 'https://accounts.feishu.cn/next' } });
    }
    if (url === 'http://127.0.0.1:43112/v1/auth/review-login') {
      return jsonResponse(200, {
        access_token: token,
        token_type: 'Bearer',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
    }
    if (url.includes('/v1/admin/content/reviews?limit=100')) {
      return jsonResponse(200, {
        items: [{ batch_id: batchId, review_revision: revision, state: 'waiting', candidate_count: 1 }],
        next_cursor: null,
      });
    }
    if (url.includes(`/v1/admin/content/reviews/${batchId}?review_revision=`)) {
      return jsonResponse(200, {
        batch_id: batchId,
        review_revision: revision,
        items: [{ script_id: 'upl00001', content_hash: 'cd'.repeat(32) }],
        next_after: null,
        total: 1,
      });
    }
    if (url.endsWith(`/v1/admin/content/reviews/${batchId}/decisions`)
      || url.endsWith(`/v1/admin/content/reviews/${batchId}/quality-evidence`)) {
      return jsonResponse(200, { ok: true });
    }
    if (url.endsWith(`/v1/admin/content/reviews/${batchId}/resume`)) {
      return jsonResponse(200, { job_id: 'job_1' });
    }
    return jsonResponse(404, {});
  }) as unknown as typeof fetch;

  expect(await completeSyntheticParkedReview(origin, batchId, transport)).toBe(true);
  expect(seen.filter((row) => row.includes('/v1/auth/review-login'))).toHaveLength(3);
  expect(seen.some((row) => row.includes('/v1/auth/callback'))).toBe(false);
  expect(seen.some((row) => row.startsWith('POST http://127.0.0.1:43110/v1/admin/content/reviews/'))).toBe(true);
  expect(seen.some((row) => row.includes(`${origin}/v1/admin/`))).toBe(false);
});

it('does not mint a review token when authorize leaves for a non-Feishu host', async () => {
  const seen: string[] = [];
  const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.endsWith('/v1/auth/login-requests') && (init?.method ?? 'GET') === 'POST') {
      return jsonResponse(201, {
        login_id: `login_${'d'.repeat(43)}`,
        authorize_url: 'https://evil.example/authorize?state=s',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
    }
    if (url.includes('evil.example')) {
      return new Response(null, { status: 302, headers: { location: 'https://evil.example/next' } });
    }
    return jsonResponse(200, { access_token: token });
  }) as unknown as typeof fetch;
  expect(await completeSyntheticParkedReview('https://evil.example', batchId, transport)).toBe(false);
  expect(seen.some((row) => row.includes('/v1/auth/review-login'))).toBe(false);
  expect(seen.some((row) => row.includes('/v1/admin/'))).toBe(false);
});
