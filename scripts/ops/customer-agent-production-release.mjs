#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  chmodSync,
  chownSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseStackProfile } from '../synthetic-stack/profile.ts';
import { readCandidateRelease, readRuntimeContentFingerprint } from './backup-set.mjs';
import {
  collectSnapshot,
  evaluateSnapshot,
  REPORT_SCHEMA as TENANT_REPORT_SCHEMA,
} from './production-intake-tenancy.mjs';

const DEFAULT_ROOT = '/srv/customer-agent';
const DEFAULT_UNIT = 'customer-agent-stack.service';
const MANIFEST = 'packages/database/migrations/manifest.generated.json';
const STACK_ENTRY = 'scripts/synthetic-stack/stack.ts';
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;
const UNIT_PATTERN = /^[A-Za-z0-9_.@-]+\.service$/u;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 5_000;
const READY_ATTEMPTS = 30;
const READY_INTERVAL_MS = 2_000;
const DEPLOYMENT_STATE_SCHEMA = 'customer-agent-production-release-state/v1';
const READY_CHECKS = Object.freeze(['auth', 'content', 'database', 'schema', 'storage']);
const EVIDENCE_DIRECTORY = 'release-evidence';

export class ProductionReleaseError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'ProductionReleaseError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new ProductionReleaseError(code, message, cause === undefined ? {} : { cause });
}

function readRegularFile(file, maxBytes, code) {
  let info;
  try {
    info = lstatSync(file);
  } catch {
    fail(code, 'required file is missing');
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maxBytes) {
    fail(code, 'required file is not a bounded regular file');
  }
  try {
    return readFileSync(file);
  } catch {
    fail(code, 'required file is unreadable');
  }
}

function readJson(file, code) {
  const bytes = readRegularFile(file, MAX_JSON_BYTES, code);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(code, 'required JSON is invalid');
  }
}

