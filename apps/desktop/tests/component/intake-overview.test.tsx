import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IntakeOverview } from '../../src/renderer/features/dashboard/IntakeOverview';
import type { UsageSourceRow } from '../../src/shared/usage-log-csv';
import type { DashboardIterationTask } from '../../src/shared/dashboard-iteration';
import type { DashboardWordingEntry, DashboardWordingView } from '../../src/shared/dashboard-wording';
import type { DeskItemView, DeskView } from '../../src/shared/desk-knowledge';

function task(status: DashboardIterationTask['status'], id = 'task-1'): DashboardIterationTask {
  return {
    taskId: id, signalId: 'inaccuracy:script-a', clusterKey: 'script-a',
    sampleQueryIds: ['q1', 'q2', 'q3'], suspectedCause: 'content_gap', suggestedScriptIds: ['script-a'],
    status, assigneeRole: 'coach', resolution: status === 'resolved' || status === 'wont_fix' ? status : null,
    resolutionNote: null, version: 1,
    createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z', resolvedAt: null,
  };
}

function wording(
  refreshedAt: string | null,
  scriptId = 'script-a',
  lease: { matchesLease?: boolean; effectiveFrom?: string | null } = {},
): DashboardWordingView {
  const entry: DashboardWordingEntry = {
    scriptId, domain: 'product', title: '运费', scene: '运费', answerPreview: '买家承担',
    platform: '千牛', version: 'rel_9', scriptVersion: 2,
    effectiveFrom: lease.effectiveFrom === undefined ? null : lease.effectiveFrom,
    effectiveTo: null,
    effectiveWindow: '当前发布', risk: 'low', lifecycle: 'published', lifecycleLabel: '已发布',
    ownerRole: '当前发布', dataClass: 'current-release',
  };
  return {
    ok: true, releaseId: 'rel_9', total: 1, entries: [entry],
    catalogRefreshedAt: refreshedAt, matchesLease: lease.matchesLease ?? true,
  };
}

function deskItem(id: string, name: string, statusLabel: string): DeskItemView {
  return {
    id, personaId: 'shop', name, category: 'product', customCategory: null,
    fileName: '问答.txt', body: name, parseState: 'ok', validity: 'scheduled',
    validFrom: '2026-10-20T00:00:00.000Z', validUntil: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z', statusLabel, delivered: false,
  };
}

function deskView(items: DeskItemView[]): DeskView {
  return {
    signedIn: true, role: 'operator', displayName: '运营', personas: [], selectedPersonaId: 'shop',
    items, delivered: [], tacit: [], revision: 1, notice: null, persistence: 'ok',
  };
}

async function openTodo() {
  const tab = await screen.findByRole('tab', { name: '迭代待办' });
  if (tab.getAttribute('aria-selected') !== 'true') await userEvent.setup().click(tab);
}

afterEach(() => {
  cleanup();
  delete window.dashboardIteration;
  delete window.dashboardWording;
  delete window.dashboardDesk;
  delete window.dashboardUsageLog;
  window.history.pushState({}, '', '/');
});

it('lists only open iteration tasks and does not invent a rate', async () => {
  window.dashboardIteration = {
    list: vi.fn(async () => ({ ok: true as const, items: [task('open'), { ...task('resolved'), taskId: 'task-2', status: 'resolved' as const, resolution: 'resolved' as const }], nextCursor: null })),
    start: vi.fn(async () => ({ ok: true as const, task: task('in_progress') })),
    close: vi.fn(),
  };
  const onOpen = vi.fn();
  render(<IntakeOverview onOpen={onOpen} />);
  await openTodo();
  expect(await screen.findByText('script-a')).toBeInTheDocument();
  expect(screen.queryByText('task-2')).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: '去知识库' }));
  expect(onOpen).toHaveBeenCalledWith('content');
});

