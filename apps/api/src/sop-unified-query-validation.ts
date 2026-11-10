import { parseContractSchema } from '@customer-agent/contracts/sop-unified';
import type { components } from '@customer-agent/contracts/sop-unified';
import { canonical } from './content-intake/material.js';
import { graphDigest, validateGraph } from './content-intake/sop-graph.js';
import { IntakeRejection } from './content-intake/transaction.js';
import {
  SOP_QUERY_MAX_RESPONSE_BYTES, type SopGraph, type SopQueryReasonCode,
  type UnifiedSopQueryResponse, type UnifiedSopReadyResult,
} from './sop-unified-query-model.js';

type EntryRef = components['schemas']['IntakeSopEntryRef'];
export const sopEntryKey = (ref: EntryRef): string => canonical([ref.sourceId, ref.businessEntryId, ref.scriptVersion]);
export const sopGraphDigest = graphDigest;

export class SopQueryIntegrityError extends Error {
  constructor(readonly reason: SopQueryReasonCode) { super(reason); }
}
function reject(reason: SopQueryReasonCode = 'GRAPH_UNRESOLVED'): never {
  throw new SopQueryIntegrityError(reason);
}
function exactSet(actual: string[], expected: Set<string>): void {
  if (new Set(actual).size !== actual.length || actual.length !== expected.size
    || actual.some(key => !expected.has(key))) reject();
}
function allergySafe(title: string, body: string): void {
  if ((title.includes('过敏') || body.includes('过敏')) && (!body.includes('停手') || !body.includes('确认'))) {
    reject('SAFETY_REVIEW_REQUIRED');
  }
}

/** Checks the complete frozen graph before query matching. No sequence, risk or
 * copy permission is inferred from text, node position or an empty collection. */
export function assertSopQueryGraph(graph: SopGraph, expectedDigest: string): void {
  if (sopGraphDigest(graph) !== expectedDigest) reject();
  assertSopQueryStructure(graph);
}

function assertSopQueryStructure(graph: SopGraph): void {
  if (graph.definition.nodes.some(node => node.body.kind === 'terminal'
    && graph.definition.edges.some(edge => edge.from === node.id))) reject('TERMINAL_HAS_OUTGOING_EDGE');
  // Entry owner identity follows the storage owner+ordinal key. A second exact
  // script version cannot make an ambiguous owner ordinal distinct.
  const ordinals = graph.media.map(media => canonical([media.entry ? 'entry' : media.graphTarget?.kind ?? null,
    media.entry?.businessEntryId ?? media.graphTarget?.id ?? null, media.ordinal]));
  if (new Set(ordinals).size !== ordinals.length) reject('MEDIA_UNVERIFIED');
  try { validateGraph(graph); }
  catch (error) {
    if (!(error instanceof IntakeRejection)) throw error;
    reject(error.reason === 'SOP_GRAPH_INVALID' && graph.definition.nodes.some(node =>
      (node.body.title.includes('过敏') || node.body.instruction.includes('过敏'))
      && (!node.body.instruction.includes('停手') || !node.body.instruction.includes('确认')))
      ? 'SAFETY_REVIEW_REQUIRED' : 'GRAPH_UNRESOLVED');
  }
  if (graph.definition.header.operation !== 'upsert') reject();
  for (const node of graph.definition.nodes) {
    allergySafe(node.body.title, node.body.instruction);
    for (const item of node.body.knowledge) allergySafe(item.title, item.body);
  }
  for (const item of graph.entries) allergySafe(item.entry.title, item.entry.answerText);
}

export function assertSopQueryReady(result: UnifiedSopReadyResult, expiresAt: string, now: number): void {
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 300_000) reject('LEASE_EXPIRED');
  const graph = { definition: result.flow, entries: result.entries, media: result.media.map(item => item.binding) };
  // The server verified the full stored graph. Wire media is an authorized
  // subset, so its canonical bytes cannot reconstruct the original digest.
  assertSopQueryStructure(graph);
  exactSet(result.permissions.map(item => sopEntryKey(item.entry)),
    new Set(result.entries.map(item => sopEntryKey({ sourceId: item.sourceId, ...item.entry }))));
  const validWindow = (from: string, to: string | null) => {
    if (Date.parse(from) > now || to !== null && Date.parse(to) < expiry) reject('STALE_RELEASE');
  };
  validWindow(result.flow.header.effectiveFrom, result.flow.header.effectiveTo);
  for (const item of result.entries) {
    validWindow(item.entry.effectiveFrom, item.entry.effectiveTo);
  }
  const handles = new Set<string>();
  for (const media of result.media) {
    const until = Date.parse(media.expires_at);
    if (until <= now || until > expiry || handles.has(media.preview_handle)) reject('MEDIA_UNVERIFIED');
    handles.add(media.preview_handle);
  }
}

/** Validates actual UTF-8 wire size and cross-object integrity, after generated
 * schema parsing. A schema-valid response alone does not prove graph closure. */
export function parseUnifiedSopQueryResponse(raw: unknown, requestId: string, now = Date.now()): UnifiedSopQueryResponse {
  if (Buffer.byteLength(JSON.stringify(raw) ?? '') > SOP_QUERY_MAX_RESPONSE_BYTES) reject();
  const value = parseContractSchema('MenokinSopQuerySopQueryResponse', raw);
  if (value.request_id !== requestId) reject();
  if (value.status === 'ready') assertSopQueryReady(value.result, value.lease_expires_at, now);
  if (value.status === 'no_match') {
    const expiry = Date.parse(value.lease_expires_at);
    if (expiry <= now || expiry > now + 300_000) reject('LEASE_EXPIRED');
  }
  return value;
}
