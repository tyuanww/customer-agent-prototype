import { createServer } from 'node:http';
import { startApi } from '../src/server.js';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Client } from 'pg';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createApiApp } from '../src/app.js';
import { createProductAuthService, type SyntheticIdentityProvider } from '../src/product-auth-service.js';
import type { ApiDatabaseBootstrapConfig } from '../src/runtime-config.js';
import type { ServiceRepository } from '../src/service-repository.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const repository: ServiceRepository = {
  readiness: async () => ({ database: 'ok', schema: 'ok', auth: 'not_ready', storage: 'not_ready', content: 'not_ready' }),
  readPolicyFlags: async () => null,
  searchCandidates: async () => ({ ok: false, code: 'SOURCE_GATE_NOT_READY' }),
  executeSearch: async () => ({ ok: false, code: 'OVERLOADED' }),
  recordAdoption: async () => ({ ok: false, code: 'OVERLOADED' }),
  recordEscalation: async () => ({ ok: false, code: 'OVERLOADED' }),
  close: async () => undefined,
};

describe.skipIf(!enabled)('synthetic persistent product identity', () => {
  let harness: Pg15Harness;
  let admin: Client;
  let config: ApiDatabaseBootstrapConfig;
  let app: FastifyInstance;
  const provider = (): SyntheticIdentityProvider => ({
    authorizeUrl: state => `http://127.0.0.1:45000/authorize?state=${state}`,
    exchange: async code => { if (code !== 'synthetic-code') throw new Error('rejected'); return 'synthetic_agent'; },
    close: () => undefined,
  });
  async function build(identityProvider = provider()) {
    return createApiApp({ profile: 'test', authMode: 'mock', sessionMode: 'product', host: '127.0.0.1',
      port: 0, buildVersion: 'synthetic-t1', contractSetId: 'synthetic', runtimeActivated: false },
    repository, undefined, await createProductAuthService(config, identityProvider));
  }
  beforeEach(async () => {
    harness = new Pg15Harness(); harness.start();
    const db = harness.createDatabase('identity');
    admin = await harness.connect(db.config);
    await applyDatabaseMigrations(admin);
    await admin.query(`CREATE ROLE synthetic_auth_login LOGIN NOINHERIT;
      GRANT app_backend_auth TO synthetic_auth_login;
      INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
      VALUES ('synthetic_agent','synthetic','synthetic-tenant','synthetic-subject','synthetic-user',repeat('a',64),true,'agent')`);
    config = { connectionString: `postgresql://synthetic_auth_login@localhost/${db.name}?${new URLSearchParams({ host: harness.socket, port: String(harness.port) })}`,
      poolMax: 2, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000 };
    app = await build();
  });
  afterEach(async () => { await app?.close(); await admin?.end(); harness?.stop(); });

  async function loginRequest() {
    const response = await app.inject({ method: 'POST', url: '/v1/auth/login-requests',
      payload: { client_challenge: challenge, challenge_method: 'S256' } });
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const value = response.json();
    return { id: value.login_id as string, state: new URL(value.authorize_url).searchParams.get('state')! };
  }
  const exchange = (id: string, clientVerifier = verifier) => app.inject({ method: 'POST',
    url: `/v1/auth/login-requests/${id}/exchange`, payload: { client_verifier: clientVerifier } });
  async function session() {
    const login = await loginRequest();
    const callback = await app.inject({ url: `/v1/auth/callback?state=${login.state}&code=synthetic-code` });
    expect(callback.statusCode).toBe(200);
    expect(callback.body).not.toContain(login.state);
    const response = await exchange(login.id);
    expect(response.statusCode).toBe(200);
    return { ...login, token: response.json().access_token as string };
  }

  it('serves the real HTTP boundary and refuses implicit auth construction', async () => {
    const productConfig = { profile: 'test', authMode: 'mock', sessionMode: 'product', host: '127.0.0.1',
      port: 0, buildVersion: 'synthetic-t1', contractSetId: 'synthetic', runtimeActivated: false } as const;
    expect(() => createApiApp(productConfig, repository)).toThrow(/explicit identity service/);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(`${address}/v1/auth/login-requests`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_challenge: challenge, challenge_method: 'S256' }) });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ login_id: expect.stringMatching(/^login_/) });
    await admin.query('ALTER ROLE synthetic_auth_login SUPERUSER');
    await expect(createProductAuthService(config, provider())).rejects.toMatchObject({ reason: 'DEPENDENCY_UNAVAILABLE' });
  });

  it('starts the actual composition root with separate synthetic capability credentials', async () => {
    await app.close();
    await admin.query('CREATE ROLE synthetic_runtime LOGIN; GRANT app_runtime TO synthetic_runtime; CREATE ROLE synthetic_admin LOGIN; GRANT app_content_admin TO synthetic_admin');
    let codeUsed = false;
    const providerServer = createServer((_request, response) => {
      if (codeUsed) { response.writeHead(401); response.end(); return; }
      codeUsed = true;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ provider: 'synthetic', binding_id: 'synthetic_agent' }));
    });
    await new Promise<void>(resolve => providerServer.listen(0, '127.0.0.1', resolve));
    const providerAddress = providerServer.address();
    if (!providerAddress || typeof providerAddress === 'string') throw new Error('missing provider listener');
    const portProbe = createServer();
    await new Promise<void>(resolve => portProbe.listen(0, '127.0.0.1', resolve));
    const address = portProbe.address();
    if (!address || typeof address === 'string') throw new Error('missing port');
    await new Promise<void>(resolve => portProbe.close(() => resolve()));
    const connection = (user: string) => config.connectionString.replace('synthetic_auth_login@', `${user}@`);
    let started: Awaited<ReturnType<typeof startApi>> | undefined;
    try {
      started = await startApi({ environment: {
        CUSTOMER_AGENT_PROFILE: 'test', AUTH_MODE: 'mock', AUTH_SESSION_MODE: 'product',
        CUSTOMER_AGENT_API_PORT: String(address.port), AUTH_DATABASE_URL: config.connectionString,
        DATABASE_URL: connection('synthetic_runtime'), CONTENT_ADMIN_DATABASE_URL: connection('synthetic_admin'),
        SYNTHETIC_IDENTITY_PROVIDER_ORIGIN: `http://127.0.0.1:${providerAddress.port}`,
        IDEMPOTENCY_HMAC_KEYS: JSON.stringify({ 'hmac-idempotency-v1': 'synthetic-idempotency-material-0001' }),
        IDEMPOTENCY_HMAC_CURRENT_VERSION: 'hmac-idempotency-v1', LOG_HASH_KEY: 'synthetic-log-hash-material-00000001', LOG_HASH_KEY_VERSION: 'hmac-log-v1',
      } });
      const request = await fetch(`${started.address}/v1/auth/login-requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_challenge: challenge, challenge_method: 'S256' }) });
      expect(request.status).toBe(201);
      const login = await request.json() as { login_id: string; authorize_url: string };
      const state = new URL(login.authorize_url).searchParams.get('state');
      expect((await fetch(`${started.address}/v1/auth/callback?state=${state}&code=synthetic-code`)).status).toBe(200);
      const exchanged = await fetch(`${started.address}/v1/auth/login-requests/${login.login_id}/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_verifier: verifier }) });
      expect(exchanged.status).toBe(200);
      const session = await exchanged.json() as { access_token: string };
      expect((await fetch(`${started.address}/v1/auth/me`, { headers: { authorization: `Bearer ${session.access_token}` } })).status).toBe(200);
      const another = await fetch(`${started.address}/v1/auth/login-requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_challenge: challenge, challenge_method: 'S256' }) });
      const anotherLogin = await another.json() as { authorize_url: string };
      const anotherState = new URL(anotherLogin.authorize_url).searchParams.get('state');
      expect((await fetch(`${started.address}/v1/auth/callback?state=${anotherState}&code=synthetic-code`)).status).toBe(400);
    } finally {
      await started?.close();
      providerServer.closeAllConnections();
      await new Promise<void>(resolve => providerServer.close(() => resolve()));
    }
  });

  it('persists state and one-time PKCE exchange, then authenticates and logs out', async () => {
    const login = await loginRequest();
    expect((await exchange(login.id)).json()).toEqual({ status: 'pending', retry_after_seconds: 2 });
    expect((await exchange(login.id, 'wrong'.repeat(10))).statusCode).toBe(400);
    await app.close(); app = await build();
    expect((await app.inject({ url: `/v1/auth/callback?state=${login.state}&code=synthetic-code` })).statusCode).toBe(200);
    expect((await app.inject({ url: `/v1/auth/callback?state=${login.state}&code=synthetic-code` })).statusCode).toBe(400);
    const [first, second] = await Promise.all([exchange(login.id), exchange(login.id)]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const token = (first.statusCode === 200 ? first : second).json().access_token;
    const headers = { authorization: `Bearer ${token}` };
    await app.close(); app = await build();
    expect((await app.inject({ url: '/v1/auth/me', headers })).json()).toEqual({ user_id: 'synthetic-user', role: 'agent', auth_mode: 'mock' });
    const rows = await admin.query('SELECT token_hash FROM backend_identity.sessions');
    expect(rows.rows[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    for (let n = 0; n < 2; n++) expect((await app.inject({ method: 'POST', url: '/v1/auth/logout', headers })).statusCode).toBe(204);
    expect((await app.inject({ url: '/v1/auth/me', headers })).statusCode).toBe(401);
  });

  it('never registers mock login or accepts forged/mock credentials', async () => {
    const { token } = await session();
    expect((await app.inject({ method: 'POST', url: '/v1/auth/mock-login', payload: { user_id: 'x', role: 'owner' } })).statusCode).toBe(404);
    for (const headers of [{ 'x-mock-user': 'x', 'x-mock-role': 'owner' },
      { authorization: `Bearer ${token}`, 'x-mock-role': 'owner' }, { authorization: `Bearer ${'f'.repeat(43)}` }]) {
      expect((await app.inject({ url: '/v1/auth/me', headers })).statusCode).toBe(401);
    }
    await admin.query("UPDATE backend_identity.subject_bindings SET enabled=false WHERE binding_id='synthetic_agent'");
    expect((await app.inject({ url: '/v1/auth/me', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
  });

  it('fails closed on provider and database faults without consuming another identity', async () => {
    const login = await loginRequest();
    expect((await app.inject({ url: `/v1/auth/callback?state=${login.state}&code=rejected` })).statusCode).toBe(503);
    expect((await exchange(login.id)).statusCode).toBe(400);
    const { token } = await session();
    await admin.query('REVOKE app_backend_auth FROM synthetic_auth_login');
    const response = await app.inject({ url: '/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('synthetic_auth_login');
    expect(response.body).not.toContain(token);
  });

  it('checks current roles and session expiry on every request', async () => {
    const { token } = await session();
    const headers = { authorization: `Bearer ${token}` };
    await admin.query("UPDATE backend_identity.subject_bindings SET role='coach' WHERE binding_id='synthetic_agent'");
    expect((await app.inject({ url: '/v1/auth/me', headers })).json().role).toBe('coach');
    await admin.query("UPDATE backend_identity.sessions SET issued_at=statement_timestamp()-interval '16 minutes', expires_at=statement_timestamp()-interval '1 minute'");
    expect((await app.inject({ url: '/v1/auth/me', headers })).statusCode).toBe(401);
    const malformed = await app.inject({ method: 'POST', url: '/v1/auth/login-requests', headers: { 'content-type': 'application/json' }, payload: '{' });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.details.reason).toBe('REQUEST_INVALID');
    expect(malformed.headers['cache-control']).toBe('no-store');
  });

  it('rejects expired login and bounds invalid input and repeated requests', async () => {
    const login = await loginRequest();
    await admin.query("UPDATE backend_identity.login_requests SET issued_at=statement_timestamp()-interval '6 minutes', expires_at=statement_timestamp()-interval '1 minute' WHERE login_id=$1", [login.id]);
    expect((await exchange(login.id)).statusCode).toBe(410);
    expect((await app.inject({ url: '/v1/auth/callback?state=a&code=b&error=c' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/auth/login-requests', payload: { client_challenge: challenge, challenge_method: 'plain' } })).statusCode).toBe(400);
    for (let n = 0; n < 18; n++) await loginRequest();
    expect((await app.inject({ method: 'POST', url: '/v1/auth/login-requests', payload: { client_challenge: challenge, challenge_method: 'S256' } })).statusCode).toBe(429);
  });
});
