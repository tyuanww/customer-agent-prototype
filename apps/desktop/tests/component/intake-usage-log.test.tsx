import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { IntakeUsageLog } from '../../src/renderer/features/dashboard/IntakeUsageLog';
import { formatShortTime } from '../../src/renderer/features/dashboard/intake-time';
import type { DashboardUsageLogApi, UsageLogRow } from '../../src/shared/dashboard-usage-log';

afterEach(() => { cleanup(); delete window.dashboardUsageLog; });

const rows: UsageLogRow[] = [
  { id: 'a', askedAt: '2026-10-13T07:42:00Z', agent: '甲', question: '孕妇能用吗', scriptTitle: '产品材质', result: 'copied', snapshotStale: false },
  { id: 'b', askedAt: '2026-10-13T07:40:00Z', agent: '乙', question: null, scriptTitle: '运费谁承担', result: 'viewed', snapshotStale: true },
  { id: 'c', askedAt: '2026-10-13T07:31:00Z', agent: '甲', question: '能开发票吗', scriptTitle: null, result: 'miss', snapshotStale: false },
];
function install(overrides: Partial<DashboardUsageLogApi> = {}) {
  const api: DashboardUsageLogApi = {
    list: vi.fn(async () => ({ ok: true as const, rows, nextCursor: null, canExport: true })),
    previewExport: vi.fn(async () => ({ ok: true as const, exportable: 2, redacted: 1, withoutConsent: 0 })),
    export: vi.fn(async () => ({ ok: true as const, written: 2 })),
    ...overrides,
  };
  window.dashboardUsageLog = api;
  return api;
}

it('states that usage is not mounted and draws no table when the interface is absent', () => {
  render(<IntakeUsageLog />);
  expect(screen.getByText('使用记录还不能在这里看。')).toBeVisible();
  expect(screen.queryByText('使用记录暂时读不出来。请稍后再试。')).toBeNull();
  expect(screen.queryByText('暂无使用记录')).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
});

it('states that usage is not mounted when the source replies UNAVAILABLE and draws no table', async () => {
  install({ list: vi.fn(async () => ({ ok: false as const, code: 'UNAVAILABLE', message: '使用记录还不能在这里看。' })) });
  render(<IntakeUsageLog />);
  expect(await screen.findByText('使用记录还不能在这里看。')).toBeVisible();
  expect(screen.queryByText('使用记录暂时读不出来。请稍后再试。')).toBeNull();
  expect(screen.queryByText('暂无使用记录')).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
});

it('says 暂无使用记录 when the log is empty', async () => {
  install({ list: vi.fn(async () => ({ ok: true as const, rows: [], nextCursor: null, canExport: false })) });
  render(<IntakeUsageLog />);
  expect(await screen.findByText('暂无使用记录')).toBeVisible();
  expect(screen.queryByText('使用记录暂时读不出来。请稍后再试。')).toBeNull();
});

it('moves keyboard focus across the filter, search and export controls', async () => {
  install();
  const user = userEvent.setup();
  render(<IntakeUsageLog />);
  const filter = await screen.findByRole('button', { name: '全部' });
  const search = screen.getByRole('textbox', { name: '搜索问题或坐席' });
  const exportButton = await screen.findByRole('button', { name: '导出训练样本' });
  filter.focus();
  expect(filter).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: '已复制' })).toHaveFocus();
  search.focus();
  expect(search).toHaveFocus();
  exportButton.focus();
  expect(exportButton).toHaveFocus();
});

it('renders redacted questions, stale snapshots, misses and result labels', async () => {
  install();
  render(<IntakeUsageLog />);
  expect(await screen.findByText('孕妇能用吗')).toBeVisible();
  expect(screen.getByText('已脱敏')).toBeVisible();
  expect(screen.getByText('旧快照')).toBeVisible();
  const table = within(screen.getByRole('table', { name: '使用情况' }));
  expect(table.getByText('已复制')).toBeVisible();
  expect(table.getByText('仅查看')).toBeVisible();
  expect(table.getByText('未命中')).toBeVisible();
  expect(screen.getByText(/不知道最后是否发送/)).toBeVisible();
});

it('sends the chosen result filter to the interface', async () => {
  const api = install();
  render(<IntakeUsageLog />);
  await screen.findByText('孕妇能用吗');
  await userEvent.click(screen.getByRole('button', { name: '未命中' }));
  await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ result: 'miss', query: '', cursor: null }));
});

it('shows a retry button when reading fails and recovers on retry', async () => {
  const list = vi.fn()
    .mockRejectedValueOnce(new Error('down'))
    .mockResolvedValue({ ok: true as const, rows, nextCursor: null, canExport: false });
  install({ list });
  render(<IntakeUsageLog />);
  const retry = await screen.findByRole('button', { name: '重试' });
  await userEvent.click(retry);
  expect(await screen.findByText('孕妇能用吗')).toBeVisible();
  expect(screen.queryByRole('button', { name: '导出训练样本' })).toBeNull();
});

it('asks for confirmation with the excluded counts before exporting', async () => {
  const api = install();
  render(<IntakeUsageLog />);
  await userEvent.click(await screen.findByRole('button', { name: '导出训练样本' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('将导出 2 条');
  expect(dialog).toHaveTextContent('已脱敏的 1 条');
  expect(api.export).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '导出 CSV' }));
  await waitFor(() => expect(api.export).toHaveBeenCalledOnce());
  expect(await screen.findByText('已导出 2 条。')).toBeVisible();
});

it('formats the short time and tolerates bad input', () => {
  expect(formatShortTime(null)).toBe('—');
  expect(formatShortTime('nope')).toBe('—');
  expect(formatShortTime('2026-10-13T07:42:00Z')).toMatch(/^\d\d-\d\d \d\d:\d\d$/);
});
