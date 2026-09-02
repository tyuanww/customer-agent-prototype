import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_PACKAGE_NAME = 'customer-agent-demo';
const CONTRACT_SET_SCHEMA = 'customer-agent-contract-set/v1';
const CONSUMPTION_SCHEMA = 'customer-agent-contract-consumption/v1';
const SOURCE_REPOSITORY = 'ai-赋能立项';
const UPSTREAM_ROOT = 'contracts/upstream/customer-agent';
const LOCK_FILE = 'contract-set.lock.json';
const MANIFEST_FILE = 'contract-set.json';
const INTAKE_STATUS = 'VERIFIED_NOT_ACTIVATED';
const OPENAPI_SOURCE_PATH = 'business-docs/01-客服Agent项目/20-设计-进行中/openapi.v1.yaml';
const DATABASE_SOURCE_PATH = 'business-docs/01-客服Agent项目/20-设计-进行中/33-schema-v1-草案.sql';
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const CONTRACT_SET_ID_PATTERN = /^cs-ai-c11-openapi-(\d+\.\d+\.\d+)-schema-(\d+\.\d+)-([0-9a-f]{12})$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, expectedKeys, label) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unexpected fields: ${actual.join(', ')}`);
  }
}

function requireString(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function readJson(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parsed;
}

function assertRegularFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
  const stats = lstatSync(filePath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file: ${filePath}`);
  }
  return stats;
}

