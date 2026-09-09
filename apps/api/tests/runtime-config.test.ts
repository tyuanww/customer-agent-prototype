import { describe, expect, it } from 'vitest';
import {
  ApiConfigError,
  formatApiShutdownFailure,
  formatApiStartupFailure,
  parseApiRuntimeConfig,
} from '../src/runtime-config.js';

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
    for (const profile of ['single-host', 'multi-instance', 'production']) {
      expectConfigIssue(
        { CUSTOMER_AGENT_PROFILE: profile, AUTH_MODE: 'feishu' },
        'CUSTOMER_AGENT_PROFILE',
        'profile_not_available',
      );
    }
  });

  it('does not allow an unimplemented auth provider to look configured', () => {
    expectConfigIssue(
      { CUSTOMER_AGENT_PROFILE: 'formal-dev', AUTH_MODE: 'feishu' },
      'AUTH_MODE',
      'auth_mode_not_available',
    );
    expectConfigIssue(
      { CUSTOMER_AGENT_PROFILE: 'production', AUTH_MODE: 'mock' },
      'CUSTOMER_AGENT_PROFILE',
      'profile_not_available',
    );
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
      contractSetId: 'cs-ai-c11-openapi-1.13.0-schema-1.16-6f7d18e59f2e',
      runtimeActivated: false,
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(config).not.toHaveProperty('FEISHU_APP_SECRET');
    expect(config).not.toHaveProperty('DATABASE_URL');
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
