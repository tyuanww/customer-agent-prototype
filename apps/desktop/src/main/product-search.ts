import { randomUUID } from 'node:crypto';
import { parseContractSchema } from '@customer-agent/contracts';
import { ProductHttpError } from './product-http';
import type { ProductSession } from './product-session';
import { queryFailure, type ProductCandidate, type ProductSearchRequest, type ProductCopyRequest,
  type ProductSearchResult, type ProductCopyResult, type ProductCancelResult, type QueryIdentity } from '../shared/product-search';
import type { AnnounceGate } from '../shared/product-announce';
import { SYNTHETIC_HELP_CONTACT, type ProductEscalateRequest, type ProductEscalateResult,
  type ProductTerminalRequest, type ProductTerminalResult } from '../shared/product-help';
import { SYNTHETIC_CATALOG } from '../shared/synthetic-catalog';

export type SearchHelp = { openEntry(): boolean | Promise<boolean> };

type SearchJob = Readonly<{
  platform: 'qianniu' | 'douyin';
  productContextType: 'category' | 'sku' | null;
  productContextRef: string | null;
}>;

type SearchState = QueryIdentity & { controller: AbortController; result?: Extract<ProductSearchResult, { ok: true }>;
  copying: boolean; terminal: boolean; platform?: ProductSearchRequest['platform']; productType?: ProductSearchRequest['productContextType'];
  productRef?: string | null; unscopedProducts?: boolean; origins?: Map<string, string> };

function searchJobs(request: ProductSearchRequest): SearchJob[] {
  const platforms: Array<'qianniu' | 'douyin'> = request.platform === 'all' ? ['qianniu', 'douyin'] : [request.platform];
  const scopes: Array<{ productContextType: SearchJob['productContextType']; productContextRef: string | null }> = request.productUnscoped
    ? [
      { productContextType: null, productContextRef: null },
      ...SYNTHETIC_CATALOG.flatMap((category) => [
        { productContextType: 'category' as const, productContextRef: category.id },
        ...category.products.map((product) => ({ productContextType: 'sku' as const, productContextRef: product.id })),
      ]),
    ]
    : [{ productContextType: request.productContextType, productContextRef: request.productContextRef }];
  return platforms.flatMap((platform) => scopes.map((scope) => ({ platform, ...scope })));
}

function candidateLive(candidate: ProductCandidate): boolean {
  const now = Date.now();
  return Date.parse(candidate.effective_from) <= now && (candidate.effective_to === null || now < Date.parse(candidate.effective_to))
    && !candidate.has_conflict;
}

