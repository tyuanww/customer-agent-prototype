import { isDeepStrictEqual } from 'node:util';
import { buildSopGraphSnapshotCandidate, checkSopGraphSnapshotReadiness, type SopGraphSnapshotCandidate } from './sop-graph-snapshot.js';
import { checkSopGraphTransactionPreconditions, type SopBusinessReviewEvidence, type SopSuccessorAcceptanceEvidence } from './sop-graph-release-gate.js';
import { parseSopSuccessorCandidate, type SopSuccessorCandidate } from './sop-successor-candidate.js';

export type SopGraphSnapshotTransactionInput = Readonly<{
  candidateId: string;
  candidateVersion: number;
  idempotencyKey: string;
  candidate: SopSuccessorCandidate;
  snapshot: SopGraphSnapshotCandidate;
  successorEvidence: SopSuccessorAcceptanceEvidence;
  businessEvidence: SopBusinessReviewEvidence;
}>;

export type SopGraphSnapshotTransactionRequest = Readonly<{
  kind: 'sop-graph-snapshot-transaction-candidate';
  candidateId: string;
  candidateVersion: number;
  idempotencyKey: string;
  snapshot: SopGraphSnapshotCandidate;
  successorEvidence: SopSuccessorAcceptanceEvidence;
  businessEvidence: SopBusinessReviewEvidence;
  publishable: false;
}>;

export type SopGraphSnapshotTransactionResult =
  | Readonly<{ kind: 'needs-information'; publishable: false; issues: readonly string[] }>
  | Readonly<{ kind: 'candidate'; publishable: false; request: SopGraphSnapshotTransactionRequest }>;

export type SopGraphSnapshotUnknownTransactionInput = Readonly<{
  candidate: unknown;
  candidateId: string;
  candidateVersion: number;
  idempotencyKey: string;
  successorEvidence: SopSuccessorAcceptanceEvidence;
  businessEvidence: SopBusinessReviewEvidence;
}>;

const candidateId = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const idempotency = /^[A-Za-z0-9._:-]{1,128}$/u;

/** Prepare a future database transaction without performing any I/O. */
export function prepareSopGraphSnapshotTransaction(input: SopGraphSnapshotTransactionInput): SopGraphSnapshotTransactionResult {
  const issues: string[] = [];
  if (!candidateId.test(input.candidateId)) issues.push('candidateId is invalid');
  if (!Number.isSafeInteger(input.candidateVersion) || input.candidateVersion < 1) issues.push('candidateVersion is invalid');
  if (!idempotency.test(input.idempotencyKey)) issues.push('idempotencyKey is invalid');

  const expected = buildSopGraphSnapshotCandidate(input.candidate);
  if (expected.kind !== 'candidate') return { kind: 'needs-information', publishable: false, issues: [...issues, ...expected.issues] };
  if (!isDeepStrictEqual(input.snapshot, expected.snapshot)) {
    return { kind: 'needs-information', publishable: false, issues: [...issues, 'snapshot hash does not match candidate'] };
  }

  const gate = checkSopGraphTransactionPreconditions({ candidate: input.candidate, snapshot: checkSopGraphSnapshotReadiness(input.candidate),
    candidateId: input.candidateId, candidateVersion: input.candidateVersion,
    successorEvidence: input.successorEvidence, businessEvidence: input.businessEvidence });
  if (issues.length || gate.status !== 'ready-for-transaction') return { kind: 'needs-information', publishable: false, issues: [...issues, ...gate.issues] };
  return { kind: 'candidate', publishable: false, request: {
    kind: 'sop-graph-snapshot-transaction-candidate', candidateId: input.candidateId, candidateVersion: input.candidateVersion,
    idempotencyKey: input.idempotencyKey, snapshot: expected.snapshot, successorEvidence: input.successorEvidence,
    businessEvidence: input.businessEvidence, publishable: false,
  } };
}

/** Parse an external candidate, materialize its snapshot, then prepare the request. */
export function prepareSopGraphSnapshotTransactionFromUnknown(
  input: SopGraphSnapshotUnknownTransactionInput,
): SopGraphSnapshotTransactionResult {
  const parsed = parseSopSuccessorCandidate(input.candidate);
  if (parsed.kind !== 'candidate') return { kind: 'needs-information', publishable: false, issues: parsed.issues };
  const snapshot = buildSopGraphSnapshotCandidate(parsed.value);
  if (snapshot.kind !== 'candidate') return { kind: 'needs-information', publishable: false, issues: snapshot.issues };
  return prepareSopGraphSnapshotTransaction({ ...input, candidate: parsed.value, snapshot: snapshot.snapshot });
}
