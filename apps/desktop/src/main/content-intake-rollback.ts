import { randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { IntakeRollbackCommand, IntakeRollbackView } from '../shared/content-intake-management';
import type { IntakeAccess } from './content-intake-access';
import { ProductHttpError } from './product-http';
type C = components['schemas'];
type Request = (path: string, body?: unknown) => Promise<unknown>;
type Operation = { action: 'rollback'; body: C['IntakeRollback']; plan: C['IntakeRollbackImpact'] }
  | { action: 'review-request' | 'review-refresh'; body: C['IntakeRollbackReviewRequest']; plan: C['IntakeRollbackImpact'] };
const reject = (code: 'FORBIDDEN' | 'STALE' | 'CONFLICT') => { throw new ProductHttpError(code); };

/** Owns rollback material binding, independent review, and exact unknown-write
 * recovery. Management owns session/abort/access lifetime and calls invalidate.
 * A readable plan can expire while an immutable unresolved body remains owned. */
export class ContentIntakeRollback {
  private plan: C['IntakeRollbackImpact'] | null = null;
  private review: C['IntakeRollbackReview'] | null = null;
  private operation: Operation | null = null;
  private result: IntakeRollbackView['result'] = null;
  private reviewDeadline = 0;
  pending() { return this.operation !== null; }
  editing() { return this.plan !== null; }
  invalidate(logout = false) {
    this.plan = null; this.review = null; this.result = null; this.reviewDeadline = 0;
    if (logout) this.operation = null;
  }
  private allowed(access: IntakeAccess | null, plan: C['IntakeRollbackImpact']) {
    return !!access && plan.scopes.every(scope => access.capabilities.some(cap =>
      cap.actions.includes('rollback') && Object.entries(scope).every(([key, value]) => Reflect.get(cap.scope, key) === value)));
  }
  view(access: IntakeAccess | null): IntakeRollbackView {
    const available = !!access?.capabilities.some(c => c.actions.includes('rollback'));
    // Corrective-only previews omit unauthorized scopes. The server never
    // grants full-catalog authority from the subset shown here.
    const plan = available && this.plan && this.allowed(access, this.plan) ? this.plan : null, review = plan ? this.review : null;
    return structuredClone({ available, impact: plan ? { baseReleaseId: plan.baseReleaseId, targetReleaseId: plan.targetReleaseId,
      scopes: plan.scopes, requiresCorrectiveCandidate: plan.requiresCorrectiveCandidate } : null,
      review: review ? { state: review.state, checkedAt: review.checkedAt, validUntil: review.validUntil, instanceCode: review.instanceCode } : null,
      pending: this.operation ? { action: this.operation.action, recovery: this.operation.action === 'rollback' ? 'receipt' : 'retry' } : null,
      result: available ? this.result : null,
      hasReview: !!plan?.approvalEvidenceVersion,
      canExecute: !!plan && !plan.requiresCorrectiveCandidate && this.allowed(access, plan) && !this.operation && !this.result
        && review?.state === 'approved' && !!review.validUntil && Date.now() < Date.parse(review.validUntil) && performance.now() < this.reviewDeadline });
  }
  async command(command: IntakeRollbackCommand, request: Request, access: IntakeAccess | null) {
    if (command.action === 'rollback-retry' || command.action === 'rollback-recover') {
      const operation = this.operation;
      if (!operation) return reject('STALE');
      if (command.action === 'rollback-recover') {
        if (operation.action !== 'rollback') return reject('CONFLICT');
        this.accept(await request(`/v1/intake/operations/${encodeURIComponent(operation.body.operationId)}?action=rollback`), operation);
      } else await this.transmit(request, false);
      return;
    }
    if (this.operation) return reject('CONFLICT');
    if (command.action === 'rollback-correct') {
      if (!this.plan?.requiresCorrectiveCandidate) return reject('CONFLICT');
      this.invalidate(); return;
    }
    if (command.action === 'rollback-discard') { this.invalidate(); return; }
    if (!access?.capabilities.some(c => c.actions.includes('rollback'))) return reject('FORBIDDEN');
    if (command.action === 'rollback-preview') {
      this.invalidate();
      const body = parseContractSchema('IntakeRollbackPreview', { baseReleaseId: command.baseReleaseId, targetReleaseId: command.targetReleaseId });
      const plan = parseContractSchema('IntakeRollbackImpact', await request('/v1/intake/rollback/preview', body));
      if (plan.baseReleaseId !== body.baseReleaseId || plan.targetReleaseId !== body.targetReleaseId
        || (!plan.requiresCorrectiveCandidate && !plan.scopes.length)
        || (!plan.requiresCorrectiveCandidate && !this.allowed(access, plan))) return reject('STALE');
      this.plan = plan; return;
    }
    const plan = this.plan;
    if (!plan || plan.requiresCorrectiveCandidate || !this.allowed(access, plan) || this.result) return reject('CONFLICT');
    if (command.action === 'rollback-read-review') {
      if (!plan.approvalEvidenceVersion) return reject('CONFLICT');
      this.review = null;
      this.acceptReview(await request(this.address(plan)), plan, plan.approvalEvidenceVersion); return;
    }
    const operationId = randomUUID();
    if (command.action === 'rollback-execute') {
      if (!this.view(access).canExecute) return reject('CONFLICT');
      this.operation = { action: 'rollback', plan: structuredClone(plan), body: parseContractSchema('IntakeRollback', {
        operationId, rollbackPlanId: plan.rollbackPlanId, baseReleaseId: plan.baseReleaseId, targetReleaseId: plan.targetReleaseId,
        impactDigest: plan.impactDigest, approvalEvidenceVersion: plan.approvalEvidenceVersion }) };
    } else {
      if (command.action === 'rollback-refresh-review' && !plan.approvalEvidenceVersion) return reject('CONFLICT');
      this.operation = { action: command.action === 'rollback-request-review' ? 'review-request' : 'review-refresh', plan: structuredClone(plan),
        body: parseContractSchema('IntakeRollbackReviewRequest', { operationId, impactDigest: plan.impactDigest, expectedEvidenceVersion: plan.approvalEvidenceVersion }) };
    }
    this.review = null;
    await this.transmit(request, true);
  }
  private address(plan: C['IntakeRollbackImpact']) { return `/v1/intake/rollback/${encodeURIComponent(plan.rollbackPlanId)}/review`; }
  private async transmit(request: Request, first: boolean) {
    const operation = this.operation!;
    let raw: unknown;
    try { raw = await request(operation.action === 'rollback' ? '/v1/intake/rollback'
      : this.address(operation.plan) + (operation.action === 'review-refresh' ? '/refresh' : ''), operation.body); }
    catch (error) {
      // A confirmed plan mismatch makes this independent approval unusable even
      // if creation previously reached the provider. Release the local recovery
      // fence; this does not cancel that external approval or prove it absent.
      if (operation.action === 'review-request' && this.operation === operation && error instanceof ProductHttpError
        && error.code === 'CONFLICT' && ['BASE_CHANGED','MATERIAL_CHANGED'].includes(error.reason ?? '')) {
        this.operation = null; this.invalidate();
        throw new ProductHttpError('CONFLICT', 'ROLLBACK_PLAN_INVALIDATED');
      }
      // Review creation may have durably saved its UUID before provider refusal.
      if (first && operation.action !== 'review-request' && error instanceof ProductHttpError && error.reason !== 'COMMIT_UNKNOWN'
        && ['VALIDATION','FORBIDDEN','UNAUTHORIZED','CONFLICT','GONE'].includes(error.code) && this.operation === operation) this.operation = null;
      throw error;
    }
    this.accept(raw, operation);
  }
  private acceptReview(raw: unknown, plan: C['IntakeRollbackImpact'], expected: number) {
    const review = parseContractSchema('IntakeRollbackReview', raw);
    if (review.rollbackPlanId !== plan.rollbackPlanId || review.impactDigest !== plan.impactDigest || review.evidenceVersion !== expected) return reject('STALE');
    this.review = review; this.plan = { ...plan, approvalEvidenceVersion: review.evidenceVersion };
    this.reviewDeadline = performance.now() + Math.max(0, Date.parse(review.validUntil ?? '') - Date.now());
    return review;
  }
  private accept(raw: unknown, operation: Operation) {
    if (operation.action === 'rollback') {
      const receipt = parseContractSchema('IntakeRollbackReceipt', raw);
      if (receipt.operationId !== operation.body.operationId || receipt.rollbackPlanId !== operation.plan.rollbackPlanId
        || (receipt.state === 'published' && (!receipt.releaseId || !receipt.announcementId))) return reject('STALE');
      this.result = { state: receipt.state, releaseId: receipt.releaseId };
      if (!['pending','unknown'].includes(receipt.state)) { this.operation = null; this.plan = null; this.review = null; }
    } else {
      const review = this.acceptReview(raw, operation.plan, operation.body.expectedEvidenceVersion + Number(operation.action === 'review-request'));
      if (operation.action !== 'review-request' || (review.state !== 'creating' && review.instanceCode)) this.operation = null;
    }
  }
}
