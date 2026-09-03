import {
  createHash,
} from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyIngestedContractSet } from './customer-agent-contract-set.mjs';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export const M0_FORMAL_CANDIDATE_ROOT = 'release/m0-formal-runtime-candidate';
export const DEFAULT_FORMAL_ARTIFACT_ROOTS = Object.freeze([
  M0_FORMAL_CANDIDATE_ROOT,
]);

export const FORBIDDEN_FORMAL_ARTIFACT_MARKERS = Object.freeze([
  Object.freeze({ code: 'DESKTOP_PACKAGE_IMPORT', pattern: /@customer-agent\/desktop/u }),
  Object.freeze({ code: 'DESKTOP_SOURCE_PATH', pattern: /(?:^|[\\/])apps[\\/]desktop(?:[\\/]|$)/u }),
  Object.freeze({ code: 'SYNTHETIC_FIXTURE_MODULE', pattern: /synthetic-(?:scripts|development-baseline)/u }),
  Object.freeze({ code: 'DASHBOARD_FIXTURE_MODULE', pattern: /dashboard-manifest/u }),
  Object.freeze({ code: 'SYNTHETIC_PILOT_PROFILE', pattern: /PILOT-S0/u }),
  Object.freeze({ code: 'E2E_RUNTIME_SWITCH', pattern: /DEMO_E2E/u }),
  Object.freeze({ code: 'GITHUB_TOKEN', pattern: /gh[opusr]_[A-Za-z0-9]{20,}/u }),
  Object.freeze({ code: 'GITHUB_FINE_GRAINED_TOKEN', pattern: /github_pat_[A-Za-z0-9_]{20,}/u }),
  Object.freeze({ code: 'OPENAI_TOKEN', pattern: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/u }),
  Object.freeze({ code: 'SLACK_TOKEN', pattern: /xox[baprs]-[A-Za-z0-9-]{20,}/u }),
  Object.freeze({ code: 'AWS_ACCESS_KEY', pattern: /(?:A3T|AKIA|ASIA|ABIA)[A-Z0-9]{16}/u }),
  Object.freeze({ code: 'GOOGLE_API_KEY', pattern: /AIza[A-Za-z0-9_-]{30,}/u }),
  Object.freeze({ code: 'PRIVATE_KEY', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u }),
]);

const ALLOWED_CANDIDATE_SUFFIXES = Object.freeze(['.d.ts', '.js', '.json']);

function collectTextFiles(root, directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const stats = lstatSync(target);
    if (stats.isSymbolicLink()) {
      throw new Error(`FORMAL_ARTIFACT_SYMLINK: ${path.relative(root, target)}`);
    }
    if (stats.isDirectory()) {
      collectTextFiles(root, target, files);
      continue;
    }
    if (!stats.isFile()) {
      throw new Error(`FORMAL_ARTIFACT_UNSUPPORTED_ENTRY: ${path.relative(root, target)}`);
    }
    const relative = path.relative(root, target);
    if (!ALLOWED_CANDIDATE_SUFFIXES.some((suffix) => relative.endsWith(suffix))) {
      throw new Error(`FORMAL_ARTIFACT_FILE_TYPE_NOT_ALLOWED: ${relative}`);
    }
    files.push(target);
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function verifyFormalArtifactBoundary({
  projectRoot = repositoryRoot,
  artifactRoots = DEFAULT_FORMAL_ARTIFACT_ROOTS,
} = {}) {
  const resolvedProjectRoot = realpathSync(path.resolve(projectRoot));
  const scannedFiles = [];

  for (const relativeRoot of artifactRoots) {
    const artifactRoot = path.resolve(resolvedProjectRoot, relativeRoot);
    const relative = path.relative(resolvedProjectRoot, artifactRoot);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`FORMAL_ARTIFACT_ROOT_OUTSIDE_REPOSITORY: ${relativeRoot}`);
    }
    if (!existsSync(artifactRoot) || !lstatSync(artifactRoot).isDirectory()) {
      throw new Error(`FORMAL_ARTIFACT_ROOT_MISSING: ${relativeRoot}`);
    }
    if (lstatSync(artifactRoot).isSymbolicLink()) {
      throw new Error(`FORMAL_ARTIFACT_ROOT_SYMLINK: ${relativeRoot}`);
    }
    collectTextFiles(resolvedProjectRoot, artifactRoot, scannedFiles);
  }

  const violations = [];
  for (const filename of scannedFiles.sort()) {
    const source = readFileSync(filename, 'utf8');
    for (const marker of FORBIDDEN_FORMAL_ARTIFACT_MARKERS) {
      if (marker.pattern.test(source)) {
        violations.push({
          code: marker.code,
          file: path.relative(resolvedProjectRoot, filename),
        });
      }
    }
  }

  if (violations.length > 0) {
    const detail = violations
      .map(({ code, file }) => `${code}:${file}`)
      .join(', ');
    throw new Error(`FORMAL_ARTIFACT_BOUNDARY_VIOLATION: ${detail}`);
  }

  return Object.freeze({
    roots: [...artifactRoots],
    scannedFileCount: scannedFiles.length,
  });
}

