#!/usr/bin/env node

import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const DEFAULT_API_ORIGIN = 'https://agent-auth.jianghua.site';
const DEFAULT_IDENTITY_ORIGIN = 'https://agent-pass.jianghua.site';
const MAX_RESPONSE_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 8_000;
const VERSION = /^\d+\.\d+\.\d+$/u;
const READY_CHECKS = Object.freeze(['auth', 'content', 'database', 'schema', 'storage']);

function invalid(code) {
  return Object.freeze({ ok: false, error: code });
}

function publicOrigin(value) {
  if (typeof value !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
    || parsed.pathname !== '/' || parsed.search || parsed.hash
    || (parsed.port && parsed.port !== '443')) return null;
  const host = parsed.hostname;
  if (host === 'localhost' || host.endsWith('.localhost')
    || /^\d+\.\d+\.\d+\.\d+$/u.test(host) || host.includes(':')) return null;
  return parsed.origin;
}

export function parseOptions(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv[0] === '--' ? argv.slice(1) : argv,
      allowPositionals: false,
      options: {
        'api-origin': { type: 'string', default: DEFAULT_API_ORIGIN },
        'identity-origin': { type: 'string', default: DEFAULT_IDENTITY_ORIGIN },
        'expected-version': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
    });
  } catch {
    return invalid('INVALID_ARGUMENTS');
  }
  if (parsed.values.help) return Object.freeze({ ok: true, help: true });

  const apiOrigin = publicOrigin(parsed.values['api-origin']);
  const identityOrigin = publicOrigin(parsed.values['identity-origin']);
  const expectedVersion = parsed.values['expected-version'];
  if (!apiOrigin || !identityOrigin || apiOrigin === identityOrigin
    || (expectedVersion !== undefined && !VERSION.test(expectedVersion))) {
    return invalid('INVALID_ARGUMENTS');
  }
  return Object.freeze({
    ok: true,
    help: false,
    apiOrigin,
    identityOrigin,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  });
}

async function readJsonProbe(url) {
  let output;
  try {
    output = await promisify(execFile)('curl', [
      '--silent',
      '--show-error',
      '--proto', '=https',
      '--tlsv1.2',
      '--max-redirs', '0',
      '--max-time', String(PROBE_TIMEOUT_MS / 1000),
      '--max-filesize', String(MAX_RESPONSE_BYTES),
      '--request', 'GET',
      '--header', 'accept: application/json',
      '--write-out', '\n%{http_code}',
      url.href,
    ], {
      encoding: 'utf8',
      env: Object.fromEntries([
        ['HOME', process.env.HOME],
        ['PATH', process.env.PATH],
        ['SSL_CERT_FILE', process.env.SSL_CERT_FILE],
      ].filter((entry) => entry[1] !== undefined)),
      maxBuffer: MAX_RESPONSE_BYTES + 1024,
      timeout: (PROBE_TIMEOUT_MS + 2) * 1000,
    });
  } catch {
    return Object.freeze({ status: 0, json: undefined });
  }
  const separator = output.stdout.lastIndexOf('\n');
  if (separator < 0) return Object.freeze({ status: 0, json: undefined });
  const status = Number(output.stdout.slice(separator + 1).trim());
  if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
    return Object.freeze({ status: 0, json: undefined });
  }
  try {
    return Object.freeze({
      status,
      json: JSON.parse(output.stdout.slice(0, separator)),
    });
  } catch {
    return Object.freeze({ status, json: undefined });
  }
}

export async function collectObservation(options, fetchJson = readJsonProbe) {
  const api = options.apiOrigin;
  const identity = options.identityOrigin;
  const [apiHealth, apiReady, identityHealth, unauthSources, unauthUsage] = await Promise.all([
    fetchJson(new URL('/health', api)),
    fetchJson(new URL('/ready', api)),
    fetchJson(new URL('/health', identity)),
    fetchJson(new URL('/v1/intake/sources', api)),
    fetchJson(new URL('/v1/events/usage', api)),
  ]);
  return Object.freeze({
    apiHealth,
    apiReady,
    identityHealth,
    unauthSources,
    unauthUsage,
  });
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

export function validateObservation(observation, expectedVersion) {
  const health = observation.apiHealth.json;
  const ready = observation.apiReady.json;
  const identity = observation.identityHealth.json;
  const healthVersion = health?.version;
  const readyChecks = ready?.checks;
  const checks = Object.freeze({
    apiHealth: observation.apiHealth.status === 200
      && exactKeys(health, ['status', 'service', 'version'])
      && health.status === 'ok'
      && health.service === 'cs-ai-api'
      && typeof health.version === 'string'
      && VERSION.test(health.version),
    apiVersionMatches: expectedVersion === undefined || healthVersion === expectedVersion,
    apiReady: observation.apiReady.status === 200
      && exactKeys(ready, ['status', 'checks'])
      && ready.status === 'ready'
      && exactKeys(readyChecks, READY_CHECKS)
      && READY_CHECKS.every((name) => readyChecks[name] === 'ok'),
    identityHealth: observation.identityHealth.status === 200
      && exactKeys(identity, ['ok', 'kind'])
      && identity.ok === true
      && identity.kind === 'password',
    intakeRequiresAuthentication: observation.unauthSources.status === 401,
    usageRequiresAuthentication: observation.unauthUsage.status === 401,
  });
  return Object.freeze({
    ok: Object.values(checks).every(Boolean),
    version: typeof healthVersion === 'string' && VERSION.test(healthVersion) ? healthVersion : null,
    checks,
  });
}

function printHelp() {
  process.stdout.write([
    'Usage:',
    '  node scripts/ops/production-smoke.mjs [options]',
    '',
    'Read-only checks against public production endpoints.',
    '',
    'Options:',
    `  --api-origin <origin>        default ${DEFAULT_API_ORIGIN}`,
    `  --identity-origin <origin>   default ${DEFAULT_IDENTITY_ORIGIN}`,
    '  --expected-version <x.y.z>   optionally require the deployed API version',
    '  --help, -h',
    '',
  ].join('\n'));
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (!options.ok) {
    process.stdout.write(`${JSON.stringify(options)}\n`);
    return 2;
  }
  if (options.help) {
    printHelp();
    return 0;
  }
  try {
    const report = validateObservation(
      await collectObservation(options),
      options.expectedVersion,
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, error: 'CHECK_FAILED' })}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => {
    process.exitCode = code;
  }).catch(() => {
    process.stdout.write(`${JSON.stringify({ ok: false, error: 'CHECK_FAILED' })}\n`);
    process.exitCode = 1;
  });
}