function matchesJob(candidate: ProductCandidate, job: SearchJob): boolean {
  return candidateLive(candidate)
    && candidate.platform_scope.includes(job.platform)
    && (job.productContextType === null
      ? candidate.product_scope_type === 'storewide'
      : candidate.product_scope_type === job.productContextType && candidate.product_scope_refs.includes(job.productContextRef ?? ''));
}
/** Owns per-window candidate provenance and native copy ordering. Renderer never supplies answer text. */
export class ProductSearch {
  private states = new Map<number, SearchState>();
  private last = new Map<number, SearchState>();
  constructor(
    private readonly session: ProductSession,
    private readonly writeClipboard: (text: string) => void,
    private readonly announce: AnnounceGate,
    private readonly help: SearchHelp = { openEntry: () => false },
  ) {
    const forget = () => {
      for (const state of this.states.values()) state.controller.abort();
      this.states.clear();
      this.last.clear();
    };
    session.subscribe(forget);
    announce.subscribe(forget);
  }
  forget(sender: number) {
    this.states.get(sender)?.controller.abort();
    this.states.delete(sender);
    this.last.delete(sender);
  }
  private completed(sender: number, request: QueryIdentity): SearchState {
    const match = (state: SearchState | undefined) =>
      state && state.generation === request.generation && state.sessionEpoch === request.sessionEpoch && state.result ? state : undefined;
    const state = match(this.states.get(sender)) ?? match(this.last.get(sender));
    if (!state) throw new ProductHttpError('STALE');
    if (this.session.view().sessionEpoch !== state.sessionEpoch) throw new ProductHttpError('STALE');
    if (!this.session.view().signedIn) throw new ProductHttpError('UNAUTHORIZED');
    return state;
  }
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
    const platformOk = state.platform === 'all'
      ? candidate.platform_scope.some((platform) => platform === 'qianniu' || platform === 'douyin')
      : candidate.platform_scope.includes(state.platform as 'qianniu' | 'douyin');
    const productOk = state.unscopedProducts
      ? candidate.product_scope_type === 'storewide' || candidate.product_scope_type === 'category' || candidate.product_scope_type === 'sku'
      : candidate.product_scope_type === 'storewide'
        || (candidate.product_scope_type === state.productType && candidate.product_scope_refs.includes(state.productRef ?? ''));
    return candidateLive(candidate) && platformOk && productOk;
  }
  async search(sender: number, request: ProductSearchRequest): Promise<ProductSearchResult> {
    try {
      const state = this.advance(sender, request);
      state.platform = request.platform;
      state.productType = request.productContextType;
      state.productRef = request.productContextRef;
      state.unscopedProducts = request.productUnscoped;
      const jobs = searchJobs(request);
      const pages = await Promise.all(jobs.map(async (job) => {
        const queryId = randomUUID();
        const { value } = await this.session.request(request.sessionEpoch, '/v1/search', { signal: state.controller.signal, body: {
          query_id: queryId, parent_query_id: null, interaction_reason: 'original', query_text: request.queryText.trim(), collection_mode: 'synthetic',
          detected_platform: job.platform, platform: job.platform, platform_source: 'manual',
          product_context_type: job.productContextType, product_context_ref: job.productContextRef, top_k: 3,
        } });
        const response = parseContractSchema('SearchResponse', value);
        this.current(sender, state);
        if (!this.announce.allows(response.release_id) || response.query_id !== queryId
          || response.candidates.some((candidate) => candidate.release_id !== response.release_id || !matchesJob(candidate, job))) {
          throw new ProductHttpError('VALIDATION');
        }
        return { queryId, response };
      }));
      const origins = new Map<string, string>();
      const merged: ProductCandidate[] = [];
      for (const page of pages) {
        for (const candidate of page.response.candidates) {
          if (origins.has(candidate.script_id)) continue;
          origins.set(candidate.script_id, page.queryId);
          merged.push({ ...candidate, rank: (merged.length + 1) as 1 | 2 | 3 });
          if (merged.length === 3) break;
        }
        if (merged.length === 3) break;
      }
      const primary = pages[0];
      if (!primary) throw new ProductHttpError('VALIDATION');
      const result: Extract<ProductSearchResult, { ok: true }> = {
        ok: true, sessionEpoch: request.sessionEpoch, generation: request.generation,
        queryId: merged[0] ? origins.get(merged[0].script_id) ?? primary.queryId : primary.queryId,
        hitStatus: merged.length > 0 ? 'hit' : 'no_hit',
        releaseId: primary.response.release_id,
        telemetryStatus: primary.response.telemetry_status,
        candidates: merged,
      };
      state.origins = origins;
      state.result = structuredClone(result); this.last.set(sender, state); return result;
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
      const candidate = result?.candidates.find((item) => item.rank === request.rank && item.script_id === request.scriptId
        && item.script_version === request.scriptVersion && item.content_hash === request.contentHash);
      if (!result || !candidate || !this.usable(candidate, state) || !this.announce.allows(candidate.release_id)) throw new ProductHttpError('STALE');
      const impressionQueryId = state.origins?.get(candidate.script_id) ?? result.queryId;
      if (Object.keys(request.placeholderValues).sort().join(',') !== [...candidate.placeholder_keys].sort().join(',')) throw new ProductHttpError('VALIDATION');
      const text = candidate.answer_text.replace(/\{(订单号|日期)\}/g, (_match, key: string) => request.placeholderValues[key === '订单号' ? 'order_id' : 'date'] ?? '');
      if (/[{}]/.test(text)) throw new ProductHttpError('VALIDATION');
      state.copying = true; acquired = true;
      const status = await this.session.status();
      if (!status.ok || !status.signedIn) throw new ProductHttpError('UNAUTHORIZED');
      this.current(sender, state);
      if (!this.usable(candidate, state) || !this.announce.allows(candidate.release_id)) throw new ProductHttpError('STALE');
      try { this.writeClipboard(text); } catch { throw new ProductHttpError('CLIPBOARD_FAILED'); }
      state.terminal = true;
      let eventStatus: 'recorded' | 'unrecorded' | 'disabled' = result.telemetryStatus === 'collection_disabled' ? 'disabled' : 'unrecorded';
      if (eventStatus !== 'disabled') {
        try {
          const response = await this.session.request(request.sessionEpoch, '/v1/events/adoption', {
            headers: { 'idempotency-key': randomUUID() },
            body: {
            query_id: impressionQueryId, outcome: 'adopted', chosen_rank: request.rank, chosen_script_id: request.scriptId, push_method: 'clipboard',
          } });
          const receipt = parseContractSchema('AdoptionEventResponse', response.value);
          if (receipt.query_id === impressionQueryId) eventStatus = 'recorded';
        } catch { /* The clipboard write already succeeded. Never retry the native side effect. */ }
      }
      return { ok: true, sessionEpoch: request.sessionEpoch, generation: request.generation, copied: true, eventStatus };
    } catch (error) { return this.failure(error, request); }
    finally { if (state && acquired) state.copying = false; }
  }
  async escalate(sender: number, request: ProductEscalateRequest): Promise<ProductEscalateResult> {
    try {
      const state = this.completed(sender, request);
      const result = state.result;
      if (!result || result.queryId !== request.queryId || result.hitStatus !== 'no_hit') throw new ProductHttpError('STALE');
      if (state.terminal) throw new ProductHttpError('CONFLICT');
      if (!this.announce.allows(result.releaseId)) throw new ProductHttpError('STALE');
      let opened = false;
      if (request.action === 'copy_contact') {
        try { this.writeClipboard(SYNTHETIC_HELP_CONTACT); opened = true; }
        catch { throw new ProductHttpError('CLIPBOARD_FAILED'); }
      } else {
        opened = await Promise.resolve(this.help.openEntry());
        if (!opened) throw new ProductHttpError('UNAVAILABLE');
      }
      let eventStatus: 'recorded' | 'unrecorded' | 'disabled' = result.telemetryStatus === 'collection_disabled' ? 'disabled' : 'unrecorded';
      let escalateId = `esc_local_${request.queryId}`;
      if (eventStatus !== 'disabled') {
        try {
          const response = await this.session.request(request.sessionEpoch, '/v1/events/escalate', {
            headers: { 'idempotency-key': randomUUID() },
            body: { query_id: request.queryId, action: request.action },
          });
          const receipt = parseContractSchema('EscalationResponse', response.value);
          if (receipt.query_id === request.queryId && receipt.action === request.action) {
            eventStatus = 'recorded'; escalateId = receipt.escalate_id;
          }
        } catch { /* Native entry action already happened. */ }
      }
      return { ok: true, sessionEpoch: request.sessionEpoch, generation: request.generation, escalateId, action: request.action, opened, eventStatus };
    } catch (error) { return this.failure(error, request); }
  }
  async recordTerminal(sender: number, request: ProductTerminalRequest): Promise<ProductTerminalResult> {
    try {
      const state = this.completed(sender, request);
      const result = state.result;
      if (!result || result.queryId !== request.queryId) throw new ProductHttpError('STALE');
      if (request.outcome === 'no_hit_exit' && result.hitStatus !== 'no_hit') throw new ProductHttpError('VALIDATION');
      if (request.outcome === 'dismissed' && result.hitStatus === 'no_hit') throw new ProductHttpError('VALIDATION');
      if (state.terminal) throw new ProductHttpError('CONFLICT');
      state.terminal = true;
      if (result.telemetryStatus === 'collection_disabled') return { ok: true, ...request, recorded: false };
      try {
        const response = await this.session.request(request.sessionEpoch, '/v1/events/adoption', {
          headers: { 'idempotency-key': randomUUID() },
          body: { query_id: request.queryId, outcome: request.outcome, chosen_rank: null, chosen_script_id: null, push_method: null },
        });
        const receipt = parseContractSchema('AdoptionEventResponse', response.value);
        return { ok: true, sessionEpoch: request.sessionEpoch, generation: request.generation, recorded: receipt.query_id === request.queryId };
      } catch { return { ok: true, sessionEpoch: request.sessionEpoch, generation: request.generation, recorded: false }; }
    } catch (error) { return this.failure(error, request); }
  }
}
