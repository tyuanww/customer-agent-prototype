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

// This budget covers source, tests, docs and checked-in assets only. Generated
// packages and reinstallable dependencies are reported separately and are not
// allowed to make the source budget fail.
export const WORKSPACE_REMAINDER_BUDGET_BYTES = 32 * 1024 * 1024;

export const GENERATED_CLEAN_TARGETS = Object.freeze([
  'release/local-unsigned',
  'out',
  'test-results',
  'playwright-report',
  '.gstack/qa-reports',
  'node_modules/.vite',
  'node_modules/.vite-temp',
]);

export const DEEP_CLEAN_TARGETS = Object.freeze([
  ...GENERATED_CLEAN_TARGETS.filter((target) => !target.startsWith('node_modules/')),
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
  { key: 'git', label: 'Git history and metadata', path: '.git' },
  { key: 'local-reference', label: 'user-owned ignored reference', path: 'clawd-on-desk-0.15.0.zip' },
  { key: 'codegraph', label: 'local CodeGraph index', path: '.codegraph' },
  { key: 'gstack', label: 'local gstack reports', path: '.gstack' },
  { key: 'build-output', label: 'rebuildable renderer/main output', path: 'out' },
  { key: 'test-output', label: 'temporary test output', path: 'test-results' },
  { key: 'playwright-output', label: 'temporary Playwright report', path: 'playwright-report' },
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
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  if (packageJson.name !== EXPECTED_PACKAGE_NAME) {
    throw new Error(
      `Refusing unexpected workspace package ${String(packageJson.name)} at ${resolvedRoot}`,
    );
  }
  return resolvedRoot;
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
  if (existsSync(resolvedTarget)) {
    const targetStats = lstatSync(resolvedTarget);
    if (targetStats.isSymbolicLink()) {
      throw new Error(`Refusing symlink cleanup target: ${resolvedTarget}`);
    }
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
        remove(target.absolutePath, { recursive: true, force: true });
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

function parseCliArguments(argv) {
  const command = argv[0] ?? 'size';
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
