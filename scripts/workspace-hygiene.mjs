import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_PACKAGE_NAME = 'customer-agent-demo';
export const EXPECTED_NODE_RANGE = '>=24 <25';
export const EXPECTED_PNPM_VERSION = '11.19.0';
export const RELEASE_MANIFEST_PATH = 'apps/desktop/package.json';
export const GSTACK_PACKAGE_JSON_PIN_PATH = '.gstack/package-json-path';
export const REQUIRED_WORKSPACE_PATTERNS = Object.freeze(['apps/*', 'packages/*']);
export const REQUIRED_WORKSPACE_DIRECTORIES = Object.freeze(['apps/desktop']);
export const REQUIRED_WORKSPACE_PACKAGES = Object.freeze([
  Object.freeze({ directory: 'apps/desktop', name: '@customer-agent/desktop' }),
  Object.freeze({ directory: 'packages/contracts', name: '@customer-agent/contracts' }),
]);
const REQUIRED_WORKSPACE_ROOTS = Object.freeze(
  REQUIRED_WORKSPACE_PATTERNS.map((pattern) => pattern.slice(0, -2)),
);

// This budget covers source, tests, docs and checked-in assets only. Generated
// packages and reinstallable dependencies are reported separately and are not
// allowed to make the source budget fail.
export const WORKSPACE_REMAINDER_BUDGET_BYTES = 32 * 1024 * 1024;

export const GENERATED_CLEAN_TARGETS = Object.freeze([
  'release/local-unsigned',
  'apps/desktop/out',
  'apps/desktop/test-results',
  'apps/desktop/playwright-report',
  'apps/desktop/build/icon.png',
  'apps/desktop/build/icon.ico',
  'apps/desktop/build/icon.icns',
  'apps/desktop/node_modules/.vite',
  'apps/desktop/node_modules/.vite-temp',
  // W0 generated these at the repository root. Keep them allowlisted so a
  // post-move cleanup can remove stale artifacts without broadening targets.
  'out',
  'test-results',
  'playwright-report',
  'build/icon.png',
  'build/icon.ico',
  'build/icon.icns',
  '.gstack/qa-reports',
  'node_modules/.vite',
  'node_modules/.vite-temp',
]);

export const DEEP_CLEAN_TARGETS = Object.freeze([
  ...GENERATED_CLEAN_TARGETS.filter(
    (target) => !target.startsWith('node_modules/')
      && !target.startsWith('apps/desktop/node_modules/'),
  ),
  'apps/desktop/node_modules',
  'node_modules',
]);

const ALL_CLEAN_TARGETS = new Set([
  ...GENERATED_CLEAN_TARGETS,
  ...DEEP_CLEAN_TARGETS,
]);

const PROTECTED_TOP_LEVEL = new Set([
  '.git',
  '.codegraph',
  'assets',
  'docs',
  'evidence',
  'scripts',
  'src',
  'tests',
  'clawd-on-desk-0.15.0.zip',
]);

const INVENTORY_CATEGORIES = Object.freeze([
  { key: 'release', label: 'generated package artifacts', path: 'release' },
  { key: 'dependencies', label: 'reinstallable dependencies', path: 'node_modules' },
  { key: 'desktop-dependencies', label: 'desktop package dependency links', path: 'apps/desktop/node_modules' },
  { key: 'git', label: 'Git history and metadata', path: '.git' },
  { key: 'local-reference', label: 'user-owned ignored reference', path: 'clawd-on-desk-0.15.0.zip' },
  { key: 'codegraph', label: 'local CodeGraph index', path: '.codegraph' },
  { key: 'gstack', label: 'local gstack reports', path: '.gstack' },
  { key: 'build-output', label: 'rebuildable renderer/main output', path: 'apps/desktop/out' },
  { key: 'test-output', label: 'temporary test output', path: 'apps/desktop/test-results' },
  { key: 'playwright-output', label: 'temporary Playwright report', path: 'apps/desktop/playwright-report' },
  { key: 'legacy-build-output', label: 'pre-move rebuildable output', path: 'out' },
  { key: 'legacy-test-output', label: 'pre-move temporary test output', path: 'test-results' },
  { key: 'legacy-playwright-output', label: 'pre-move Playwright report', path: 'playwright-report' },
]);

