export function resolveBaselineDependency(options?: Readonly<{
  repositoryRoot?: string;
  commit?: string;
}>): Readonly<{
  commit: string;
  parent: string;
  testedHead: string;
  relationship: 'ancestor' | 'not-ancestor';
  changedPaths: readonly string[];
  fileSha256: string;
  content: Buffer;
}>;
export function assertManualIdentityResult(result: Readonly<{
  status: number | null;
  stdout?: string | Uint8Array | null;
  stderr?: string | Uint8Array | null;
  error?: Error;
}>): Readonly<{ testFiles: 9; tests: 38 }>;
