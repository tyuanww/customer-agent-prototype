import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ClientConfig } from 'pg';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createApiApp } from '../src/app.js';
import {
  ApiConfigError,
  parseApiDatabaseBootstrapConfig,
  parseApiPrivateBootstrapConfig,
  parseApiRuntimeConfig,
} from '../src/runtime-config.js';
import type { PolicyAdminRepository } from '../src/policy-admin-repository.js';
import {
  createPolicyAdminRepository,
  createPolicyAdminRepositoryForPool,
} from '../src/policy-admin-repository.js';
import {
  createRuntimePoolVerify,
  createServiceRepository,
  createServiceRepositoryForPool,
  runtimeConnectionExceededDeadline,
  type ServiceReadinessChecks,
  type ServicePolicyFlags,
  type ServiceRepository,
} from '../src/service-repository.js';
import { startApi, startApiWithFactory } from '../src/server.js';

const openApps: FastifyInstance[] = [];

const ALL_READY = Object.freeze({
  database: 'ok',
  schema: 'ok',
  auth: 'ok',
  storage: 'ok',
  content: 'ok',
} satisfies ServiceReadinessChecks);

const W5_NOT_READY = Object.freeze({
  database: 'ok',
  schema: 'ok',
  auth: 'not_ready',
  storage: 'not_ready',
  content: 'not_ready',
} satisfies ServiceReadinessChecks);

const M1_AUTH_READY = Object.freeze({
  ...W5_NOT_READY,
  auth: 'ok',
} satisfies ServiceReadinessChecks);

const PHASE1_POLICY_OFF = Object.freeze({
  rewrite: false,
  auto_send: false,
  autofill_adapter: false,
  llm_ranker: false,
  metrics_experimental_kpi: false,
} satisfies ServicePolicyFlags);

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

function testConfig() {
  return parseApiRuntimeConfig({
    CUSTOMER_AGENT_PROFILE: 'test',
    AUTH_MODE: 'mock',
    CUSTOMER_AGENT_API_PORT: '0',
    CUSTOMER_AGENT_BUILD_VERSION: '0.2.0-w5-test',
  });
}

function stubRepository(
  checks: ServiceReadinessChecks = W5_NOT_READY,
): ServiceRepository & Readonly<{
  readiness: ReturnType<typeof vi.fn<ServiceRepository['readiness']>>;
  readPolicyFlags: ReturnType<typeof vi.fn<ServiceRepository['readPolicyFlags']>>;
  searchCandidates: ReturnType<typeof vi.fn<ServiceRepository['searchCandidates']>>;
  executeSearch: ReturnType<typeof vi.fn<ServiceRepository['executeSearch']>>;
  recordAdoption: ReturnType<typeof vi.fn<ServiceRepository['recordAdoption']>>;
  recordEscalation: ReturnType<typeof vi.fn<ServiceRepository['recordEscalation']>>;
  close: ReturnType<typeof vi.fn<ServiceRepository['close']>>;
}> {
  return {
    readiness: vi.fn<ServiceRepository['readiness']>().mockResolvedValue(checks),
    readPolicyFlags: vi.fn<ServiceRepository['readPolicyFlags']>()
      .mockResolvedValue(PHASE1_POLICY_OFF),
    searchCandidates: vi.fn<ServiceRepository['searchCandidates']>()
      .mockResolvedValue(Object.freeze({ ok: false, code: 'SOURCE_GATE_NOT_READY' })),
    executeSearch: vi.fn<ServiceRepository['executeSearch']>()
      .mockResolvedValue(Object.freeze({ ok: false, code: 'OVERLOADED' })),
    recordAdoption: vi.fn<ServiceRepository['recordAdoption']>()
      .mockResolvedValue(Object.freeze({ ok: false, code: 'OVERLOADED' })),
    recordEscalation: vi.fn<ServiceRepository['recordEscalation']>()
      .mockResolvedValue(Object.freeze({ ok: false, code: 'OVERLOADED' })),
    close: vi.fn<ServiceRepository['close']>().mockResolvedValue(undefined),
  };
}

function stubPolicyAdminRepository(): PolicyAdminRepository & Readonly<{
  setPolicyFlag: ReturnType<typeof vi.fn<PolicyAdminRepository['setPolicyFlag']>>;
  close: ReturnType<typeof vi.fn<PolicyAdminRepository['close']>>;
}> {
  return {
    setPolicyFlag: vi.fn<PolicyAdminRepository['setPolicyFlag']>()
      .mockResolvedValue(Object.freeze({ ok: true })),
    close: vi.fn<PolicyAdminRepository['close']>().mockResolvedValue(undefined),
  };
}

function databaseEnvironment(overrides: Record<string, string> = {}) {
  return {
    CUSTOMER_AGENT_PROFILE: 'test',
    AUTH_MODE: 'mock',
    CUSTOMER_AGENT_API_PORT: '0',
    DATABASE_URL: 'postgresql://w5_runtime:PASSWORD@127.0.0.1:1/w5_test',
    CONTENT_ADMIN_DATABASE_URL: 'postgresql://w1b_admin:PASSWORD@127.0.0.1:1/w5_test',
    IDEMPOTENCY_HMAC_KEYS: JSON.stringify({
      'hmac-idempotency-v1': 'synthetic-idempotency-material-0001',
    }),
    IDEMPOTENCY_HMAC_CURRENT_VERSION: 'hmac-idempotency-v1',
    LOG_HASH_KEY: 'synthetic-log-hash-material-00000001',
    LOG_HASH_KEY_VERSION: 'hmac-log-v1',
    DB_CONNECTION_TIMEOUT_MS: '100',
    DB_READINESS_TIMEOUT_MS: '100',
    ...overrides,
  };
}

