import { parseContractSchema } from '@customer-agent/contracts';
import { announceClientId } from './product-client-id';
import { ProductHttpError } from './product-http';
import type { ProductSession } from './product-session';
import {
  announceFailure, type AnnounceGate, type ProductAnnounceContentUpdate,
  type ProductAnnounceInvalidation, type ProductAnnounceResult,
  type ProductAnnouncement, type ProductAnnounceUnread,
} from '../shared/product-announce';
import type { QueryIdentity } from '../shared/product-search';
import {
  libraryDomainCounts, libraryDomainHashes, unreadDomains,
  type LibraryDomain, type LibraryDomainCounts, type LibraryDomainHashes,
} from '../shared/library-delta';
import { NO_LAST_SEEN, type LastSeenStore } from './product-last-seen';
import {
  persistHydrateFromEnv,
  type HydrateSnapshotItem,
  type SyncHydrateResult,
} from './hydrate-catalog.ts';

const LEASE = /^osl_[0-9a-f]{64}$/;
type SnapshotState = { releaseId: string; cursor: string | null };

/** Owns current release, short lease, ACK and snapshot paging. Renderer never sees the lease token. */
export class ProductAnnounce implements AnnounceGate {
  private lease: { token: string; expiresAt: string; releaseId: string; releaseSeq: number; epoch: number; etag?: string } | null = null;
  private announcement: ProductAnnouncement | null = null;
  private snapshot: SnapshotState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private invalidationListeners = new Set<(value: ProductAnnounceInvalidation) => void>();
  private contentUpdateListeners = new Set<(value: ProductAnnounceContentUpdate) => void>();
  /** 最近一次完整 snapshot 的域哈希与条数。卡与未读都必须用当次内存值，不信磁盘 hydrate。 */
  private domainHashes: LibraryDomainHashes | null = null;
  private domainCounts: LibraryDomainCounts | null = null;
  private snapshotItems: readonly HydrateSnapshotItem[] | null = null;
  private refreshTail: Promise<void> = Promise.resolve();
  constructor(
    private readonly session: ProductSession,
    private readonly clientId: string,
    private readonly now: () => number = Date.now,
    private readonly persistHydrate: (
      releaseId: string,
      items: readonly HydrateSnapshotItem[],
    ) => SyncHydrateResult | null = persistHydrateFromEnv,
    private readonly afterSnapshotPersist: (
      releaseId: string,
      items: readonly HydrateSnapshotItem[],
    ) => void = () => {},
    private readonly lastSeen: LastSeenStore = NO_LAST_SEEN,
  ) {
    session.subscribe(state => {
      if (!state.ok || !state.signedIn) this.drop('signed_out');
      else if (this.lease && this.lease.epoch !== state.sessionEpoch) this.drop('replaced');
    });
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onInvalidated(listener: (value: ProductAnnounceInvalidation) => void) {
    this.invalidationListeners.add(listener); return () => { this.invalidationListeners.delete(listener); };
  }
  onContentUpdated(listener: (value: ProductAnnounceContentUpdate) => void) {
    this.contentUpdateListeners.add(listener); return () => { this.contentUpdateListeners.delete(listener); };
  }
  allows(releaseId: string) {
    const view = this.session.view();
    return !!this.lease && view.signedIn && view.sessionEpoch === this.lease.epoch
      && this.lease.releaseId === releaseId && this.now() < Date.parse(this.lease.expiresAt);
  }
  currentReleaseId() {
    return this.lease?.releaseId ?? null;
  }
  /** 当次 snapshot 内存里的域条数（发布回执/四卡用）。未刷新到过则为 null。 */
  currentDomainCounts(): LibraryDomainCounts | null {
    return this.domainCounts;
  }
  /** 话术库跟检索租约同一份内存 snapshot；没有租约时回落磁盘 hydrate。 */
  snapshotCatalog(): { releaseId: string; items: readonly HydrateSnapshotItem[] } | null {
    if (!this.lease || !this.snapshotItems || this.snapshotItems.length < 1) return null;
    return Object.freeze({ releaseId: this.lease.releaseId, items: this.snapshotItems });
  }
  /** Fox-only read projection. Never refreshes announce, never marks read. */
  unread(): ProductAnnounceUnread {
    const view = this.session.view();
    const userId = view.ok && view.signedIn ? view.userId : null;
    // No signed-in user, or no completed snapshot yet (no baseline source) — nothing to light.
    if (!userId || !this.domainHashes) return Object.freeze({ ok: false, signedIn: false, unread: false, domains: [] as const });
    const baseline = this.lastSeen.baseline(userId);
    const domains = unreadDomains(this.domainHashes, baseline);
    return Object.freeze({ ok: true, signedIn: true, unread: domains.length > 0, domains: Object.freeze([...domains]) });
  }
  /**
   * Mark the listed domains read for the **session** userId. Callers pass the domains they
   * actually showed; userId is never accepted from the renderer.
   */
  markRead(domains: readonly LibraryDomain[]): void {
    const view = this.session.view();
    const userId = view.ok && view.signedIn ? view.userId : null;
    if (!userId || !this.domainHashes || domains.length === 0) return;
    this.lastSeen.markRead(userId, domains, this.domainHashes);
  }
  /** Dashboard four-card projection. Card counts come from the in-memory snapshot (else null → 「—」). */
  dashboardProjection(): {
    ok: true;
    signedIn: boolean;
    releaseId: string;
    announcement: ProductAnnouncement | null;
    counts: LibraryDomainCounts | null;
    unread: boolean;
    unreadDomains: readonly LibraryDomain[];
  } | null {
    if (!this.lease) return null;
    const view = this.session.view();
    const userId = view.ok && view.signedIn ? view.userId : null;
    const domains = userId ? this.unread().domains : [];
    return Object.freeze({
      ok: true,
      signedIn: Boolean(userId),
      releaseId: this.lease.releaseId,
      announcement: this.announcement,
      counts: this.domainCounts,
      unread: domains.length > 0,
      unreadDomains: Object.freeze([...domains]),
    });
  }
  private emitContentUpdated() {
    if (!this.domainHashes || !this.lease) return;
    const domains = this.unread().domains;
    const value: ProductAnnounceContentUpdate = Object.freeze({
      sessionEpoch: this.lease.epoch,
      releaseId: this.lease.releaseId,
      summary: this.announcement?.summary ?? null,
      domainHashes: this.domainHashes,
      unreadDomains: Object.freeze([...domains]),
    });
    for (const listener of this.contentUpdateListeners) listener(value);
  }
  private projection(identity: QueryIdentity): ProductAnnounceResult {
    if (!this.lease) return announceFailure('SOURCE_GATE_NOT_READY', identity);
    return { ok: true, ...identity, releaseId: this.lease.releaseId, releaseSeq: this.lease.releaseSeq,
      leaseExpiresAt: this.lease.expiresAt, announcement: this.announcement };
  }
  private drop(reason: ProductAnnounceInvalidation['reason']) {
    const epoch = this.session.view().sessionEpoch;
    const hadLease = this.lease !== null;
    this.lease = null; this.announcement = null; this.snapshot = null;
    this.domainHashes = null; this.domainCounts = null;
    this.snapshotItems = null;
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    for (const listener of this.listeners) listener();
    if (reason === 'signed_out' && !hadLease) return;
    for (const listener of this.invalidationListeners) listener({ sessionEpoch: epoch, reason });
  }
  private arm() {
    if (this.timer) clearTimeout(this.timer);
    if (!this.lease) return;
    const remaining = Date.parse(this.lease.expiresAt) - this.now();
    if (remaining <= 0) { this.drop('expired'); return; }
    this.timer = setTimeout(() => this.drop('expired'), remaining); this.timer.unref?.();
  }
  private boundClientId(): string {
    const userId = this.session.view().userId;
    if (!userId) throw new ProductHttpError('UNAUTHORIZED');
    return announceClientId(this.clientId, userId);
  }

  private headers(conditional = false) {
    return {
      'x-client-id': this.boundClientId(),
      ...(conditional && this.lease ? { 'x-snapshot-lease': this.lease.token, ...(this.lease.etag ? { 'if-none-match': this.lease.etag } : {}) } : {}),
    };
  }
  async refresh(identity: QueryIdentity): Promise<ProductAnnounceResult> {
    const run = this.refreshTail.then(() => this.refreshNow(identity));
    this.refreshTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async refreshNow(identity: QueryIdentity): Promise<ProductAnnounceResult> {
    try {
      const view = this.session.view();
      if (!view.signedIn) throw new ProductHttpError('UNAUTHORIZED');
      if (view.sessionEpoch !== identity.sessionEpoch) throw new ProductHttpError('STALE');
      let current = await this.session.request(identity.sessionEpoch, '/v1/announce/current', { method: 'GET', headers: this.headers(true) });
      if (view.sessionEpoch !== this.session.view().sessionEpoch) throw new ProductHttpError('STALE');
      if (current.status === 304 && !this.lease) {
        current = await this.session.request(identity.sessionEpoch, '/v1/announce/current', { method: 'GET', headers: this.headers(false) });
      }
      if (current.status === 304) {
        // 304 may arrive without x-snapshot-lease through a public HTTPS proxy.
        // The client already holds the token it sent; keep it if the server confirmed.
        if (!this.lease) throw new ProductHttpError('UNAVAILABLE');
        const token = current.leaseToken ?? this.lease.token;
        const expiresAt = current.leaseExpiresAt ?? this.lease.expiresAt;
        if (!LEASE.test(token) || token !== this.lease.token || !Number.isFinite(Date.parse(expiresAt))) {
          throw new ProductHttpError('UNAVAILABLE');
        }
        this.lease = { ...this.lease, expiresAt, ...(current.etag ? { etag: current.etag } : {}) };
        this.arm(); return this.projection(identity);
      }
      const response = parseContractSchema('CurrentAnnouncementResponse', current.value);
      if (!LEASE.test(response.offline_lease.token) || response.offline_lease.release_id !== response.current_release_id) throw new ProductHttpError('VALIDATION');
      const replacedRelease = this.lease !== null && this.lease.releaseId !== response.current_release_id;
      const priorExpiry = Date.parse(response.offline_lease.expires_at);
      this.lease = {
        token: response.offline_lease.token, expiresAt: response.offline_lease.expires_at, epoch: identity.sessionEpoch,
        releaseId: response.current_release_id, releaseSeq: response.release_seq, ...(current.etag ? { etag: current.etag } : {}),
      };
      this.announcement = response.announcement
        ? { title: response.announcement.title, summary: response.announcement.summary, createdAt: response.announcement.created_at }
        : null;
      this.snapshot = { releaseId: response.current_release_id, cursor: null };
      try {
        const ack = await this.session.request(identity.sessionEpoch, '/v1/announce/ack', {
          body: { client_id: this.boundClientId(), release_id: response.current_release_id, release_seq: response.release_seq, offline_lease_token: response.offline_lease.token },
        });
        parseContractSchema('OkResponse', ack.value);
      } catch (error) {
        // ACK writes client_sync_state. A prior synthetic login on this install binds
        // the same desk_ id; Feishu then gets 403. Snapshot and local search only need
        // the lease from /current.
        if (!(error instanceof ProductHttpError) || error.code !== 'FORBIDDEN') throw error;
        console.info('[desktop] announce ack FORBIDDEN; continuing with issued lease');
      }
      if (Date.parse(this.lease.expiresAt) !== priorExpiry) throw new ProductHttpError('VALIDATION');
      const items: HydrateSnapshotItem[] = [];
      await this.page(identity.sessionEpoch, null, 0, items);
      // 条数/哈希一律用当次 snapshot 内存，不信 kept-larger 磁盘 hydrate。
      const hashes = libraryDomainHashes(items);
      this.domainHashes = hashes;
      this.domainCounts = libraryDomainCounts(items);
      this.snapshotItems = Object.freeze(items.slice());
      const userId = this.session.view().userId;
      if (userId) {
        // 第一次四域 snapshot 完整成功后才建基线；不点亮、不写时间。
        if (!this.lastSeen.baseline(userId)) this.lastSeen.establish(userId, hashes);
      }
      const persisted = this.persistHydrate(response.current_release_id, items);
      if (replacedRelease || persisted?.wrote) {
        for (const listener of this.listeners) listener();
        this.emitContentUpdated();
      }
      try {
        if (persisted?.reason === 'wrote' || persisted?.reason === 'aligned') {
          this.afterSnapshotPersist(response.current_release_id, items);
        }
      } catch {
        // Embeddings are best-effort; hydrate/index already persisted.
      }
      if (this.session.view().sessionEpoch !== identity.sessionEpoch || !this.session.view().signedIn) throw new ProductHttpError('STALE');
      this.arm();
      return this.projection(identity);
    } catch (error) {
      const code = error instanceof ProductHttpError ? error.code : 'UNAVAILABLE';
      const name = error instanceof Error ? error.name : 'unknown';
      console.info(`[desktop] announce refresh failed ${code} ${name}`);
      if (code === 'SOURCE_GATE_NOT_READY') this.drop('source_gate');
      else if (code !== 'STALE' && code !== 'UNAUTHORIZED' && code !== 'FORBIDDEN') this.drop('unavailable');
      return announceFailure(code, identity);
    }
  }
  private async page(epoch: number, cursor: string | null, depth: number, items: HydrateSnapshotItem[]) {
    if (depth > 8) throw new ProductHttpError('UNAVAILABLE');
    if (!this.lease || !this.snapshot || this.snapshot.releaseId !== this.lease.releaseId) throw new ProductHttpError('STALE');
    if (cursor !== null && this.snapshot.cursor !== cursor) throw new ProductHttpError('VALIDATION');
    const query = new URLSearchParams({ release_id: this.lease.releaseId, limit: '200', ...(cursor ? { cursor } : {}) });
    const result = await this.session.request(epoch, `/v1/announce/snapshot?${query}`, {
      method: 'GET', headers: { 'x-client-id': this.boundClientId(), 'x-snapshot-lease': this.lease.token },
    });
    const snapshot = parseContractSchema('SnapshotResponse', result.value);
    if (snapshot.release_id !== this.lease.releaseId || snapshot.release_seq !== this.lease.releaseSeq) throw new ProductHttpError('VALIDATION');
    this.snapshot = { releaseId: snapshot.release_id, cursor: snapshot.next_cursor };
    for (const item of snapshot.items) items.push(item);
    if (snapshot.next_cursor) await this.page(epoch, snapshot.next_cursor, depth + 1, items);
  }
}
