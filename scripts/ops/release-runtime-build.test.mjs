import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertCandidateBuildDigests, assertCandidateRuntimeUnchanged, readCandidateRelease } from './backup-set.mjs';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const runtimePackages = [
  'contracts', 'retrieval-core', 'job-roster', 'unified-contracts',
  'content-intake', 'database',
].map((name) => `packages/${name}`).concat('apps/api');
const { parse: parseYaml, stringify: stringifyYaml } = createRequire(
  path.join(repositoryRoot, 'packages/contracts/package.json'),
)('yaml');
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

function createCandidate(root, { legacy = false } = {}) {
  const packages = legacy ? runtimePackages.filter(directory => directory !== 'packages/unified-contracts') : runtimePackages;
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
  for (const directory of packages) {
    mkdirSync(path.join(candidate, directory, 'src'), { recursive: true });
    for (const file of ['tsconfig.json', 'tsconfig.build.json']) {
      copyFileSync(path.join(repositoryRoot, directory, file), path.join(candidate, directory, file));
    }
    const metadata = JSON.parse(readFileSync(path.join(repositoryRoot, directory, 'package.json'), 'utf8'));
    if (legacy && directory === 'apps/api') {
      delete metadata.dependencies['@customer-agent/unified-contracts'];
      delete metadata.dependencies['@customer-agent/retrieval-core'];
    }
    if (legacy && directory === 'packages/contracts') {
      delete metadata.exports['./sop-unified'];
      delete metadata.exports['./sop-resource-disable'];
    }
    metadata.scripts = { build: 'node -e "require(\'fs\').writeFileSync(\'SCRIPT_RAN\', \'bad\')"' };
    write(candidate, `${directory}/package.json`, JSON.stringify(metadata));
    write(candidate, `${directory}/src/index.ts`, 'export const fixtureMarker = "synthetic-only";\n');
    symlinkSync(path.relative(path.join(modules, '@customer-agent'), path.join(candidate, directory)),
      path.join(modules, '@customer-agent', path.basename(directory)), 'dir');
  }
  if (legacy) {
    const lock = parseYaml(readFileSync(path.join(candidate, 'pnpm-lock.yaml'), 'utf8'));
    delete lock.importers['packages/unified-contracts'];
    delete lock.importers['apps/api'].dependencies['@customer-agent/unified-contracts'];
    delete lock.importers['apps/api'].dependencies['@customer-agent/retrieval-core'];
    delete lock.importers['apps/desktop'].dependencies['@customer-agent/unified-contracts'];
    write(candidate, 'pnpm-lock.yaml', stringifyYaml(lock));
  }
  write(candidate, 'packages/content-intake/src/workbook.ts', 'export const workbookMarker = "rebuilt-only";\n');
  write(candidate, 'packages/content-intake/src/runner.ts', 'export const runner = true;\n');
  write(candidate, 'packages/database/src/verifier.ts', 'export const verifier = true;\n');
  write(candidate, 'packages/database/src/generated/migrations.generated.ts', 'export const migrations = [];\n');
  write(candidate, 'apps/api/src/index.ts',
    'import { workbookMarker } from "@customer-agent/content-intake";\nexport const apiMarker = workbookMarker;\n');
  const compiler = path.join(repositoryRoot, 'packages/database/node_modules/typescript/bin/tsc');
  for (const directory of packages) {
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
    assert.doesNotThrow(() => assertCandidateRuntimeUnchanged(verified));
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
    symlinkSync(path.join(repositoryRoot, 'packages/content-intake'), contentLink, 'dir');
    assert.throws(() => assertCandidateRuntimeUnchanged(verified),
      { code: 'CANDIDATE_RUNTIME_DEPENDENCIES_MISMATCH' });
    rmSync(contentLink);
    symlinkSync(path.join(release, 'packages/content-intake'), contentLink, 'dir');
    const shadow = path.join(release, 'apps/api/node_modules/@customer-agent/content-intake');
    write(shadow, 'index.js', 'export const workbookMarker = "unverified-no-manifest";\n');
    assert.throws(() => readCandidateRelease(release, { verifyRuntime: true }),
      { code: 'CANDIDATE_RUNTIME_DEPENDENCIES_MISMATCH' });
    rmSync(shadow, { recursive: true });
    const databaseShadow = path.join(release, 'apps/api/node_modules/@customer-agent/database');
    symlinkSync(path.join(repositoryRoot, 'packages/database'), databaseShadow, 'dir');
    assert.throws(() => assertCandidateRuntimeUnchanged(verified),
      { code: 'CANDIDATE_RUNTIME_DEPENDENCIES_MISMATCH' });
    rmSync(databaseShadow);
    assert.equal(readCandidateRelease(release, { verifyRuntime: true }).runtimeBuildSha256, runtimeBuildSha256);
    const apiFile = path.join(release, 'apps/api/dist/index.js');
    const original = readFileSync(apiFile);
    writeFileSync(apiFile, 'export const stale = true;\n');
    assert.throws(() => assertCandidateRuntimeUnchanged(verified),
      { code: 'CANDIDATE_RUNTIME_BUILD_MISMATCH' });
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

test('historical workspace graph and exports rebuild without the later unified-contracts package', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'release-legacy-runtime-build-'));
  try {
    const release = createCandidate(root, { legacy: true });
    assert.equal(existsSync(path.join(release, 'packages/unified-contracts')), false);
    const verified = readCandidateRelease(release, { verifyRuntime: true });
    assert.match(verified.runtimeBuildSha256, /^[a-f0-9]{64}$/u);
    assert.doesNotThrow(() => assertCandidateRuntimeUnchanged(verified));
    const input = 'apps/api/src/index.ts';
    execFileSync('git', ['update-index', '--assume-unchanged', input], { cwd: release, env: gitEnvironment });
    write(release, input, 'export const hiddenChange = true;\n');
    assert.throws(() => assertCandidateRuntimeUnchanged(verified), { code: 'CANDIDATE_RELEASE_INVALID' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release metadata and lock reject missing required packages, unsupported workspaces and external drift', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'release-runtime-metadata-'));
  let release;
  try {
    release = createCandidate(root);
    const apiPath = 'apps/api/package.json';
    const apiText = readFileSync(path.join(release, apiPath), 'utf8');
    const lockText = readFileSync(path.join(release, 'pnpm-lock.yaml'), 'utf8');
    const unified = 'packages/unified-contracts';
    const savedUnified = path.join(root, 'saved-unified');
    const cases = [
      ['missing required workspace package', () => renameSync(path.join(release, unified), savedUnified)],
      ['missing required package metadata', () => rmSync(path.join(release, unified, 'package.json'))],
      ['invalid dependency map', metadata => { metadata.dependencies = []; }],
      ['null dependency map', metadata => { metadata.dependencies = null; }],
      ['cyclic workspace graph', metadata => { metadata.dependencies['@customer-agent/api'] = 'workspace:*'; }],
      ['invalid dependency value', metadata => { metadata.dependencies['@customer-agent/contracts'] = null; }],
      ['unsupported workspace name', metadata => { metadata.dependencies['@customer-agent/foreign'] = 'workspace:*'; }],
      ['workspace dependency using a registry version', metadata => { metadata.dependencies['@customer-agent/contracts'] = '1.0.0'; }],
      ['wrong package identity', metadata => { metadata.name = '@customer-agent/foreign'; }],
      ['escaping package export', metadata => { metadata.exports['.'].import = '../../foreign.js'; }],
      ['external dependency metadata drift', metadata => { metadata.dependencies.fastify = '5.0.0'; }],
      ['external integrity drift', () => {
        const lock = parseYaml(lockText);
        lock.packages['fastify@5.12.1'].resolution.integrity = 'sha512-untrusted';
        write(release, 'pnpm-lock.yaml', stringifyYaml(lock));
      }],
      ['invalid lock dependency map', () => {
        const lock = parseYaml(lockText);
        lock.importers['apps/api'].dependencies = [];
        write(release, 'pnpm-lock.yaml', stringifyYaml(lock));
      }],
      ['workspace lock points outside release', () => {
        const lock = parseYaml(lockText);
        lock.importers['apps/api'].dependencies['@customer-agent/contracts'].version = 'link:../../../tool/packages/contracts';
        write(release, 'pnpm-lock.yaml', stringifyYaml(lock));
      }],
    ];
    const unifiedMetadata = readFileSync(path.join(release, unified, 'package.json'));
    for (const [name, mutate] of cases) {
      await t.test(name, () => {
        const metadata = JSON.parse(apiText);
        mutate(metadata);
        write(release, apiPath, JSON.stringify(metadata));
        const sha = commitCandidate(release);
        const destination = path.join(root, sha);
        renameSync(release, destination);
        release = realpathSync(destination);
        assert.throws(() => readCandidateRelease(release, { verifyRuntime: true }),
          { code: 'CANDIDATE_RUNTIME_DEPENDENCIES_MISMATCH' });
        if (existsSync(savedUnified)) renameSync(savedUnified, path.join(release, unified));
        write(release, `${unified}/package.json`, unifiedMetadata);
        write(release, apiPath, apiText);
        write(release, 'pnpm-lock.yaml', lockText);
      });
    }
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