it('shows only 待处理 and 处理中', async () => {
  window.dashboardIteration = {
    list: vi.fn(async () => ({
      ok: true as const,
      items: [task('open', 'task-open'), task('in_progress', 'task-progress'), task('resolved', 'task-done'), task('wont_fix', 'task-skip')],
      nextCursor: null,
    })),
    start: vi.fn(),
    close: vi.fn(),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  await openTodo();
  const table = await screen.findByRole('table', { name: '话术迭代' });
  expect(table).toHaveTextContent('待处理');
  expect(table).toHaveTextContent('处理中');
  expect(screen.getAllByRole('row')).toHaveLength(3);
});

it('says 当前没有待办 when empty', async () => {
  window.dashboardIteration = {
    list: vi.fn(async () => ({ ok: true as const, items: [], nextCursor: null })),
    start: vi.fn(),
    close: vi.fn(),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  await openTodo();
  expect(await screen.findByText('当前没有待办')).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('tab', { name: '无命中排行' }));
  expect(screen.getByRole('region', { name: '无命中' })).toHaveTextContent('暂无记录');
});

it('says 未接入 when unloaded', async () => {
  render(<IntakeOverview onOpen={() => undefined} />);
  await openTodo();
  expect(await screen.findByRole('table', { name: '话术迭代' })).toHaveTextContent('暂无记录');
  expect(screen.getByTestId('overview-usage-status')).toHaveTextContent('使用记录暂时读不出来');
  expect(screen.getAllByTestId('overview-usage-status')).toHaveLength(1);
  expect(screen.getByText('话术使用次数').parentElement).not.toHaveTextContent('使用记录暂时读不出来');
  expect(screen.getByText('无命中次数').parentElement).not.toHaveTextContent('使用记录暂时读不出来');
  expect(screen.getByText('命中率').parentElement).not.toHaveTextContent('使用记录暂时读不出来');
  expect(screen.getByText('待处理迭代').parentElement).toHaveTextContent('0');
  expect(screen.getByLabelText('使用与无命中趋势')).not.toHaveTextContent('使用记录暂时读不出来');
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: '无命中排行' }));
  expect(screen.getByRole('region', { name: '无命中' })).toHaveTextContent('暂无记录');
  await user.click(screen.getByRole('tab', { name: 'SOP 使用' }));
  const sop = document.querySelector('.pn:not([hidden])');
  expect(sop).toHaveTextContent('暂无记录');
  expect(sop).not.toHaveTextContent('打开次数');
  expect(screen.queryByLabelText('SOP 接口(原型开关)')).not.toBeInTheDocument();
});

it('shows a separate 无命中 list and no percentage', async () => {
  window.dashboardIteration = {
    list: vi.fn(async () => ({ ok: true as const, items: [task('open')], nextCursor: null })),
    start: vi.fn(),
    close: vi.fn(),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  await openTodo();
  expect(await screen.findByText('script-a')).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('tab', { name: '无命中排行' }));
  const misses = screen.getByRole('region', { name: '无命中' });
  expect(misses).toHaveTextContent('无命中');
  expect(misses).toHaveTextContent('暂无记录');
  expect(misses).not.toHaveTextContent('script-a');
});

