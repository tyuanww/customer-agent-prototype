import { randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { IntakeManagementCommand, IntakeManagementView } from '../shared/content-intake-management';
import { loadIntakeAccess, type IntakeAccess } from './content-intake-access';
import { ContentIntakeQuality } from './content-intake-quality';
import { ProductHttpError } from './product-http';
import type { ProductSession } from './product-session';
type C = components['schemas'];
type Session = Pick<ProductSession, 'view' | 'subscribe' | 'request'>;
const sameKey = (a: C['IntakeCandidateKey'], b: C['IntakeCandidateKey']) => a.candidateId === b.candidateId && a.version === b.version && a.digest === b.digest;
const reject = (code: 'FORBIDDEN' | 'STALE' | 'CONFLICT' | 'VALIDATION'): never => { throw new ProductHttpError(code); };

/** One Dashboard main-frame owns this session. Discovery is only a UI hint;
 * commands and material reads reauthorize at API. Expiry clears readable data,
 * while an unknown mutation keeps its exact Main-owned body for recovery. */
export class ContentIntakeManagement {
  private readonly quality: ContentIntakeQuality;
  private access: IntakeAccess | null = null;
  private rows: IntakeManagementView['candidates'] = [];
  private cursor: string | null = null;
  private selected: C['IntakeCandidate'] | null = null;
  private material: C['IntakeCandidatePage'] | null = null;
  private receipt: C['IntakeQualityReceipt'] | null = null;
  private offset = 0;
  private active: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline = 0;
  private epoch: number;
  private disposed = false;
  private listeners = new Set<() => void>();
  private unsubscribe: () => void;
  constructor(private readonly session: Session) {
    this.epoch = session.view().sessionEpoch;
    this.quality = new ContentIntakeQuality(session);
    this.unsubscribe = session.subscribe(() => {
      if (!session.view().signedIn || session.view().sessionEpoch !== this.epoch) {
        this.epoch = session.view().sessionEpoch; this.invalidate(); this.selected = null; this.receipt = null;
      }
    });
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private invalidate() {
    this.active?.abort(); this.access = null; this.rows = []; this.cursor = null; this.material = null;
    this.quality.cancelRead();
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    for (const listener of this.listeners) listener();
  }
  private validAccess() {
    if (this.access && (Date.now() >= Date.parse(this.access.validUntil) || performance.now() >= this.deadline)) this.invalidate();
    return this.access;
  }
  private can(action: C['IntakeAction'], sourceId?: string) {
    return this.validAccess()?.capabilities.some(c => (!sourceId || c.scope.sourceId === sourceId) && c.actions.includes(action)) ?? false;
  }
  /** Native close/quit guard: never dispose an unknown write without a visible warning. */
  closeRisk(): 'pending' | 'editing' | null {
    if (this.active || (this.session.view().signedIn && this.quality.unresolved())) return 'pending';
    return this.selected ? 'editing' : null;
  }
  view(): IntakeManagementView {
    const session = this.session.view(), access = this.validAccess(), authorized = this.can('content-manage');
    const canRead = !!this.selected && this.can('content-manage', this.selected.sourceId);
    const canReview = canRead && this.can('review', this.selected!.sourceId);
    return structuredClone({ signedIn: session.signedIn, displayName: session.signedIn ? session.displayName ?? '已登录' : '未登录',
      authorized, validUntil: access?.validUntil ?? null, candidates: this.rows, moreCandidates: this.cursor !== null,
      selected: canRead ? this.selected : null, material: canRead ? this.material : null,
      canReview, quality: canReview ? this.quality.page(this.offset) : null, hasDraft: canReview && this.quality.hasDraft(),
      pending: session.signedIn ? this.quality.unresolved() : null, receipt: canRead ? this.receipt : null });
  }
  private async refreshAccess(signal: AbortSignal) {
    const access = await loadIntakeAccess(this.session, signal);
    this.access = access; this.deadline = performance.now() + Math.max(0, Date.parse(access.validUntil) - Date.now());
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.invalidate(), Math.max(0, Date.parse(access.validUntil) - Date.now()));
  }
  async command(c: IntakeManagementCommand): Promise<IntakeManagementView> {
    if (this.disposed || !this.session.view().signedIn) throw new ProductHttpError('UNAUTHORIZED');
    if (this.active) return reject('CONFLICT');
    const controller = new AbortController(), epoch = this.epoch;
    this.active = controller;
    const assertActive = () => {
      if (controller.signal.aborted || this.epoch !== epoch || this.disposed) return reject('STALE');
    };
    const request = async (path: string) => {
      const r = await this.session.request(epoch, path, { signal: controller.signal, maxResponseBytes: 8 * 1024 * 1024 });
      assertActive(); return r.value;
    };
    try {
      if (c.action === 'recover' || c.action === 'retry') {
        this.receipt = await this.quality[c.action](); assertActive();
        this.material = null; this.offset = 0;
      } else {
        if (this.quality.unresolved()) return reject('CONFLICT');
        if (c.action === 'list') {
          const cursor = c.next ? this.cursor : null;
          if (c.next && !cursor) return reject('STALE');
          // Clear the previous page before refreshing authority. current() can
          // interleave while the next HTTP page is in flight.
          this.rows = []; this.cursor = null;
          await this.refreshAccess(controller.signal); assertActive();
          if (this.selected && !this.can('content-manage', this.selected.sourceId)) {
            this.quality.cancelRead(); this.selected = null; this.material = null; this.receipt = null; this.offset = 0;
          } else if (this.selected && !this.can('review', this.selected.sourceId)) this.quality.cancelRead();
          if (this.can('content-manage')) {
            const q = new URLSearchParams({ limit: '20', ...(cursor ? { cursor } : {}) });
            const page = parseContractSchema('IntakeCandidateList', await request(`/v1/intake/candidates?${q}`));
            if (page.items.some(item => !this.can('content-manage', item.sourceId))) return reject('FORBIDDEN');
            this.rows = page.items.map(candidate => ({ selection: randomUUID(), candidate })); this.cursor = page.nextCursor;
          } else { this.rows = []; this.cursor = null; this.selected = null; this.quality.cancelRead(); }
        } else if (c.action === 'discard') {
          this.quality.cancelRead(); this.selected = null; this.material = null; this.offset = 0; this.receipt = null;
        } else if (c.action === 'select') {
          if (this.quality.hasDraft()) return reject('CONFLICT');
          const row = this.rows.find(r => r.selection === c.selection);
          if (!row || !this.can('content-manage', row.candidate.sourceId)) return reject('FORBIDDEN');
          const v = parseContractSchema('IntakeCandidate', await request(this.address(row.candidate)));
          if (!sameKey(v.key, row.candidate.key) || v.sourceId !== row.candidate.sourceId) return reject('STALE');
          this.quality.select(v.key); this.selected = v; this.material = null; this.receipt = null; this.offset = 0;
        } else {
          const selected = this.selected;
          if (!selected || !this.can('content-manage', selected.sourceId)) return reject('FORBIDDEN');
          if (c.action === 'material') {
            if (c.next && !this.material?.nextCursor) return reject('STALE');
            const q = new URLSearchParams({ limit: '20', ...(c.next && this.material?.nextCursor ? { cursor: this.material.nextCursor } : {}) });
            const page = parseContractSchema('IntakeCandidatePage', await request(`${this.address(selected)}/material?${q}`));
            if (!sameKey(page.key, selected.key) || page.materialHeader.scope.sourceId !== selected.sourceId) return reject('STALE');
            this.material = page;
          } else {
            if (!this.can('review', selected.sourceId)) return reject('FORBIDDEN');
            if (c.action === 'quality') {
              if (this.quality.hasDraft()) return reject('CONFLICT');
              await this.quality.refresh(c.phase); this.offset = 0;
            } else if (c.action === 'quality-page') { this.quality.page(c.offset); this.offset = c.offset; }
            else if (c.action === 'check') this.quality.setCheck(c.scriptId, c.defect, c.reason);
            else { this.receipt = await this.quality[c.action](); this.offset = 0; }
          }
        }
      }
      assertActive(); return this.view();
    } catch (error) {
      // First validation refusal preserves correctable human work. All other
      // failures revoke displayed materials; uncertain bodies remain recoverable.
      if (!(error instanceof ProductHttpError && ['VALIDATION','CONFLICT'].includes(error.code))) this.invalidate();
      throw error;
    } finally { if (this.active === controller) this.active = null; }
  }
  private address(candidate: C['IntakeCandidate']) {
    return `/v1/intake/candidates/${encodeURIComponent(candidate.key.candidateId)}/versions/${candidate.key.version}`;
  }
  dispose() { this.disposed = true; this.unsubscribe(); this.invalidate(); this.quality.dispose(); this.listeners.clear(); }
}
