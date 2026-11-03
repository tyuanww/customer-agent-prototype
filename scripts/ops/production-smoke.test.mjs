import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectObservation,
  parseOptions,
  validateObservation,
} from './production-smoke.mjs';

const API_ORIGIN = 'https://api.example.test';
const IDENTITY_ORIGIN = 'https://identity.example.test';

function observation(overrides = {}) {
  return {
    apiHealth: {
      status: 200,
      json: { status: 'ok', service: 'cs-ai-api', version: '0.3.41' },
    },
    apiReady: {
      status: 200,
      json: {
        status: 'ready',
        checks: {
          database: 'ok',
          schema: 'ok',
          auth: 'ok',
          storage: 'ok',
          content: 'ok',
        },
      },
    },
    identityHealth: {
      status: 200,
      json: { ok: true, kind: 'password' },
    },
    unauthSources: { status: 401, json: undefined },
    unauthUsage: { status: 401, json: undefined },
    ...overrides,
  };
}

test('accepts the production health, readiness, identity, and unauthenticated boundaries', () => {
  const report = validateObservation(observation(), '0.3.41');
  assert.equal(report.ok, true);
  assert.equal(report.version, '0.3.41');
  assert.ok(Object.values(report.checks).every(Boolean));
});

test('fails when the deployed version differs from the expected version', () => {
  const report = validateObservation(observation(), '0.3.42');
  assert.equal(report.ok, false);
  assert.equal(report.checks.apiVersionMatches, false);
});

test('fails when readiness omits a dependency or reports a degraded check', () => {
  const missing = observation();
  missing.apiReady.json.checks.storage = undefined;
  const degraded = observation();
  degraded.apiReady.json.checks.database = 'failed';
  assert.equal(validateObservation(missing).checks.apiReady, false);
  assert.equal(validateObservation(degraded).checks.apiReady, false);
});

test('fails when the identity service or unauthenticated boundary is wrong', () => {
  assert.equal(validateObservation(observation({
    identityHealth: { status: 503, json: { ok: false, kind: 'password' } },
  })).checks.identityHealth, false);
  assert.equal(validateObservation(observation({
    unauthSources: { status: 200, json: { items: [] } },
  })).checks.intakeRequiresAuthentication, false);
  assert.equal(validateObservation(observation({
    unauthUsage: { status: 200, json: { items: [] } },
  })).checks.usageRequiresAuthentication, false);
});

test('collects all public probes without credentials or mutation requests', async () => {
  const requests = [];
  const result = await collectObservation(
    { apiOrigin: API_ORIGIN, identityOrigin: IDENTITY_ORIGIN },
    async (url) => {
      requests.push(url.href);
      const path = url.pathname;
      if (path === '/health' && url.origin === API_ORIGIN) return observation().apiHealth;
      if (path === '/ready') return observation().apiReady;
      if (path === '/health' && url.origin === IDENTITY_ORIGIN) {
        return observation().identityHealth;
      }
      return { status: 401, json: undefined };
    },
  );
  assert.deepEqual(requests.sort(), [
    `${API_ORIGIN}/health`,
    `${API_ORIGIN}/ready`,
    `${API_ORIGIN}/v1/events/usage`,
    `${API_ORIGIN}/v1/intake/sources`,
    `${IDENTITY_ORIGIN}/health`,
  ].sort());
  assert.equal(validateObservation(result).ok, true);
});

test('parses only distinct public HTTPS origins and semantic versions', () => {
  assert.equal(parseOptions([]).apiOrigin, 'https://agent-auth.jianghua.site');
  assert.equal(parseOptions([
    '--api-origin', API_ORIGIN,
    '--identity-origin', IDENTITY_ORIGIN,
    '--expected-version', '0.3.41',
  ]).ok, true);
  assert.equal(parseOptions(['--api-origin', 'http://api.example.test']).ok, false);
  assert.equal(parseOptions([
    '--api-origin', API_ORIGIN,
    '--identity-origin', API_ORIGIN,
  ]).ok, false);
  assert.equal(parseOptions(['--expected-version', 'latest']).ok, false);
  assert.equal(parseOptions(['--', '--help']).help, true);
});
