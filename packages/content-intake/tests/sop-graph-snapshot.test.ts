import { describe, expect, it } from 'vitest';
import { REAL_SOP_MAPPING_VERSION, REAL_SOP_SOURCE_SHA256 } from '../src/sop-real-mapping.js';
import type { SopGraphProjection } from '../src/sop-graph-projection.js';
import type { SopSuccessorCandidate } from '../src/sop-successor-candidate.js';
import { buildSopGraphSnapshotCandidate, checkSopGraphSnapshotReadiness } from '../src/sop-graph-snapshot.js';

const key = { sourceId: 'source', flowId: 'flow', flowVersion: 1 } as const;
const candidate = (): SopSuccessorCandidate => ({
  contract: 'resume-v3-successor-candidate', status: 'review-only', publishable: false,
  source: { mappingVersion: REAL_SOP_MAPPING_VERSION, sourceSha256: REAL_SOP_SOURCE_SHA256,
    structureDigest: '1'.repeat(64), openapiDigest: '2'.repeat(64), ddlDigest: '3'.repeat(64), migrationsDigest: '4'.repeat(64) },
  projection: {
    contract: 'resume-v3-candidate',
    flows: [{
      header: { key, title: '流程', anchorEntry: null, entryTerms: ['入口'], applicability: { productRefs: [], scenarioRefs: [] },
        startNodeId: 'task', operation: 'upsert', audience: 'agent', effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null },
      nodes: [{ key, id: 'task', body: { kind: 'terminal', title: '结束', stageLabel: '结束', instruction: '结束', audience: 'agent' } }],
      edges: [],
    }],
    scriptBodies: [], media: [],
  } satisfies SopGraphProjection,
});

