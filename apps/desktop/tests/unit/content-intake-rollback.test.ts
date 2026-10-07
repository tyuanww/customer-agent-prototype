// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { components } from '@customer-agent/contracts';
import { ContentIntakeRollback } from '../../src/main/content-intake-rollback';
import { ProductHttpError } from '../../src/main/product-http';
import { isIntakeManagementCommand } from '../../src/shared/content-intake-management';
import type { IntakeAccess } from '../../src/main/content-intake-access';
type C = components['schemas'];
function fixture() {
  const scope: C['IntakeSourceScope'] = { sourceId: 'source-a', tenantId: 'tenant-a', appId: 'app-a', brandId: 'brand-a', shopId: 'shop-a', domain: 'product' };
  const validUntil = new Date(Date.now() + 60000).toISOString();
  const access: IntakeAccess = { validUntil, shops: ['shop-a'], sources: [], capabilities: [{ scope, actions: ['rollback'], mayAllocate: [], mayDelegate: [], validUntil }] };
  const plan: C['IntakeRollbackImpact'] = { rollbackPlanId: 'rollback-a', impactDigest: 'a'.repeat(64), baseReleaseId: 'rel_2', targetReleaseId: 'rel_1', scopes: [scope], requiresCorrectiveCandidate: false, approvalEvidenceVersion: 0 };
  const review: C['IntakeRollbackReview'] = { rollbackPlanId: plan.rollbackPlanId, impactDigest: plan.impactDigest, evidenceVersion: 1,
    reviewRequestId: 'review-a', instanceCode: 'synthetic-instance', state: 'pending', checkedAt: null, validUntil: null,
    revocationGeneration: 0, reviewPackageObjectId: 'review-object-a', reviewPackageSha256: 'b'.repeat(64) };
  let receipt: C['IntakeRollbackReceipt'] | null = null;
  const state = { lose: '', corrective: false, creating: false };
  const request = vi.fn(async (path: string, body?: unknown): Promise<unknown> => {
    let value: unknown;
    if (path.endsWith('/preview')) value = { ...plan, scopes: state.corrective ? [] : plan.scopes, requiresCorrectiveCandidate: state.corrective };
    else if (path.endsWith('/review/refresh')) {
      review.state = 'approved'; review.checkedAt = new Date().toISOString(); review.validUntil = validUntil; value = review;
    } else if (path.endsWith('/review')) value = { ...review, state: state.creating ? 'creating' : review.state, instanceCode: state.creating ? null : review.instanceCode };
    else if (path === '/v1/intake/rollback') {
      receipt = { action: 'rollback', operationId: (body as C['IntakeRollback']).operationId, rollbackPlanId: plan.rollbackPlanId,
        state: 'published', releaseId: 'rel_3', announcementId: 'announcement-3', reason: null }; value = receipt;
    } else if (path.includes('/operations/')) value = receipt;
    else throw new Error(`Unexpected ${path}`);
    if (state.lose && path.endsWith(state.lose)) { state.lose = ''; throw new ProductHttpError('UNAVAILABLE'); }
    return structuredClone(value);
  });
  const rollback = new ContentIntakeRollback();
  const command = (action: Exclude<Parameters<ContentIntakeRollback['command']>[0]['action'], 'rollback-preview'>) => rollback.command({ action }, request, access);
  const preview = () => rollback.command({ action: 'rollback-preview', baseReleaseId: 'rel_2', targetReleaseId: 'rel_1' }, request, access);
  const ready = async () => { await preview(); await command('rollback-request-review'); await command('rollback-refresh-review'); };
  return { rollback, access, request, review, plan, state, command, preview, ready };
}
it('binds independent approval and publication without exposing keys or attachments to renderer', async () => {
  const f = fixture(); await f.preview();
  await expect(f.command('rollback-execute')).rejects.toMatchObject({ code: 'CONFLICT' });
  await f.command('rollback-request-review'); expect(f.rollback.view(f.access).canExecute).toBe(false);
  await f.command('rollback-refresh-review'); expect(f.rollback.view(f.access).canExecute).toBe(true);
  const projected = JSON.stringify(f.rollback.view(f.access));
  for (const secret of ['rollbackPlanId','impactDigest','operationId','reviewPackageObjectId']) expect(projected).not.toContain(secret);
  await f.command('rollback-execute'); expect(f.rollback.view(f.access).result).toEqual({ state: 'published', releaseId: 'rel_3' });
  const body = f.request.mock.calls.find(([path]) => path === '/v1/intake/rollback')![1];
  expect(body).toMatchObject({ rollbackPlanId: 'rollback-a', impactDigest: 'a'.repeat(64), approvalEvidenceVersion: 1, baseReleaseId: 'rel_2', targetReleaseId: 'rel_1' });
});
it('recovers a lost commit by original receipt and never generates a replacement operation', async () => {
  const f = fixture(); await f.ready(); f.state.lose = '/rollback';
  await expect(f.command('rollback-execute')).rejects.toMatchObject({ code: 'UNAVAILABLE' }); f.rollback.invalidate();
  expect(f.rollback.view(null)).toMatchObject({ impact: null, review: null, pending: { action: 'rollback', recovery: 'receipt' } });
  await expect(f.preview()).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(f.command('rollback-discard')).rejects.toMatchObject({ code: 'CONFLICT' });
  await f.command('rollback-recover'); expect(f.rollback.view(f.access).result?.releaseId).toBe('rel_3');
  expect(f.request.mock.calls.filter(([path]) => path === '/v1/intake/rollback')).toHaveLength(1);
});
it('keeps the same review UUID through provider uncertainty, and logout erases the recovery body', async () => {
  const f = fixture(); await f.preview(); f.state.creating = true;
  await f.command('rollback-request-review'); expect(f.rollback.pending()).toBe(true);
  f.rollback.invalidate(); f.state.creating = false; await f.command('rollback-retry');
  const writes = f.request.mock.calls.filter(([path, body]) => path.endsWith('/review') && body);
  expect(writes[0][1]).toEqual(writes[1][1]); expect(f.rollback.pending()).toBe(false);
  f.state.lose = '/review/refresh'; await expect(f.command('rollback-refresh-review')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  f.rollback.invalidate(true); expect(f.rollback.view(null).pending).toBeNull();
  await expect(f.command('rollback-retry')).rejects.toMatchObject({ code: 'STALE' });
});
it('admits a privacy-filtered corrective preview but never starts review or rollback for it', async () => {
  const f = fixture(); f.state.corrective = true; await f.preview();
  expect(f.rollback.view(f.access).impact).toMatchObject({ requiresCorrectiveCandidate: true, scopes: [] });
  for (const action of ['rollback-request-review','rollback-execute'] as const) await expect(f.command(action)).rejects.toMatchObject({ code: 'CONFLICT' });
  await f.command('rollback-discard'); expect(f.rollback.view(f.access).impact).toBeNull();
});
it('rejects wrong approval material, expired approvals and incomplete current scope authority', async () => {
  const f = fixture(); await f.preview(); f.review.impactDigest = 'c'.repeat(64);
  await expect(f.command('rollback-request-review')).rejects.toMatchObject({ code: 'STALE' });
  expect(f.rollback.pending()).toBe(true);
  f.review.impactDigest = f.plan.impactDigest; await f.command('rollback-retry'); await f.command('rollback-refresh-review');
  f.review.validUntil = '2020-01-01T00:00:00Z'; await f.command('rollback-read-review');
  expect(f.rollback.view(f.access).canExecute).toBe(false);
  f.access.capabilities[0].actions = []; await expect(f.command('rollback-execute')).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('refuses forged renderer authority and accepts only bounded human version input', () => {
  expect(isIntakeManagementCommand({ action: 'rollback-preview', baseReleaseId: 'rel_2', targetReleaseId: 'rel_1' })).toBe(true);
  for (const command of [{ action: 'rollback-execute', approvalEvidenceVersion: 1 }, { action: 'rollback-retry', operationId: 'forged' },
    { action: 'rollback-preview', baseReleaseId: 'rel_1', targetReleaseId: 'rel_1' }, { action: 'rollback-preview', baseReleaseId: 'x'.repeat(129), targetReleaseId: 'rel_1' }]) expect(isIntakeManagementCommand(command)).toBe(false);
});

it('hides prior scope materials when access refresh retains only another rollback source', async () => {
  const f = fixture(); await f.ready();
  f.access.capabilities[0].scope = { ...f.access.capabilities[0].scope, sourceId: 'source-b', shopId: 'shop-b' };
  expect(f.rollback.view(f.access)).toMatchObject({ available: true, impact: null, review: null, canExecute: false });
});
it.each(['BASE_CHANGED', 'MATERIAL_CHANGED'])('releases only a confirmed obsolete review plan after %s, including an unknown create retry', async reason => {
  for (const retry of [false, true]) {
    const f = fixture(); await f.preview();
    if (retry) {
      f.state.lose = '/review';
      await expect(f.command('rollback-request-review')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
      f.rollback.invalidate();
    }
    f.request.mockRejectedValueOnce(new ProductHttpError('CONFLICT', reason));
    await expect(f.command(retry ? 'rollback-retry' : 'rollback-request-review')).rejects.toMatchObject({ code: 'CONFLICT', reason: 'ROLLBACK_PLAN_INVALIDATED' });
    expect(f.rollback.view(f.access)).toMatchObject({ impact: null, review: null, pending: null, canExecute: false });
    await f.preview(); expect(f.rollback.view(f.access).impact?.baseReleaseId).toBe('rel_2');
  }
});
it.each([
  new ProductHttpError('UNAVAILABLE'), new ProductHttpError('CONFLICT', 'COMMIT_UNKNOWN'),
  new ProductHttpError('FORBIDDEN', 'SCOPE_DENIED'), new ProductHttpError('CONFLICT', 'APPROVAL_CHANGED'),
])('retains review original UUID when rejection does not prove the plan obsolete (%s)', async error => {
  const f = fixture(); await f.preview(); f.state.lose = '/review';
  await expect(f.command('rollback-request-review')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  const firstBody = f.request.mock.calls.at(-1)![1];
  f.request.mockRejectedValueOnce(error);
  await expect(f.command('rollback-retry')).rejects.toBe(error);
  expect(f.rollback.pending()).toBe(true);
  await expect(f.preview()).rejects.toMatchObject({ code: 'CONFLICT' });
  await f.command('rollback-retry');
  expect(f.request.mock.calls.at(-1)![1]).toEqual(firstBody);
});
