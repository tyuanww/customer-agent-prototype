import type { SopBusinessReviewEvidence, SopSuccessorAcceptanceEvidence } from './sop-graph-release-gate.js';
import type { SopGraphSnapshotTransactionRequest } from './sop-graph-transaction.js';
import { REAL_SOP_MAPPING_VERSION, REAL_SOP_SOURCE_SHA256 } from './sop-real-mapping.js';
import type { SopSuccessorSourceBinding } from './sop-successor-candidate.js';

export const SOP_SUCCESSOR_HANDOFF_SCHEMA = 'menokin-sop-successor-handoff-v1' as const;

export type SopSuccessorHandoffManifest = Readonly<{
  schema: typeof SOP_SUCCESSOR_HANDOFF_SCHEMA;
  state: 'CANDIDATE';
  publishable: false;
  candidateId: string;
  candidateVersion: number;
  idempotencyKey: string;
  source: SopSuccessorSourceBinding;
  snapshot: Readonly<{ contract: 'resume-v3-snapshot-candidate'; snapshotVersion: 1; snapshotHash: string }>;
  successorEvidence: SopSuccessorAcceptanceEvidence;
  businessEvidence: SopBusinessReviewEvidence;
}>;

export type SopSuccessorHandoffResult =
  | Readonly<{ kind: 'manifest'; manifest: SopSuccessorHandoffManifest }>
  | Readonly<{ kind: 'needs-information'; issues: readonly string[] }>;

const digest = /^[0-9a-f]{64}$/u;
const id = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const idempotency = /^[A-Za-z0-9._:-]{1,128}$/u;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const sourceFields = ['mappingVersion', 'sourceSha256', 'structureDigest', 'openapiDigest', 'ddlDigest', 'migrationsDigest'] as const;

const parseSource = (value: unknown, issues: string[]): SopSuccessorSourceBinding | null => {
  const source = object(value);
  if (!source || !exact(source, sourceFields)) {
    issues.push('source is invalid');
    return null;
  }
  if (source.mappingVersion !== REAL_SOP_MAPPING_VERSION) issues.push('source.mappingVersion is not supported');
  if (source.sourceSha256 !== REAL_SOP_SOURCE_SHA256) issues.push('source.sourceSha256 does not match the read-only Menokin evidence');
  for (const field of sourceFields.slice(1)) {
    if (typeof source[field] !== 'string' || !digest.test(source[field])) issues.push(`source.${field} is invalid`);
  }
  return source as unknown as SopSuccessorSourceBinding;
};

const parseSuccessorEvidence = (value: unknown, root: Record<string, unknown>, source: SopSuccessorSourceBinding | null, issues: string[]): SopSuccessorAcceptanceEvidence | null => {
  const evidence = object(value);
  const fields = ['accepted', 'candidateId', 'candidateVersion', 'contract', ...sourceFields] as const;
  if (!evidence || !exact(evidence, fields)) {
    issues.push('successor evidence is invalid');
    return null;
  }
  if (typeof evidence.accepted !== 'boolean') issues.push('successor evidence accepted is invalid');
  else if (evidence.accepted !== true) issues.push('successor evidence must be accepted');
  if (evidence.contract !== 'resume-v3-successor-candidate') issues.push('successor evidence contract is invalid');
  if (evidence.candidateId !== root.candidateId) issues.push('successor evidence candidateId does not match handoff');
  if (evidence.candidateVersion !== root.candidateVersion) issues.push('successor evidence candidateVersion does not match handoff');
  if (source) {
    for (const field of sourceFields) if (evidence[field] !== source[field]) issues.push(`successor evidence ${field} does not match source`);
  }
  if (typeof evidence.sourceSha256 !== 'string' || !digest.test(evidence.sourceSha256)) issues.push('successor evidence sourceSha256 is invalid');
  for (const field of ['structureDigest', 'openapiDigest', 'ddlDigest', 'migrationsDigest'] as const) {
    if (typeof evidence[field] !== 'string' || !digest.test(evidence[field])) issues.push(`successor evidence ${field} is invalid`);
  }
  return evidence as unknown as SopSuccessorAcceptanceEvidence;
};

