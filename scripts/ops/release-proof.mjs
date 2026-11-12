import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const RELEASE_PROOF_SCHEMA = 'customer-agent-release-preflight/v3';
export const ROLLBACK_RUNTIME_SCOPE = 'rollback-api-server-readonly-health-ready-sop-domain-decode';
export const ROLLBACK_PROTOCOL_CAPABILITIES = Object.freeze({
  accessDecisionSopSource: true,
  accessDecisionUnknownDomainRejected: true,
  intakeEntitlementSopSource: true,
  intakeEntitlementUnknownDomainRejected: true,
  intakeContractViewNegotiated: true,
  intakeEntitlementView: 'resource-disable',
});
const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;

export class ReleaseProofError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReleaseProofError';
    this.code = code;
  }
}

function fail(code) {
  throw new ReleaseProofError(code);
}

function migrationIdentity(row) {
  return [row.position, row.id ?? row.migrationId, row.sha256,
    row.contractSetId ?? row.contract_set_id, row.sourceGitSha ?? row.source_git_sha,
    row.sourceSchemaSha256 ?? row.source_schema_sha256];
}

/** Every metadata field must agree. Counts describe the ledger, never a reader's catalogue size. */
export function assertReleasePrefix(applied, catalogue) {
  if (!Array.isArray(applied) || applied.length < 1 || applied.length > catalogue.length
    || applied.some((row, index) => {
      if (!row || !catalogue[index]) return true;
      const identity = migrationIdentity(row);
      return row.position !== index + 1 || typeof identity[1] !== 'string' || identity[1].length < 1
        || !DIGEST.test(identity[2] ?? '') || typeof identity[3] !== 'string' || identity[3].length < 1
        || !SHA.test(identity[4] ?? '') || !DIGEST.test(identity[5] ?? '')
        || JSON.stringify(identity) !== JSON.stringify(migrationIdentity(catalogue[index]));
    })) {
    fail('DATABASE_PREFIX_MISMATCH');
  }
}

/** New readers own their read-only transaction. Legacy readers must accept their entire catalogue. */
export async function verifyReleaseDatabase(database, client, expectedCount) {
  let report;
  let capability;
  if (typeof database.verifyAppliedDatabaseMigrations === 'function') {
    report = await database.verifyAppliedDatabaseMigrations(client);
    capability = 'applied-prefix';
  } else {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      const state = await database.inspectDatabaseMigrations(client);
      if (state.state !== 'COMPLETE') fail('ROLLBACK_MIGRATION_INCOMPATIBLE');
      report = await database.verifyDatabaseMigrations(client);
      if (report.migrationCount !== state.applied.length) fail('ROLLBACK_MIGRATION_INCOMPATIBLE');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    capability = 'complete-catalogue';
  }
  if (report?.status !== 'PASS' || !Number.isSafeInteger(report.migrationCount)
    || report.migrationCount < 1 || expectedCount !== undefined && report.migrationCount !== expectedCount) {
    fail('DATABASE_PREFIX_VERIFICATION_FAILED');
  }
  return Object.freeze({ migrationCount: report.migrationCount, status: 'PASS', code: null, capability });
}

/** systemctl's argv serialization is accepted only when every token is unambiguous. */
export function assertServiceStartup(startup, expected) {
  const { argv, stackRoot, unitType, remainAfterExit, restart, environmentSha256 } = startup ?? {};
  const entry = path.join(expected.controllerRoot, 'scripts/synthetic-stack/stack.ts');
  const tail = Array.isArray(argv) ? argv.slice(2) : null;
  if (!Array.isArray(argv) || !argv.every(value => typeof value === 'string')
    || !path.isAbsolute(argv[0] ?? '') || path.basename(argv[0]) !== 'node'
    || argv[1] !== entry || stackRoot !== expected.stackRoot
    || !['simple', 'exec'].includes(unitType) || typeof remainAfterExit !== 'boolean'
    || !['always', 'on-failure'].includes(restart)
    || typeof environmentSha256 !== 'string' || !DIGEST.test(environmentSha256)
    || !tail || tail[0] !== 'start') fail('SERVICE_STARTUP_INVALID');
  const flags = tail.slice(1).filter(value => value !== '--foreground');
  if (tail.filter(value => value === '--foreground').length !== 1
    || flags.length !== 3 || flags[0] !== '--existing-database'
    || flags[1] !== '--runtime-release' || flags[2] !== expected.runtimeRelease) {
    fail('SERVICE_STARTUP_INVALID');
  }
  return Object.freeze({ controllerRoot: expected.controllerRoot,
    controllerGitSha: expected.controllerGitSha, controllerBuildSha256: expected.controllerBuildSha256,
    runtimeRelease: expected.runtimeRelease, stackRoot, unit: expected.unit, unitType, remainAfterExit, restart, environmentSha256 });
}

