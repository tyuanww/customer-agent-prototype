import { randomBytes } from 'node:crypto';
import { intakeView, withIntakeView } from './content-intake/contract-view.js';
import { querySelection, assertQuerySelection } from './content-intake/sop-command.js';
import type { SopQueryOperationFailure } from './sop-query-operation.js';
import type { ContentAttachmentStore } from './content-object-store.js';
import { canonical, digest } from './content-intake/material.js';
import { createIntakeTransactions, clock, lockProductSession, IntakeRejection, type IntakePool, type IntakeResult, type IntakeTransaction } from './content-intake/transaction.js';
import { prepareIntakeUsage, issuePreparedIntakeEntitlement, readCurrentIntakeEntitlement } from './content-intake/usage.js';
import { parseSopQueryBundle, selectSopQueryCandidate, verifySopQueryMedia, verifySopQueryReplay, type SopQuerySelection } from './sop-unified-query-context.js';
import { parseUnifiedSopQueryResponse, SopQueryIntegrityError } from './sop-unified-query-validation.js';
import type { SopQueryReasonCode, UnifiedSopQueryOperation, UnifiedSopQueryRequest, UnifiedSopQueryResponse } from './sop-unified-query-model.js';

function closed(request: UnifiedSopQueryRequest, code: SopQueryReasonCode): UnifiedSopQueryResponse {
  return { status: 'blocked', request_id: request.request_id, release_id: null, lease_expires_at: null,
    result: null, reasons: [{ code }] };
}
async function sqlValue(client: IntakeTransaction, sql: string, values: unknown[]): Promise<unknown> {
  try {
    const result = await client.query<{ value: unknown }>(sql, values);
    return result.rows[0]?.value;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ZA003') {
      if (error.message === 'IDEMPOTENCY_CONFLICT') throw new IntakeRejection('IDEMPOTENCY_CONFLICT');
      if (error.message === 'SCOPE_DENIED' || error.message === 'PERMISSION_CHANGED') throw new IntakeRejection('SCOPE_DENIED', 'FORBIDDEN');
      if (error.message === 'LEASE_EXPIRED') throw new IntakeRejection('LEASE_EXPIRED', 'FORBIDDEN');
      if (error.message === 'SOP_RELEASE_CHANGED') throw new IntakeRejection('BASE_CHANGED');
    }
    throw error;
  }
}

type QueryView = 'graph' | 'resource-disable';
type Store = Partial<Pick<ContentAttachmentStore, 'readAttachment'>>;
type ReadyGraph = Extract<SopQuerySelection, { kind: 'ready' }>['selected'];
type ReadyResponse = Extract<UnifiedSopQueryResponse, { status: 'ready' }>;
type QueryFacts = { candidateId: string; candidateVersion: number; sourceId: string; flowId: string; version: number };

type QueryReceiptRequest = UnifiedSopQueryRequest | {
  kind: 'discovered_candidate';
  request_id: string;
  candidate_query_id: string;
  candidate_ref_hash: string;
  shop_id: string;
  sop_group: UnifiedSopQueryRequest['sop_group'];
  context_generation: string;
  entitlement_id: string;
};

export function currentSopQueryBundle(client: IntakeTransaction, context: { principalId: string; entitlementHash: string }) {
  return sqlValue(client, 'SELECT content_intake.read_sop_unified_query_bundle($1,$2) AS value',
    [context.principalId, context.entitlementHash]).then(parseSopQueryBundle);
}

export async function readSopQueryReceipt(client: IntakeTransaction, request: QueryReceiptRequest, context: {
  principalId: string; sessionHash: string; authorityBinding: string | null; view: QueryView;
}): Promise<UnifiedSopQueryResponse | null> {
  const prior = await sqlValue(client, 'SELECT content_intake.replay_sop_unified_query($1,$2,$3::jsonb,$4,$5) AS value',
    [context.principalId, context.sessionHash, canonical(request), context.authorityBinding, context.view]);
  return prior === null ? null : parseUnifiedSopQueryResponse(prior, request.request_id, await clock(client));
}

export async function verifySopQueryReceipt(client: IntakeTransaction, store: Store, response: UnifiedSopQueryResponse,
  context: { principalId: string; sessionHash: string; view: QueryView },
): Promise<void> {
  if (response.status !== 'ready' && response.status !== 'no_match') return;
  client.validUntil(Date.parse(response.lease_expires_at));
  const envelope = await sqlValue(client, 'SELECT content_intake.recheck_sop_unified_query($1,$2,$3::uuid,$4) AS value',
    [context.principalId, context.sessionHash, response.request_id, context.view]);
  await verifySopQueryReplay(client, store, context.principalId, response, envelope);
}

export async function prepareSopQueryReady(client: IntakeTransaction, store: Store, selected: ReadyGraph, context: {
  principalId: string; entitlementHash: string; requestId: string; release: string; deadline: number;
}): Promise<{ response: ReadyResponse; facts: QueryFacts }> {
  await verifySopQueryMedia(client, store, context, { ...selected.graph, media: selected.selectedMedia });
  const expiresAt = new Date(context.deadline).toISOString();
  return {
    facts: { candidateId: selected.facts.candidateId, candidateVersion: selected.facts.candidateVersion,
      sourceId: selected.graph.definition.header.key.sourceId, flowId: selected.graph.definition.header.key.flowId,
      version: selected.facts.version },
    response: { status: 'ready', request_id: context.requestId, release_id: context.release, lease_expires_at: expiresAt,
      reasons: [], result: {
        flow: selected.graph.definition, graph_digest: selected.graphDigest, entries: selected.graph.entries,
        permissions: selected.facts.permissions,
        media: selected.selectedMedia.map(binding => ({ binding, preview_handle: `sqp_${randomBytes(32).toString('hex')}`, expires_at: expiresAt })),
      } },
  };
}

