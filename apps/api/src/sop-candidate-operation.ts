import { randomBytes } from 'node:crypto';
import {
  parseContractSchema as parseCandidateSchema,
  type SopCandidateDiscoverRequest,
  type SopCandidateDiscoverResponse,
  type SopCandidateSelectRequest,
} from '@customer-agent/contracts/sop-candidates';
import type { AuthenticatedUser } from './auth-service.js';
import { isContractValidationError, withIntakeView } from './content-intake/contract-view.js';
import { canonical, digest } from './content-intake/material.js';
import { clock, createIntakeTransactions, IntakeRejection, type IntakePool, type IntakeTransaction, type Principal } from './content-intake/transaction.js';
import { readCurrentIntakeEntitlement } from './content-intake/usage.js';
import type { ContentAttachmentStore } from './content-object-store.js';
import { sopQueryMatches, type SopQueryGraphBundle, type SopQuerySelection } from './sop-unified-query-context.js';
import { SOP_GROUP_ORDER, type UnifiedSopQueryResponse } from './sop-unified-query-model.js';
import {
  commitSopQueryReceipt, currentSopQueryBundle, prepareSopQueryReady, readSopQueryReceipt, sopQueryOperationFailure,
  verifySopQueryReceipt,
} from './sop-unified-query-operation.js';
import { parseUnifiedSopQueryResponse, SopQueryIntegrityError } from './sop-unified-query-validation.js';

const VIEW = 'resource-disable' as const;
type ReadyResponse = Extract<UnifiedSopQueryResponse, { status: 'ready' }>;
type ReadyGraph = Extract<SopQuerySelection, { kind: 'ready' }>['selected'];
type SopGroup = ReadyGraph['facts']['sopGroup'];
type DiscoveryDecision = { kind: 'candidates'; graphs: ReadyGraph[] } | { kind: 'ambiguous' | 'no_match' | 'unavailable' };
type CandidateBinding = {
  sop_group: string; source_id: string; flow_id: string; graph_digest: string;
  candidate_id: string; candidate_version: string; facts_version: string;
  context_generation: string; expires_at: Date;
};

function decideDiscovery(graphs: SopQueryGraphBundle[], question: string): DiscoveryDecision {
  const recognized = new Set<SopGroup>();
  const ready = new Map<SopGroup, ReadyGraph>();
  let unknownGroup = false;
  for (const graph of graphs) {
    const { facts } = graph;
    if (facts === null) {
      unknownGroup = true;
      continue;
    }
    const match = sopQueryMatches(graph.graph, question);
    if (match === 'none') continue;
    if (match === 'ambiguous' || recognized.has(facts.sopGroup)) return { kind: 'ambiguous' };
    recognized.add(facts.sopGroup);
    if (facts.kind === 'ready') ready.set(facts.sopGroup, { ...graph, facts });
  }
  if (unknownGroup) return { kind: 'unavailable' };
  if (ready.size > 0) return { kind: 'candidates', graphs: SOP_GROUP_ORDER.flatMap(group => ready.get(group) ?? []) };
  return { kind: recognized.size > 0 ? 'unavailable' : 'no_match' };
}

function candidateRows(graphs: ReadyGraph[]) {
  const titles = graphs.map(item => item.graph.definition.header.title);
  const withGroup = (title: string, group: SopGroup): string => {
    const suffix = `（${group}）`;
    return [...title].slice(0, 512 - [...suffix].length).join('') + suffix;
  };
  const disambiguated = titles.map((title, index) => titles.filter(other => title === other).length === 1
    ? title : withGroup(title, graphs[index]!.facts.sopGroup));
  const sameProjectedLabel = new Set(disambiguated).size !== disambiguated.length;
  return graphs.map((item, index) => ({
    candidate_ref: `sdc_${randomBytes(32).toString('hex')}`,
    label: sameProjectedLabel ? withGroup(titles[index]!, item.facts.sopGroup) : disambiguated[index]!,
    sop_group: item.facts.sopGroup,
    source_id: item.graph.definition.header.key.sourceId,
    flow_id: item.graph.definition.header.key.flowId,
    graph_digest: item.graphDigest,
    candidate_id: item.facts.candidateId,
    candidate_version: item.facts.candidateVersion,
    facts_version: item.facts.version,
  }));
}

