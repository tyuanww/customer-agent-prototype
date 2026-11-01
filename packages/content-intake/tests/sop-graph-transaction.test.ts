import { describe, expect, it } from 'vitest';
import { REAL_SOP_MAPPING_VERSION, REAL_SOP_SOURCE_SHA256 } from '../src/sop-real-mapping.js';
import { buildSopGraphSnapshotCandidate, type SopGraphSnapshotCandidate } from '../src/sop-graph-snapshot.js';
import { prepareSopGraphSnapshotTransaction, prepareSopGraphSnapshotTransactionFromUnknown } from '../src/sop-graph-transaction.js';
import type { SopSuccessorAcceptanceEvidence, SopBusinessReviewEvidence } from '../src/sop-graph-release-gate.js';
import { prepareSopSuccessorCandidate, type SopSuccessorCandidate } from '../src/sop-successor-candidate.js';

const source = { mappingVersion: REAL_SOP_MAPPING_VERSION, sourceSha256: REAL_SOP_SOURCE_SHA256,
  structureDigest: '1'.repeat(64), openapiDigest: '2'.repeat(64), ddlDigest: '3'.repeat(64), migrationsDigest: '4'.repeat(64) } as const;
const candidate = (): SopSuccessorCandidate => ({
  contract: 'resume-v3-successor-candidate', status: 'review-only', publishable: false, source,
  projection: { contract: 'resume-v3-candidate', flows: [{
    header: { key: { sourceId: 'source', flowId: 'flow', flowVersion: 1 }, title: '流程', anchorEntry: null, entryTerms: ['入口'], applicability: { productRefs: [], scenarioRefs: [] },
      startNodeId: 'task', operation: 'upsert', audience: 'agent', effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null },
    nodes: [{ key: { sourceId: 'source', flowId: 'flow', flowVersion: 1 }, id: 'task', body: { kind: 'terminal', title: '结束', stageLabel: '结束', instruction: '结束', audience: 'agent' } }], edges: [],
  }], scriptBodies: [], media: [] },
});
const successorEvidence = (accepted = true): SopSuccessorAcceptanceEvidence => ({ ...source, accepted, candidateId: 'menokin.sop.allergy', candidateVersion: 1, contract: 'resume-v3-successor-candidate' });
const businessEvidence = (reviewed = true): SopBusinessReviewEvidence => ({ reviewed, candidateId: 'menokin.sop.allergy', candidateVersion: 1, mappingVersion: REAL_SOP_MAPPING_VERSION, sourceSha256: REAL_SOP_SOURCE_SHA256, reviewDigest: '5'.repeat(64) });
const snapshot = (): SopGraphSnapshotCandidate => {
  const result = buildSopGraphSnapshotCandidate(candidate());
  if (result.kind !== 'candidate') throw new Error('fixture snapshot is not ready');
  return result.snapshot;
};
const preparedDraft = () => ({
  kind: 'prepared' as const,
  publishable: false as const,
  review: 'not-verified' as const,
  flows: [{
    header: { key: { sourceId: 'source', flowId: 'flow', flowVersion: 1 }, title: '流程', anchorEntry: null, entryTerms: ['入口'], applicability: { productRefs: [], scenarioRefs: [] },
      startNodeId: 'task', operation: 'upsert' as const, audience: 'agent' as const, effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null },
    nodes: [{ key: { sourceId: 'source', flowId: 'flow', flowVersion: 1 }, id: 'task', body: { kind: 'terminal' as const, title: '结束', stageLabel: '结束', instruction: '结束', audience: 'agent' as const, requirements: [], knowledge: [], scripts: [] } }],
    edges: [],
  }], media: [], scriptBodies: [],
});