it('knowledge that is not yet effective or already 已失效 shows a separate reminder and does not appear as an 不准 row', async () => {
  window.dashboardIteration = {
    list: vi.fn(async () => ({ ok: true as const, items: [task('open')], nextCursor: null })),
    start: vi.fn(),
    close: vi.fn(),
  };
  window.dashboardDesk = {
    current: vi.fn(async () => ({
      ok: true as const,
      view: deskView([
        deskItem('k-due', '退货运费什么时候到', '待生效'),
        deskItem('k-old', '旧包装说明', '已失效'),
        deskItem('k-live', '生效中的运费', '生效中'),
      ]),
    })),
    command: vi.fn(),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  await userEvent.setup().click(await screen.findByRole('tab', { name: '话术过期提醒' }));
  const reminder = await screen.findByRole('table', { name: '知识有效期提醒' });
  expect(reminder).toHaveTextContent('退货运费什么时候到');
  expect(reminder).toHaveTextContent('待生效');
  expect(reminder).toHaveTextContent('旧包装说明');
  expect(reminder).toHaveTextContent('已失效');
  expect(reminder).not.toHaveTextContent('生效中的运费');
  expect(reminder).not.toHaveTextContent('不准');
  await openTodo();
  const iteration = screen.getByRole('table', { name: '话术迭代' });
  expect(iteration).toHaveTextContent('script-a');
  expect(iteration).not.toHaveTextContent('退货运费什么时候到');
  expect(iteration).not.toHaveTextContent('旧包装说明');
});

async function settleWording(list: ReturnType<typeof vi.fn>) {
  await waitFor(() => expect(list).toHaveBeenCalled());
  await act(async () => {
    await list.mock.results[0]?.value;
  });
}

it('refuses 内容缺口 已处理 until a newer published release and then closes', async () => {
  const close = vi.fn(async () => ({ ok: true as const, task: task('resolved') }));
  window.dashboardIteration = {
    list: vi.fn(async () => ({ ok: true as const, items: [task('in_progress')], nextCursor: null })),
    start: vi.fn(),
    close,
  };
  const older = vi.fn(async () => wording('2026-10-12T00:00:00.000Z'));
  window.dashboardWording = { list: older };
  const user = userEvent.setup();
  const { unmount } = render(<IntakeOverview onOpen={() => undefined} />);
  await openTodo();
  await screen.findByText('处理中');
  await settleWording(older);
  await user.click(screen.getByRole('button', { name: '已处理' }));
  expect(await screen.findByText('内容缺口要等这条话术有更新的已发布版本后才能标已处理。')).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
  unmount();

  const newer = vi.fn(async () => wording('2026-10-14T00:00:00.000Z'));
  window.dashboardWording = { list: newer };
  render(<IntakeOverview onOpen={() => undefined} />);
  await openTodo();
  await screen.findByText('处理中');
  await settleWording(newer);
  await user.click(screen.getByRole('button', { name: '已处理' }));
  expect(close).toHaveBeenCalledWith({
    taskId: 'task-1', expectedVersion: 1, status: 'resolved', resolutionNote: '内容缺口',
  });
});

it('closes 内容缺口 when the announce lease shows that script published after the task', async () => {
  const close = vi.fn(async () => ({ ok: true as const, task: task('resolved') }));
  window.dashboardIteration = {
    list: vi.fn(async () => ({ ok: true as const, items: [task('in_progress')], nextCursor: null })),
    start: vi.fn(),
    close,
  };
  const sameRelease = vi.fn(async () => wording(null, 'script-a', {
    matchesLease: true,
    effectiveFrom: '2026-10-12T00:00:00.000Z',
  }));
  window.dashboardWording = { list: sameRelease };
  const user = userEvent.setup();
  const { unmount } = render(<IntakeOverview onOpen={() => undefined} />);
  await openTodo();
  await screen.findByText('处理中');
  await settleWording(sameRelease);
  await user.click(screen.getByRole('button', { name: '已处理' }));
  expect(await screen.findByText('内容缺口要等这条话术有更新的已发布版本后才能标已处理。')).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
  unmount();

  const newerLease = vi.fn(async () => wording(null, 'script-a', {
    matchesLease: true,
    effectiveFrom: '2026-10-14T00:00:00.000Z',
  }));
  window.dashboardWording = { list: newerLease };
  render(<IntakeOverview onOpen={() => undefined} />);
  await openTodo();
  await screen.findByText('处理中');
  await settleWording(newerLease);
  await user.click(screen.getByRole('button', { name: '已处理' }));
  expect(close).toHaveBeenCalledWith({
    taskId: 'task-1', expectedVersion: 1, status: 'resolved', resolutionNote: '内容缺口',
  });
});

it('does not treat a local catalog without a refresh time as a newer release', async () => {
  const close = vi.fn(async () => ({ ok: true as const, task: task('resolved') }));
  window.dashboardIteration = {
    list: vi.fn(async () => ({ ok: true as const, items: [task('in_progress')], nextCursor: null })),
    start: vi.fn(),
    close,
  };
  const local = vi.fn(async () => wording(null, 'script-a', {
    matchesLease: false,
    effectiveFrom: '2026-10-14T00:00:00.000Z',
  }));
  window.dashboardWording = { list: local };
  const user = userEvent.setup();
  render(<IntakeOverview onOpen={() => undefined} />);
  await openTodo();
  await screen.findByText('处理中');
  await settleWording(local);
  await user.click(screen.getByRole('button', { name: '已处理' }));
  expect(await screen.findByText('内容缺口要等这条话术有更新的已发布版本后才能标已处理。')).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
});

it('defers another cause only with a reason and does not rewrite the script', async () => {
  const close = vi.fn(async () => ({ ok: true as const, task: { ...task('wont_fix'), suspectedCause: 'ranking' as const } }));
  const command = vi.fn();
  window.dashboardIteration = {
    list: vi.fn(async () => ({
      ok: true as const,
      items: [{ ...task('in_progress'), suspectedCause: 'ranking' as const }],
      nextCursor: null,
    })),
    start: vi.fn(),
    close,
  };
  window.dashboardDesk = {
    current: vi.fn(async () => ({ ok: true as const, view: deskView([]) })),
    command,
  };
  const user = userEvent.setup();
  render(<IntakeOverview onOpen={() => undefined} />);
  await openTodo();
  await screen.findByText('处理中');
  await user.click(screen.getByRole('button', { name: '暂不处理' }));
  expect(await screen.findByText('暂不处理需要填写原因。')).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
  await user.type(screen.getByRole('textbox', { name: '处理说明 script-a' }), '先观察');
  await user.click(screen.getByRole('button', { name: '暂不处理' }));
  expect(close).toHaveBeenCalledWith({
    taskId: 'task-1', expectedVersion: 1, status: 'wont_fix', resolutionNote: '排序问题：先观察',
  });
  expect(command).not.toHaveBeenCalled();
});

it('does not draw a sample trend on the intake preview', async () => {
  window.history.pushState({}, '', '/?preview=intake');
  render(<IntakeOverview onOpen={() => undefined} />);
  expect(screen.queryByText('运费谁承担')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('话术类型占比')).not.toBeInTheDocument();
  expect(screen.queryByTestId('usage-trend')).not.toBeInTheDocument();
  const overview = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/features/dashboard/IntakeOverview.tsx'), 'utf8');
  expect(overview).not.toContain('v9Trend');
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: 'SOP 使用' }));
  const sop = document.querySelector('.pn:not([hidden])');
  expect(sop).toHaveTextContent('暂无记录');
  expect(screen.queryByText('打开次数')).not.toBeInTheDocument();
  expect(screen.queryByText('走完率')).not.toBeInTheDocument();
});

