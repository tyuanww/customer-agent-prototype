import { randomUUID } from 'node:crypto';
import { parseContractSchema as parse, type components } from '@customer-agent/contracts/sop-unified';
import type { AuthenticatedUser } from './auth-service.js';
import { contentAttachmentBytesMatch, type ContentAttachmentStore, type ReservedAttachment } from './content-object-store.js';
import { authenticatedProductSession } from './product-auth-service.js';
import { intakeView, isContractValidationError } from './content-intake/contract-view.js';
import { canonical, digest } from './content-intake/material.js';
import { issueSopContinuationEntitlement, prepareIntakeSelection, type PreparedIntakeSelection } from './content-intake/usage.js';
import { createIntakeTransactions, IntakeRejection, type IntakePool, type IntakeResult, type IntakeTransaction, type Principal } from './content-intake/transaction.js';
import type { SopContinuationOperations, SopContinuationResource, SopMediaResource } from './sop-continuation-routes.js';
import { assertSopContinuationAction, sopContinuationHash } from './sop-continuation-action.js';
import { parseSopQueryBundle, type SopQueryGraphBundle } from './sop-unified-query-context.js';
import { SopQueryIntegrityError } from './sop-unified-query-validation.js';

type C = components['schemas'];
type MediaSelection = { kind: 'selected'; binding: C['IntakeSopMedia']; descriptor: ReservedAttachment };
type MediaUnavailable = { kind: 'closed' } | { kind: 'expired' };
type MediaVerdict = MediaSelection | MediaUnavailable;
type MediaCompletion = MediaUnavailable | { kind: 'payload'; payload: C['IntakeSopMediaPayload'] };
type ActionInput = { kind: 'check'; request: C['IntakeSopActionCheck'] } | { kind: 'renew'; request: C['IntakeSopContinuationRenew'] };
type ReadyGraph = Omit<SopQueryGraphBundle, 'facts'> & { facts: Extract<NonNullable<SopQueryGraphBundle['facts']>, { kind: 'ready' }> };
type ActionCompletion = MediaUnavailable | { kind: 'checked' } | { kind: 'issued'; receipt: C['IntakeSopContinuationReceipt'] };

/** Transaction-private proof. Only the real C parser and live usage owner can
 * construct it; it is never decoded from a receipt or serialized to SQL. */
class ActionAdmission {
  readonly kind = 'admitted';
  constructor(readonly input: ActionInput, readonly releaseId: string, readonly prepared: PreparedIntakeSelection,
    readonly selected: ReadyGraph, readonly media: MediaSelection[]) {}

  fingerprint(): string {
    return digest(canonical({ releaseId: this.releaseId, authority: this.prepared.binding,
      scopes: this.prepared.scopes.map(scope => scope.scope), selected: this.selected, media: this.media }));
  }
}
type ActionVerdict = ActionAdmission | MediaUnavailable;

function actionVerdict(raw: unknown): ActionVerdict {
  if (raw instanceof ActionAdmission) return raw;
  const value = object(raw);
  if (value.kind === 'closed' || value.kind === 'expired') return { kind: value.kind };
  throw new IntakeRejection('SOP_SNAPSHOT_INVALID');
}

function actionCompletion(raw: unknown): ActionCompletion {
  const value = object(raw);
  if (value.kind === 'closed' || value.kind === 'expired' || value.kind === 'checked') return { kind: value.kind };
  if (value.kind === 'issued') return { kind: 'issued', receipt: parse('IntakeSopContinuationReceipt', value.receipt) };
  throw new IntakeRejection('SOP_SNAPSHOT_INVALID');
}

function actionArguments(input: ActionInput) {
  const request = input.request;
  const opening = input.kind === 'check' && input.request.action === 'open' ? {
    entitlement: digest(input.request.entitlementId), contextGeneration: request.contextGeneration,
    releaseId: input.request.releaseId, key: input.request.key, graphDigest: input.request.graphDigest, nodeId: input.request.nodeId,
  } : null;
  return { hash: sopContinuationHash(request.continuationId), opening,
    entitlement: input.kind === 'check' && input.request.action !== 'open' ? digest(input.request.entitlementId) : null,
    context: request.contextGeneration, rebind: input.kind === 'renew' || opening !== null };
}

