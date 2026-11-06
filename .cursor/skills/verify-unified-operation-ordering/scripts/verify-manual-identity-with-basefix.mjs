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

export const BASEFIX_DEPENDENCY = Object.freeze({
  id: 'BASEFIX-01',
  commit: '1de1847bdc139fa1665ea36c51329a110460bd7b',
  file: Object.freeze({
    path: 'apps/api/tests/seat-lifecycle.integration.test.ts',
    sha256: 'd2f59d9829cf25a741e1017264a3ef75ffbc7fc14aaef7e1316b4a0ae50c2ab8',
  }),
  manualIdentity: Object.freeze({
    testFiles: Object.freeze([
      'tests/manual-identity-grants.integration.test.ts',
      'tests/manual-identity-property.test.ts',
      'tests/project-roster-login.integration.test.ts',
      'tests/roster-authority.integration.test.ts',
      'tests/a6-permission-e2e.integration.test.ts',
      'tests/p0-live-lanes.integration.test.ts',
      'tests/feishu-login-link.integration.test.ts',
      'tests/seat-login-flow.integration.test.ts',
      'tests/seat-lifecycle.integration.test.ts',
    ]),
    expected: Object.freeze({ testFiles: 9, tests: 38 }),
  }),
});

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
  dependency = BASEFIX_DEPENDENCY,
  testedHead: suppliedTestedHead = null,
} = {}) {
  const { commit } = dependency;
  try {
    git(repositoryRoot, ['cat-file', '-e', `${commit}^{commit}`]);
  } catch {
    throw new Error(`BASEFIX commit is not readable: ${commit}`);
  }
  const testedHead = suppliedTestedHead
    ?? git(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
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
  if (changedPaths.length !== 1 || changedPaths[0] !== dependency.file.path) {
    throw new Error(`BASEFIX must change only ${dependency.file.path}, actual: ${changedPaths.join(', ')}`);
  }
  const content = git(repositoryRoot, ['show', `${commit}:${dependency.file.path}`], { encoding: 'buffer' });
  const fileSha256 = createHash('sha256').update(content).digest('hex');
  if (fileSha256 !== dependency.file.sha256) {
    throw new Error(`BASEFIX file hash does not match ${dependency.id}`);
  }
  if (relationship === 'ancestor') {
    const testedContent = git(repositoryRoot, ['show', `${testedHead}:${dependency.file.path}`], {
      encoding: 'buffer',
    });
    const testedFileSha256 = createHash('sha256').update(testedContent).digest('hex');
    if (testedFileSha256 !== dependency.file.sha256) {
      throw new Error(`${dependency.file.path} changed after ${dependency.id}`);
    }
  }
  return Object.freeze({
    dependency,
    commit,
    parent,
    testedHead,
    relationship,
    changedPaths: Object.freeze(changedPaths),
    fileSha256,
    content,
  });
}

export function assertBaselineOwnedFileExcluded(
  sourceFiles,
  dependency = BASEFIX_DEPENDENCY,
) {
  if (sourceFiles.includes(dependency.file.path)) {
    throw new Error(`unified source must not own BASEFIX file: ${dependency.file.path}`);
  }
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
    writeFileSync(path.join(root, baseline.dependency.file.path), baseline.content);
    return root;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function assertManualIdentityResult(
  result,
  expected = BASEFIX_DEPENDENCY.manualIdentity.expected,
) {
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8') : String(result.stdout ?? '');
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : String(result.stderr ?? '');
  if (result.status !== 0 || result.error) {
    throw new Error(`manual identity command failed${result.error ? `: ${result.error.message}` : ''}\n${stderr || stdout}`);
  }
  const files = stdout.match(new RegExp(`Test Files\\s+${expected.testFiles} passed \\(${expected.testFiles}\\)`, 'u'));
  const tests = stdout.match(new RegExp(`Tests\\s+${expected.tests} passed \\(${expected.tests}\\)`, 'u'));
  if (!files || !tests) {
    throw new Error(
      `manual identity command did not report ${expected.testFiles} files / ${expected.tests} tests\n${stdout || stderr}`,
    );
  }
  return Object.freeze({ testFiles: expected.testFiles, tests: expected.tests });
}

export function runManualIdentityVerification({
  repositoryRoot = defaultRepositoryRoot,
  dependency = BASEFIX_DEPENDENCY,
  testedHead = null,
  commandRunner = spawnSync,
} = {}) {
  const baseline = resolveBaselineDependency({ repositoryRoot, dependency, testedHead });
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
      vitest, 'run', ...dependency.manualIdentity.testFiles,
    ], {
      cwd: path.join(integrationRoot, 'apps/api'),
      env: environment,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 180_000,
    });
    const counts = assertManualIdentityResult(result, dependency.manualIdentity.expected);
    return Object.freeze({
      schemaVersion: 'for-manual-identity-basefix-evidence/v2',
      testedHead: baseline.testedHead,
      baselineCommit: baseline.commit,
      baselineParent: baseline.parent,
      relationship: baseline.relationship,
      changedPaths: baseline.changedPaths,
      patchedFileSha256: baseline.fileSha256,
      integrationTree: baseline.relationship === 'ancestor'
        ? 'reuse-ancestor'
        : 'overlay-baseline',
      command: `${process.execPath} ${vitest} run ${dependency.manualIdentity.testFiles.join(' ')}`,
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
