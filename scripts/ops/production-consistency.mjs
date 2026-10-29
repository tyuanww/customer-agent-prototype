#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const GIT_SHA = /^[0-9a-f]{40}$/u;
const VERSION = /^\d+\.\d+\.\d+$/u;
const SQL_IDENTIFIER = /^[a-z_][a-z0-9_]*$/u;
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_PACKAGE_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const COMMAND_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 8_000;
const CHILD_ENV = Object.freeze({
  LANG: 'C',
  PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
});

class ConsistencyError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ConsistencyError';
    this.code = code;
  }
}

function fail(code) {
  throw new ConsistencyError(code);
}

function readRegularFile(file, maxBytes, code) {
  let stats;
  try {
    stats = lstatSync(file);
  } catch {
    fail(code);
  }
  if (!stats.isFile() || stats.size < 1 || stats.size > maxBytes) fail(code);
  try {
    return readFileSync(file);
  } catch {
    fail(code);
  }
}

function readJsonFile(file, maxBytes, code) {
  const bytes = readRegularFile(file, maxBytes, code);
  try {
    return Object.freeze({ bytes, value: JSON.parse(bytes.toString('utf8')) });
  } catch {
    fail(code);
  }
}

function canonicalPath(value, code) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || !path.isAbsolute(value)) {
    fail(code);
  }
  try {
    return realpathSync.native(value);
  } catch {
    fail(code);
  }
}

function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      env: CHILD_ENV,
      maxBuffer: MAX_PACKAGE_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: COMMAND_TIMEOUT_MS,
    }).trim();
  } catch {
    fail(`COMMAND_FAILED_${command.toUpperCase().replaceAll(/[^A-Z0-9]+/gu, '_')}`);
  }
}

function parseLoopbackOrigin(value) {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1'
    || parsed.username || parsed.password || parsed.pathname !== '/'
    || parsed.search || parsed.hash) return undefined;
  const port = Number(parsed.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return undefined;
  return Object.freeze({ origin: parsed.origin, port });
}

function isPublicHostname(hostname) {
  if (hostname.length < 4 || hostname.length > 253) return false;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
  if (hostname.includes(':') || /^\d+\.\d+\.\d+\.\d+$/u.test(hostname)) return false;
  if (!hostname.includes('.')) return false;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/iu.test(hostname);
}

function parsePublicHttpsOrigin(value) {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
    || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')
    || (parsed.port && parsed.port !== '443') || !isPublicHostname(parsed.hostname)) return undefined;
  return parsed.origin;
}

export function parseProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) {
    fail('PROFILE_INVALID');
  }
  const api = parseLoopbackOrigin(value.apiOrigin);
  const identity = parseLoopbackOrigin(value.identityOrigin);
  if (!api || !identity || api.origin === identity.origin
    || value.apiPort !== api.port || value.identityPort !== identity.port
    || typeof value.databaseName !== 'string' || !SQL_IDENTIFIER.test(value.databaseName)
    || typeof value.stackRoot !== 'string' || !path.isAbsolute(value.stackRoot)) {
    fail('PROFILE_INVALID');
  }
  return Object.freeze({
    stackRoot: value.stackRoot,
    apiOrigin: api.origin,
    identityOrigin: identity.origin,
    apiPort: api.port,
    identityPort: identity.port,
    databaseName: value.databaseName,
  });
}

export function parseClientProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.mode !== 'product-remote') {
    fail('CLIENT_PROFILE_INVALID');
  }
  const apiOrigin = parsePublicHttpsOrigin(value.apiOrigin);
  const identityOrigin = parsePublicHttpsOrigin(value.identityOrigin);
  if (!apiOrigin || !identityOrigin || apiOrigin === identityOrigin) fail('CLIENT_PROFILE_INVALID');
  return Object.freeze({ mode: 'product-remote', apiOrigin, identityOrigin });
}

