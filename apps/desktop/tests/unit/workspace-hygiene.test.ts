import {
  existsSync,
  linkSync,
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
  checkWorkspacePolicy,
  cleanWorkspace,
  parseCliArguments,
  resolveCleanupTarget,
  workspaceInventory,
} from '../../../../scripts/workspace-hygiene.mjs';

const fixtures: string[] = [];

function createWorkspaceFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-hygiene-'));
  fixtures.push(root);
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'customer-agent-demo',
      packageManager: 'pnpm@11.19.0',
      engines: { node: '>=24 <25', pnpm: '11.19.0' },
    }),
  );
  writeFileSync(
    path.join(root, 'pnpm-workspace.yaml'),
    "packages:\n  - 'apps/*'\n  - 'packages/*'\n",
  );
  mkdirSync(path.join(root, 'apps/api'), { recursive: true });
  writeFileSync(
    path.join(root, 'apps/api/package.json'),
    JSON.stringify({ name: '@customer-agent/api', private: true }),
  );
  mkdirSync(path.join(root, 'apps/desktop'), { recursive: true });
  writeFileSync(
    path.join(root, 'apps/desktop/package.json'),
    JSON.stringify({ name: '@customer-agent/desktop', version: '0.2.0', private: true }),
  );
  mkdirSync(path.join(root, 'packages/contracts'), { recursive: true });
  writeFileSync(
    path.join(root, 'packages/contracts/package.json'),
    JSON.stringify({ name: '@customer-agent/contracts', private: true }),
  );
  mkdirSync(path.join(root, 'packages/database'), { recursive: true });
  writeFileSync(
    path.join(root, 'packages/database/package.json'),
    JSON.stringify({ name: '@customer-agent/database', private: true }),
  );
  for (const relativePath of [
    'release/local-unsigned/package.bin',
    'apps/api/dist/main.js',
    'apps/api/experiments/search-decision/.generated/search-decision.ts',
    'apps/api/node_modules/fastify/runtime.js',
    'packages/database/dist/index.js',
    'packages/database/node_modules/pg/runtime.js',
    'apps/desktop/out/main.js',
    'apps/desktop/test-results/result.json',
    'apps/desktop/playwright-report/index.html',
    'apps/desktop/build/icon.png',
    'apps/desktop/build/icon.ico',
    'apps/desktop/build/icon.icns',
    'apps/desktop/build/entitlements.mac.plist',
    'apps/desktop/node_modules/.vite/cache.bin',
    'apps/desktop/node_modules/.vite-temp/cache.bin',
    'apps/desktop/node_modules/electron/runtime.bin',
    'apps/desktop/src/main.ts',
    'apps/desktop/assets/fox.png',
    // Stale W0 outputs remain safe, explicit cleanup targets after the move.
    'out/main.js',
    'test-results/result.json',
    'playwright-report/index.html',
    'build/icon.png',
    'build/icon.ico',
    'build/icon.icns',
    '.gstack/qa-reports/screenshot.png',
    'node_modules/.vite/cache.bin',
    'node_modules/.vite-temp/cache.bin',
    '.codegraph/codegraph.db',
    '.git/HEAD',
    'evidence/qa/frozen.png',
    'clawd-on-desk-0.15.0.zip',
  ]) {
    const absolutePath = path.join(root, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, relativePath.repeat(4));
  }
  writeFileSync(path.join(root, '.gstack/package-json-path'), 'apps/desktop/package.json\n');
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
    expect(categories.get('api-dependencies')).toBeGreaterThan(0);
    expect(categories.get('database-dependencies')).toBeGreaterThan(0);
    expect(categories.get('workspace-remainder')).toBeGreaterThan(0);
  });

  it('keeps the source budget independent from generated packages and dependencies', () => {
    const root = createWorkspaceFixture();
    const result = checkWorkspaceBudget(root, { remainderBudgetBytes: 32 * 1024 * 1024 });

    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.remainderBytes).toBeLessThan(result.remainderBudgetBytes);
  });

  it.each([
    'packages/contracts/dist/index.js',
    'packages/content-intake/dist/workbook.js',
    'packages/retrieval-core/dist/index.js',
    'packages/contracts/node_modules/tool/runtime.js',
    'packages/content-intake/node_modules/tool/runtime.js',
    'packages/retrieval-core/node_modules/tool/runtime.js',
    'apps/desktop/build/icon.png',
    'apps/desktop/build/icon.ico',
    'apps/desktop/build/icon.icns',
    'build/icon.png',
    'build/icon.ico',
    'build/icon.icns',
  ])('keeps growing rebuildable output out of the source budget: %s', (relativePath) => {
    const root = createWorkspaceFixture();
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, 'small');
    const before = checkWorkspaceBudget(root);

    writeFileSync(target, Buffer.alloc(128 * 1024, 'x'));
    const after = checkWorkspaceBudget(root, { remainderBudgetBytes: before.remainderBytes });

    expect(after.totalBytes).toBeGreaterThan(before.totalBytes);
    expect(after.remainderBytes).toBe(before.remainderBytes);
    expect(after.pass).toBe(true);
  });

  it.each([
    'contracts/upstream/customer-agent/frozen/schema.sql',
    'packages/database/migrations/0001_frozen.sql',
    'packages/contracts/src/generated/openapi.generated.ts',
    'evidence/qa/frozen.log',
    'apps/desktop/build/entitlements.mac.plist',
    'apps/desktop/build/unrecognized.bin',
  ])('continues to count protected inputs and unknown outputs: %s', (relativePath) => {
    const root = createWorkspaceFixture();
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, 'small');
    const before = checkWorkspaceBudget(root);

    writeFileSync(target, Buffer.alloc(128 * 1024, 'x'));
    const after = checkWorkspaceBudget(root, { remainderBudgetBytes: before.remainderBytes });

    expect(after.remainderBytes).toBeGreaterThan(before.remainderBytes);
    expect(after.pass).toBe(false);
  });

  it('pins the root toolchain and declares the staged monorepo targets', () => {
    const root = createWorkspaceFixture();
    const result = checkWorkspacePolicy(root);

    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.workspacePatterns).toEqual(['apps/*', 'packages/*']);
    expect(result).toMatchObject({
      packageManager: 'pnpm@11.19.0',
      nodeEngine: '>=24 <25',
      pnpmEngine: '11.19.0',
      runtimeNodeVersion: expect.stringMatching(/^24\./),
    });
  });

  it('rejects a runtime outside Node 24 even when package metadata is correct', () => {
    const root = createWorkspaceFixture();
    const result = checkWorkspacePolicy(root, { nodeVersion: '25.8.2' });

    expect(result.pass).toBe(false);
    expect(result.violations).toContainEqual(expect.objectContaining({
      code: 'NODE_RUNTIME_MISMATCH',
      expected: '24.x',
      actual: '25.8.2',
    }));
  });

  it('requires the private workspace package manifests with no toolchain overrides', () => {
    const missingApiRoot = createWorkspaceFixture();
    rmSync(path.join(missingApiRoot, 'apps/api/package.json'));
    expect(checkWorkspacePolicy(missingApiRoot).violations).toContainEqual(
      expect.objectContaining({
        code: 'WORKSPACE_TARGET_MANIFEST_MISSING',
        path: 'apps/api/package.json',
      }),
    );

    const missingRoot = createWorkspaceFixture();
    rmSync(path.join(missingRoot, 'apps/desktop/package.json'));
    expect(checkWorkspacePolicy(missingRoot).violations).toContainEqual(expect.objectContaining({
      code: 'WORKSPACE_TARGET_MANIFEST_MISSING',
      path: 'apps/desktop/package.json',
    }));

    const wrongRoot = createWorkspaceFixture();
    writeFileSync(
      path.join(wrongRoot, 'apps/desktop/package.json'),
      JSON.stringify({
        name: 'duplicate-root-app',
        private: false,
        packageManager: 'pnpm@11.19.0',
        engines: { node: '>=24 <25' },
      }),
    );
    expect(checkWorkspacePolicy(wrongRoot).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WORKSPACE_TARGET_PACKAGE_NAME_MISMATCH' }),
      expect.objectContaining({ code: 'WORKSPACE_TARGET_PACKAGE_NOT_PRIVATE' }),
      expect.objectContaining({
        code: 'WORKSPACE_TARGET_TOOLCHAIN_OVERRIDE_FORBIDDEN',
        actual: 'packageManager,engines',
      }),
    ]));

    const missingContractsRoot = createWorkspaceFixture();
    rmSync(path.join(missingContractsRoot, 'packages/contracts/package.json'));
    expect(checkWorkspacePolicy(missingContractsRoot).violations).toContainEqual(
      expect.objectContaining({
        code: 'WORKSPACE_TARGET_MANIFEST_MISSING',
        path: 'packages/contracts/package.json',
      }),
    );

    const missingDatabaseRoot = createWorkspaceFixture();
    rmSync(path.join(missingDatabaseRoot, 'packages/database/package.json'));
    expect(checkWorkspacePolicy(missingDatabaseRoot).violations).toContainEqual(
      expect.objectContaining({
        code: 'WORKSPACE_TARGET_MANIFEST_MISSING',
        path: 'packages/database/package.json',
      }),
    );
  });

  it('pins product version ownership to the desktop release manifest', () => {
    const rootWithVersion = createWorkspaceFixture();
    const rootPackage = JSON.parse(readFileSync(path.join(rootWithVersion, 'package.json'), 'utf8'));
    writeFileSync(
      path.join(rootWithVersion, 'package.json'),
      JSON.stringify({ ...rootPackage, version: '0.2.0' }),
    );
    expect(checkWorkspacePolicy(rootWithVersion).violations).toContainEqual(
      expect.objectContaining({ code: 'ROOT_PACKAGE_VERSION_FORBIDDEN' }),
    );

    const missingPinRoot = createWorkspaceFixture();
    rmSync(path.join(missingPinRoot, '.gstack/package-json-path'));
    expect(checkWorkspacePolicy(missingPinRoot).violations).toContainEqual(
      expect.objectContaining({ code: 'RELEASE_MANIFEST_PIN_MISSING' }),
    );

    const wrongPinRoot = createWorkspaceFixture();
    writeFileSync(path.join(wrongPinRoot, '.gstack/package-json-path'), 'package.json\n');
    expect(checkWorkspacePolicy(wrongPinRoot).violations).toContainEqual(
      expect.objectContaining({ code: 'RELEASE_MANIFEST_PIN_MISMATCH' }),
    );

    const unsafePinRoot = createWorkspaceFixture();
    rmSync(path.join(unsafePinRoot, '.gstack/package-json-path'));
    symlinkSync(
      path.join(unsafePinRoot, 'apps/desktop/package.json'),
      path.join(unsafePinRoot, '.gstack/package-json-path'),
    );
    expect(checkWorkspacePolicy(unsafePinRoot).violations).toContainEqual(
      expect.objectContaining({ code: 'RELEASE_MANIFEST_PIN_UNSAFE' }),
    );
  });

  it('rejects workspace patterns that can cancel or broaden the pinned package set', () => {
    const root = createWorkspaceFixture();
    writeFileSync(
      path.join(root, 'pnpm-workspace.yaml'),
      "packages:\n  - 'apps/*'\n  - 'packages/*'\n  - '!apps/*'\n",
    );

    const result = checkWorkspacePolicy(root);
    expect(result.pass).toBe(false);
    expect(result.violations).toContainEqual(expect.objectContaining({
      code: 'WORKSPACE_PATTERN_SET_MISMATCH',
    }));
  });

  it('rejects duplicate workspace package declarations', () => {
    for (const duplicateKey of ['packages :', '"packages":']) {
      const root = createWorkspaceFixture();
      writeFileSync(
        path.join(root, 'pnpm-workspace.yaml'),
        `packages:\n  - 'apps/*'\n${duplicateKey}\n  - 'packages/*'\n`,
      );

      const result = checkWorkspacePolicy(root);
      expect(result.pass).toBe(false);
      expect(result.violations).toContainEqual(expect.objectContaining({
        code: 'WORKSPACE_PACKAGES_DECLARATION_INVALID',
      }));
    }
  });

  it('rejects a required workspace target hidden behind a symlinked ancestor', () => {
    const root = createWorkspaceFixture();
    const externalApps = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-external-apps-'));
    fixtures.push(externalApps);
    mkdirSync(path.join(externalApps, 'desktop'));
    rmSync(path.join(root, 'apps'), { recursive: true, force: true });
    symlinkSync(externalApps, path.join(root, 'apps'));

    const result = checkWorkspacePolicy(root);
    expect(result.pass).toBe(false);
    expect(result.violations).toContainEqual(expect.objectContaining({
      code: 'WORKSPACE_TARGET_UNSAFE',
      path: 'apps/desktop',
    }));
  });

  it('rejects an additional workspace member that escapes through a symlink', () => {
    const root = createWorkspaceFixture();
    const externalMember = mkdtempSync(
      path.join(os.tmpdir(), 'customer-agent-external-member-'),
    );
    fixtures.push(externalMember);
    writeFileSync(
      path.join(externalMember, 'package.json'),
      JSON.stringify({ name: 'external-member', version: '1.0.0' }),
    );
    symlinkSync(externalMember, path.join(root, 'apps/external'));

    const result = checkWorkspacePolicy(root);
    expect(result.pass).toBe(false);
    expect(result.violations).toContainEqual(expect.objectContaining({
      code: 'WORKSPACE_MEMBER_UNSAFE',
      path: 'apps/external',
    }));
  });

  it('rejects a workspace member whose package manifest is a symlink', () => {
    const root = createWorkspaceFixture();
    const member = path.join(root, 'apps/member');
    mkdirSync(member);
    const externalManifestRoot = mkdtempSync(
      path.join(os.tmpdir(), 'customer-agent-external-member-manifest-'),
    );
    fixtures.push(externalManifestRoot);
    const externalManifest = path.join(externalManifestRoot, 'package.json');
    writeFileSync(externalManifest, JSON.stringify({ name: 'external-member' }));
    symlinkSync(externalManifest, path.join(member, 'package.json'));

    const result = checkWorkspacePolicy(root);
    expect(result.pass).toBe(false);
    expect(result.violations).toContainEqual(expect.objectContaining({
      code: 'WORKSPACE_MEMBER_MANIFEST_UNSAFE',
      path: 'apps/member/package.json',
    }));
  });

  it('rejects dangling workspace roots and member manifests as unsafe symlinks', () => {
    const root = createWorkspaceFixture();
    rmSync(path.join(root, 'packages'), { recursive: true, force: true });
    symlinkSync(path.join(root, 'missing-packages'), path.join(root, 'packages'));
    const member = path.join(root, 'apps/dangling-member');
    mkdirSync(member);
    symlinkSync(path.join(root, 'missing-package.json'), path.join(member, 'package.json'));

    const result = checkWorkspacePolicy(root);
    expect(result.pass).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WORKSPACE_GLOB_ROOT_UNSAFE', path: 'packages' }),
      expect.objectContaining({
        code: 'WORKSPACE_MEMBER_MANIFEST_UNSAFE',
        path: 'apps/dangling-member/package.json',
      }),
    ]));
  });

  it('fails closed when a root tool version or required workspace target drifts', () => {
    const root = createWorkspaceFixture();
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'customer-agent-demo',
        packageManager: 'pnpm@11.19.0',
        engines: { node: '>=24 <25', pnpm: '>=9' },
      }),
    );
    rmSync(path.join(root, 'apps/desktop'), { recursive: true, force: true });

    const result = checkWorkspacePolicy(root);
    expect(result.pass).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PNPM_ENGINE_MISMATCH' }),
      expect.objectContaining({ code: 'WORKSPACE_TARGET_MISSING', path: 'apps/desktop' }),
    ]));
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

  it.each([
    { key: 'frozen-contracts', relativePath: 'contracts/upstream/frozen/input.sql', capMiB: 16 },
    { key: 'frozen-evidence', relativePath: 'evidence/qa/frozen.log', capMiB: 10.5 },
    { key: 'source-inputs', relativePath: 'apps/desktop/src/big.ts', capMiB: 21.6 },
  ])('rejects $key growth even with unused aggregate headroom', ({ key, relativePath, capMiB }) => {
    const root = createWorkspaceFixture();
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, Buffer.alloc(capMiB * 1024 * 1024 + 4096, 'x'));

    const result = checkWorkspaceBudget(root);
    expect(result.remainderBudgetBytes).toBe(47.6 * 1024 * 1024);
    expect(result.remainderBytes).toBeLessThan(result.remainderBudgetBytes);
    expect(result.pass).toBe(false);
    expect(result.violations).toContainEqual(expect.objectContaining({ key, budgetBytes: capMiB * 1024 * 1024 }));
    // The legacy one-time aggregate override cannot bypass a group gate.
    expect(checkWorkspaceBudget(root, { remainderBudgetBytes: 64 * 1024 * 1024 }).pass).toBe(false);
  });

  it('counts hard-linked retained input once across contract and evidence groups', () => {
    const root = createWorkspaceFixture();
    const contractPath = path.join(root, 'contracts/upstream/frozen/input.sql');
    mkdirSync(path.dirname(contractPath), { recursive: true });
    writeFileSync(contractPath, Buffer.alloc(1024 * 1024, 'x'));
    const before = checkWorkspaceBudget(root);
    linkSync(contractPath, path.join(root, 'evidence/qa/same-input.sql'));
    const after = checkWorkspaceBudget(root);

    expect(after.pass).toBe(true);
    expect(after.remainderBytes - before.remainderBytes).toBeLessThan(4096);
    expect(after.sourceBudgetGroups.reduce((sum, group) => sum + group.bytes, 0)).toBe(after.remainderBytes);
  });

  it('does not follow a symlinked ancestor when grouping frozen contracts', () => {
    const root = createWorkspaceFixture();
    const external = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-external-contracts-'));
    fixtures.push(external);
    mkdirSync(path.join(external, 'upstream'));
    writeFileSync(path.join(external, 'upstream/input.sql'), Buffer.alloc(16 * 1024 * 1024, 'x'));
    symlinkSync(external, path.join(root, 'contracts'));

    const result = checkWorkspaceBudget(root);
    expect(result.pass).toBe(true);
    expect(result.remainderBytes).toBeLessThan(1024 * 1024);
    expect(result.sourceBudgetGroups.find(group => group.key === 'frozen-contracts')?.bytes).toBe(0);
  });

  it('counts only the symlink itself when a grouped leaf points outside the workspace', () => {
    const root = createWorkspaceFixture();
    const external = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-external-evidence-'));
    fixtures.push(external);
    writeFileSync(path.join(external, 'outside.bin'), Buffer.alloc(11 * 1024 * 1024, 'x'));
    rmSync(path.join(root, 'evidence'), { recursive: true, force: true });
    symlinkSync(external, path.join(root, 'evidence'));

    const result = checkWorkspaceBudget(root);
    expect(result.pass).toBe(true);
    expect(result.remainderBytes).toBeLessThan(1024 * 1024);
    expect(result.sourceBudgetGroups.find(group => group.key === 'frozen-evidence')?.bytes).toBeLessThan(4096);
  });

  it('keeps an explicitly tighter aggregate budget even when every group fits', () => {
    const root = createWorkspaceFixture();
    writeFileSync(path.join(root, 'apps/desktop/src/code.ts'), Buffer.alloc(2 * 1024 * 1024, 'x'));
    const result = checkWorkspaceBudget(root, { remainderBudgetBytes: 1024 * 1024 });

    expect(result.pass).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({ key: 'workspace-remainder', budgetBytes: 1024 * 1024 }),
    ]);
  });

  it('passes retained inputs within all three approved groups and the aggregate', () => {
    const root = createWorkspaceFixture();
    for (const [relativePath, mib] of [
      ['apps/desktop/src/code.ts', 18],
      ['contracts/upstream/frozen/input.sql', 15],
      ['evidence/qa/frozen.log', 9],
    ] as const) {
      const target = path.join(root, relativePath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, Buffer.alloc(mib * 1024 * 1024, 'x'));
    }
    const result = checkWorkspaceBudget(root);

    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.remainderBytes).toBeGreaterThan(42 * 1024 * 1024);
    expect(result.sourceBudgetGroups.map(group => group.key)).toEqual(['frozen-contracts', 'frozen-evidence', 'source-inputs']);
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
    expect(existsSync(path.join(root, 'apps/api/dist/main.js'))).toBe(true);
    expect(existsSync(path.join(root, 'apps/api/node_modules/fastify/runtime.js'))).toBe(true);
    expect(existsSync(path.join(root, 'packages/database/dist/index.js'))).toBe(true);
    expect(existsSync(path.join(root, 'packages/database/node_modules/pg/runtime.js'))).toBe(true);
    expect(existsSync(path.join(root, 'apps/desktop/out/main.js'))).toBe(true);
    expect(existsSync(path.join(root, 'out/main.js'))).toBe(true);
    expect(existsSync(path.join(root, 'build/icon.png'))).toBe(true);
  });

  it('removes only allowlisted generated outputs and preserves dependencies and protected content', () => {
    const root = createWorkspaceFixture();
    cleanWorkspace({ projectRoot: root, scope: 'generated', apply: true });

    expect(existsSync(path.join(root, 'release/local-unsigned'))).toBe(false);
    expect(existsSync(path.join(root, 'apps/api/dist'))).toBe(false);
    expect(existsSync(path.join(root, 'apps/api/experiments/search-decision/.generated'))).toBe(false);
    expect(existsSync(path.join(root, 'apps/api/node_modules/fastify/runtime.js'))).toBe(true);
    expect(existsSync(path.join(root, 'packages/database/dist'))).toBe(false);
    expect(existsSync(path.join(root, 'packages/database/node_modules/pg/runtime.js'))).toBe(true);
    expect(existsSync(path.join(root, 'apps/desktop/out'))).toBe(false);
    expect(existsSync(path.join(root, 'out'))).toBe(false);
    expect(existsSync(path.join(root, 'apps/desktop/node_modules/.vite'))).toBe(false);
    expect(existsSync(path.join(root, 'node_modules/.vite'))).toBe(false);
    expect(existsSync(path.join(root, 'apps/desktop/build/icon.png'))).toBe(false);
    expect(existsSync(path.join(root, 'apps/desktop/build/icon.ico'))).toBe(false);
    expect(existsSync(path.join(root, 'apps/desktop/build/icon.icns'))).toBe(false);
    expect(existsSync(path.join(root, 'build/icon.png'))).toBe(false);
    expect(existsSync(path.join(root, 'build/icon.ico'))).toBe(false);
    expect(existsSync(path.join(root, 'build/icon.icns'))).toBe(false);
    expect(existsSync(path.join(root, 'apps/desktop/build/entitlements.mac.plist'))).toBe(true);
    expect(existsSync(path.join(root, 'apps/desktop/node_modules/electron/runtime.bin'))).toBe(true);
    expect(readFileSync(path.join(root, '.git/HEAD'), 'utf8')).toContain('.git/HEAD');
    expect(existsSync(path.join(root, '.codegraph/codegraph.db'))).toBe(true);
    expect(existsSync(path.join(root, 'apps/desktop/src/main.ts'))).toBe(true);
    expect(existsSync(path.join(root, 'apps/desktop/assets/fox.png'))).toBe(true);
    expect(existsSync(path.join(root, 'evidence/qa/frozen.png'))).toBe(true);
    expect(existsSync(path.join(root, 'clawd-on-desk-0.15.0.zip'))).toBe(true);
  });

  it('removes dependencies only in the explicit deep scope', () => {
    const root = createWorkspaceFixture();
    cleanWorkspace({ projectRoot: root, scope: 'deep', apply: true });

    expect(existsSync(path.join(root, 'node_modules'))).toBe(false);
    expect(existsSync(path.join(root, 'apps/api/node_modules'))).toBe(false);
    expect(existsSync(path.join(root, 'apps/desktop/node_modules'))).toBe(false);
    expect(existsSync(path.join(root, 'packages/database/node_modules'))).toBe(false);
    expect(existsSync(path.join(root, '.git/HEAD'))).toBe(true);
    expect(existsSync(path.join(root, 'apps/desktop/src/main.ts'))).toBe(true);
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

  it('rejects symlinked cleanup ancestors before deleting protected content', () => {
    for (const relativeAncestor of ['apps', 'apps/desktop']) {
      const root = createWorkspaceFixture();
      const protectedOutput = path.join(root, 'evidence/desktop/out');
      const sentinel = path.join(protectedOutput, 'must-survive.txt');
      mkdirSync(protectedOutput, { recursive: true });
      writeFileSync(sentinel, 'protected');

      const symlinkTarget = relativeAncestor === 'apps'
        ? path.join(root, 'evidence')
        : path.join(root, 'evidence/desktop');
      const symlinkPath = path.join(root, relativeAncestor);
      rmSync(symlinkPath, { recursive: true, force: true });
      symlinkSync(symlinkTarget, symlinkPath);

      expect(() => cleanWorkspace({
        projectRoot: root,
        scope: 'generated',
        apply: true,
      })).toThrow(/symlink cleanup target/);
      expect(existsSync(sentinel)).toBe(true);
      expect(existsSync(path.join(root, 'release/local-unsigned/package.bin'))).toBe(true);
    }
  });

  it('rejects a workspace whose root package manifest is a symlink', () => {
    const root = createWorkspaceFixture();
    const externalManifestRoot = mkdtempSync(
      path.join(os.tmpdir(), 'customer-agent-external-manifest-'),
    );
    fixtures.push(externalManifestRoot);
    const externalManifest = path.join(externalManifestRoot, 'package.json');
    writeFileSync(externalManifest, JSON.stringify({ name: 'customer-agent-demo' }));
    rmSync(path.join(root, 'package.json'));
    symlinkSync(externalManifest, path.join(root, 'package.json'));

    expect(() => checkWorkspacePolicy(root)).toThrow(/unsafe workspace package\.json/);
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
