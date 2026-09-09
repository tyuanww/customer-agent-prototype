import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createSyntheticIdentityProvider } from '../src/synthetic-identity-provider.js';

let server: Server | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  server = undefined;
});
async function origin(status: number, body: string, headers: Record<string, string> = {}) {
  server = createServer((_request, response) => { response.writeHead(status, headers); response.end(body); });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing fixture listener');
  return `http://127.0.0.1:${address.port}`;
}
const callback = 'http://127.0.0.1:43001/v1/auth/callback';

describe('loopback synthetic identity provider', () => {
  it('uses the configured callback and accepts only synthetic binding receipts', async () => {
    const base = await origin(200, JSON.stringify({ binding_id: 'synthetic_agent', provider: 'synthetic' }));
    const provider = createSyntheticIdentityProvider(base, callback);
    const url = new URL(provider.authorizeUrl('opaque-state'));
    expect(url.origin).toBe(base);
    expect(url.searchParams.get('redirect_uri')).toBe(callback);
    expect(await provider.exchange('one-time-code')).toBe('synthetic_agent');
    provider.close();
    await expect(provider.exchange('one-time-code')).rejects.toMatchObject({ reason: 'DEPENDENCY_UNAVAILABLE' });
  });
  it.each([
    [200, '{', {}], [200, JSON.stringify({ binding_id: 'synthetic_agent', provider: 'feishu' }), {}],
    [200, JSON.stringify({ binding_id: 'actual_binding', provider: 'synthetic' }), {}],
    [200, 'x'.repeat(4097), {}], [302, '', { location: 'http://127.0.0.1:1/redirect' }],
    [503, '', {}],
  ])('fails closed for status %s and invalid or oversized responses', async (status, body, headers) => {
    const provider = createSyntheticIdentityProvider(await origin(status, body, headers), callback);
    try { await expect(provider.exchange('code')).rejects.toMatchObject({ reason: 'DEPENDENCY_UNAVAILABLE' }); }
    finally { provider.close(); }
  });
  it('distinguishes rejected codes from transport failure', async () => {
    const provider = createSyntheticIdentityProvider(await origin(401, ''), callback);
    try { await expect(provider.exchange('code')).rejects.toMatchObject({ reason: 'LOGIN_INVALID' }); }
    finally { provider.close(); }
  });
  it('aborts a pending exchange when the owning service closes', async () => {
    let accepted!: () => void;
    const requestArrived = new Promise<void>(resolve => { accepted = resolve; });
    server = createServer((_request, response) => { response.writeHead(200); response.flushHeaders(); accepted(); });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing listener');
    const provider = createSyntheticIdentityProvider(`http://127.0.0.1:${address.port}`, callback);
    const pending = provider.exchange('code');
    const rejected = expect(pending).rejects.toMatchObject({ reason: 'DEPENDENCY_UNAVAILABLE' });
    await requestArrived;
    provider.close();
    await rejected;
  });

  it('terminates a response that stalls past the provider deadline', async () => {
    server = createServer((_request, response) => { response.writeHead(200); response.flushHeaders(); });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing listener');
    const provider = createSyntheticIdentityProvider(`http://127.0.0.1:${address.port}`, callback);
    const start = performance.now();
    try {
      await expect(provider.exchange('code')).rejects.toMatchObject({ reason: 'DEPENDENCY_UNAVAILABLE' });
      expect(performance.now() - start).toBeLessThan(6500);
    } finally { provider.close(); }
  }, 8000);

  it('rejects external hosts, credentials and arbitrary callback paths', () => {
    for (const value of ['https://example.com', 'http://localhost:44000', 'http://127.0.0.1:44000/path']) {
      expect(() => createSyntheticIdentityProvider(value, callback)).toThrow();
    }
    const credentialed = new URL('http://127.0.0.1:44000');
    credentialed.username = 'synthetic-user';
    credentialed.password = 'synthetic-placeholder';
    expect(() => createSyntheticIdentityProvider(credentialed.href, callback)).toThrow();
    expect(() => createSyntheticIdentityProvider('http://127.0.0.1:44000', 'http://127.0.0.1:43001/other')).toThrow();
  });
});