it('draws one empty frame when the signed-in list has no rows', async () => {
  window.dashboardUsageLog = {
    list: vi.fn(async () => ({ ok: true as const, rows: [], nextCursor: null, canExport: false })),
    previewExport: vi.fn(async () => ({ ok: true as const, exportable: 0, redacted: 0, withoutConsent: 0 })),
    export: vi.fn(async () => ({ ok: true as const, written: 0 })),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  const frame = await screen.findByTestId('usage-trend-empty');
  expect(frame.querySelector('path')).toBeNull();
  expect(frame.querySelector('polyline')).toBeNull();
  expect(screen.getAllByText('暂无使用记录').length).toBeGreaterThan(0);
  expect(screen.queryByTestId('usage-trend')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('话术类型占比')).not.toBeInTheDocument();
});

it('asks a signed-out seat to log in and does not call the read a failure', async () => {
  window.dashboardUsageLog = {
    list: vi.fn(async () => ({ ok: false as const, code: 'UNAUTHORIZED', message: '请先登录' })),
    previewExport: vi.fn(async () => ({ ok: false as const, code: 'UNAUTHORIZED', message: '请先登录' })),
    export: vi.fn(async () => ({ ok: false as const, code: 'UNAUTHORIZED', message: '请先登录' })),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  const status = await screen.findByTestId('overview-usage-status');
  expect(status).toHaveTextContent('请先登录');
  expect(status).not.toHaveTextContent('使用记录暂时读不出来');
  expect(status).not.toHaveTextContent('使用记录还不能在这里看');
  expect(screen.getByText('话术使用次数').parentElement).toHaveTextContent('—');
});

it('computes overview figures from the usage rows and still leaves SOP unwired', async () => {
  window.history.pushState({}, '', '/?preview=intake');
  const rows: UsageSourceRow[] = [
    { id: '1', askedAt: '2026-10-13T01:00:00.000Z', agent: '坐席甲', question: '退货多久', scriptTitle: '退货时效', result: 'copied', snapshotStale: false, consented: true },
    { id: '2', askedAt: '2026-10-13T02:00:00.000Z', agent: '坐席甲', question: '尺码', scriptTitle: '尺码怎么选', result: 'viewed', snapshotStale: false },
    { id: '3', askedAt: '2026-10-13T03:00:00.000Z', agent: '坐席乙', question: '改地址', scriptTitle: null, result: 'miss', snapshotStale: false, consented: false },
    { id: '4', askedAt: '2026-10-13T04:00:00.000Z', agent: '坐席乙', question: null, scriptTitle: null, result: 'miss', snapshotStale: false },
  ];
  window.dashboardUsageLog = {
    list: vi.fn(async () => ({ ok: true as const, rows, nextCursor: null, canExport: true })),
    previewExport: vi.fn(async () => ({ ok: false as const, code: 'UNAVAILABLE', message: '请稍后再试。' })),
    export: vi.fn(async () => ({ ok: false as const, code: 'UNAVAILABLE', message: '请稍后再试。' })),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  expect(await screen.findByText('退货时效')).toBeInTheDocument();
  expect(screen.getByText('尺码怎么选')).toBeInTheDocument();
  expect(screen.queryByText('运费谁承担')).not.toBeInTheDocument();
  const useTile = screen.getByText('话术使用次数').parentElement;
  expect(useTile).toHaveTextContent('2');
  expect(useTile).not.toHaveTextContent('较上期');
  expect(screen.getByText('无命中次数').parentElement).toHaveTextContent('2');
  expect(screen.getByText('命中率').parentElement).toHaveTextContent('50.0%');
  const trend = screen.getByTestId('usage-trend');
  expect(trend.innerHTML).toContain('10-13');
  expect(trend.querySelectorAll('path').length).toBeGreaterThan(0);
  expect(screen.queryByLabelText('话术类型占比')).not.toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: '无命中排行' }));
  const misses = screen.getByRole('region', { name: '无命中' });
  expect(misses).toHaveTextContent('改地址');
  expect(misses).toHaveTextContent('已脱敏');
  expect(misses).not.toHaveTextContent('能开发票吗');
  await user.click(screen.getByRole('tab', { name: 'SOP 使用' }));
  expect(document.querySelector('.pn:not([hidden])')).toHaveTextContent('暂无记录');
  expect(screen.queryByText('打开次数')).not.toBeInTheDocument();
});
