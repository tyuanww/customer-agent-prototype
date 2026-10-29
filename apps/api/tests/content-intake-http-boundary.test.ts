import { request as httpRequest, type ClientRequest, type IncomingHttpHeaders } from 'node:http';
import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import { createMockAuthService } from '../src/auth-service.js';
import { intakeHttpBoundary } from '../src/content-intake/http-boundary.js';

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

async function host() {
  const app = Fastify({ exposeHeadRoutes: false });
  apps.push(app);
  const auth = createMockAuthService();
  const { token } = auth.createMockSession({ user_id: 'synthetic-reader', role: 'agent' });
  const read = vi.fn(() => ({ ok: true }));
  await app.register(async parent => {
    intakeHttpBoundary(parent, auth);
    await parent.register(async child => {
      intakeHttpBoundary(child, auth);
      child.get('/read', read);
      child.post('/write', async request => request.body);
    });
  });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, read, origin, headers: { authorization: `Bearer ${token}` } };
}

function get(origin: string, headers: IncomingHttpHeaders, send: (request: ClientRequest) => void = request => request.end()) {
  return new Promise<{ status: number; body: string; headers: IncomingHttpHeaders }>((resolve, reject) => {
    const request = httpRequest(`${origin}/read`, { headers }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode!, body, headers: response.headers }));
      response.on('error', reject);
    });
    request.on('error', reject);
    send(request);
  });
}

it('accepts empty GET framing once even across nested intake hooks', async () => {
  const f = await host();
  for (const framing of [{}, { 'content-length': '0' }, { 'transfer-encoding': 'chunked' }]) {
    const response = await get(f.origin, { ...f.headers, ...framing });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  }
  expect(f.read).toHaveBeenCalledTimes(3);
});

it('rejects nonempty GETs before business code and closes the failed connection', async () => {
  const f = await host();
  for (const framing of [{ 'content-length': '1' }, { 'transfer-encoding': 'chunked' }]) {
    const response = await get(f.origin, { ...f.headers, ...framing }, request => request.end('x'));
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).error.details.reason).toBe('FILE_INVALID');
    expect(response.headers.connection).toBe('close');
  }
  expect(f.read).not.toHaveBeenCalled();
  expect((await get(f.origin, f.headers)).status).toBe(200);
});

it('waits for delayed chunks rather than interpreting an empty buffer as an empty body', async () => {
  const f = await host();
  const response = await get(f.origin, { ...f.headers, 'transfer-encoding': 'chunked' }, request => {
    request.flushHeaders();
    setTimeout(() => request.end('x'), 20);
  });
  expect(response.status).toBe(400);
  expect(f.read).not.toHaveBeenCalled();
});

it('limits an unfinished chunked GET and never calls the service', async () => {
  const f = await host();
  const response = await get(f.origin, { ...f.headers, 'transfer-encoding': 'chunked' }, request => request.flushHeaders());
  expect(response.status).toBe(400);
  expect(response.headers.connection).toBe('close');
  expect(f.read).not.toHaveBeenCalled();
}, 10_000);

it('cleans up a disconnected GET without poisoning the next request', async () => {
  const f = await host();
  await expect(get(f.origin, { ...f.headers, 'transfer-encoding': 'chunked' }, request => {
    request.flushHeaders();
    setTimeout(() => request.destroy(new Error('synthetic disconnect')), 20);
  })).rejects.toThrow('synthetic disconnect');
  expect(f.read).not.toHaveBeenCalled();
  expect((await get(f.origin, f.headers)).status).toBe(200);
});

it('authenticates first and leaves POST JSON parsing unchanged', async () => {
  const f = await host();
  expect((await get(f.origin, { 'transfer-encoding': 'chunked' })).status).toBe(401);
  expect(f.read).not.toHaveBeenCalled();
  const response = await fetch(`${f.origin}/write`, { method: 'POST', headers: { ...f.headers, 'content-type': 'application/json' }, body: '{"value":1}' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ value: 1 });
});
