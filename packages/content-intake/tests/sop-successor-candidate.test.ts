import { describe, expect, it } from 'vitest';
import { REAL_SOP_MAPPING_VERSION, REAL_SOP_SOURCE_SHA256 } from '../src/sop-real-mapping.js';
import { parseSopSuccessorCandidate, prepareSopSuccessorCandidate, type SopSuccessorSourceBinding } from '../src/sop-successor-candidate.js';

const source = (): SopSuccessorSourceBinding => ({
  mappingVersion: REAL_SOP_MAPPING_VERSION,
  sourceSha256: REAL_SOP_SOURCE_SHA256,
  structureDigest: '1'.repeat(64),
  openapiDigest: '2'.repeat(64),
  ddlDigest: '3'.repeat(64),
  migrationsDigest: '4'.repeat(64),
});

const prepared = () => ({
  kind: 'prepared' as const,
  publishable: false as const,
  review: 'not-verified' as const,
  flows: [{
    header: {
      key: { sourceId: 'source', flowId: 'flow', flowVersion: 1 }, title: '流程', anchorEntry: null, entryTerms: ['入口'],
      applicability: { productRefs: [], scenarioRefs: [] }, startNodeId: 'task', operation: 'upsert' as const,
      audience: 'agent' as const, effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null,
    },
    nodes: [{
      key: { sourceId: 'source', flowId: 'flow', flowVersion: 1 }, id: 'task',
      body: { kind: 'terminal' as const, title: '结束', stageLabel: '结束', instruction: '结束', audience: 'agent' as const,
        requirements: [], knowledge: [], scripts: [], },
    }],
    edges: [],
  }],
  media: [],
  scriptBodies: [],
});

describe('SOP successor candidate intake', () => {
  it('binds a prepared graph to source digests while keeping it review-only', () => {
    const result = prepareSopSuccessorCandidate(prepared(), source());
    expect(result.kind).toBe('candidate');
    if (result.kind === 'candidate') {
      expect(result.publishable).toBe(false);
      expect(result.status).toBe('review-only');
      expect(result.source.sourceSha256).toBe(REAL_SOP_SOURCE_SHA256);
      expect(result.projection.contract).toBe('resume-v3-candidate');
    }
  });

  it('rejects an unresolved graph before attaching source metadata', () => {
    const result = prepareSopSuccessorCandidate({
      kind: 'needs-information', publishable: false, review: 'not-verified',
      issues: [{ kind: 'mapping-required', recordId: 'flow', field: 'entry', reason: 'missing' }],
    }, source());
    expect(result).toEqual({ kind: 'needs-information', publishable: false, issues: ['flow:entry:missing'] });
  });

  it('rejects mismatched source identity and malformed digest fields', () => {
    const result = prepareSopSuccessorCandidate(prepared(), {
      ...source(), sourceSha256: 'f'.repeat(64), structureDigest: 'bad',
    });
    expect(result.kind).toBe('needs-information');
    if (result.kind === 'needs-information') {
      expect(result.issues).toEqual(expect.arrayContaining([
        'sourceSha256: source hash does not match the read-only Menokin evidence',
        'structureDigest: digest must be a lowercase SHA-256',
      ]));
    }
  });

  it('rejects a mapping version that is not the registered real mapping', () => {
    const result = prepareSopSuccessorCandidate(prepared(), { ...source(), mappingVersion: 'legacy' as never });
    expect(result).toEqual({ kind: 'needs-information', publishable: false, issues: ['mappingVersion: mapping version is not supported'] });
  });

  it('parses a JSON candidate at the external boundary', () => {
    const preparedResult = prepareSopSuccessorCandidate(prepared(), source());
    if (preparedResult.kind !== 'candidate') throw new Error('fixture candidate is not ready');
    const result = parseSopSuccessorCandidate(JSON.parse(JSON.stringify({
      contract: 'resume-v3-successor-candidate', status: 'review-only', publishable: false,
      source: preparedResult.source, projection: preparedResult.projection,
    })));
    expect(result.kind).toBe('candidate');
    if (result.kind === 'candidate') expect(result.value.source.sourceSha256).toBe(REAL_SOP_SOURCE_SHA256);
  });

  it('rejects extra envelope fields and malformed projection members', () => {
    const extra = parseSopSuccessorCandidate({ contract: 'resume-v3-successor-candidate', status: 'review-only', publishable: false,
      source: source(), projection: { contract: 'resume-v3-candidate', flows: [], scriptBodies: [], media: [] }, extra: true });
    expect(extra).toEqual({ kind: 'needs-information', issues: ['candidate fields are invalid'] });
    const malformed = parseSopSuccessorCandidate({ contract: 'resume-v3-successor-candidate', status: 'review-only', publishable: false,
      source: source(), projection: { contract: 'resume-v3-candidate', flows: [null], scriptBodies: [], media: [] } });
    expect(malformed).toEqual({ kind: 'needs-information', issues: ['projection flows must contain objects'] });
  });

  it('rejects source identity and projection shape at the boundary', () => {
    const result = parseSopSuccessorCandidate({ contract: 'resume-v3-successor-candidate', status: 'review-only', publishable: false,
      source: { ...source(), sourceSha256: 'f'.repeat(64) }, projection: { contract: 'resume-v3-candidate', flows: [], scriptBodies: 'bad', media: [] } });
    expect(result.kind).toBe('needs-information');
    if (result.kind === 'needs-information') expect(result.issues).toEqual(expect.arrayContaining([
      'source.sourceSha256: source hash does not match the read-only Menokin evidence',
      'projection scriptBodies must be an array',
    ]));
  });
});
