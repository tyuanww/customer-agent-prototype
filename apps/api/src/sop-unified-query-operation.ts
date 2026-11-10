import { randomBytes } from 'node:crypto';
import { intakeView, withIntakeView } from './content-intake/contract-view.js';
import { querySelection, assertQuerySelection } from './content-intake/sop-command.js';
import type { ContentAttachmentStore } from './content-object-store.js';
import { canonical, digest } from './content-intake/material.js';
import { createIntakeTransactions, clock, lockProductSession, IntakeRejection, type IntakePool, type IntakeTransaction } from './content-intake/transaction.js';
import { prepareIntakeUsage, issuePreparedIntakeEntitlement, readCurrentIntakeEntitlement } from './content-intake/usage.js';
import { parseSopQueryBundle, selectSopQueryCandidate, verifySopQueryMedia, verifySopQueryReplay } from './sop-unified-query-context.js';
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
        const prior = await sqlValue(client,
          'SELECT content_intake.replay_sop_unified_query($1,$2,$3::jsonb,$4,$5) AS value',
          [who.id, session, canonical(request), admission.kind === 'prepared' ? admission.prepared.binding.slice('intake:'.length) : null, view]);
        if (prior !== null) {
          const response = parseUnifiedSopQueryResponse(prior, request.request_id, await clock(client));
          if (response.status === 'ready' || response.status === 'no_match') {
            if (admission.kind === 'entitlement') {
              const current = await readCurrentIntakeEntitlement(client, who, actor, admission.entitlementId);
              assertQuerySelection(request, current.ctx);
            }
            client.validUntil(Date.parse(response.lease_expires_at));
            const envelope = await sqlValue(client, 'SELECT content_intake.recheck_sop_unified_query($1,$2,$3::uuid,$4) AS value', [who.id, session, request.request_id, view]);
            await verifySopQueryReplay(client, store, who.id, response, envelope);
          }
          return response;
        }
        const prepared = admission.kind === 'prepared' ? { ...admission.prepared, entitlement: null }
          : await readCurrentIntakeEntitlement(client, who, actor, admission.entitlementId);
        if (admission.kind === 'entitlement') assertQuerySelection(request, prepared.ctx);
        const authorityBinding = prepared.binding.slice('intake:'.length);
        const entitlement = prepared.entitlement ?? await issuePreparedIntakeEntitlement(client, who, prepared);
        const context = { principalId: who.id, entitlementHash: digest(entitlement.entitlementId) };
        let response: UnifiedSopQueryResponse;
        let facts: { candidateId: string; candidateVersion: number; sourceId: string; flowId: string; version: number } | null = null;
        try {
          const bundle = parseSopQueryBundle(await sqlValue(client,
            'SELECT content_intake.read_sop_unified_query_bundle($1,$2) AS value', [who.id, context.entitlementHash]));
          const expiresAt = new Date(Math.min(prepared.until, bundle.validUntil, Date.parse(entitlement.validUntil))).toISOString();
          const selection = selectSopQueryCandidate(bundle.graphs, request);
          if (selection.kind === 'blocked') response = closed(request, selection.reason);
          else if (selection.kind === 'none') {
            response = { status: 'no_match', request_id: request.request_id, release_id: prepared.release,
              lease_expires_at: expiresAt, reasons: [], result: { flow: null, entries: [], media: [], permissions: [] } };
          } else {
            const { selected } = selection;
            await verifySopQueryMedia(client, store, context, { ...selected.graph, media: selected.selectedMedia });
            facts = { candidateId: selected.facts.candidateId, candidateVersion: selected.facts.candidateVersion,
              sourceId: selected.graph.definition.header.key.sourceId, flowId: selected.graph.definition.header.key.flowId,
              version: selected.facts.version };
            response = { status: 'ready', request_id: request.request_id, release_id: prepared.release,
              lease_expires_at: expiresAt, reasons: [], result: {
                flow: selected.graph.definition, graph_digest: selected.graphDigest, entries: selected.graph.entries,
                permissions: selected.facts.permissions,
                media: selected.selectedMedia.map(binding => ({ binding, preview_handle: `sqp_${randomBytes(32).toString('hex')}`, expires_at: expiresAt })),
              } };
          }
          response = parseUnifiedSopQueryResponse(response, request.request_id, await clock(client));
        } catch (error) {
          if (!(error instanceof SopQueryIntegrityError)) throw error;
          response = closed(request, error.reason);
          facts = null;
        }
        const completed = await sqlValue(client,
          'SELECT content_intake.complete_sop_unified_query($1,$2,$3::jsonb,$4,$5::jsonb,$6::jsonb,$7) AS value',
          [who.id, context.entitlementHash, canonical(request), authorityBinding, JSON.stringify(response), canonical(facts), view]);
        return parseUnifiedSopQueryResponse(completed, request.request_id, await clock(client));
      }, value => parseUnifiedSopQueryResponse(value, request.request_id)));
      if (result.ok) return result.value;
      if (result.reason === 'IDEMPOTENCY_CONFLICT') return { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
      if (['SCOPE_DENIED', 'PERMISSION_CHANGED', 'ORG_FACTS_UNAVAILABLE'].includes(result.reason)) return { ok: false, code: 'SCOPE_DENIED' };
      if (result.reason === 'LEASE_EXPIRED' || result.reason === 'BASE_CHANGED') return { ok: false, code: 'SOP_STALE' };
      return { ok: false, code: 'SOP_UNAVAILABLE' };
    },
  };
}
