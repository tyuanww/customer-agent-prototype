import { describe, expect, it } from 'vitest';
import { CONTRACT_PROVENANCE } from '@customer-agent/contracts';
import {
  ApiConfigError,
  formatApiShutdownFailure,
  formatApiStartupFailure,
  parseApiRuntimeConfig,
  parseApiPrivateBootstrapConfig,
  type ApiConfigIssue,
  type ApiRuntimeEnvironment,
} from '../src/runtime-config.js';
import { parseDatabaseConfig } from '../src/runtime-config/database.js';

const FORMAL_DEV_ENV = Object.freeze({
  CUSTOMER_AGENT_PROFILE: 'formal-dev',
  AUTH_MODE: 'mock',
});

function expectConfigIssue(
  environment: Readonly<Record<string, string | undefined>>,
  field: string,
  reason: string,
): void {
  try {
    parseApiRuntimeConfig(environment);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ApiConfigError);
    expect((error as ApiConfigError).issues).toContainEqual({ field, reason });
    return;
  }
  throw new Error('Expected API configuration to be rejected');
}

function expectPrivateConfigIssue(
  environment: ApiRuntimeEnvironment,
  field: string,
  reason: ApiConfigIssue['reason'],
): void {
  try {
    parseApiPrivateBootstrapConfig(environment);
  } catch (error: unknown) {
    if (!(error instanceof ApiConfigError)) throw error;
    expect(error.issues).toContainEqual({ field, reason });
    return;
  }
  throw new Error('Expected private API configuration to be rejected');
}