function inodeKey(stats, targetPath) {
  return typeof stats.ino === 'number' && stats.ino > 0
    ? `${String(stats.dev)}:${String(stats.ino)}`
    : `path:${path.resolve(targetPath)}`;
}

function allocatedBytes(stats) {
  return typeof stats.blocks === 'number' && stats.blocks > 0
    ? stats.blocks * 512
    : stats.size;
}

export function measureAllocatedBytes(targetPath, seen = new Set()) {
  if (!existsSync(targetPath)) {
    return 0;
  }
  const stats = lstatSync(targetPath);
  const key = inodeKey(stats, targetPath);
  if (seen.has(key)) {
    return 0;
  }
  seen.add(key);

  let total = allocatedBytes(stats);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    return total;
  }
  for (const entry of readdirSync(targetPath)) {
    total += measureAllocatedBytes(path.join(targetPath, entry), seen);
  }
  return total;
}

export function assertWorkspaceRoot(projectRoot) {
  const resolvedRoot = realpathSync(path.resolve(projectRoot));
  if (resolvedRoot === path.parse(resolvedRoot).root || resolvedRoot === os.homedir()) {
    throw new Error(`Refusing unsafe workspace root: ${resolvedRoot}`);
  }
  const packagePath = path.join(resolvedRoot, 'package.json');
  if (!existsSync(packagePath)) {
    throw new Error(`Workspace package.json is missing: ${packagePath}`);
  }
  const packageStats = lstatSync(packagePath);
  if (packageStats.isSymbolicLink() || !packageStats.isFile()) {
    throw new Error(`Refusing unsafe workspace package.json: ${packagePath}`);
  }
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  if (packageJson.name !== EXPECTED_PACKAGE_NAME) {
    throw new Error(
      `Refusing unexpected workspace package ${String(packageJson.name)} at ${resolvedRoot}`,
    );
  }
  return resolvedRoot;
}