describe('Application API bootstrap', () => {
  it('keeps liveness dependency-free and contract-valid', async () => {
    const repository = stubRepository();
    const app = createApiApp(testConfig(), repository);
    openApps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'cs-ai-api',
      version: '0.2.0-w5-test',
    });
    expect(repository.readiness).not.toHaveBeenCalled();
    expect(response.body).not.toContain('formal-dev');
    expect(response.body).not.toContain('contract_set_id');
  });

  it('returns the exact ready contract only when every check is ok', async () => {
    const repository = stubRepository(ALL_READY);
    const app = createApiApp(testConfig(), repository);
    openApps.push(app);

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['retry-after']).toBeUndefined();
    expect(response.json()).toEqual({ status: 'ready', checks: ALL_READY });
  });

  it('fails readiness closed for every dependency and repository exceptions', async () => {
    const repository = stubRepository();
    const diagnostics = vi.fn();
    const app = createApiApp(testConfig(), repository, diagnostics);
    openApps.push(app);

    for (const dependency of ['database', 'schema', 'storage', 'content'] as const) {
      repository.readiness.mockResolvedValueOnce({
        ...ALL_READY,
        [dependency]: 'not_ready',
      });
      const response = await app.inject({ method: 'GET', url: '/ready' });
      expect(response.statusCode, dependency).toBe(503);
      expect(response.headers['retry-after'], dependency).toBe('1');
      expect(response.headers['cache-control'], dependency).toBe('no-store');
      expect(response.json(), dependency).toEqual({
        status: 'not_ready',
        checks: { ...ALL_READY, [dependency]: 'not_ready' },
      });
    }

    repository.readiness.mockResolvedValueOnce({ ...ALL_READY, auth: 'not_ready' });
    const repositoryCannotOwnAuth = await app.inject({ method: 'GET', url: '/ready' });
    expect(repositoryCannotOwnAuth.statusCode).toBe(200);
    expect(repositoryCannotOwnAuth.json()).toEqual({ status: 'ready', checks: ALL_READY });

    repository.readiness.mockRejectedValueOnce(new Error('private DSN and SQL'));
    const failed = await app.inject({ method: 'GET', url: '/ready' });
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({
      status: 'not_ready',
      checks: {
        database: 'not_ready',
        schema: 'not_ready',
        auth: 'ok',
        storage: 'not_ready',
        content: 'not_ready',
      },
    });
    expect(failed.body).not.toContain('private DSN');
    expect(failed.body).not.toContain('SQL');
    expect(diagnostics).toHaveBeenCalledOnce();
    expect(diagnostics).toHaveBeenCalledWith({
      code: 'READINESS_REPOSITORY_CONTRACT_FAILED',
    });
  });

  it('normalizes unhandled request failures without reflecting private error text', async () => {
    const diagnostics = vi.fn();
    const app = createApiApp(testConfig(), stubRepository(), diagnostics);
    openApps.push(app);
    app.get('/_synthetic-request-failure', async () => {
      throw new Error('private DSN and request payload must not escape');
    });

    const response = await app.inject({ method: 'GET', url: '/_synthetic-request-failure' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'INTERNAL', message: '服务内部错误' },
    });
    expect(response.body).not.toContain('private DSN');
    expect(response.body).not.toContain('request payload');
    expect(diagnostics).toHaveBeenCalledOnce();
    expect(diagnostics).toHaveBeenCalledWith({ code: 'API_REQUEST_FAILED' });
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain('private DSN');
  });

  it('keeps the exact method surface while unimplemented M1 ports remain absent', async () => {
    const app = createApiApp(testConfig(), stubRepository());
    openApps.push(app);

    for (const url of ['/health', '/ready']) {
      for (const method of ['HEAD', 'POST'] as const) {
        const response = await app.inject({ method, url });
        expect(response.statusCode, `${method} ${url}`).toBe(404);
      }
    }
    for (const url of ['/v1/auth/mock-login', '/v1/search']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(404);
    }
  });

  it('creates an opaque process-local mock session and resolves only its bearer token', async () => {
    const app = createApiApp(testConfig(), stubRepository());
    openApps.push(app);

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/mock-login',
      payload: { user_id: 'usr_synthetic_agent_001', role: 'agent' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers['cache-control']).toBe('no-store');
    const session = login.json<{ token: string; user: { user_id: string; role: string } }>();
    expect(session.user).toEqual({ user_id: 'usr_synthetic_agent_001', role: 'agent' });
    expect(session.token).toMatch(/^mock_[a-f0-9]{32}$/);
    expect(session.token).not.toContain(session.user.user_id);

    const current = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(current.statusCode).toBe(200);
    expect(current.headers['cache-control']).toBe('no-store');
    expect(current.json()).toEqual({
      user_id: 'usr_synthetic_agent_001',
      role: 'agent',
      auth_mode: 'mock',
    });

    const lowercaseScheme = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `bearer ${session.token}` },
    });
    expect(lowercaseScheme.statusCode).toBe(200);

    const headerIdentity = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: {
        'x-mock-user': 'usr_synthetic_owner_001',
        'x-mock-role': 'owner',
      },
    });
    expect(headerIdentity.statusCode).toBe(200);
    expect(headerIdentity.json()).toEqual({
      user_id: 'usr_synthetic_owner_001',
      role: 'owner',
      auth_mode: 'mock',
    });
  });

  it('rejects malformed claims, unknown fields and invalid bearer credentials with contract envelopes', async () => {
    const app = createApiApp(testConfig(), stubRepository());
    openApps.push(app);

    for (const payload of [
      { user_id: '', role: 'agent' },
      { user_id: 'usr_synthetic_agent_001', role: 'admin' },
      { user_id: 'usr_synthetic_agent_001', role: 'agent', token: 'injected' },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/mock-login',
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: { code: 'VALIDATION', message: '请求不符合已冻结合同' },
      });
    }

    for (const headers of [
      {},
      { authorization: 'Basic value' },
      { authorization: 'Bearer missing' },
      { 'x-mock-user': 'usr_synthetic_agent_001' },
      { 'x-mock-role': 'agent' },
      { 'x-mock-user': 'usr_synthetic_agent_001', 'x-mock-role': 'admin' },
      {
        authorization: 'Bearer missing',
        'x-mock-user': 'usr_synthetic_agent_001',
        'x-mock-role': 'agent',
      },
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/auth/me',
        headers,
      });
      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer');
      expect(response.json()).toEqual({
        error: { code: 'UNAUTHORIZED', message: '缺少或无法验证会话' },
      });
    }
  });

  it('rejects oversized or malformed JSON with the stable validation envelope', async () => {
    const app = createApiApp(testConfig(), stubRepository());
    openApps.push(app);

    for (const { headers, payload } of [
      {
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ user_id: 'x'.repeat(32_768), role: 'agent' }),
      },
      { headers: { 'content-type': 'application/json' }, payload: '{"user_id":' },
      { headers: { 'content-type': 'application/json' }, payload: '' },
      { headers: {}, payload: 'not-json' },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/mock-login',
        headers,
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: { code: 'VALIDATION', message: '请求不符合已冻结合同' },
      });
    }
  });

  it('reads Phase 1 policy only for an authenticated identity and fails closed', async () => {
    const repository = stubRepository();
    const app = createApiApp(testConfig(), repository);
    openApps.push(app);

    const unauthorized = await app.inject({ method: 'GET', url: '/v1/policy' });
    expect(unauthorized.statusCode).toBe(401);
    expect(repository.readPolicyFlags).not.toHaveBeenCalled();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/policy',
      headers: { 'x-mock-user': 'usr_synthetic_agent_001', 'x-mock-role': 'agent' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ ...PHASE1_POLICY_OFF, auth_mode: 'mock' });

    repository.readPolicyFlags.mockResolvedValueOnce({
      ...PHASE1_POLICY_OFF,
      private_database_field: 'must-not-cross-wire-boundary',
    } as never);
    const allowlisted = await app.inject({
      method: 'GET',
      url: '/v1/policy',
      headers: { 'x-mock-user': 'usr_synthetic_agent_001', 'x-mock-role': 'agent' },
    });
    expect(allowlisted.statusCode).toBe(200);
    expect(allowlisted.json()).toEqual({ ...PHASE1_POLICY_OFF, auth_mode: 'mock' });
    expect(allowlisted.body).not.toContain('must-not-cross-wire-boundary');

    repository.readPolicyFlags.mockResolvedValueOnce(null);
    const unavailable = await app.inject({
      method: 'GET',
      url: '/v1/policy',
      headers: { 'x-mock-user': 'usr_synthetic_agent_001', 'x-mock-role': 'agent' },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.headers['retry-after']).toBe('1');
    expect(unavailable.json()).toEqual({
      error: { code: 'OVERLOADED', message: '服务暂不可用' },
    });
  });

  it('authorizes and validates policy writes before selecting the admin capability', async () => {
    const adminRepository = stubPolicyAdminRepository();
    const app = createApiApp(
      testConfig(),
      stubRepository(),
      undefined,
      undefined,
      adminRepository,
    );
    openApps.push(app);
    const payload = {
      flag_key: 'llm_ranker',
      flag_value: true,
      adr_id: 'ADR-SYNTHETIC-001',
    };

    const unauthorized = await app.inject({
      method: 'POST',
      url: '/v1/policy/flags',
      headers: { 'idempotency-key': 'synthetic-policy-001' },
      payload,
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(adminRepository.setPolicyFlag).not.toHaveBeenCalled();

    const forbidden = await app.inject({
      method: 'POST',
      url: '/v1/policy/flags',
      headers: {
        'x-mock-user': 'usr_synthetic_agent_001',
        'x-mock-role': 'agent',
        'idempotency-key': 'synthetic-policy-001',
      },
      payload,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(adminRepository.setPolicyFlag).not.toHaveBeenCalled();

    const hardOff = await app.inject({
      method: 'POST',
      url: '/v1/policy/flags',
      headers: {
        'x-mock-user': 'usr_synthetic_owner_001',
        'x-mock-role': 'owner',
        'idempotency-key': 'synthetic-policy-002',
      },
      payload: { flag_key: 'rewrite', flag_value: true, adr_id: 'ADR-SYNTHETIC-002' },
    });
    expect(hardOff.statusCode).toBe(403);
    expect(hardOff.json()).toMatchObject({
      error: {
        code: 'POLICY_DENIED',
        details: {
          reason: 'PHASE1_HARD_OFF',
          flag_key: 'rewrite',
          requested_value: true,
        },
      },
    });
    expect(adminRepository.setPolicyFlag).not.toHaveBeenCalled();

    const missingKey = await app.inject({
      method: 'POST',
      url: '/v1/policy/flags',
      headers: {
        'x-mock-user': 'usr_synthetic_owner_001',
        'x-mock-role': 'owner',
      },
      payload,
    });
    expect(missingKey.statusCode).toBe(400);

    const success = await app.inject({
      method: 'POST',
      url: '/v1/policy/flags',
      headers: {
        'x-mock-user': 'usr_synthetic_owner_001',
        'x-mock-role': 'owner',
        'idempotency-key': 'synthetic-policy-003',
      },
      payload,
    });
    expect(success.statusCode).toBe(200);
    expect(success.headers['cache-control']).toBe('no-store');
    expect(success.json()).toEqual({
      ok: true,
      flag_key: 'llm_ranker',
      flag_value: true,
    });
    expect(adminRepository.setPolicyFlag).toHaveBeenCalledOnce();

    adminRepository.setPolicyFlag.mockResolvedValueOnce({ ok: false, code: 'OVERLOADED' });
    const unavailable = await app.inject({
      method: 'POST',
      url: '/v1/policy/flags',
      headers: {
        'x-mock-user': 'usr_synthetic_owner_001',
        'x-mock-role': 'owner',
        'idempotency-key': 'synthetic-policy-004',
      },
      payload,
    });
    expect(unavailable.statusCode).toBe(503);
  });

  it('maps a bounded set of transient PostgreSQL policy failures to retryable overload', async () => {
    const failures = [
      ...['08006', '53300', '55P03', '57014', '57P01', '57P02', '57P03', 'ECONNREFUSED']
        .map((code) => ({
        label: code,
        error: Object.assign(new Error('synthetic database failure'), { code }),
        })),
      { label: 'driver-query-timeout', error: new Error('Query read timeout') },
      {
        label: 'driver-active-connection-terminated',
        error: new Error('Connection terminated unexpectedly'),
      },
      {
        label: 'driver-connection-terminated',
        error: new Error('Connection terminated'),
      },
      {
        label: 'driver-client-no-longer-queryable',
        error: new Error(
          'Client has encountered a connection error and is not queryable',
        ),
      },
      {
        label: 'driver-client-was-closed',
        error: new Error('Client was closed and is not queryable'),
      },
      {
        label: 'pool-connect-timeout',
        error: new Error('timeout exceeded when trying to connect'),
      },
    ];
    for (const { label, error } of failures) {
      const policyAdminRepository = createPolicyAdminRepositoryForPool({
        query: vi.fn().mockRejectedValue(error),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      });
      const app = createApiApp(
        testConfig(),
        stubRepository(),
        undefined,
        undefined,
        policyAdminRepository,
      );
      openApps.push(app);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/policy/flags',
        headers: {
          'x-mock-user': 'usr_synthetic_owner_001',
          'x-mock-role': 'owner',
          'idempotency-key': `synthetic-policy-${label}`,
        },
        payload: {
          flag_key: 'llm_ranker',
          flag_value: true,
          adr_id: 'ADR-SYNTHETIC-RETRY',
        },
      });

      expect(response.statusCode, label).toBe(503);
      expect(response.headers['retry-after'], label).toBe('1');
      expect(response.json(), label).toEqual({
        error: { code: 'OVERLOADED', message: '服务暂不可用' },
      });
    }
  });

  it('validates private database bootstrap fields without adding them to public config', () => {
    const environment = databaseEnvironment({
      DB_POOL_MAX: '7',
      DB_CONNECTION_TIMEOUT_MS: '1500',
      DB_READINESS_TIMEOUT_MS: '1700',
    });
    const database = parseApiDatabaseBootstrapConfig(environment);
    const publicConfig = parseApiRuntimeConfig(environment);

    expect(database).toEqual({
      connectionString: environment.DATABASE_URL,
      poolMax: 7,
      connectionTimeoutMs: 1500,
      readinessTimeoutMs: 1700,
    });
    expect(Object.isFrozen(database)).toBe(true);
    expect(publicConfig).not.toHaveProperty('connectionString');
    expect(publicConfig).not.toHaveProperty('DATABASE_URL');
    expect(parseApiDatabaseBootstrapConfig({
      DATABASE_URL: environment.DATABASE_URL,
    })).toEqual({
      connectionString: environment.DATABASE_URL,
      poolMax: 18,
      connectionTimeoutMs: 2000,
      readinessTimeoutMs: 2000,
    });

    for (const [overrides, field] of [
      [{ DATABASE_URL: '' }, 'DATABASE_URL'],
      [{ DATABASE_URL: 'https://database.example/w5' }, 'DATABASE_URL'],
      [{ DATABASE_URL: 'postgresql://database.example/w5' }, 'DATABASE_URL'],
      [{ DATABASE_URL: 'postgresql://w5_runtime@127.0.0.1/' }, 'DATABASE_URL'],
      [{ DATABASE_URL: 'postgresql://w5_runtime@127.0.0.1/w5?query_timeout=900000' }, 'DATABASE_URL'],
      [{ DATABASE_URL: 'postgresql://w5_runtime@127.0.0.1/w5?application_name=override' }, 'DATABASE_URL'],
      [{ DATABASE_URL: 'postgresql://w5_runtime@127.0.0.1/w5?host=%2Ftmp%2Fa&host=%2Ftmp%2Fb' }, 'DATABASE_URL'],
      [{ DATABASE_URL: 'postgresql://w5_runtime@[::1]/w5' }, 'DATABASE_URL'],
      [{ DB_POOL_MAX: '0' }, 'DB_POOL_MAX'],
      [{ DB_POOL_MAX: '21' }, 'DB_POOL_MAX'],
      [{ DB_CONNECTION_TIMEOUT_MS: '10001' }, 'DB_CONNECTION_TIMEOUT_MS'],
      [{ DB_READINESS_TIMEOUT_MS: '0' }, 'DB_READINESS_TIMEOUT_MS'],
      [{ DB_READINESS_TIMEOUT_MS: '10001' }, 'DB_READINESS_TIMEOUT_MS'],
    ] as const) {
      const rejectedEnvironment = databaseEnvironment(overrides);
      try {
        parseApiDatabaseBootstrapConfig(rejectedEnvironment);
        throw new Error(`Expected ${field} rejection`);
      } catch (error) {
        expect(error).toBeInstanceOf(ApiConfigError);
        expect((error as ApiConfigError).issues).toContainEqual({ field, reason: 'invalid' });
        if (rejectedEnvironment.DATABASE_URL.length > 0) {
          expect((error as Error).message).not.toContain(rejectedEnvironment.DATABASE_URL);
        }
      }
    }

    try {
      parseApiDatabaseBootstrapConfig({});
      throw new Error('Expected missing DATABASE_URL rejection');
    } catch (error) {
      expect((error as ApiConfigError).issues).toContainEqual({
        field: 'DATABASE_URL',
        reason: 'missing',
      });
    }
  });

  it('validates isolated key domains and a shared two-pool connection budget', () => {
    const environment = databaseEnvironment({
      DB_POOL_MAX: '16',
      CONTENT_ADMIN_DB_POOL_MAX: '2',
    });
    const bootstrap = parseApiPrivateBootstrapConfig(environment);

    expect(bootstrap.runtimeDatabase).toMatchObject({
      connectionString: environment.DATABASE_URL,
      poolMax: 16,
    });
    expect(bootstrap.policyAdminDatabase).toMatchObject({
      connectionString: environment.CONTENT_ADMIN_DATABASE_URL,
      poolMax: 2,
    });
    expect(bootstrap.idempotencyHmac).toEqual({
      currentVersion: 'hmac-idempotency-v1',
      keys: { 'hmac-idempotency-v1': 'synthetic-idempotency-material-0001' },
    });
    expect(bootstrap.logHash).toEqual({
      version: 'hmac-log-v1',
      key: 'synthetic-log-hash-material-00000001',
    });
    expect(Object.isFrozen(bootstrap)).toBe(true);
    expect(Object.isFrozen(bootstrap.idempotencyHmac.keys)).toBe(true);

    for (const [overrides, field] of [
      [{ CONTENT_ADMIN_DATABASE_URL: environment.DATABASE_URL }, 'CONTENT_ADMIN_DATABASE_URL'],
      [{ CONTENT_ADMIN_DATABASE_URL: 'postgresql://w5_runtime@127.0.0.1:1/w5_admin' }, 'CONTENT_ADMIN_DATABASE_URL'],
      [{ CONTENT_ADMIN_DATABASE_URL: 'postgresql://w1b_admin@127.0.0.1:2/w5_test' }, 'CONTENT_ADMIN_DATABASE_URL'],
      [{ CONTENT_ADMIN_DATABASE_URL: 'postgresql://w1b_admin@127.0.0.1:1/w5_admin' }, 'CONTENT_ADMIN_DATABASE_URL'],
      [{ CONTENT_ADMIN_DATABASE_URL: 'postgresql://w1b_admin@localhost:1/w5_test' }, 'CONTENT_ADMIN_DATABASE_URL'],
      [{ DB_POOL_MAX: '19', CONTENT_ADMIN_DB_POOL_MAX: '2' }, 'CONTENT_ADMIN_DB_POOL_MAX'],
      [{ IDEMPOTENCY_HMAC_KEYS: '{bad-json' }, 'IDEMPOTENCY_HMAC_KEYS'],
      [{
        IDEMPOTENCY_HMAC_KEYS: JSON.stringify({
          'hmac-idempotency-v1': 'synthetic-idempotency-material-0001',
          'hmac-idempotency-v2': 'synthetic-idempotency-material-0001',
        }),
      }, 'IDEMPOTENCY_HMAC_KEYS'],
      [{ IDEMPOTENCY_HMAC_CURRENT_VERSION: 'hmac-missing-v2' }, 'IDEMPOTENCY_HMAC_CURRENT_VERSION'],
      [{ LOG_HASH_KEY: 'synthetic-idempotency-material-0001' }, 'LOG_HASH_KEY'],
      [{ LOG_HASH_KEY_VERSION: 'unsafe version' }, 'LOG_HASH_KEY_VERSION'],
    ] as const) {
      try {
        parseApiPrivateBootstrapConfig(databaseEnvironment(overrides));
        throw new Error(`Expected ${field} rejection`);
      } catch (error) {
        expect(error).toBeInstanceOf(ApiConfigError);
        expect((error as ApiConfigError).issues).toContainEqual({ field, reason: 'invalid' });
        expect((error as Error).message).not.toContain('synthetic-idempotency-material-0001');
      }
    }
  });

  it('rejects configuration before constructing repositories or Fastify', async () => {
    const buildApp = vi.fn(() => {
      throw new Error('must not construct the host');
    });
    const buildRepository = vi.fn(() => stubRepository());

    await expect(startApiWithFactory(
      {
        environment: {
          CUSTOMER_AGENT_PROFILE: 'test',
          AUTH_MODE: 'mock',
          CUSTOMER_AGENT_API_PORT: '0',
        },
      },
      buildApp,
      buildRepository,
    )).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
      issues: expect.arrayContaining([{ field: 'DATABASE_URL', reason: 'missing' }]),
    });
    expect(buildRepository).not.toHaveBeenCalled();
    expect(buildApp).not.toHaveBeenCalled();
  });

  it('closes partial resources without replacing a listen error', async () => {
    const listenError = new Error('listen failed');
    const close = vi.fn().mockRejectedValue(new Error('app close failed'));
    const listen = vi.fn().mockRejectedValue(listenError);
    const app = { close, listen } as unknown as FastifyInstance;
    const repository = stubRepository();

    await expect(startApiWithFactory(
      { environment: databaseEnvironment() },
      () => app,
      () => repository,
    )).rejects.toBe(listenError);
    expect(listen).toHaveBeenCalledWith({ host: '127.0.0.1', port: 0 });
    expect(close).toHaveBeenCalledOnce();
    expect(repository.close).toHaveBeenCalledOnce();
  });

  it('closes the repository when app construction fails', async () => {
    const constructionError = new Error('construction failed');
    const repository = stubRepository();

    await expect(startApiWithFactory(
      { environment: databaseEnvironment() },
      () => {
        throw constructionError;
      },
      () => repository,
    )).rejects.toBe(constructionError);
    expect(repository.close).toHaveBeenCalledOnce();
  });

  it('closes the runtime repository when admin repository construction fails', async () => {
    const constructionError = new Error('admin repository construction failed');
    const repository = stubRepository();
    const buildApp = vi.fn();

    await expect(startApiWithFactory(
      { environment: databaseEnvironment() },
      buildApp,
      () => repository,
      () => {
        throw constructionError;
      },
    )).rejects.toBe(constructionError);
    expect(repository.close).toHaveBeenCalledOnce();
    expect(buildApp).not.toHaveBeenCalled();
  });

  it('binds repository cleanup to Fastify close', async () => {
    const repository = stubRepository();
    const app = createApiApp(testConfig(), repository);

    await app.close();

    expect(repository.close).toHaveBeenCalledOnce();
  });

  it('starts on an ephemeral loopback port and closes cleanly without connecting health to DB', async () => {
    const started = await startApi({
      environment: databaseEnvironment({
        CUSTOMER_AGENT_BUILD_VERSION: '0.2.0-w5-listen',
      }),
    });
    try {
      expect(started.address).toMatch(/^http:\/\/127\.0\.0\.1:[0-9]+$/);
      expect(started.config).not.toHaveProperty('DATABASE_URL');
      expect(started.config).not.toHaveProperty('connectionString');
      const response = await fetch(`${started.address}/health`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        status: 'ok',
        service: 'cs-ai-api',
        version: '0.2.0-w5-listen',
      });
    } finally {
      await started.close();
    }
  });
});