const parseBusinessEvidence = (value: unknown, root: Record<string, unknown>, source: SopSuccessorSourceBinding | null, issues: string[]): SopBusinessReviewEvidence | null => {
  const evidence = object(value);
  const fields = ['reviewed', 'candidateId', 'candidateVersion', 'mappingVersion', 'sourceSha256', 'reviewDigest'] as const;
  if (!evidence || !exact(evidence, fields)) {
    issues.push('business evidence is invalid');
    return null;
  }
  if (typeof evidence.reviewed !== 'boolean') issues.push('business evidence reviewed is invalid');
  else if (evidence.reviewed !== true) issues.push('business evidence must be reviewed');
  if (evidence.candidateId !== root.candidateId) issues.push('business evidence candidateId does not match handoff');
  if (evidence.candidateVersion !== root.candidateVersion) issues.push('business evidence candidateVersion does not match handoff');
  if (source && evidence.mappingVersion !== source.mappingVersion) issues.push('business evidence mappingVersion does not match source');
  if (source && evidence.sourceSha256 !== source.sourceSha256) issues.push('business evidence sourceSha256 does not match source');
  if (typeof evidence.reviewDigest !== 'string' || !digest.test(evidence.reviewDigest)) issues.push('business evidence reviewDigest is invalid');
  return evidence as unknown as SopBusinessReviewEvidence;
};

export function buildSopSuccessorHandoff(request: SopGraphSnapshotTransactionRequest): SopSuccessorHandoffResult {
  if (request.publishable !== false) return { kind: 'needs-information', issues: ['transaction request must remain non-publishable'] };
  return { kind: 'manifest', manifest: {
    schema: SOP_SUCCESSOR_HANDOFF_SCHEMA, state: 'CANDIDATE', publishable: false,
    candidateId: request.candidateId, candidateVersion: request.candidateVersion, idempotencyKey: request.idempotencyKey,
    source: request.snapshot.source,
    snapshot: { contract: request.snapshot.contract, snapshotVersion: request.snapshot.snapshotVersion, snapshotHash: request.snapshot.snapshotHash },
    successorEvidence: request.successorEvidence, businessEvidence: request.businessEvidence,
  } };
}

/** Parse the compact handoff envelope. Graph contents remain in the source-bound snapshot. */
export function parseSopSuccessorHandoff(raw: unknown): SopSuccessorHandoffResult {
  const root = object(raw);
  if (!root || !exact(root, ['schema', 'state', 'publishable', 'candidateId', 'candidateVersion', 'idempotencyKey', 'source', 'snapshot', 'successorEvidence', 'businessEvidence'])) {
    return { kind: 'needs-information', issues: ['handoff fields are invalid'] };
  }
  const issues: string[] = [];
  if (root.schema !== SOP_SUCCESSOR_HANDOFF_SCHEMA) issues.push('schema is not supported');
  if (root.state !== 'CANDIDATE') issues.push('state must remain CANDIDATE');
  if (root.publishable !== false) issues.push('publishable must remain false');
  if (typeof root.candidateId !== 'string' || !id.test(root.candidateId)) issues.push('candidateId is invalid');
  if (typeof root.candidateVersion !== 'number' || !Number.isSafeInteger(root.candidateVersion) || root.candidateVersion < 1) issues.push('candidateVersion is invalid');
  if (typeof root.idempotencyKey !== 'string' || !idempotency.test(root.idempotencyKey)) issues.push('idempotencyKey is invalid');
  const source = parseSource(root.source, issues);
  const snapshot = object(root.snapshot);
  if (!snapshot || !exact(snapshot, ['contract', 'snapshotVersion', 'snapshotHash']) || snapshot.contract !== 'resume-v3-snapshot-candidate' || snapshot.snapshotVersion !== 1 || typeof snapshot.snapshotHash !== 'string' || !digest.test(snapshot.snapshotHash)) issues.push('snapshot is invalid');
  const successorEvidence = parseSuccessorEvidence(root.successorEvidence, root, source, issues);
  const businessEvidence = parseBusinessEvidence(root.businessEvidence, root, source, issues);
  if (issues.length) return { kind: 'needs-information', issues };
  return { kind: 'manifest', manifest: {
    schema: SOP_SUCCESSOR_HANDOFF_SCHEMA,
    state: 'CANDIDATE',
    publishable: false,
    candidateId: root.candidateId as string,
    candidateVersion: root.candidateVersion as number,
    idempotencyKey: root.idempotencyKey as string,
    source: source as SopSuccessorSourceBinding,
    snapshot: snapshot as unknown as SopSuccessorHandoffManifest['snapshot'],
    successorEvidence: successorEvidence as SopSuccessorAcceptanceEvidence,
    businessEvidence: businessEvidence as SopBusinessReviewEvidence,
  } };
}