function assertDirectory(directory, label) {
  if (!existsSync(directory)) {
    throw new Error(`${label} is missing: ${directory}`);
  }
  const stats = lstatSync(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a non-symlink directory: ${directory}`);
  }
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function sha256Bytes(content) {
  return createHash('sha256').update(content).digest('hex');
}

function validateDescriptor(value, label) {
  assertExactKeys(value, ['version', 'source_path', 'file', 'sha256', 'bytes'], label);
  if (typeof value.version !== 'string' || value.version.length === 0) {
    throw new Error(`${label}.version is invalid`);
  }
  if (
    typeof value.source_path !== 'string'
    || path.posix.isAbsolute(value.source_path)
    || value.source_path.split('/').includes('..')
    || value.source_path.includes(':')
  ) {
    throw new Error(`${label}.source_path is invalid`);
  }
  if (
    typeof value.file !== 'string'
    || value.file.length === 0
    || path.posix.basename(value.file) !== value.file
  ) {
    throw new Error(`${label}.file is invalid`);
  }
  requireString(value.sha256, HASH_PATTERN, `${label}.sha256`);
  if (!Number.isSafeInteger(value.bytes) || value.bytes <= 0) {
    throw new Error(`${label}.bytes is invalid`);
  }
  return value;
}

function validateManifest(rawManifest) {
  assertExactKeys(
    rawManifest,
    [
      'schema',
      'contract_set_id',
      'source_repository',
      'source_git_sha',
      'architecture_version',
      'implementation_version',
      'openapi',
      'database',
    ],
    'contract-set manifest',
  );
  if (rawManifest.schema !== CONTRACT_SET_SCHEMA) {
    throw new Error(`Unsupported contract-set schema: ${String(rawManifest.schema)}`);
  }
  if (rawManifest.source_repository !== SOURCE_REPOSITORY) {
    throw new Error(`Unexpected source repository: ${String(rawManifest.source_repository)}`);
  }
  requireString(rawManifest.source_git_sha, GIT_SHA_PATTERN, 'source_git_sha');
  if (!/^\d+\.\d+$/.test(rawManifest.architecture_version)) {
    throw new Error('architecture_version is invalid');
  }
  if (!/^\d+\.\d+$/.test(rawManifest.implementation_version)) {
    throw new Error('implementation_version is invalid');
  }
  const idMatch = typeof rawManifest.contract_set_id === 'string'
    ? rawManifest.contract_set_id.match(CONTRACT_SET_ID_PATTERN)
    : null;
  if (!idMatch) {
    throw new Error('contract_set_id is invalid');
  }
  if (idMatch[3] !== rawManifest.source_git_sha.slice(0, 12)) {
    throw new Error('contract_set_id does not match source_git_sha');
  }

  const openapi = validateDescriptor(rawManifest.openapi, 'openapi');
  const database = validateDescriptor(rawManifest.database, 'database');
  if (openapi.version !== idMatch[1] || openapi.file !== 'openapi.v1.yaml') {
    throw new Error('OpenAPI descriptor does not match contract_set_id');
  }
  if (openapi.source_path !== OPENAPI_SOURCE_PATH) {
    throw new Error('OpenAPI source_path is invalid');
  }
  if (database.version !== `schema.v${idMatch[2]}` || database.file !== `schema-v${idMatch[2]}.sql`) {
    throw new Error('Database descriptor does not match contract_set_id');
  }
  if (database.source_path !== DATABASE_SOURCE_PATH) {
    throw new Error('Database source_path is invalid');
  }
  return rawManifest;
}

function expectedMembers(manifest) {
  return [MANIFEST_FILE, manifest.openapi.file, manifest.database.file].sort();
}

function assertMember(directory, descriptor, label) {
  const filePath = path.join(directory, descriptor.file);
  const stats = assertRegularFile(filePath, label);
  if (stats.size !== descriptor.bytes) {
    throw new Error(`${label} byte size mismatch`);
  }
  if (sha256(filePath) !== descriptor.sha256) {
    throw new Error(`${label} SHA-256 mismatch`);
  }
}

export function verifyContractSetDirectory(directory) {
  const resolvedDirectory = path.resolve(directory);
  assertDirectory(resolvedDirectory, 'Contract-set directory');
  const manifestPath = path.join(resolvedDirectory, MANIFEST_FILE);
  assertRegularFile(manifestPath, 'Contract-set manifest');
  const manifest = validateManifest(readJson(manifestPath, 'Contract-set manifest'));
  const actualMembers = readdirSync(resolvedDirectory).sort();
  const members = expectedMembers(manifest);
  if (
    actualMembers.length !== members.length
    || actualMembers.some((entry, index) => entry !== members[index])
  ) {
    throw new Error(`Contract-set members mismatch: ${actualMembers.join(', ')}`);
  }
  assertMember(resolvedDirectory, manifest.openapi, 'OpenAPI contract');
  assertMember(resolvedDirectory, manifest.database, 'Database contract');
  return Object.freeze({ directory: resolvedDirectory, manifest });
}

function runGit(repositoryRoot, arguments_, encoding = 'buffer') {
  try {
    return execFileSync('git', ['-C', repositoryRoot, ...arguments_], {
      encoding: encoding === 'utf8' ? 'utf8' : null,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(`Source Git verification failed at ${arguments_[0] ?? 'unknown operation'}`);
  }
}

function verifySourceRepository(sourceRepositoryRoot, manifest) {
  if (!sourceRepositoryRoot) {
    throw new Error(
      'Contract intake requires --source-repository-root=<trusted ai-赋能立项 checkout>',
    );
  }
  const resolvedRepositoryRoot = realpathSync(path.resolve(sourceRepositoryRoot));
  assertDirectory(resolvedRepositoryRoot, 'Source repository root');
  const gitTopLevel = String(
    runGit(resolvedRepositoryRoot, ['rev-parse', '--show-toplevel'], 'utf8'),
  ).trim();
  if (realpathSync(gitTopLevel) !== resolvedRepositoryRoot) {
    throw new Error('Source repository root must be the Git top-level directory');
  }
  runGit(resolvedRepositoryRoot, ['cat-file', '-e', `${manifest.source_git_sha}^{commit}`]);

  for (const [label, descriptor] of [
    ['OpenAPI', manifest.openapi],
    ['Database', manifest.database],
  ]) {
    const committedBytes = runGit(
      resolvedRepositoryRoot,
      ['show', `${manifest.source_git_sha}:${descriptor.source_path}`],
    );
    if (
      committedBytes.length !== descriptor.bytes
      || sha256Bytes(committedBytes) !== descriptor.sha256
    ) {
      throw new Error(`${label} contract does not match the declared source Git commit`);
    }
  }
  return resolvedRepositoryRoot;
}

function assertProjectRoot(projectRoot) {
  const resolvedRoot = realpathSync(path.resolve(projectRoot));
  if (resolvedRoot === path.parse(resolvedRoot).root || resolvedRoot === os.homedir()) {
    throw new Error(`Refusing unsafe product root: ${resolvedRoot}`);
  }
  const packagePath = path.join(resolvedRoot, 'package.json');
  assertRegularFile(packagePath, 'Product package.json');
  const packageJson = readJson(packagePath, 'Product package.json');
  if (packageJson.name !== EXPECTED_PACKAGE_NAME) {
    throw new Error(`Refusing unexpected product package: ${String(packageJson.name)}`);
  }
  return resolvedRoot;
}

function assertPathInsideRoot(projectRoot, targetPath) {
  const relative = path.relative(projectRoot, targetPath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing path outside product root: ${targetPath}`);
  }
  let cursor = projectRoot;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`Refusing symlink in contract intake path: ${cursor}`);
    }
  }
}

