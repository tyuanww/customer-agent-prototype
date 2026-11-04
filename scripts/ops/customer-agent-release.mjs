#!/usr/bin/env node
/**
 * Dry-run by default. `--apply` repoints `current` only inside the `--root`
 * argument. `/srv/customer-agent` is the live tree in the Hangzhou runbook
 * and is refused so this process cannot switch that symlink.
 *
 * Migration ids come from each release's manifest. A shorter or forked list
 * is not reversed. Schema rollback needs a backup restore.
 *
 * Remote copy, a remote shell, and the stack unit restart are printed and
 * never run. `--root` and `--bundle` are required because those paths are
 * not in this repo.
 *
 *   node scripts/ops/customer-agent-release.mjs --root <dir> --sha <40-hex> --bundle <path>
 *   node scripts/ops/customer-agent-release.mjs --root <dir> --sha <40-hex> --bundle <path> --expected-version <x.y.z> --apply
 *   node scripts/ops/customer-agent-release.mjs --rollback-schema
 */
import {
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const LIVE_ROOT = '/srv/customer-agent';
const RELEASES_DIR = 'releases';
const CURRENT_LINK = 'current';
const MANIFEST = 'packages/database/migrations/manifest.generated.json';
const STACK_ENTRY = 'scripts/synthetic-stack/stack.ts';
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

function log(message) {
  console.info(`${new Date().toISOString()} ${message}`);
}

function fail(message) {
  console.error(`${new Date().toISOString()} FATAL ${message}`);
  process.exit(1);
}

function parseArguments(argv) {
  const options = {
    apply: false,
    dryRun: false,
    rollbackSchema: false,
    root: null,
    sha: null,
    bundle: null,
    expectedVersion: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) fail(`${argument} needs a value`);
      index += 1;
      return next;
    };
    if (argument === '--apply') options.apply = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--rollback-schema') options.rollbackSchema = true;
    else if (argument === '--root') options.root = value();
    else if (argument === '--sha') options.sha = value();
    else if (argument === '--bundle') options.bundle = value();
    else if (argument === '--expected-version') options.expectedVersion = value();
    else fail(`unknown argument ${argument}`);
  }
  return options;
}

function isLive(candidate) {
  const normalized = path.resolve(candidate);
  return normalized === LIVE_ROOT || normalized.startsWith(`${LIVE_ROOT}/`);
}

function assertSingleLine(label, candidate) {
  if (candidate.includes('\n') || candidate.includes('\r') || candidate.includes('\0')) {
    fail(`${label} must be a single line`);
  }
}

function migrationIds(manifestPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    fail(`manifest unreadable: ${manifestPath}`);
  }
  if (!parsed || !Array.isArray(parsed.migrations)) fail(`manifest migrations missing: ${manifestPath}`);
  const seen = new Set();
  const rows = parsed.migrations.map((row) => {
    if (
      !row
      || typeof row.position !== 'number'
      || !Number.isInteger(row.position)
      || typeof row.id !== 'string'
      || row.id.length === 0
    ) {
      fail(`manifest row is not a migration: ${manifestPath}`);
    }
    if (seen.has(row.position)) fail(`duplicate migration position ${row.position}: ${manifestPath}`);
    seen.add(row.position);
    return { position: row.position, id: row.id };
  });
  rows.sort((left, right) => left.position - right.position);
  return rows.map((row) => row.id);
}

function ledgerMove(currentIds, nextIds) {
  const shared = Math.min(currentIds.length, nextIds.length);
  for (let index = 0; index < shared; index += 1) {
    if (currentIds[index] !== nextIds[index]) return 'diverged';
  }
  if (nextIds.length > currentIds.length) return 'forward';
  if (nextIds.length < currentIds.length) return 'behind';
  return 'unchanged';
}

function removeStalePointer(linkPath) {
  const temporary = `${linkPath}.next`;
  let stat;
  try {
    stat = lstatSync(temporary);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    fail(`cannot inspect ${temporary}`);
  }
  if (!stat.isSymbolicLink() && !stat.isFile()) fail(`refusing to remove ${temporary}`);
  unlinkSync(temporary);
}

