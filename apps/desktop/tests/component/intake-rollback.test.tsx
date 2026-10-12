import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { IntakeRollback } from '../../src/renderer/features/dashboard/IntakeRollback';
import type { IntakeManagementView } from '../../src/shared/content-intake-management';
function view(overrides: Partial<IntakeManagementView['rollback']> = {}): Pick<IntakeManagementView, 'rollback' | 'candidates'> {
  return { candidates: [], rollback: { available: true, impact: null, review: null, pending: null, result: null, hasReview: false, canExecute: false, ...overrides } };
}
const impact = { baseReleaseId: 'rel_2', targetReleaseId: 'rel_1', requiresCorrectiveCandidate: false, scopes: [
  { tenantId: 'tenant-a', appId: 'app-a', brandId: 'brand-a', shopId: 'shop-a', sourceId: 'source-a', domain: 'product' as const },
  { tenantId: 'tenant-a', appId: 'app-a', brandId: 'brand-a', shopId: 'shop-b', sourceId: 'source-b', domain: 'product' as const },
] };
it('requires explicit versions, displays every authorized impact and delegates dangerous confirmation to Main', async () => {
  const apply = vi.fn(), onDirty = vi.fn(), user = userEvent.setup();
  const rendered = render(<IntakeRollback view={view()} busy={false} blocked={false} apply={apply} onDirty={onDirty} />);
  expect(screen.getByText(/当前只支持回退到上一发布版本/)).toBeVisible();
  expect(screen.getByRole('button', { name: '查看回退影响' })).toBeDisabled();
  await user.type(screen.getByRole('combobox', { name: '当前发布版本' }), 'rel_2');
  await user.type(screen.getByRole('combobox', { name: '目标历史版本' }), 'rel_1');
  await user.click(screen.getByRole('button', { name: '查看回退影响' }));
  expect(apply).toHaveBeenLastCalledWith({ action: 'rollback-preview', baseReleaseId: 'rel_2', targetReleaseId: 'rel_1' });
  rendered.rerender(<IntakeRollback view={view({ impact, canExecute: true })} busy={false} blocked={false} apply={apply} onDirty={onDirty} />);
  expect(screen.getByText(/店铺 shop-a/)).toBeVisible(); expect(screen.getByText(/店铺 shop-b/)).toBeVisible();
  const close = screen.getByRole('button', { name: '关闭回退计划' });
  expect(screen.getByRole('button', { name: '确认回退并发布' }).parentElement).toBe(close.parentElement);
  expect(close.parentElement).toHaveClass('intake-toolbar');
  const confirm = vi.spyOn(window, 'confirm');
  try {
    await user.click(screen.getByRole('button', { name: '确认回退并发布' }));
    expect(apply).toHaveBeenLastCalledWith({ action: 'rollback-execute' }); expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '发起回退复核' })).not.toBeInTheDocument();
  } finally { confirm.mockRestore(); }
});
it('shows historical review timestamps in local time with an explicit UTC offset',()=>{
  render(<IntakeRollback view={view({ impact, hasReview: true, review: {
    state: 'approved', checkedAt: '2026-10-09T06:00:00.000Z', validUntil: '2026-10-09T06:01:00.000Z', instanceCode: 'synthetic-review',
  } })} busy={false} blocked={false} apply={vi.fn()} onDirty={vi.fn()} />);
  const text=screen.getByText(/最近核验：/).textContent ?? '';
  expect(text).toMatch(/最近核验：.*（UTC[+-]\d{2}:\d{2}） · 有效至：.*（UTC[+-]\d{2}:\d{2}）/);
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
