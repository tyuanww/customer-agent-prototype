import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { IntakeRollback } from '../../src/renderer/features/dashboard/IntakeRollback';
import { formatSeatClock } from '../../src/renderer/features/dashboard/intake-time';
import type { IntakeManagementView } from '../../src/shared/content-intake-management';
function view(overrides: Partial<IntakeManagementView['rollback']> = {}): Pick<IntakeManagementView, 'rollback' | 'candidates'> {
  return { candidates: [], rollback: { available: true, impact: null, review: null, pending: null, result: null, hasReview: false, canExecute: false, ...overrides } };
}
const impact = { baseReleaseId: 'rel_2', targetReleaseId: 'rel_1', requiresCorrectiveCandidate: false, scopes: [
  { tenantId: 'tenant-a', appId: 'app-a', brandId: 'brand-a', shopId: 'shop-a', sourceId: 'source-a', domain: 'product' as const },
  { tenantId: 'tenant-a', appId: 'app-a', brandId: 'brand-a', shopId: 'shop-b', sourceId: 'source-b', domain: 'product' as const },
] };
it('does not ask for a release id until the view already has both versions', async () => {
  const apply = vi.fn(), onDirty = vi.fn(), user = userEvent.setup();
  const rendered = render(<IntakeRollback view={view()} busy={false} blocked={false} apply={apply} onDirty={onDirty} />);
  expect(screen.getByText('请先读取当前版和上一版。')).toBeVisible();
  expect(screen.queryByRole('textbox', { name: /发布编号/ })).not.toBeInTheDocument();
  expect(apply).not.toHaveBeenCalled();
  rendered.rerender(<IntakeRollback view={view({ impact, canExecute: true })} busy={false} blocked={false} apply={apply} onDirty={onDirty} />);
  expect(screen.getByText('当前版')).toBeVisible();
  expect(screen.getByText('上一版')).toBeVisible();
  expect(screen.getByText(/店铺 shop-a/)).toBeVisible(); expect(screen.getByText(/店铺 shop-b/)).toBeVisible();
  const close = screen.getByRole('button', { name: '关闭回退计划' });
  expect(screen.getByRole('button', { name: '确认回退并发布' }).parentElement).toBe(close.parentElement);
  expect(close.parentElement).toHaveClass('intake-toolbar');
  const confirm = vi.spyOn(window, 'confirm');
  try {
    await user.click(screen.getByRole('button', { name: '确认回退并发布' }));
    expect(apply).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: '回退整个发布目录到上一版' });
    expect(dialog).toHaveTextContent('回退之后不能撤销这次发布。坐席重新查询后会使用上一版内容。要回到现在这一版，需要再发布一次。');
    const cancel = within(dialog).getByRole('button', { name: '取消' });
    expect(within(dialog).getByRole('button', { name: '确认回退' })).toHaveClass('ant-btn-dangerous');
    await waitFor(() => expect(cancel).toHaveFocus());
    await user.click(cancel);
    expect(apply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '确认回退并发布' }));
    await user.click(await screen.findByRole('button', { name: '确认回退' }));
    expect(apply).toHaveBeenLastCalledWith({ action: 'rollback-execute' });
    expect(screen.queryByRole('button', { name: '发起回退复核' })).not.toBeInTheDocument();
  } finally { confirm.mockRestore(); }
});
it('shows historical review timestamps in local time without a zone suffix',()=>{
  render(<IntakeRollback view={view({ impact, hasReview: true, review: {
    state: 'approved', checkedAt: '2026-10-09T06:00:00.000Z', validUntil: '2026-10-09T06:01:00.000Z', instanceCode: 'synthetic-review',
  } })} busy={false} blocked={false} apply={vi.fn()} onDirty={vi.fn()} />);
  const text=screen.getByText(/最近核验：/).textContent ?? '';
  expect(text).toContain(`最近核验：${formatSeatClock('2026-10-09T06:00:00.000Z')}`);
  expect(text).toContain(`有效至：${formatSeatClock('2026-10-09T06:01:00.000Z')}`);
  expect(text).not.toContain('UTC');
  expect(text).not.toContain('2026-10-09T06:00:00.000Z');
});
it('labels a partial preview honestly and connects correction to the existing upload workflow', async () => {
  const apply = vi.fn(), user = userEvent.setup();
  render(<IntakeRollback view={view({ impact: { ...impact, scopes: [], requiresCorrectiveCandidate: true } })} busy={false} blocked={false} apply={apply} onDirty={vi.fn()} />);
  expect(screen.getByRole('heading', { name: '有权查看的影响范围' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '确认回退并发布' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '返回上传纠正稿' }));
  expect(apply).toHaveBeenCalledWith({ action: 'rollback-correct' });
});
it('only offers original-operation recovery while an unknown rollback hides expired materials', async () => {
  const apply = vi.fn(), user = userEvent.setup();
  render(<IntakeRollback view={view({ available: false, pending: { action: 'rollback', recovery: 'receipt' } })} busy={false} blocked={false} apply={apply} onDirty={vi.fn()} />);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '查询原回退回执' })); expect(apply).toHaveBeenLastCalledWith({ action: 'rollback-recover' });
  await user.click(screen.getByRole('button', { name: '重试原回退操作' })); expect(apply).toHaveBeenLastCalledWith({ action: 'rollback-retry' });
});
it('legacy unknown rollback exposes receipt lookup without an unsafe retry action', async () => {
  render(<IntakeRollback view={view({ available: false, pending: { action: 'rollback', recovery: 'receipt', retryAllowed: false } })}
    busy={false} blocked={false} apply={vi.fn()} onDirty={vi.fn()} />);
  expect(screen.getByRole('button', { name: '查询原回退回执' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: '重试原回退操作' })).not.toBeInTheDocument();
});
