import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(scriptDirectory, '../../../..');
const defaultBaselineCommit = '1de1847bdc139fa1665ea36c51329a110460bd7b';
const seatLifecyclePath = 'apps/api/tests/seat-lifecycle.integration.test.ts';
const manualIdentityTests = Object.freeze([
  'tests/manual-identity-grants.integration.test.ts',
  'tests/manual-identity-property.test.ts',
  'tests/project-roster-login.integration.test.ts',
  'tests/roster-authority.integration.test.ts',
  'tests/a6-permission-e2e.integration.test.ts',
  'tests/p0-live-lanes.integration.test.ts',
  'tests/feishu-login-link.integration.test.ts',
  'tests/seat-login-flow.integration.test.ts',
  'tests/seat-lifecycle.integration.test.ts',
]);

function git(repositoryRoot, args, options = {}) {
  return execFileSync('git', ['-C', repositoryRoot, ...args], {
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function commandFailure(label, result) {
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : String(result.stderr ?? '');
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8') : String(result.stdout ?? '');
  return `${label} failed with status ${String(result.status)}${result.error ? `: ${result.error.message}` : ''}\n${stderr || stdout}`;
}

export function resolveBaselineDependency({
  repositoryRoot = defaultRepositoryRoot,
  commit = defaultBaselineCommit,
} = {}) {
  try {
    git(repositoryRoot, ['cat-file', '-e', `${commit}^{commit}`]);
  } catch {
    throw new Error(`BASEFIX commit is not readable: ${commit}`);
  }
  const testedHead = git(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  const parent = git(repositoryRoot, ['rev-parse', '--verify', `${commit}^`]).trim();
  const parentAncestor = spawnSync('git', [
    '-C', repositoryRoot, 'merge-base', '--is-ancestor', parent, testedHead,
  ]).status === 0;
  if (!parentAncestor) {
    throw new Error(`BASEFIX parent ${parent} is not an ancestor of tested head ${testedHead}`);
  }
  const baselineAncestor = spawnSync('git', [
    '-C', repositoryRoot, 'merge-base', '--is-ancestor', commit, testedHead,
  ]).status === 0;
  const relationship = baselineAncestor ? 'ancestor' : 'not-ancestor';
  const changedPaths = git(repositoryRoot, ['diff', '--name-only', parent, commit])
    .trim().split('\n').filter(Boolean);
  if (changedPaths.length !== 1 || changedPaths[0] !== seatLifecyclePath) {
    throw new Error(`BASEFIX must change only ${seatLifecyclePath}, actual: ${changedPaths.join(', ')}`);
  }
  const content = git(repositoryRoot, ['show', `${commit}:${seatLifecyclePath}`], { encoding: 'buffer' });
  return Object.freeze({
    commit,
    parent,
    testedHead,
    relationship,
    changedPaths: Object.freeze(changedPaths),
    fileSha256: createHash('sha256').update(content).digest('hex'),
    content,
  });
}

function workspaceNodeModules(repositoryRoot) {
  const directories = [];
  if (existsSync(path.join(repositoryRoot, 'node_modules'))) {
    directories.push('node_modules');
  }
  for (const group of ['apps', 'packages']) {
    const root = path.join(repositoryRoot, group);
    if (!existsSync(root)) continue;
    for (const project of readdirSync(root, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const relative = path.join(group, project.name, 'node_modules');
      if (existsSync(path.join(repositoryRoot, relative))) directories.push(relative);
    }
  }
  return directories;
}

export function createIntegrationTree({
  repositoryRoot = defaultRepositoryRoot,
  baseline,
} = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'for-01-manual-identity-'));
  try {
    const archive = git(repositoryRoot, ['archive', '--format=tar', baseline.testedHead], { encoding: 'buffer' });
    const extracted = spawnSync('tar', ['-x', '-C', root], {
      input: archive,
      timeout: 30_000,
    });
    if (extracted.status !== 0) throw new Error(commandFailure('tree extraction', extracted));
    for (const relative of workspaceNodeModules(repositoryRoot)) {
      const destination = path.join(root, relative);
      mkdirSync(path.dirname(destination), { recursive: true });
      symlinkSync(path.join(repositoryRoot, relative), destination, 'dir');
    }
    writeFileSync(path.join(root, seatLifecyclePath), baseline.content);
    return root;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function assertManualIdentityResult(result) {
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8') : String(result.stdout ?? '');
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : String(result.stderr ?? '');
  if (result.status !== 0 || result.error) {
    throw new Error(`manual identity command failed${result.error ? `: ${result.error.message}` : ''}\n${stderr || stdout}`);
  }
  const files = stdout.match(/Test Files\s+9 passed \(9\)/u);
  const tests = stdout.match(/Tests\s+38 passed \(38\)/u);
  if (!files || !tests) {
    throw new Error(`manual identity command did not report 9 files / 38 tests\n${stdout || stderr}`);
  }
  return Object.freeze({ testFiles: 9, tests: 38 });
}

export function runManualIdentityVerification({
  repositoryRoot = defaultRepositoryRoot,
  baselineCommit = defaultBaselineCommit,
  commandRunner = spawnSync,
} = {}) {
  const baseline = resolveBaselineDependency({ repositoryRoot, commit: baselineCommit });
  const integrationRoot = createIntegrationTree({ repositoryRoot, baseline });
  const startedAt = Date.now();
  try {
    const environment = {
      ...process.env,
      CUSTOMER_AGENT_API_PG15_INTEGRATION: '1',
      CUSTOMER_AGENT_PG15_BIN: process.env.CUSTOMER_AGENT_PG15_BIN
        ?? '/Users/hutou/homebrew/opt/postgresql@15/bin',
      FORCE_COLOR: '0',
    };
    const vitest = path.join(repositoryRoot, 'apps/api/node_modules/vitest/vitest.mjs');
    const result = commandRunner(process.execPath, [
      vitest, 'run', ...manualIdentityTests,
    ], {
      cwd: path.join(integrationRoot, 'apps/api'),
      env: environment,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 180_000,
    });
    const counts = assertManualIdentityResult(result);
    return Object.freeze({
      schemaVersion: 'for-manual-identity-basefix-evidence/v1',
      testedHead: baseline.testedHead,
      baselineCommit: baseline.commit,
      baselineParent: baseline.parent,
      relationship: baseline.relationship,
      changedPaths: baseline.changedPaths,
      patchedFileSha256: baseline.fileSha256,
      integrationTree: baseline.relationship === 'ancestor'
        ? 'tested head already contains BASEFIX'
        : 'temporary git archive; only BASEFIX blob replaced',
      command: `${process.execPath} ${vitest} run ${manualIdentityTests.join(' ')}`,
      testFiles: counts.testFiles,
      tests: counts.tests,
      durationMs: Date.now() - startedAt,
      errorCount: 0,
      passed: true,
    });
  } finally {
    rmSync(integrationRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const evidence = runManualIdentityVerification();
    console.log(JSON.stringify(evidence, null, 2));
  } catch (error) {
    console.error(`BASEFIX_ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