describe('ServiceRepository readiness', () => {
  function schemaRow(overrides: Record<string, unknown> = {}) {
    return {
      database_probe: 1,
      server_version_num: 150_013,
      schema_comment: 'CS-AI-C11 schema.v1.15; synthetic unit fixture',
      repository_boundary_present: true,
      runtime_identity_safe: true,
      runtime_effective_acl_safe: true,
      runtime_search_boundary_safe: true,
      ...overrides,
    };
  }

  function fakePool(result = schemaRow()) {
    let idleError: ((error: Error) => void) | undefined;
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [result] }),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((event: string, listener: (error: Error) => void) => {
        if (event === 'error') idleError = listener;
        return pool;
      }),
    };
    return { pool, emitIdleError: () => idleError?.(new Error('idle failure')) };
  }

  it('rejects a connection that completes at or after the pool deadline', () => {
    expect(runtimeConnectionExceededDeadline(100, 50, 149.999)).toBe(false);
    expect(runtimeConnectionExceededDeadline(100, 50, 150)).toBe(true);
    expect(runtimeConnectionExceededDeadline(100, 50, 151)).toBe(true);

    const done = vi.fn();
    const verify = createRuntimePoolVerify(50, () => 150);
    verify({ runtimeConnectionStartedAt: 100 } as never, done);
    expect(done).toHaveBeenCalledOnce();
    expect(done.mock.calls[0]?.[0]).toMatchObject({
      message: 'Runtime database connection exceeded its configured deadline',
    });
  });

  it('fails closed when a successful probe settles at or after its response deadline', async () => {
    let now = 100;
    let resolveQuery!: (value: { rows: ReturnType<typeof schemaRow>[] }) => void;
    const query = vi.fn(() => new Promise<{ rows: ReturnType<typeof schemaRow>[] }>((resolve) => {
      resolveQuery = resolve;
    }));
    const pool = {
      query,
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockReturnThis(),
    };
    const diagnostics = vi.fn();
    const repository = createServiceRepositoryForPool(pool as never, {
      readinessTimeoutMs: 25,
      diagnosticSink: diagnostics,
      now: () => now,
    });

    const readiness = repository.readiness();
    now = 125;
    resolveQuery({ rows: [schemaRow()] });

    await expect(readiness).resolves.toEqual({
      ...W5_NOT_READY,
      database: 'not_ready',
      schema: 'not_ready',
    });
    expect(diagnostics).toHaveBeenCalledOnce();
    expect(diagnostics).toHaveBeenCalledWith({
      code: 'DATABASE_READINESS_DEADLINE_EXCEEDED',
    });
  });

  it('uses one schema and ACL probe while keeping later capabilities hard-off', async () => {
    const { pool } = fakePool();
    const repository = createServiceRepositoryForPool(pool as never);

    await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);
    expect(pool.query).toHaveBeenCalledOnce();
    expect(pool.query.mock.calls[0]?.[0]).not.toContain('schema_migrations');
  });

  it('separates database reachability from schema drift', async () => {
    for (const drift of [
      { server_version_num: 160_001 },
      { schema_comment: 'CS-AI-C11 schema.v1.11; stale' },
      { repository_boundary_present: false },
      { runtime_identity_safe: false },
      { runtime_effective_acl_safe: false },
      { runtime_search_boundary_safe: false },
    ]) {
      const { pool } = fakePool(schemaRow(drift));
      const repository = createServiceRepositoryForPool(pool as never);
      await expect(repository.readiness()).resolves.toMatchObject({
        database: 'ok',
        schema: 'not_ready',
      });
      await repository.close();
    }
  });

  it('reports idle-client and query failures without inventing a one-request outage', async () => {
    const { pool, emitIdleError } = fakePool();
    const diagnostics = vi.fn();
    const repository = createServiceRepositoryForPool(pool as never, { diagnosticSink: diagnostics });

    emitIdleError();
    expect(diagnostics).toHaveBeenCalledWith({
      code: 'DATABASE_IDLE_CLIENT_FAILED',
    });
    await expect(repository.readiness()).resolves.toMatchObject({ database: 'ok', schema: 'ok' });
    expect(pool.query).toHaveBeenCalledOnce();

    pool.query.mockRejectedValueOnce(new Error('private database failure'));
    await expect(repository.readiness()).resolves.toMatchObject({
      database: 'not_ready',
      schema: 'not_ready',
    });
    expect(diagnostics).toHaveBeenCalledWith({
      code: 'DATABASE_READINESS_PROBE_FAILED',
    });
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain('private database failure');
  });

  it('bounds and single-flights concurrent probes without starting work behind a timed-out query', async () => {
    vi.useFakeTimers();
    let resolveFirstQuery!: (value: { rows: ReturnType<typeof schemaRow>[] }) => void;
    const query = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstQuery = resolve;
      }))
      .mockResolvedValue({ rows: [schemaRow()] });
    const pool = {
      query,
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockReturnThis(),
    };
    const diagnostics = vi.fn();
    const repository = createServiceRepositoryForPool(pool as never, {
      readinessTimeoutMs: 25,
      diagnosticSink: diagnostics,
    });

    const first = repository.readiness();
    const second = repository.readiness();
    expect(query).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(25);
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ...W5_NOT_READY, database: 'not_ready', schema: 'not_ready' },
      { ...W5_NOT_READY, database: 'not_ready', schema: 'not_ready' },
    ]);
    expect(diagnostics).toHaveBeenCalledTimes(1);
    expect(diagnostics).toHaveBeenCalledWith({
      code: 'DATABASE_READINESS_DEADLINE_EXCEEDED',
    });

    await expect(repository.readiness()).resolves.toMatchObject({ database: 'not_ready' });
    expect(query).toHaveBeenCalledOnce();

    resolveFirstQuery({ rows: [schemaRow()] });
    await Promise.resolve();
    await Promise.resolve();
    await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('closes the pool once and remains not ready afterwards', async () => {
    const { pool } = fakePool();
    const repository = createServiceRepositoryForPool(pool as never);

    await Promise.all([repository.close(), repository.close()]);
    expect(pool.end).toHaveBeenCalledOnce();
    await expect(repository.readiness()).resolves.toMatchObject({
      database: 'not_ready',
      schema: 'not_ready',
    });
  });
});