function committedDenial(reason: 'SOP_RELEASE_CHANGED' | 'LEASE_EXPIRED' | 'SOP_SNAPSHOT_INVALID'): Exclude<IntakeResult<never>, { ok: true }> {
  return { ok: false, code: 'CONFLICT', reason, commit: 'committed', diagnosticId: `intake_${randomUUID()}` };
}

function actionWindow(client: IntakeTransaction, started: number): void {
  client.beforeCommit(async () => {
    if (performance.now() - started >= 5_000) throw new IntakeRejection('PERMISSION_CHANGED', 'OVERLOADED');
  });
}

function mediaRequest(resource: SopMediaResource) {
  const query = object(resource.query);
  if (Object.keys(query).length !== 6 || Object.keys(query).some(key => !['entitlementId', 'sourceId', 'flowId', 'ownerKind', 'ownerId', 'resourceId'].includes(key))
    || typeof query.ownerKind !== 'string' || !['entry', 'task', 'knowledge'].includes(query.ownerKind) || resource.continuationHeaders.length > 1) {
    throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  }
  return { releaseId: parse('IntakeSopId', resource.releaseId), entitlementId: parse('IntakeSopId', query.entitlementId),
    continuation: resource.continuationHeaders.length ? sopContinuationHash(resource.continuationHeaders[0]) : null,
    binding: { sourceId: parse('IntakeSopId', query.sourceId), flowId: parse('IntakeSopId', query.flowId),
      ownerKind: query.ownerKind, ownerId: parse('IntakeSopId', query.ownerId), resourceId: parse('IntakeSopId', query.resourceId),
      objectId: parse('IntakeSopId', resource.objectId) } };
}

function mediaVerdict(raw: unknown): MediaVerdict {
  const value = object(raw);
  if (value.kind === 'closed' || value.kind === 'expired') return { kind: value.kind };
  if (value.kind !== 'selected') throw new IntakeRejection('SOP_MEDIA_UNAVAILABLE', 'OVERLOADED');
  const binding = parse('IntakeSopMedia', value.binding), descriptor = object(value.descriptor);
  if (typeof descriptor.objectId !== 'string' || !/^obj_[0-9a-f]{64}$/.test(descriptor.objectId)) {
    throw new IntakeRejection('SOP_MEDIA_UNAVAILABLE', 'OVERLOADED');
  }
  return { kind: 'selected', binding, descriptor: { objectId: descriptor.objectId,
    sha256: binding.sha256, mime: binding.mime, sizeBytes: binding.bytes } };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  return value as Record<string, unknown>;
}
function address(resource: SopContinuationResource) {
  if (resource.kind === 'media') {
    const query = object(resource.query);
    return { kind: 'media', releaseId: parse('IntakeSopId', resource.releaseId),
      entitlement: digest(parse('IntakeSopId', query.entitlementId)), sourceId: parse('IntakeSopId', query.sourceId),
      flowId: parse('IntakeSopId', query.flowId) };
  }
  const body = object(resource.body), hash = sopContinuationHash(body.continuationId);
  if (resource.kind === 'check' && body.action === 'open') {
    const key = object(body.key);
    return { kind: 'open', continuation: hash, entitlement: digest(parse('IntakeSopId', body.entitlementId)),
      sourceId: parse('IntakeSopId', key.sourceId), flowId: parse('IntakeSopId', key.flowId) };
  }
  return { kind: resource.kind, continuation: hash };
}

/** No Main handle enters the SQL request or a durable generic receipt. The
 * existing transaction owner supplies identity, session/facts and COMMIT bounds. */
