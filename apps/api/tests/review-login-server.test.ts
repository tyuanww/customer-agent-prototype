import { expect, it } from 'vitest';
import { reviewLoginPort, startReviewLoginServer } from '../src/review-login-server.js';

it('reads the review port from the passed environment', () => {
  expect(reviewLoginPort({}, 43110)).toBeUndefined();
  expect(reviewLoginPort({ CUSTOMER_AGENT_REVIEW_LOGIN_PORT: '43112' }, 43110)).toBe(43112);
  expect(reviewLoginPort({ CUSTOMER_AGENT_REVIEW_LOGIN_PORT: '43110' }, 43110)).toBeUndefined();
  expect(reviewLoginPort({ CUSTOMER_AGENT_REVIEW_LOGIN_PORT: '80' }, 43110)).toBeUndefined();
});

async function post(port: number, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${String(port)}/v1/auth/review-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

it('issues a token only for the three review bindings', async () => {
  const issued: string[] = [];
  const server = await startReviewLoginServer(async (bindingId) => {
    issued.push(bindingId);
    return { access_token: 't'.repeat(43), expires_at: new Date(Date.now() + 60_000).toISOString() };
  }, 0);
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  try {
    const ok = await post(address.port, { binding_id: 'synthetic_coach' });
    expect(ok.status).toBe(200);
    const payload = await ok.json() as { token_type?: string; access_token?: string };
    expect(payload.token_type).toBe('Bearer');
    expect(payload.access_token).toHaveLength(43);
    expect(issued).toEqual(['synthetic_coach']);
    expect((await post(address.port, { binding_id: 'synthetic_agent' })).status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${String(address.port)}/v1/auth/login-requests`, { method: 'POST' })).status).toBe(404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