// The supported `workspace:check` entrypoint is invoked through pnpm, which
// validates YAML syntax before this script runs. This narrow reader owns only
// the exact package-pattern policy for an already-valid workspace document.
function readWorkspaceConfiguration(workspaceSource) {
  const patterns = [];
  let readingPackages = false;
  let packageDeclarations = 0;
  for (const line of workspaceSource.split(/\r?\n/)) {
    if (/^(?:packages|['"]packages['"])\s*:\s*$/.test(line)) {
      packageDeclarations += 1;
      readingPackages = true;
      continue;
    }
    if (/^\S/.test(line)) {
      readingPackages = false;
      continue;
    }
    if (!readingPackages) {
      continue;
    }
    const match = line.match(/^\s*-\s+['"]?([^'"]+?)['"]?\s*$/);
    if (match) {
      patterns.push(match[1]);
    }
  }
  return { packageDeclarations, patterns };
}

function workspaceDirectoryStatus(projectRoot, relativeDirectory) {
  let currentPath = projectRoot;
  for (const segment of relativeDirectory.split('/')) {
    currentPath = path.join(currentPath, segment);
    const stats = lstatSync(currentPath, { throwIfNoEntry: false });
    if (!stats) {
      return 'missing';
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      return 'unsafe';
    }
  }
  return 'safe';
}

function workspaceMemberSafetyViolations(projectRoot) {
  const violations = [];
  for (const relativeRoot of REQUIRED_WORKSPACE_ROOTS) {
    const workspaceRoot = path.join(projectRoot, relativeRoot);
    const rootStats = lstatSync(workspaceRoot, { throwIfNoEntry: false });
    if (!rootStats) {
      continue;
    }
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
      violations.push({ code: 'WORKSPACE_GLOB_ROOT_UNSAFE', path: relativeRoot });
      continue;
    }
    for (const entry of readdirSync(workspaceRoot)) {
      const relativeMember = path.posix.join(relativeRoot, entry);
      const memberPath = path.join(projectRoot, relativeRoot, entry);
      const memberStats = lstatSync(memberPath);
      if (memberStats.isSymbolicLink()) {
        violations.push({ code: 'WORKSPACE_MEMBER_UNSAFE', path: relativeMember });
        continue;
      }
      if (!memberStats.isDirectory()) {
        continue;
      }
      const manifestPath = path.join(memberPath, 'package.json');
      const manifestStats = lstatSync(manifestPath, { throwIfNoEntry: false });
      if (!manifestStats) {
        continue;
      }
      if (manifestStats.isSymbolicLink() || !manifestStats.isFile()) {
        violations.push({
          code: 'WORKSPACE_MEMBER_MANIFEST_UNSAFE',
          path: path.posix.join(relativeMember, 'package.json'),
        });
      }
    }
  }
  return violations;
}

function requiredWorkspacePackageViolations(projectRoot) {
  const violations = [];
  for (const requiredPackage of REQUIRED_WORKSPACE_PACKAGES) {
    if (workspaceDirectoryStatus(projectRoot, requiredPackage.directory) !== 'safe') {
      continue;
    }
    const manifestPath = path.join(projectRoot, requiredPackage.directory, 'package.json');
    const relativeManifest = path.posix.join(requiredPackage.directory, 'package.json');
    const manifestStats = lstatSync(manifestPath, { throwIfNoEntry: false });
    if (!manifestStats) {
      violations.push({ code: 'WORKSPACE_TARGET_MANIFEST_MISSING', path: relativeManifest });
      continue;
    }
    if (manifestStats.isSymbolicLink() || !manifestStats.isFile()) {
      violations.push({ code: 'WORKSPACE_TARGET_MANIFEST_UNSAFE', path: relativeManifest });
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      violations.push({ code: 'WORKSPACE_TARGET_MANIFEST_INVALID', path: relativeManifest });
      continue;
    }
    if (manifest.name !== requiredPackage.name) {
      violations.push({
        code: 'WORKSPACE_TARGET_PACKAGE_NAME_MISMATCH',
        path: relativeManifest,
        expected: requiredPackage.name,
        actual: String(manifest.name),
      });
    }
    if (manifest.private !== true) {
      violations.push({ code: 'WORKSPACE_TARGET_PACKAGE_NOT_PRIVATE', path: relativeManifest });
    }
    const toolchainOverrides = ['packageManager', 'engines'].filter(
      (key) => Object.hasOwn(manifest, key),
    );
    if (toolchainOverrides.length > 0) {
      violations.push({
        code: 'WORKSPACE_TARGET_TOOLCHAIN_OVERRIDE_FORBIDDEN',
        path: relativeManifest,
        actual: toolchainOverrides.join(','),
      });
    }
  }
  return violations;
}

function releaseManifestOwnershipViolations(projectRoot, rootPackageJson) {
  const violations = [];
  if (Object.hasOwn(rootPackageJson, 'version')) {
    violations.push({
      code: 'ROOT_PACKAGE_VERSION_FORBIDDEN',
      path: 'package.json',
      actual: String(rootPackageJson.version),
    });
  }

  const pinPath = path.join(projectRoot, GSTACK_PACKAGE_JSON_PIN_PATH);
  const pinStats = lstatSync(pinPath, { throwIfNoEntry: false });
  if (!pinStats) {
    violations.push({
      code: 'RELEASE_MANIFEST_PIN_MISSING',
      path: GSTACK_PACKAGE_JSON_PIN_PATH,
    });
    return violations;
  }
  if (pinStats.isSymbolicLink() || !pinStats.isFile()) {
    violations.push({
      code: 'RELEASE_MANIFEST_PIN_UNSAFE',
      path: GSTACK_PACKAGE_JSON_PIN_PATH,
    });
    return violations;
  }

  const nonEmptyLines = readFileSync(pinPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (nonEmptyLines.length !== 1 || nonEmptyLines[0] !== RELEASE_MANIFEST_PATH) {
    violations.push({
      code: 'RELEASE_MANIFEST_PIN_MISMATCH',
      path: GSTACK_PACKAGE_JSON_PIN_PATH,
      expected: RELEASE_MANIFEST_PATH,
      actual: nonEmptyLines.join(','),
    });
  }
  return violations;
}

export function checkWorkspacePolicy(
  projectRoot,
  { nodeVersion = process.versions.node } = {},
) {
  const resolvedRoot = assertWorkspaceRoot(projectRoot);
  const packageJson = JSON.parse(
    readFileSync(path.join(resolvedRoot, 'package.json'), 'utf8'),
  );
  const violations = [];

  if (packageJson.packageManager !== `pnpm@${EXPECTED_PNPM_VERSION}`) {
    violations.push({
      code: 'PACKAGE_MANAGER_MISMATCH',
      expected: `pnpm@${EXPECTED_PNPM_VERSION}`,
      actual: String(packageJson.packageManager),
    });
  }
  if (packageJson.engines?.node !== EXPECTED_NODE_RANGE) {
    violations.push({
      code: 'NODE_ENGINE_MISMATCH',
      expected: EXPECTED_NODE_RANGE,
      actual: String(packageJson.engines?.node),
    });
  }
  if (packageJson.engines?.pnpm !== EXPECTED_PNPM_VERSION) {
    violations.push({
      code: 'PNPM_ENGINE_MISMATCH',
      expected: EXPECTED_PNPM_VERSION,
      actual: String(packageJson.engines?.pnpm),
    });
  }
  const runtimeNodeMajor = Number.parseInt(String(nodeVersion).split('.')[0] ?? '', 10);
  if (runtimeNodeMajor !== 24) {
    violations.push({
      code: 'NODE_RUNTIME_MISMATCH',
      expected: '24.x',
      actual: String(nodeVersion),
    });
  }

  const workspacePath = path.join(resolvedRoot, 'pnpm-workspace.yaml');
  let workspacePatterns = [];
  if (!existsSync(workspacePath)) {
    violations.push({ code: 'WORKSPACE_FILE_MISSING', path: workspacePath });
  } else {
    const workspaceStats = lstatSync(workspacePath);
    if (workspaceStats.isSymbolicLink() || !workspaceStats.isFile()) {
      violations.push({ code: 'WORKSPACE_FILE_UNSAFE', path: workspacePath });
    } else {
      const workspaceConfiguration = readWorkspaceConfiguration(
        readFileSync(workspacePath, 'utf8'),
      );
      workspacePatterns = workspaceConfiguration.patterns;
      if (workspaceConfiguration.packageDeclarations !== 1) {
        violations.push({
          code: 'WORKSPACE_PACKAGES_DECLARATION_INVALID',
          expected: '1',
          actual: String(workspaceConfiguration.packageDeclarations),
        });
      }
      if (
        workspacePatterns.length !== REQUIRED_WORKSPACE_PATTERNS.length
        || workspacePatterns.some(
          (pattern, index) => pattern !== REQUIRED_WORKSPACE_PATTERNS[index],
        )
      ) {
        violations.push({
          code: 'WORKSPACE_PATTERN_SET_MISMATCH',
          expected: JSON.stringify(REQUIRED_WORKSPACE_PATTERNS),
          actual: JSON.stringify(workspacePatterns),
        });
      }
    }
  }

  for (const relativeDirectory of REQUIRED_WORKSPACE_DIRECTORIES) {
    const status = workspaceDirectoryStatus(resolvedRoot, relativeDirectory);
    if (status === 'missing') {
      violations.push({ code: 'WORKSPACE_TARGET_MISSING', path: relativeDirectory });
      continue;
    }
    if (status === 'unsafe') {
      violations.push({ code: 'WORKSPACE_TARGET_UNSAFE', path: relativeDirectory });
    }
  }
  violations.push(...requiredWorkspacePackageViolations(resolvedRoot));
  violations.push(...releaseManifestOwnershipViolations(resolvedRoot, packageJson));
  violations.push(...workspaceMemberSafetyViolations(resolvedRoot));

  return {
    root: resolvedRoot,
    packageManager: packageJson.packageManager,
    nodeEngine: packageJson.engines?.node,
    pnpmEngine: packageJson.engines?.pnpm,
    runtimeNodeVersion: nodeVersion,
    workspacePatterns,
    violations,
    pass: violations.length === 0,
  };
}

export function resolveCleanupTarget(projectRoot, relativeTarget) {
  const resolvedRoot = assertWorkspaceRoot(projectRoot);
  if (!ALL_CLEAN_TARGETS.has(relativeTarget)) {
    throw new Error(`Refusing non-allowlisted cleanup target: ${relativeTarget}`);
  }
  const topLevel = relativeTarget.split('/')[0];
  if (PROTECTED_TOP_LEVEL.has(topLevel)) {
    throw new Error(`Refusing protected cleanup target: ${relativeTarget}`);
  }
  const resolvedTarget = path.resolve(resolvedRoot, relativeTarget);
  if (!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Refusing cleanup target outside workspace: ${resolvedTarget}`);
  }

  let currentPath = resolvedRoot;
  const pathSegments = relativeTarget.split('/');
  for (const [index, segment] of pathSegments.entries()) {
    currentPath = path.join(currentPath, segment);
    const stats = lstatSync(currentPath, { throwIfNoEntry: false });
    if (!stats) {
      break;
    }
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing symlink cleanup target component: ${currentPath}`);
    }
    const isFinalSegment = index === pathSegments.length - 1;
    if (!isFinalSegment && !stats.isDirectory()) {
      throw new Error(`Refusing non-directory cleanup target component: ${currentPath}`);
    }
  }

  if (existsSync(resolvedTarget)) {
    const realTarget = realpathSync(resolvedTarget);
    if (!realTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error(`Refusing cleanup target outside workspace: ${realTarget}`);
    }
  }
  return resolvedTarget;
}