function acquireIntakeLock(projectRoot, upstreamRoot) {
  const lockDirectory = path.join(upstreamRoot, '.contract-intake.lock');
  assertPathInsideRoot(projectRoot, lockDirectory);
  try {
    mkdirSync(lockDirectory);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      throw new Error('Another contract-set operation is already in progress');
    }
    throw error;
  }
  return () => rmdirSync(lockDirectory);
}

function consumptionLock(verifiedContractSet) {
  const { directory, manifest } = verifiedContractSet;
  return {
    schema: CONSUMPTION_SCHEMA,
    contract_set_id: manifest.contract_set_id,
    source_repository: manifest.source_repository,
    source_git_sha: manifest.source_git_sha,
    manifest_sha256: sha256(path.join(directory, MANIFEST_FILE)),
    openapi_sha256: manifest.openapi.sha256,
    database_sha256: manifest.database.sha256,
    intake_status: INTAKE_STATUS,
    ddev_authorized: false,
    runtime_activated: false,
  };
}

function validateConsumptionLock(rawLock) {
  assertExactKeys(
    rawLock,
    [
      'schema',
      'contract_set_id',
      'source_repository',
      'source_git_sha',
      'manifest_sha256',
      'openapi_sha256',
      'database_sha256',
      'intake_status',
      'ddev_authorized',
      'runtime_activated',
    ],
    'contract-set lock',
  );
  if (rawLock.schema !== CONSUMPTION_SCHEMA || rawLock.source_repository !== SOURCE_REPOSITORY) {
    throw new Error('Contract-set lock identity is invalid');
  }
  requireString(rawLock.contract_set_id, CONTRACT_SET_ID_PATTERN, 'lock contract_set_id');
  requireString(rawLock.source_git_sha, GIT_SHA_PATTERN, 'lock source_git_sha');
  requireString(rawLock.manifest_sha256, HASH_PATTERN, 'lock manifest_sha256');
  requireString(rawLock.openapi_sha256, HASH_PATTERN, 'lock openapi_sha256');
  requireString(rawLock.database_sha256, HASH_PATTERN, 'lock database_sha256');
  if (
    rawLock.intake_status !== INTAKE_STATUS
    || rawLock.ddev_authorized !== false
    || rawLock.runtime_activated !== false
  ) {
    throw new Error('Contract-set lock must remain verified but not activated');
  }
  return rawLock;
}

function assertLockMatchesContractSet(lock, verifiedContractSet) {
  const expected = consumptionLock(verifiedContractSet);
  for (const [key, value] of Object.entries(expected)) {
    if (lock[key] !== value) {
      throw new Error(`Contract-set lock mismatch at ${key}`);
    }
  }
}

