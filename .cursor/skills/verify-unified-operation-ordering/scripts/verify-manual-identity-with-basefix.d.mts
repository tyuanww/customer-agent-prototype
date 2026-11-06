export const BASEFIX_DEPENDENCY: Readonly<{
  id: 'BASEFIX-01';
  commit: string;
  file: Readonly<{
    path: string;
    sha256: string;
  }>;
  manualIdentity: Readonly<{
    testFiles: readonly string[];
    expected: Readonly<{ testFiles: 9; tests: 38 }>;
  }>;
}>;

export type ManualIdentityCommandResult = Readonly<{
  status: number | null;
  stdout?: string | Uint8Array | null;
  stderr?: string | Uint8Array | null;
  error?: Error;
}>;

export type ManualIdentityCommandRunner = (
  command: string,
  args: readonly string[],
  options: Readonly<{
    cwd: string;
    env: NodeJS.ProcessEnv;
    encoding: 'utf8';
    maxBuffer: number;
    timeout: number;
  }>,
) => ManualIdentityCommandResult;

export function resolveBaselineDependency(options?: Readonly<{
  repositoryRoot?: string;
  dependency?: typeof BASEFIX_DEPENDENCY;
  testedHead?: string | null;
}>): Readonly<{
  dependency: typeof BASEFIX_DEPENDENCY;
  commit: string;
  parent: string;
  testedHead: string;
  relationship: 'ancestor' | 'not-ancestor';
  changedPaths: readonly string[];
  fileSha256: string;
  testedFileSha256: string | null;
  content: Buffer;
}>;
export function assertBaselineOwnedFileExcluded(
  sourceFiles: readonly string[],
  dependency?: typeof BASEFIX_DEPENDENCY,
): void;
export function assertManualIdentityResult(
  result: ManualIdentityCommandResult,
  expected?: Readonly<{ testFiles: 9; tests: 38 }>,
): Readonly<{ testFiles: 9; tests: 38 }>;
export function runManualIdentityVerification(options?: Readonly<{
  repositoryRoot?: string;
  dependency?: typeof BASEFIX_DEPENDENCY;
  testedHead?: string | null;
  commandRunner?: ManualIdentityCommandRunner;
}>): Readonly<{
  schemaVersion: 'for-manual-identity-basefix-evidence/v3';
  testedHead: string;
  baselineCommit: string;
  baselineParent: string;
  relationship: 'ancestor' | 'not-ancestor';
  changedPaths: readonly string[];
  basefixFileSha256: string;
  testedFileSha256: string | null;
  executedFileSha256: string;
  integrationTree: 'reuse-ancestor' | 'overlay-baseline';
  command: string;
  testFiles: 9;
  tests: 38;
  durationMs: number;
  errorCount: 0;
  passed: true;
}>;