function environmentAssignment(values, name) {
  if (typeof values !== 'string') return undefined;
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = values.match(new RegExp(`(?:^|\\s)${escaped}=(?:"([^"]*)"|'([^']*)'|(\\S+))`, 'u'));
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

export function parseSystemctlShow(output) {
  const fields = new Map();
  for (const line of output.split(/\r?\n/u)) {
    const separator = line.indexOf('=');
    if (separator > 0) fields.set(line.slice(0, separator), line.slice(separator + 1));
  }
  const mainPid = Number(fields.get('MainPID'));
  const stackRoot = environmentAssignment(fields.get('Environment'), 'CUSTOMER_AGENT_STACK_ROOT');
  if (!Number.isSafeInteger(mainPid) || mainPid < 1 || typeof stackRoot !== 'string') {
    fail('UNIT_OBSERVATION_INVALID');
  }
  return Object.freeze({
    loadState: fields.get('LoadState') ?? '',
    activeState: fields.get('ActiveState') ?? '',
    subState: fields.get('SubState') ?? '',
    mainPid,
    workingDirectory: fields.get('WorkingDirectory') ?? '',
    stackRoot,
  });
}

export function parseListeners(output) {
  const listeners = [];
  for (const line of output.split(/\r?\n/u)) {
    const fields = line.trim().split(/\s+/u);
    if (fields[0] !== 'LISTEN' || fields.length < 4) continue;
    const endpoint = fields[3];
    const separator = endpoint.lastIndexOf(':');
    if (separator < 1) continue;
    const port = Number(endpoint.slice(separator + 1));
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) continue;
    listeners.push(Object.freeze({
      host: endpoint.slice(0, separator).replace(/^\[|\]$/gu, ''),
      port,
    }));
  }
  return Object.freeze(listeners);
}

function listenerState(listeners, port) {
  const matching = listeners.filter((listener) => listener.port === port);
  return Object.freeze({
    hasLoopback: matching.some((listener) => listener.host === '127.0.0.1'),
    onlyLoopback: matching.length > 0
      && matching.every((listener) => listener.host === '127.0.0.1'),
  });
}

async function readResponseJson(url) {
  let response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      headers: { accept: 'application/json' },
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return Object.freeze({ status: 0, json: undefined });
  }
  if (!response.body) return Object.freeze({ status: response.status, json: undefined });

  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return Object.freeze({ status: response.status, json: undefined });
      }
      chunks.push(next.value);
    }
  } catch {
    return Object.freeze({ status: response.status, json: undefined });
  }
  try {
    return Object.freeze({
      status: response.status,
      json: JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))),
    });
  } catch {
    return Object.freeze({ status: response.status, json: undefined });
  }
}

function isReadyPayload(probe) {
  if (probe.status !== 200 || !probe.json || typeof probe.json !== 'object') return false;
  if (probe.json.status !== 'ready' || !probe.json.checks || typeof probe.json.checks !== 'object') return false;
  const values = Object.values(probe.json.checks);
  return values.length > 0 && values.every((value) => value === 'ok');
}