async function currentAuthority(client: IntakeTransaction, who: Principal, actor: AuthenticatedUser, entitlementId: string) {
  const prepared = await readCurrentIntakeEntitlement(client, who, actor, entitlementId);
  const sessionHash = prepared.ctx.sessionTokenHash;
  const entitlementHash = digest(entitlementId);
  const authorityBinding = prepared.binding.slice('intake:'.length);
  const context = { principalId: who.id, entitlementHash, sessionHash, authorityBinding, view: VIEW } satisfies
    Parameters<typeof commitSopQueryReceipt>[4] & Parameters<typeof readSopQueryReceipt>[2];
  const authority = {
    session_hash: sessionHash, principal_id: who.id, entitlement_hash: entitlementHash, release_id: prepared.release,
    authority_binding: authorityBinding, valid_until: new Date(prepared.until), session_expires_at: new Date(prepared.sessionValidUntil),
  };
  return { prepared, authority, context };
}

async function storageQuery<Row extends Record<string, unknown>>(client: IntakeTransaction, sql: string, params: unknown[]): Promise<Row[]> {
  try {
    return (await client.query<Row>(sql, params)).rows;
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'W5001') throw new IntakeRejection('IDEMPOTENCY_CONFLICT');
      if (error.code === 'W5002') throw new IntakeRejection('BASE_CHANGED');
    }
    throw error;
  }
}

function discoveryResponse(value: unknown, requestId: string): SopCandidateDiscoverResponse {
  const response = parseCandidateSchema('W5SopCandidateDiscoverResponse', value);
  if (response.request_id.toLowerCase() !== requestId.toLowerCase()) throw new Error('SOP_DISCOVERY_RESPONSE_MISMATCH');
  // PostgreSQL normalizes UUID text. Echo the representation in the verified request.
  return { ...response, request_id: requestId };
}

function requireReady(response: UnifiedSopQueryResponse): ReadyResponse {
  if (response.status !== 'ready') throw new IntakeRejection('BASE_CHANGED');
  return response;
}

function matchesBinding(graph: SopQueryGraphBundle, binding: CandidateBinding): graph is ReadyGraph {
  const { facts } = graph;
  const { sourceId, flowId } = graph.graph.definition.header.key;
  return facts?.kind === 'ready' && sourceId === binding.source_id && flowId === binding.flow_id
    && graph.graphDigest === binding.graph_digest && facts.sopGroup === binding.sop_group
    && facts.candidateId === binding.candidate_id && String(facts.candidateVersion) === binding.candidate_version
    && String(facts.version) === binding.facts_version;
}