describe('API runtime configuration', () => {
  it('requires one exact named profile and explicit auth mode', () => {
    expectConfigIssue({}, 'CUSTOMER_AGENT_PROFILE', 'missing');
    expectConfigIssue({}, 'AUTH_MODE', 'missing');
    expectConfigIssue(
      { CUSTOMER_AGENT_PROFILE: 'formal-dev' },
      'AUTH_MODE',
      'missing',
    );
    expectConfigIssue(
      { CUSTOMER_AGENT_PROFILE: ' formal-dev', AUTH_MODE: 'mock' },
      'CUSTOMER_AGENT_PROFILE',
      'invalid',
    );
    expectConfigIssue(
      { CUSTOMER_AGENT_PROFILE: 'development', AUTH_MODE: 'mock' },
      'CUSTOMER_AGENT_PROFILE',
      'invalid',
    );
  });

  it('keeps the desktop demo and deployable profiles outside the W3 host', () => {
    expectConfigIssue(
      { CUSTOMER_AGENT_PROFILE: 'demo', AUTH_MODE: 'mock' },
      'CUSTOMER_AGENT_PROFILE',
      'profile_not_service',
    );
    for (const profile of ['single-host', 'multi-instance']) {
      expectConfigIssue(
        { CUSTOMER_AGENT_PROFILE: profile, AUTH_MODE: 'feishu' },
        'CUSTOMER_AGENT_PROFILE',
        'profile_not_available',
      );
    }
  });

  it('does not allow feishu to look configured without provider credentials', () => {
    expectConfigIssue(
      { CUSTOMER_AGENT_PROFILE: 'formal-dev', AUTH_MODE: 'feishu' },
      'AUTH_MODE',
      'auth_mode_not_available',
    );
    expectConfigIssue(
      { CUSTOMER_AGENT_PROFILE: 'production', AUTH_MODE: 'feishu' },
      'AUTH_MODE',
      'auth_mode_not_available',
    );
  });

  it('accepts production on loopback with mock auth', () => {
    expect(parseApiRuntimeConfig({
      CUSTOMER_AGENT_PROFILE: 'production',
      AUTH_MODE: 'mock',
      CUSTOMER_AGENT_BUILD_VERSION: '0.3.18',
    })).toMatchObject({
      profile: 'production',
      authMode: 'mock',
      host: '127.0.0.1',
      runtimeActivated: false,
    });
  });

  it('returns a frozen, non-secret formal-dev configuration', () => {
    const config = parseApiRuntimeConfig({
      ...FORMAL_DEV_ENV,
      CUSTOMER_AGENT_BUILD_VERSION: '0.2.0-w3',
    });

    expect(config).toEqual({
      profile: 'formal-dev',
      authMode: 'mock',
      host: '127.0.0.1',
      port: 3100,
      buildVersion: '0.2.0-w3',
      contractSetId: CONTRACT_PROVENANCE.contract_set_id,
      runtimeActivated: false,
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(config).not.toHaveProperty('FEISHU_APP_SECRET');
    expect(config).not.toHaveProperty('DATABASE_URL');
  });

  it('accepts feishu when provider credentials are complete and keeps secrets out of public config', () => {
    const config = parseApiRuntimeConfig({
      CUSTOMER_AGENT_PROFILE: 'formal-dev',
      AUTH_MODE: 'feishu',
      FEISHU_APP_ID: 'cli_aaaaaaaaaaaaaaaa',
      FEISHU_APP_SECRET: 'test-feishu-secret-material-0001',
      FEISHU_REDIRECT_URI: 'https://oauth.test.invalid/v1/auth/callback',
    });
    expect(config.authMode).toBe('feishu');
    expect(config).not.toHaveProperty('FEISHU_APP_SECRET');
    expect(JSON.stringify(config)).not.toContain('test-feishu-secret-material-0001');
    expectConfigIssue(
      {
        CUSTOMER_AGENT_PROFILE: 'formal-dev',
        AUTH_MODE: 'feishu',
        FEISHU_APP_ID: 'cli_aaaaaaaaaaaaaaaa',
        FEISHU_APP_SECRET: 'test-feishu-secret-material-0001',
        FEISHU_REDIRECT_URI: 'http://127.0.0.1:3100/v1/auth/callback',
      },
      'FEISHU_REDIRECT_URI',
      'invalid',
    );
  });

  it('allows an ephemeral loopback port only for tests', () => {
    expect(parseApiRuntimeConfig({
      CUSTOMER_AGENT_PROFILE: 'test',
      AUTH_MODE: 'mock',
      CUSTOMER_AGENT_API_PORT: '0',
    }).port).toBe(0);
    expectConfigIssue(
      { ...FORMAL_DEV_ENV, CUSTOMER_AGENT_API_PORT: '0' },
      'CUSTOMER_AGENT_API_PORT',
      'invalid',
    );
    expectConfigIssue(
      {
        CUSTOMER_AGENT_PROFILE: 'test',
        AUTH_MODE: 'mock',
        CUSTOMER_AGENT_API_PORT: '80',
      },
      'CUSTOMER_AGENT_API_PORT',
      'invalid',
    );
    expectConfigIssue(
      { ...FORMAL_DEV_ENV, CUSTOMER_AGENT_API_PORT: '3100x' },
      'CUSTOMER_AGENT_API_PORT',
      'invalid',
    );
  });

  it('refuses external binding and unsafe health versions', () => {
    expectConfigIssue(
      { ...FORMAL_DEV_ENV, CUSTOMER_AGENT_API_HOST: '0.0.0.0' },
      'CUSTOMER_AGENT_API_HOST',
      'external_bind_not_allowed',
    );
    expectConfigIssue(
      { ...FORMAL_DEV_ENV, CUSTOMER_AGENT_BUILD_VERSION: 'bad version' },
      'CUSTOMER_AGENT_BUILD_VERSION',
      'invalid',
    );
  });

  it('formats startup failures without reflecting values or unexpected errors', () => {
    const secret = 'secret-value-that-must-not-appear';
    let failure: unknown;
    try {
      parseApiRuntimeConfig({ FEISHU_APP_SECRET: secret });
    } catch (error: unknown) {
      failure = error;
    }

    const expected = formatApiStartupFailure(failure, 'diag_00000000000000000000000000000000');
    const unexpected = formatApiStartupFailure(
      new Error(secret),
      'diag_11111111111111111111111111111111',
    );
    expect(expected).toContain('[CONFIG_INVALID]');
    expect(expected).toContain('CUSTOMER_AGENT_PROFILE:missing');
    expect(expected).toContain('Docs: docs/reference-api-runtime-config.md');
    expect(expected).not.toContain(secret);
    expect(unexpected).toContain('[STARTUP_FAILED]');
    expect(unexpected).not.toContain('[CONFIG_INVALID]');
    expect(unexpected).toContain('unclassified_startup_failure');
    expect(unexpected).not.toContain(secret);

    const addressInUse = Object.assign(new Error(secret), { code: 'EADDRINUSE' });
    const classified = formatApiStartupFailure(
      addressInUse,
      'diag_22222222222222222222222222222222',
    );
    expect(classified).toContain('Cause: listen_address_in_use');
    expect(classified).not.toContain(secret);

    const unsafeDiagnostic = formatApiStartupFailure(failure, secret);
    expect(unsafeDiagnostic).toMatch(/Diagnostic: diag_[0-9a-f]{32}$/);
    expect(unsafeDiagnostic).not.toContain(secret);
  });

  it('reports shutdown failure with a stable, scrubbed diagnostic', () => {
    const output = formatApiShutdownFailure(
      'SIGTERM',
      'diag_33333333333333333333333333333333',
    );
    expect(output).toContain('[SHUTDOWN_FAILED]');
    expect(output).toContain('Cause: close_failed_after_SIGTERM');
    expect(output).toContain('Diagnostic: diag_33333333333333333333333333333333');

    const secret = 'shutdown-secret-that-must-not-appear';
    const scrubbed = formatApiShutdownFailure('SIGINT', secret);
    expect(scrubbed).toMatch(/Diagnostic: diag_[0-9a-f]{32}$/);
    expect(scrubbed).not.toContain(secret);
  });
});


describe('synthetic product identity bootstrap', () => {
  const environment = {
    ...FORMAL_DEV_ENV, AUTH_SESSION_MODE: 'product',
    DATABASE_URL: 'postgresql://synthetic_runtime@127.0.0.1:44001/synthetic',
    CONTENT_ADMIN_DATABASE_URL: 'postgresql://synthetic_admin@127.0.0.1:44001/synthetic',
    AUTH_DATABASE_URL: 'postgresql://synthetic_auth@127.0.0.1:44001/synthetic',
    SYNTHETIC_IDENTITY_PROVIDER_ORIGIN: 'http://127.0.0.1:44002',
    IDEMPOTENCY_HMAC_KEYS: JSON.stringify({ 'hmac-idempotency-v1': 'synthetic-idempotency-material-0001' }),
    IDEMPOTENCY_HMAC_CURRENT_VERSION: 'hmac-idempotency-v1',
    LOG_HASH_KEY: 'synthetic-log-hash-material-00000001', LOG_HASH_KEY_VERSION: 'hmac-log-v1',
  };
  it('requires explicit session mode and reserves a separate bounded capability pool', () => {
    expect(parseApiRuntimeConfig(environment).sessionMode).toBe('product');
    const config = parseApiPrivateBootstrapConfig(environment);
    expect(config.runtimeDatabase.poolMax + config.policyAdminDatabase.poolMax + config.productIdentity!.database.poolMax).toBe(20);
    for (const patch of [
      { AUTH_DATABASE_URL: undefined }, { AUTH_DATABASE_URL: environment.DATABASE_URL },
      { AUTH_DATABASE_URL: 'postgresql://synthetic_auth@127.0.0.1:44001/other' },
      { SYNTHETIC_IDENTITY_PROVIDER_ORIGIN: 'https://example.com' },
      { SYNTHETIC_IDENTITY_PROVIDER_ORIGIN: undefined }, { AUTH_DB_POOL_MAX: '3' },
    ]) expect(() => parseApiPrivateBootstrapConfig({ ...environment, ...patch })).toThrow(ApiConfigError);
    expect(() => parseApiRuntimeConfig({ ...environment, AUTH_SESSION_MODE: undefined })).toThrow(ApiConfigError);
    expect(() => parseApiRuntimeConfig({ ...environment, AUTH_SESSION_MODE: 'typo' })).toThrow(ApiConfigError);
    expect(() => parseApiRuntimeConfig({ ...environment, AUTH_MODE: 'feishu' })).toThrow(ApiConfigError);
  });

  it('bootstraps a feishu product identity without a synthetic provider origin', () => {
    const config = parseApiPrivateBootstrapConfig({
      ...environment,
      AUTH_MODE: 'feishu',
      FEISHU_APP_ID: 'cli_aaaaaaaaaaaaaaaa',
      FEISHU_APP_SECRET: 'test-feishu-secret-material-0001',
      FEISHU_REDIRECT_URI: 'https://oauth.test.invalid/v1/auth/callback',
    });
    expect(config.productIdentity).toMatchObject({
      kind: 'feishu',
      feishu: { clientId: 'cli_aaaaaaaaaaaaaaaa', redirectUri: 'https://oauth.test.invalid/v1/auth/callback' },
    });
    expect(parseApiRuntimeConfig({
      CUSTOMER_AGENT_PROFILE: 'formal-dev', AUTH_MODE: 'feishu', AUTH_SESSION_MODE: 'product',
      FEISHU_APP_ID: 'cli_aaaaaaaaaaaaaaaa',
      FEISHU_APP_SECRET: 'test-feishu-secret-material-0001',
      FEISHU_REDIRECT_URI: 'https://oauth.test.invalid/v1/auth/callback',
    }).authMode).toBe('feishu');
  });

  it('keeps the loopback password identity beside Feishu', () => {
    const config = parseApiPrivateBootstrapConfig({
      ...environment,
      AUTH_MODE: 'feishu',
      FEISHU_APP_ID: 'cli_aaaaaaaaaaaaaaaa',
      FEISHU_APP_SECRET: 'test-feishu-secret-material-0001',
      FEISHU_REDIRECT_URI: 'https://oauth.test.invalid/v1/auth/callback',
    });
    expect(config.productIdentity).toMatchObject({
      kind: 'feishu',
      providerOrigin: 'http://127.0.0.1:44002',
      feishu: { clientId: 'cli_aaaaaaaaaaaaaaaa' },
    });
  });

  it('shrinks the runtime pool when a review capability is configured and keeps worker login distinct', () => {
    const withReview = parseApiPrivateBootstrapConfig({
      ...environment,
      CONTENT_REVIEW_DATABASE_URL: 'postgresql://synthetic_review@127.0.0.1:44001/synthetic',
      CONTENT_WORKER_DATABASE_URL: 'postgresql://synthetic_worker@127.0.0.1:44001/synthetic',
    });
    expect(withReview.runtimeDatabase.poolMax).toBe(12);
    expect(withReview.contentReview?.database.poolMax).toBe(2);
    expect(
      withReview.runtimeDatabase.poolMax
      + withReview.policyAdminDatabase.poolMax
      + withReview.productIdentity!.database.poolMax
      + (withReview.contentReview?.database.poolMax ?? 0),
    ).toBe(18);
    expect(() => parseApiPrivateBootstrapConfig({
      ...environment,
      CONTENT_REVIEW_DATABASE_URL: environment.DATABASE_URL,
    })).toThrow(ApiConfigError);
    expect(() => parseApiPrivateBootstrapConfig({
      ...environment,
      AUTH_SESSION_MODE: 'mock',
      CONTENT_REVIEW_DATABASE_URL: 'postgresql://synthetic_review@127.0.0.1:44001/synthetic',
    })).toThrow(ApiConfigError);
  });

  it('accepts an absolute object store directory and rejects a relative path', () => {
    const config = parseApiPrivateBootstrapConfig({
      ...environment,
      CONTENT_OBJECT_STORE_DIR: '/tmp/customer-agent-objects',
    });
    expect(config.objectStoreDir).toBe('/tmp/customer-agent-objects');
    expect(() => parseApiPrivateBootstrapConfig({
      ...environment,
      CONTENT_OBJECT_STORE_DIR: 'relative-objects',
    })).toThrow(ApiConfigError);
  });

  describe('intake query bootstrap', () => {
    const intakeConnections = {
      INTAKE_BUSINESS_DATABASE_URL: 'postgresql://synthetic_intake_business@127.0.0.1:44001/synthetic',
      INTAKE_USAGE_DATABASE_URL: 'postgresql://synthetic_intake_usage@127.0.0.1:44001/synthetic',
      INTAKE_WORKER_DATABASE_URL: 'postgresql://synthetic_intake_worker@127.0.0.1:44001/synthetic',
    };
    const intakeEnvironment = {
      ...environment,
      CONTENT_REVIEW_DATABASE_URL: 'postgresql://synthetic_review@127.0.0.1:44001/synthetic',
      CONTENT_WORKER_DATABASE_URL: 'postgresql://synthetic_worker@127.0.0.1:44001/synthetic',
      CONTENT_OBJECT_STORE_DIR: '/tmp/customer-agent-intake-objects',
      ...intakeConnections,
    };

    it.each([undefined, 'unified'])('defaults to unified without intake for mode %s', (mode) => {
      const config = parseApiPrivateBootstrapConfig({
        ...environment, CUSTOMER_AGENT_QUERY_MODE: mode,
      });
      expect(config.query).toEqual({ mode: 'unified' });
      expect(Object.isFrozen(config.query)).toBe(true);
      expect(parseApiPrivateBootstrapConfig({
        ...environment,
        AUTH_SESSION_MODE: undefined,
        AUTH_DATABASE_URL: undefined,
        SYNTHETIC_IDENTITY_PROVIDER_ORIGIN: undefined,
        CUSTOMER_AGENT_QUERY_MODE: mode,
      }).query).toEqual({ mode: 'unified' });
    });

    it.each([undefined, 'unified', 'intake-compat'])('parses the complete intake group for mode %s', (mode) => {
      const config = parseApiPrivateBootstrapConfig({
        ...intakeEnvironment, CUSTOMER_AGENT_QUERY_MODE: mode,
      });
      expect(config.query).toEqual({
        mode: mode ?? 'unified',
        intake: {
          business: {
            connectionString: intakeConnections.INTAKE_BUSINESS_DATABASE_URL,
            poolMax: 2, connectionTimeoutMs: 2_000, readinessTimeoutMs: 2_000,
          },
          usage: {
            connectionString: intakeConnections.INTAKE_USAGE_DATABASE_URL,
            poolMax: 2, connectionTimeoutMs: 2_000, readinessTimeoutMs: 2_000,
          },
          worker: {
            connectionString: intakeConnections.INTAKE_WORKER_DATABASE_URL,
            poolMax: 2, connectionTimeoutMs: 2_000, readinessTimeoutMs: 2_000,
          },
        },
      });
      expect(Object.isFrozen(config)).toBe(true);
      expect(Object.isFrozen(config.query)).toBe(true);
      expect(Object.isFrozen(config.query.intake)).toBe(true);
      for (const pool of Object.values(config.query.intake ?? {})) {
        expect(Object.isFrozen(pool)).toBe(true);
      }
    });

    it('keeps intake pools fixed and consumes the existing timeout settings', () => {
      const config = parseApiPrivateBootstrapConfig({
        ...intakeEnvironment,
        DB_POOL_MAX: '10',
        DB_CONNECTION_TIMEOUT_MS: '1750',
        DB_READINESS_TIMEOUT_MS: '850',
      });
      expect(config.runtimeDatabase.poolMax).toBe(10);
      for (const pool of Object.values(config.query.intake ?? {})) {
        expect(pool).toMatchObject({ poolMax: 2, connectionTimeoutMs: 1_750, readinessTimeoutMs: 850 });
      }
    });

    it('preserves existing pool budgets when intake adds three separate pools', () => {
      const config = parseApiPrivateBootstrapConfig(intakeEnvironment);
      expect(config.runtimeDatabase.poolMax).toBe(12);
      const pools = [
        config.runtimeDatabase, config.policyAdminDatabase, config.productIdentity?.database,
        config.contentReview?.database, config.contentWorker?.database,
        ...Object.values(config.query.intake ?? {}),
      ];
      expect(pools.reduce((sum, pool) => sum + (pool?.poolMax ?? 0), 0)).toBe(26);
    });

    it('uses the default pool maximum only when no pool field is specified', () => {
      const issues: ApiConfigIssue[] = [];
      const databaseEnvironment = { DATABASE_URL: environment.DATABASE_URL, DB_POOL_MAX: '7' };
      expect(parseDatabaseConfig(databaseEnvironment, {
        connectionString: 'DATABASE_URL', defaultPoolMax: 2,
      }, issues)?.poolMax).toBe(2);
      expect(parseDatabaseConfig(databaseEnvironment, {
        connectionString: 'DATABASE_URL', poolMax: 'DB_POOL_MAX', defaultPoolMax: 2,
      }, issues)?.poolMax).toBe(7);
      expect(issues).toEqual([]);
    });

    it.each(['', ' ', '\t', ' unified', 'unified ', 'intake-compat\n', 'compat', 'UNIFIED'])('rejects query mode %j', (mode) => {
      expectPrivateConfigIssue({
        ...intakeEnvironment, CUSTOMER_AGENT_QUERY_MODE: mode,
      }, 'CUSTOMER_AGENT_QUERY_MODE', 'invalid');
    });

    it.each(Object.keys(intakeConnections))('requires the missing intake field %s', (field) => {
      for (const mode of [undefined, 'unified', 'intake-compat']) {
        expectPrivateConfigIssue({
          ...intakeEnvironment, [field]: undefined, CUSTOMER_AGENT_QUERY_MODE: mode,
        }, field, 'missing');
      }
    });

    it.each(Object.entries(intakeConnections))('requires the complete group when only %s appears', (field, value) => {
      for (const missingField of Object.keys(intakeConnections).filter(other => other !== field)) {
        expectPrivateConfigIssue({
          ...environment,
          CONTENT_OBJECT_STORE_DIR: intakeEnvironment.CONTENT_OBJECT_STORE_DIR,
          [field]: value,
        }, missingField, 'missing');
      }
    });

    it('requires all three pools for intake compatibility mode', () => {
      for (const field of Object.keys(intakeConnections)) {
        expectPrivateConfigIssue({
          ...environment,
          CONTENT_OBJECT_STORE_DIR: intakeEnvironment.CONTENT_OBJECT_STORE_DIR,
          CUSTOMER_AGENT_QUERY_MODE: 'intake-compat',
        }, field, 'missing');
      }
    });

    it.each([undefined, '', 'mock', 'typo', ' product'])('rejects intake without product sessions for mode %j', (sessionMode) => {
      for (const queryMode of ['unified', 'intake-compat']) {
        expectPrivateConfigIssue({
          ...intakeEnvironment,
          AUTH_SESSION_MODE: sessionMode,
          CUSTOMER_AGENT_QUERY_MODE: queryMode,
        }, 'AUTH_SESSION_MODE', 'invalid');
      }
    });

    it.each([
      { value: undefined, reason: 'missing' },
      { value: '', reason: 'invalid' },
      { value: ' ', reason: 'invalid' },
      { value: 'relative-objects', reason: 'invalid' },
      { value: '/tmp/intake\0objects', reason: 'invalid' },
    ] satisfies { value: string | undefined; reason: ApiConfigIssue['reason'] }[])('requires an absolute object store for $value', ({ value, reason }) => {
      expectPrivateConfigIssue({
        ...intakeEnvironment, CONTENT_OBJECT_STORE_DIR: value,
      }, 'CONTENT_OBJECT_STORE_DIR', reason);
    });

    it.each(Object.keys(intakeConnections))('applies existing DSN validation to %s', (field) => {
      for (const value of [
        '', ' ',
        ' postgresql://synthetic_intake@127.0.0.1:44001/synthetic',
        'postgresql://synthetic_intake@127.0.0.1:44001/synthetic ',
        'https://synthetic_intake@127.0.0.1:44001/synthetic',
        'postgresql://synthetic_intake@127.0.0.1:44001/',
        'postgresql://127.0.0.1:44001/synthetic',
        'postgresql://%ZZ@127.0.0.1:44001/synthetic',
        'postgresql://synthetic_intake@db.example.invalid:44001/synthetic',
        'postgresql://synthetic_intake@127.0.0.1:44001/synthetic#fragment',
        'postgresql://synthetic_intake@127.0.0.1:44001/synthetic?application_name=unsafe',
        'postgresql://synthetic_intake@127.0.0.1:44001/synthetic?host=%2Ftmp%00',
        'postgresql://synthetic_intake@127.0.0.1:44001/synthetic?host=%2Ftmp&port=65536',
      ]) {
        expectPrivateConfigIssue({ ...intakeEnvironment, [field]: value }, field, 'invalid');
      }
    });

    it.each(Object.keys(intakeConnections))('rejects a different database target for %s', (field) => {
      for (const value of [
        'postgresql://synthetic_other_intake@127.0.0.1:44001/other',
        'postgresql://synthetic_other_intake@127.0.0.1:44002/synthetic',
        'postgresql://synthetic_other_intake@localhost:44001/synthetic',
        'postgresql://synthetic_other_intake@127.0.0.1:44001/synthetic?host=%2Ftmp%2Fother-socket',
      ]) {
        expectPrivateConfigIssue({ ...intakeEnvironment, [field]: value }, field, 'invalid');
      }
    });

    const allConnections = Object.entries({
      DATABASE_URL: intakeEnvironment.DATABASE_URL,
      CONTENT_ADMIN_DATABASE_URL: intakeEnvironment.CONTENT_ADMIN_DATABASE_URL,
      AUTH_DATABASE_URL: intakeEnvironment.AUTH_DATABASE_URL,
      CONTENT_REVIEW_DATABASE_URL: intakeEnvironment.CONTENT_REVIEW_DATABASE_URL,
      CONTENT_WORKER_DATABASE_URL: intakeEnvironment.CONTENT_WORKER_DATABASE_URL,
      ...intakeConnections,
    });
    const reusedLogins = allConnections.flatMap(([originalField, value], index) =>
      allConnections.slice(index + 1).map(([field]) => ({ originalField, field, value })));

    it.each(reusedLogins)('rejects a login reused from $originalField by $field', ({ field, value }) => {
      const reused = new URL(value);
      reused.password = 'synthetic-different-password';
      expectPrivateConfigIssue({ ...intakeEnvironment, [field]: reused.toString() }, field, 'invalid');
    });

    it('compares decoded login names across purposes', () => {
      expectPrivateConfigIssue({
        ...intakeEnvironment,
        INTAKE_USAGE_DATABASE_URL: 'postgresql://%73ynthetic_intake_business@127.0.0.1:44001/synthetic',
      }, 'INTAKE_USAGE_DATABASE_URL', 'invalid');
    });

    it('accepts one shared Unix socket target with independent purpose logins', () => {
      const socketConnections = Object.fromEntries(allConnections.map(([field, value]) => {
        const connection = new URL(value);
        connection.searchParams.set('host', '/tmp/customer-agent-synthetic-pg');
        connection.searchParams.set('port', '44003');
        return [field, connection.toString()];
      }));
      const config = parseApiPrivateBootstrapConfig({ ...intakeEnvironment, ...socketConnections });
      expect(config.query.intake?.business.connectionString).toContain('host=%2Ftmp%2Fcustomer-agent-synthetic-pg');
      expect(config.query.intake?.worker.connectionString).toContain('port=44003');
    });

    it('keeps query configuration and private intake targets out of public config', () => {
      const config = parseApiRuntimeConfig({
        ...intakeEnvironment, CUSTOMER_AGENT_QUERY_MODE: 'intake-compat',
      });
      expect(config).toEqual({
        profile: 'formal-dev', authMode: 'mock', sessionMode: 'product',
        host: '127.0.0.1', port: 3100, buildVersion: 'dev-m0',
        contractSetId: CONTRACT_PROVENANCE.contract_set_id, runtimeActivated: false,
      });
    });

    it('scrubs intake secrets from formatted startup errors', () => {
      const connectionString = 'postgresql://synthetic_intake:synthetic-private-password@db.example.invalid/synthetic';
      let failure: unknown;
      try {
        parseApiPrivateBootstrapConfig({
          ...intakeEnvironment, INTAKE_BUSINESS_DATABASE_URL: connectionString,
        });
      } catch (error: unknown) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(ApiConfigError);
      const formatted = formatApiStartupFailure(failure);
      expect(formatted).toContain('INTAKE_BUSINESS_DATABASE_URL:invalid');
      expect(formatted).not.toContain(connectionString);
      expect(formatted).not.toContain('synthetic-private-password');
    });
  });
});
