import { parseContractSchema } from '@customer-agent/contracts';
import { ProductHttpError } from './product-http';
import type { ProductSession } from './product-session';
import {
  announceFailure, type AnnounceGate, type ProductAnnounceInvalidation, type ProductAnnounceResult,
  type ProductAnnouncement,
} from '../shared/product-announce';
import type { QueryIdentity } from '../shared/product-search';

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
  constructor(
    private readonly session: ProductSession,
    private readonly clientId: string,
    private readonly now: () => number = Date.now,
  ) {
    session.subscribe(state => {
      if (!state.ok || !state.signedIn) this.drop('signed_out');
    });
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onInvalidated(listener: (value: ProductAnnounceInvalidation) => void) {
    this.invalidationListeners.add(listener); return () => { this.invalidationListeners.delete(listener); };
  }
  allows(releaseId: string) {
    const view = this.session.view();
    return !!this.lease && view.signedIn && view.sessionEpoch === this.lease.epoch
      && this.lease.releaseId === releaseId && this.now() < Date.parse(this.lease.expiresAt);
  }
  private projection(identity: QueryIdentity): ProductAnnounceResult {
    if (!this.lease) return announceFailure('SOURCE_GATE_NOT_READY', identity);
    return { ok: true, ...identity, releaseId: this.lease.releaseId, releaseSeq: this.lease.releaseSeq,
      leaseExpiresAt: this.lease.expiresAt, announcement: this.announcement };
  }
  private drop(reason: ProductAnnounceInvalidation['reason']) {
    const epoch = this.session.view().sessionEpoch;
    this.lease = null; this.announcement = null; this.snapshot = null;
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    for (const listener of this.listeners) listener();
    for (const listener of this.invalidationListeners) listener({ sessionEpoch: epoch, reason });
  }
  private arm() {
    if (this.timer) clearTimeout(this.timer);
    if (!this.lease) return;
    const remaining = Date.parse(this.lease.expiresAt) - this.now();
    if (remaining <= 0) { this.drop('expired'); return; }
    this.timer = setTimeout(() => this.drop('expired'), remaining); this.timer.unref?.();
  }
  private headers(conditional = false) {
    return {
      'x-client-id': this.clientId,
      ...(conditional && this.lease ? { 'x-snapshot-lease': this.lease.token, ...(this.lease.etag ? { 'if-none-match': this.lease.etag } : {}) } : {}),
    };
  }
  async refresh(identity: QueryIdentity): Promise<ProductAnnounceResult> {
    try {
      const view = this.session.view();
      if (!view.signedIn) throw new ProductHttpError('UNAUTHORIZED');
      if (view.sessionEpoch !== identity.sessionEpoch) throw new ProductHttpError('STALE');
      const current = await this.session.request(identity.sessionEpoch, '/v1/announce/current', { method: 'GET', headers: this.headers(true) });
      if (view.sessionEpoch !== this.session.view().sessionEpoch) throw new ProductHttpError('STALE');
      if (current.status === 304) {
        if (!this.lease || !current.leaseToken || !LEASE.test(current.leaseToken) || current.leaseToken !== this.lease.token
          || !current.leaseExpiresAt || !Number.isFinite(Date.parse(current.leaseExpiresAt))) throw new ProductHttpError('UNAVAILABLE');
        this.lease = { ...this.lease, expiresAt: current.leaseExpiresAt, ...(current.etag ? { etag: current.etag } : {}) };
        this.arm(); return this.projection(identity);
      }
      const response = parseContractSchema('CurrentAnnouncementResponse', current.value);
      if (!LEASE.test(response.offline_lease.token) || response.offline_lease.release_id !== response.current_release_id) throw new ProductHttpError('VALIDATION');
      const replaced = this.lease && this.lease.releaseId !== response.current_release_id;
      const priorExpiry = Date.parse(response.offline_lease.expires_at);
      this.lease = {
        token: response.offline_lease.token, expiresAt: response.offline_lease.expires_at, epoch: identity.sessionEpoch,
        releaseId: response.current_release_id, releaseSeq: response.release_seq, ...(current.etag ? { etag: current.etag } : {}),
      };
      this.announcement = response.announcement
        ? { title: response.announcement.title, summary: response.announcement.summary, createdAt: response.announcement.created_at }
        : null;
      this.snapshot = { releaseId: response.current_release_id, cursor: null };
      if (replaced) for (const listener of this.listeners) listener();
      const ack = await this.session.request(identity.sessionEpoch, '/v1/announce/ack', {
        body: { client_id: this.clientId, release_id: response.current_release_id, release_seq: response.release_seq, offline_lease_token: response.offline_lease.token },
      });
      parseContractSchema('OkResponse', ack.value);
      if (Date.parse(this.lease.expiresAt) !== priorExpiry) throw new ProductHttpError('VALIDATION');
      await this.page(identity.sessionEpoch, null, 0);
      if (this.session.view().sessionEpoch !== identity.sessionEpoch || !this.session.view().signedIn) throw new ProductHttpError('STALE');
      this.arm();
      return this.projection(identity);
    } catch (error) {
      const code = error instanceof ProductHttpError ? error.code : 'UNAVAILABLE';
      if (code === 'SOURCE_GATE_NOT_READY') this.drop('source_gate');
      else if (code !== 'STALE' && code !== 'UNAUTHORIZED') this.drop('unavailable');
      return announceFailure(code, identity);
    }
  }
  private async page(epoch: number, cursor: string | null, depth: number) {
    if (depth > 8) throw new ProductHttpError('UNAVAILABLE');
    if (!this.lease || !this.snapshot || this.snapshot.releaseId !== this.lease.releaseId) throw new ProductHttpError('STALE');
    if (cursor !== null && this.snapshot.cursor !== cursor) throw new ProductHttpError('VALIDATION');
    const query = new URLSearchParams({ release_id: this.lease.releaseId, limit: '200', ...(cursor ? { cursor } : {}) });
    const result = await this.session.request(epoch, `/v1/announce/snapshot?${query}`, {
      method: 'GET', headers: { 'x-client-id': this.clientId, 'x-snapshot-lease': this.lease.token },
    });
    const snapshot = parseContractSchema('SnapshotResponse', result.value);
    if (snapshot.release_id !== this.lease.releaseId || snapshot.release_seq !== this.lease.releaseSeq) throw new ProductHttpError('VALIDATION');
    this.snapshot = { releaseId: snapshot.release_id, cursor: snapshot.next_cursor };
    if (snapshot.next_cursor) await this.page(epoch, snapshot.next_cursor, depth + 1);
  }
}
