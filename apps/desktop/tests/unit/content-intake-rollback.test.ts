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
    reviewRequestId: 'review-a', instanceCode: 'synthetic-instance', state: 'approved', checkedAt: new Date().toISOString(), validUntil,
    revocationGeneration: 0, reviewPackageObjectId: 'review-object-a', reviewPackageSha256: 'b'.repeat(64) };
  let receipt: C['IntakeRollbackReceipt'] | null = null;
  const state = { lose: '', corrective: false };
  const request = vi.fn(async (path: string, body?: unknown): Promise<unknown> => {
    let value: unknown;
    if (path.endsWith('/preview')) value = { ...plan, scopes: state.corrective ? [] : plan.scopes, requiresCorrectiveCandidate: state.corrective };
    else if (path.endsWith('/review') && !body) value = review;
    else if (path === '/v1/intake/rollback') {
      receipt = { action: 'rollback', operationId: (body as C['IntakeRollback']).operationId, rollbackPlanId: plan.rollbackPlanId,
        state: 'published', releaseId: 'rel_3', announcementId: 'announcement-3', reason: null }; value = receipt;
    } else if (path.includes('/operations/')) value = receipt;
    else throw new Error(`Unexpected ${path}`);
    if (state.lose && path.endsWith(state.lose)) { state.lose = ''; throw new ProductHttpError('UNAVAILABLE'); }
    return structuredClone(value);
  });
  const rollback = new ContentIntakeRollback(), confirm = vi.fn().mockResolvedValue(true);
  const command = (action: Exclude<Parameters<ContentIntakeRollback['command']>[0]['action'], 'rollback-preview'>) => rollback.command({ action }, request, () => access, confirm);
  const preview = () => rollback.command({ action: 'rollback-preview', baseReleaseId: 'rel_2', targetReleaseId: 'rel_1' }, request, () => access, confirm);
  return { rollback, access, request, review, plan, state, command, preview, confirm };
}
it('freezes exact direct publication and all affected scopes before confirmation without exposing private keys', async () => {
  const f = fixture(); await f.preview(); expect(f.rollback.view(f.access).canExecute).toBe(true);
  const projected = JSON.stringify(f.rollback.view(f.access));
  for (const secret of ['rollbackPlanId','impactDigest','operationId','reviewPackageObjectId']) expect(projected).not.toContain(secret);
  await f.command('rollback-execute'); expect(f.rollback.view(f.access).result).toEqual({ state: 'published', releaseId: 'rel_3' });
  expect(f.confirm).toHaveBeenCalledWith(f.plan);
  const body = f.request.mock.calls.find(([path]) => path === '/v1/intake/rollback')![1];
  expect(body).toMatchObject({ rollbackPlanId: 'rollback-a', impactDigest: 'a'.repeat(64), confirmed: true, baseReleaseId: 'rel_2', targetReleaseId: 'rel_1' });
  expect(body).not.toHaveProperty('approvalEvidenceVersion');
});
it('cancel leaves the plan editable and creates no pending request', async () => {
  const f = fixture(); await f.preview(); f.request.mockClear(); f.confirm.mockResolvedValue(false);
  await f.command('rollback-execute'); expect(f.request).not.toHaveBeenCalled(); expect(f.rollback.pending()).toBe(false);
  expect(f.rollback.view(f.access).canExecute).toBe(true);
  f.confirm.mockResolvedValue(true); await f.command('rollback-execute'); expect(f.request).toHaveBeenCalledTimes(1);
});
it.each(['invalidate','revoke'] as const)('rejects late confirmation after %s without registering a write', async reason => {
  const f = fixture(); await f.preview(); f.request.mockClear();
  f.confirm.mockImplementation(async () => { if (reason === 'invalidate') f.rollback.invalidate(); else f.access.capabilities[0].actions = []; return true; });
  await expect(f.command('rollback-execute')).rejects.toMatchObject({ code: reason === 'invalidate' ? 'STALE' : 'FORBIDDEN' });
  expect(f.request).not.toHaveBeenCalled(); expect(f.rollback.pending()).toBe(false);
});
it('recovers a lost commit by original receipt and never generates a replacement operation', async () => {
  const f = fixture(); await f.preview(); f.state.lose = '/rollback';
  await expect(f.command('rollback-execute')).rejects.toMatchObject({ code: 'UNAVAILABLE' }); f.rollback.invalidate();
  expect(f.rollback.view(null)).toMatchObject({ impact: null, review: null, pending: { action: 'rollback', recovery: 'receipt' } });
  await expect(f.preview()).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(f.command('rollback-discard')).rejects.toMatchObject({ code: 'CONFLICT' });
  await f.command('rollback-recover'); expect(f.rollback.view(f.access).result?.releaseId).toBe('rel_3');
  expect(f.request.mock.calls.filter(([path]) => path === '/v1/intake/rollback')).toHaveLength(1); expect(f.confirm).toHaveBeenCalledTimes(1);
});
it('retries only the confirmed immutable direct body and clears it at logout', async () => {
  const f = fixture(); await f.preview(); f.state.lose = '/rollback';
  await expect(f.command('rollback-execute')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  const first = f.request.mock.calls.at(-1)![1]; await f.command('rollback-retry');
  expect(f.request.mock.calls.at(-1)![1]).toEqual(first); expect(f.confirm).toHaveBeenCalledTimes(1);
  f.rollback.invalidate(true); await expect(f.command('rollback-retry')).rejects.toMatchObject({ code: 'STALE' });
});
it('legacy unknown publication is read-only receipt recovery and is never rewritten as confirmed', async () => {
  const f = fixture(); await f.preview(); f.state.lose = '/rollback';
  await expect(f.command('rollback-execute')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  const operation = Reflect.get(f.rollback, 'operation') as { body: Record<string, unknown> };
  delete operation.body.confirmed; operation.body.approvalEvidenceVersion = 1;
  const original = structuredClone(operation.body), writes = f.request.mock.calls.length;
  expect(f.rollback.view(null).pending?.retryAllowed).toBe(false);
  await expect(f.command('rollback-retry')).rejects.toMatchObject({ code: 'CONFLICT', reason: 'MODE_CONFLICT' });
  expect(f.request.mock.calls).toHaveLength(writes); expect(operation.body).toEqual(original);
  await f.command('rollback-recover'); expect(f.rollback.pending()).toBe(false);
});
it('admits a privacy-filtered corrective preview but cannot publish it', async () => {
  const f = fixture(); f.state.corrective = true; await f.preview();
  expect(f.rollback.view(f.access).impact).toMatchObject({ requiresCorrectiveCandidate: true, scopes: [] });
  await expect(f.command('rollback-execute')).rejects.toMatchObject({ code: 'CONFLICT' }); expect(f.confirm).not.toHaveBeenCalled();
  await f.command('rollback-correct'); expect(f.rollback.view(f.access).impact).toBeNull();
});
it('reads historical review without refreshing or admitting the old plan for direct publication', async () => {
  const f = fixture(); f.plan.approvalEvidenceVersion = 1; await f.preview();
  await f.command('rollback-read-review'); expect(f.rollback.view(f.access).review?.state).toBe('approved');
  expect(f.rollback.view(f.access).canExecute).toBe(false);
  for (const action of ['rollback-request-review','rollback-refresh-review','rollback-execute'] as const)
    await expect(f.command(action)).rejects.toMatchObject({ code: 'CONFLICT', reason: 'MODE_CONFLICT' });
  expect(f.request.mock.calls.filter(([, body]) => body)).toHaveLength(1); expect(f.confirm).not.toHaveBeenCalled();
});
it('refuses forged renderer authority and accepts only bounded human version input', () => {
  expect(isIntakeManagementCommand({ action: 'rollback-preview', baseReleaseId: 'rel_2', targetReleaseId: 'rel_1' })).toBe(true);
  for (const command of [{ action: 'rollback-execute', confirmed: true }, { action: 'rollback-retry', operationId: 'forged' },
    { action: 'rollback-preview', baseReleaseId: 'rel_1', targetReleaseId: 'rel_1' }, { action: 'rollback-preview', baseReleaseId: 'x'.repeat(129), targetReleaseId: 'rel_1' }]) expect(isIntakeManagementCommand(command)).toBe(false);
});
it('hides prior scope materials when access refresh retains only another rollback source', async () => {
  const f = fixture(); await f.preview();
  f.access.capabilities[0].scope = { ...f.access.capabilities[0].scope, sourceId: 'source-b', shopId: 'shop-b' };
  expect(f.rollback.view(f.access)).toMatchObject({ available: true, impact: null, review: null, canExecute: false });
});
it('fails closed when native confirmation is not assembled', async () => {
  const f = fixture(); await f.preview(); f.request.mockClear();
  await expect(f.rollback.command({ action: 'rollback-execute' }, f.request, () => f.access)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(f.request).not.toHaveBeenCalled(); expect(f.rollback.pending()).toBe(false);
});
