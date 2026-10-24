import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { IntakeOverview } from '../../src/renderer/features/dashboard/IntakeOverview';
import { formatShortTime } from '../../src/renderer/features/dashboard/intake-time';
import { v9Headline } from '../../src/renderer/features/dashboard/v9-overview-model';
import type { UsageSourceRow } from '../../src/shared/usage-log-csv';
import type { DashboardIterationTask } from '../../src/shared/dashboard-iteration';
import type { DashboardWordingEntry, DashboardWordingView } from '../../src/shared/dashboard-wording';
import type { DeskItemView, DeskView } from '../../src/shared/desk-knowledge';

if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

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

function insideRecentWeek(hour: number, minute = 0): string {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function localMonthDay(iso: string): string {
  const date = new Date(iso);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day}`;
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

it('names a no-hit cluster in Chinese instead of the machine key', async () => {
  window.dashboardIteration = {
    list: vi.fn(async () => ({
      ok: true as const,
      items: [{
        ...task('open', 'task-douyin'),
        signalId: 'no_hit:none:storewide:douyin',
        clusterKey: 'no_hit:none:storewide:douyin',
        suggestedScriptIds: [],
      }],
      nextCursor: null,
    })),
    start: vi.fn(),
    close: vi.fn(),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  await openTodo();
  expect(await screen.findByText('抖音全店没有命中话术')).toBeInTheDocument();
  expect(screen.queryByText('no_hit:none:storewide:douyin')).not.toBeInTheDocument();
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
  expect(await screen.findByText('话术不准：script-a')).toBeInTheDocument();
  expect(screen.queryByText('task-2')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '开始处理' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '已处理' })).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: /处理说明/ })).not.toBeInTheDocument();
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
  expect(screen.getByRole('region', { name: '无命中' })).toHaveTextContent('坐席问到没有话术的问题后，会出现在这里。');
});

it('names the next step when a block has no source', async () => {
  render(<IntakeOverview onOpen={() => undefined} />);
  expect(screen.getByRole('tabpanel')).toHaveTextContent('坐席查询后，排行会出现在这里。');
  expect(screen.getByText('话术使用次数').parentElement).toHaveTextContent('坐席查询后会出现');
  expect(screen.getByText('无命中次数').parentElement).toHaveTextContent('坐席查询后会出现');
  // The hit rate stays off the overview until its formula is settled (DESIGN.md, Overview).
  expect(screen.queryByText('命中率')).not.toBeInTheDocument();
  expect(screen.getByLabelText('使用趋势')).toHaveTextContent('坐席查询后，趋势会出现在这里。');
  expect(screen.getByLabelText('话术类型占比')).toHaveTextContent('坐席查询后，占比会出现在这里。');
  await openTodo();
  expect(await screen.findByRole('table', { name: '话术迭代' })).toHaveTextContent('请先登录后再查看待办。');
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: '无命中排行' }));
  expect(screen.getByRole('region', { name: '无命中' })).toHaveTextContent('坐席问到没有话术的问题后，会出现在这里。');
  await user.click(screen.getByRole('tab', { name: 'SOP 使用' }));
  const sop = screen.getByRole('tabpanel');
  expect(sop).toHaveTextContent('坐席走完 SOP 后，次数会出现在这里。');
  expect(sop).not.toHaveTextContent('打开次数');
  expect(screen.queryByLabelText('SOP 接口(原型开关)')).not.toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: '话术过期提醒' }));
  expect(screen.getByRole('tabpanel')).toHaveTextContent('登录后可以看即将到期的知识。');
  expect(screen.getByTestId('module-overview')).not.toHaveTextContent('未接入');
});

it('shows a separate 无命中 list and no percentage', async () => {
  window.dashboardIteration = {
    list: vi.fn(async () => ({ ok: true as const, items: [task('open')], nextCursor: null })),
    start: vi.fn(),
    close: vi.fn(),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  await openTodo();
  expect(await screen.findByText('话术不准：script-a')).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('tab', { name: '无命中排行' }));
  const misses = screen.getByRole('region', { name: '无命中' });
  expect(misses).toHaveTextContent('无命中');
  expect(misses).toHaveTextContent('坐席问到没有话术的问题后，会出现在这里。');
  expect(misses).not.toHaveTextContent('话术不准');
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
  expect(iteration).toHaveTextContent('话术不准：script-a');
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
  expect(await screen.findByText('等更新发布后再标已处理。')).toBeInTheDocument();
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
  expect(await screen.findByText('等更新发布后再标已处理。')).toBeInTheDocument();
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
  expect(await screen.findByText('等更新发布后再标已处理。')).toBeInTheDocument();
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
  expect(screen.getByRole('button', { name: '暂不处理' })).toBeDisabled();
  await user.type(screen.getByRole('textbox', { name: '处理说明 话术不准：script-a' }), '先观察');
  expect(screen.getByRole('button', { name: '暂不处理' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: '暂不处理' }));
  expect(close).toHaveBeenCalledWith({
    taskId: 'task-1', expectedVersion: 1, status: 'wont_fix', resolutionNote: '排序问题：先观察',
  });
  expect(command).not.toHaveBeenCalled();
});

it('shows the v9 sample only while preview=intake and keeps SOP unwired', async () => {
  window.history.pushState({}, '', '/?preview=intake');
  render(<IntakeOverview onOpen={() => undefined} />);
  expect(await screen.findAllByText(v9Headline(7).use)).not.toHaveLength(0);
  expect(screen.getByText('运费谁承担')).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: 'SOP 使用' }));
  const sop = screen.getByRole('tabpanel');
  expect(sop).toHaveTextContent('坐席走完 SOP 后，次数会出现在这里。');
  expect(screen.queryByText('打开次数')).not.toBeInTheDocument();
  expect(screen.queryByText('走完率')).not.toBeInTheDocument();
  expect(document.querySelector('.donut-wrap text')).toHaveAttribute('fill', 'currentColor');
});

it('computes overview figures from the usage rows and still leaves SOP unwired', async () => {
  window.history.pushState({}, '', '/?preview=intake');
  const copiedAt = insideRecentWeek(9);
  const viewedAt = insideRecentWeek(10);
  const missAt = insideRecentWeek(11);
  const blankMissAt = insideRecentWeek(12);
  const rows: UsageSourceRow[] = [
    { id: '1', askedAt: copiedAt, agent: '坐席甲', question: '退货多久', scriptTitle: '退货时效', result: 'copied', snapshotStale: false, consented: true },
    { id: '2', askedAt: viewedAt, agent: '坐席甲', question: '尺码', scriptTitle: '尺码怎么选', result: 'viewed', snapshotStale: false },
    { id: '3', askedAt: missAt, agent: '坐席乙', question: '改地址', scriptTitle: null, result: 'miss', snapshotStale: false, consented: false },
    { id: '4', askedAt: blankMissAt, agent: '坐席乙', question: null, scriptTitle: null, result: 'miss', snapshotStale: false },
  ];
  window.dashboardUsageLog = {
    list: vi.fn(async () => ({ ok: true as const, rows, nextCursor: null, canExport: true })),
    previewExport: vi.fn(async () => ({ ok: false as const, code: 'UNAVAILABLE', message: '未接入' })),
    export: vi.fn(async () => ({ ok: false as const, code: 'UNAVAILABLE', message: '未接入' })),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  expect(await screen.findByText('退货时效')).toBeInTheDocument();
  const search = screen.getByRole('textbox', { name: '搜索话术' });
  const rankingUser = userEvent.setup();
  await rankingUser.type(search, '退货 ');
  expect(search).toHaveValue('退货 ');
  expect(screen.getByText('退货时效')).toBeInTheDocument();
  await rankingUser.clear(search);
  expect(screen.getByText('尺码怎么选')).toBeInTheDocument();
  expect(screen.queryByText('运费谁承担')).not.toBeInTheDocument();
  expect(screen.queryByText(v9Headline(7).use)).not.toBeInTheDocument();
  const useTile = screen.getByText('话术使用次数').parentElement;
  expect(useTile).toHaveTextContent('2');
  expect(useTile).not.toHaveTextContent('较上期');
  expect(screen.getByText('无命中次数').parentElement).toHaveTextContent('2');
  expect(screen.queryByText('命中率')).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: '使用趋势图' })).toHaveTextContent(localMonthDay(copiedAt));
  expect(screen.getByLabelText('话术类型占比')).toHaveTextContent('这些记录还分不出话术类型。');
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: '无命中排行' }));
  const misses = screen.getByRole('region', { name: '无命中' });
  expect(misses).toHaveTextContent('改地址');
  expect(misses).toHaveTextContent('已脱敏');
  expect(misses).not.toHaveTextContent('能开发票吗');
  await user.click(screen.getByRole('tab', { name: 'SOP 使用' }));
  expect(screen.getByRole('tabpanel')).toHaveTextContent('坐席走完 SOP 后，次数会出现在这里。');
  expect(screen.queryByText('打开次数')).not.toBeInTheDocument();
});

it('shows a short local time for a live miss instead of the raw timestamp', async () => {
  const askedAt = insideRecentWeek(15, 31);
  window.dashboardUsageLog = {
    list: vi.fn(async () => ({
      ok: true as const,
      rows: [{
        id: 'm1',
        askedAt,
        agent: '坐席甲',
        question: '能改派送时间吗',
        scriptTitle: null,
        result: 'miss' as const,
        snapshotStale: false,
      }],
      nextCursor: null,
      canExport: false,
    })),
    previewExport: vi.fn(),
    export: vi.fn(),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  await userEvent.setup().click(await screen.findByRole('tab', { name: '无命中排行' }));
  const misses = screen.getByRole('region', { name: '无命中' });
  const cell = await within(misses).findByRole('cell', { name: formatShortTime(askedAt) });
  expect(cell).not.toHaveTextContent(askedAt);
  expect(cell).toHaveTextContent(formatShortTime(askedAt));
});

it('keeps 待处理 on one line and uses no native select inside a narrow overview', async () => {
  window.dashboardIteration = {
    list: vi.fn(async () => ({ ok: true as const, items: [task('open')], nextCursor: null })),
    start: vi.fn(),
    close: vi.fn(),
  };
  render(<div style={{ width: 360 }}><IntakeOverview onOpen={() => undefined} /></div>);
  const root = screen.getByTestId('module-overview');
  expect(root.querySelector('select')).toBeNull();
  expect(root.querySelector('details')).toBeNull();
  await openTodo();
  expect(screen.getByText('待处理')).toBeInTheDocument();
  for (const raw of [root.style.minWidth, getComputedStyle(root).minWidth]) {
    if (raw.endsWith('px')) expect(Number.parseFloat(raw)).toBeLessThanOrEqual(360);
  }
  const table = screen.getByRole('table', { name: '话术迭代' });
  expect(within(table).getByRole('columnheader', { name: '状态' })).toHaveStyle({ whiteSpace: 'nowrap' });
  expect(within(table).getByRole('cell', { name: '待处理' })).toHaveStyle({ whiteSpace: 'nowrap' });
  expect(root.querySelector('select')).toBeNull();
  expect(root.querySelector('details')).toBeNull();
});

it('filters the ranking to the dates the operator picks', async () => {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const older = new Date(today);
  older.setDate(older.getDate() - 20);
  const day = (date: Date) => {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const dateNumber = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${dateNumber}`;
  };
  const row = (id: string, askedAt: string, title: string): UsageSourceRow => ({
    id, askedAt, agent: '坐席甲', question: title, scriptTitle: title, result: 'copied', snapshotStale: false, consented: true,
  });
  window.dashboardUsageLog = {
    list: vi.fn(async () => ({
      ok: true as const,
      rows: [row('now', today.toISOString(), '今天的话术'), row('mid', older.toISOString(), '二十天前的话术')],
      nextCursor: null,
      canExport: false,
    })),
    previewExport: vi.fn(),
    export: vi.fn(),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  expect(await screen.findByText('今天的话术')).toBeInTheDocument();
  expect(screen.queryByText('二十天前的话术')).not.toBeInTheDocument();
  const user = userEvent.setup();
  const [start] = screen.getAllByRole('textbox');
  await user.click(start!);
  await user.click(await screen.findByText('近 30 天'));
  expect(await screen.findByText('二十天前的话术')).toBeInTheDocument();
  expect(screen.getByText('今天的话术')).toBeInTheDocument();
  await user.click(start!);
  await user.clear(start!);
  await user.type(start!, day(older));
  const end = screen.getAllByRole('textbox')[1]!;
  await user.clear(end);
  await user.type(end, `${day(older)}{Enter}`);
  expect(await screen.findByText('二十天前的话术')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('今天的话术')).not.toBeInTheDocument());
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
});
