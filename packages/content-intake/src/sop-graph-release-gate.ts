import { checkSopGraphSnapshotReadiness, type SopGraphSnapshotReadiness } from './sop-graph-snapshot.js';
import type { SopSuccessorCandidate } from './sop-successor-candidate.js';

export type SopGraphTransactionPreconditions = Readonly<{
  candidateId: string;
  candidateVersion: number;
  candidate: SopSuccessorCandidate;
  snapshot: SopGraphSnapshotReadiness;
  successorEvidence: SopSuccessorAcceptanceEvidence;
  businessEvidence: SopBusinessReviewEvidence;
}>;

export type SopSuccessorAcceptanceEvidence = Readonly<{
  accepted: boolean;
  candidateId: string;
  candidateVersion: number;
  contract: 'resume-v3-successor-candidate';
  mappingVersion: string;
  sourceSha256: string;
  structureDigest: string;
  openapiDigest: string;
  ddlDigest: string;
  migrationsDigest: string;
}>;

export type SopBusinessReviewEvidence = Readonly<{
  reviewed: boolean;
  candidateId: string;
  candidateVersion: number;
  mappingVersion: string;
  sourceSha256: string;
  reviewDigest: string;
}>;

export type SopGraphTransactionPreconditionResult = Readonly<{
  status: 'blocked' | 'ready-for-transaction';
  publishable: false;
  issues: readonly string[];
}>;

/**
 * Keep candidate, snapshot, successor approval and business review as
 * separate facts. This gate only decides whether a future transaction may be
 * attempted. It never creates a release and never returns publishable=true.
 */
export function checkSopGraphTransactionPreconditions(
  input: SopGraphTransactionPreconditions,
): SopGraphTransactionPreconditionResult {
  const issues: string[] = [];
  if (input.candidate.contract !== 'resume-v3-successor-candidate') issues.push('candidate contract is not supported');
  if (input.candidate.status !== 'review-only') issues.push('candidate status must remain review-only');
  if (input.candidate.publishable !== false) issues.push('candidate must remain non-publishable');
  if (input.snapshot.publishable !== false) issues.push('snapshot must remain non-publishable');
  const actualSnapshot = checkSopGraphSnapshotReadiness(input.candidate);
  if (actualSnapshot.status !== input.snapshot.status) issues.push('snapshot readiness does not match candidate');
  if (actualSnapshot.status !== 'ready-for-snapshot' || input.snapshot.status !== 'ready-for-snapshot') issues.push('graph snapshot is not ready');
  const source = input.candidate.source;
  const successorMatches = input.successorEvidence.candidateId === input.candidateId
    && input.successorEvidence.candidateVersion === input.candidateVersion
    && input.successorEvidence.contract === 'resume-v3-successor-candidate'
    && input.successorEvidence.mappingVersion === source.mappingVersion
    && input.successorEvidence.sourceSha256 === source.sourceSha256
    && input.successorEvidence.structureDigest === source.structureDigest
    && input.successorEvidence.openapiDigest === source.openapiDigest
    && input.successorEvidence.ddlDigest === source.ddlDigest
    && input.successorEvidence.migrationsDigest === source.migrationsDigest;
  if (!successorMatches) issues.push('successor evidence does not match candidate');
  if (!input.successorEvidence.accepted) issues.push('successor contract is not accepted');
  if (input.businessEvidence.candidateId !== input.candidateId || input.businessEvidence.candidateVersion !== input.candidateVersion
    || input.businessEvidence.mappingVersion !== source.mappingVersion || input.businessEvidence.sourceSha256 !== source.sourceSha256
    || !/^[0-9a-f]{64}$/u.test(input.businessEvidence.reviewDigest)) issues.push('business evidence does not match candidate');
  if (!input.businessEvidence.reviewed) issues.push('business review is not complete');
  return { status: issues.length ? 'blocked' : 'ready-for-transaction', publishable: false, issues };
}
