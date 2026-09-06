import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export const M0_FORMAL_CANDIDATE_PATH = path.join(
  'release',
  'm0-formal-runtime-candidate',
);

const SOURCE_TREES = Object.freeze([
  Object.freeze({ source: 'apps/api/dist', target: 'apps/api/dist' }),
  Object.freeze({ source: 'packages/contracts/dist', target: 'packages/contracts/dist' }),
  Object.freeze({ source: 'packages/database/dist', target: 'packages/database/dist' }),
]);

const CONTRACT_LOCK = 'contracts/upstream/customer-agent/contract-set.lock.json';
const ALLOWED_ARTIFACT_SUFFIXES = Object.freeze(['.d.ts', '.js', '.json']);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function requireRegularFile(filename, label) {
  if (!existsSync(filename)) {
    throw new Error(`M0_FORMAL_CANDIDATE_SOURCE_MISSING: ${label}`);
  }
  const stats = lstatSync(filename);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`M0_FORMAL_CANDIDATE_SOURCE_UNSAFE: ${label}`);
  }
}

function requireAllowedArtifactFile(relativePath) {
  if (!ALLOWED_ARTIFACT_SUFFIXES.some((suffix) => relativePath.endsWith(suffix))) {
    throw new Error(`M0_FORMAL_CANDIDATE_SOURCE_TYPE_NOT_ALLOWED: ${relativePath}`);
  }
}

function requireCleanWorktree(projectRoot) {
  const status = execFileSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: projectRoot, encoding: 'utf8' },
  ).trim();
  if (status.length > 0) {
    throw new Error('M0_FORMAL_CANDIDATE_REQUIRES_CLEAN_WORKTREE');
  }
}

function copyTree(projectRoot, stagingRoot, sourceRelative, targetRelative, copied) {
  const sourceRoot = path.join(projectRoot, sourceRelative);
  if (!existsSync(sourceRoot) || !lstatSync(sourceRoot).isDirectory()) {
    throw new Error(`M0_FORMAL_CANDIDATE_SOURCE_MISSING: ${sourceRelative}`);
  }
  if (lstatSync(sourceRoot).isSymbolicLink()) {
    throw new Error(`M0_FORMAL_CANDIDATE_SOURCE_UNSAFE: ${sourceRelative}`);
  }

  const walk = (sourceDirectory, relativeDirectory = '') => {
    for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
      const source = path.join(sourceDirectory, entry.name);
      const relative = path.join(relativeDirectory, entry.name);
      const stats = lstatSync(source);
      if (stats.isSymbolicLink()) {
        throw new Error(`M0_FORMAL_CANDIDATE_SOURCE_SYMLINK: ${path.join(sourceRelative, relative)}`);
      }
      if (stats.isDirectory()) {
        if (sourceRelative === 'packages/database/dist' && relative === 'testkit') {
          continue;
        }
        walk(source, relative);
        continue;
      }
      if (!stats.isFile()) {
        throw new Error(`M0_FORMAL_CANDIDATE_SOURCE_UNSUPPORTED: ${path.join(sourceRelative, relative)}`);
      }
      if (relative.endsWith('.map')) {
        throw new Error(`M0_FORMAL_CANDIDATE_SOURCE_MAP: ${path.join(sourceRelative, relative)}`);
      }
      requireAllowedArtifactFile(relative);
      const targetRelativePath = path.join(targetRelative, relative);
      const target = path.join(stagingRoot, targetRelativePath);
      const bytes = readFileSync(source);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes, { flag: 'wx', mode: 0o644 });
      copied.push(Object.freeze({
        path: targetRelativePath.split(path.sep).join('/'),
        bytes: bytes.length,
        sha256: sha256(bytes),
      }));
    }
  };

  walk(sourceRoot);
}