export function verifyM0FormalCandidate({
  projectRoot = repositoryRoot,
  expectedBuildGitSha,
} = {}) {
  const resolvedProjectRoot = realpathSync(path.resolve(projectRoot));
  if (expectedBuildGitSha === undefined) {
    const status = execFileSync(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all'],
      { cwd: resolvedProjectRoot, encoding: 'utf8' },
    ).trim();
    if (status.length > 0) {
      throw new Error('M0_FORMAL_CANDIDATE_REQUIRES_CLEAN_WORKTREE');
    }
  }
  const releaseRoot = path.join(resolvedProjectRoot, 'release');
  if (!existsSync(releaseRoot) || lstatSync(releaseRoot).isSymbolicLink()) {
    throw new Error('M0_FORMAL_CANDIDATE_RELEASE_ROOT_UNSAFE');
  }
  const candidateRoot = path.join(resolvedProjectRoot, M0_FORMAL_CANDIDATE_ROOT);
  if (!existsSync(candidateRoot)) {
    throw new Error('M0_FORMAL_CANDIDATE_ROOT_MISSING');
  }
  const candidateStats = lstatSync(candidateRoot);
  if (candidateStats.isSymbolicLink() || !candidateStats.isDirectory()) {
    throw new Error('M0_FORMAL_CANDIDATE_ROOT_UNSAFE');
  }
  const manifestPath = path.join(candidateRoot, 'manifest.json');
  if (!existsSync(manifestPath) || !lstatSync(manifestPath).isFile()) {
    throw new Error('M0_FORMAL_CANDIDATE_MANIFEST_MISSING');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (
    manifest.schema !== 'customer-agent-m0-formal-runtime-candidate/v1'
    || manifest.evidence_scope !== 'contracts-database-api-build-separation-only'
    || manifest.deployable !== false
    || manifest.runtime_activated !== false
  ) {
    throw new Error('M0_FORMAL_CANDIDATE_MANIFEST_INVALID');
  }
  const currentBuildGitSha = expectedBuildGitSha ?? execFileSync(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: resolvedProjectRoot, encoding: 'utf8' },
  ).trim();
  if (
    !/^[0-9a-f]{40}$/u.test(manifest.build_git_sha)
    || !/^[0-9a-f]{40}$/u.test(currentBuildGitSha)
    || manifest.build_git_sha !== currentBuildGitSha
  ) {
    throw new Error('M0_FORMAL_CANDIDATE_BUILD_SHA_DRIFT');
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new Error('M0_FORMAL_CANDIDATE_ARTIFACTS_MISSING');
  }
  const verifiedContract = verifyIngestedContractSet({
    projectRoot: resolvedProjectRoot,
    expectedContractSetId: manifest.contract_set_id,
  });
  if (verifiedContract.source_git_sha !== manifest.contract_source_git_sha) {
    throw new Error('M0_FORMAL_CANDIDATE_CONTRACT_IDENTITY_DRIFT');
  }

  const actual = [];
  const walk = (directory, relativeDirectory = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      const relative = path.join(relativeDirectory, entry.name);
      const stats = lstatSync(target);
      if (stats.isSymbolicLink()) {
        throw new Error(`M0_FORMAL_CANDIDATE_SYMLINK: ${relative}`);
      }
      if (stats.isDirectory()) {
        if (relative.split(path.sep).some((segment) => segment === 'testkit' || segment === 'tests')) {
          throw new Error(`M0_FORMAL_CANDIDATE_TEST_SURFACE: ${relative}`);
        }
        walk(target, relative);
        continue;
      }
      if (!stats.isFile()) {
        throw new Error(`M0_FORMAL_CANDIDATE_UNSUPPORTED_ENTRY: ${relative}`);
      }
      if (relative === 'manifest.json') continue;
      if (relative.endsWith('.map')) {
        throw new Error(`M0_FORMAL_CANDIDATE_SOURCE_MAP: ${relative}`);
      }
      const bytes = readFileSync(target);
      actual.push({
        path: relative.split(path.sep).join('/'),
        bytes: bytes.length,
        sha256: sha256(bytes),
      });
    }
  };
  walk(candidateRoot);

  const expectedJson = JSON.stringify(manifest.artifacts);
  const actualJson = JSON.stringify(actual.sort((left, right) => left.path.localeCompare(right.path, 'en')));
  if (actualJson !== expectedJson) {
    throw new Error('M0_FORMAL_CANDIDATE_MANIFEST_DRIFT');
  }

  const lockPath = path.join(candidateRoot, 'contracts/upstream/customer-agent/contract-set.lock.json');
  const lockBytes = readFileSync(lockPath);
  const repositoryLockPath = path.join(
    resolvedProjectRoot,
    'contracts/upstream/customer-agent/contract-set.lock.json',
  );
  const repositoryLockBytes = readFileSync(repositoryLockPath);
  if (!lockBytes.equals(repositoryLockBytes)) {
    throw new Error('M0_FORMAL_CANDIDATE_REPOSITORY_LOCK_DRIFT');
  }
  const contractLock = JSON.parse(lockBytes.toString('utf8'));
  if (
    contractLock.contract_set_id !== manifest.contract_set_id
    || contractLock.source_git_sha !== manifest.contract_source_git_sha
    || contractLock.runtime_activated !== false
  ) {
    throw new Error('M0_FORMAL_CANDIDATE_CONTRACT_LOCK_DRIFT');
  }

  const boundary = verifyFormalArtifactBoundary({ projectRoot: resolvedProjectRoot });
  return Object.freeze({ ...boundary, artifactCount: actual.length });
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  const result = verifyM0FormalCandidate();
  console.log(
    `M0 formal candidate verified: ${result.artifactCount} files; ${result.scannedFileCount} text files scanned across ${result.roots.length} roots.`,
  );
  console.log(
    'This proves service build separation only; it is not a production deployment, signed desktop build, or real-data validation.',
  );
}
