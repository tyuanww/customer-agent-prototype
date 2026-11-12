import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertCandidateBuildDigests, readCandidateRelease } from './backup-set.mjs';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const runtimePackages = [
  'contracts', 'retrieval-core', 'job-roster', 'unified-contracts',
  'content-intake', 'database',
].map((name) => `packages/${name}`).concat('apps/api');
const gitEnvironment = {
  ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1',
};

function write(root, relative, content) {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function commitCandidate(root) {
  const git = (...args) => execFileSync('git', args, { cwd: root, env: gitEnvironment, encoding: 'utf8' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-qm', 'synthetic runtime candidate');
  return git('rev-parse', 'HEAD').trim();
}

function createCandidate(root) {
  const candidate = path.join(root, 'candidate');
  write(candidate, '.gitignore', '**/dist/\n**/node_modules/\n');
  write(candidate, 'package.json', '{"private":true,"type":"module"}\n');
  write(candidate, 'VERSION', '0.3.43\n');
  write(candidate, 'apps/desktop/package.json', '{"version":"0.3.43"}\n');
  write(candidate, 'packages/database/migrations/manifest.generated.json',
    '{"migrations":[{"position":81,"id":"0081_next"}]}\n');
  copyFileSync(path.join(repositoryRoot, 'pnpm-lock.yaml'), path.join(candidate, 'pnpm-lock.yaml'));
  // Fixture compilation uses only these third-party type providers. Workspace
  // resolution must find the synthetic packages, including their rebuilt dist.
  const modules = path.join(candidate, 'node_modules');
  mkdirSync(path.join(modules, '@customer-agent'), { recursive: true });
  for (const dependency of ['@types', 'vitest']) {
    symlinkSync(path.join(repositoryRoot, 'packages/database/node_modules', dependency),
      path.join(modules, dependency), 'dir');
  }
  for (const directory of runtimePackages) {
    mkdirSync(path.join(candidate, directory, 'src'), { recursive: true });
    for (const file of ['tsconfig.json', 'tsconfig.build.json']) {
      copyFileSync(path.join(repositoryRoot, directory, file), path.join(candidate, directory, file));
    }
    const metadata = JSON.parse(readFileSync(path.join(repositoryRoot, directory, 'package.json'), 'utf8'));
    metadata.scripts = { build: 'node -e "require(\'fs\').writeFileSync(\'SCRIPT_RAN\', \'bad\')"' };
    write(candidate, `${directory}/package.json`, JSON.stringify(metadata));
    write(candidate, `${directory}/src/index.ts`, 'export const fixtureMarker = "synthetic-only";\n');
    symlinkSync(path.relative(path.join(modules, '@customer-agent'), path.join(candidate, directory)),
      path.join(modules, '@customer-agent', path.basename(directory)), 'dir');
  }
  write(candidate, 'packages/content-intake/src/workbook.ts', 'export const workbookMarker = "rebuilt-only";\n');
  write(candidate, 'packages/content-intake/src/runner.ts', 'export const runner = true;\n');
  write(candidate, 'packages/database/src/verifier.ts', 'export const verifier = true;\n');
  write(candidate, 'packages/database/src/generated/migrations.generated.ts', 'export const migrations = [];\n');
  write(candidate, 'apps/api/src/index.ts',
    'import { workbookMarker } from "@customer-agent/content-intake";\nexport const apiMarker = workbookMarker;\n');
  const compiler = path.join(repositoryRoot, 'packages/database/node_modules/typescript/bin/tsc');
  for (const directory of runtimePackages) {
    execFileSync(process.execPath, [compiler, '-p', `${directory}/tsconfig.build.json`], {
      cwd: candidate, env: gitEnvironment, stdio: 'pipe',
    });
  }
  const gitSha = commitCandidate(candidate);
  const release = path.join(root, gitSha);
  renameSync(candidate, release);
  return realpathSync(release);
}

test('runtime read binds API and workspace builds while default read retains its database-only result', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'release-runtime-build-'));
  try {
    const release = createCandidate(root);
    const baseline = readCandidateRelease(release);
    assert.equal(Object.hasOwn(baseline, 'runtimeBuildSha256'), false);
    write(release, 'apps/api/src/untracked.ts', 'this must never enter the build;\n');
    const verified = readCandidateRelease(release, { verifyRuntime: true });
    const { runtimeBuildSha256, ...identity } = verified;
    assert.deepEqual(identity, baseline);
    assert.match(runtimeBuildSha256, /^[a-f0-9]{64}$/u);
    assert.equal(Object.isFrozen(verified), true);
    const contentLink = path.join(release, 'node_modules/@customer-agent/content-intake');
    const foreign = path.join(root, 'foreign-content-intake');
    mkdirSync(foreign);
    copyFileSync(path.join(release, 'packages/content-intake/package.json'), path.join(foreign, 'package.json'));
    write(foreign, 'dist/runner.js', 'export const runner = "unverified";\n');
    symlinkSync(path.join(release, 'packages/content-intake/dist/workbook.js'), path.join(foreign, 'dist/workbook.js'));
    rmSync(contentLink);
    symlinkSync(foreign, contentLink, 'dir');
    assert.throws(() => readCandidateRelease(release, { verifyRuntime: true }),
      { code: 'CANDIDATE_RUNTIME_DEPENDENCIES_MISMATCH' });
    rmSync(contentLink);
    symlinkSync(path.join(release, 'packages/content-intake'), contentLink, 'dir');
    const shadow = path.join(release, 'apps/api/node_modules/@customer-agent/content-intake');
    write(shadow, 'index.js', 'export const workbookMarker = "unverified-no-manifest";\n');
    assert.throws(() => readCandidateRelease(release, { verifyRuntime: true }),
      { code: 'CANDIDATE_RUNTIME_DEPENDENCIES_MISMATCH' });
    rmSync(shadow, { recursive: true });
    assert.equal(readCandidateRelease(release, { verifyRuntime: true }).runtimeBuildSha256, runtimeBuildSha256);
    const apiFile = path.join(release, 'apps/api/dist/index.js');
    const original = readFileSync(apiFile);
    writeFileSync(apiFile, 'export const stale = true;\n');
    assert.deepEqual(readCandidateRelease(release), baseline);
    assert.throws(() => readCandidateRelease(release, { verifyRuntime: true }),
      { code: 'CANDIDATE_RUNTIME_BUILD_MISMATCH' });
    writeFileSync(apiFile, original);
    rmSync(apiFile);
    assert.throws(() => readCandidateRelease(release, { verifyRuntime: true }),
      { code: 'CANDIDATE_RUNTIME_BUILD_MISMATCH' });
    assert.deepEqual(readCandidateRelease(release, { verifyRuntime: false }), baseline);
    for (const directory of runtimePackages) {
      assert.equal(existsSync(path.join(release, directory, 'SCRIPT_RAN')), false);
    }
    // A changed lockfile can be clean and committed yet incompatible with tooling.
    rmSync(path.join(release, 'apps/api/src/untracked.ts'));
    write(release, 'pnpm-lock.yaml', 'lockfileVersion: incompatible\n');
    const changedSha = commitCandidate(release);
    const changedRelease = path.join(root, changedSha);
    renameSync(release, changedRelease);
    assert.throws(() => readCandidateRelease(changedRelease, { verifyRuntime: true }),
      { code: 'CANDIDATE_RUNTIME_DEPENDENCIES_MISMATCH' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('complete build digest rejects extra, missing, altered and symlinked API artifacts', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'release-runtime-digest-'));
  try {
    const expected = path.join(root, 'rebuilt');
    const actual = path.join(root, 'apps/api/dist');
    const code = 'CANDIDATE_RUNTIME_BUILD_MISMATCH';
    write(expected, 'index.js', 'export const api = true;\n');
    write(expected, 'nested/entry.d.ts', 'export declare const api = true;\n');
    write(actual, 'nested/entry.d.ts', 'export declare const api = true;\n');
    write(actual, 'index.js', 'export const api = true;\n');
    const digest = assertCandidateBuildDigests(expected, actual, code);
    assert.match(digest, /^[a-f0-9]{64}$/u);
    write(actual, 'index.js', 'export const api = false;\n');
    assert.throws(() => assertCandidateBuildDigests(expected, actual, code), { code });
    copyFileSync(path.join(expected, 'index.js'), path.join(actual, 'index.js'));
    write(actual, 'stale.js', 'export {};\n');
    assert.throws(() => assertCandidateBuildDigests(expected, actual, code), { code });
    rmSync(path.join(actual, 'stale.js'));
    rmSync(path.join(actual, 'nested/entry.d.ts'));
    assert.throws(() => assertCandidateBuildDigests(expected, actual, code), { code });
    symlinkSync(path.join(expected, 'nested/entry.d.ts'), path.join(actual, 'nested/entry.d.ts'));
    assert.throws(() => assertCandidateBuildDigests(expected, actual, code), { code });
    rmSync(path.join(actual, 'nested/entry.d.ts'));
    copyFileSync(path.join(expected, 'nested/entry.d.ts'), path.join(actual, 'nested/entry.d.ts'));
    assert.equal(assertCandidateBuildDigests(expected, actual, code), digest);
    rmSync(actual, { recursive: true });
    assert.throws(() => assertCandidateBuildDigests(expected, actual, code), { code });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
