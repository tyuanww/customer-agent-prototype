import { parseContractSchema, validateContractSchema } from '@customer-agent/contracts/sop-unified';
import type { ContentAttachmentStore, ReservedAttachment } from './content-object-store.js';
import { canonical } from './content-intake/material.js';
import type { IntakeTransaction } from './content-intake/transaction.js';
import type { SopGraph, SopEntryPermission, SopQueryReasonCode, UnifiedSopQueryRequest, UnifiedSopQueryResponse } from './sop-unified-query-model.js';
import { assertSopQueryGraph, SopQueryIntegrityError, sopEntryKey } from './sop-unified-query-validation.js';
import { parseSopQueryPublicationFacts, type SopQueryPublicationFacts } from './sop-unified-query-facts.js';
import { verifyGraphMedia } from './content-intake/sop-graph.js';
import { IntakeRejection } from './content-intake/transaction.js';

type SopQueryFactIdentity = { candidateId: string; candidateVersion: number; version: number;
  sopGroup: UnifiedSopQueryRequest['sop_group'] };
type ReadySopQueryFacts = SopQueryFactIdentity & { kind: 'ready'; permissions: SopEntryPermission[];
  publicationFacts: SopQueryPublicationFacts };
type SopQueryFacts = ReadySopQueryFacts | (SopQueryFactIdentity & { kind: 'blocked'; reason: SopQueryReasonCode });
export type SopQueryGraphBundle = { graph: SopGraph; graphDigest: string; selectedMedia: SopGraph['media']; facts: SopQueryFacts | null };
export type SopQuerySelection = { kind: 'none' } | { kind: 'blocked'; reason: SopQueryReasonCode }
  | { kind: 'ready'; selected: Omit<SopQueryGraphBundle, 'facts'> & { facts: ReadySopQueryFacts } };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function invalid(): never { throw new SopQueryIntegrityError('GRAPH_UNRESOLVED'); }

/** Common C/D graph boundary. The caller must already own a current entitlement
 * or D's separately authorized active-use entitlement. No release is accepted. */
export function parseSopQueryBundle(raw: unknown): { graphs: SopQueryGraphBundle[]; validUntil: number } {
  if (!record(raw) || !Array.isArray(raw.graphs) || typeof raw.validUntil !== 'string'
    || !Number.isFinite(Date.parse(raw.validUntil))) return invalid();
  const graphs = raw.graphs.map((item): SopQueryGraphBundle => {
    if (!record(item) || !record(item.payload) || !Array.isArray(item.payload.entries) || !Array.isArray(item.payload.media)) return invalid();
    const graph: SopGraph = {
      definition: parseContractSchema('IntakeSopFlowDefinition', item.payload.definition),
      entries: item.payload.entries.map(dep => {
        if (!record(dep)) return invalid();
        return { sourceId: parseContractSchema('IntakeSopId', dep.sourceId), entry: parseContractSchema('IntakePublishedEntry', dep.entry) };
      }),
      media: item.payload.media.map(media => parseContractSchema('IntakeSopMedia', media)),
    };
    const graphDigest = parseContractSchema('IntakeSopHash', item.graphDigest);
    assertSopQueryGraph(graph, graphDigest);
    if (!Array.isArray(item.selectedMedia)) return invalid();
    const selectedMedia = item.selectedMedia.map(media => parseContractSchema('IntakeSopMedia', media));
    const originalMedia = new Set(graph.media.map(media => canonical(media)));
    if (new Set(selectedMedia.map(media => canonical(media))).size !== selectedMedia.length
      || selectedMedia.some(media => !originalMedia.has(canonical(media)))) return invalid();
    if (item.facts === null) return { graph, graphDigest, selectedMedia, facts: null };
    const facts = item.facts;
    if (!record(facts) || !Array.isArray(facts.permissions)) return invalid();
    const sopGroup = parseContractSchema('MenokinSopQuerySopQueryRequest', {
      sop_group: facts.sopGroup, shop_id: 'synthetic-validation', query_text: 'synthetic',
      context_generation: 'synthetic', request_id: '00000000-0000-4000-8000-000000000001',
    }).sop_group;
    const identity = { candidateId: parseContractSchema('IntakeId', facts.candidateId),
      candidateVersion: parseContractSchema('IntakeVersion', facts.candidateVersion),
      version: parseContractSchema('IntakeVersion', facts.version), sopGroup };
    const permissions: SopEntryPermission[] = [];
    for (const permission of facts.permissions) {
      if (record(permission) && (permission.risk_level === 'unclassified' || permission.copy_allowed === null)) {
        return { graph, graphDigest, selectedMedia, facts: { ...identity, kind: 'blocked', reason: 'SAFETY_REVIEW_REQUIRED' } };
      }
      const parsed = validateContractSchema('MenokinSopQuerySopEntryPermission', permission);
      if (!parsed.ok) return { graph, graphDigest, selectedMedia, facts: { ...identity, kind: 'blocked', reason: 'SAFETY_REVIEW_REQUIRED' } };
      permissions.push(parsed.value);
    }
    const keys = new Set(permissions.map(permission => sopEntryKey(permission.entry)));
    if (keys.size !== permissions.length || keys.size !== graph.entries.length
      || graph.entries.some(dep => !keys.has(sopEntryKey({ sourceId: dep.sourceId, ...dep.entry })))) {
      return { graph, graphDigest, selectedMedia, facts: { ...identity, kind: 'blocked', reason: 'GRAPH_UNRESOLVED' } };
    }
    return { graph, graphDigest, selectedMedia, facts: { ...identity, kind: 'ready', permissions,
      publicationFacts: parseSopQueryPublicationFacts(facts.publicationFacts) } };
  });
  return { graphs, validUntil: Date.parse(raw.validUntil) };
}

