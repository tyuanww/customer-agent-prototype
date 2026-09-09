import { randomUUID } from 'node:crypto';
import { parseContractSchema } from '@customer-agent/contracts';
import { ProductHttpError } from './product-http';
import type { ProductSession } from './product-session';
import { queryFailure, type ProductCandidate, type ProductSearchRequest, type ProductCopyRequest,
  type ProductSearchResult, type ProductCopyResult, type ProductCancelResult, type QueryIdentity } from '../shared/product-search';

type SearchState = QueryIdentity & { controller: AbortController; result?: Extract<ProductSearchResult, { ok: true }>;
  copying: boolean; terminal: boolean; platform?: ProductSearchRequest['platform']; productType?: ProductSearchRequest['productContextType']; productRef?: string | null };
/** Owns per-window candidate provenance and native copy ordering. Renderer never supplies answer text. */
export class ProductSearch {
  private states = new Map<number, SearchState>();
  constructor(private readonly session: ProductSession, private readonly writeClipboard: (text: string) => void) {
    session.subscribe(() => {
      for (const state of this.states.values()) state.controller.abort();
      this.states.clear();
    });
  }
  forget(sender: number) { this.states.get(sender)?.controller.abort(); this.states.delete(sender); }
  private advance(sender: number, identity: QueryIdentity): SearchState {
    const view = this.session.view();
    if (!view.signedIn) throw new ProductHttpError('UNAUTHORIZED');
    if (view.sessionEpoch !== identity.sessionEpoch) throw new ProductHttpError('STALE');
    const prior = this.states.get(sender);
    if (prior && identity.generation <= prior.generation) throw new ProductHttpError('STALE');
    prior?.controller.abort();
    const state = { sessionEpoch: identity.sessionEpoch, generation: identity.generation, controller: new AbortController(), copying: false, terminal: false };
    this.states.set(sender, state); return state;
  }
  private current(sender: number, state: SearchState) {
    if (this.states.get(sender) !== state || state.controller.signal.aborted || this.session.view().sessionEpoch !== state.sessionEpoch) throw new ProductHttpError('STALE');
    if (!this.session.view().signedIn) throw new ProductHttpError('UNAUTHORIZED');
  }
  private failure(error: unknown, identity: QueryIdentity) {
    return queryFailure(error instanceof ProductHttpError ? error.code : 'UNAVAILABLE', identity);
  }
  cancel(sender: number, identity: QueryIdentity): ProductCancelResult {
    try { this.advance(sender, identity); return { ok: true, ...identity, cancelled: true }; }
    catch (error) { return this.failure(error, identity); }
  }
  private usable(candidate: ProductCandidate, state: SearchState) {
    const now = Date.now();
    return Date.parse(candidate.effective_from) <= now && (candidate.effective_to === null || now < Date.parse(candidate.effective_to))
      && !candidate.has_conflict && candidate.platform_scope.includes(state.platform!)
      && (candidate.product_scope_type === 'storewide' || (candidate.product_scope_type === state.productType && candidate.product_scope_refs.includes(state.productRef ?? '')));
  }
  async search(sender: number, request: ProductSearchRequest): Promise<ProductSearchResult> {
    try {
      const state = this.advance(sender, request); state.platform = request.platform; state.productType = request.productContextType; state.productRef = request.productContextRef;
      const queryId = randomUUID();
      const { value } = await this.session.request(request.sessionEpoch, '/v1/search', { signal: state.controller.signal, body: {
        query_id: queryId, parent_query_id: null, interaction_reason: 'original', query_text: request.queryText.trim(), collection_mode: 'synthetic',
        detected_platform: request.platform, platform: request.platform, platform_source: 'manual', product_context_type: request.productContextType,
        product_context_ref: request.productContextRef, top_k: 3,
      } });
      const response = parseContractSchema('SearchResponse', value);
      this.current(sender, state);
      if (response.query_id !== queryId || response.candidates.some(c => c.release_id !== response.release_id || !this.usable(c, state))) throw new ProductHttpError('VALIDATION');
      const result: Extract<ProductSearchResult, { ok: true }> = { ok: true, sessionEpoch: request.sessionEpoch, generation: request.generation,
        queryId, hitStatus: response.hit_status, releaseId: response.release_id, telemetryStatus: response.telemetry_status, candidates: response.candidates };
      state.result = structuredClone(result); return result;
    } catch (error) { return this.failure(error, request); }
  }
  async copy(sender: number, request: ProductCopyRequest): Promise<ProductCopyResult> {
    let state: SearchState | undefined; let acquired = false;
    try {
      state = this.states.get(sender);
      if (!state || state.generation !== request.generation || state.sessionEpoch !== request.sessionEpoch) throw new ProductHttpError('STALE');
      this.current(sender, state);
      if (state.copying || state.terminal) throw new ProductHttpError('CONFLICT');
      const result = state.result;
      const candidate = result?.queryId === request.queryId ? result.candidates.find(c => c.rank === request.rank && c.script_id === request.scriptId
        && c.script_version === request.scriptVersion && c.content_hash === request.contentHash) : undefined;
      if (!candidate || !this.usable(candidate, state)) throw new ProductHttpError('STALE');
      if (Object.keys(request.placeholderValues).sort().join(',') !== [...candidate.placeholder_keys].sort().join(',')) throw new ProductHttpError('VALIDATION');
      const text = candidate.answer_text.replace(/\{(订单号|日期)\}/g, (_match, key: string) => request.placeholderValues[key === '订单号' ? 'order_id' : 'date'] ?? '');
      if (/[{}]/.test(text)) throw new ProductHttpError('VALIDATION');
      state.copying = true; acquired = true;
      const status = await this.session.status();
      if (!status.ok || !status.signedIn) throw new ProductHttpError('UNAUTHORIZED');
      this.current(sender, state);
      if (!this.usable(candidate, state)) throw new ProductHttpError('STALE');
      try { this.writeClipboard(text); } catch { throw new ProductHttpError('CLIPBOARD_FAILED'); }
      state.terminal = true;
      let eventStatus: 'recorded' | 'unrecorded' | 'disabled' = result!.telemetryStatus === 'collection_disabled' ? 'disabled' : 'unrecorded';
      if (eventStatus !== 'disabled') {
        try {
          const response = await this.session.request(request.sessionEpoch, '/v1/events/adoption', { body: {
            query_id: request.queryId, outcome: 'adopted', chosen_rank: request.rank, chosen_script_id: request.scriptId, push_method: 'clipboard',
          } });
          const receipt = parseContractSchema('AdoptionEventResponse', response.value);
          if (receipt.query_id === request.queryId) eventStatus = 'recorded';
        } catch { /* The clipboard write already succeeded. Never retry the native side effect. */ }
      }
      return { ok: true, sessionEpoch: request.sessionEpoch, generation: request.generation, copied: true, eventStatus };
    } catch (error) { return this.failure(error, request); }
    finally { if (state && acquired) state.copying = false; }
  }
}
