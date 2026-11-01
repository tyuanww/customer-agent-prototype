import { describe, expect, it } from 'vitest';
import { REAL_SOP_MAPPING_VERSION, REAL_SOP_SOURCE_SHA256 } from '../src/sop-real-mapping.js';
import type { SopGraphSnapshotReadiness } from '../src/sop-graph-snapshot.js';
import type { SopSuccessorCandidate } from '../src/sop-successor-candidate.js';
import { checkSopGraphTransactionPreconditions, type SopBusinessReviewEvidence, type SopSuccessorAcceptanceEvidence } from '../src/sop-graph-release-gate.js';

const candidate = (): SopSuccessorCandidate => ({
  contract: 'resume-v3-successor-candidate', status: 'review-only', publishable: false,
  source: { mappingVersion: REAL_SOP_MAPPING_VERSION, sourceSha256: REAL_SOP_SOURCE_SHA256,
    structureDigest: '1'.repeat(64), openapiDigest: '2'.repeat(64), ddlDigest: '3'.repeat(64), migrationsDigest: '4'.repeat(64) },
  projection: { contract: 'resume-v3-candidate', flows: [{
    header: { key: { sourceId: 'source', flowId: 'flow', flowVersion: 1 }, title: '流程', anchorEntry: null, entryTerms: ['入口'],
      applicability: { productRefs: [], scenarioRefs: [] }, startNodeId: 'task', operation: 'upsert', audience: 'agent', effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null },
    nodes: [{ key: { sourceId: 'source', flowId: 'flow', flowVersion: 1 }, id: 'task', body: { kind: 'terminal', title: '结束', stageLabel: '结束', instruction: '结束', audience: 'agent' } }], edges: [],
  }], scriptBodies: [], media: [] },
});

const snapshot = (status: SopGraphSnapshotReadiness['status']): SopGraphSnapshotReadiness => ({
  status, publishable: false, issues: status === 'ready-for-snapshot' ? [] : ['missing graph'],
});
const successorEvidence = (accepted: boolean): SopSuccessorAcceptanceEvidence => ({ accepted, candidateId: 'menokin.sop.allergy', candidateVersion: 1, contract: 'resume-v3-successor-candidate', ...candidate().source });
const businessEvidence = (reviewed: boolean): SopBusinessReviewEvidence => ({ reviewed, candidateId: 'menokin.sop.allergy', candidateVersion: 1, mappingVersion: REAL_SOP_MAPPING_VERSION, sourceSha256: REAL_SOP_SOURCE_SHA256, reviewDigest: '5'.repeat(64) });

describe('SOP graph transaction preconditions', () => {
  it('blocks until the successor contract is accepted', () => {
    const result = checkSopGraphTransactionPreconditions({ candidateId: 'menokin.sop.allergy', candidateVersion: 1, candidate: candidate(), snapshot: snapshot('ready-for-snapshot'), successorEvidence: successorEvidence(false), businessEvidence: businessEvidence(true) });
    expect(result).toEqual({ status: 'blocked', publishable: false, issues: ['successor contract is not accepted'] });
  });

  it('blocks until business review and snapshot readiness are complete', () => {
    const result = checkSopGraphTransactionPreconditions({ candidateId: 'menokin.sop.allergy', candidateVersion: 1, candidate: candidate(), snapshot: snapshot('needs-information'), successorEvidence: successorEvidence(true), businessEvidence: businessEvidence(false) });
    expect(result.status).toBe('blocked');
    expect(result.issues).toEqual(expect.arrayContaining(['graph snapshot is not ready', 'business review is not complete']));
  });

  it('never treats a candidate as publishable even when transaction prerequisites are complete', () => {
    const result = checkSopGraphTransactionPreconditions({ candidateId: 'menokin.sop.allergy', candidateVersion: 1, candidate: candidate(), snapshot: snapshot('ready-for-snapshot'), successorEvidence: successorEvidence(true), businessEvidence: businessEvidence(true) });
    expect(result).toEqual({ status: 'ready-for-transaction', publishable: false, issues: [] });
  });

  it('rejects a candidate that is already marked publishable', () => {
    const result = checkSopGraphTransactionPreconditions({ candidateId: 'menokin.sop.allergy', candidateVersion: 1, candidate: { ...candidate(), publishable: true as never }, snapshot: snapshot('ready-for-snapshot'), successorEvidence: successorEvidence(true), businessEvidence: businessEvidence(true) });
    expect(result.status).toBe('blocked');
    expect(result.publishable).toBe(false);
    expect(result.issues).toContain('candidate must remain non-publishable');
  });

  it('recomputes readiness instead of trusting a forged ready snapshot', () => {
    const value = candidate();
    const invalid = { ...value, projection: { ...value.projection, flows: [] } };
    const result = checkSopGraphTransactionPreconditions({ candidateId: 'menokin.sop.allergy', candidateVersion: 1, candidate: invalid, snapshot: snapshot('ready-for-snapshot'), successorEvidence: successorEvidence(true), businessEvidence: businessEvidence(true) });
    expect(result.status).toBe('blocked');
    expect(result.issues).toEqual(expect.arrayContaining(['graph snapshot is not ready', 'snapshot readiness does not match candidate']));
  });

  it('rejects acceptance evidence bound to a different source', () => {
    const evidence = { ...successorEvidence(true), sourceSha256: 'f'.repeat(64) };
    const result = checkSopGraphTransactionPreconditions({ candidateId: 'menokin.sop.allergy', candidateVersion: 1, candidate: candidate(), snapshot: snapshot('ready-for-snapshot'), successorEvidence: evidence, businessEvidence: businessEvidence(true) });
    expect(result.status).toBe('blocked');
    expect(result.issues).toContain('successor evidence does not match candidate');
  });
});
