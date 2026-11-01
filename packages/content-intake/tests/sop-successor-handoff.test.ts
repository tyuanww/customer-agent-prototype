import { describe, expect, it } from 'vitest';
import { REAL_SOP_MAPPING_VERSION, REAL_SOP_SOURCE_SHA256 } from '../src/sop-real-mapping.js';
import { prepareSopGraphSnapshotTransactionFromUnknown } from '../src/sop-graph-transaction.js';
import { buildSopSuccessorHandoff, parseSopSuccessorHandoff } from '../src/sop-successor-handoff.js';

const source = {
  mappingVersion: REAL_SOP_MAPPING_VERSION,
  sourceSha256: REAL_SOP_SOURCE_SHA256,
  structureDigest: '1'.repeat(64),
  openapiDigest: '2'.repeat(64),
  ddlDigest: '3'.repeat(64),
  migrationsDigest: '4'.repeat(64),
} as const;

const candidate = {
  contract: 'resume-v3-successor-candidate',
  status: 'review-only',
  publishable: false,
  source,
  projection: {
    contract: 'resume-v3-candidate',
    flows: [{
      header: {
        key: { sourceId: 'source', flowId: 'flow', flowVersion: 1 },
        title: '流程', anchorEntry: null, entryTerms: ['入口'],
        applicability: { productRefs: [], scenarioRefs: [] }, startNodeId: 'task',
        operation: 'upsert', audience: 'agent', effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null,
      },
      nodes: [{
        key: { sourceId: 'source', flowId: 'flow', flowVersion: 1 }, id: 'task',
        body: { kind: 'terminal', title: '结束', stageLabel: '结束', instruction: '结束', audience: 'agent', requirements: [], knowledge: [], scripts: [],
        },
      }],
      edges: [],
    }],
    scriptBodies: [],
    media: [],
  },
} as const;

const evidence = {
  successorEvidence: {
    accepted: true,
    candidateId: 'menokin.sop.allergy', candidateVersion: 1,
    contract: 'resume-v3-successor-candidate', ...source,
  },
  businessEvidence: {
    reviewed: true,
    candidateId: 'menokin.sop.allergy', candidateVersion: 1,
    mappingVersion: REAL_SOP_MAPPING_VERSION, sourceSha256: REAL_SOP_SOURCE_SHA256,
    reviewDigest: '5'.repeat(64),
  },
} as const;

const transaction = () => {
  const result = prepareSopGraphSnapshotTransactionFromUnknown({
    candidate,
    candidateId: 'menokin.sop.allergy', candidateVersion: 1, idempotencyKey: 'handoff-1',
    ...evidence,
  });
  if (result.kind !== 'candidate') throw new Error(result.issues.join('; '));
  return result.request;
};

describe('SOP successor handoff manifest', () => {
  it('creates and parses a compact, non-publishable handoff envelope', () => {
    const result = buildSopSuccessorHandoff(transaction());
    expect(result.kind).toBe('manifest');
    if (result.kind !== 'manifest') return;
    expect(result.manifest.publishable).toBe(false);
    expect(result.manifest.state).toBe('CANDIDATE');
    expect(result.manifest.snapshot.snapshotHash).toMatch(/^[0-9a-f]{64}$/u);

    const parsed = parseSopSuccessorHandoff(JSON.parse(JSON.stringify(result.manifest)));
    expect(parsed).toEqual(result);
  });

  it('rejects extra fields and forged source or evidence identity', () => {
    const result = buildSopSuccessorHandoff(transaction());
    if (result.kind !== 'manifest') throw new Error('fixture manifest is not ready');
    const extra = parseSopSuccessorHandoff({ ...result.manifest, extra: true });
    expect(extra).toEqual({ kind: 'needs-information', issues: ['handoff fields are invalid'] });

    const forged = parseSopSuccessorHandoff({
      ...result.manifest,
      source: { ...result.manifest.source, sourceSha256: 'f'.repeat(64) },
      successorEvidence: { ...result.manifest.successorEvidence, candidateVersion: 2 },
    });
    expect(forged.kind).toBe('needs-information');
    if (forged.kind === 'needs-information') expect(forged.issues).toEqual(expect.arrayContaining([
      'source.sourceSha256 does not match the read-only Menokin evidence',
      'successor evidence candidateVersion does not match handoff',
    ]));
  });

  it('rejects publishable or non-candidate handoffs', () => {
    const result = buildSopSuccessorHandoff(transaction());
    if (result.kind !== 'manifest') throw new Error('fixture manifest is not ready');
    const invalid = parseSopSuccessorHandoff({ ...result.manifest, state: 'PUBLISHED', publishable: true });
    expect(invalid).toEqual({ kind: 'needs-information', issues: ['state must remain CANDIDATE', 'publishable must remain false'] });

    const incomplete = parseSopSuccessorHandoff({
      ...result.manifest,
      successorEvidence: { ...result.manifest.successorEvidence, accepted: false },
      businessEvidence: { ...result.manifest.businessEvidence, reviewed: false },
    });
    expect(incomplete).toEqual(expect.objectContaining({ kind: 'needs-information' }));
    if (incomplete.kind === 'needs-information') expect(incomplete.issues).toEqual(expect.arrayContaining([
      'successor evidence must be accepted',
      'business evidence must be reviewed',
    ]));
  });
});