describe('SOP graph snapshot transaction preparation', () => {
  it('builds an idempotent, non-publishable transaction request', () => {
    const result = prepareSopGraphSnapshotTransaction({ candidateId: 'menokin.sop.allergy', candidateVersion: 1, idempotencyKey: 'sop-graph-1', candidate: candidate(), snapshot: snapshot(), successorEvidence: successorEvidence(), businessEvidence: businessEvidence() });
    expect(result.kind).toBe('candidate');
    if (result.kind === 'candidate') {
      expect(result.request.publishable).toBe(false);
      expect(result.request.snapshot.snapshotHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(result.request.idempotencyKey).toBe('sop-graph-1');
    }
  });

  it('rejects a tampered snapshot hash before a transaction can be attempted', () => {
    const value = snapshot();
    const result = prepareSopGraphSnapshotTransaction({ candidateId: 'menokin.sop.allergy', candidateVersion: 1, idempotencyKey: 'sop-graph-1', candidate: candidate(), snapshot: { ...value, snapshotHash: 'f'.repeat(64) }, successorEvidence: successorEvidence(), businessEvidence: businessEvidence() });
    expect(result).toEqual({ kind: 'needs-information', publishable: false, issues: ['snapshot hash does not match candidate'] });
  });

  it('rejects invalid transaction identity and incomplete evidence', () => {
    const result = prepareSopGraphSnapshotTransaction({ candidateId: '', candidateVersion: 0, idempotencyKey: '', candidate: candidate(), snapshot: snapshot(), successorEvidence: successorEvidence(false), businessEvidence: businessEvidence(false) });
    expect(result.kind).toBe('needs-information');
    if (result.kind === 'needs-information') expect(result.issues).toEqual(expect.arrayContaining(['candidateId is invalid', 'candidateVersion is invalid', 'idempotencyKey is invalid', 'successor contract is not accepted', 'business review is not complete']));
  });

  it('rejects an invalid idempotency key even with otherwise complete evidence', () => {
    const result = prepareSopGraphSnapshotTransaction({ candidateId: 'menokin.sop.allergy', candidateVersion: 1, idempotencyKey: '', candidate: candidate(), snapshot: snapshot(), successorEvidence: successorEvidence(), businessEvidence: businessEvidence() });
    expect(result).toEqual({ kind: 'needs-information', publishable: false, issues: ['idempotencyKey is invalid'] });
  });

  it('rejects altered snapshot contents that retain the original claimed hash', () => {
    const value = snapshot();
    const result = prepareSopGraphSnapshotTransaction({ candidateId: 'menokin.sop.allergy', candidateVersion: 1, idempotencyKey: 'sop-graph-1', candidate: candidate(), snapshot: { ...value, projection: { ...value.projection, flows: [] } }, successorEvidence: successorEvidence(), businessEvidence: businessEvidence() });
    expect(result).toEqual({ kind: 'needs-information', publishable: false, issues: ['snapshot hash does not match candidate'] });
  });

  it('parses an external candidate before preparing its transaction request', () => {
    const raw = { contract: 'resume-v3-successor-candidate', status: 'review-only', publishable: false,
      source, projection: candidate().projection };
    const result = prepareSopGraphSnapshotTransactionFromUnknown({ candidate: raw, candidateId: 'menokin.sop.allergy', candidateVersion: 1,
      idempotencyKey: 'sop-graph-1', successorEvidence: successorEvidence(), businessEvidence: businessEvidence() });
    expect(result.kind).toBe('candidate');
  });

  it('stops malformed external candidates before snapshot or transaction preparation', () => {
    const result = prepareSopGraphSnapshotTransactionFromUnknown({ candidate: { contract: 'wrong' }, candidateId: 'menokin.sop.allergy', candidateVersion: 1,
      idempotencyKey: 'sop-graph-1', successorEvidence: successorEvidence(), businessEvidence: businessEvidence() });
    expect(result).toEqual({ kind: 'needs-information', publishable: false, issues: ['candidate fields are invalid'] });
  });

  it('runs one prepared draft through the complete review-only pipeline', () => {
    const successor = prepareSopSuccessorCandidate(preparedDraft(), source);
    expect(successor.kind).toBe('candidate');
    if (successor.kind !== 'candidate') return;
    const result = prepareSopGraphSnapshotTransactionFromUnknown({
      candidate: JSON.parse(JSON.stringify({ contract: 'resume-v3-successor-candidate', status: 'review-only', publishable: false, source: successor.source, projection: successor.projection })),
      candidateId: 'menokin.sop.allergy', candidateVersion: 1, idempotencyKey: 'pipeline-1',
      successorEvidence: successorEvidence(), businessEvidence: businessEvidence(),
    });
    expect(result.kind).toBe('candidate');
  });
});