export function workspaceInventory(projectRoot) {
  const resolvedRoot = assertWorkspaceRoot(projectRoot);
  const seen = new Set();
  const claimedTopLevel = new Set(INVENTORY_CATEGORIES.map((category) => category.path));
  const categories = INVENTORY_CATEGORIES.map((category) => ({
    ...category,
    bytes: measureAllocatedBytes(path.join(resolvedRoot, category.path), seen),
  }));
  let remainderBytes = 0;
  for (const entry of readdirSync(resolvedRoot)) {
    if (!claimedTopLevel.has(entry)) {
      remainderBytes += measureAllocatedBytes(path.join(resolvedRoot, entry), seen);
    }
  }
  categories.push({
    key: 'workspace-remainder',
    label: 'source, tests, docs, assets and small build inputs',
    path: '(remainder)',
    bytes: remainderBytes,
  });
  categories.sort((left, right) => right.bytes - left.bytes);
  return {
    root: resolvedRoot,
    totalBytes: categories.reduce((sum, category) => sum + category.bytes, 0),
    categories,
  };
}

export function checkWorkspaceBudget(
  projectRoot,
  { remainderBudgetBytes = WORKSPACE_REMAINDER_BUDGET_BYTES } = {},
) {
  if (!Number.isFinite(remainderBudgetBytes) || remainderBudgetBytes < 0) {
    throw new Error(`Invalid workspace remainder budget: ${String(remainderBudgetBytes)}`);
  }
  const inventory = workspaceInventory(projectRoot);
  const remainder = inventory.categories.find(
    (category) => category.key === 'workspace-remainder',
  );
  const remainderBytes = remainder?.bytes ?? 0;
  const violations = remainderBytes > remainderBudgetBytes
    ? [{
        key: 'workspace-remainder',
        bytes: remainderBytes,
        budgetBytes: remainderBudgetBytes,
      }]
    : [];
  return {
    ...inventory,
    remainderBytes,
    remainderBudgetBytes,
    violations,
    pass: violations.length === 0,
  };
}