export async function commitSopQueryReceipt(client: IntakeTransaction, request: QueryReceiptRequest,
  response: UnifiedSopQueryResponse, facts: QueryFacts | null, context: {
    principalId: string; entitlementHash: string; authorityBinding: string; view: QueryView;
  },
): Promise<UnifiedSopQueryResponse> {
  const completed = await sqlValue(client,
    'SELECT content_intake.complete_sop_unified_query($1,$2,$3::jsonb,$4,$5::jsonb,$6::jsonb,$7) AS value',
    [context.principalId, context.entitlementHash, canonical(request), context.authorityBinding, JSON.stringify(response), canonical(facts), context.view]);
  return parseUnifiedSopQueryResponse(completed, request.request_id, await clock(client));
}

export function sopQueryOperationFailure(result: Extract<IntakeResult<unknown>, { ok: false }>): SopQueryOperationFailure {
  if (result.code === 'UNAUTHORIZED') return { ok: false, code: 'UNAUTHORIZED' };
  if (result.code === 'OVERLOADED') return { ok: false, code: 'SOP_UNAVAILABLE' };
  if (result.reason === 'IDEMPOTENCY_CONFLICT') return { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
  if (['SCOPE_DENIED', 'PERMISSION_CHANGED', 'ORG_FACTS_UNAVAILABLE'].includes(result.reason)) return { ok: false, code: 'SCOPE_DENIED' };
  if (result.reason === 'LEASE_EXPIRED' || result.reason === 'BASE_CHANGED') return { ok: false, code: 'SOP_STALE' };
  return { ok: false, code: 'SOP_UNAVAILABLE' };
}

/** Normal C query entry. It resolves authority before receipt recovery, and keeps
 * authorization, original graph, independent SOP lease and receipt in one commit. */
export function createUnifiedSopQueryOperation(pool: IntakePool,
  store: Partial<Pick<ContentAttachmentStore, 'readAttachment'>>,
  report: (diagnosticId: string, error: unknown) => void = () => undefined): UnifiedSopQueryOperation {
  const run = createIntakeTransactions(pool, report, { requireProductSession: true });
  return {
    async execute({ actor, request }) {
      const view = intakeView() === 'resource-disable' ? 'resource-disable' : 'graph';
      const result = await withIntakeView(view, () => run(actor, 'sop-query-v11', null, null, async (client, who) => {
        const selection = querySelection(request);
        const admission = selection.kind === 'legacy-request'
          ? { kind: 'prepared' as const, prepared: await prepareIntakeUsage(client, who, actor, selection.request) }
          : { kind: 'entitlement' as const, entitlementId: selection.entitlementId, session: await lockProductSession(client, actor) };
        const session = admission.kind === 'prepared' ? admission.prepared.ctx.sessionTokenHash : admission.session.hash;
        const replayContext: Parameters<typeof readSopQueryReceipt>[2] = { principalId: who.id, sessionHash: session, view,
          authorityBinding: admission.kind === 'prepared' ? admission.prepared.binding.slice('intake:'.length) : null };
        const prior = await readSopQueryReceipt(client, request, replayContext);
        if (prior !== null) {
          if (prior.status === 'ready' || prior.status === 'no_match') {
            if (admission.kind === 'entitlement') {
              const current = await readCurrentIntakeEntitlement(client, who, actor, admission.entitlementId);
              assertQuerySelection(request, current.ctx);
            }
            await verifySopQueryReceipt(client, store, prior, replayContext);
          }
          return prior;
        }
        const prepared = admission.kind === 'prepared' ? { ...admission.prepared, entitlement: null }
          : await readCurrentIntakeEntitlement(client, who, actor, admission.entitlementId);
        if (admission.kind === 'entitlement') assertQuerySelection(request, prepared.ctx);
        const authorityBinding = prepared.binding.slice('intake:'.length);
        const entitlement = prepared.entitlement ?? await issuePreparedIntakeEntitlement(client, who, prepared);
        const context = { principalId: who.id, entitlementHash: digest(entitlement.entitlementId) };
        let response: UnifiedSopQueryResponse;
        let facts: QueryFacts | null = null;
        try {
          const bundle = await currentSopQueryBundle(client, context);
          const deadline = Math.min(prepared.until, bundle.validUntil, Date.parse(entitlement.validUntil));
          const selection = selectSopQueryCandidate(bundle.graphs, request);
          if (selection.kind === 'blocked') response = closed(request, selection.reason);
          else if (selection.kind === 'none') {
            response = { status: 'no_match', request_id: request.request_id, release_id: prepared.release,
              lease_expires_at: new Date(deadline).toISOString(), reasons: [], result: { flow: null, entries: [], media: [], permissions: [] } };
          } else ({ response, facts } = await prepareSopQueryReady(client, store, selection.selected,
            { ...context, requestId: request.request_id, release: prepared.release, deadline }));
          response = parseUnifiedSopQueryResponse(response, request.request_id, await clock(client));
        } catch (error) {
          if (!(error instanceof SopQueryIntegrityError)) throw error;
          response = closed(request, error.reason);
          facts = null;
        }
        return commitSopQueryReceipt(client, request, response, facts, { ...context, authorityBinding, view });
      }, value => parseUnifiedSopQueryResponse(value, request.request_id)));
      return result.ok ? result.value : sopQueryOperationFailure(result);
    },
  };
}