describe('SOP graph snapshot readiness', () => {
  it('accepts a complete candidate envelope without making it publishable', () => {
    expect(checkSopGraphSnapshotReadiness(candidate())).toEqual({ status: 'ready-for-snapshot', publishable: false, issues: [] });
  });

  it('rejects duplicate flow identities', () => {
    const value = candidate();
    const result = checkSopGraphSnapshotReadiness({ ...value, projection: { ...value.projection, flows: [...value.projection.flows, value.projection.flows[0]!] } });
    expect(result.status).toBe('needs-information');
    expect(result.issues).toContain('duplicate flow identity: source/flow/1');
  });

  it('rejects media that points outside the projected flow set', () => {
    const value = candidate();
    const result = checkSopGraphSnapshotReadiness({ ...value, projection: { ...value.projection, media: [{
      objectId: 'obj', sha256: 'a'.repeat(64), mime: 'image/png', bytes: 1, ordinal: 1, alt: '图', required: true,
      flowKey: { sourceId: 'source', flowId: 'missing', flowVersion: 1 }, resourceId: 'resource', applicability: { productRefs: [], scenarioRefs: [] },
      audience: 'agent', graphTarget: { kind: 'task', id: 'task' },
    }] } });
    expect(result.status).toBe('needs-information');
    expect(result.issues).toContain('media obj: flow identity is not projected');
  });

  it('rejects duplicate media identities within a snapshot', () => {
    const value = candidate();
    const media = { objectId: 'obj', sha256: 'a'.repeat(64), mime: 'image/png' as const, bytes: 1, ordinal: 1, alt: '图', required: true,
      flowKey: key, resourceId: 'resource', applicability: { productRefs: [], scenarioRefs: [] }, audience: 'agent' as const, graphTarget: { kind: 'task' as const, id: 'task' } };
    const result = checkSopGraphSnapshotReadiness({ ...value, projection: { ...value.projection, media: [media, media] } });
    expect(result.status).toBe('needs-information');
    expect(result.issues).toContain('duplicate media identity: obj/1');
  });

  it('rejects malformed media metadata', () => {
    const value = candidate();
    const result = checkSopGraphSnapshotReadiness({ ...value, projection: { ...value.projection, media: [{
      objectId: 'obj', sha256: 'bad', mime: 'image/gif', bytes: 0, ordinal: 0, alt: '', required: 'yes',
      flowKey: key, resourceId: '', applicability: { productRefs: [], scenarioRefs: [] }, audience: 'other', graphTarget: { kind: 'unknown', id: '' },
    }] } });
    expect(result.status).toBe('needs-information');
    expect(result.issues).toEqual(expect.arrayContaining([
      'media obj: sha256 is invalid',
      'media obj: mime is unsupported',
      'media obj: bytes are invalid',
      'media obj: ordinal is invalid',
      'media obj: alt is required',
      'media obj: required must be boolean',
      'media obj: resource identity is required',
      'media obj: audience is invalid',
    ]));
  });

  it('rejects the same media object even when its ordinal changes', () => {
    const value = candidate();
    const media = (ordinal: number) => ({ objectId: 'obj', sha256: 'a'.repeat(64), mime: 'image/png' as const, bytes: 1, ordinal, alt: '图', required: true,
      flowKey: key, resourceId: 'resource', applicability: { productRefs: [], scenarioRefs: [] }, audience: 'agent' as const, graphTarget: { kind: 'task' as const, id: 'task' } });
    const result = checkSopGraphSnapshotReadiness({ ...value, projection: { ...value.projection, media: [media(1), media(2)] } });
    expect(result.issues).toContain('duplicate media object: obj');
  });

  it('rejects empty flow identities and non-positive versions', () => {
    const value = candidate();
    const result = checkSopGraphSnapshotReadiness({ ...value, projection: { ...value.projection, flows: [{
      ...value.projection.flows[0]!, header: { ...value.projection.flows[0]!.header, key: { sourceId: '', flowId: '', flowVersion: 0 } },
    }] } });
    expect(result.issues).toContain('flow key is invalid');
  });

  it('rejects node and edge keys that do not match their flow', () => {
    const value = candidate();
    const flow = value.projection.flows[0]!;
    const result = checkSopGraphSnapshotReadiness({ ...value, projection: { ...value.projection, flows: [{
      ...flow,
      nodes: [{ ...flow.nodes[0]!, key: { sourceId: 'other', flowId: 'other', flowVersion: 1 } }],
      edges: [{ key: { sourceId: 'other', flowId: 'other', flowVersion: 1 }, id: 'edge', from: 'task', to: 'task', action: { kind: 'next' } }],
    }] } });
    expect(result.issues).toEqual(expect.arrayContaining(['node task: key does not match flow', 'edge edge: key does not match flow']));
  });

  it('rejects invalid or duplicate script body entries', () => {
    const value = candidate();
    const script = { entry: { sourceId: 'source', businessEntryId: 'entry', scriptVersion: 1 }, title: '话术', answerText: '回答' };
    const result = checkSopGraphSnapshotReadiness({ ...value, projection: { ...value.projection, scriptBodies: [script, script, { entry: { sourceId: '', businessEntryId: '', scriptVersion: 0 }, title: '', answerText: '' }] } });
    expect(result.issues).toEqual(expect.arrayContaining(['duplicate script body entry: source/entry/1', 'script body entry is invalid']));
  });

  it('rejects media that targets a missing task or knowledge item', () => {
    const value = candidate();
    const result = checkSopGraphSnapshotReadiness({ ...value, projection: { ...value.projection, media: [{
      objectId: 'obj', sha256: 'a'.repeat(64), mime: 'image/png', bytes: 1, ordinal: 1, alt: '图', required: true,
      flowKey: key, resourceId: 'resource', applicability: { productRefs: [], scenarioRefs: [] }, audience: 'agent', graphTarget: { kind: 'task', id: 'missing' },
    }] } });
    expect(result.issues).toContain('media obj: graph target is not projected');
  });

  it('rejects script bodies that are not referenced by a flow', () => {
    const value = candidate();
    const result = checkSopGraphSnapshotReadiness({ ...value, projection: { ...value.projection, scriptBodies: [{
      entry: { sourceId: 'source', businessEntryId: 'entry', scriptVersion: 1 }, title: '话术', answerText: '回答',
    }] } });
    expect(result.issues).toContain('script body entry is not referenced: source/entry/1');
  });

  it('builds a deterministic non-publishable snapshot candidate', () => {
    const first = buildSopGraphSnapshotCandidate(candidate());
    const second = buildSopGraphSnapshotCandidate(candidate());
    expect(first.kind).toBe('candidate');
    expect(second.kind).toBe('candidate');
    if (first.kind === 'candidate' && second.kind === 'candidate') {
      expect(first.snapshot.snapshotVersion).toBe(1);
      expect(first.snapshot.snapshotHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(first.snapshot.snapshotHash).toBe(second.snapshot.snapshotHash);
      expect(first.snapshot.publishable).toBe(false);
    }
  });

  it('does not build a snapshot candidate from an unready graph', () => {
    const value = candidate();
    const result = buildSopGraphSnapshotCandidate({ ...value, projection: { ...value.projection, flows: [] } });
    expect(result).toEqual({ kind: 'needs-information', publishable: false, issues: ['snapshot must contain at least one flow'] });
  });
});