export function cleanWorkspace({
  projectRoot,
  scope = 'generated',
  apply = false,
  remove = rmSync,
}) {
  const resolvedRoot = assertWorkspaceRoot(projectRoot);
  const targets = scope === 'generated'
    ? GENERATED_CLEAN_TARGETS
    : scope === 'deep'
      ? DEEP_CLEAN_TARGETS
      : null;
  if (!targets) {
    throw new Error(`Unknown cleanup scope: ${scope}`);
  }
  const plan = targets.map((relativeTarget) => {
    const absolutePath = resolveCleanupTarget(resolvedRoot, relativeTarget);
    const bytes = measureAllocatedBytes(absolutePath);
    const existed = existsSync(absolutePath);
    return { relativeTarget, absolutePath, bytes, existed };
  });
  if (apply) {
    for (const target of plan) {
      if (target.existed) {
        const verifiedPath = resolveCleanupTarget(resolvedRoot, target.relativeTarget);
        remove(verifiedPath, { recursive: true, force: true });
      }
    }
  }
  const results = plan.map((target) => ({
    ...target,
    removed: apply && target.existed,
  }));
  return {
    root: resolvedRoot,
    scope,
    apply,
    totalBytes: results.reduce((sum, result) => sum + result.bytes, 0),
    results,
  };
}