export function createSopContinuationService(pool: IntakePool,
  report: (diagnosticId: string, error: unknown) => void = () => undefined,
  store?: Partial<Pick<ContentAttachmentStore, 'readAttachment'>>): SopContinuationOperations {
  const run = createIntakeTransactions(pool, report, { requireProductSession: true });
  async function authorize(client: IntakeTransaction, who: Principal, actor: AuthenticatedUser, resource: SopContinuationResource) {
    const session = authenticatedProductSession(actor);
    if (!session) throw new IntakeRejection('SCOPE_DENIED', 'UNAUTHORIZED');
    const selected = address(resource);
    await client.query('SELECT content_intake.authorize_sop_continuation_resource($1,$2,$3::jsonb)',
      [who.id, session, JSON.stringify(selected)]);
    if (intakeView() !== 'graph') throw new IntakeRejection('UPGRADE_REQUIRED');
    return { session, selected };
  }
  async function selectMedia(client: IntakeTransaction, who: Principal, actor: AuthenticatedUser,
    resource: SopMediaResource): Promise<MediaVerdict> {
    const { session } = await authorize(client, who, actor, resource);
    const request = mediaRequest(resource), hash = digest(request.entitlementId);
    const contexts = await client.query<{ value: unknown }>('SELECT content_intake.sop_media_usage_context($1,$2,$3,$4) AS value',
      [who.id, session, hash, request.binding.sourceId]);
    const context = parse('IntakeEntitlementRequest', { ...object(contexts.rows[0]?.value), releaseId: null });
    const prepared = await prepareIntakeSelection(client, who, actor, context);
    if (!prepared.scopes.some(scope => scope.source_id === request.binding.sourceId)) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
    const result = await client.query<{ value: unknown }>('SELECT content_intake.read_sop_continuation_media($1,$2,$3,$4,$5::jsonb,$6) AS value',
      [who.id, session, hash, request.releaseId, canonical(request.binding), request.continuation]);
    const raw = object(result.rows[0]?.value);
    if (raw.kind === 'selected') {
      if (typeof raw.validUntil !== 'string' || !Number.isFinite(Date.parse(raw.validUntil))) throw new IntakeRejection('SOP_SNAPSHOT_INVALID');
      client.validUntil(Date.parse(raw.validUntil));
    }
    return mediaVerdict(raw);
  }
  async function selectAction(client: IntakeTransaction, who: Principal, actor: AuthenticatedUser,
    kind: ActionInput['kind'], raw: unknown): Promise<ActionVerdict> {
    const { session } = await authorize(client, who, actor, { kind, body: raw });
    const input: ActionInput = kind === 'renew' ? { kind, request: parse('IntakeSopContinuationRenew', raw) }
      : { kind, request: parse('IntakeSopActionCheck', raw) };
    const args = actionArguments(input);
    const parameters = [who.id, session, args.hash, args.opening === null ? null : canonical(args.opening), args.entitlement, args.context, args.rebind];
    const stateResult = await client.query<{ value: unknown }>(
      'SELECT content_intake.prepare_sop_action($1,$2,$3,$4::jsonb,$5,$6,$7) AS value', parameters);
    const state = object(stateResult.rows[0]?.value);
    if (state.kind === 'closed' || state.kind === 'expired') return { kind: state.kind };
    if (state.kind !== 'active' && state.kind !== 'opening') throw new IntakeRejection('SOP_SNAPSHOT_INVALID');
    const binding = object(state.binding);
    const releaseId = parse('IntakeSopId', binding.release_id);
    const key = parse('IntakeSopFlowKey', { sourceId: binding.source_id, flowId: binding.flow_id, flowVersion: binding.flow_version });
    const graphDigest = parse('IntakeSopHash', binding.graph_digest);
    if (input.kind === 'check' && (releaseId !== input.request.releaseId || graphDigest !== input.request.graphDigest
      || canonical(key) !== canonical(input.request.key))) throw new IntakeRejection('SOP_SNAPSHOT_INVALID');
    const selection = parse('IntakeEntitlementRequest', { ...object(state.selection), contextGeneration: args.context, releaseId: null });
    const prepared = await prepareIntakeSelection(client, who, actor, selection);
    if (!prepared.scopes.some(scope => scope.source_id === key.sourceId)) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
    const rows = await client.query<{ value: unknown }>(
      'SELECT content_intake.read_sop_action_bundle($1,$2,$3,$4::jsonb,$5,$6,$7,$8) AS value', [...parameters, new Date(prepared.until)]);
    const envelope = object(rows.rows[0]?.value);
    if (envelope.kind === 'closed' || envelope.kind === 'expired') return { kind: envelope.kind };
    if (envelope.kind !== 'bundle' || !Array.isArray(envelope.media)) throw new IntakeRejection('SOP_SNAPSHOT_INVALID');
    let bundle: ReturnType<typeof parseSopQueryBundle>;
    try { bundle = parseSopQueryBundle(envelope.bundle); }
    catch (error) {
      if (error instanceof SopQueryIntegrityError || isContractValidationError(error)) throw new IntakeRejection('SOP_GRAPH_INVALID', 'VALIDATION');
      throw error;
    }
    client.validUntil(bundle.validUntil);
    const [selected] = bundle.graphs;
    if (bundle.graphs.length !== 1 || !selected || selected.graphDigest !== graphDigest
      || canonical(selected.graph.definition.header.key) !== canonical(key) || selected.facts?.kind !== 'ready') {
      throw new IntakeRejection('SOP_SNAPSHOT_INVALID');
    }
    if (input.kind === 'check') assertSopContinuationAction({ graph: selected.graph, graphDigest: selected.graphDigest,
      permissions: selected.facts.permissions, request: input.request });
    const media = envelope.media.map(item => {
      const row = object(item);
      const result = mediaVerdict({ kind: 'selected', binding: row.binding, descriptor: row.descriptor });
      if (result.kind !== 'selected') throw new IntakeRejection('SOP_MEDIA_UNAVAILABLE', 'OVERLOADED');
      return result;
    });
    const bindings = new Set(media.map(item => canonical(item.binding)));
    if (bindings.size !== media.length || bindings.size !== selected.selectedMedia.length
      || selected.selectedMedia.some(item => !bindings.has(canonical(item)))) throw new IntakeRejection('SOP_MEDIA_UNAVAILABLE', 'OVERLOADED');
    return new ActionAdmission(input, releaseId, prepared, { ...selected, facts: selected.facts }, media);
  }

  async function performAction(actor: AuthenticatedUser, kind: ActionInput['kind'], raw: unknown): Promise<IntakeResult<Exclude<ActionCompletion, MediaUnavailable>>> {
    const started = performance.now();
    const before = await run(actor, 'sop-action', null, null, async (client, who) => {
      const selection = await selectAction(client, who, actor, kind, raw);
      if (selection.kind === 'admitted') actionWindow(client, started);
      return selection;
    }, actionVerdict);
    if (!before.ok) return before;
    if (before.value.kind !== 'admitted') return committedDenial(before.value.kind === 'expired' ? 'LEASE_EXPIRED' : 'SOP_RELEASE_CHANGED');
    const admitted = before.value, input = admitted.input;
    const needsBytes = input.kind === 'renew' || ['open', 'next', 'choose', 'copy'].includes(input.request.action);
    const required = needsBytes ? admitted.media.filter(item => item.binding.required) : [];
    const unique = new Map(required.map(item => [canonical(item.descriptor), item.descriptor]));
    let verified = true;
    for (const descriptor of unique.values()) {
      try {
        const bytes = await store?.readAttachment?.(descriptor);
        if (!bytes || !contentAttachmentBytesMatch(descriptor, bytes)) verified = false;
      } catch { verified = false; }
    }
    const after = await run(actor, 'sop-action', null, null, async (client, who): Promise<ActionCompletion> => {
      const current = await selectAction(client, who, actor, kind, input.request);
      if (current.kind !== 'admitted') return current;
      actionWindow(client, started);
      if (current.fingerprint() !== admitted.fingerprint()) throw new IntakeRejection('SOP_SNAPSHOT_INVALID');
      if (!verified) throw new IntakeRejection('SOP_MEDIA_UNAVAILABLE', 'OVERLOADED');
      if (input.kind === 'check' && input.request.action !== 'open') return { kind: 'checked' };
      const session = current.prepared.ctx.sessionTokenHash, hash = sopContinuationHash(input.request.continuationId);
      if (input.kind === 'check') {
        const opening = input.request;
        const opened = await client.query<{ value: unknown }>(
          'SELECT content_intake.open_sop_active_use($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,true) AS value',
          [who.id, session, hash, digest(opening.entitlementId), opening.contextGeneration, opening.releaseId,
            canonical(opening.key), opening.graphDigest, opening.nodeId]);
        const openedState = object(opened.rows[0]?.value);
        if (openedState.kind === 'closed') return { kind: 'closed' };
        if (openedState.kind !== 'active') throw new IntakeRejection('SOP_SNAPSHOT_INVALID');
      }
      const issued = await issueSopContinuationEntitlement(client, who, current.prepared, hash);
      if (issued.kind === 'closed') return issued;
      if (issued.entitlement.releaseId !== current.releaseId) throw new IntakeRejection('SOP_SNAPSHOT_INVALID');
      return { kind: 'issued', receipt: parse('IntakeSopContinuationReceipt', {
        continuationId: input.request.continuationId, entitlement: issued.entitlement }) };
    }, actionCompletion);
    if (!after.ok) return after;
    if (after.value.kind === 'closed' || after.value.kind === 'expired') {
      return committedDenial(after.value.kind === 'expired' ? 'LEASE_EXPIRED' : 'SOP_RELEASE_CHANGED');
    }
    return { ok: true, value: after.value };
  }
  return {
    async check(actor, raw) {
      const result = await performAction(actor, 'check', raw);
      if (!result.ok) return result;
      return { ok: true, value: result.value.kind === 'issued' ? { kind: 'opened', receipt: result.value.receipt } : { kind: 'checked' } };
    },
    async renew(actor, raw) {
      const result = await performAction(actor, 'renew', raw);
      if (!result.ok) return result;
      return result.value.kind === 'issued' ? { ok: true, value: result.value.receipt } : committedDenial('SOP_SNAPSHOT_INVALID');
    },
    negotiate(actor, resource) {
      return run(actor, 'sop-negotiate', null, null, async (client, who) => {
        await authorize(client, who, actor, resource); return true as const;
      }, (value): true => {
        if (value !== true) throw new Error('INVALID_CONTINUATION_AUTHORIZATION');
        return true;
      });
    },
    close(actor, raw) {
      return run(actor, 'sop-close', null, null, async (client, who) => {
        const { session } = await authorize(client, who, actor, { kind: 'close', body: raw });
        const request = parse('IntakeSopContinuationClose', raw);
        await client.query('SELECT content_intake.close_sop_active_use($1,$2,$3)',
          [who.id, session, sopContinuationHash(request.continuationId)]);
        return null;
      }, () => null);
    },
    async media(actor, resource) {
      const started = performance.now();
      const before = await run(actor, 'sop-media', null, null, async (client, who) => {
        const selection = await selectMedia(client, who, actor, resource);
        if (selection.kind === 'selected') actionWindow(client, started);
        return selection;
      }, mediaVerdict);
      if (!before.ok) return before;
      if (before.value.kind !== 'selected') return committedDenial(before.value.kind === 'expired' ? 'LEASE_EXPIRED' : 'SOP_RELEASE_CHANGED');
      let bytes: Buffer | null = null;
      try { bytes = await store?.readAttachment?.(before.value.descriptor) ?? null; }
      catch { /* Reauthorization below owns the visible failure, including revoked access. */ }
      const selected = before.value;
      const after = await run(actor, 'sop-media', null, null, async (client, who) => {
        const current = await selectMedia(client, who, actor, resource);
        if (current.kind !== 'selected') return current;
        actionWindow(client, started);
        if (canonical(current) !== canonical(selected)) throw new IntakeRejection('SOP_SNAPSHOT_INVALID');
        if (!bytes || !contentAttachmentBytesMatch(current.descriptor, bytes)) throw new IntakeRejection('SOP_MEDIA_UNAVAILABLE', 'OVERLOADED');
        return { kind: 'payload' as const, payload: parse('IntakeSopMediaPayload', { releaseId: resource.releaseId,
          entitlementId: object(resource.query).entitlementId, objectId: current.binding.objectId,
          sha256: current.binding.sha256, mime: current.binding.mime, bytes: bytes.length, base64: bytes.toString('base64') }) };
      }, (raw): MediaCompletion => {
        const value = object(raw);
        if (value.kind === 'closed' || value.kind === 'expired') return { kind: value.kind };
        return { kind: 'payload' as const, payload: parse('IntakeSopMediaPayload', value.payload) };
      });
      if (!after.ok) return after;
      if (after.value.kind !== 'payload') return committedDenial(after.value.kind === 'expired' ? 'LEASE_EXPIRED' : 'SOP_RELEASE_CHANGED');
      return { ok: true, value: after.value.payload };
    },
  };
}
