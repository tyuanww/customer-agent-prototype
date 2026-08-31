export type CleanupScope = 'generated' | 'deep';

export const WORKSPACE_REMAINDER_BUDGET_BYTES: number;
export const EXPECTED_NODE_RANGE: string;
export const EXPECTED_PNPM_VERSION: string;
export const REQUIRED_WORKSPACE_PATTERNS: readonly string[];
export const REQUIRED_WORKSPACE_DIRECTORIES: readonly string[];

export type WorkspaceCategory = Readonly<{
  key: string;
  label: string;
  path: string;
  bytes: number;
}>;

export type CleanupResult = Readonly<{
  root: string;
  scope: CleanupScope;
  apply: boolean;
  totalBytes: number;
  results: ReadonlyArray<Readonly<{
    relativeTarget: string;
    absolutePath: string;
    bytes: number;
    existed: boolean;
    removed: boolean;
  }>>;
}>;

export const GENERATED_CLEAN_TARGETS: readonly string[];
export const DEEP_CLEAN_TARGETS: readonly string[];

export function measureAllocatedBytes(targetPath: string, seen?: Set<string>): number;
export function assertWorkspaceRoot(projectRoot: string): string;
export function checkWorkspacePolicy(
  projectRoot: string,
  options?: Readonly<{ nodeVersion?: string }>,
): Readonly<{
  root: string;
  packageManager: unknown;
  nodeEngine: unknown;
  pnpmEngine: unknown;
  runtimeNodeVersion: string;
  workspacePatterns: readonly string[];
  violations: readonly Readonly<{
    code: string;
    expected?: string;
    actual?: string;
    path?: string;
  }>[];
  pass: boolean;
}>;
export function resolveCleanupTarget(projectRoot: string, relativeTarget: string): string;
export function workspaceInventory(projectRoot: string): Readonly<{
  root: string;
  totalBytes: number;
  categories: readonly WorkspaceCategory[];
}>;
export function checkWorkspaceBudget(
  projectRoot: string,
  options?: Readonly<{ remainderBudgetBytes?: number }>,
): Readonly<{
  root: string;
  totalBytes: number;
  categories: readonly WorkspaceCategory[];
  remainderBytes: number;
  remainderBudgetBytes: number;
  violations: readonly Readonly<{
    key: string;
    bytes: number;
    budgetBytes: number;
  }>[];
  pass: boolean;
}>;
export function cleanWorkspace(options: Readonly<{
  projectRoot: string;
  scope?: CleanupScope;
  apply?: boolean;
  remove?: (path: string, options: { recursive: true; force: true }) => void;
}>): CleanupResult;
export function formatBytes(bytes: number): string;
export function parseCliArguments(argv: readonly string[]): Readonly<{
  command: string;
  scope: string;
  apply: boolean;
  remainderBudgetBytes: number;
}>;