function isIdentityHealthy(probe) {
  return probe.status === 200
    && Boolean(probe.json)
    && typeof probe.json === 'object'
    && (probe.json.ok === true || probe.json.status === 'ok');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeVersion(value) {
  return typeof value === 'string' && VERSION.test(value) ? value : null;
}

function sameListedPath(values, expected) {
  return values.length > 0 && values.every((value) => value === expected);
}

export function validateConsistency(observation) {
  const { current, profile, units, versions, listeners, client, expected, probes } = observation;
  const apiListener = listenerState(listeners, profile.apiPort);
  const identityListener = listenerState(listeners, profile.identityPort);
  const apiVersion = safeVersion(probes.localApiHealth.json?.version);
  const observedUnitsActive = units.length > 0
    && units.every((unit) => unit.loadState === 'loaded' && unit.activeState === 'active');
  const observedUnitsRunning = units.length > 0
    && units.every((unit) => unit.subState === 'running');
  const unitsShareStackRoot = units.length > 0
    && units.every((unit) => unit.stackRootPath === profile.stackRootPath);

  const checks = Object.freeze({
    currentIsSymlink: current.isSymlink === true,
    currentTargetNameMatchesGitHead: GIT_SHA.test(current.gitHead)
      && path.basename(current.releasePath) === current.gitHead,
    gitWorktreeClean: current.gitClean === true,
    observedUnitsLoaded: observedUnitsActive,
    observedUnitsRunning,
    systemdWorkingDirectoriesMatchCurrent: sameListedPath(
      units.map((unit) => unit.workingDirectoryPath),
      current.releasePath,
    ),
    processWorkingDirectoriesMatchCurrent: sameListedPath(
      units.map((unit) => unit.processCwdPath),
      current.releasePath,
    ),
    profileStackRootMatchesProfileFile: profile.stackRootPath === profile.profileDirectoryPath,
    observedUnitsUseSameStackRoot: unitsShareStackRoot,
    sameObservedConfigurationEntry: unitsShareStackRoot
      && profile.stackRootPath === profile.profileDirectoryPath,
    profileOriginsLoopback: parseLoopbackOrigin(profile.apiOrigin)?.port === profile.apiPort
      && parseLoopbackOrigin(profile.identityOrigin)?.port === profile.identityPort,
    profileDatabaseNameValid: typeof profile.databaseName === 'string'
      && SQL_IDENTIFIER.test(profile.databaseName),
    versionFileMatchesPackage: safeVersion(versions.versionFile) !== null
      && safeVersion(versions.versionFile) === safeVersion(versions.packageVersion),
    apiHealthVersionMatchesTree: apiVersion !== null && apiVersion === safeVersion(versions.versionFile),
    localApiHealthReady: probes.localApiHealth.status === 200
      && probes.localApiHealth.json?.status === 'ok'
      && probes.localApiHealth.json?.service === 'cs-ai-api',
    apiListenerLoopbackOnly: apiListener.onlyLoopback,
    identityListenerLoopbackOnly: identityListener.onlyLoopback,
    publicApiReady: isReadyPayload(probes.publicApiReady),
    publicIdentityHealthy: isIdentityHealthy(probes.publicIdentityHealth),
    clientModeIsProductRemote: client.mode === 'product-remote',
    expectedOriginsAreDistinctPublicHttps: parsePublicHttpsOrigin(expected.apiOrigin) !== undefined
      && parsePublicHttpsOrigin(expected.identityOrigin) !== undefined
      && expected.apiOrigin !== expected.identityOrigin,
    clientApiOriginMatchesExpected: client.apiOrigin === expected.apiOrigin,
    clientIdentityOriginMatchesExpected: client.identityOrigin === expected.identityOrigin,
  });

  return Object.freeze({
    ok: Object.values(checks).every(Boolean),
    checks,
    versions: Object.freeze({
      file: safeVersion(versions.versionFile),
      package: safeVersion(versions.packageVersion),
      apiHealth: apiVersion,
    }),
    gitHead: GIT_SHA.test(current.gitHead) ? current.gitHead : null,
    profileConfigSha256: observation.profileConfigSha256,
    clientConfigSha256: observation.clientConfigSha256,
    limits: Object.freeze({
      productionUnitUniquenessProven: false,
      databaseUniquenessProven: false,
    }),
  });
}

function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        current: { type: 'string' },
        profile: { type: 'string' },
        unit: { type: 'string', multiple: true },
        'client-profile': { type: 'string' },
        'expected-api-origin': { type: 'string' },
        'expected-identity-origin': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
    });
  } catch {
    fail('INVALID_ARGUMENTS');
  }
  if (parsed.values.help) return Object.freeze({ help: true });
  const units = parsed.values.unit ?? [];
  if (typeof parsed.values.current !== 'string'
    || typeof parsed.values.profile !== 'string'
    || typeof parsed.values['client-profile'] !== 'string'
    || typeof parsed.values['expected-api-origin'] !== 'string'
    || typeof parsed.values['expected-identity-origin'] !== 'string'
    || units.length < 1
    || units.some((unit) => typeof unit !== 'string' || unit.length < 1 || unit.length > 256)) {
    fail('INVALID_ARGUMENTS');
  }
  const apiOrigin = parsePublicHttpsOrigin(parsed.values['expected-api-origin']);
  const identityOrigin = parsePublicHttpsOrigin(parsed.values['expected-identity-origin']);
  if (!apiOrigin || !identityOrigin || apiOrigin === identityOrigin) fail('INVALID_ARGUMENTS');
  return Object.freeze({
    help: false,
    current: parsed.values.current,
    profile: parsed.values.profile,
    units: Object.freeze([...new Set(units)]),
    clientProfile: parsed.values['client-profile'],
    expected: Object.freeze({ apiOrigin, identityOrigin }),
  });
}

