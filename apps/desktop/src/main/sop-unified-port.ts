import { createHash } from 'node:crypto';
import { parseContractSchema } from '@customer-agent/contracts/sop-resource-disable';
import { parseContractSchema as parseLegacySchema } from '@customer-agent/contracts/sop-unified';
import { SOP_RESOURCE_CONTRACT, SOP_UNIFIED_CONTRACT, type SopContractVersion, type SopMedia, type SopSchemas } from '../shared/sop-unified';
import type { ProductSession } from './product-session';

export type SopUnifiedSession = Pick<ProductSession, 'view' | 'request' | 'subscribe' | 'onExplicitLogout'>;
export type SopMediaReadContext =
  | { kind: 'query-preview'; expiresAt: string }
  | { kind: 'live-continuation' };
export type SopSelection = { shopId: string; productIds: string[]; scenarioIds: string[] };

/** Fixed contract operations. Paths, binding tuples and credentials never come from renderer. */
export class SopUnifiedPort {
  constructor(readonly session: SopUnifiedSession,
    private readonly decodeImage: (bytes: Buffer, mime: string, signal: AbortSignal) => boolean | Promise<boolean>,
    readonly contractVersion: SopContractVersion = 'v11') {}
  private async request(path: string, options: Parameters<ProductSession['request']>[2] = {}) {
    return this.session.request(this.session.view().sessionEpoch, path, {
      timeoutMs: 5000, ...options,
      headers: { ...options?.headers, 'x-intake-contract-set': this.contractVersion === 'v12' ? SOP_RESOURCE_CONTRACT : SOP_UNIFIED_CONTRACT },
    });
  }
  async shops(signal: AbortSignal): Promise<string[]> {
    const shops = new Set<string>(), sources = new Set<string>(), cursors = new Set<string>();
    let cursor: string | null = null, bytes = 0;
    do {
      if (cursors.size >= 50) throw new Error('SOP_SOURCE_LIMIT');
      const query = new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) });
      const response = await this.request(`/v1/intake/sources?${query.toString().replaceAll('.', '%2E')}`, { signal, maxResponseBytes: 1_048_576 });
      bytes += Buffer.byteLength(JSON.stringify(response.value));
      if (bytes > 8 * 1024 * 1024) throw new Error('SOP_SOURCE_LIMIT');
      const page = parseContractSchema('IntakeSourceList', response.value);
      for (const source of page.items) {
        if (sources.has(source.scope.sourceId)) throw new Error('SOP_SOURCE_DUPLICATE');
        sources.add(source.scope.sourceId);
        // This menu is only a hint. Issuance and every graph operation enforce live query authority.
        if (source.templateVersion === 'sop-manual-authoring-v1.1' && source.contentIntakeMode !== 'legacy' && source.scope.shopId !== null) shops.add(source.scope.shopId);
      }
      cursor = page.nextCursor;
      if (cursor && (!page.items.length || cursors.has(cursor))) throw new Error('SOP_SOURCE_CURSOR');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return [...shops].sort();
  }
  async query(input: SopSchemas['MenokinSopQuerySopQueryRequest'], signal: AbortSignal) {
    let body: unknown = input;
    if (this.contractVersion === 'v11') {
      const { entitlement_id: _entitlement, ...legacy } = input;
      body = parseLegacySchema('MenokinSopQuerySopQueryRequest', legacy);
    } else {
      body = parseContractSchema('MenokinSopQuerySopQueryRequest', input);
    }
    const response = await this.request('/v1/sop/query', { body, signal, maxResponseBytes: 1_048_576 });
    const value = parseContractSchema('MenokinSopQuerySopQueryResponse', response.value);
    if (value.request_id !== input.request_id) throw new Error('SOP_RESPONSE_BINDING');
    return value;
  }
  async issue(selection: SopSelection, contextGeneration: number, signal: AbortSignal) {
    const response = await this.request('/v1/intake/entitlements', { body: { ...selection, contextGeneration, releaseId: null }, signal });
    return parseContractSchema('IntakeEntitlement', response.value);
  }
  async check(input: SopSchemas['IntakeSopActionCheck'], signal: AbortSignal) {
    parseContractSchema('IntakeSopActionCheck', input);
    let body: unknown = input;
    if (this.contractVersion === 'v11') {
      const { queryRequestId: _query, ...legacy } = input;
      body = parseLegacySchema('IntakeSopActionCheck', legacy);
    }
    const response = await this.request('/v1/intake/sop/check', { body, signal });
    if (input.action === 'open') {
      if (response.status !== 200) throw new Error('SOP_OPEN_RECEIPT_REQUIRED');
      return parseContractSchema('IntakeSopContinuationReceipt', response.value);
    }
    if (response.status !== 204 || response.value !== null) throw new Error('SOP_ACTION_RECEIPT_INVALID');
    return null;
  }
  async renew(continuationId: string, contextGeneration: number, signal: AbortSignal) {
    const response = await this.request('/v1/intake/sop/continuations/renew', { body: { continuationId, contextGeneration }, signal });
    return parseContractSchema('IntakeSopContinuationReceipt', response.value);
  }
  async close(continuationId: string, signal: AbortSignal) {
    const response = await this.request('/v1/intake/sop/continuations/close', { body: { continuationId }, signal });
    if (response.status !== 204 || response.value !== null) throw new Error('SOP_CLOSE_UNKNOWN');
  }
  async media(input: { media: SopMedia; entitlement: SopSchemas['IntakeEntitlement']; continuationId: string; context: SopMediaReadContext }, signal: AbortSignal): Promise<{ image: string; displayUntil: number; monotonicDeadline: number }> {
    const { binding } = input.media;
    const { entitlement, continuationId } = input;
    const started = performance.now(), wall = Date.now();
    const operationSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
    const displayUntil = Math.min(
      Date.parse(entitlement.validUntil),
      input.context.kind === 'query-preview' ? Date.parse(input.context.expiresAt) : Infinity,
    );
    const monotonicDeadline = started + Math.max(0, displayUntil - wall);
    if (Date.now() >= displayUntil || performance.now() >= monotonicDeadline) throw new Error('SOP_MEDIA_EXPIRED');
    const query = new URLSearchParams({ entitlementId: entitlement.entitlementId,
      sourceId: binding.flowKey.sourceId, flowId: binding.flowKey.flowId,
      ownerKind: binding.entry ? 'entry' : binding.graphTarget!.kind,
      ownerId: binding.entry ? binding.entry.businessEntryId : binding.graphTarget!.id,
      resourceId: binding.resourceId });
    const response = await this.request(`/v1/intake/sop/releases/${encodeURIComponent(entitlement.releaseId).replaceAll('.', '%2E')}/media/${encodeURIComponent(binding.objectId).replaceAll('.', '%2E')}?${query.toString().replaceAll('.', '%2E')}`, {
      signal: operationSignal, maxResponseBytes: 7 * 1024 * 1024, headers: { 'x-sop-continuation': continuationId },
    });
    const payload = parseContractSchema('IntakeSopMediaPayload', response.value);
    if (payload.releaseId !== entitlement.releaseId || payload.entitlementId !== entitlement.entitlementId
      || payload.objectId !== binding.objectId || payload.sha256 !== binding.sha256 || payload.mime !== binding.mime || payload.bytes !== binding.bytes) throw new Error('SOP_MEDIA_BINDING');
    const bytes = Buffer.from(payload.base64, 'base64');
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
        : ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii')) ? 'image/gif' : null;
    if (bytes.toString('base64') !== payload.base64 || bytes.length !== binding.bytes || mime !== binding.mime
      || createHash('sha256').update(bytes).digest('hex') !== binding.sha256) throw new Error('SOP_MEDIA_UNAVAILABLE');
    const decoded = await this.decodeImage(bytes, binding.mime, operationSignal);
    operationSignal.throwIfAborted();
    if (!decoded || Date.now() >= displayUntil || performance.now() >= monotonicDeadline) throw new Error('SOP_MEDIA_UNAVAILABLE');
    return { image: `data:${mime};base64,${payload.base64}`, displayUntil, monotonicDeadline };
  }
}
