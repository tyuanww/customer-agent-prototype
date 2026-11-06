export type ReceiptEvidence = Readonly<{
  receipts: Readonly<Record<string, unknown>>;
  entries: readonly Readonly<{ id: string; relative: string; actual: string }>[];
  combined: string;
}>;

export function combineSourceEntries(
  entries: readonly Readonly<{ id: string; actual: string }>[],
): string;
export function verifyReceiptTree(options?: Readonly<{
  repositoryRoot?: string;
  skillRoot?: string;
  requiredFiles?: readonly string[];
  requiredNestedReceipts?: readonly string[];
  requiredNestedFiles?: Readonly<Record<string, readonly string[]>>;
}>): ReceiptEvidence;
export function assertEvidenceOnlyChanges(changedPaths: Iterable<string>): void;
export function verifyGitProvenance(options: Readonly<{
  repositoryRoot?: string;
  receipts: Readonly<{ syncCommit: string }>;
}>): Readonly<{
  testedHead: string;
  syncCommit: string;
  changedAfterSync: readonly string[];
}>;
