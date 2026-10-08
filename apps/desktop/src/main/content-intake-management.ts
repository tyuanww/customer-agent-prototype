import { randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import { isIntakeManagementCommand, type IntakeManagementCommand, type IntakeManagementView, type IntakeRollbackCommand } from '../shared/content-intake-management';
import { isIntakeUploadCommand } from '../shared/content-intake-upload';
import { ContentIntakeUpload } from './content-intake-upload';
import { loadIntakeAccess, type IntakeAccess } from './content-intake-access';
import { ContentIntakeRollback } from './content-intake-rollback';
import { ContentIntakeQuality } from './content-intake-quality';
import { ProductHttpError } from './product-http';
import type { ProductSession } from './product-session';
type C = components['schemas'];
type Session = Pick<ProductSession, 'view' | 'subscribe' | 'request'>;
type WorkflowOperation =
  | { action: 'source-confirm'; body: C['IntakeSourceConfirmation'] }
  | { action: 'review-request' | 'review-refresh'; body: C['IntakeReviewRequest'] }
  | { action: 'cancel'; body: C['IntakeCancel'] }
  | { action: 'publish'; body: C['IntakePublish'] };
type Request = (path: string, body?: unknown) => Promise<unknown>;
/** Main freezes these display facts before showing the native publication dialog.
 * This is human intent only, never a substitute for server authorization. */
export type IntakePublicationPrompt = { title: string; sourceId: string; candidateVersion: number };

const isRollback = (command: IntakeManagementCommand): command is IntakeRollbackCommand => command.action.startsWith('rollback-');
const sameKey = (a: C['IntakeCandidateKey'], b: C['IntakeCandidateKey']) => a.candidateId === b.candidateId && a.version === b.version && a.digest === b.digest;
const reject = (code: 'FORBIDDEN' | 'STALE' | 'CONFLICT' | 'VALIDATION'): never => { throw new ProductHttpError(code); };

/** One Dashboard main-frame owns this session. Discovery is only a UI hint;
 * commands and material reads reauthorize at API. Expiry clears readable data,
 * while an unknown mutation keeps its exact Main-owned body for recovery. */
export class ContentIntakeManagement {
  private readonly rollback = new ContentIntakeRollback();
  private readonly quality: ContentIntakeQuality;
  private readonly upload: ContentIntakeUpload;
  private access: IntakeAccess | null = null;
  private rows: IntakeManagementView['candidates'] = [];
  private cursor: string | null = null;
  private selected: C['IntakeCandidate'] | null = null;
  private material: C['IntakeCandidatePage'] | null = null;
  private receipt: C['IntakeQualityReceipt'] | null = null;
  private offset = 0;
  private review: C['IntakeReview'] | null = null;
  private workflowResult: IntakeManagementView['workflowResult'] = null;
  private workflowPending: WorkflowOperation | null = null;
  private active: AbortController | null = null;
  private activeUpload: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline = 0;
  private epoch: number;
  private disposed = false;
  private listeners = new Set<() => void>();
  private unsubscribe: () => void;
  constructor(private readonly session: Session, nativeFiles?: ConstructorParameters<typeof ContentIntakeUpload>[1],
    private readonly confirmPublication: (prompt: IntakePublicationPrompt, signal: AbortSignal) => Promise<boolean> = async () => { throw new ProductHttpError('UNAVAILABLE'); }) {
    this.epoch = session.view().sessionEpoch;
    this.quality = new ContentIntakeQuality(session);
    this.upload = new ContentIntakeUpload(session, nativeFiles ?? {
      chooseWorkbook: async () => { throw new ProductHttpError('UNAVAILABLE'); },
      saveReport: async () => { throw new ProductHttpError('UNAVAILABLE'); },
    });
    this.unsubscribe = session.subscribe(() => {
      if (!session.view().signedIn || session.view().sessionEpoch !== this.epoch) {
        this.epoch = session.view().sessionEpoch; this.workflowPending = null; this.rollback.invalidate(true); this.upload.invalidate(true); this.invalidate(); this.clearSelection();
      }
    });
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private invalidate() {
    this.active?.abort(); this.access = null; this.rows = []; this.cursor = null; this.material = null;
    this.quality.cancelRead(); this.review = null; this.rollback.invalidate();
    this.upload.invalidate(false);
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
  private clearSelection() {
    this.quality.cancelRead(); this.selected = null; this.material = null; this.receipt = null;
    this.review = null; this.workflowResult = null; this.offset = 0;
  }
  private unresolved(): IntakeManagementView['pending'] {
    if (this.workflowPending) return { action: this.workflowPending.action, operationId: this.workflowPending.body.operationId,
      recovery: ['publish','cancel'].includes(this.workflowPending.action) ? 'receipt' : 'retry' };
    const quality = this.quality.unresolved();
    return quality ? { ...quality, recovery: 'receipt' } : null;
  }
  /** Native close/quit guard: never dispose an unknown write without a visible warning. */
  closeRisk(): 'pending' | 'editing' | null {
    if (this.active || (this.session.view().signedIn && (this.unresolved() || this.rollback.pending())) || this.upload.closeRisk() === 'pending') return 'pending';
    return this.selected || this.rollback.editing() ? 'editing' : this.upload.closeRisk();
  }
  view(): IntakeManagementView {
    const session = this.session.view(), access = this.validAccess(), authorized = this.can('content-manage');
    const canRead = !!this.selected && this.can('content-manage', this.selected.sourceId);
    const mutable = canRead && ['awaiting-evidence','ready'].includes(this.selected!.state);
    const canReview = mutable && this.can('review', this.selected!.sourceId);
    return structuredClone({ rollback: this.rollback.view(access), signedIn: session.signedIn, displayName: session.signedIn ? session.displayName ?? '已登录' : '未登录',
      authorized, validUntil: access?.validUntil ?? null, candidates: this.rows, moreCandidates: this.cursor !== null,
      selected: canRead ? this.selected : null, material: canRead ? this.material : null,
      canReview, quality: canReview ? this.quality.page(this.offset) : null, hasDraft: canReview && this.quality.hasDraft(),
      canConfirmSource: canRead && this.can('source-confirm', this.selected!.sourceId),
      canPublish: canRead && this.can('publish', this.selected!.sourceId),
      canRevise: mutable && this.can('import', this.selected!.sourceId) && !this.upload.closeRisk(),
      canCancel: mutable && this.can('candidate-cancel', this.selected!.sourceId),
      review: canRead ? this.review : null, workflowResult: canRead ? this.workflowResult : null,
      pending: session.signedIn ? this.unresolved() : null, receipt: canRead ? this.receipt : null, upload: this.upload.view(access) });
  }
  private async refreshAccess(signal: AbortSignal) {
    const access = await loadIntakeAccess(this.session, signal);
    if (signal.aborted) return reject('STALE');
    this.access = access; this.deadline = performance.now() + Math.max(0, Date.parse(access.validUntil) - Date.now());
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.invalidate(), Math.max(0, Date.parse(access.validUntil) - Date.now()));
  }
  async command(c: IntakeManagementCommand): Promise<IntakeManagementView> {
    if (!isIntakeManagementCommand(c)) return reject('VALIDATION');
    if (this.disposed || !this.session.view().signedIn) throw new ProductHttpError('UNAUTHORIZED');
    // Stopping a read/write wait must work while the original IPC is pending.
    // It does not cancel a server job or discard a retained operation identity.
    if (c.action === 'upload-stop') {
      const active = this.activeUpload;
      if (active && this.active === active) { active.abort(); this.active = null; this.activeUpload = null; }
      await this.upload.command(c, this.validAccess()); return this.view();
    }
    if (this.active) return reject('CONFLICT');
    if (this.rollback.pending() && !isRollback(c)) return reject('CONFLICT');
    const upload = this.upload.view(this.validAccess());
    if (!isIntakeUploadCommand(c) && upload.pending && c.action !== 'list') return reject('CONFLICT');
    // This fence uses owned state, not the access-filtered renderer projection:
    // revoking import can hide a revision without discarding its target.
    if (c.action === 'select' && this.upload.closeRisk()) return reject('CONFLICT');
    const controller = new AbortController(), epoch = this.epoch;
    this.active = controller;
    if (isIntakeUploadCommand(c)) this.activeUpload = controller;
    const assertActive = () => {
      if (controller.signal.aborted || this.epoch !== epoch || this.disposed) return reject('STALE');
    };
    const request: Request = async (path, body) => {
      const r = await this.session.request(epoch, path, { ...(body !== undefined ? { body } : {}), signal: controller.signal, maxResponseBytes: 8 * 1024 * 1024 });
      assertActive(); return r.value;
    };
    try {
      if (isRollback(c)) {
        if (this.unresolved() || this.quality.hasDraft() || this.upload.closeRisk()) return reject('CONFLICT');
        const recovery = ['rollback-recover','rollback-retry','rollback-discard'].includes(c.action);
        if (!recovery && !this.validAccess()) { await this.refreshAccess(controller.signal); assertActive(); }
        await this.rollback.command(c, request, this.validAccess());
        if (c.action === 'rollback-correct') this.clearSelection();
      } else if (isIntakeUploadCommand(c)) {
        if (this.unresolved() || this.quality.hasDraft()) return reject('CONFLICT');
        if (this.selected && ['upload-source','upload-choose','upload-submit','upload-open'].includes(c.action)) return reject('CONFLICT');
        // Reset only abandons local preparation. It must work offline after
        // access expiry; Upload still rejects pending writes and parsing jobs.
        if (c.action !== 'upload-reset' && !this.validAccess()) { await this.refreshAccess(controller.signal); assertActive(); }
        const candidate = await this.upload.command(c, this.validAccess(), controller.signal); assertActive();
        if (candidate) {
          if (!this.can('content-manage', candidate.sourceId)) return reject('FORBIDDEN');
          // A historical upload can still be refreshed after opening another
          // candidate. Never replace that selection or its renderer-only draft.
          if (this.selected && !sameKey(candidate.key, this.selected.key)) return reject('CONFLICT');
          if (!this.selected) {
            this.clearSelection(); this.quality.select(candidate.key);
          }
          this.selected = candidate;
        }
      } else if (c.action === 'recover' || c.action === 'retry') {
        if (this.workflowPending) {
          const operation = this.workflowPending;
          if (c.action === 'recover') {
            if (operation.action !== 'publish' && operation.action !== 'cancel') return reject('VALIDATION');
            this.acceptWorkflow(await request(`/v1/intake/operations/${encodeURIComponent(operation.body.operationId)}?action=${operation.action}`), operation);
          } else await this.transmitWorkflow(request, false);
          if (!this.workflowPending && this.selected) await this.readCandidate(request);
        } else { this.receipt = await this.quality[c.action](); this.material = null; this.offset = 0; }
        assertActive();
      } else {
        if (this.unresolved()) return reject('CONFLICT');
        if (c.action === 'list') {
          const cursor = c.next ? this.cursor : null;
          if (c.next && !cursor) return reject('STALE');
          // Clear the previous page before refreshing authority. current() can
          // interleave while the next HTTP page is in flight.
          this.rows = []; this.cursor = null;
          await this.refreshAccess(controller.signal); assertActive();
          if (this.selected && !this.can('content-manage', this.selected.sourceId)) {
            this.clearSelection();
          } else if (this.selected && !this.can('review', this.selected.sourceId)) this.quality.cancelRead();
          if (this.can('content-manage')) {
            const q = new URLSearchParams({ limit: '20', ...(cursor ? { cursor } : {}) });
            const page = parseContractSchema('IntakeCandidateList', await request(`/v1/intake/candidates?${q}`));
            if (page.items.some(item => !this.can('content-manage', item.sourceId))) return reject('FORBIDDEN');
            this.rows = page.items.map(candidate => ({ selection: randomUUID(), candidate })); this.cursor = page.nextCursor;
          } else { this.rows = []; this.cursor = null; this.selected = null; this.quality.cancelRead(); }
        } else if (c.action === 'discard') {
          this.clearSelection();
        } else if (c.action === 'select') {
          if (this.quality.hasDraft()) return reject('CONFLICT');
          const row = this.rows.find(r => r.selection === c.selection);
          if (!row || !this.can('content-manage', row.candidate.sourceId)) return reject('FORBIDDEN');
          const v = parseContractSchema('IntakeCandidate', await request(this.address(row.candidate)));
          if (!sameKey(v.key, row.candidate.key) || v.sourceId !== row.candidate.sourceId) return reject('STALE');
          this.clearSelection(); this.quality.select(v.key); this.selected = v;
        } else {
          const selected = this.selected;
          if (!selected || !this.can('content-manage', selected.sourceId)) return reject('FORBIDDEN');
          if (c.action === 'refresh-candidate') {
            await this.readCandidate(request);
          } else if (c.action === 'revise') {
            if (this.quality.hasDraft() || this.upload.closeRisk()) return reject('CONFLICT');
            await this.readCandidate(request);
            this.upload.beginRevision(this.selected!, this.validAccess());
            this.clearSelection(); this.rows = []; this.cursor = null;
          } else if (c.action === 'read-review') {
            await this.readCandidate(request);
            this.review = null;
            const review = parseContractSchema('IntakeReview', await request(`${this.address(selected)}/review`));
            if (!sameKey(review.key, selected.key) || review.evidenceVersion !== this.selected!.approvalEvidenceVersion) return reject('STALE');
            this.review = review;
          } else if (c.action === 'confirm-source' || c.action === 'request-review' || c.action === 'refresh-review' || c.action === 'publish' || c.action === 'cancel-candidate') {
            if (this.quality.hasDraft()) return reject('CONFLICT');
            const key = structuredClone(selected.key), operationId = randomUUID();
            if (c.action === 'cancel-candidate') {
              if (!this.can('candidate-cancel', selected.sourceId)) return reject('FORBIDDEN');
              if (!['awaiting-evidence','ready'].includes(selected.state) || this.upload.closeRisk()) return reject('CONFLICT');
              this.workflowPending = { action: 'cancel', body: parseContractSchema('IntakeCancel', { operationId, key }) };
            } else if (c.action === 'confirm-source') {
              if (!this.can('source-confirm', selected.sourceId)) return reject('FORBIDDEN');
              if (!this.material) return reject('VALIDATION');
              const header = this.material.materialHeader;
              this.workflowPending = { action: 'source-confirm', body: parseContractSchema('IntakeSourceConfirmation', { operationId, key,
                expectedEvidenceVersion: selected.sourceEvidenceVersion, confirmedVersionKind: c.versionKind,
                confirmedVersionValue: c.versionValue, reason: c.reason, acquisition: header.sourceClaim.acquisition, objectSha256: header.object.sha256 }) };
            } else if (c.action === 'publish') {
              if (!this.can('publish', selected.sourceId)) return reject('FORBIDDEN');
              if (!this.material || selected.state !== 'ready' || selected.sourceEvidenceVersion < 1 || selected.approvalEvidenceVersion < 1) return reject('CONFLICT');
              const body = parseContractSchema('IntakePublish', { operationId, key,
                baseReleaseId: this.material.materialHeader.baseReleaseId, sourceEvidenceVersion: selected.sourceEvidenceVersion,
                approvalEvidenceVersion: selected.approvalEvidenceVersion, title: c.title, summary: c.summary });
              // Freeze the exact request before waiting; no pending write exists on
              // cancel. active blocks selection changes and a second dialog.
              const confirmed = await this.confirmPublication({ title: body.title, sourceId: selected.sourceId,
                candidateVersion: key.version }, controller.signal);
              assertActive();
              if (confirmed !== true) return this.view();
              if (!this.can('publish', selected.sourceId)) return reject('FORBIDDEN');
              this.workflowPending = { action: 'publish', body };
            } else {
              if (c.action === 'refresh-review' && selected.approvalEvidenceVersion < 1) return reject('CONFLICT');
              this.workflowPending = { action: c.action === 'request-review' ? 'review-request' : 'review-refresh',
                body: parseContractSchema('IntakeReviewRequest', { operationId, key, expectedEvidenceVersion: selected.approvalEvidenceVersion }) };
            }
            this.workflowResult = null; this.review = null;
            await this.transmitWorkflow(request, true);
            // A successful response or historical replay is not a current status.
            if (!this.workflowPending) await this.readCandidate(request);
          } else if (c.action === 'material') {
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
      if (this.active === controller && !(error instanceof ProductHttpError && ['VALIDATION','CONFLICT'].includes(error.code))) this.invalidate();
      throw error;
    } finally { if (this.active === controller) this.active = null; if (this.activeUpload === controller) this.activeUpload = null; }
  }
  private async readCandidate(request: Request) {
    const selected = this.selected;
    if (!selected) return reject('STALE');
    const next = parseContractSchema('IntakeCandidate', await request(this.address(selected)));
    if (!sameKey(next.key, selected.key) || next.sourceId !== selected.sourceId) return reject('STALE');
    if (next.approvalEvidenceVersion !== this.review?.evidenceVersion) this.review = null;
    if (!['awaiting-evidence','ready'].includes(next.state)) {
      this.quality.cancelRead(); this.material = null; this.review = null; this.receipt = null;
    }
    this.selected = next;
  }
  /** Source/review have no public operation-receipt route. Their original POST
   * is the recovery protocol; publication and cancellation have receipt GETs.
   * Request-review can commit a package before a later provider/authority error,
   * so even an explicit rejection cannot discard that operation's create UUID. */
  private async transmitWorkflow(request: Request, firstAttempt: boolean) {
    const operation = this.workflowPending;
    if (!operation) return reject('STALE');
    const suffix = { 'source-confirm': 'source-confirmation', 'review-request': 'review', 'review-refresh': 'review/refresh', publish: 'publish', cancel: 'cancel' }[operation.action];
    let raw: unknown;
    try { raw = await request(`${this.address({ key: operation.body.key })}/${suffix}`, operation.body); }
    catch (error) {
      if (firstAttempt && operation.action !== 'review-request' && error instanceof ProductHttpError && error.reason !== 'COMMIT_UNKNOWN'
        && ['VALIDATION','FORBIDDEN','UNAUTHORIZED','CONFLICT','GONE'].includes(error.code) && this.workflowPending === operation) this.workflowPending = null;
      throw error;
    }
    this.acceptWorkflow(raw, operation);
  }
  private acceptWorkflow(raw: unknown, operation: WorkflowOperation) {
    let result: NonNullable<IntakeManagementView['workflowResult']>, unresolved = false;
    if (operation.action === 'publish' || operation.action === 'cancel') {
      const receipt = parseContractSchema('IntakeReceipt', raw);
      if (receipt.action !== operation.action || receipt.operationId !== operation.body.operationId || !sameKey(receipt.key, operation.body.key)
        || (receipt.state === 'published' && (!receipt.releaseId || !receipt.announcementId))
        || (operation.action === 'cancel' && (receipt.state === 'published' || receipt.releaseId !== null || receipt.announcementId !== null))) return reject('STALE');
      result = { operationId: operation.body.operationId, action: operation.action, state: receipt.state, releaseId: receipt.releaseId };
      unresolved = receipt.state === 'pending' || receipt.state === 'unknown';
    } else if (operation.action === 'source-confirm') {
      const candidate = parseContractSchema('IntakeCandidate', raw);
      if (!sameKey(candidate.key, operation.body.key) || candidate.sourceId !== this.selected?.sourceId
        || candidate.sourceEvidenceVersion !== operation.body.expectedEvidenceVersion + 1) return reject('STALE');
      result = { operationId: operation.body.operationId, action: operation.action, state: 'confirmed', releaseId: null };
    } else {
      const review = parseContractSchema('IntakeReview', raw);
      const expected = operation.body.expectedEvidenceVersion + Number(operation.action === 'review-request');
      if (!sameKey(review.key, operation.body.key) || review.evidenceVersion !== expected) return reject('STALE');
      this.review = review;
      result = { operationId: operation.body.operationId, action: operation.action, state: review.state, releaseId: null };
      unresolved = operation.action === 'review-request' && (review.state === 'creating' || !review.instanceCode);
    }
    this.workflowResult = result;
    if (!unresolved) this.workflowPending = null;
  }
  private address(candidate: Pick<C['IntakeCandidate'], 'key'>) {
    return `/v1/intake/candidates/${encodeURIComponent(candidate.key.candidateId)}/versions/${candidate.key.version}`;
  }
  dispose() { this.disposed = true; this.unsubscribe(); this.invalidate(); this.quality.dispose(); this.upload.dispose(); this.workflowPending = null; this.rollback.invalidate(true); this.listeners.clear(); }
}
