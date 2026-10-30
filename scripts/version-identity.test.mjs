import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatRunningIdentity } from '../apps/desktop/src/shared/running-identity.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const versionFile = path.join(here, '..', 'VERSION');
const desktopPackage = path.join(here, '..', 'apps/desktop/package.json');
const identityScript = path.join(here, '..', 'apps/desktop/scripts/write-build-identity.mjs');

test('VERSION matches the desktop package version', () => {
  const version = readFileSync(versionFile, 'utf8').trim();
  const desktop = JSON.parse(readFileSync(desktopPackage, 'utf8'));
  assert.equal(desktop.version, version);
  assert.match(version, /^\d+\.\d+\.\d+$/);
});

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull },
  }).trim();
}

function identityRepository(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-identity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const desktop = path.join(root, 'apps/desktop');
  mkdirSync(path.join(desktop, 'scripts'), { recursive: true });
  copyFileSync(identityScript, path.join(desktop, 'scripts/write-build-identity.mjs'));
  writeFileSync(path.join(root, 'VERSION'), '1.2.3\n');
  writeFileSync(path.join(root, '.gitignore'), '/apps/desktop/build/\n/ignored-output/\n');
  writeFileSync(path.join(root, 'source.txt'), 'original\n');
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  const sha = git(root, 'rev-parse', 'HEAD');
  const stamp = path.join(desktop, 'build/build-identity.json');
  return { root, desktop, sha, stamp };
}

function runIdentity(repository, ...args) {
  return spawnSync(process.execPath, ['scripts/write-build-identity.mjs', ...args], {
    cwd: repository.desktop,
    encoding: 'utf8',
  });
}

function assertIdentity(repository, expected, ...args) {
  const result = runIdentity(repository, ...args);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(repository.stamp, 'utf8')), {
    productVersion: '1.2.3',
    gitSha: expected,
  });
}

test('build identity reflects real Git working tree states', async (t) => {
  await t.test('clean and ignored output retain the full commit', (t) => {
    const repository = identityRepository(t);
    assertIdentity(repository, repository.sha);
    mkdirSync(path.join(repository.root, 'ignored-output'));
    writeFileSync(path.join(repository.root, 'ignored-output', 'artifact'), 'generated\n');
    assertIdentity(repository, repository.sha);
    assertIdentity(repository, repository.sha, 'distribution');
  });

  await t.test('unstaged and staged tracked changes are dirty', (t) => {
    const repository = identityRepository(t);
    writeFileSync(path.join(repository.root, 'source.txt'), 'modified\n');
    assertIdentity(repository, 'dirty');
    git(repository.root, 'add', 'source.txt');
    assertIdentity(repository, 'dirty');
  });

  await t.test('untracked non-ignored files are dirty', (t) => {
    const repository = identityRepository(t);
    writeFileSync(path.join(repository.root, 'new-source.txt'), 'new\n');
    assertIdentity(repository, 'dirty');
    const stamp = JSON.parse(readFileSync(repository.stamp, 'utf8'));
    assert.equal(formatRunningIdentity({ ...stamp, point: 'local' }), '1.2.3 · dirty · 本机');
  });

  await t.test('distribution rejects a dirty tree without replacing the previous stamp', (t) => {
    const repository = identityRepository(t);
    assertIdentity(repository, repository.sha, 'distribution');
    const original = readFileSync(repository.stamp, 'utf8');
    writeFileSync(path.join(repository.root, 'new-source.txt'), 'new\n');
    const result = runIdentity(repository, 'distribution');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /dirty/i);
    assert.equal(readFileSync(repository.stamp, 'utf8'), original);
    assertIdentity(repository, 'dirty', 'local');
  });

  await t.test('Git status errors do not replace the previous stamp', (t) => {
    const repository = identityRepository(t);
    assertIdentity(repository, repository.sha);
    const original = readFileSync(repository.stamp, 'utf8');
    writeFileSync(path.join(repository.root, '.git/index'), 'invalid index');
    const result = runIdentity(repository);
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(repository.stamp, 'utf8'), original);
  });
});
