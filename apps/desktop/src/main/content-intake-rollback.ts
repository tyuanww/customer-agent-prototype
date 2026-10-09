import { randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { IntakeRollbackCommand, IntakeRollbackView } from '../shared/content-intake-management';
import { isDefinitiveRollback } from '../shared/content-intake-recovery';
import type { IntakeAccess } from './content-intake-access';
import { ProductHttpError } from './product-http';
type C = components['schemas'];
type Request = (path: string, body?: unknown) => Promise<unknown>;
type LegacyRollback = Omit<C['IntakeRollback'], 'confirmed'> & { approvalEvidenceVersion: number };
type Operation = { action: 'rollback'; body: C['IntakeRollback'] | LegacyRollback; plan: C['IntakeRollbackImpact'] };
const reject = (code: 'FORBIDDEN' | 'STALE' | 'CONFLICT', reason?: string): never => { throw new ProductHttpError(code, reason); };

/** Owns rollback material binding and exact unknown-write recovery. Management
 * owns session/abort/access lifetime and the native confirmation dependency.
 * Expired readable plans never discard an unresolved immutable operation. */
export class ContentIntakeRollback {
  private plan: C['IntakeRollbackImpact'] | null = null;
  private review: C['IntakeRollbackReview'] | null = null;
  private operation: Operation | null = null;
  private result: IntakeRollbackView['result'] = null;
  pending() { return this.operation !== null; }
  editing() { return this.plan !== null; }
  invalidate(logout = false) {
    this.plan = null; this.review = null; this.result = null;
    if (logout) this.operation = null;
  }
  private allowed(access: IntakeAccess | null, plan: C['IntakeRollbackImpact']) {
    return !!access && plan.scopes.every(scope => access.capabilities.some(cap =>
      cap.actions.includes('rollback') && Object.entries(scope).every(([key, value]) => Reflect.get(cap.scope, key) === value)));
  }
  view(access: IntakeAccess | null): IntakeRollbackView {
    const available = !!access?.capabilities.some(c => c.actions.includes('rollback'));
    const plan = available && this.plan && this.allowed(access, this.plan) ? this.plan : null;
    const review = plan ? this.review : null;
    return structuredClone({ available, impact: plan ? { baseReleaseId: plan.baseReleaseId, targetReleaseId: plan.targetReleaseId,
      scopes: plan.scopes, requiresCorrectiveCandidate: plan.requiresCorrectiveCandidate } : null,
      review: review ? { state: review.state, checkedAt: review.checkedAt, validUntil: review.validUntil, instanceCode: review.instanceCode } : null,
      pending: this.operation ? { action: this.operation.action, recovery: 'receipt', retryAllowed: 'confirmed' in this.operation.body && this.operation.body.confirmed === true && !('approvalEvidenceVersion' in this.operation.body) } : null,
      result: available ? this.result : null, hasReview: !!plan?.approvalEvidenceVersion,
      canExecute: !!plan && !plan.requiresCorrectiveCandidate && plan.approvalEvidenceVersion === 0
        && this.allowed(access, plan) && !this.operation && !this.result });
  }
  async command(command: IntakeRollbackCommand, request: Request, currentAccess: () => IntakeAccess | null,
    confirm: (plan: C['IntakeRollbackImpact']) => Promise<boolean> = async () => { throw new ProductHttpError('UNAVAILABLE'); }) {
    if (command.action === 'rollback-retry' || command.action === 'rollback-recover') {
      const operation = this.operation;
      if (!operation) return reject('STALE');
      if (command.action === 'rollback-recover') {
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
    const access = currentAccess();
    if (!access?.capabilities.some(c => c.actions.includes('rollback'))) return reject('FORBIDDEN');
    if (command.action === 'rollback-request-review' || command.action === 'rollback-refresh-review') return reject('CONFLICT', 'MODE_CONFLICT');
    if (command.action === 'rollback-preview') {
      this.invalidate();
      const body = parseContractSchema('IntakeRollbackPreview', { baseReleaseId: command.baseReleaseId, targetReleaseId: command.targetReleaseId });
      const plan = parseContractSchema('IntakeRollbackImpact', await request('/v1/intake/rollback/preview', body));
      if (plan.baseReleaseId !== body.baseReleaseId || plan.targetReleaseId !== body.targetReleaseId
        || (!plan.requiresCorrectiveCandidate && (!plan.scopes.length || !this.allowed(currentAccess(), plan)))) return reject('STALE');
      this.plan = plan; return;
    }
    const plan = this.plan;
    if (!plan || plan.requiresCorrectiveCandidate || !this.allowed(access, plan) || this.result) return reject('CONFLICT');
    if (command.action === 'rollback-read-review') {
      if (!plan.approvalEvidenceVersion) return reject('CONFLICT', 'MODE_CONFLICT');
      this.review = null;
      const review = parseContractSchema('IntakeRollbackReview', await request(`/v1/intake/rollback/${encodeURIComponent(plan.rollbackPlanId)}/review`));
      if (review.rollbackPlanId !== plan.rollbackPlanId || review.impactDigest !== plan.impactDigest
        || review.evidenceVersion !== plan.approvalEvidenceVersion) return reject('STALE');
      this.review = review; return;
    }
    if (!this.view(access).canExecute) return reject('CONFLICT', 'MODE_CONFLICT');
    const operation: Operation = { action: 'rollback', plan: structuredClone(plan), body: parseContractSchema('IntakeRollback', {
      operationId: randomUUID(), rollbackPlanId: plan.rollbackPlanId, baseReleaseId: plan.baseReleaseId,
      targetReleaseId: plan.targetReleaseId, impactDigest: plan.impactDigest, confirmed: true }) };
    // Nothing is pending until confirmation. Management fences parallel commands
    // and checks session cancellation before this callback resolves.
    if (await confirm(structuredClone(plan)) !== true) return;
    if (this.plan !== plan) return reject('STALE');
    if (!this.allowed(currentAccess(), plan)) return reject('FORBIDDEN');
    this.operation = operation;
    this.review = null;
    await this.transmit(request, true);
  }
  private async transmit(request: Request, first: boolean) {
    const operation = this.operation!;
    // A legacy unknown request is recoverable only through its original receipt.
    // It must never be transformed into a confirmed direct publication.
    if (!('confirmed' in operation.body) || operation.body.confirmed !== true || 'approvalEvidenceVersion' in operation.body) return reject('CONFLICT', 'MODE_CONFLICT');
    let raw: unknown;
    try { raw = await request('/v1/intake/rollback', operation.body); }
    catch (error) {
      if (first && error instanceof ProductHttpError && isDefinitiveRollback(error.code,error.reason)
        && this.operation === operation) this.operation = null;
      throw error;
    }
    this.accept(raw, operation);
  }
  private accept(raw: unknown, operation: Operation) {
    const receipt = parseContractSchema('IntakeRollbackReceipt', raw);
    if (receipt.operationId !== operation.body.operationId || receipt.rollbackPlanId !== operation.plan.rollbackPlanId
      || (receipt.state === 'published' && (!receipt.releaseId || !receipt.announcementId))) return reject('STALE');
    this.result = { state: receipt.state, releaseId: receipt.releaseId };
    if (!['pending','unknown'].includes(receipt.state)) { this.operation = null; this.plan = null; this.review = null; }
  }
}
