import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkWorkspaceBudget,
  cleanWorkspace,
  parseCliArguments,
  resolveCleanupTarget,
  workspaceInventory,
} from '../../scripts/workspace-hygiene.mjs';

const fixtures: string[] = [];

function createWorkspaceFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-hygiene-'));
  fixtures.push(root);
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'customer-agent-demo' }),
  );
  for (const relativePath of [
    'release/local-unsigned/package.bin',
    'out/main.js',
    'test-results/result.json',
    'playwright-report/index.html',
    '.gstack/qa-reports/screenshot.png',
    'build/icon.png',
    'build/icon.ico',
    'build/icon.icns',
    'build/entitlements.mac.plist',
    'node_modules/.vite/cache.bin',
    'node_modules/.vite-temp/cache.bin',
    'node_modules/electron/runtime.bin',
    '.codegraph/codegraph.db',
    '.git/HEAD',
    'src/main.ts',
    'assets/fox.png',
    'evidence/qa/frozen.png',
    'clawd-on-desk-0.15.0.zip',
  ]) {
    const absolutePath = path.join(root, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, relativePath.repeat(4));
  }
  return root;
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

describe('workspace hygiene', () => {
  it('fails closed for unknown CLI flags instead of overriding an apply command', () => {
    expect(parseCliArguments(['clean', '--scope=generated'])).toMatchObject({
      command: 'clean',
      scope: 'generated',
      apply: false,
    });
    expect(parseCliArguments(['clean', '--scope=generated', '--apply'])).toMatchObject({
      command: 'clean',
      scope: 'generated',
      apply: true,
    });
    expect(() => parseCliArguments([
      'clean',
      '--scope=generated',
      '--apply',
      '--dry-run',
    ])).toThrow(/Unknown cleanup option: --dry-run/);
  });

  it('reports generated packages and dependencies separately from the small workspace remainder', () => {
    const root = createWorkspaceFixture();
    const inventory = workspaceInventory(root);
    const categories = new Map(
      inventory.categories.map((category) => [category.key, category.bytes]),
    );

    expect(inventory.totalBytes).toBeGreaterThan(0);
    expect(categories.get('release')).toBeGreaterThan(0);
    expect(categories.get('dependencies')).toBeGreaterThan(0);
    expect(categories.get('workspace-remainder')).toBeGreaterThan(0);
  });

  it('keeps the source budget independent from generated packages and dependencies', () => {
    const root = createWorkspaceFixture();
    const result = checkWorkspaceBudget(root, { remainderBudgetBytes: 32 * 1024 * 1024 });

    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.remainderBytes).toBeLessThan(result.remainderBudgetBytes);
  });

  it('fails when checked-in workspace remainder exceeds the explicit budget', () => {
    const root = createWorkspaceFixture();
    writeFileSync(path.join(root, 'docs-large.bin'), Buffer.alloc(1024));
    const result = checkWorkspaceBudget(root, { remainderBudgetBytes: 1 });

    expect(result.pass).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({ key: 'workspace-remainder', budgetBytes: 1 }),
    ]);
  });

  it('rejects invalid or negative source budgets instead of silently passing', () => {
    const root = createWorkspaceFixture();

    expect(() => checkWorkspaceBudget(root, { remainderBudgetBytes: Number.NaN })).toThrow(
      /Invalid workspace remainder budget/,
    );
    expect(() => checkWorkspaceBudget(root, { remainderBudgetBytes: -1 })).toThrow(
      /Invalid workspace remainder budget/,
    );
  });

  it('keeps cleanup as a dry run unless apply is explicit', () => {
    const root = createWorkspaceFixture();
    const result = cleanWorkspace({ projectRoot: root, scope: 'generated' });

    expect(result.apply).toBe(false);
    expect(result.totalBytes).toBeGreaterThan(0);
    expect(existsSync(path.join(root, 'release/local-unsigned/package.bin'))).toBe(true);
    expect(existsSync(path.join(root, 'out/main.js'))).toBe(true);
  });

  it('removes only allowlisted generated outputs and preserves dependencies and protected content', () => {
    const root = createWorkspaceFixture();
    cleanWorkspace({ projectRoot: root, scope: 'generated', apply: true });

    expect(existsSync(path.join(root, 'release/local-unsigned'))).toBe(false);
    expect(existsSync(path.join(root, 'out'))).toBe(false);
    expect(existsSync(path.join(root, 'node_modules/.vite'))).toBe(false);
    expect(existsSync(path.join(root, 'build/icon.png'))).toBe(false);
    expect(existsSync(path.join(root, 'build/icon.ico'))).toBe(false);
    expect(existsSync(path.join(root, 'build/icon.icns'))).toBe(false);
    expect(existsSync(path.join(root, 'build/entitlements.mac.plist'))).toBe(true);
    expect(existsSync(path.join(root, 'node_modules/electron/runtime.bin'))).toBe(true);
    expect(readFileSync(path.join(root, '.git/HEAD'), 'utf8')).toContain('.git/HEAD');
    expect(existsSync(path.join(root, '.codegraph/codegraph.db'))).toBe(true);
    expect(existsSync(path.join(root, 'src/main.ts'))).toBe(true);
    expect(existsSync(path.join(root, 'assets/fox.png'))).toBe(true);
    expect(existsSync(path.join(root, 'evidence/qa/frozen.png'))).toBe(true);
    expect(existsSync(path.join(root, 'clawd-on-desk-0.15.0.zip'))).toBe(true);
  });

  it('removes dependencies only in the explicit deep scope', () => {
    const root = createWorkspaceFixture();
    cleanWorkspace({ projectRoot: root, scope: 'deep', apply: true });

    expect(existsSync(path.join(root, 'node_modules'))).toBe(false);
    expect(existsSync(path.join(root, '.git/HEAD'))).toBe(true);
    expect(existsSync(path.join(root, 'src/main.ts'))).toBe(true);
  });

  it('fails closed for unknown roots, non-allowlisted paths, and symlink targets', () => {
    const wrongRoot = mkdtempSync(path.join(os.tmpdir(), 'other-workspace-'));
    fixtures.push(wrongRoot);
    writeFileSync(path.join(wrongRoot, 'package.json'), JSON.stringify({ name: 'other' }));
    expect(() => cleanWorkspace({ projectRoot: wrongRoot })).toThrow(
      /unexpected workspace package/,
    );

    const root = createWorkspaceFixture();
    expect(() => resolveCleanupTarget(root, '.git')).toThrow(/non-allowlisted/);
    expect(() => resolveCleanupTarget(root, 'src')).toThrow(/non-allowlisted/);
    expect(() => resolveCleanupTarget(root, '../outside')).toThrow(/non-allowlisted/);

    rmSync(path.join(root, 'out'), { recursive: true, force: true });
    symlinkSync(os.tmpdir(), path.join(root, 'out'));
    expect(() => resolveCleanupTarget(root, 'out')).toThrow(/symlink cleanup target/);
  });

  it('validates the full plan before removing an earlier target', () => {
    const root = createWorkspaceFixture();
    rmSync(path.join(root, '.gstack/qa-reports'), { recursive: true, force: true });
    symlinkSync(os.tmpdir(), path.join(root, '.gstack/qa-reports'));

    expect(() => cleanWorkspace({
      projectRoot: root,
      scope: 'generated',
      apply: true,
    })).toThrow(/symlink cleanup target/);
    expect(existsSync(path.join(root, 'release/local-unsigned/package.bin'))).toBe(true);
    expect(existsSync(path.join(root, 'out/main.js'))).toBe(true);
  });
});