function serviceEnvironmentFiles(value, read, stackRoot) {
  const entries = [];
  const pattern = /(\/[^\\'"()\n\r\0]+?) \(ignore_errors=(yes|no)\)(?: +|$)/gy;
  let offset = 0;
  while (offset < value.length) {
    const match = pattern.exec(value);
    if (!match || match.index !== offset) fail('SERVICE_STARTUP_INVALID');
    offset = pattern.lastIndex;
    const filename = match[1];
    const ignoreErrors = match[2] === 'yes';
    // The publisher binds these bytes through the proof, backup and install checks.
    // Keeping a marker here gives each mutable file a single verification owner.
    if (filename === path.join(stackRoot, 'api.env')) {
      entries.push({ path: filename, ignoreErrors, state: 'publisher-managed' });
      continue;
    }
    try {
      const bytes = read(filename);
      entries.push({ path: filename, ignoreErrors, state: 'present',
        sha256: createHash('sha256').update(bytes).digest('hex') });
    } catch (error) {
      if (!ignoreErrors || error.code !== 'ENOENT') fail('SERVICE_STARTUP_INVALID');
      entries.push({ path: filename, ignoreErrors, state: 'missing', sha256: null });
    }
  }
  return entries;
}

/** Declaration-only observations require comparison with a previously verified running binding. */
export function readServiceStartup(expected, execute = execFileSync, read = readFileSync, { declarationOnly = false } = {}) {
  try {
    if (!/^[A-Za-z0-9_.@-]+\.service$/u.test(expected.unit ?? '')) fail('SERVICE_STARTUP_INVALID');
    const output = execute('systemctl', ['show', expected.unit, '--all',
      '--property=ExecStart,Environment,EnvironmentFiles,Type,RemainAfterExit,Restart,MainPID,ActiveState'], {
      encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { LANG: 'C', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' },
    });
    const exec = /^ExecStart=\{ path=([^;{}]+?) ; argv\[\]=([^;{}]+?) ;[^{}\n]*\}$/mu.exec(output);
    if (!exec || /[\\'"\n\r\0]/u.test(exec[2])) fail('SERVICE_STARTUP_INVALID');
    const argv = exec[2].trim().split(/ +/u);
    if (exec[1] !== argv[0]) fail('SERVICE_STARTUP_INVALID');
    const unitType = /^Type=(.*)$/mu.exec(output)?.[1];
    const remainAfterExit = /^RemainAfterExit=(.*)$/mu.exec(output)?.[1];
    const restart = /^Restart=(.*)$/mu.exec(output)?.[1];
    if (!['yes', 'no'].includes(remainAfterExit)) fail('SERVICE_STARTUP_INVALID');
    const environment = /^Environment=(.*)$/mu.exec(output)?.[1] ?? '';
    const environmentFiles = serviceEnvironmentFiles(/^EnvironmentFiles=(.*)$/mu.exec(output)?.[1] ?? '', read, expected.stackRoot);
    const environmentSha256 = createHash('sha256')
      .update(JSON.stringify({ environment, environmentFiles })).digest('hex');
    if (declarationOnly) {
      return assertServiceStartup({ argv, stackRoot: expected.stackRoot, unitType,
        remainAfterExit: remainAfterExit === 'yes', restart, environmentSha256 }, expected);
    }
    const pid = /^MainPID=(.*)$/mu.exec(output)?.[1];
    if (!/^[1-9][0-9]*$/u.test(pid ?? '') || !Number.isSafeInteger(Number(pid))
      || /^ActiveState=(.*)$/mu.exec(output)?.[1] !== 'active') fail('SERVICE_STARTUP_INVALID');
    const cmdline = read(`/proc/${pid}/cmdline`);
    const environ = read(`/proc/${pid}/environ`);
    if (!Buffer.isBuffer(cmdline) || cmdline.at(-1) !== 0 || !Buffer.isBuffer(environ) || environ.at(-1) !== 0) {
      fail('SERVICE_STARTUP_INVALID');
    }
    const actualArgv = cmdline.subarray(0, -1).toString('utf8').split('\0');
    const roots = environ.subarray(0, -1).toString('utf8').split('\0')
      .filter(value => value.startsWith('CUSTOMER_AGENT_STACK_ROOT='));
    if (JSON.stringify(actualArgv) !== JSON.stringify(argv) || roots.length !== 1) fail('SERVICE_STARTUP_INVALID');
    const stackRoot = roots[0].slice('CUSTOMER_AGENT_STACK_ROOT='.length);
    return assertServiceStartup({ argv, stackRoot, unitType, remainAfterExit: remainAfterExit === 'yes', restart,
      environmentSha256 }, expected);
  } catch {
    // systemctl and filesystem errors may contain environment secrets.
    fail('SERVICE_STARTUP_INVALID');
  }
}

export function assertControllerBinding(actual, expected) {
  const keys = ['controllerRoot', 'controllerGitSha', 'controllerBuildSha256', 'runtimeRelease', 'stackRoot', 'unit', 'unitType', 'remainAfterExit', 'restart', 'environmentSha256'];
  if (!actual || !expected || keys.some(key => actual[key] !== expected[key])
    || !SHA.test(actual.controllerGitSha ?? '') || !DIGEST.test(actual.controllerBuildSha256 ?? '')
    || !['controllerRoot', 'runtimeRelease', 'stackRoot'].every(key => typeof actual[key] === 'string' && path.isAbsolute(actual[key]))
    || path.basename(actual.controllerRoot) !== actual.controllerGitSha
    || !/^[A-Za-z0-9_.@-]+\.service$/u.test(actual.unit ?? '')
    || !['simple', 'exec'].includes(actual.unitType) || typeof actual.remainAfterExit !== 'boolean'
    || !['always', 'on-failure'].includes(actual.restart)
    || typeof actual.environmentSha256 !== 'string' || !DIGEST.test(actual.environmentSha256)) {
    fail('SERVICE_STARTUP_CHANGED');
  }
}

/** One proof records the source, exact target, readers and startup contract for both producer and consumer. */
export function createReleaseProof({ sourceMigrationCount, targetMigrationCount, candidate, rollback,
  queryProfile, rollbackQueryProfile, candidateApiEnvSha256, controller, contentFingerprint, runtime, rollbackChecks, candidateDatabase }) {
  return Object.freeze({ schema: RELEASE_PROOF_SCHEMA,
    sourceMigrationCount, targetMigrationCount,
    candidateGitSha: candidate.gitSha ?? candidate.sha, rollbackGitSha: rollback.gitSha ?? rollback.sha,
    runtimeBuildSha256: candidate.runtimeBuildSha256, rollbackBuildSha256: rollback.runtimeBuildSha256,
    candidateQueryProfile: queryProfile, rollbackQueryProfile, candidateApiEnvSha256, controller, contentFingerprint, runtime,
    candidateDatabase, rollback: Object.freeze(rollbackChecks),
    status: runtime.status === 'PASS' && candidateDatabase.status === 'PASS'
      && rollbackChecks.every(check => check.status === 'PASS') ? 'PASS' : 'FAIL',
  });
}

function hasRollbackProtocolCapabilities(receipt, queryMode) {
  const capabilities = receipt?.protocolCapabilities;
  return receipt?.queryMode === queryMode && capabilities !== null && typeof capabilities === 'object'
    && Object.keys(capabilities).length === Object.keys(ROLLBACK_PROTOCOL_CAPABILITIES).length
    && Object.entries(ROLLBACK_PROTOCOL_CAPABILITIES).every(([key, value]) => capabilities[key] === value);
}

export function assertReleaseProof(checks, { previous, next, queryProfile, rollbackQueryProfile, candidateApiEnvSha256, controller, contentFingerprint }) {
  const source = checks?.sourceMigrationCount;
  const target = checks?.targetMigrationCount;
  if (checks?.schema !== RELEASE_PROOF_SCHEMA || Object.hasOwn(checks, 'action')
    || !Number.isSafeInteger(source) || source < 1 || source > next.manifest.length
    || !Number.isSafeInteger(target) || target < source || target > next.manifest.length
    || target !== next.manifest.length
    || checks.candidateGitSha !== next.sha || checks.rollbackGitSha !== previous.sha
    || !Array.isArray(checks.rollback) || checks.rollback.length !== target - source + 1) {
    fail('RELEASE_PREFLIGHT_REQUIRED');
  }
  if (source < previous.manifest.length) fail('ROLLBACK_MIGRATION_INCOMPATIBLE');
  assertReleasePrefix(previous.manifest.slice(0, Math.min(source, previous.manifest.length)), next.manifest);
  if (!DIGEST.test(checks.runtimeBuildSha256 ?? '') || checks.runtimeBuildSha256 !== next.runtimeBuildSha256
    || !DIGEST.test(checks.rollbackBuildSha256 ?? '') || checks.rollbackBuildSha256 !== previous.runtimeBuildSha256) {
    fail('RELEASE_RUNTIME_BUILD_CHANGED');
  }
  assertControllerBinding(checks.controller, controller);
  const scope = queryProfile?.mode === 'intake-compat'
    ? 'candidate-intake-catalog-readonly-gates' : 'candidate-query-runtime-readonly-initialization';
  if (!queryProfile || !['unified', 'intake-compat'].includes(queryProfile.mode)
    || !DIGEST.test(queryProfile.configurationSha256 ?? '')
    || queryProfile.apiEnvSha256 !== undefined && !DIGEST.test(queryProfile.apiEnvSha256)
    || checks.runtime?.queryMode !== queryProfile.mode || checks.runtime?.scope !== scope
    || checks.runtime?.configurationSha256 !== queryProfile.configurationSha256
    || JSON.stringify(checks.candidateQueryProfile) !== JSON.stringify(queryProfile)) {
    fail('RELEASE_QUERY_PROFILE_CHANGED');
  }
  if (!DIGEST.test(checks.candidateApiEnvSha256 ?? '') || checks.candidateApiEnvSha256 !== candidateApiEnvSha256
    || queryProfile.apiEnvSha256 !== undefined && queryProfile.apiEnvSha256 !== checks.candidateApiEnvSha256
    || !rollbackQueryProfile || !['unified', 'intake-compat'].includes(rollbackQueryProfile.mode)
    || !DIGEST.test(rollbackQueryProfile.configurationSha256 ?? '') || !DIGEST.test(rollbackQueryProfile.apiEnvSha256 ?? '')
    || JSON.stringify(checks.rollbackQueryProfile) !== JSON.stringify(rollbackQueryProfile)) {
    fail('RELEASE_QUERY_PROFILE_CHANGED');
  }
  if (checks.rollback.some(row => !hasRollbackProtocolCapabilities(row?.runtime, rollbackQueryProfile.mode))) {
    fail('ROLLBACK_PROTOCOL_INCOMPATIBLE');
  }
  const proofValid = (row, count) => row?.migrationCount === count && row.status === 'PASS' && row.code === null;
  if (!proofValid(checks.candidateDatabase, target)
    || checks.rollback.some((row, index) => !proofValid(row, source + index)
      || !proofValid(row.database, source + index) || row.database.capability !== 'applied-prefix'
      || row.database.readerGitSha !== controller.controllerGitSha
      || row.runtime?.status !== 'PASS' || row.runtime.code !== null
      || row.runtime.scope !== ROLLBACK_RUNTIME_SCOPE || row.runtime.migrationCount !== source + index
      || row.runtime.applicationGitSha !== previous.sha || row.runtime.runtimeBuildSha256 !== previous.runtimeBuildSha256
      || row.runtime.version !== previous.version
      || row.runtime.configurationSha256 !== rollbackQueryProfile.configurationSha256
      || row.runtime.apiEnvSha256 !== rollbackQueryProfile.apiEnvSha256)) fail('ROLLBACK_INCOMPATIBLE');
  if (checks.runtime?.status !== 'PASS' || checks.runtime.code !== null) fail('CANDIDATE_RUNTIME_NOT_READY');
  if (checks.status !== 'PASS') fail('RELEASE_PREFLIGHT_REQUIRED');
  if (!DIGEST.test(checks.contentFingerprint ?? '') || checks.contentFingerprint !== contentFingerprint) {
    fail('RELEASE_PREFLIGHT_STALE');
  }
  return { sourceMigrationCount: source, targetMigrationCount: target };
}


const ROLLBACK_SERVER_PROBE = `
  import { readFileSync, writeFileSync } from 'node:fs';
  import { pathToFileURL } from 'node:url';
  import { isDeepStrictEqual } from 'node:util';
  import path from 'node:path';
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const requiredProtocol = ${JSON.stringify(ROLLBACK_PROTOCOL_CAPABILITIES)};
  let started;
  let code = null;
  let queryMode;
  let protocolCapabilities = null;
  let failureCode = 'ROLLBACK_API_RUNTIME_FAILED';
  try {
    if (process.env.PGOPTIONS !== '-c default_transaction_read_only=on') throw new Error('READONLY_NOT_ENFORCED');
    for (const [key, value] of Object.entries(input.environment)) {
      if (key === 'DATABASE_URL' || key.endsWith('_DATABASE_URL')) {
        const url = new URL(value);
        if ([...url.searchParams.keys()].some(key => !['host', 'port'].includes(key))) {
          throw new Error('POOL_OPTIONS_INVALID');
        }
      }
    }
    Object.assign(process.env, input.environment, { PGOPTIONS: '-c default_transaction_read_only=on' });
    input.environment.PGOPTIONS = process.env.PGOPTIONS;
    const dist = path.join(input.releaseRoot, 'apps/api/dist');
    failureCode = 'ROLLBACK_PROTOCOL_INCOMPATIBLE';
    const actualBootstrap = await import(pathToFileURL(path.join(dist, 'runtime-config.js')).href);
    queryMode = actualBootstrap.parseApiPrivateBootstrapConfig(input.environment).query?.mode;
    if (queryMode !== input.queryMode) throw new Error('QUERY_MODE_MISMATCH');
    failureCode = 'ROLLBACK_API_RUNTIME_FAILED';
    const { startApi } = await import(pathToFileURL(path.join(input.releaseRoot, 'apps/api/dist/server.js')).href);
    started = await startApi({ environment: input.environment });
    if (started.address !== input.origin) throw new Error('LISTEN_ADDRESS_INVALID');
    const request = async route => {
      const response = await fetch(input.origin + route, { redirect: 'error', signal: AbortSignal.timeout(5000) });
      const text = await response.text();
      if (response.status !== 200 || text.length > 65536) throw new Error('NOT_READY');
      return JSON.parse(text);
    };
    const health = await request('/health');
    const ready = await request('/ready');
    const checks = ['auth', 'content', 'database', 'schema', 'storage'];
    if (health.status !== 'ok' || health.service !== 'cs-ai-api' || health.version !== input.version
      || ready.status !== 'ready' || !ready.checks || Object.keys(ready.checks).length !== checks.length
      || checks.some(key => ready.checks[key] !== 'ok')) throw new Error('NOT_READY');
    failureCode = 'ROLLBACK_PROTOCOL_INCOMPATIBLE';
    const { parseAccessDecision } = await import(pathToFileURL(path.join(input.releaseRoot, 'packages/unified-contracts/dist/index.js')).href);
    const intake = await import(pathToFileURL(path.join(dist, 'content-intake/contract-view.js')).href);
    const resource = await import(pathToFileURL(path.join(input.releaseRoot, 'packages/contracts/dist/sop-resource-disable.js')).href);
    const contractSet = resource.CONTRACT_PROVENANCE?.contract_set_id;
    const view = intake.selectIntakeView([contractSet]);
    if (typeof contractSet !== 'string' || contractSet.length === 0
      || view !== requiredProtocol.intakeEntitlementView) throw new Error('SOP_CONTRACT_VIEW_UNAVAILABLE');
    const actualIntakeEntitlement = value => intake.withIntakeView(view, () => {
      if (intake.intakeContractSet() !== contractSet) throw new Error('SOP_CONTRACT_CONTEXT_MISMATCH');
      return intake.parseContractSchema('IntakeEntitlement', value);
    });
    const scopes = ['product', 'sop'].map(domain => ({ tenantId: 'synthetic-tenant', appId: 'synthetic-app',
      brandId: 'synthetic-brand', shopId: 'synthetic-shop', domain, sourceId: 'synthetic-source-' + domain }));
    const decision = { userId: 'synthetic-agent', role: 'agent', state: 'allowed',
      allowedScopes: scopes.map(scope => ({ scope: { kind: 'source', ...scope }, actions: ['query'], validUntil: '2026-11-12T01:00:00Z' })),
      accessRevision: 1, factsVersion: 1, revocationGeneration: 0, policyVersion: 1, storeSetVersion: 1,
      resolvedAt: '2026-11-12T00:00:00Z', expiresAt: '2026-11-12T01:00:00Z', denyReason: null };
    const entitlement = { entitlementId: 'synthetic-entitlement', releaseId: 'synthetic-release', shopId: 'synthetic-shop',
      contextGeneration: 1, revocationGeneration: 0, validUntil: '2026-11-12T01:00:00Z', scopes };
    if (!isDeepStrictEqual(parseAccessDecision(structuredClone(decision)), decision)
      || !isDeepStrictEqual(actualIntakeEntitlement(structuredClone(entitlement)), entitlement)) throw new Error('SOP_SOURCE_DECODE_FAILED');
    for (const domain of ['unknown', 'unclassified', 'toString', '__proto__']) {
      const unknownDecision = structuredClone(decision);
      unknownDecision.allowedScopes[1].scope.domain = domain;
      const unknownEntitlement = structuredClone(entitlement);
      unknownEntitlement.scopes[1].domain = domain;
      let accessRejected = false;
      let entitlementRejected = false;
      try { parseAccessDecision(unknownDecision); } catch { accessRejected = true; }
      try { actualIntakeEntitlement(unknownEntitlement); } catch { entitlementRejected = true; }
      if (!accessRejected || !entitlementRejected) throw new Error('UNKNOWN_DOMAIN_ACCEPTED');
    }
    protocolCapabilities = requiredProtocol;
  } catch {
    code = failureCode;
  } finally {
    try { await started?.close(); } catch { code = 'ROLLBACK_API_CLEANUP_FAILED'; }
  }
  writeFileSync(3, JSON.stringify({ status: code === null ? 'PASS' : 'FAIL', code, queryMode, protocolCapabilities }));
`;

async function unusedLoopbackPort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

/**
 * Requires the application's complete catalogue before read-only initialization and SOP decoding.
 * The controller separately verifies the actual physical prefix.
 */
export async function probeRollbackRuntime({ release, database, environment, queryProfile, migrationCount },
  execute = spawnSync) {
  let scratch;
  let result = { status: 'FAIL', code: 'ROLLBACK_API_RUNTIME_FAILED' };
  try {
    if (!release || !SHA.test(release.gitSha ?? '') || !DIGEST.test(release.runtimeBuildSha256 ?? '')
      || !Array.isArray(release.manifest?.migrations) || release.manifest.migrations.length < 1
      || !Number.isSafeInteger(migrationCount) || migrationCount < 1 || !queryProfile
      || !['unified', 'intake-compat'].includes(queryProfile.mode)
      || !DIGEST.test(queryProfile.apiEnvSha256 ?? '') || !DIGEST.test(queryProfile.configurationSha256 ?? '')
      || !database || typeof database.host !== 'string' || !Number.isInteger(database.port)
      || database.port < 1 || database.port > 65535 || !/^[a-z_][a-z0-9_]*$/u.test(database.database ?? '')) {
      fail('ROLLBACK_API_PROBE_INVALID');
    }
    if (migrationCount < release.manifest.migrations.length) fail('ROLLBACK_MIGRATION_INCOMPATIBLE');
    scratch = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-rollback-api-'));
    const port = await unusedLoopbackPort();
    const probeEnvironment = { ...environment, CUSTOMER_AGENT_API_HOST: '127.0.0.1',
      CUSTOMER_AGENT_API_PORT: String(port), CONTENT_OBJECT_STORE_DIR: scratch };
    delete probeEnvironment.CUSTOMER_AGENT_REVIEW_LOGIN_PORT;
    for (const [key, value] of Object.entries(probeEnvironment)) {
      if (key !== 'DATABASE_URL' && !key.endsWith('_DATABASE_URL')) continue;
      const url = new URL(value);
      if (![...url.searchParams.keys()].every(key => ['host', 'port'].includes(key))) fail('ROLLBACK_API_PROBE_INVALID');
      url.hostname = '127.0.0.1';
      url.port = String(database.port);
      url.pathname = '/' + database.database;
      url.search = '';
      if (database.host.startsWith('/')) {
        url.searchParams.set('host', database.host);
        url.searchParams.set('port', String(database.port));
      } else if (database.host !== '127.0.0.1' && database.host !== 'localhost') fail('ROLLBACK_API_PROBE_INVALID');
      probeEnvironment[key] = url.href;
    }
    const child = execute(process.execPath, ['--input-type=module', '--eval', ROLLBACK_SERVER_PROBE], {
      input: JSON.stringify({ releaseRoot: release.root, version: release.version, environment: probeEnvironment,
        queryMode: queryProfile.mode, origin: 'http://127.0.0.1:' + port }),
      encoding: 'utf8', timeout: 45000, maxBuffer: 65536,
      env: { PATH: process.env.PATH, NODE_OPTIONS: '', PGOPTIONS: '-c default_transaction_read_only=on' },
      stdio: ['pipe', 'ignore', 'ignore', 'pipe'],
    });
    if (child.error || child.signal || child.status !== 0) fail('ROLLBACK_API_PROCESS_FAILED');
    const output = JSON.parse(child.output[3]);
    if (!output || !['PASS', 'FAIL'].includes(output.status)
      || output.status === 'PASS' && output.code !== null) fail('ROLLBACK_API_PROCESS_FAILED');
    if (output.status === 'PASS' && !hasRollbackProtocolCapabilities(output, queryProfile.mode)) {
      fail('ROLLBACK_PROTOCOL_INCOMPATIBLE');
    }
    result = output;
  } catch (error) {
    result = { status: 'FAIL', code: error instanceof ReleaseProofError ? error.code : 'ROLLBACK_API_RUNTIME_FAILED' };
  } finally {
    try { if (scratch) rmSync(scratch, { recursive: true, force: true }); }
    catch { result = { status: 'FAIL', code: 'ROLLBACK_API_CLEANUP_FAILED' }; }
  }
  return { ...result, scope: ROLLBACK_RUNTIME_SCOPE, migrationCount,
    applicationGitSha: release?.gitSha, runtimeBuildSha256: release?.runtimeBuildSha256, version: release?.version,
    configurationSha256: queryProfile?.configurationSha256, apiEnvSha256: queryProfile?.apiEnvSha256 };
}