export async function collectObservations(options, adapters = {}) {
  const run = adapters.runCommand ?? runCommand;
  const fetchJson = adapters.fetchJson ?? readResponseJson;
  const readProcessCwd = adapters.readProcessCwd
    ?? ((pid) => canonicalPath(`/proc/${String(pid)}/cwd`, 'PROCESS_CWD_INVALID'));
  let currentStats;
  try {
    currentStats = lstatSync(options.current);
  } catch {
    fail('CURRENT_UNREADABLE');
  }
  const releasePath = canonicalPath(options.current, 'CURRENT_UNREADABLE');
  const profileFile = canonicalPath(options.profile, 'PROFILE_INVALID');
  const profileDirectoryPath = canonicalPath(path.dirname(profileFile), 'PROFILE_INVALID');
  const profileDocument = readJsonFile(profileFile, MAX_CONFIG_BYTES, 'PROFILE_INVALID');
  const profile = parseProfile(profileDocument.value);
  const profileStackRootPath = canonicalPath(profile.stackRoot, 'PROFILE_INVALID');

  const clientFile = canonicalPath(options.clientProfile, 'CLIENT_PROFILE_INVALID');
  const clientDocument = readJsonFile(clientFile, MAX_CONFIG_BYTES, 'CLIENT_PROFILE_INVALID');
  const client = parseClientProfile(clientDocument.value);

  const versionBytes = readRegularFile(path.join(releasePath, 'VERSION'), 128, 'VERSION_INVALID');
  const versionFile = versionBytes.toString('utf8').trim();
  if (!VERSION.test(versionFile)) fail('VERSION_INVALID');
  const packageDocument = readJsonFile(
    path.join(releasePath, 'apps/desktop/package.json'),
    MAX_PACKAGE_BYTES,
    'PACKAGE_INVALID',
  );
  const packageVersion = packageDocument.value?.version;
  if (typeof packageVersion !== 'string' || !VERSION.test(packageVersion)) fail('PACKAGE_INVALID');

  const gitHead = run('git', [
    '-c', `safe.directory=${releasePath}`,
    '-C', releasePath,
    'rev-parse', 'HEAD',
  ]);
  if (!GIT_SHA.test(gitHead)) fail('GIT_HEAD_INVALID');
  const gitStatus = run('git', [
    '-c', `safe.directory=${releasePath}`,
    '-C', releasePath,
    'status', '--porcelain=v1', '--untracked-files=all',
  ]);

  const units = options.units.map((unit) => {
    // systemd has no per-key Environment selector. Parse the stack root here and
    // keep only that value, so unrelated environment entries never enter a report.
    const shown = parseSystemctlShow(run('systemctl', [
      'show',
      unit,
      '--property=LoadState',
      '--property=ActiveState',
      '--property=SubState',
      '--property=MainPID',
      '--property=WorkingDirectory',
      '--property=Environment',
    ]));
    const workingDirectoryPath = canonicalPath(shown.workingDirectory, 'UNIT_WORKDIR_INVALID');
    const processCwdPath = readProcessCwd(shown.mainPid);
    const stackRootPath = canonicalPath(shown.stackRoot, 'UNIT_STACK_ROOT_INVALID');
    return Object.freeze({
      loadState: shown.loadState,
      activeState: shown.activeState,
      subState: shown.subState,
      workingDirectoryPath,
      processCwdPath,
      stackRootPath,
    });
  });

  const listeners = parseListeners(run('ss', ['-H', '-ltn']));
  const localApiHealthUrl = new URL('/health', profile.apiOrigin).toString();
  const publicApiReadyUrl = new URL('/ready', options.expected.apiOrigin).toString();
  const publicIdentityHealthUrl = new URL('/health', options.expected.identityOrigin).toString();
  const [localApiHealth, publicApiReady, publicIdentityHealth] = await Promise.all([
    fetchJson(localApiHealthUrl),
    fetchJson(publicApiReadyUrl),
    fetchJson(publicIdentityHealthUrl),
  ]);

  return Object.freeze({
    current: Object.freeze({
      isSymlink: currentStats.isSymbolicLink(),
      releasePath,
      gitHead,
      gitClean: gitStatus.length === 0,
    }),
    profile: Object.freeze({
      ...profile,
      stackRootPath: profileStackRootPath,
      profileDirectoryPath,
    }),
    units: Object.freeze(units),
    versions: Object.freeze({ versionFile, packageVersion }),
    listeners,
    client,
    expected: options.expected,
    probes: Object.freeze({ localApiHealth, publicApiReady, publicIdentityHealth }),
    profileConfigSha256: sha256(profileDocument.bytes),
    clientConfigSha256: sha256(clientDocument.bytes),
  });
}

function printHelp() {
  process.stdout.write([
    'Usage:',
    '  node scripts/ops/production-consistency.mjs \\',
    '    --current <release-link> \\',
    '    --profile <stack-root/profile.json> \\',
    '    --unit <systemd-unit> [--unit <systemd-unit> ...] \\',
    '    --client-profile <synthetic-stack.json> \\',
    '    --expected-api-origin <https-origin> \\',
    '    --expected-identity-origin <https-origin>',
    '',
    'The command reads local files, systemd state, process state, listeners, and bounded HTTPS health checks.',
    'It does not change files, services, databases, or remote configuration.',
    '',
  ].join('\n'));
}

async function main() {
  let options;
  try {
    options = parseCli(process.argv.slice(2));
  } catch (error) {
    const code = error instanceof ConsistencyError ? error.code : 'INVALID_ARGUMENTS';
    process.stdout.write(`${JSON.stringify({ ok: false, error: code })}\n`);
    return 2;
  }
  if (options.help) {
    printHelp();
    return 0;
  }
  try {
    const report = validateConsistency(await collectObservations(options));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  } catch (error) {
    const code = error instanceof ConsistencyError ? error.code : 'CHECK_FAILED';
    process.stdout.write(`${JSON.stringify({ ok: false, error: code })}\n`);
    return 1;
  }
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedFile === path.resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => {
    process.exitCode = code;
  }).catch(() => {
    process.stdout.write(`${JSON.stringify({ ok: false, error: 'CHECK_FAILED' })}\n`);
    process.exitCode = 1;
  });
}
