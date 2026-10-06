import { randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';

type C = components['schemas'];
type Selection = Pick<C['IntakeEntitlementRequest'], 'shopId' | 'productIds' | 'scenarioIds'>;
/** Structural subset of ProductSession. Tokens and actor identity never cross this port. */
export interface IntakeUsageSession {
  view(): { signedIn: boolean; sessionEpoch: number };
  subscribe(listener: () => void): () => void;
  request(epoch: number, path: string, options: { body?: unknown; signal: AbortSignal; maxResponseBytes?: number }): Promise<{value: unknown}>;
}
export class IntakeUsageError extends Error {
  constructor(readonly code: 'VALIDATION' | 'STALE' | 'EXPIRED' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'UNAVAILABLE' | 'LIMIT' | 'CLIPBOARD_FAILED') {
    super(`INTAKE_USAGE_${code}`);
  }
}
type CatalogEvent = 'invalidated' | 'updated' | 'expired';
type Row = C['IntakeSnapshot']['faq'][number] & { key: string };
export interface IntakeCatalog {
  /** Main-only handle: read/copy always recheck this exact qualification. No token in the projection. */
  read(): { releaseId: string; contextGeneration: number; validUntil: string; faq: Row[]; vocabulary: C['IntakeVocabulary'][] } | null;
  copy(key: string): { copied: true };
}
const MAX_PAGES = 500;
const MAX_BYTES = 32 * 1024 * 1024;

/** Owns current shop/selection, cancellation, complete-page assembly and native copy.
 * Currently consumed by the sealed synthetic runner only. The existing product
 * factory, legacy announce/current and renderer IPC are deliberately not activated.
 * A normal new release does not revoke handles already shown in this context;
 * selection/session changes and definitive permission failures revoke them all.
 */
export class ContentIntakeUsage {
  private selection: Selection | null = null;
  private generation = 0;
  private invalidation = 0;
  private epoch: number;
  private request: AbortController | null = null;
  private catalog: IntakeCatalog | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private listeners = new Set<(event: CatalogEvent) => void>();
  private readonly unsubscribe: () => void;
  constructor(private readonly session: IntakeUsageSession, private readonly writeClipboard: (text: string) => void,
    private readonly now: () => number = Date.now, private readonly monotonic: () => number = () => performance.now()) {
    this.epoch = session.view().sessionEpoch;
    this.unsubscribe = session.subscribe(() => {
      const view = session.view();
      if (!view.signedIn || view.sessionEpoch !== this.epoch) {
        this.epoch = view.sessionEpoch; this.selection = null; this.generation++;
        this.invalidate();
      }
    });
  }
  subscribe(listener: (event: CatalogEvent) => void) {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  private emit(event: CatalogEvent) { for (const listener of this.listeners) listener(event); }
  private invalidate() {
    this.invalidation++; this.request?.abort(); this.request = null; this.catalog = null;
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    this.emit('invalidated');
  }
  /** A selection intent only. Identity, generation and release authority are Main/API owned. */
  select(raw: unknown): number {
    if (this.disposed) throw new IntakeUsageError('STALE');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.keys(raw).sort().join(',') !== 'productIds,scenarioIds,shopId') throw new IntakeUsageError('VALIDATION');
    let req: C['IntakeEntitlementRequest'];
    try { req = parseContractSchema('IntakeEntitlementRequest', { ...raw, contextGeneration: this.generation + 1, releaseId: null }); }
    catch { throw new IntakeUsageError('VALIDATION'); }
    this.generation = req.contextGeneration;
    this.selection = { shopId: req.shopId, productIds: [...req.productIds].sort(), scenarioIds: [...req.scenarioIds].sort() };
    this.invalidate(); return this.generation;
  }
  current(): IntakeCatalog | null {
    if (this.catalog && !this.catalog.read()) {
      this.catalog = null; if (this.timer) clearTimeout(this.timer); this.timer = null; this.emit('expired');
    }
    return this.catalog;
  }
  /** No partial snapshot escapes. Failure remains visible; an offline failure may
   * retain a previously completed handle only until its original deadline. */
  async refresh(): Promise<IntakeCatalog> {
    if (this.disposed || !this.selection) throw new IntakeUsageError('STALE');
    const view = this.session.view();
    if (!view.signedIn) { this.invalidate(); throw new IntakeUsageError('UNAUTHORIZED'); }
    const epoch = view.sessionEpoch, generation = this.generation, invalidation = this.invalidation;
    const selection = this.selection;
    this.request?.abort(); const controller = new AbortController(); this.request = controller;
    const active = () => {
      const current = this.session.view();
      if (this.disposed || this.generation !== generation || this.invalidation !== invalidation
        || current.sessionEpoch !== epoch || !current.signedIn) return false;
      return true;
    };
    const assertRequest = () => {
      if (!active() || controller.signal.aborted || this.request !== controller) throw new IntakeUsageError('STALE');
    };
    try {
      const result = await this.session.request(epoch, '/v1/intake/entitlements', {
        body: { ...selection, contextGeneration: generation, releaseId: null }, signal: controller.signal,
      });
      assertRequest();
      const entitlement = parseContractSchema('IntakeEntitlement', result.value);
      if (entitlement.shopId !== selection.shopId || entitlement.contextGeneration !== generation
        || !entitlement.scopes.some(s => s.shopId === selection.shopId)
        || entitlement.scopes.some(s => s.shopId !== null && s.shopId !== selection.shopId)) throw new IntakeUsageError('FORBIDDEN');
      const expires = Date.parse(entitlement.validUntil);
      const monotonicDeadline = this.monotonic() + Math.max(0, expires - this.now());
      let expired = false;
      const live = () => {
        expired ||= this.now() >= expires || this.monotonic() >= monotonicDeadline;
        return !expired && active();
      };
      const vocabulary = new Map<string,C['IntakeVocabulary']>();
      const faq: Row[] = [], keys = new Set<string>(), cursors = new Set<string>();
      const sourceIds = new Set(entitlement.scopes.map(s => s.sourceId));
      let cursor: string | null = null, bytes = 0;
      for (let page = 0; ; page++) {
        if (page >= MAX_PAGES || bytes >= MAX_BYTES) throw new IntakeUsageError('LIMIT');
        if (!live()) throw new IntakeUsageError('EXPIRED');
        const query = new URLSearchParams({ entitlementId: entitlement.entitlementId, limit: '100', ...(cursor === null ? {} : { cursor }) });
        const response = await this.session.request(epoch, `/v1/intake/snapshot?${query}`, {
          signal: controller.signal, maxResponseBytes: MAX_BYTES - bytes,
        });
        assertRequest();
        if (!live()) throw new IntakeUsageError('EXPIRED');
        bytes += Buffer.byteLength(JSON.stringify(response.value) ?? '');
        if (bytes > MAX_BYTES) throw new IntakeUsageError('LIMIT');
        const snapshot = parseContractSchema('IntakeSnapshot', response.value);
        if (snapshot.entitlementId !== entitlement.entitlementId || snapshot.releaseId !== entitlement.releaseId
          || snapshot.contextGeneration !== generation || snapshot.sopNodes.length || snapshot.sopEdges.length || snapshot.media.length) {
          throw new IntakeUsageError('FORBIDDEN');
        }
        const pageVocabulary = new Map(snapshot.vocabulary.map(term => [JSON.stringify([term.id,term.displayVersion]),term]));
        for (const [id,term] of pageVocabulary) {
          if (!term.active || (vocabulary.has(id) && JSON.stringify(vocabulary.get(id)) !== JSON.stringify(term))) throw new IntakeUsageError('FORBIDDEN');
          vocabulary.set(id,term);
        }
        for (const row of snapshot.faq) {
          for (const ref of [...row.entry.productRefs,...row.entry.scenarioRefs]) {
            if (!pageVocabulary.has(JSON.stringify([ref.id,ref.displayVersion]))) throw new IntakeUsageError('FORBIDDEN');
          }
          const identity = JSON.stringify([row.sourceId, row.entry.businessEntryId]);
          if (!sourceIds.has(row.sourceId) || keys.has(identity)) throw new IntakeUsageError('FORBIDDEN');
          keys.add(identity); faq.push({ ...row, key: randomUUID() });
        }
        if (snapshot.nextCursor === null) break;
        if (!snapshot.faq.length || cursors.has(snapshot.nextCursor)) throw new IntakeUsageError('FORBIDDEN');
        cursors.add(snapshot.nextCursor); cursor = snapshot.nextCursor;
      }
      assertRequest();
      if (!live()) throw new IntakeUsageError('EXPIRED');
      const byKey = new Map(faq.map(row => [row.key, row]));
      const catalog: IntakeCatalog = {
        read: () => live() ? structuredClone({ releaseId: entitlement.releaseId, contextGeneration: generation, validUntil: entitlement.validUntil, faq, vocabulary: [...vocabulary.values()] }) : null,
        copy: key => {
          if (!live()) throw new IntakeUsageError('STALE');
          const row = byKey.get(key);
          if (!row) throw new IntakeUsageError('VALIDATION');
          try { this.writeClipboard(row.entry.answerText); } catch { throw new IntakeUsageError('CLIPBOARD_FAILED'); }
          return { copied: true };
        },
      };
      this.catalog = catalog;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        expired = true;
        if (this.catalog === catalog) {
          // Expiry belongs to this qualification, not to another in-flight refresh
          // or an older handle whose independent deadline is still valid.
          this.catalog = null; this.timer = null; this.emit('expired');
        }
      }, Math.max(0, expires - this.now()));
      this.timer.unref?.();
      this.emit('updated'); return catalog;
    } catch (error) {
      // A superseded request must not revoke the newer context when it returns late.
      if (!active() || controller.signal.aborted || this.request !== controller) throw new IntakeUsageError('STALE');
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      const reason = error && typeof error === 'object' && 'reason' in error ? error.reason : null;
      if (error instanceof IntakeUsageError && error.code === 'EXPIRED') throw error;
      // The server can observe this qualification's deadline before Main does.
      // Only that exact refusal is local; permission/session failures still revoke all handles.
      if (code === 'FORBIDDEN' && reason === 'LEASE_EXPIRED') throw new IntakeUsageError('EXPIRED');
      if (code === 'UNAVAILABLE' || code === 'OVERLOADED' || code === 'RATE_LIMITED') throw new IntakeUsageError('UNAVAILABLE');
      this.invalidate();
      if (error instanceof IntakeUsageError) throw error;
      throw new IntakeUsageError(code === 'UNAUTHORIZED' ? 'UNAUTHORIZED' : 'FORBIDDEN');
    } finally { if (this.request === controller) this.request = null; }
  }
  dispose() {
    this.disposed = true; this.unsubscribe(); this.invalidate(); this.listeners.clear();
  }
}