/** Checks the exact durable bytes for every graph media owner. Only a descriptor
 * obtained through the authorized SQL binding can reach the attachment store. */
export async function verifySopQueryMedia(client: IntakeTransaction,
  store: Partial<Pick<ContentAttachmentStore, 'readAttachment'>>,
  context: { principalId: string; entitlementHash: string }, graph: SopGraph): Promise<void> {
  const descriptors: ReservedAttachment[] = [];
  for (const binding of graph.media) {
    const result = await client.query<{ value: unknown }>(
      'SELECT content_intake.read_sop_query_media($1,$2,$3::jsonb) AS value',
      [context.principalId, context.entitlementHash, canonical(binding)],
    );
    const raw = result.rows[0]?.value;
    if (!record(raw) || typeof raw.objectId !== 'string' || !/^obj_[0-9a-f]{64}$/.test(raw.objectId)) {
      throw new SopQueryIntegrityError('MEDIA_UNVERIFIED');
    }
    const descriptor: ReservedAttachment = { objectId: raw.objectId, sha256: binding.sha256, sizeBytes: binding.bytes, mime: binding.mime };
    descriptors.push(descriptor);
  }
  try { await verifyGraphMedia(store, descriptors); }
  catch (error) {
    if (!(error instanceof IntakeRejection)) throw error;
    throw new SopQueryIntegrityError('MEDIA_UNVERIFIED');
  }
}

/** Receipt recovery uses its pinned fact version, then verifies current scope
 * and current bytes. A newer annotation never changes a historical response. */
export async function verifySopQueryReplay(client: IntakeTransaction, store: Partial<Pick<ContentAttachmentStore, 'readAttachment'>>,
  principalId: string, response: UnifiedSopQueryResponse, envelope: unknown): Promise<void> {
  if (response.status !== 'ready') return;
  if (!record(envelope) || typeof envelope.entitlementHash !== 'string'
    || !/^[0-9a-f]{64}$/.test(envelope.entitlementHash)) return invalid();
  const bundle = parseSopQueryBundle(envelope.bundle);
  const [selected] = bundle.graphs;
  if (bundle.graphs.length !== 1 || selected?.facts?.kind !== 'ready'
    || selected.graphDigest !== response.result.graph_digest
    || canonical(selected.graph.definition) !== canonical(response.result.flow)
    || canonical(selected.graph.entries) !== canonical(response.result.entries)
    || canonical(selected.facts.permissions) !== canonical(response.result.permissions)
    || canonical(selected.selectedMedia) !== canonical(response.result.media.map(media => media.binding))) return invalid();
  await verifySopQueryMedia(client, store, { principalId, entitlementHash: envelope.entitlementHash },
    { ...selected.graph, media: selected.selectedMedia });
}

/** Matching reads only authored terms. Each target counts once even if several
 * terms match, and ambiguity keeps the graph blocked. */
export function sopQueryMatches(graph: SopGraph, query: string): 'match' | 'none' | 'ambiguous' {
  const normalize = (text: string) => text.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ');
  const input = normalize(query), matches = new Set<string>();
  const { header, edges } = graph.definition;
  if (header.entryTerms.some(term => typeof term === 'string' && input.includes(normalize(term)))) matches.add(header.startNodeId);
  for (const edge of edges) {
    if (edge.action.kind === 'choice' && edge.action.matchTerms.some(term => input.includes(normalize(term)))) matches.add(edge.to);
  }
  return matches.size > 1 ? 'ambiguous' : matches.size === 1 ? 'match' : 'none';
}

/** Missing group identity leaves recognition ambiguous. Known groups keep their
 * own readiness, so an unresolved permission in another group stays local. */
export function selectSopQueryCandidate(graphs: SopQueryGraphBundle[], request: UnifiedSopQueryRequest): SopQuerySelection {
  if (graphs.some(item => item.facts === null)) return { kind: 'blocked', reason: 'SOURCE_GATE_NOT_READY' };
  const candidates = graphs.filter(item => item.facts?.sopGroup === request.sop_group);
  const recognized = candidates.map(item => ({ item, match: sopQueryMatches(item.graph, request.query_text) }));
  if (recognized.some(item => item.match === 'ambiguous')) return { kind: 'blocked', reason: 'GRAPH_UNRESOLVED' };
  const matches = recognized.filter(item => item.match === 'match');
  if (matches.length > 1) return { kind: 'blocked', reason: 'GRAPH_UNRESOLVED' };
  const selected = matches[0]?.item;
  if (!selected) return { kind: 'none' };
  const facts = selected.facts;
  if (facts === null) return { kind: 'blocked', reason: 'SOURCE_GATE_NOT_READY' };
  if (facts.kind === 'blocked') return { kind: 'blocked', reason: facts.reason };
  return { kind: 'ready', selected: { ...selected, facts } };
}