function canonicalDirectory(candidate, code) {
  let info;
  try {
    info = lstatSync(candidate);
  } catch {
    fail(code, 'required directory is missing');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail(code, 'required directory is not a regular directory');
  }
  try {
    return realpathSync(candidate);
  } catch {
    fail(code, 'required directory is unreadable');
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fsyncDirectory(directory) {
  const descriptor = openSync(directory, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeAll(descriptor, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    offset += writeSync(descriptor, bytes, offset, bytes.length - offset);
  }
}

function readManifest(releaseRoot) {
  const raw = readJson(path.join(releaseRoot, MANIFEST), 'RELEASE_MANIFEST_INVALID');
  if (!raw || !Array.isArray(raw.migrations) || raw.migrations.length < 1) {
    fail('RELEASE_MANIFEST_INVALID', 'release migration manifest is empty');
  }
  const seen = new Set();
  const migrations = raw.migrations.map((migration) => {
    if (!migration || !Number.isSafeInteger(migration.position) || migration.position < 1
      || typeof migration.id !== 'string' || migration.id.length < 1
      || typeof migration.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(migration.sha256)
      || typeof migration.contract_set_id !== 'string'
      || typeof migration.source_git_sha !== 'string' || !SHA_PATTERN.test(migration.source_git_sha)
      || typeof migration.source_schema_sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(migration.source_schema_sha256)
      || seen.has(migration.position)) {
      fail('RELEASE_MANIFEST_INVALID', 'release migration row is invalid');
    }
    seen.add(migration.position);
    return Object.freeze({
      position: migration.position,
      id: migration.id,
      sha256: migration.sha256,
      contractSetId: migration.contract_set_id,
      sourceGitSha: migration.source_git_sha,
      sourceSchemaSha256: migration.source_schema_sha256,
    });
  });
  migrations.sort((left, right) => left.position - right.position);
  for (let index = 0; index < migrations.length; index += 1) {
    if (migrations[index].position !== index + 1) {
      fail('RELEASE_MANIFEST_INVALID', 'release migration positions are not contiguous');
    }
  }
  return Object.freeze(migrations);
}

function gitEnvironment(releaseRoot) {
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'safe.directory',
    GIT_CONFIG_VALUE_0: releaseRoot,
    GIT_OPTIONAL_LOCKS: '0',
  };
  return env;
}

function releaseGitState(releaseRoot, requireClean) {
  const env = gitEnvironment(releaseRoot);
  let sha;
  let status;
  try {
    sha = execFileSync('git', ['-C', releaseRoot, 'rev-parse', '--verify', 'HEAD^{commit}'], {
      encoding: 'utf8',
      env,
      timeout: 15_000,
    }).trim();
    status = execFileSync('git', ['-C', releaseRoot, 'status', '--porcelain=v1', '--untracked-files=all'], {
      encoding: 'utf8',
      env,
      timeout: 15_000,
    });
  } catch (error) {
    fail('RELEASE_GIT_INVALID', 'release Git identity is unreadable', error);
  }
  if (!SHA_PATTERN.test(sha) || path.basename(releaseRoot) !== sha) {
    fail('RELEASE_GIT_INVALID', 'release directory does not match its full Git SHA');
  }
  if (requireClean && status.length > 0) {
    fail('RELEASE_DIRTY', 'candidate release has tracked working-tree changes');
  }
  return Object.freeze({ sha, clean: status.length === 0 });
}

function releaseVersion(releaseRoot) {
  const rootVersion = readRegularFile(path.join(releaseRoot, 'VERSION'), 128, 'RELEASE_VERSION_INVALID')
    .toString('utf8').trim();
  const desktop = readJson(path.join(releaseRoot, 'apps/desktop/package.json'), 'RELEASE_VERSION_INVALID');
  if (!VERSION_PATTERN.test(rootVersion) || desktop?.version !== rootVersion) {
    fail('RELEASE_VERSION_INVALID', 'release version files do not agree');
  }
  return rootVersion;
}

function releaseEntryReady(releaseRoot) {
  let info;
  try {
    info = lstatSync(path.join(releaseRoot, STACK_ENTRY));
  } catch {
    fail('RELEASE_ENTRY_MISSING', 'release stack entry is missing');
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    fail('RELEASE_ENTRY_INVALID', 'release stack entry is not a regular file');
  }
}

function readRelease(root, sha, expectedVersion, requireClean) {
  const releasesRoot = canonicalDirectory(path.join(root, 'releases'), 'RELEASE_ROOT_INVALID');
  const requested = path.join(releasesRoot, sha);
  const releaseRoot = canonicalDirectory(requested, 'RELEASE_INVALID');
  if (releaseRoot !== requested) fail('RELEASE_INVALID', 'release directory escapes releases root');
  const git = releaseGitState(releaseRoot, requireClean);
  if (git.sha !== sha) fail('RELEASE_GIT_INVALID', 'release Git SHA does not match request');
  const version = releaseVersion(releaseRoot);
  if (expectedVersion !== null && version !== expectedVersion) {
    fail('RELEASE_VERSION_MISMATCH', 'release version does not match expected version');
  }
  releaseEntryReady(releaseRoot);
  const verifiedBuild = readCandidateRelease(releaseRoot, { verifyRuntime: requireClean });
  if (verifiedBuild.gitSha !== sha || verifiedBuild.version !== version) {
    fail('RELEASE_BUILD_INVALID', 'candidate database build is not bound to the release identity');
  }
  return Object.freeze({
    root: releaseRoot,
    sha,
    version,
    git,
    manifest: readManifest(releaseRoot),
    runtimeBuildSha256: verifiedBuild.runtimeBuildSha256,
  });
}

function readCurrent(root) {
  const current = path.join(root, 'current');
  let targetText;
  let info;
  try {
    info = lstatSync(current);
    targetText = readlinkSync(current);
  } catch {
    fail('CURRENT_INVALID', 'current release symlink is missing');
  }
  if (!info.isSymbolicLink() || targetText.includes('\0') || targetText.includes('\n') || targetText.includes('\r')) {
    fail('CURRENT_INVALID', 'current release pointer is invalid');
  }
  let releaseRoot;
  try {
    releaseRoot = realpathSync(path.resolve(path.dirname(current), targetText));
  } catch {
    fail('CURRENT_INVALID', 'current release target is missing');
  }
  const releasesRoot = canonicalDirectory(path.join(root, 'releases'), 'RELEASE_ROOT_INVALID');
  if (!releaseRoot.startsWith(`${releasesRoot}${path.sep}`)) {
    fail('CURRENT_INVALID', 'current release target escapes releases root');
  }
  const git = releaseGitState(releaseRoot, false);
  return Object.freeze({
    root: releaseRoot,
    sha: git.sha,
    version: releaseVersion(releaseRoot),
    targetText,
    git,
    manifest: readManifest(releaseRoot),
  });
}

function validatePrefix(current, next) {
  if (next.length < current.length) {
    fail('MIGRATION_NOT_FORWARD', 'candidate release is behind the current migration catalogue');
  }
  for (let index = 0; index < current.length; index += 1) {
    const left = current[index];
    const right = next[index];
    if (left.position !== right.position || left.id !== right.id || left.sha256 !== right.sha256
      || left.contractSetId !== right.contractSetId || left.sourceGitSha !== right.sourceGitSha
      || left.sourceSchemaSha256 !== right.sourceSchemaSha256) {
      fail('MIGRATION_PREFIX_MISMATCH', 'current and candidate migration catalogues diverge');
    }
  }
}

function validateSameCatalogue(current, next) {
  if (current.length !== next.length) {
    fail('MIGRATION_PREFIX_MISMATCH', 'current release pointer does not match its migration catalogue');
  }
  for (let index = 0; index < current.length; index += 1) {
    const left = current[index];
    const right = next[index];
    if (left.position !== right.position || left.id !== right.id || left.sha256 !== right.sha256
      || left.contractSetId !== right.contractSetId || left.sourceGitSha !== right.sourceGitSha
      || left.sourceSchemaSha256 !== right.sourceSchemaSha256) {
      fail('MIGRATION_PREFIX_MISMATCH', 'release pointer does not point at the candidate catalogue');
    }
  }
}

function readBackupEvidence(file, next) {
  const evidence = readJson(path.resolve(file), 'BACKUP_EVIDENCE_INVALID');
  const restoredAt = Date.parse(evidence?.restoreCompletedAt);
  const restorePassed = evidence?.status === 'PASS'
    || (evidence?.status === 'FAIL' && evidence.errorCode === 'RELEASE_PREFLIGHT_FAILED');
  if (!restorePassed || evidence.verifierStatus !== 'PASS'
    || evidence.metadataAndObjectFidelity !== 'PASS' || evidence.scratchCleaned !== true
    || typeof evidence.backupId !== 'string' || evidence.backupId.length < 1
    || !Number.isFinite(restoredAt)
    || restoredAt > Date.now() + 5 * 60_000
    || evidence.candidateGitSha !== next.sha || evidence.candidateVersion !== next.version
    || !Number.isSafeInteger(evidence.migrationCount) || evidence.migrationCount !== next.manifest.length) {
    fail('BACKUP_EVIDENCE_INVALID', 'backup restore evidence does not cover this candidate');
  }
  return Object.freeze({
    path: path.resolve(file),
    backupId: evidence.backupId,
    snapshotAt: evidence.backupSnapshotAt,
    restoredAt: evidence.restoreCompletedAt,
    migrationCount: evidence.migrationCount,
    deploymentChecks: evidence.deploymentChecks,
  });
}

export function assertQueryProfileBinding(runtime, queryProfile) {
  const scope = queryProfile?.mode === 'intake-compat'
    ? 'candidate-intake-catalog-readonly-gates' : 'candidate-query-runtime-readonly-initialization';
  if (!queryProfile || !['unified', 'intake-compat'].includes(queryProfile.mode)
    || !/^[0-9a-f]{64}$/u.test(queryProfile.configurationSha256)
    || runtime?.scope !== scope || runtime?.queryMode !== queryProfile.mode
    || runtime?.configurationSha256 !== queryProfile.configurationSha256) {
    fail('RELEASE_QUERY_PROFILE_CHANGED', 'candidate query configuration differs from restore evidence');
  }
}

function assertQueryProfileEvidence(checks, queryProfile) {
  if (checks?.schema === 'customer-agent-release-preflight/v2') {
    assertQueryProfileBinding(checks.runtime, queryProfile);
  } else if (queryProfile?.mode === 'intake-compat') {
    fail('RELEASE_QUERY_PROFILE_REQUIRED', 'intake compatibility requires mode-bound restore evidence');
  }
}

export function assertDeploymentChecks(checks, previous, next, contentFingerprint, queryProfile) {
  if (!checks || !['customer-agent-release-preflight/v1', 'customer-agent-release-preflight/v2'].includes(checks.schema)
    || checks.candidateGitSha !== next.sha || checks.rollbackGitSha !== previous.sha
    || !checks.runtime || !Array.isArray(checks.rollback)
    || checks.rollback.length !== next.manifest.length - previous.manifest.length + 1) {
    fail('RELEASE_PREFLIGHT_REQUIRED', 'restore evidence must cover this candidate and rollback release');
  }
  assertQueryProfileEvidence(checks, queryProfile);
  if (checks.runtime.status !== 'PASS' || checks.runtime.code !== null) {
    fail('CANDIDATE_RUNTIME_NOT_READY', 'candidate runtime did not accept the restored content');
  }
  if (typeof checks.runtimeBuildSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(checks.runtimeBuildSha256)
    || checks.runtimeBuildSha256 !== next.runtimeBuildSha256) {
    fail('RELEASE_RUNTIME_BUILD_CHANGED', 'candidate runtime build differs from the preflight artifact');
  }
  if (checks.rollback.some((check, index) => !check
    || check.migrationCount !== previous.manifest.length + index
    || check.status !== 'PASS' || check.code !== null)) {
    fail('ROLLBACK_INCOMPATIBLE', 'rollback release cannot read every committed migration prefix');
  }
  if (checks.status !== 'PASS') fail('RELEASE_PREFLIGHT_REQUIRED', 'release preflight did not pass');
  if (typeof checks.contentFingerprint !== 'string' || !/^[0-9a-f]{64}$/u.test(checks.contentFingerprint)
    || checks.contentFingerprint !== contentFingerprint) {
    fail('RELEASE_PREFLIGHT_STALE', 'current content identity changed after the restore preflight');
  }
}

function readTenantReport(file) {
  const report = readJson(path.resolve(file), 'TENANT_REPORT_INVALID');
  if (!report || report.schema !== TENANT_REPORT_SCHEMA || report.ok !== true
    || report.status !== 'ready' || !Array.isArray(report.blockers) || report.blockers.length !== 0
    || !Number.isSafeInteger(report.activeBatchCount) || report.activeBatchCount < 0
    || !Number.isSafeInteger(report.historicalDefaultBatchCount) || report.historicalDefaultBatchCount < 0) {
    fail('TENANT_REPORT_INVALID', 'tenant preflight did not report ready');
  }
  return Object.freeze({
    path: path.resolve(file),
    schema: report.schema,
    ok: report.ok,
    status: report.status,
    blockers: Object.freeze([...report.blockers]),
    activeBatchCount: report.activeBatchCount,
    historicalDefaultBatchCount: report.historicalDefaultBatchCount,
  });
}

function assertTenantReportMatches(expected, live) {
  if (!live || live.schema !== expected.schema || live.ok !== true || live.status !== 'ready'
    || live.activeBatchCount !== expected.activeBatchCount
    || live.historicalDefaultBatchCount !== expected.historicalDefaultBatchCount
    || live.blockers.length !== 0) {
    fail('TENANT_REPORT_STALE', 'tenant report does not match the current database');
  }
}

function readProfile(stackRoot, environment) {
  const canonicalRoot = canonicalDirectory(stackRoot, 'STACK_PROFILE_INVALID');
  const profilePath = path.join(canonicalRoot, 'profile.json');
  const rawText = readRegularFile(profilePath, 256 * 1024, 'STACK_PROFILE_INVALID').toString('utf8');
  let raw;
  try {
    raw = JSON.parse(rawText);
  } catch {
    fail('STACK_PROFILE_INVALID', 'stack profile is invalid JSON');
  }
  let profile;
  try {
    profile = parseStackProfile(raw, canonicalRoot, profilePath);
  } catch {
    fail('STACK_PROFILE_INVALID', 'stack profile is not a valid production profile');
  }
  if (profile.stackRoot !== canonicalRoot
    || (environment === 'production'
      && (profile.environment !== 'production' || profile.databaseName !== 'customer_agent_formal'))
    || (environment === 'test'
      && (profile.environment === 'production' || profile.databaseName === 'customer_agent_formal'))) {
    fail('STACK_PROFILE_INVALID', 'stack profile does not match the requested environment');
  }
  return Object.freeze({
    root: canonicalRoot,
    databaseName: profile.databaseName,
    socket: profile.pgSocketDirectory,
    port: profile.pgPort,
    apiOrigin: profile.apiOrigin,
  });
}

export function parseOptions(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv[0] === '--' ? argv.slice(1) : argv,
      allowPositionals: false,
      options: {
        apply: { type: 'boolean', default: false },
        root: { type: 'string' },
        'stack-root': { type: 'string' },
        sha: { type: 'string' },
        'expected-version': { type: 'string' },
        'backup-evidence': { type: 'string' },
        'tenant-report': { type: 'string' },
        unit: { type: 'string', default: DEFAULT_UNIT },
        environment: { type: 'string', default: 'production' },
        authorization: { type: 'string' },
        'audit-file': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
    });
  } catch {
    fail('INVALID_ARGUMENTS', 'arguments are invalid');
  }
  if (parsed.values.help) return Object.freeze({ help: true });
  const rootText = parsed.values.root ?? DEFAULT_ROOT;
  const root = path.resolve(rootText);
  const stackRoot = path.resolve(parsed.values['stack-root'] ?? path.join(root, 'stack'));
  const sha = parsed.values.sha;
  const expectedVersion = parsed.values['expected-version'];
  const backupEvidence = parsed.values['backup-evidence'];
  const tenantReport = parsed.values['tenant-report'];
  const unit = parsed.values.unit;
  const environment = parsed.values.environment;
  const authorization = parsed.values.authorization ?? process.env.CUSTOMER_AGENT_PRODUCTION_RELEASE_APPROVAL;
  if (!path.isAbsolute(rootText) || !path.isAbsolute(stackRoot)
    || typeof sha !== 'string' || !SHA_PATTERN.test(sha)
    || typeof expectedVersion !== 'string' || !VERSION_PATTERN.test(expectedVersion)
    || typeof backupEvidence !== 'string' || !path.isAbsolute(backupEvidence)
    || typeof tenantReport !== 'string' || !path.isAbsolute(tenantReport)
    || typeof unit !== 'string' || !UNIT_PATTERN.test(unit)
    || !['production', 'test'].includes(environment)
    || (authorization !== undefined && typeof authorization !== 'string')) {
    fail('INVALID_ARGUMENTS', 'apply requires absolute paths, a full SHA, a semantic version and a service unit');
  }
  if (environment === 'production' && root !== DEFAULT_ROOT) {
    fail('INVALID_ARGUMENTS', 'production release root must be /srv/customer-agent');
  }
  if (environment === 'production' && stackRoot !== path.join(DEFAULT_ROOT, 'stack')) {
    fail('INVALID_ARGUMENTS', 'production stack root must be /srv/customer-agent/stack');
  }
  if (environment === 'production' && unit !== DEFAULT_UNIT) {
    fail('INVALID_ARGUMENTS', 'production service unit must be customer-agent-stack.service');
  }
  if (environment === 'test' && (root === DEFAULT_ROOT || stackRoot === path.join(DEFAULT_ROOT, 'stack'))) {
    fail('INVALID_ARGUMENTS', 'test release must not use the production root or stack');
  }
  if (environment === 'test' && unit === DEFAULT_UNIT) {
    fail('INVALID_ARGUMENTS', 'test release must use a separate service unit');
  }
  if (environment === 'production' && parsed.values.apply && authorization !== sha) {
    fail('RELEASE_NOT_AUTHORIZED', 'apply requires authorization equal to the candidate SHA');
  }
  const auditFile = path.resolve(
    parsed.values['audit-file'] ?? path.join(root, EVIDENCE_DIRECTORY, 'production-release.jsonl'),
  );
  const auditRelative = path.relative(root, auditFile);
  if (auditRelative.startsWith('..') || path.isAbsolute(auditRelative)) {
    fail('INVALID_ARGUMENTS', 'audit file must stay inside the release root');
  }
  return Object.freeze({
    help: false,
    apply: parsed.values.apply,
    root,
    stackRoot,
    sha,
    expectedVersion,
    backupEvidence,
    tenantReport,
    unit,
    environment,
    auditFile,
    stateFile: path.join(path.dirname(auditFile), 'deployment-state.json'),
  });
}