const describePg15 = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1'
  ? describe.sequential
  : describe.skip;

describePg15('Application API PostgreSQL 15 runtime boundary', () => {
  let harness: Pg15Harness;
  let database: Readonly<{ name: string; config: ClientConfig }>;

  beforeAll(async () => {
    harness = new Pg15Harness();
    harness.start();
    database = harness.createDatabase('api_runtime');
    const owner = await harness.connect(database.config);
    try {
      await applyDatabaseMigrations(owner);
      await owner.query('CREATE ROLE w5_runtime LOGIN');
      await owner.query('GRANT app_runtime TO w5_runtime');
      await owner.query('CREATE ROLE w1b_admin LOGIN');
      await owner.query('GRANT app_content_admin TO w1b_admin');
    } finally {
      await owner.end();
    }
  }, 120_000);

  afterAll(() => harness.stop(), 60_000);

  it('proves real pool/schema readiness without bypassing runtime ACL or later gates', async () => {
    const host = String(database.config.host);
    const port = String(database.config.port);
    const connectionString = `postgresql://w5_runtime@localhost/${database.name}?${new URLSearchParams({ host, port })}`;
    const adminConnectionString = `postgresql://w1b_admin@localhost/${database.name}?${new URLSearchParams({ host, port })}`;
    const bootstrap = parseApiPrivateBootstrapConfig({
      DATABASE_URL: connectionString,
      CONTENT_ADMIN_DATABASE_URL: adminConnectionString,
      IDEMPOTENCY_HMAC_KEYS: JSON.stringify({
        'hmac-idempotency-v1': 'synthetic-idempotency-material-pg15',
      }),
      IDEMPOTENCY_HMAC_CURRENT_VERSION: 'hmac-idempotency-v1',
      LOG_HASH_KEY: 'synthetic-log-hash-material-pg15-01',
      LOG_HASH_KEY_VERSION: 'hmac-log-v1',
      DB_POOL_MAX: '2',
      CONTENT_ADMIN_DB_POOL_MAX: '1',
      DB_CONNECTION_TIMEOUT_MS: '2000',
      DB_READINESS_TIMEOUT_MS: '2000',
    });
    const repository = createServiceRepository(bootstrap.runtimeDatabase);
    const policyAdminRepository = createPolicyAdminRepository(bootstrap.policyAdminDatabase);
    const app = createApiApp(
      testConfig(),
      repository,
      undefined,
      undefined,
      policyAdminRepository,
    );
    openApps.push(app);

    await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);
    await expect(repository.readPolicyFlags()).resolves.toEqual(PHASE1_POLICY_OFF);
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready', checks: M1_AUTH_READY });

    const runtimeClient = await harness.connect({ ...database.config, user: 'w5_runtime' });
    try {
      await expect(runtimeClient.query('SELECT * FROM public.content_current')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(runtimeClient.query(
        "SELECT public.set_policy_flag('llm_ranker', TRUE, 'usr_synthetic_owner_001', 'owner', NULL)",
      )).rejects.toMatchObject({ code: '42501' });
    } finally {
      await runtimeClient.end();
    }

    const policyWrite = await app.inject({
      method: 'POST',
      url: '/v1/policy/flags',
      headers: {
        'x-mock-user': 'usr_synthetic_owner_001',
        'x-mock-role': 'owner',
        'idempotency-key': 'synthetic-policy-pg15-001',
      },
      payload: { flag_key: 'llm_ranker', flag_value: true, adr_id: 'ADR-SYNTHETIC-PG15' },
    });
    expect(policyWrite.statusCode).toBe(200);
    expect(policyWrite.json()).toEqual({ ok: true, flag_key: 'llm_ranker', flag_value: true });

    const ownerAfterPolicyWrite = await harness.connect(database.config);
    try {
      const persisted = await ownerAfterPolicyWrite.query<{
        flag_value: boolean;
        audit_count: string;
      }>(`
        SELECT
          (SELECT flag_value FROM public.policy_flags WHERE flag_key = 'llm_ranker') AS flag_value,
          (SELECT pg_catalog.count(*)::text FROM public.change_audits
           WHERE action = 'policy_set'
             AND actor_user_id = 'usr_synthetic_owner_001'
             AND metadata->>'flag_key' = 'llm_ranker') AS audit_count
      `);
      expect(persisted.rows[0]).toEqual({ flag_value: true, audit_count: '1' });

      await ownerAfterPolicyWrite.query('GRANT SELECT ON public.content_current TO w5_runtime');
      try {
        await expect(repository.readiness()).resolves.toMatchObject({
          database: 'ok',
          schema: 'not_ready',
        });
        await expect(repository.readPolicyFlags()).resolves.toBeNull();
        const policyUnderDrift = await app.inject({
          method: 'GET',
          url: '/v1/policy',
          headers: {
            'x-mock-user': 'usr_synthetic_agent_001',
            'x-mock-role': 'agent',
          },
        });
        expect(policyUnderDrift.statusCode).toBe(503);
      } finally {
        await ownerAfterPolicyWrite.query('REVOKE SELECT ON public.content_current FROM w5_runtime');
      }
      await expect(repository.readPolicyFlags()).resolves.toEqual({
        ...PHASE1_POLICY_OFF,
        llm_ranker: true,
      });

      await ownerAfterPolicyWrite.query('GRANT app_runtime TO w1b_admin');
      const mixedRole = await app.inject({
        method: 'POST',
        url: '/v1/policy/flags',
        headers: {
          'x-mock-user': 'usr_synthetic_owner_001',
          'x-mock-role': 'owner',
          'idempotency-key': 'synthetic-policy-pg15-002',
        },
        payload: { flag_key: 'llm_ranker', flag_value: false, adr_id: null },
      });
      expect(mixedRole.statusCode).toBe(403);
      await ownerAfterPolicyWrite.query('REVOKE app_runtime FROM w1b_admin');

      await ownerAfterPolicyWrite.query('CREATE ROLE w1b_admin_inheritor LOGIN');
      try {
        await ownerAfterPolicyWrite.query('GRANT w1b_admin TO w1b_admin_inheritor');
        const inheritedLogin = await app.inject({
          method: 'POST',
          url: '/v1/policy/flags',
          headers: {
            'x-mock-user': 'usr_synthetic_owner_001',
            'x-mock-role': 'owner',
            'idempotency-key': 'synthetic-policy-pg15-003',
          },
          payload: { flag_key: 'llm_ranker', flag_value: false, adr_id: null },
        });
        expect(inheritedLogin.statusCode).toBe(403);
      } finally {
        await ownerAfterPolicyWrite.query('REVOKE w1b_admin FROM w1b_admin_inheritor')
          .catch(() => undefined);
        await ownerAfterPolicyWrite.query('DROP ROLE IF EXISTS w1b_admin_inheritor');
      }

      await ownerAfterPolicyWrite.query('CREATE ROLE w1b_admin_peer LOGIN');
      try {
        await ownerAfterPolicyWrite.query('GRANT app_content_admin TO w1b_admin_peer');
        const sharedCapability = await app.inject({
          method: 'POST',
          url: '/v1/policy/flags',
          headers: {
            'x-mock-user': 'usr_synthetic_owner_001',
            'x-mock-role': 'owner',
            'idempotency-key': 'synthetic-policy-pg15-004',
          },
          payload: { flag_key: 'llm_ranker', flag_value: false, adr_id: null },
        });
        expect(sharedCapability.statusCode).toBe(403);
      } finally {
        await ownerAfterPolicyWrite.query('REVOKE app_content_admin FROM w1b_admin_peer')
          .catch(() => undefined);
        await ownerAfterPolicyWrite.query('DROP ROLE IF EXISTS w1b_admin_peer');
      }

      await ownerAfterPolicyWrite.query(`
        ALTER FUNCTION public.set_policy_flag(TEXT,BOOLEAN,TEXT,TEXT,TEXT)
        SECURITY INVOKER
      `);
      try {
        const driftedFunction = await app.inject({
          method: 'POST',
          url: '/v1/policy/flags',
          headers: {
            'x-mock-user': 'usr_synthetic_owner_001',
            'x-mock-role': 'owner',
            'idempotency-key': 'synthetic-policy-pg15-005',
          },
          payload: { flag_key: 'llm_ranker', flag_value: false, adr_id: null },
        });
        expect(driftedFunction.statusCode).toBe(403);
      } finally {
        await ownerAfterPolicyWrite.query(`
          ALTER FUNCTION public.set_policy_flag(TEXT,BOOLEAN,TEXT,TEXT,TEXT)
          SECURITY DEFINER
        `);
      }
    } finally {
      await ownerAfterPolicyWrite.query('REVOKE app_runtime FROM w1b_admin').catch(() => undefined);
      await ownerAfterPolicyWrite.query('REVOKE w1b_admin FROM w1b_admin_inheritor')
        .catch(() => undefined);
      await ownerAfterPolicyWrite.query('DROP ROLE IF EXISTS w1b_admin_inheritor')
        .catch(() => undefined);
      await ownerAfterPolicyWrite.query('REVOKE app_content_admin FROM w1b_admin_peer')
        .catch(() => undefined);
      await ownerAfterPolicyWrite.query('DROP ROLE IF EXISTS w1b_admin_peer')
        .catch(() => undefined);
      await ownerAfterPolicyWrite.query(`
        ALTER FUNCTION public.set_policy_flag(TEXT,BOOLEAN,TEXT,TEXT,TEXT)
        SECURITY DEFINER
      `).catch(() => undefined);
      await ownerAfterPolicyWrite.end();
    }
    const policyRestore = await app.inject({
      method: 'POST',
      url: '/v1/policy/flags',
      headers: {
        'x-mock-user': 'usr_synthetic_owner_001',
        'x-mock-role': 'owner',
        'idempotency-key': 'synthetic-policy-pg15-006',
      },
      payload: { flag_key: 'llm_ranker', flag_value: false, adr_id: null },
    });
    expect(policyRestore.statusCode).toBe(200);

    const owner = await harness.connect(database.config);
    let originalSearchFunctionDefinition: string | undefined;
    let originalScopeFunctionDefinition: string | undefined;
    let originalQuestionValidationDefinition: string | undefined;
    let originalQuestionHashDefinition: string | undefined;
    let originalPublicQuestionsDefinition: string | undefined;
    try {
      await owner.query("UPDATE public.policy_flags SET flag_value=TRUE WHERE flag_key='rewrite'");
      await expect(repository.readPolicyFlags()).resolves.toBeNull();
      await owner.query("UPDATE public.policy_flags SET flag_value=FALSE WHERE flag_key='rewrite'");
      await expect(repository.readPolicyFlags()).resolves.toEqual(PHASE1_POLICY_OFF);

      const expectSchemaNotReady = async () => {
        await expect(repository.readiness()).resolves.toMatchObject({
          database: 'ok',
          schema: 'not_ready',
        });
      };
      const functionDefinition = await owner.query<{ function_definition: string }>(`
        SELECT pg_catalog.pg_get_functiondef(
          'public.search_recommendable_scripts(text,text,text)'::pg_catalog.regprocedure
        ) AS function_definition
      `);
      originalSearchFunctionDefinition = functionDefinition.rows[0]?.function_definition;
      if (!originalSearchFunctionDefinition) {
        throw new Error('Expected the frozen search function definition');
      }
      const scopeFunctionDefinition = await owner.query<{ function_definition: string }>(`
        SELECT pg_catalog.pg_get_functiondef(
          'public.content_scope_matches(text[],text,text[],text,text,text)'::pg_catalog.regprocedure
        ) AS function_definition
      `);
      originalScopeFunctionDefinition = scopeFunctionDefinition.rows[0]?.function_definition;
      if (!originalScopeFunctionDefinition) {
        throw new Error('Expected the frozen scope function definition');
      }
      const questionValidationDefinition = await owner.query<{ function_definition: string }>(`
        SELECT pg_catalog.pg_get_functiondef(
          'public.content_questions_are_valid(jsonb)'::pg_catalog.regprocedure
        ) AS function_definition
      `);
      originalQuestionValidationDefinition = questionValidationDefinition.rows[0]?.function_definition;
      if (!originalQuestionValidationDefinition) {
        throw new Error('Expected the frozen question validation function definition');
      }
      const questionHashDefinition = await owner.query<{ function_definition: string }>(`
        SELECT pg_catalog.pg_get_functiondef(
          'public.content_question_hash(jsonb)'::pg_catalog.regprocedure
        ) AS function_definition
      `);
      originalQuestionHashDefinition = questionHashDefinition.rows[0]?.function_definition;
      if (!originalQuestionHashDefinition) {
        throw new Error('Expected the frozen question hash function definition');
      }
      const publicQuestionsDefinition = await owner.query<{ function_definition: string }>(`
        SELECT pg_catalog.pg_get_functiondef(
          'public.content_public_questions(jsonb)'::pg_catalog.regprocedure
        ) AS function_definition
      `);
      originalPublicQuestionsDefinition = publicQuestionsDefinition.rows[0]?.function_definition;
      if (!originalPublicQuestionsDefinition) {
        throw new Error('Expected the frozen public question projection definition');
      }

      await owner.query('GRANT SELECT ON public.content_current TO w5_runtime');
      await expectSchemaNotReady();
      await owner.query('REVOKE SELECT ON public.content_current FROM w5_runtime');
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query('GRANT app_content_admin TO w5_runtime');
      await expectSchemaNotReady();
      await owner.query('REVOKE app_content_admin FROM w5_runtime');
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query('REVOKE app_runtime FROM w5_runtime');
      await owner.query('GRANT app_runtime TO w5_runtime WITH ADMIN OPTION');
      await expectSchemaNotReady();
      await owner.query('REVOKE app_runtime FROM w5_runtime');
      await owner.query('GRANT app_runtime TO w5_runtime');
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query('ALTER ROLE w5_runtime SUPERUSER');
      await expectSchemaNotReady();
      await owner.query('ALTER ROLE w5_runtime NOSUPERUSER');
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query('ALTER ROLE app_runtime SUPERUSER');
      await expectSchemaNotReady();
      await owner.query(`
        ALTER ROLE app_runtime
        NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      `);
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query('CREATE ROLE w5_definer_attacker NOLOGIN');
      await owner.query('GRANT cs_ai_definer TO w5_definer_attacker');
      await expectSchemaNotReady();
      await owner.query('REVOKE cs_ai_definer FROM w5_definer_attacker');
      await owner.query('DROP ROLE w5_definer_attacker');
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query('CREATE ROLE w5_unlisted_login LOGIN');
      await owner.query('GRANT w5_runtime TO w5_unlisted_login');
      await expectSchemaNotReady();
      await owner.query('REVOKE w5_runtime FROM w5_unlisted_login');
      await owner.query('DROP ROLE w5_unlisted_login');
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query('GRANT SET ON PARAMETER session_replication_role TO w5_runtime');
      await owner.query("ALTER ROLE w5_runtime SET session_replication_role = 'replica'");
      await expectSchemaNotReady();
      const replicaRepository = createServiceRepository(bootstrap.runtimeDatabase);
      try {
        await expect(replicaRepository.readiness()).resolves.toMatchObject({
          database: 'ok',
          schema: 'not_ready',
        });
        await owner.query('REVOKE SET ON PARAMETER session_replication_role FROM w5_runtime');
        await expect(replicaRepository.readiness()).resolves.toMatchObject({
          database: 'ok',
          schema: 'not_ready',
        });
      } finally {
        await replicaRepository.close();
      }
      await owner.query('ALTER ROLE w5_runtime RESET session_replication_role');
      await owner.query('REVOKE SET ON PARAMETER session_replication_role FROM w5_runtime');
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query('ALTER ROLE cs_ai_definer SUPERUSER');
      await expectSchemaNotReady();
      await owner.query(`
        ALTER ROLE cs_ai_definer
        NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      `);
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query('GRANT SELECT ON public.release_items TO app_runtime');
      await expectSchemaNotReady();
      await owner.query('REVOKE SELECT ON public.release_items FROM app_runtime');
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query('REVOKE SELECT ON public.app_users FROM app_runtime');
      await expectSchemaNotReady();
      await owner.query('GRANT SELECT ON public.app_users TO app_runtime');
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query(`
        GRANT EXECUTE ON FUNCTION public.publish_content_release(TEXT,TEXT,TEXT,TEXT,TEXT)
        TO app_runtime
      `);
      await expectSchemaNotReady();
      await owner.query(`
        REVOKE EXECUTE ON FUNCTION public.publish_content_release(TEXT,TEXT,TEXT,TEXT,TEXT)
        FROM app_runtime
      `);
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query('GRANT SELECT (answer_text) ON public.release_items TO w5_runtime');
      await expectSchemaNotReady();
      await owner.query('REVOKE SELECT (answer_text) ON public.release_items FROM w5_runtime');
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query('GRANT SELECT (answer_text) ON public.release_items TO app_runtime');
      await expectSchemaNotReady();
      await owner.query('REVOKE SELECT (answer_text) ON public.release_items FROM app_runtime');
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query(`
        REVOKE SELECT (tenant_id) ON public.authoritative_source_versions
        FROM app_runtime
      `);
      await expectSchemaNotReady();
      await owner.query(`
        GRANT SELECT (tenant_id) ON public.authoritative_source_versions
        TO app_runtime
      `);
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query('CREATE TABLE public.w5_runtime_owned_probe (id INTEGER)');
      await owner.query('ALTER TABLE public.w5_runtime_owned_probe OWNER TO app_runtime');
      await expectSchemaNotReady();
      await owner.query('DROP TABLE public.w5_runtime_owned_probe');
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query(`ALTER DATABASE "${database.name}" OWNER TO app_runtime`);
      await expectSchemaNotReady();
      await owner.query(`ALTER DATABASE "${database.name}" OWNER TO "${harness.owner}"`);
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query('CREATE SCHEMA w5_extra_scope');
      await owner.query('CREATE TABLE w5_extra_scope.private_probe (value TEXT)');
      await owner.query("INSERT INTO w5_extra_scope.private_probe VALUES ('private')");
      await owner.query('GRANT USAGE ON SCHEMA w5_extra_scope TO app_runtime');
      await owner.query('GRANT SELECT ON w5_extra_scope.private_probe TO app_runtime');
      await expectSchemaNotReady();
      await owner.query('DROP SCHEMA w5_extra_scope CASCADE');
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query('GRANT CREATE ON SCHEMA public TO PUBLIC');
      await expectSchemaNotReady();
      await owner.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query('CREATE ROLE w5_public_schema_writer NOLOGIN');
      await owner.query('GRANT CREATE ON SCHEMA public TO w5_public_schema_writer');
      await expectSchemaNotReady();
      await owner.query('REVOKE CREATE ON SCHEMA public FROM w5_public_schema_writer');
      await owner.query('DROP ROLE w5_public_schema_writer');
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query(`
        GRANT EXECUTE ON FUNCTION public.search_recommendable_scripts(TEXT,TEXT,TEXT)
        TO w5_runtime
      `);
      await expectSchemaNotReady();
      await owner.query(`
        REVOKE EXECUTE ON FUNCTION public.search_recommendable_scripts(TEXT,TEXT,TEXT)
        FROM w5_runtime
      `);
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query(`
        ALTER FUNCTION public.search_recommendable_scripts(TEXT,TEXT,TEXT)
        SECURITY INVOKER
      `);
      await expectSchemaNotReady();
      await owner.query(`
        ALTER FUNCTION public.search_recommendable_scripts(TEXT,TEXT,TEXT)
        SECURITY DEFINER
      `);
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query(`
        ALTER FUNCTION public.search_recommendable_scripts(TEXT,TEXT,TEXT)
        SET search_path TO pg_catalog, public
      `);
      await expectSchemaNotReady();
      await owner.query(`
        ALTER FUNCTION public.search_recommendable_scripts(TEXT,TEXT,TEXT)
        SET search_path TO pg_catalog, public, pg_temp
      `);
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query(`
        ALTER FUNCTION public.search_recommendable_scripts(TEXT,TEXT,TEXT)
        VOLATILE
      `);
      await expectSchemaNotReady();
      await owner.query(`
        ALTER FUNCTION public.search_recommendable_scripts(TEXT,TEXT,TEXT)
        STABLE
      `);
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query(`
        CREATE OR REPLACE FUNCTION public.search_recommendable_scripts(
          p_platform TEXT,
          p_product_context_type TEXT DEFAULT NULL,
          p_product_context_ref TEXT DEFAULT NULL
        ) RETURNS TABLE(
          is_candidate BOOLEAN,
          script_id TEXT,
          script_version INTEGER,
          content_hash TEXT,
          title TEXT,
          category TEXT,
          answer_text TEXT,
          platform_scope TEXT[],
          product_scope_type TEXT,
          product_scope_refs TEXT[],
          effective_from TIMESTAMPTZ,
          effective_to TIMESTAMPTZ,
          intent_taxonomy_version TEXT,
          intent_id TEXT,
          risk_level TEXT,
          risk_categories TEXT[],
          has_conflict BOOLEAN,
          placeholder_keys TEXT[],
          questions JSONB,
          search_document TSVECTOR,
          search_fallback_text TEXT,
          release_id TEXT,
          source_binding_hash TEXT
        )
        LANGUAGE plpgsql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog, public, pg_temp
        AS $function$
        BEGIN
          RETURN;
        END;
        $function$
      `);
      await expectSchemaNotReady();
      await owner.query(originalSearchFunctionDefinition);
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query(`
        CREATE OR REPLACE FUNCTION public.content_scope_matches(
          p_platform_scope TEXT[],
          p_product_scope_type TEXT,
          p_product_scope_refs TEXT[],
          p_platform TEXT,
          p_product_context_type TEXT,
          p_product_context_ref TEXT
        ) RETURNS BOOLEAN
        LANGUAGE sql
        IMMUTABLE
        PARALLEL SAFE
        SET search_path = pg_catalog, public, pg_temp
        AS 'SELECT TRUE'
      `);
      await expectSchemaNotReady();
      await owner.query(originalScopeFunctionDefinition);
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query(`
        CREATE OR REPLACE FUNCTION public.content_questions_are_valid(
          p_questions JSONB
        ) RETURNS BOOLEAN
        LANGUAGE sql
        IMMUTABLE
        PARALLEL SAFE
        SET search_path = pg_catalog, public, pg_temp
        AS 'SELECT TRUE'
      `);
      await expectSchemaNotReady();
      await owner.query(originalQuestionValidationDefinition);
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query(`
        CREATE OR REPLACE FUNCTION public.content_question_hash(
          p_question JSONB
        ) RETURNS TEXT
        LANGUAGE sql
        IMMUTABLE
        STRICT
        PARALLEL SAFE
        SET search_path = pg_catalog, public, pg_temp
        AS 'SELECT repeat(''0'', 64)'
      `);
      await expectSchemaNotReady();
      await owner.query(originalQuestionHashDefinition);
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query(`
        CREATE OR REPLACE FUNCTION public.content_public_questions(
          p_questions JSONB
        ) RETURNS JSONB
        LANGUAGE sql
        IMMUTABLE
        STRICT
        PARALLEL SAFE
        SET search_path = pg_catalog, public, pg_temp
        AS 'SELECT ''[]''::jsonb'
      `);
      await expectSchemaNotReady();
      await owner.query(originalPublicQuestionsDefinition);
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      for (const signature of [
        'public.owner_acceptance_release_ready(text)',
        'public.owner_acceptance_active_record(text,text,text)',
        'public.owner_acceptance_sources_ready(text,jsonb)',
        'public.owner_acceptance_instant(jsonb)',
      ]) {
        const saved = await owner.query<{ definition: string }>(
          'SELECT pg_catalog.pg_get_functiondef($1::regprocedure) AS definition', [signature],
        );
        try {
          await owner.query(`ALTER FUNCTION ${signature} SET search_path = public, pg_catalog`);
          await expectSchemaNotReady();
        } finally {
          await owner.query(saved.rows[0]!.definition);
        }
        await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);
      }

      await owner.query('CREATE ROLE w5_alternate_definer NOLOGIN');
      await owner.query(`
        ALTER FUNCTION public.search_recommendable_scripts(TEXT,TEXT,TEXT)
        OWNER TO w5_alternate_definer
      `);
      await expectSchemaNotReady();
      await owner.query(`
        ALTER FUNCTION public.search_recommendable_scripts(TEXT,TEXT,TEXT)
        OWNER TO cs_ai_definer
      `);
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query('CREATE ROLE w5_digest_owner NOLOGIN');
      await owner.query('ALTER FUNCTION public.digest(BYTEA,TEXT) OWNER TO w5_digest_owner');
      await expectSchemaNotReady();
      await owner.query(`ALTER FUNCTION public.digest(BYTEA,TEXT) OWNER TO "${harness.owner}"`);
      await owner.query('DROP ROLE w5_digest_owner');
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);

      await owner.query('CREATE ROLE w5_default_function_owner NOLOGIN');
      await owner.query('GRANT CREATE ON SCHEMA public TO w5_default_function_owner');
      await owner.query('SET ROLE w5_default_function_owner');
      try {
        await owner.query(`
          CREATE FUNCTION public.w5_public_default_probe()
          RETURNS integer
          LANGUAGE sql
          AS 'SELECT 1'
        `);
      } finally {
        await owner.query('RESET ROLE');
      }
      await owner.query('REVOKE CREATE ON SCHEMA public FROM w5_default_function_owner');
      await expectSchemaNotReady();
      const outsider = await harness.connect({ ...database.config, user: 'w5_runtime' });
      try {
        await expect(outsider.query('SELECT public.w5_public_default_probe()')).resolves.toMatchObject({
          rows: [{ w5_public_default_probe: 1 }],
        });
      } finally {
        await outsider.end();
      }
      await owner.query('DROP FUNCTION public.w5_public_default_probe()');
      await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);
    } finally {
      await owner.query('RESET ROLE').catch(() => undefined);
      if (originalSearchFunctionDefinition) {
        await owner.query(originalSearchFunctionDefinition).catch(() => undefined);
      }
      if (originalScopeFunctionDefinition) {
        await owner.query(originalScopeFunctionDefinition).catch(() => undefined);
      }
      if (originalQuestionValidationDefinition) {
        await owner.query(originalQuestionValidationDefinition).catch(() => undefined);
      }
      if (originalQuestionHashDefinition) {
        await owner.query(originalQuestionHashDefinition).catch(() => undefined);
      }
      if (originalPublicQuestionsDefinition) {
        await owner.query(originalPublicQuestionsDefinition).catch(() => undefined);
      }
      await owner.query(`ALTER DATABASE "${database.name}" OWNER TO "${harness.owner}"`).catch(() => undefined);
      await owner.query('DROP SCHEMA IF EXISTS w5_extra_scope CASCADE').catch(() => undefined);
      await owner.query('DROP FUNCTION IF EXISTS public.w5_public_default_probe()').catch(() => undefined);
      await owner.query('DROP TABLE IF EXISTS public.w5_runtime_owned_probe').catch(() => undefined);
      await owner.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC').catch(() => undefined);
      await owner.query('REVOKE CREATE ON SCHEMA public FROM w5_public_schema_writer').catch(() => undefined);
      await owner.query('REVOKE CREATE ON SCHEMA public FROM w5_default_function_owner').catch(() => undefined);
      await owner.query(`ALTER FUNCTION public.digest(BYTEA,TEXT) OWNER TO "${harness.owner}"`).catch(() => undefined);
      await owner.query(`
        ALTER FUNCTION public.search_recommendable_scripts(TEXT,TEXT,TEXT)
        OWNER TO cs_ai_definer
      `).catch(() => undefined);
      await owner.query(`
        ALTER FUNCTION public.search_recommendable_scripts(TEXT,TEXT,TEXT)
        SECURITY DEFINER STABLE
        SET search_path TO pg_catalog, public, pg_temp
      `).catch(() => undefined);
      await owner.query(`
        REVOKE EXECUTE ON FUNCTION public.search_recommendable_scripts(TEXT,TEXT,TEXT)
        FROM w5_runtime
      `).catch(() => undefined);
      await owner.query(`
        REVOKE EXECUTE ON FUNCTION public.publish_content_release(TEXT,TEXT,TEXT,TEXT,TEXT)
        FROM app_runtime
      `).catch(() => undefined);
      await owner.query('REVOKE SELECT (answer_text) ON public.release_items FROM w5_runtime').catch(() => undefined);
      await owner.query('REVOKE SELECT (answer_text) ON public.release_items FROM app_runtime').catch(() => undefined);
      await owner.query('REVOKE SELECT ON public.release_items FROM app_runtime').catch(() => undefined);
      await owner.query('GRANT SELECT ON public.app_users TO app_runtime').catch(() => undefined);
      await owner.query(`
        GRANT SELECT (tenant_id) ON public.authoritative_source_versions
        TO app_runtime
      `).catch(() => undefined);
      await owner.query('ALTER ROLE w5_runtime NOSUPERUSER').catch(() => undefined);
      await owner.query('ALTER ROLE w5_runtime RESET session_replication_role').catch(() => undefined);
      await owner.query('REVOKE SET ON PARAMETER session_replication_role FROM w5_runtime').catch(() => undefined);
      await owner.query(`
        ALTER ROLE app_runtime
        NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      `).catch(() => undefined);
      await owner.query(`
        ALTER ROLE cs_ai_definer
        NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      `).catch(() => undefined);
      await owner.query('REVOKE SELECT ON public.content_current FROM w5_runtime').catch(() => undefined);
      await owner.query('REVOKE app_content_admin FROM w5_runtime').catch(() => undefined);
      await owner.query('REVOKE cs_ai_definer FROM w5_definer_attacker').catch(() => undefined);
      await owner.query('REVOKE w5_runtime FROM w5_unlisted_login').catch(() => undefined);
      await owner.query('REVOKE app_runtime FROM w5_runtime').catch(() => undefined);
      await owner.query('GRANT app_runtime TO w5_runtime').catch(() => undefined);
      await owner.query('DROP ROLE IF EXISTS w5_default_function_owner').catch(() => undefined);
      await owner.query('DROP ROLE IF EXISTS w5_alternate_definer').catch(() => undefined);
      await owner.query('DROP ROLE IF EXISTS w5_definer_attacker').catch(() => undefined);
      await owner.query('DROP ROLE IF EXISTS w5_unlisted_login').catch(() => undefined);
      await owner.query('DROP ROLE IF EXISTS w5_public_schema_writer').catch(() => undefined);
      await owner.query('DROP ROLE IF EXISTS w5_digest_owner').catch(() => undefined);
      await owner.end();
    }
  }, 120_000);
});