function writeJsonAtomically(filePath, value) {
  const parent = path.dirname(filePath);
  const temporaryDirectory = mkdtempSync(path.join(parent, '.lock-write-'));
  const temporaryFile = path.join(temporaryDirectory, path.basename(filePath));
  try {
    writeFileSync(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o644,
    });
    renameSync(temporaryFile, filePath);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export function verifyIngestedContractSet({ projectRoot, expectedContractSetId } = {}) {
  const resolvedRoot = assertProjectRoot(projectRoot ?? defaultProjectRoot());
  const upstreamRoot = path.join(resolvedRoot, UPSTREAM_ROOT);
  const lockPath = path.join(upstreamRoot, LOCK_FILE);
  assertPathInsideRoot(resolvedRoot, lockPath);
  assertRegularFile(lockPath, 'Contract-set lock');
  const lock = validateConsumptionLock(readJson(lockPath, 'Contract-set lock'));
  if (expectedContractSetId && lock.contract_set_id !== expectedContractSetId) {
    throw new Error(`Expected contract set ${expectedContractSetId}, found ${lock.contract_set_id}`);
  }
  const destination = path.join(upstreamRoot, lock.contract_set_id);
  assertPathInsideRoot(resolvedRoot, destination);
  const verified = verifyContractSetDirectory(destination);
  assertLockMatchesContractSet(lock, verified);
  return Object.freeze({
    status: 'VERIFIED',
    contract_set_id: lock.contract_set_id,
    source_git_sha: lock.source_git_sha,
    path: destination,
    lock_path: lockPath,
    intake_status: lock.intake_status,
    ddev_authorized: false,
    runtime_activated: false,
  });
}

/**
 * Runs a consumer against one coherent, verified contract-set snapshot.
 *
 * The shared intake lock stays held until the (possibly async) consumer
 * finishes, so a lock rollover cannot mix source bytes with another
 * snapshot's provenance or replace the active input while generated outputs
 * are being written.
 */
export async function withVerifiedContractSetSnapshot(
  { projectRoot, expectedContractSetId } = {},
  consumer,
) {
  if (typeof consumer !== 'function') {
    throw new Error('Contract-set snapshot consumer must be a function');
  }

  const resolvedRoot = assertProjectRoot(projectRoot ?? defaultProjectRoot());
  const upstreamRoot = path.join(resolvedRoot, UPSTREAM_ROOT);
  assertDirectory(upstreamRoot, 'Contract-set upstream directory');
  const releaseIntakeLock = acquireIntakeLock(resolvedRoot, upstreamRoot);

  try {
    const verified = verifyIngestedContractSet({
      projectRoot: resolvedRoot,
      expectedContractSetId,
    });
    const lock = validateConsumptionLock(readJson(verified.lock_path, 'Contract-set lock'));
    const manifestPath = path.join(verified.path, MANIFEST_FILE);
    const manifest = validateManifest(readJson(manifestPath, 'Contract-set manifest'));
    const openapiPath = path.join(verified.path, manifest.openapi.file);
    const databasePath = path.join(verified.path, manifest.database.file);
    assertRegularFile(openapiPath, 'OpenAPI contract');
    assertRegularFile(databasePath, 'Database contract');

    const snapshot = Object.freeze({
      ...verified,
      lock: Object.freeze({ ...lock }),
      manifest: Object.freeze({
        ...manifest,
        openapi: Object.freeze({ ...manifest.openapi }),
        database: Object.freeze({ ...manifest.database }),
      }),
      openapi_source: readFileSync(openapiPath, 'utf8'),
      database_source: readFileSync(databasePath, 'utf8'),
    });
    return await consumer(snapshot);
  } finally {
    releaseIntakeLock();
  }
}

function manifestsMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function ingestContractSet({ projectRoot, sourceDirectory, sourceRepositoryRoot }) {
  if (!sourceDirectory) {
    throw new Error('Contract intake requires --source=<verified contract-set directory>');
  }
  const source = verifyContractSetDirectory(sourceDirectory);
  verifySourceRepository(sourceRepositoryRoot, source.manifest);
  const resolvedRoot = assertProjectRoot(projectRoot ?? defaultProjectRoot());
  const upstreamRoot = path.join(resolvedRoot, UPSTREAM_ROOT);
  const destination = path.join(upstreamRoot, source.manifest.contract_set_id);
  const lockPath = path.join(upstreamRoot, LOCK_FILE);
  assertPathInsideRoot(resolvedRoot, upstreamRoot);
  assertPathInsideRoot(resolvedRoot, destination);
  assertPathInsideRoot(resolvedRoot, lockPath);
  mkdirSync(upstreamRoot, { recursive: true });
  assertPathInsideRoot(resolvedRoot, destination);
  const releaseIntakeLock = acquireIntakeLock(resolvedRoot, upstreamRoot);

  try {
    const current = existsSync(lockPath)
      ? verifyIngestedContractSet({ projectRoot: resolvedRoot })
      : null;

    if (existsSync(destination)) {
      const existing = verifyContractSetDirectory(destination);
      if (!manifestsMatch(existing.manifest, source.manifest)) {
        throw new Error('Existing contract-set manifest differs from the verified source');
      }
      if (!current || current.contract_set_id !== source.manifest.contract_set_id) {
        writeJsonAtomically(lockPath, consumptionLock(existing));
      }
      const verified = verifyIngestedContractSet({
        projectRoot: resolvedRoot,
        expectedContractSetId: source.manifest.contract_set_id,
      });
      return Object.freeze({ ...verified, status: 'REUSED' });
    }

    const stagingDirectory = mkdtempSync(path.join(upstreamRoot, '.contract-intake-'));
    try {
      for (const member of expectedMembers(source.manifest)) {
        copyFileSync(
          path.join(source.directory, member),
          path.join(stagingDirectory, member),
          constants.COPYFILE_EXCL,
        );
      }
      const staged = verifyContractSetDirectory(stagingDirectory);
      const nextLock = consumptionLock(staged);
      renameSync(stagingDirectory, destination);
      writeJsonAtomically(lockPath, nextLock);
    } catch (error) {
      if (existsSync(stagingDirectory)) {
        rmSync(stagingDirectory, { recursive: true, force: true });
      }
      throw error;
    }

    const verified = verifyIngestedContractSet({
      projectRoot: resolvedRoot,
      expectedContractSetId: source.manifest.contract_set_id,
    });
    return Object.freeze({ ...verified, status: 'CREATED' });
  } finally {
    releaseIntakeLock();
  }
}

function defaultProjectRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function parseCliArguments(argv) {
  const command = argv[0] ?? 'verify';
  if (command !== 'ingest' && command !== 'verify') {
    throw new Error(`Unknown contract-set command: ${command}`);
  }
  const options = {};
  for (const argument of argv.slice(1)) {
    if (argument === '--') {
      continue;
    }
    const match = argument.match(/^--(source|source-repository-root|project-root|id)=(.+)$/);
    if (!match) {
      throw new Error(`Unknown contract-set option: ${argument}`);
    }
    options[match[1]] = match[2];
  }
  return { command, options };
}

function runCli() {
  const { command, options } = parseCliArguments(process.argv.slice(2));
  const result = command === 'ingest'
    ? ingestContractSet({
        projectRoot: options['project-root'],
        sourceDirectory: options.source,
        sourceRepositoryRoot: options['source-repository-root'],
      })
    : verifyIngestedContractSet({
        projectRoot: options['project-root'],
        expectedContractSetId: options.id,
      });
  console.log(JSON.stringify(result, null, 2));
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  try {
    runCli();
  } catch (error) {
    console.error(
      `CONTRACT_SET_INTAKE_FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