function point(linkPath, targetText) {
  const temporary = `${linkPath}.next`;
  removeStalePointer(linkPath);
  symlinkSync(targetText, temporary);
  renameSync(temporary, linkPath);
}

function releaseEntryReady(releaseDir) {
  const entry = path.join(releaseDir, STACK_ENTRY);
  try {
    return lstatSync(entry).isFile();
  } catch (error) {
    if (error.code !== 'ENOENT') fail(`cannot read ${entry}`);
    return false;
  }
}

function productVersion(releaseDir, label) {
  let rootVersion;
  let packageDocument;
  try {
    rootVersion = readFileSync(path.join(releaseDir, 'VERSION'), 'utf8').trim();
    packageDocument = JSON.parse(readFileSync(path.join(releaseDir, 'apps/desktop/package.json'), 'utf8'));
  } catch {
    fail(`${label} version identity is unreadable`);
  }
  if (!VERSION_PATTERN.test(rootVersion) || packageDocument?.version !== rootVersion) {
    fail(`${label} version identity is invalid`);
  }
  return rootVersion;
}

function releaseGitState(releaseDir, label, requireClean) {
  let output;
  try {
    output = execFileSync('git', ['-C', releaseDir, 'rev-parse', '--verify', 'HEAD^{commit}'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: os.devNull,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_OPTIONAL_LOCKS: '0',
      },
    }).trim();
  } catch {
    fail(`${label} Git HEAD is unreadable`);
  }
  let status;
  try {
    // Build output is intentionally untracked. Tracked edits would make the
    // executable no longer match the approved source revision.
    status = execFileSync('git', ['-C', releaseDir, 'status', '--porcelain=v1', '--untracked-files=no'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: os.devNull,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_OPTIONAL_LOCKS: '0',
      },
    });
  } catch {
    fail(`${label} Git status is unreadable`);
  }
  if (!SHA_PATTERN.test(output)) fail(`${label} Git HEAD is invalid`);
  if (path.basename(releaseDir) !== output) fail(`${label} directory does not match Git HEAD`);
  if (requireClean && status.length > 0) fail(`${label} Git tracked files are dirty`);
  return Object.freeze({ gitSha: output, clean: status.length === 0 });
}

