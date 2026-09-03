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
  parseApiRuntimeConfig,
} from '../src/runtime-config.js';
import {
  createRuntimePoolVerify,
  createServiceRepository,
  createServiceRepositoryForPool,
  runtimeConnectionExceededDeadline,
  type ServiceReadinessChecks,
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
  close: ReturnType<typeof vi.fn<ServiceRepository['close']>>;
}> {
  return {
    readiness: vi.fn<ServiceRepository['readiness']>().mockResolvedValue(checks),
    close: vi.fn<ServiceRepository['close']>().mockResolvedValue(undefined),
  };
}

function databaseEnvironment(overrides: Record<string, string> = {}) {
  return {
    CUSTOMER_AGENT_PROFILE: 'test',
    AUTH_MODE: 'mock',
    CUSTOMER_AGENT_API_PORT: '0',
    DATABASE_URL: 'postgresql://w5_runtime:PASSWORD@127.0.0.1:1/w5_test',
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

    for (const dependency of Object.keys(ALL_READY) as (keyof ServiceReadinessChecks)[]) {
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

    repository.readiness.mockRejectedValueOnce(new Error('private DSN and SQL'));
    const failed = await app.inject({ method: 'GET', url: '/ready' });
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({
      status: 'not_ready',
      checks: {
        database: 'not_ready',
        schema: 'not_ready',
        auth: 'not_ready',
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

  it('keeps the exact method and W5 route surface', async () => {
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
      poolMax: 20,
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
      schema_comment: 'CS-AI-C11 schema.v1.12; synthetic unit fixture',
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
    } finally {
      await owner.end();
    }
  }, 120_000);

  afterAll(() => harness.stop(), 60_000);

  it('proves real pool/schema readiness without bypassing runtime ACL or later gates', async () => {
    const host = String(database.config.host);
    const port = String(database.config.port);
    const connectionString = `postgresql://w5_runtime@localhost/${database.name}?${new URLSearchParams({ host, port })}`;
    const databaseBootstrapConfig = parseApiDatabaseBootstrapConfig({
      DATABASE_URL: connectionString,
      DB_POOL_MAX: '2',
      DB_CONNECTION_TIMEOUT_MS: '2000',
      DB_READINESS_TIMEOUT_MS: '2000',
    });
    const repository = createServiceRepository(databaseBootstrapConfig);
    const app = createApiApp(testConfig(), repository);
    openApps.push(app);

    await expect(repository.readiness()).resolves.toEqual(W5_NOT_READY);
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready', checks: W5_NOT_READY });

    const runtimeClient = await harness.connect({ ...database.config, user: 'w5_runtime' });
    try {
      await expect(runtimeClient.query('SELECT * FROM public.content_current')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await runtimeClient.end();
    }

    const owner = await harness.connect(database.config);
    let originalSearchFunctionDefinition: string | undefined;
    let originalScopeFunctionDefinition: string | undefined;
    let originalQuestionValidationDefinition: string | undefined;
    let originalQuestionHashDefinition: string | undefined;
    try {
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
      const replicaRepository = createServiceRepository(databaseBootstrapConfig);
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
