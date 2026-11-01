import { projectSopGraph, type SopGraphProjection } from './sop-graph-projection.js';
import { REAL_SOP_MAPPING_VERSION, REAL_SOP_SOURCE_SHA256 } from './sop-real-mapping.js';
import type { SopTaskGraphDraftResult } from './sop-task-graph-draft.js';

export const SOP_SUCCESSOR_CANDIDATE_CONTRACT = 'resume-v3-successor-candidate' as const;

export type SopSuccessorSourceBinding = Readonly<{
  mappingVersion: typeof REAL_SOP_MAPPING_VERSION;
  sourceSha256: string;
  structureDigest: string;
  openapiDigest: string;
  ddlDigest: string;
  migrationsDigest: string;
}>;

export type SopSuccessorCandidate = Readonly<{
  contract: typeof SOP_SUCCESSOR_CANDIDATE_CONTRACT;
  status: 'review-only';
  publishable: false;
  source: SopSuccessorSourceBinding;
  projection: SopGraphProjection;
}>;

export type SopSuccessorCandidateResult =
  | Readonly<{ kind: 'needs-information'; publishable: false; issues: readonly string[] }>
  | Readonly<{ kind: 'candidate'; status: 'review-only'; publishable: false; source: SopSuccessorSourceBinding; projection: SopGraphProjection }>;

const digest = /^[0-9a-f]{64}$/u;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const records = (value: unknown, label: string, issues: string[]): Record<string, unknown>[] => {
  if (!Array.isArray(value)) { issues.push(`${label} must be an array`); return []; }
  if (value.some(item => object(item) === null)) { issues.push(`${label} must contain objects`); return []; }
  return value as Record<string, unknown>[];
};

export type SopSuccessorParseResult =
  | Readonly<{ kind: 'candidate'; value: SopSuccessorCandidate }>
  | Readonly<{ kind: 'needs-information'; issues: readonly string[] }>;

/** Parse untrusted successor JSON before any graph or transaction checks. */
export function parseSopSuccessorCandidate(raw: unknown): SopSuccessorParseResult {
  const issues: string[] = [];
  const root = object(raw);
  if (!root || !exact(root, ['contract', 'status', 'publishable', 'source', 'projection'])) return { kind: 'needs-information', issues: ['candidate fields are invalid'] };
  if (root.contract !== SOP_SUCCESSOR_CANDIDATE_CONTRACT) issues.push('contract is not supported');
  if (root.status !== 'review-only') issues.push('status must remain review-only');
  if (root.publishable !== false) issues.push('publishable must remain false');
  const source = object(root.source);
  if (!source || !exact(source, ['mappingVersion', 'sourceSha256', 'structureDigest', 'openapiDigest', 'ddlDigest', 'migrationsDigest'])) {
    issues.push('source fields are invalid');
  } else {
    if (source.mappingVersion !== REAL_SOP_MAPPING_VERSION) issues.push('source.mappingVersion: mapping version is not supported');
    if (typeof source.sourceSha256 !== 'string' || !digest.test(source.sourceSha256)) issues.push('source.sourceSha256: digest must be a lowercase SHA-256');
    else if (source.sourceSha256 !== REAL_SOP_SOURCE_SHA256) issues.push('source.sourceSha256: source hash does not match the read-only Menokin evidence');
    for (const field of ['structureDigest', 'openapiDigest', 'ddlDigest', 'migrationsDigest'] as const) {
      if (typeof source[field] !== 'string' || !digest.test(source[field])) issues.push(`source.${field}: digest must be a lowercase SHA-256`);
    }
  }
  const projection = object(root.projection);
  let flows: Record<string, unknown>[] = [], scriptBodies: Record<string, unknown>[] = [], media: Record<string, unknown>[] = [];
  if (!projection || !exact(projection, ['contract', 'flows', 'scriptBodies', 'media'])) {
    issues.push('projection fields are invalid');
  } else {
    if (projection.contract !== 'resume-v3-candidate') issues.push('projection.contract is not supported');
    flows = records(projection.flows, 'projection flows', issues);
    scriptBodies = records(projection.scriptBodies, 'projection scriptBodies', issues);
    media = records(projection.media, 'projection media', issues);
    for (const flow of flows) {
      if (!exact(flow, ['header', 'nodes', 'edges']) || object(flow.header) === null) issues.push('projection flow fields are invalid');
      records(flow.nodes, 'projection flow nodes', issues);
      records(flow.edges, 'projection flow edges', issues);
    }
  }
  if (issues.length) return { kind: 'needs-information', issues };
  return { kind: 'candidate', value: {
    contract: SOP_SUCCESSOR_CANDIDATE_CONTRACT, status: 'review-only', publishable: false,
    source: source as unknown as SopSuccessorSourceBinding,
    projection: { contract: 'resume-v3-candidate', flows: flows as unknown as SopGraphProjection['flows'],
      scriptBodies: scriptBodies as unknown as SopGraphProjection['scriptBodies'], media: media as unknown as SopGraphProjection['media'] },
  } };
}

/**
 * Binds a complete graph projection to the exact source and contract evidence.
 * This is a review-only envelope. It cannot authorize a release or change the
 * empty formal SOP snapshot consumed by the API.
 */
export function prepareSopSuccessorCandidate(
  draft: SopTaskGraphDraftResult,
  source: SopSuccessorSourceBinding,
): SopSuccessorCandidateResult {
  const issues: string[] = [];
  if (source.mappingVersion !== REAL_SOP_MAPPING_VERSION) issues.push('mappingVersion: mapping version is not supported');
  if (!digest.test(source.sourceSha256)) issues.push('sourceSha256: digest must be a lowercase SHA-256');
  else if (source.sourceSha256 !== REAL_SOP_SOURCE_SHA256) issues.push('sourceSha256: source hash does not match the read-only Menokin evidence');
  for (const field of ['structureDigest', 'openapiDigest', 'ddlDigest', 'migrationsDigest'] as const) {
    if (!digest.test(source[field])) issues.push(`${field}: digest must be a lowercase SHA-256`);
  }
  if (issues.length) return { kind: 'needs-information', publishable: false, issues };

  const projection = projectSopGraph(draft);
  if (projection.kind !== 'projected') return projection;
  return {
    kind: 'candidate', status: 'review-only', publishable: false,
    source: { ...source }, projection: projection.projection,
  };
}