function assertReleaseReady(releaseDir, expectedSha, expectedVersion, requireClean = true) {
  const version = productVersion(releaseDir, 'release');
  const git = releaseGitState(releaseDir, 'release', requireClean);
  if (git.gitSha !== expectedSha) fail(`release Git HEAD ${git.gitSha} does not match requested ${expectedSha}`);
  if (expectedVersion !== null && version !== expectedVersion) {
    fail(`release version ${version} does not match expected ${expectedVersion}`);
  }
  if (!releaseEntryReady(releaseDir)) fail(`release missing ${STACK_ENTRY}`);
  return Object.freeze({ version, gitSha: git.gitSha });
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.rollbackSchema) {
    log('a schema rollback needs a backup restore');
    process.exit(1);
  }
  if (options.apply && options.dryRun) fail('pass only one of --apply and --dry-run');
  if (options.apply && options.expectedVersion === null) {
    fail('--expected-version is required with --apply');
  }
  if (!options.root) fail('--root is required');
  if (!options.sha) fail('--sha is required');
  if (!options.bundle) fail('--bundle is required');
  assertSingleLine('root', options.root);
  assertSingleLine('bundle', options.bundle);
  if (!SHA_PATTERN.test(options.sha)) fail('sha must be 40 lowercase hex characters');
  if (options.expectedVersion !== null && !VERSION_PATTERN.test(options.expectedVersion)) {
    fail('expected version must be x.y.z');
  }
  if (isLive(options.root)) fail(`refusing live root ${options.root}`);

  let resolved;
  try {
    resolved = realpathSync(options.root);
  } catch {
    fail(`root missing: ${options.root}`);
  }
  if (isLive(resolved)) fail(`refusing live root ${resolved}`);

  const linkPath = path.join(resolved, CURRENT_LINK);
  let targetText;
  try {
    targetText = readlinkSync(linkPath);
  } catch {
    fail(`current symlink missing: ${linkPath}`);
  }
  const currentAbsolute = path.resolve(path.dirname(linkPath), targetText);
  if (isLive(currentAbsolute)) fail(`refusing live symlink target ${targetText}`);

  const releaseDir = path.join(resolved, RELEASES_DIR, options.sha);
  let releaseResolved;
  try {
    releaseResolved = realpathSync(releaseDir);
  } catch {
    fail(`release tree missing: ${releaseDir}`);
  }
  if (isLive(releaseResolved)) fail(`refusing live release ${releaseResolved}`);
  const releasesRoot = realpathSync(path.join(resolved, RELEASES_DIR));
  if (releaseResolved !== path.join(releasesRoot, options.sha)) {
    fail(`release escapes ${releasesRoot}`);
  }

  let currentResolved;
  try {
    currentResolved = realpathSync(currentAbsolute);
  } catch {
    fail(`current target missing: ${targetText}`);
  }
  if (!currentResolved.startsWith(`${releasesRoot}/`)) {
    fail(`current is not a release: ${targetText}`);
  }

  const currentIds = migrationIds(path.join(currentResolved, MANIFEST));
  const nextIds = migrationIds(path.join(releaseResolved, MANIFEST));
  const move = ledgerMove(currentIds, nextIds);
  const currentVersion = productVersion(currentResolved, 'current release');
  const currentGit = releaseGitState(currentResolved, 'current release', false);
  const alreadyCurrent = currentResolved === releaseResolved;
  const next = assertReleaseReady(releaseResolved, options.sha, options.expectedVersion, !alreadyCurrent);

  log(`mode ${options.apply ? 'apply' : 'dry-run'}`);
  log(`root ${resolved}`);
  log(`sha ${options.sha}`);
  log(`bundle ${options.bundle}`);
  log(`current version ${currentVersion}`);
  log(`current git sha ${currentGit.gitSha}`);
  log(`next version ${next.version}`);
  log(`next git sha ${next.gitSha}`);
  log(`stack entry: present`);
  log('skip: git fetch origin');
  log(`skip: git bundle create ${options.bundle} origin/main`);
  log(`skip: git bundle list-heads ${options.bundle}`);
  log(`skip: expect ${options.sha} refs/remotes/origin/main`);
  log('skip: remote copy');
  log('skip: remote shell');
  log('skip: pnpm install --frozen-lockfile');
  log('skip: pnpm build:services');
  log(`skip: chown -R customer-agent:customer-agent ${releaseDir}`);
  if (move === 'forward') log('migration ledger would move forward');
  else log('migration ledger would not move forward');
  if (move === 'behind' || move === 'diverged') log('a schema rollback needs a backup restore');

  const linkCommand = `ln -sfn ${releaseDir} ${linkPath}`;
  if (!options.apply) {
    log(`dry-run: ${linkCommand}`);
    log('skip: systemctl restart customer-agent-stack');
    log('nothing changed');
    return;
  }
  if (move === 'diverged') {
    log('skip: systemctl restart customer-agent-stack');
    fail('refusing to switch onto a forked migration ledger');
  }
  if (alreadyCurrent) {
    log('current already points at the release');
    log('skip: systemctl restart customer-agent-stack');
    return;
  }

  log(`apply: ${linkCommand}`);
  const previous = targetText;
  point(linkPath, releaseDir);
  if (readlinkSync(linkPath) !== releaseDir) {
    point(linkPath, previous);
    log(`symlink restored to previous target ${previous}`);
    fail('symlink did not stay on the release');
  }
  log('skip: systemctl restart customer-agent-stack');
  log(`symlink switched to ${releaseDir}`);
}

main();
