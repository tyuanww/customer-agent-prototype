import { createHash } from 'node:crypto';
import { REAL_SOP_MAPPING_VERSION, REAL_SOP_SOURCE_SHA256 } from './sop-real-mapping.js';
import type { SopSuccessorCandidate, SopSuccessorSourceBinding } from './sop-successor-candidate.js';
import type { SopGraphProjection } from './sop-graph-projection.js';

export type SopGraphSnapshotReadiness = Readonly<{
  status: 'ready-for-snapshot' | 'needs-information';
  publishable: false;
  issues: readonly string[];
}>;

export type SopGraphSnapshotCandidate = Readonly<{
  contract: 'resume-v3-snapshot-candidate';
  snapshotVersion: 1;
  snapshotHash: string;
  source: SopSuccessorSourceBinding;
  projection: SopGraphProjection;
  publishable: false;
}>;

export type SopGraphSnapshotCandidateResult =
  | Readonly<{ kind: 'needs-information'; publishable: false; issues: readonly string[] }>
  | Readonly<{ kind: 'candidate'; publishable: false; snapshot: SopGraphSnapshotCandidate }>;

const digest = /^[0-9a-f]{64}$/u;
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const flowIdentity = (value: unknown): string | null => {
  const key = object(value);
  if (!key || typeof key.sourceId !== 'string' || !key.sourceId || typeof key.flowId !== 'string' || !key.flowId
    || !Number.isSafeInteger(key.flowVersion) || Number(key.flowVersion) < 1) return null;
  return `${key.sourceId}/${key.flowId}/${key.flowVersion}`;
};
const entryIdentity = (value: unknown): string | null => {
  const entry = object(value);
  if (!entry || typeof entry.sourceId !== 'string' || !entry.sourceId || typeof entry.businessEntryId !== 'string' || !entry.businessEntryId
    || !Number.isSafeInteger(entry.scriptVersion) || Number(entry.scriptVersion) < 1) return null;
  return `${entry.sourceId}/${entry.businessEntryId}/${entry.scriptVersion}`;
};

const canonical = (value: unknown): string => {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = object(value);
  if (!record) throw new Error('snapshot contains a non-serializable value');
  return `{${Object.keys(record).sort().map(key => {
    if (record[key] === undefined) throw new Error(`snapshot field is undefined: ${key}`);
    return `${JSON.stringify(key)}:${canonical(record[key])}`;
  }).join(',')}}`;
};

/**
 * Check the immutable graph shape before a future database snapshot write.
 * This gate is intentionally independent from PostgreSQL and never grants
 * release authority. A ready result means only that a candidate snapshot has
 * a coherent shape and provenance.
 */