function atomicWrite(file, bytes, mode = 0o600, owner = undefined) {
  const temporary = `${file}.next-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temporary, bytes, { mode, flag: 'wx' });
    chmodSync(temporary, mode);
    if (owner && process.getuid?.() === 0) chownSync(temporary, owner.uid, owner.gid);
    const descriptor = openSync(temporary, 'r');
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, file);
    fsyncDirectory(path.dirname(file));
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function appendAudit(file, entry) {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = lstatSync(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    fail('AUDIT_FILE_INVALID', 'audit directory must be a regular directory');
  }
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) {
      fail('AUDIT_FILE_INVALID', 'audit file must be a regular file');
    }
  } catch (error) {
    if (error instanceof ProductionReleaseError) throw error;
    if (error?.code !== 'ENOENT') fail('AUDIT_FILE_INVALID', 'audit file is unreadable');
  }
  const descriptor = openSync(file, 'a', 0o600);
  try {
    writeAll(descriptor, Buffer.from(`${JSON.stringify(entry)}\n`));
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(file, 0o600);
}

export function acquireDeploymentLock(lockFile) {
  mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const content = `${JSON.stringify({ pid: process.pid, host: os.hostname(), token, startedAt: new Date().toISOString() })}\n`;
  let descriptor;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      descriptor = openSync(lockFile, 'wx', 0o600);
      writeAll(descriptor, Buffer.from(content));
      fsyncSync(descriptor);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        fail('DEPLOYMENT_LOCK_FAILED', 'deployment lock cannot be created', error);
      }
      if (attempt > 0) fail('DEPLOYMENT_LOCKED', 'another deployment holds the lock');
      let stale;
      try {
        const info = lstatSync(lockFile);
        if (!info.isFile() || info.isSymbolicLink()) fail('DEPLOYMENT_LOCKED', 'deployment lock is unsafe');
        stale = JSON.parse(readFileSync(lockFile, 'utf8'));
      } catch (readError) {
        if (readError instanceof ProductionReleaseError) throw readError;
        fail('DEPLOYMENT_LOCKED', 'deployment lock is unreadable');
      }
      if (stale?.host !== os.hostname() || !Number.isSafeInteger(stale?.pid) || stale.pid < 1) {
        fail('DEPLOYMENT_LOCKED', 'another deployment holds the lock');
      }
      try {
        process.kill(stale.pid, 0);
        fail('DEPLOYMENT_LOCKED', 'another deployment holds the lock');
      } catch (aliveError) {
        if (aliveError instanceof ProductionReleaseError) throw aliveError;
        if (aliveError?.code !== 'ESRCH') {
          fail('DEPLOYMENT_LOCKED', 'deployment lock owner state is unknown');
        }
      }
      const recoveryFile = `${lockFile}.recovery`;
      let recoveryDescriptor;
      try {
        recoveryDescriptor = openSync(recoveryFile, 'wx', 0o600);
        writeAll(recoveryDescriptor, Buffer.from(`${JSON.stringify({ pid: process.pid, token })}\n`));
        fsyncSync(recoveryDescriptor);
        const current = JSON.parse(readFileSync(lockFile, 'utf8'));
        if (current?.token !== stale.token) {
          fail('DEPLOYMENT_LOCKED', 'stale deployment lock changed during recovery');
        }
        unlinkSync(lockFile);
        fsyncDirectory(path.dirname(lockFile));
      } catch (recoveryError) {
        if (recoveryError instanceof ProductionReleaseError) throw recoveryError;
        fail('DEPLOYMENT_LOCKED', 'stale deployment lock changed during recovery');
      } finally {
        if (recoveryDescriptor !== undefined) closeSync(recoveryDescriptor);
        try { unlinkSync(recoveryFile); } catch { /* Preserve the primary lock result. */ }
      }
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
  chmodSync(lockFile, 0o600);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      const current = JSON.parse(readFileSync(lockFile, 'utf8'));
      if (current?.token === token) unlinkSync(lockFile);
    } catch {
      // A missing or replaced lock is not this process's state to remove.
    }
  };
}

function switchCurrent(root, releaseRoot) {
  const link = path.join(root, 'current');
  const temporary = `${link}.next-${process.pid}-${randomUUID()}`;
  try {
    symlinkSync(releaseRoot, temporary);
    renameSync(temporary, link);
    fsyncDirectory(root);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function restoreCurrent(root, previousTargetText) {
  const link = path.join(root, 'current');
  const temporary = `${link}.rollback-${process.pid}-${randomUUID()}`;
  try {
    symlinkSync(previousTargetText, temporary);
    renameSync(temporary, link);
    fsyncDirectory(root);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function parseApiVersion(bytes) {
  const text = bytes.toString('utf8');
  const matches = [...text.matchAll(/^CUSTOMER_AGENT_BUILD_VERSION=([^\r\n]*)$/gmu)];
  if (matches.length !== 1) fail('API_ENV_INVALID', 'api.env must contain one build version');
  const version = matches[0][1];
  if (!VERSION_PATTERN.test(version)) fail('API_ENV_INVALID', 'api.env build version is invalid');
  return Object.freeze({ text, version });
}

function readApiVersion(stackRoot) {
  const file = path.join(stackRoot, 'api.env');
  let info;
  try {
    info = lstatSync(file);
  } catch {
    fail('API_ENV_INVALID', 'api.env is missing');
  }
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o600) {
    fail('API_ENV_INVALID', 'api.env must be a 0600 regular file');
  }
  const bytes = readRegularFile(file, MAX_JSON_BYTES, 'API_ENV_INVALID');
  return Object.freeze({ file, info, bytes, ...parseApiVersion(bytes) });
}

function backupApiVersion(stackRoot, evidenceDirectory) {
  const apiEnv = readApiVersion(stackRoot);
  mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 });
  const evidenceInfo = lstatSync(evidenceDirectory);
  if (!evidenceInfo.isDirectory() || evidenceInfo.isSymbolicLink()) {
    fail('API_ENV_BACKUP_INVALID', 'release evidence directory is unsafe');
  }
  const backup = path.join(evidenceDirectory, `api.env.pre-${process.pid}-${randomUUID()}`);
  atomicWrite(backup, apiEnv.bytes);
  return Object.freeze({
    file: apiEnv.file,
    backup,
    sha256: sha256(apiEnv.bytes),
    version: apiEnv.version,
  });
}

function writeApiVersion(stackRoot, version) {
  const apiEnv = readApiVersion(stackRoot);
  const nextText = apiEnv.text.replace(
    /^CUSTOMER_AGENT_BUILD_VERSION=.*$/mu,
    `CUSTOMER_AGENT_BUILD_VERSION=${version}`,
  );
  if (nextText === apiEnv.text) {
    return Object.freeze({ file: apiEnv.file, version, changed: false });
  }
  atomicWrite(apiEnv.file, nextText, 0o600, apiEnv.info);
  return Object.freeze({ file: apiEnv.file, version, changed: true });
}

function readApiVersionBackup(stackRoot, reference) {
  if (!reference || typeof reference.path !== 'string' || !path.isAbsolute(reference.path)
    || typeof reference.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(reference.sha256)
    || typeof reference.version !== 'string' || !VERSION_PATTERN.test(reference.version)) {
    fail('API_ENV_BACKUP_INVALID', 'api.env backup reference is invalid');
  }
  const file = path.join(stackRoot, 'api.env');
  let info;
  try {
    info = lstatSync(file);
  } catch {
    fail('API_ENV_INVALID', 'api.env is missing');
  }
  if (!info.isFile() || info.isSymbolicLink()) fail('API_ENV_INVALID', 'api.env must remain a regular file');
  const bytes = readRegularFile(reference.path, MAX_JSON_BYTES, 'API_ENV_BACKUP_INVALID');
  let backupInfo;
  try {
    backupInfo = lstatSync(reference.path);
  } catch {
    fail('API_ENV_BACKUP_INVALID', 'api.env backup is missing');
  }
  if ((backupInfo.mode & 0o777) !== 0o600 || sha256(bytes) !== reference.sha256) {
    fail('API_ENV_BACKUP_INVALID', 'api.env backup changed');
  }
  if (parseApiVersion(bytes).version !== reference.version) {
    fail('API_ENV_BACKUP_INVALID', 'api.env backup version changed');
  }
  return Object.freeze({ file, backup: reference.path, bytes, version: reference.version });
}

function restoreApiVersion(backup) {
  const owner = lstatSync(backup.file);
  atomicWrite(backup.file, backup.bytes, 0o600, owner);
}

function readDeploymentState(file) {
  let info;
  try {
    info = lstatSync(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail('DEPLOYMENT_STATE_INVALID', 'deployment state is unreadable');
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    fail('DEPLOYMENT_STATE_INVALID', 'deployment state is not a regular file');
  }
  if ((info.mode & 0o777) !== 0o600) {
    fail('DEPLOYMENT_STATE_INVALID', 'deployment state must be 0600');
  }
  const state = readJson(file, 'DEPLOYMENT_STATE_INVALID');
  if (!state || state.schema !== DEPLOYMENT_STATE_SCHEMA
    || !['deploying', 'rolling_back', 'complete', 'rolled_back'].includes(state.status)
    || !SHA_PATTERN.test(state.candidateSha) || !VERSION_PATTERN.test(state.candidateVersion)
    || !SHA_PATTERN.test(state.previousSha) || !VERSION_PATTERN.test(state.previousVersion)
    || typeof state.previousTargetText !== 'string'
    || state.previousTargetText.includes('\0') || state.previousTargetText.includes('\n')
    || state.previousTargetText.includes('\r')
    || typeof state.backupId !== 'string' || state.backupId.length < 1
    || typeof state.pointerSwitched !== 'boolean'
    || typeof state.serviceStageReached !== 'boolean'
    || (state.apiEnvBackup !== null && (
      !state.apiEnvBackup || typeof state.apiEnvBackup !== 'object'
      || typeof state.apiEnvBackup.path !== 'string'
      || typeof state.apiEnvBackup.sha256 !== 'string'
      || typeof state.apiEnvBackup.version !== 'string'
    ))) {
    fail('DEPLOYMENT_STATE_INVALID', 'deployment state shape is invalid');
  }
  return Object.freeze(state);
}

function writeDeploymentState(file, state) {
  atomicWrite(file, `${JSON.stringify(state, null, 2)}\n`);
}

async function readResponseSnapshot(url) {
  let response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!response.ok || !response.body) {
    try { await response.body?.cancel(); } catch { /* Preserve the readiness failure. */ }
    return null;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    return null;
  }
  try {
    return { body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      queryMode: response.headers.get('x-customer-agent-query-mode') };
  } catch {
    return null;
  }
}

export function readinessMatches(health, ready, expectedVersion, expectedQueryMode, actualQueryMode, allowLegacyMode = false) {
  const checks = ready?.checks;
  return health?.status === 'ok' && health?.service === 'cs-ai-api' && health?.version === expectedVersion
    && ready?.status === 'ready' && checks && typeof checks === 'object'
    && Object.keys(checks).sort().join('\0') === [...READY_CHECKS].sort().join('\0')
    && READY_CHECKS.every((name) => checks[name] === 'ok')
    && (expectedQueryMode === undefined || actualQueryMode === expectedQueryMode
      || allowLegacyMode && expectedQueryMode === 'unified' && actualQueryMode === null);
}

async function waitForReady(apiOrigin, expectedVersion, assertActive = () => undefined, expectedQueryMode, allowLegacyMode = false) {
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    assertActive();
    const [health, ready] = await Promise.all([
      readResponseSnapshot(`${apiOrigin}/health`),
      readResponseSnapshot(`${apiOrigin}/ready`),
    ]);
    if (readinessMatches(health?.body, ready?.body, expectedVersion, expectedQueryMode, ready?.queryMode, allowLegacyMode)) return;
    if (attempt + 1 < READY_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, READY_INTERVAL_MS));
    }
  }
  fail('READINESS_FAILED', 'service did not become ready at the expected version');
}

async function inspectLiveTenancy(profile) {
  const client = new pg.Client({
    host: profile.socket,
    port: profile.port,
    database: profile.databaseName,
    user: 'stack_owner',
    application_name: 'customer-agent-production-release-tenancy',
    connectionTimeoutMillis: 15_000,
  });
  try {
    await client.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      return evaluateSnapshot(await collectSnapshot(client));
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof ProductionReleaseError) throw error;
    fail('TENANT_CHECK_FAILED', 'live tenant preflight failed', error);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function withDatabase(profile, release, work) {
  let database;
  try {
    database = await import(pathToFileURL(path.join(release.root, 'packages/database/dist/index.js')).href);
  } catch (error) {
    fail('DATABASE_MODULE_INVALID', 'candidate database module is unreadable', error);
  }
  const requireFromCandidate = createRequire(path.join(release.root, 'packages/database/package.json'));
  const candidatePg = requireFromCandidate('pg');
  const CandidateClient = candidatePg.Client ?? candidatePg.default?.Client;
  if (typeof CandidateClient !== 'function') {
    fail('DATABASE_MODULE_INVALID', 'candidate pg client is unavailable');
  }
  const client = new CandidateClient({
    host: profile.socket,
    port: profile.port,
    database: profile.databaseName,
    user: 'stack_owner',
    application_name: 'customer-agent-production-release',
    connectionTimeoutMillis: 15_000,
  });
  try {
    await client.connect();
    return await work(database, client);
  } catch (error) {
    if (error instanceof ProductionReleaseError) throw error;
    fail('DATABASE_OPERATION_FAILED', 'database operation failed', error);
  } finally {
    await client.end().catch(() => undefined);
  }
}

function migrationIds(status) {
  if (!status || !Array.isArray(status.applied)) {
    fail('DATABASE_MIGRATION_STATE_INVALID', 'database migration state is unreadable');
  }
  return Object.freeze(status.applied.map((migration) => migration.id));
}

function sameIds(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value) {
  return JSON.stringify(value);
}

export function assertMigrationCompletion(databaseIds, nextIds, migration) {
  if (!migration || migration.verifierStatus !== 'PASS'
    || !Array.isArray(migration.finalIds) || !Array.isArray(migration.appliedIds)
    || !sameIds(migration.finalIds, nextIds)
    || !sameIds(migration.appliedIds, nextIds.slice(databaseIds.length))) {
    fail('DATABASE_MIGRATION_APPLY_INVALID', 'database did not reach the verified candidate catalogue');
  }
}

/** Holds the existing publication locks until the caller closes this database session. */
export async function lockDeploymentContent(client, contentFingerprint) {
  await client.query(`SET lock_timeout = '${PROBE_TIMEOUT_MS}ms'`);
  await client.query('SELECT pg_advisory_lock(724019, 1)');
  await client.query('SELECT pg_advisory_lock(724019, 19)');
  await client.query("SELECT pg_advisory_lock(hashtext('cs_ai_content_publish'))");
  if (await readRuntimeContentFingerprint(client) !== contentFingerprint) {
    fail('RELEASE_PREFLIGHT_STALE', 'content changed before migration admission');
  }
}

function defaultDependencies(options) {
  assertApplyPrivilege(options.apply);
  return Object.freeze({
    readCurrent: async () => readCurrent(options.root),
    readNext: async () => readRelease(options.root, options.sha, options.expectedVersion, true),
    readEvidence: async (next) => readBackupEvidence(options.backupEvidence, next),
    readTenantReport: async () => readTenantReport(options.tenantReport),
    readProfile: async () => readProfile(options.stackRoot, options.environment),
    readQueryProfile: async (profile, next) => {
      const { readReleaseQueryProfile } = await import('./release-query-profile.mjs');
      return readReleaseQueryProfile(next.root, profile.root);
    },
    readState: async () => readDeploymentState(options.stateFile),
    writeState: async (state) => writeDeploymentState(options.stateFile, state),
    readHistoricalRelease: async (sha, version) => readRelease(options.root, sha, version, false),
    audit: async (entry) => {
      if (options.apply) appendAudit(options.auditFile, entry);
    },
    lock: async () => {
      const canonicalRoot = canonicalDirectory(options.root, 'RELEASE_ROOT_INVALID');
      if (canonicalRoot !== options.root) fail('RELEASE_ROOT_INVALID', 'release root must not be a symbolic path');
      return acquireDeploymentLock(path.join(canonicalRoot, 'deploy.lock'));
    },
    inspectDatabase: async (profile, next) => withDatabase(profile, next, async (database, client) => (
      migrationIds(await database.inspectDatabaseMigrations(client))
    )),
    inspectContentFingerprint: async (profile, next) => withDatabase(profile, next, (_database, client) => (
      readRuntimeContentFingerprint(client)
    )),
    verifyRollbackDatabase: async (profile, previous) => withDatabase(profile, previous, async (database, client) => {
      await database.inspectDatabaseMigrations(client);
      const verification = await database.verifyDatabaseMigrations(client);
      if (verification.status !== 'PASS') fail('ROLLBACK_DATABASE_INCOMPATIBLE', 'rollback database verification failed');
    }),
    inspectTenancy: async (profile) => inspectLiveTenancy(profile),
    readApiVersion: async () => readApiVersion(options.stackRoot),
    backupApiVersion: async () => backupApiVersion(options.stackRoot, path.dirname(options.auditFile)),
    writeApiVersion: async (version) => writeApiVersion(options.stackRoot, version),
    readApiVersionBackup: async (reference) => readApiVersionBackup(options.stackRoot, reference),
    applyDatabase: async (profile, next, contentFingerprint) => withDatabase(profile, next, async (database, client) => {
      await lockDeploymentContent(client, contentFingerprint);
      const result = await database.applyDatabaseMigrations(client);
      if (!result || !Array.isArray(result.applied)) {
        fail('DATABASE_MIGRATION_APPLY_INVALID', 'candidate migration result is unreadable');
      }
      const finalIds = migrationIds(await database.inspectDatabaseMigrations(client));
      const verification = await database.verifyDatabaseMigrations(client);
      if (!verification || verification.status !== 'PASS'
        || verification.migrationCount !== next.manifest.length) {
        fail('DATABASE_VERIFIER_FAILED', 'candidate verifier did not accept the migrated database');
      }
      return Object.freeze({
        appliedIds: Object.freeze(result.applied.map((migration) => migration.id)),
        finalIds,
        verifierStatus: verification.status,
      });
    }),
    restoreApiVersion: async (backup) => restoreApiVersion(backup),
    switchCurrent: async (next) => switchCurrent(options.root, next.root),
    restoreCurrent: async (current) => restoreCurrent(options.root, current.targetText),
    restartService: async () => {
      execFileSync('systemctl', ['restart', options.unit], {
        env: { LANG: 'C', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' },
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: 120_000,
      });
    },
    waitForReady: async (profile, version, assertActive, queryMode, allowLegacyMode) =>
      waitForReady(profile.apiOrigin, version, assertActive, queryMode, allowLegacyMode),
  });
}

export function assertApplyPrivilege(apply, getEffectiveUid = () => process.geteuid?.()) {
  if (apply && getEffectiveUid() !== 0) {
    fail('DEPLOYMENT_PRIVILEGE_REQUIRED', 'apply must run as root to restart the systemd unit');
  }
}

function createDeploymentState(next, previous, backupId) {
  return Object.freeze({
    schema: DEPLOYMENT_STATE_SCHEMA,
    status: 'deploying',
    candidateSha: next.sha,
    candidateVersion: next.version,
    previousSha: previous.sha,
    previousVersion: previous.version,
    previousTargetText: previous.targetText,
    backupId,
    pointerSwitched: false,
    serviceStageReached: false,
    apiEnvBackup: null,
  });
}

function stateMatchesRelease(state, next) {
  return state?.candidateSha === next.sha && state?.candidateVersion === next.version;
}

function assertPreviousTargetMatchesRelease(targetText, release) {
  if (!path.isAbsolute(targetText) || path.resolve(targetText) !== release.root) {
    fail('DEPLOYMENT_STATE_INVALID', 'deployment state rollback target does not match the previous release');
  }
}

export async function runProductionRelease(options, suppliedDependencies) {
  const dependencies = suppliedDependencies ?? defaultDependencies(options);
  const releaseLock = options.apply ? await dependencies.lock() : () => {};
  const startedAt = Date.now();
  let current;
  let previous;
  let next;
  let backupEvidence;
  let tenantReport;
  let liveTenantReport;
  let profile;
  let queryProfile;
  let queryBinding;
  let databaseIds;
  let deploymentState;
  let phase = 'preflight';
  let interrupted = false;
  let mutationStarted = false;
  const onSignal = () => { interrupted = true; };
  const assertNotInterrupted = () => {
    if (interrupted) fail('INTERRUPTED', 'deployment received a termination signal');
  };
  const verifyQueryConfiguration = async () => {
    if (queryBinding !== undefined) {
      assertQueryProfileBinding(queryBinding, await dependencies.readQueryProfile?.(profile, next));
    }
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  const events = [];
  const audit = async (event, fields = {}) => {
    const entry = Object.freeze({
      at: new Date().toISOString(),
      sha: options.sha,
      version: options.expectedVersion,
      phase,
      event,
      ...fields,
    });
    events.push(entry);
    await dependencies.audit(entry);
  };

  const rollback = async (state) => {
    if (!profile) fail('ROLLBACK_CONTEXT_MISSING', 'rollback profile is unavailable');
    await dependencies.verifyRollbackDatabase(profile, previous);
    let apiBackup = null;
    if (state.apiEnvBackup) {
      apiBackup = await dependencies.readApiVersionBackup(state.apiEnvBackup);
    }
    if (state.pointerSwitched) {
      phase = 'rollback-pointer';
      await dependencies.restoreCurrent(previous);
      await audit('pointer-restored', { previousSha: previous.sha });
    }
    if (apiBackup) {
      phase = 'rollback-api-version';
      await dependencies.restoreApiVersion(apiBackup);
      await audit('api-version-restored');
    }
    if (state.serviceStageReached) {
      phase = 'rollback-restart';
      await dependencies.restartService();
    }
    phase = 'rollback-readiness';
    await dependencies.waitForReady(profile, previous.version);
    await audit('rollback-ready', { currentSha: previous.sha });
    deploymentState = Object.freeze({
      ...state,
      status: 'rolled_back',
      pointerSwitched: false,
      serviceStageReached: false,
      apiEnvBackup: null,
    });
    await dependencies.writeState(deploymentState);
    if (apiBackup) {
      try { unlinkSync(apiBackup.backup); } catch { /* The restored config is authoritative. */ }
    }
  };

  try {
    await audit('started', { apply: options.apply });
    assertNotInterrupted();
    current = await dependencies.readCurrent();
    next = await dependencies.readNext();
    deploymentState = options.apply ? await dependencies.readState() : null;

    if (deploymentState && !stateMatchesRelease(deploymentState, next)
      && !['complete', 'rolled_back'].includes(deploymentState.status)) {
      fail('DEPLOYMENT_STATE_CONFLICT', 'an unfinished deployment exists for another candidate');
    }
    if (deploymentState && stateMatchesRelease(deploymentState, next)
      && deploymentState.status !== 'rolled_back') {
      const historical = await dependencies.readHistoricalRelease(
        deploymentState.previousSha,
        deploymentState.previousVersion,
      );
      assertPreviousTargetMatchesRelease(deploymentState.previousTargetText, historical);
      previous = Object.freeze({ ...historical, targetText: deploymentState.previousTargetText });
    } else {
      previous = current;
      deploymentState = null;
    }
    if (previous.root === next.root) {
      if (deploymentState?.status === 'complete') {
        validateSameCatalogue(previous.manifest, next.manifest);
      } else {
        fail('MIGRATION_NOT_FORWARD', 'candidate must be newer than the previous release');
      }
    } else {
      validatePrefix(previous.manifest, next.manifest);
    }
    if (current.sha !== previous.sha && current.sha !== next.sha) {
      fail('CURRENT_INVALID', 'current release matches neither the candidate nor rollback release');
    }

    backupEvidence = await dependencies.readEvidence(next);
    tenantReport = await dependencies.readTenantReport();
    profile = await dependencies.readProfile();
    queryProfile = await dependencies.readQueryProfile?.(profile, next);
    queryBinding = queryProfile === undefined ? undefined : {
      queryMode: queryProfile.mode,
      configurationSha256: queryProfile.configurationSha256,
      scope: queryProfile.mode === 'intake-compat'
        ? 'candidate-intake-catalog-readonly-gates' : 'candidate-query-runtime-readonly-initialization',
    };
    liveTenantReport = await dependencies.inspectTenancy(profile);
    assertTenantReportMatches(tenantReport, liveTenantReport);
    const apiVersion = await dependencies.readApiVersion();
    const permittedApiVersions = deploymentState
      ? new Set([previous.version, next.version])
      : new Set([current.version]);
    if (!permittedApiVersions.has(apiVersion.version)) {
      fail('API_ENV_VERSION_MISMATCH', 'api.env version matches neither rollback nor candidate release');
    }
    if (deploymentState?.apiEnvBackup) {
      await dependencies.readApiVersionBackup(deploymentState.apiEnvBackup);
    }
    databaseIds = await dependencies.inspectDatabase(profile, next);
    const previousIds = previous.manifest.map((migration) => migration.id);
    const nextIds = next.manifest.map((migration) => migration.id);
    if (!sameIds(databaseIds, previousIds) && !sameIds(databaseIds, nextIds)) {
      fail('DATABASE_PREFIX_MISMATCH', 'database migrations match neither previous nor candidate release');
    }

    if (deploymentState?.status === 'rolling_back') {
      if (!options.apply) fail('ROLLBACK_RECOVERY_REQUIRED', 'a previous deployment needs rollback recovery');
      await rollback(deploymentState);
      return Object.freeze({ status: 'rolled-back', previousSha: previous.sha, events: Object.freeze(events) });
    }

    const alreadyComplete = deploymentState?.status === 'complete' && current.sha === next.sha;
    if (alreadyComplete) assertQueryProfileEvidence(backupEvidence.deploymentChecks, queryProfile);
    await dependencies.waitForReady(profile, current.version, assertNotInterrupted,
      alreadyComplete ? queryProfile?.mode ?? 'unified' : undefined,
      alreadyComplete && backupEvidence.deploymentChecks?.schema !== 'customer-agent-release-preflight/v2');
    assertNotInterrupted();

    if (alreadyComplete) {
      await verifyQueryConfiguration();
      await audit('already-complete', { currentSha: current.sha });
      return Object.freeze({
        status: 'already-complete',
        candidateSha: next.sha,
        candidateVersion: next.version,
        events: Object.freeze(events),
      });
    }

    assertDeploymentChecks(backupEvidence.deploymentChecks, previous, next,
      await dependencies.inspectContentFingerprint(profile, next), queryProfile);

    const pending = next.manifest.slice(databaseIds.length).map((migration) => migration.id);
    const plan = Object.freeze({
      status: options.apply ? 'ready-to-apply' : 'dry-run',
      currentSha: current.sha,
      currentVersion: current.version,
      rollbackSha: previous.sha,
      rollbackVersion: previous.version,
      candidateSha: next.sha,
      candidateVersion: next.version,
      backupId: backupEvidence.backupId,
      tenantActiveBatchCount: tenantReport.activeBatchCount,
      pendingMigrationIds: Object.freeze(pending),
      pointerChange: current.root !== next.root,
      resuming: deploymentState?.status === 'deploying',
      ...(queryProfile === undefined ? {} : { queryMode: queryProfile.mode }),
    });
    await audit('preflight-passed', {
      currentSha: current.sha,
      pendingMigrationCount: pending.length,
      pointerChange: plan.pointerChange,
      resuming: plan.resuming,
    });
    if (!options.apply) return Object.freeze({ ...plan, events: Object.freeze(events) });

    if (!deploymentState) {
      deploymentState = createDeploymentState(next, previous, backupEvidence.backupId);
      await dependencies.writeState(deploymentState);
    }

    phase = 'migrate';
    assertNotInterrupted();
    await verifyQueryConfiguration();
    mutationStarted = true;
    const migration = await dependencies.applyDatabase(profile, next, backupEvidence.deploymentChecks.contentFingerprint);
    assertNotInterrupted();
    assertMigrationCompletion(databaseIds, nextIds, migration);
    await audit('migrations-applied', {
      appliedMigrationCount: migration.appliedIds.length,
      verifierStatus: migration.verifierStatus,
    });

    phase = 'api-version';
    if (!deploymentState.apiEnvBackup) {
      const prepared = await dependencies.backupApiVersion();
      if (prepared.version !== previous.version) {
        fail('API_ENV_BACKUP_INVALID', 'api.env backup does not contain the rollback version');
      }
      deploymentState = Object.freeze({
        ...deploymentState,
        apiEnvBackup: Object.freeze({
          path: prepared.backup,
          sha256: prepared.sha256,
          version: prepared.version,
        }),
      });
      await dependencies.writeState(deploymentState);
    }
    await dependencies.readApiVersionBackup(deploymentState.apiEnvBackup);
    await dependencies.writeApiVersion(next.version);
    assertNotInterrupted();
    await audit('api-version-updated');

    phase = 'switch';
    await verifyQueryConfiguration();
    if (current.root !== next.root) {
      deploymentState = Object.freeze({ ...deploymentState, pointerSwitched: true });
      await dependencies.writeState(deploymentState);
      await dependencies.switchCurrent(next);
    }
    assertNotInterrupted();
    await audit(plan.pointerChange ? 'pointer-switched' : 'pointer-unchanged');

    phase = 'restart';
    deploymentState = Object.freeze({ ...deploymentState, serviceStageReached: true });
    await dependencies.writeState(deploymentState);
    await dependencies.restartService();
    assertNotInterrupted();
    phase = 'readiness';
    await dependencies.waitForReady(profile, next.version, assertNotInterrupted,
      queryProfile?.mode ?? 'unified', backupEvidence.deploymentChecks.schema !== 'customer-agent-release-preflight/v2');
    assertNotInterrupted();
    await verifyQueryConfiguration();
    deploymentState = Object.freeze({ ...deploymentState, status: 'complete' });
    await dependencies.writeState(deploymentState);
    await audit('ready', {
      durationMs: Date.now() - startedAt,
      pointerChanged: plan.pointerChange,
    });
    return Object.freeze({
      ...plan,
      status: 'applied',
      appliedMigrationIds: migration.appliedIds,
      durationMs: Date.now() - startedAt,
      events: Object.freeze(events),
    });
  } catch (error) {
    let rollbackFailure;
    try {
      const interruptedMutation = deploymentState?.status === 'rolling_back'
        || mutationStarted
        || (deploymentState?.status === 'deploying'
          && (deploymentState.pointerSwitched || deploymentState.serviceStageReached));
      if (options.apply && deploymentState && previous && interruptedMutation
        && deploymentState.status !== 'rolled_back') {
        deploymentState = Object.freeze({ ...deploymentState, status: 'rolling_back' });
        await dependencies.writeState(deploymentState);
        await rollback(deploymentState);
      }
    } catch (rollbackError) {
      rollbackFailure = rollbackError;
      try {
        await audit('rollback-failed', { errorCode: rollbackError?.code ?? 'ROLLBACK_FAILED' });
      } catch { /* Preserve the original failure and rollback state. */ }
    }
    if (rollbackFailure) {
      fail('ROLLBACK_FAILED', 'release failed and rollback did not recover readiness', rollbackFailure);
    }
    try { await audit('failed', { errorCode: error?.code ?? 'RELEASE_FAILED' }); } catch { /* Preserve primary failure. */ }
    throw error;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    releaseLock();
  }
}

function main() {
  let options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'FAIL', code: error?.code ?? 'INVALID_ARGUMENTS' })}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write([
      'Usage: node scripts/ops/customer-agent-production-release.mjs --sha <40-hex> --expected-version <x.y.z>',
      '  --backup-evidence <file> --tenant-report <file> [--apply --authorization <sha>]',
      '  [--environment production|test] [--stack-root <dir>] [--unit <name>]',
      '',
      'Dry-run is the default. Apply requires --authorization equal to --sha.',
      '',
    ].join('\n'));
    return 0;
  }
  runProductionRelease(options).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === 'applied' ? 0 : 0;
  }).catch((error) => {
    process.stdout.write(`${JSON.stringify({ status: 'FAIL', code: error?.code ?? 'RELEASE_FAILED' })}\n`);
    return 1;
  }).then((code) => {
    process.exitCode = code;
  });
  return null;
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  const code = main();
  if (code !== null) process.exitCode = code;
}