export function createSopCandidateOperation(pool: IntakePool, store: Partial<Pick<ContentAttachmentStore, 'readAttachment'>>,
  report: (diagnosticId: string, error: unknown) => void) {
  const run = createIntakeTransactions(pool, report, { requireProductSession: true });
  return {
    async discover(actor: AuthenticatedUser, request: SopCandidateDiscoverRequest) {
      const requestId = request.request_id;
      const result = await withIntakeView(VIEW, () => run(actor, 'sop-candidate-discovery', null, null, async (client, who) => {
        const { authority, prepared, context } = await currentAuthority(client, who, actor, request.entitlement_id);
        const fingerprint = digest(canonical(request));
        const readOrRecord = async (decision: 'candidates' | 'ambiguous' | 'no_match' | null, deadline: Date | null, graphs: ReadyGraph[] = []) => {
          const [row] = await storageQuery<{ value: unknown }>(client,
            'SELECT w5_sop_candidates.record_discovery($1::jsonb,$2::uuid,$3,$4,$5,$6,$7::jsonb) AS value',
            [JSON.stringify(authority), requestId, fingerprint, request.context_generation, decision, deadline,
              JSON.stringify(candidateRows(graphs))]);
          if (!row) throw new Error('SOP_DISCOVERY_RESPONSE_MISSING');
          return row.value;
        };
        const prior = await readOrRecord(null, null);
        if (prior !== null) {
          const response = discoveryResponse(prior, requestId);
          if (response.status === 'candidates') client.validUntil(Date.parse(response.expires_at));
          return response;
        }
        const bundle = await currentSopQueryBundle(client, context).catch(error => {
          if (!(error instanceof SopQueryIntegrityError) && !isContractValidationError(error)) throw error;
          return null;
        });
        if (!bundle) return { status: 'unavailable', request_id: requestId };
        const decision = decideDiscovery(bundle.graphs, request.query_text);
        if (decision.kind === 'unavailable') return { status: 'unavailable', request_id: requestId };
        const deadline = Math.min(prepared.until, bundle.validUntil);
        client.validUntil(deadline);
        return discoveryResponse(await readOrRecord(decision.kind, new Date(deadline), decision.kind === 'candidates' ? decision.graphs : []), requestId);
      }, value => discoveryResponse(value, requestId)));
      if (result.ok) return result.value;
      const failure = sopQueryOperationFailure(result);
      if (failure.code === 'SOP_STALE') return { status: 'stale', request_id: requestId } satisfies SopCandidateDiscoverResponse;
      return failure;
    },
    async select(actor: AuthenticatedUser, request: SopCandidateSelectRequest) {
      const requestId = request.request_id;
      const result = await withIntakeView(VIEW, () => run<ReadyResponse>(actor, 'sop-candidate-selection', null, null, async (client, who) => {
        const { prepared, authority, context } = await currentAuthority(client, who, actor, request.entitlement_id);
        const [binding] = await storageQuery<CandidateBinding>(client,
          'SELECT * FROM w5_sop_candidates.resolve_candidate($1::jsonb,$2::uuid,$3)',
          [JSON.stringify(authority), request.candidate_query_id, request.candidate_ref]);
        const sopGroup = SOP_GROUP_ORDER.find(group => group === binding?.sop_group);
        if (!binding || sopGroup === undefined) throw new IntakeRejection('SCOPE_DENIED', 'FORBIDDEN');
        const discoveryDeadline = binding.expires_at.getTime();
        client.validUntil(discoveryDeadline);
        const pinned = {
          kind: 'discovered_candidate' as const, request_id: requestId, candidate_query_id: request.candidate_query_id,
          candidate_ref_hash: digest(request.candidate_ref), shop_id: prepared.ctx.shopId, sop_group: sopGroup,
          context_generation: binding.context_generation, entitlement_id: request.entitlement_id,
        };
        try {
          const prior = await readSopQueryReceipt(client, pinned, context);
          if (prior !== null) {
            const response = requireReady(prior);
            await verifySopQueryReceipt(client, store, response, context);
            return response;
          }
          const bundle = await currentSopQueryBundle(client, context);
          const selected = bundle.graphs.find(graph => matchesBinding(graph, binding));
          if (!selected) throw new IntakeRejection('BASE_CHANGED');
          const deadline = Math.min(prepared.until, bundle.validUntil, discoveryDeadline);
          client.validUntil(deadline);
          const { response, facts } = await prepareSopQueryReady(client, store, selected, { ...context, requestId, release: prepared.release, deadline });
          const checked = parseUnifiedSopQueryResponse(response, requestId, await clock(client));
          return requireReady(await commitSopQueryReceipt(client, pinned, checked, facts, context));
        } catch (error) {
          if (!(error instanceof SopQueryIntegrityError)) throw error;
          if (error.reason === 'LEASE_EXPIRED' || error.reason === 'STALE_RELEASE') throw new IntakeRejection('BASE_CHANGED');
          throw new IntakeRejection(error.reason === 'MEDIA_UNVERIFIED' ? 'SOP_MEDIA_UNAVAILABLE' : 'SOP_GRAPH_INVALID');
        }
      }, value => requireReady(parseUnifiedSopQueryResponse(value, requestId))));
      if (!result.ok && ['SOP_GRAPH_INVALID', 'SOP_DEPENDENCY_INVALID', 'SOP_MAPPING_REQUIRED', 'SOP_MEDIA_UNAVAILABLE'].includes(result.reason)) {
        return { ok: false, code: 'SOP_BLOCKED' } as const;
      }
      return result.ok ? result.value : sopQueryOperationFailure(result);
    },
  };
}