export function checkSopGraphSnapshotReadiness(candidate: SopSuccessorCandidate): SopGraphSnapshotReadiness {
  const issues: string[] = [];
  if (candidate.contract !== 'resume-v3-successor-candidate') issues.push('candidate contract is not supported');
  if (candidate.status !== 'review-only') issues.push('candidate status must remain review-only');
  if (candidate.publishable !== false) issues.push('candidate must remain non-publishable');
  if (candidate.source.mappingVersion !== REAL_SOP_MAPPING_VERSION) issues.push('mapping version is not supported');
  if (candidate.source.sourceSha256 !== REAL_SOP_SOURCE_SHA256) issues.push('source hash does not match the read-only Menokin evidence');
  for (const field of ['sourceSha256', 'structureDigest', 'openapiDigest', 'ddlDigest', 'migrationsDigest'] as const) {
    if (!digest.test(candidate.source[field])) issues.push(`${field} is not a lowercase SHA-256`);
  }
  if (candidate.projection.contract !== 'resume-v3-candidate') issues.push('graph projection contract is not supported');
  if (!candidate.projection.flows.length) issues.push('snapshot must contain at least one flow');

  const flows = new Set<string>();
  const flowReferences = new Map<string, { nodes: Set<string>; knowledge: Set<string>; entries: Set<string> }>();
  for (const flow of candidate.projection.flows) {
    const identity = flowIdentity(flow.header.key);
    if (!identity) { issues.push('flow key is invalid'); continue; }
    if (flows.has(identity)) issues.push(`duplicate flow identity: ${identity}`);
    flows.add(identity);
    const nodes = new Set<string>();
    const knowledge = new Set<string>();
    const entries = new Set<string>();
    for (const node of flow.nodes) {
      if (typeof node.id !== 'string' || !node.id) { issues.push(`invalid node identity: ${identity}`); continue; }
      if (flowIdentity(node.key) !== identity) issues.push(`node ${node.id}: key does not match flow`);
      if (nodes.has(node.id)) issues.push(`duplicate node identity: ${identity}/${node.id}`);
      nodes.add(node.id);
      const body = object(node.body);
      const knowledgeItems = body?.knowledge;
      if (Array.isArray(knowledgeItems)) for (const item of knowledgeItems) {
        const value = object(item);
        if (typeof value?.id === 'string' && value.id) knowledge.add(value.id);
      }
      const scripts = body?.scripts;
      if (Array.isArray(scripts)) for (const script of scripts) {
        const entry = entryIdentity(object(script)?.entry);
        if (entry) entries.add(entry);
      }
    }
    const anchor = entryIdentity(flow.header.anchorEntry);
    if (anchor) entries.add(anchor);
    flowReferences.set(identity, { nodes, knowledge, entries });
    if (typeof flow.header.startNodeId !== 'string' || !nodes.has(flow.header.startNodeId)) issues.push(`missing start node: ${identity}/${String(flow.header.startNodeId)}`);
    const edges = new Set<string>();
    for (const edge of flow.edges) {
      if (typeof edge.id !== 'string' || !edge.id || typeof edge.from !== 'string' || typeof edge.to !== 'string') {
        issues.push(`invalid edge identity: ${identity}`); continue;
      }
      if (flowIdentity(edge.key) !== identity) issues.push(`edge ${edge.id}: key does not match flow`);
      if (edges.has(edge.id)) issues.push(`duplicate edge identity: ${identity}/${edge.id}`);
      edges.add(edge.id);
      if (!nodes.has(edge.from) || !nodes.has(edge.to)) issues.push(`edge points outside flow: ${identity}/${edge.id}`);
    }
  }

  const scripts = new Set<string>();
  for (const body of candidate.projection.scriptBodies) {
    const entry = object(object(body)?.entry);
    const entryKey = entryIdentity(entry);
    if (!entryKey) {
      issues.push('script body entry is invalid');
      continue;
    }
    const identity = entryKey;
    if (scripts.has(identity)) issues.push(`duplicate script body entry: ${identity}`);
    scripts.add(identity);
    const record = object(body);
    if (typeof record?.title !== 'string' || !record.title.trim() || typeof record.answerText !== 'string' || !record.answerText.trim()) {
      issues.push(`script body text is invalid: ${identity}`);
    }
  }
  for (const identity of scripts) if (![...flowReferences.values()].some(refs => refs.entries.has(identity))) {
    issues.push(`script body entry is not referenced: ${identity}`);
  }

  const media = new Set<string>();
  const mediaObjects = new Set<string>();
  for (const item of candidate.projection.media) {
    const objectId = typeof item.objectId === 'string' && item.objectId ? item.objectId : null;
    const ordinal = typeof item.ordinal === 'number' ? item.ordinal : null;
    const label = objectId ?? '<invalid>';
    if (!objectId) issues.push('media <invalid>: object identity is required');
    if (ordinal === null || !Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 100) issues.push(`media ${label}: ordinal is invalid`);
    if (!digest.test(String(item.sha256))) issues.push(`media ${label}: sha256 is invalid`);
    if (item.mime !== 'image/png' && item.mime !== 'image/jpeg') issues.push(`media ${label}: mime is unsupported`);
    if (typeof item.bytes !== 'number' || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > 5 * 1024 * 1024) {
      issues.push(`media ${label}: bytes are invalid`);
    }
    if (typeof item.alt !== 'string' || !item.alt.trim() || Array.from(item.alt).length > 1024) issues.push(`media ${label}: alt is required`);
    if (typeof item.required !== 'boolean') issues.push(`media ${label}: required must be boolean`);
    if (typeof item.resourceId !== 'string' || !item.resourceId.trim()) issues.push(`media ${label}: resource identity is required`);
    if (item.audience !== 'customer' && item.audience !== 'agent' && item.audience !== 'coach') issues.push(`media ${label}: audience is invalid`);
    const applicability = object(item.applicability);
    for (const dimension of ['productRefs', 'scenarioRefs'] as const) {
      const refs = applicability?.[dimension];
      if (!Array.isArray(refs) || refs.some(ref => {
        const value = object(ref);
        return !value || typeof value.id !== 'string' || !value.id || !Number.isSafeInteger(value.displayVersion) || Number(value.displayVersion) < 1;
      })) issues.push(`media ${label}: applicability is invalid`);
    }
    if (item.audience === 'customer') {
      const entry = entryIdentity(item.entry);
      if (!entry) {
        issues.push(`media ${label}: customer entry is invalid`);
      } else if (!flowReferences.get(flowIdentity(item.flowKey) ?? '')?.entries.has(entry)) {
        issues.push(`media ${label}: script entry is not projected`);
      }
    } else {
      const target = object(item.graphTarget);
      if (!target || (target.kind !== 'task' && target.kind !== 'knowledge') || typeof target.id !== 'string' || !target.id) {
        issues.push(`media ${label}: graph target is invalid`);
      } else {
        const refs = flowReferences.get(flowIdentity(item.flowKey) ?? '');
        if (!refs || (target.kind === 'task' ? !refs.nodes.has(target.id) : !refs.knowledge.has(target.id))) {
          issues.push(`media ${label}: graph target is not projected`);
        }
      }
    }
    if (!objectId || ordinal === null || !Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 100) continue;
    const identity = `${objectId}/${ordinal}`;
    if (media.has(identity)) issues.push(`duplicate media identity: ${identity}`);
    media.add(identity);
    if (mediaObjects.has(objectId)) issues.push(`duplicate media object: ${objectId}`);
    mediaObjects.add(objectId);
    const flow = flowIdentity(item.flowKey);
    if (!flow || !flows.has(flow)) issues.push(`media ${objectId}: flow identity is not projected`);
  }

  return { status: issues.length ? 'needs-information' : 'ready-for-snapshot', publishable: false, issues };
}

/** Materialize a deterministic, immutable candidate snapshot envelope. */
export function buildSopGraphSnapshotCandidate(candidate: SopSuccessorCandidate): SopGraphSnapshotCandidateResult {
  const readiness = checkSopGraphSnapshotReadiness(candidate);
  if (readiness.status !== 'ready-for-snapshot') return { kind: 'needs-information', publishable: false, issues: readiness.issues };
  const payload = { contract: 'resume-v3-snapshot-candidate' as const, snapshotVersion: 1 as const, source: candidate.source, projection: candidate.projection };
  const snapshotHash = createHash('sha256').update(canonical(payload), 'utf8').digest('hex');
  return { kind: 'candidate', publishable: false, snapshot: { ...payload, snapshotHash, publishable: false } };
}
