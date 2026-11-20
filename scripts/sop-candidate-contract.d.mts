export function verifySopCandidateContractSet(options?: {
  projectRoot?: string;
  expectedContractSetId?: string;
}): Readonly<{ storageSql: string }>;