function safeCandidatePath(projectRoot) {
  const releaseRoot = path.join(projectRoot, 'release');
  const candidateRoot = path.join(projectRoot, M0_FORMAL_CANDIDATE_PATH);
  if (
    candidateRoot === projectRoot
    || candidateRoot === releaseRoot
    || path.dirname(candidateRoot) !== releaseRoot
  ) {
    throw new Error(`M0_FORMAL_CANDIDATE_UNSAFE_TARGET: ${candidateRoot}`);
  }
  return { releaseRoot, candidateRoot };
}

function requireSafeDirectoryOrMissing(directory, label) {
  if (!existsSync(directory)) return;
  const stats = lstatSync(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`M0_FORMAL_CANDIDATE_UNSAFE_${label}: ${directory}`);
  }
}

export function buildM0FormalCandidate({ projectRoot = repositoryRoot, check = false } = {}) {
  const resolvedProjectRoot = realpathSync(path.resolve(projectRoot));
  requireCleanWorktree(resolvedProjectRoot);
  execFileSync('pnpm', ['build'], {
    cwd: resolvedProjectRoot,
    stdio: 'inherit',
  });
  if (check) {
    execFileSync('pnpm', ['test:built'], { cwd: resolvedProjectRoot, stdio: 'inherit' });
  }
  requireCleanWorktree(resolvedProjectRoot);
  const { releaseRoot, candidateRoot } = safeCandidatePath(resolvedProjectRoot);
  requireSafeDirectoryOrMissing(releaseRoot, 'RELEASE_ROOT');
  mkdirSync(releaseRoot, { recursive: true });
  requireSafeDirectoryOrMissing(candidateRoot, 'TARGET');
  const stagingRoot = path.join(
    releaseRoot,
    `.m0-formal-runtime-candidate-${process.pid}-${randomUUID()}`,
  );
  mkdirSync(stagingRoot, { recursive: false });

  try {
    const artifacts = [];
    for (const tree of SOURCE_TREES) {
      copyTree(resolvedProjectRoot, stagingRoot, tree.source, tree.target, artifacts);
    }

    const lockSource = path.join(resolvedProjectRoot, CONTRACT_LOCK);
    requireRegularFile(lockSource, CONTRACT_LOCK);
    const lockBytes = readFileSync(lockSource);
    const lockTarget = path.join(stagingRoot, CONTRACT_LOCK);
    mkdirSync(path.dirname(lockTarget), { recursive: true });
    writeFileSync(lockTarget, lockBytes, { flag: 'wx', mode: 0o644 });
    artifacts.push(Object.freeze({
      path: CONTRACT_LOCK,
      bytes: lockBytes.length,
      sha256: sha256(lockBytes),
    }));

    const contractLock = JSON.parse(lockBytes.toString('utf8'));
    const buildGitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: resolvedProjectRoot,
      encoding: 'utf8',
    }).trim();
    const manifest = {
      schema: 'customer-agent-m0-formal-runtime-candidate/v1',
      evidence_scope: 'contracts-database-api-build-separation-only',
      deployable: false,
      runtime_activated: false,
      build_git_sha: buildGitSha,
      contract_set_id: contractLock.contract_set_id,
      contract_source_git_sha: contractLock.source_git_sha,
      artifacts: artifacts.sort((left, right) => left.path.localeCompare(right.path, 'en')),
    };
    writeFileSync(
      path.join(stagingRoot, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: 'wx', mode: 0o644 },
    );

    rmSync(candidateRoot, { recursive: true, force: true });
    renameSync(stagingRoot, candidateRoot);
    return Object.freeze({ candidateRoot, manifest });
  } catch (error) {
    rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg !== '--check')) {
    throw new Error('M0_FORMAL_CANDIDATE_ARGUMENT_INVALID');
  }
  const result = buildM0FormalCandidate({ check: args.includes('--check') });
  console.log(
    `M0 formal runtime candidate built: ${result.manifest.artifacts.length} files at ${result.candidateRoot}`,
  );
  console.log('Candidate is deliberately non-deployable and keeps runtime_activated=false.');
}