export function formatBytes(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function parseCliArguments(argv) {
  const command = argv[0] ?? 'size';
  const unknownOptions = argv.slice(1).filter((argument) => (
    argument !== '--apply'
    && !argument.startsWith('--scope=')
    && !argument.startsWith('--remainder-budget-mib=')
  ));
  if (unknownOptions.length > 0) {
    throw new Error(`Unknown cleanup option: ${unknownOptions.join(', ')}`);
  }
  const scopeOption = argv.find((argument) => argument.startsWith('--scope='));
  const budgetOption = argv.find((argument) => argument.startsWith('--remainder-budget-mib='));
  const remainderBudgetBytes = budgetOption
    ? Number(budgetOption.slice('--remainder-budget-mib='.length)) * 1024 * 1024
    : WORKSPACE_REMAINDER_BUDGET_BYTES;
  if (!Number.isFinite(remainderBudgetBytes) || remainderBudgetBytes < 0) {
    throw new Error(`Invalid --remainder-budget-mib value: ${budgetOption ?? ''}`);
  }
  return {
    command,
    scope: scopeOption ? scopeOption.slice('--scope='.length) : 'generated',
    apply: argv.includes('--apply'),
    remainderBudgetBytes,
  };
}

function runCli() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const {
    command,
    scope,
    apply,
    remainderBudgetBytes,
  } = parseCliArguments(process.argv.slice(2));
  if (command === 'size') {
    const inventory = workspaceInventory(projectRoot);
    console.log(`Workspace allocated size: ${formatBytes(inventory.totalBytes)}`);
    for (const category of inventory.categories) {
      console.log(`${formatBytes(category.bytes).padStart(10)}  ${category.path}  ${category.label}`);
    }
    return;
  }
  if (command === 'check') {
    const result = checkWorkspaceBudget(projectRoot, { remainderBudgetBytes });
    const policy = checkWorkspacePolicy(projectRoot);
    console.log(
      `Workspace source budget: ${result.pass ? 'PASS' : 'FAIL'} `
      + `(remainder ${formatBytes(result.remainderBytes)} / `
      + `${formatBytes(result.remainderBudgetBytes)})`,
    );
    if (!result.pass) {
      for (const violation of result.violations) {
        console.error(
          `${violation.key} exceeds budget by ${formatBytes(
            violation.bytes - violation.budgetBytes,
          )}`,
        );
      }
    }
    console.log(`Workspace root policy: ${policy.pass ? 'PASS' : 'FAIL'}`);
    for (const violation of policy.violations) {
      console.error(`${violation.code}: ${violation.path ?? violation.actual ?? 'invalid'}`);
    }
    if (!result.pass || !policy.pass) {
      process.exitCode = 1;
    }
    return;
  }
  if (command !== 'clean') {
    throw new Error(`Unknown command: ${command}`);
  }
  const result = cleanWorkspace({ projectRoot, scope, apply });
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} cleanup scope=${scope}`);
  for (const target of result.results) {
    const action = target.removed ? 'removed' : target.existed ? 'would remove' : 'absent';
    console.log(`${formatBytes(target.bytes).padStart(10)}  ${action.padEnd(12)}  ${target.relativeTarget}`);
  }
  console.log(`${apply ? 'Removed' : 'Would remove'}: ${formatBytes(result.totalBytes)}`);
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
