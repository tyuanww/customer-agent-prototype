import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  collectObservation,
  parseOptions,
  probeFailure,
  validateObservation,
} from './production-smoke.mjs';

const API_ORIGIN = 'https://api.example.test';
const IDENTITY_ORIGIN = 'https://identity.example.test';
const SMOKE_SCRIPT = fileURLToPath(new URL('./production-smoke.mjs', import.meta.url));

function observation(overrides = {}) {
  return {
    apiHealth: {
      status: 200,
      json: { status: 'ok', service: 'cs-ai-api', version: '0.3.42' },
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
  const report = validateObservation(observation(), '0.3.42');
  assert.equal(report.ok, true);
  assert.equal(report.version, '0.3.42');
  assert.ok(Object.values(report.checks).every(Boolean));
});

test('fails when the deployed version differs from the expected version', () => {
  const report = validateObservation(observation(), '0.3.43');
  assert.equal(report.ok, false);
  assert.equal(report.checks.apiVersionMatches, false);
});

test('the CLI reports health before deployment and rejects an unmet release target', async t => {
  const bin = mkdtempSync(path.join(tmpdir(), 'production-smoke-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const probes = observation();
  const responses = [
    [`${API_ORIGIN}/health`, probes.apiHealth],
    [`${API_ORIGIN}/ready`, probes.apiReady],
    [`${IDENTITY_ORIGIN}/health`, probes.identityHealth],
    [`${API_ORIGIN}/v1/intake/sources`, probes.unauthSources],
    [`${API_ORIGIN}/v1/events/usage`, probes.unauthUsage],
  ];
  writeFileSync(path.join(bin, 'curl'), [
    '#!/bin/sh',
    'for url do :; done',
    'case "$url" in',
    ...responses.map(([url, probe]) => `'${url}') printf '%s\\n%s' '${JSON.stringify(probe.json) ?? ''}' '${probe.status}' ;;`),
    '*) exit 2 ;;',
    'esac',
  ].join('\n'), { mode: 0o700 });
  const run = (...args) => promisify(execFile)(process.execPath, [
    SMOKE_SCRIPT, '--api-origin', API_ORIGIN, '--identity-origin', IDENTITY_ORIGIN, ...args,
  ], { encoding: 'utf8', env: { PATH: bin } });

  const health = JSON.parse((await run()).stdout);
  assert.equal(health.ok, true);
  assert.equal(health.version, '0.3.42');
  assert.equal(health.expectedVersion, null);
  assert.equal(Object.hasOwn(health.checks, 'apiVersionMatches'), false);

  await assert.rejects(run('--expected-version', '0.3.43'), error => {
    assert.equal(error.code, 1);
    const release = JSON.parse(error.stdout);
    assert.equal(release.expectedVersion, '0.3.43');
    assert.equal(release.version, '0.3.42');
    assert.equal(release.ok, false);
    assert.deepEqual(Object.keys(release.checks).filter(key => !release.checks[key]), ['apiVersionMatches']);
    return true;
  });
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

test('reports safe probe failures without response contents', () => {
  const report = validateObservation(observation({
    apiHealth: {
      status: 0,
      json: undefined,
      error: 'CURL_6',
    },
  }));
  assert.equal(report.ok, false);
  assert.equal(report.checks.apiHealth, false);
  assert.deepEqual(report.probes, {
    apiHealth: { status: 0, error: 'CURL_6' },
    apiReady: { status: 200 },
    identityHealth: { status: 200 },
    unauthSources: { status: 401 },
    unauthUsage: { status: 401 },
  });
});

test('maps process failures to safe diagnostic codes', () => {
  assert.equal(probeFailure({ code: 6 }), 'CURL_6');
  assert.equal(probeFailure({ code: 'ENOENT' }), 'ENOENT');
  assert.equal(probeFailure({ code: 'private response text' }), 'PROBE_FAILED');
});

test('reports when curl cannot be launched', async () => {
  let failure;
  try {
    await promisify(execFile)(process.execPath, [SMOKE_SCRIPT], {
      env: {
        ...process.env,
        PATH: '/definitely/missing',
      },
      encoding: 'utf8',
      timeout: 5_000,
    });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure);
  const report = JSON.parse(failure.stdout);
  assert.equal(report.ok, false);
  assert.deepEqual(report.probes.apiHealth, {
    status: 0,
    error: 'ENOENT',
  });
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
    '--expected-version', '0.3.42',
  ]).ok, true);
  assert.equal(parseOptions(['--api-origin', 'http://api.example.test']).ok, false);
  assert.equal(parseOptions([
    '--api-origin', API_ORIGIN,
    '--identity-origin', API_ORIGIN,
  ]).ok, false);
  assert.equal(parseOptions(['--expected-version', 'latest']).ok, false);
  assert.equal(parseOptions(['--expected-version', '']).ok, false);
  assert.equal(parseOptions(['--', '--help']).help, true);
});
