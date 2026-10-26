import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { IntakeOverview } from '../../src/renderer/features/dashboard/IntakeOverview';
import { formatShortTime } from '../../src/renderer/features/dashboard/intake-time';
import { v9Headline } from '../fixtures/v9-overview-model';
import type { UsageSourceRow } from '../../src/shared/usage-log-csv';
import type { DashboardIterationTask } from '../../src/shared/dashboard-iteration';
import type { DashboardWordingEntry, DashboardWordingView } from '../../src/shared/dashboard-wording';
import type { DeskItemView, DeskView } from '../../src/shared/desk-knowledge';
import { WORKBENCH_EMPTY } from '../../src/shared/workbench-empty';

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

function deskView(items: DeskItemView[]): DeskView {
  return {
    signedIn: true, role: 'operator', displayName: '运营', personas: [], selectedPersonaId: 'shop',
    items, delivered: [], tacit: [], revision: 1, notice: null, persistence: 'ok',
  };
}

function tileText(label: string): string {
  return (screen.getByText(label).parentElement?.textContent ?? '').replace(/\s+/g, '');
}

async function openTodo() {
  await screen.findByRole('region', { name: '待办' });
}

afterEach(() => {
  cleanup();
  delete window.dashboardIteration;
  delete window.dashboardWording;
  delete window.dashboardDesk;
  delete window.dashboardUsageLog;
  delete window.dashboardOps;
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
  expect(tileText('不准次数')).toBe('不准次数3只含已开待办记下的样本，不是这段时间的全部。');
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
  expect(within(table).getAllByRole('row')).toHaveLength(3);
});

it('says 现在没有待办 when the loaded task list has nothing open', async () => {
  window.dashboardIteration = {
    list: vi.fn(async () => ({ ok: true as const, items: [], nextCursor: null })),
    start: vi.fn(),
    close: vi.fn(),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  expect(await screen.findByText('现在没有待办。')).toBeInTheDocument();
  expect(screen.getByText('当前没有达到开单阈值的不准稿。')).toBeInTheDocument();
  expect(tileText('不准次数')).toBe('不准次数0只含已开待办记下的样本，不是这段时间的全部。');
  expect(screen.getByTestId('overview-usage-status')).toHaveTextContent('坐席查询后会出现');
  expect(tileText('查询次数')).toBe('查询次数');
  expect(tileText('被复制')).toBe('被复制只表示复制了');
  expect(screen.getByRole('region', { name: '没查到的问题' })).toHaveTextContent('坐席查询后会出现');
  expect(screen.queryByText('这段时间所有查询都有结果。')).not.toBeInTheDocument();
  expect(screen.queryByText('命中率')).not.toBeInTheDocument();
  expect(screen.queryByText('较上期')).not.toBeInTheDocument();
});

it('names the next step when a block has no source', () => {
  render(<IntakeOverview onOpen={() => undefined} />);
  expect(screen.getByRole('region', { name: '待办' })).toHaveTextContent('请先登录。');
  expect(screen.getByRole('region', { name: '不准的话术' })).toHaveTextContent('请先登录。');
  expect(screen.getByTestId('overview-usage-status')).toHaveTextContent('坐席查询后会出现');
  expect(screen.getByRole('region', { name: '没查到的问题' })).toHaveTextContent('坐席查询后会出现');
  expect(tileText('查询次数')).toBe('查询次数');
  expect(tileText('没查到')).toBe('没查到');
  expect(tileText('被复制')).toBe('被复制只表示复制了');
  expect(tileText('不准次数')).toBe('不准次数');
  expect(screen.queryByText('命中率')).not.toBeInTheDocument();
  expect(screen.queryByText('较上期')).not.toBeInTheDocument();
  expect(screen.queryByText('话术使用次数')).not.toBeInTheDocument();
  expect(screen.queryByText('使用趋势')).not.toBeInTheDocument();
  expect(screen.queryByText('话术类型占比')).not.toBeInTheDocument();
  expect(screen.queryByText('现在没有待办。')).not.toBeInTheDocument();
  expect(screen.queryByText('这段时间没有人报告话术不准。')).not.toBeInTheDocument();
  expect(screen.getByTestId('module-overview')).not.toHaveTextContent('未接入');
});

it('shows a separate 无命中 list and no percentage', async () => {
  window.dashboardIteration = {
    list: vi.fn(async () => ({ ok: true as const, items: [task('open')], nextCursor: null })),
    start: vi.fn(),
    close: vi.fn(),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  expect(await screen.findByText('话术不准：script-a')).toBeInTheDocument();
  const misses = screen.getByRole('region', { name: '没查到的问题' });
  expect(misses).toHaveTextContent('坐席查询后会出现');
  expect(misses).not.toHaveTextContent('话术不准');
});

it('does not turn knowledge reminders into 不准 rows', async () => {
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
  const iteration = await screen.findByRole('table', { name: '话术迭代' });
  expect(iteration).toHaveTextContent('话术不准：script-a');
  expect(iteration).not.toHaveTextContent('退货运费什么时候到');
  expect(iteration).not.toHaveTextContent('旧包装说明');
  expect(screen.queryByRole('table', { name: '知识有效期提醒' })).not.toBeInTheDocument();
  expect(screen.queryByText('退货运费什么时候到')).not.toBeInTheDocument();
  expect(screen.queryByText('旧包装说明')).not.toBeInTheDocument();
  expect(screen.queryByText('生效中的运费')).not.toBeInTheDocument();
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

it('does not fill the counts with the v9 sample when preview=intake', () => {
  window.history.pushState({}, '', '/?preview=intake');
  render(<IntakeOverview onOpen={() => undefined} />);
  expect(screen.getByTestId('overview-usage-status')).toHaveTextContent('坐席查询后会出现');
  expect(screen.queryByText(v9Headline(7).use)).not.toBeInTheDocument();
  expect(screen.queryByText('运费谁承担')).not.toBeInTheDocument();
  expect(screen.queryByText('话术使用次数')).not.toBeInTheDocument();
  expect(screen.queryByText('使用趋势')).not.toBeInTheDocument();
  expect(screen.queryByText('话术类型占比')).not.toBeInTheDocument();
  expect(screen.queryByText('命中率')).not.toBeInTheDocument();
  expect(screen.queryByText('较上期')).not.toBeInTheDocument();
  expect(document.querySelector('.donut-wrap')).toBeNull();
  expect(tileText('查询次数')).toBe('查询次数');
  expect(tileText('没查到')).toBe('没查到');
});

it('computes overview figures from the usage rows', async () => {
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
  await waitFor(() => expect(tileText('查询次数')).toBe('查询次数4'));
  expect(tileText('没查到')).toBe('没查到2');
  expect(tileText('被复制')).toBe('被复制1只表示复制了');
  expect(tileText('不准次数')).toBe('不准次数');
  expect(screen.queryByText('运费谁承担')).not.toBeInTheDocument();
  expect(screen.queryByText(v9Headline(7).use)).not.toBeInTheDocument();
  expect(screen.queryByText('退货时效')).not.toBeInTheDocument();
  expect(screen.queryByText('尺码怎么选')).not.toBeInTheDocument();
  expect(screen.queryByText('命中率')).not.toBeInTheDocument();
  expect(screen.queryByText('较上期')).not.toBeInTheDocument();
  expect(screen.queryByText('话术使用次数')).not.toBeInTheDocument();
  expect(screen.queryByText('使用趋势')).not.toBeInTheDocument();
  expect(screen.queryByText('话术类型占比')).not.toBeInTheDocument();
  const misses = screen.getByRole('region', { name: '没查到的问题' });
  expect(misses).toHaveTextContent('改地址');
  expect(misses).toHaveTextContent('已脱敏');
  expect(misses).not.toHaveTextContent('能开发票吗');
  expect(screen.queryByText('打开次数')).not.toBeInTheDocument();
  expect(screen.queryByText('走完率')).not.toBeInTheDocument();
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
  const misses = screen.getByRole('region', { name: '没查到的问题' });
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
  expect(await screen.findByText('待处理')).toBeInTheDocument();
  for (const raw of [root.style.minWidth, getComputedStyle(root).minWidth]) {
    if (raw.endsWith('px')) expect(Number.parseFloat(raw)).toBeLessThanOrEqual(360);
  }
  const table = screen.getByRole('table', { name: '话术迭代' });
  expect(within(table).getByRole('columnheader', { name: '状态' })).toHaveStyle({ whiteSpace: 'nowrap' });
  expect(within(table).getByRole('cell', { name: '待处理' })).toHaveStyle({ whiteSpace: 'nowrap' });
  expect(root.querySelector('select')).toBeNull();
  expect(root.querySelector('details')).toBeNull();
});

it('counts usage rows inside the dates the operator picks', async () => {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const older = new Date(today);
  older.setDate(older.getDate() - 20);
  const day = (date: Date) => {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const dateNumber = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${dateNumber}`;
  };
  const row = (id: string, askedAt: string, question: string, result: UsageSourceRow['result']): UsageSourceRow => ({
    id,
    askedAt,
    agent: '坐席甲',
    question,
    scriptTitle: result === 'miss' ? null : question,
    result,
    snapshotStale: false,
    consented: true,
  });
  window.dashboardUsageLog = {
    list: vi.fn(async () => ({
      ok: true as const,
      rows: [
        row('now', today.toISOString(), '今天的话术', 'copied'),
        row('mid', older.toISOString(), '二十天前的话术', 'miss'),
      ],
      nextCursor: null,
      canExport: false,
    })),
    previewExport: vi.fn(),
    export: vi.fn(),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  await waitFor(() => expect(tileText('查询次数')).toBe('查询次数1'));
  expect(tileText('被复制')).toBe('被复制1只表示复制了');
  expect(tileText('没查到')).toBe('没查到0');
  expect(screen.getByRole('region', { name: '没查到的问题' })).toHaveTextContent('这段时间所有查询都有结果。');
  expect(screen.queryByText('二十天前的话术')).not.toBeInTheDocument();
  expect(screen.queryByText('今天的话术')).not.toBeInTheDocument();
  const user = userEvent.setup();
  const [start] = screen.getAllByRole('textbox');
  await user.click(start!);
  await user.click(await screen.findByText('近 30 天'));
  await waitFor(() => expect(tileText('查询次数')).toBe('查询次数2'));
  expect(tileText('被复制')).toBe('被复制1只表示复制了');
  expect(tileText('没查到')).toBe('没查到1');
  expect(screen.getByRole('region', { name: '没查到的问题' })).toHaveTextContent('二十天前的话术');
  expect(screen.queryByText('这段时间所有查询都有结果。')).not.toBeInTheDocument();
  expect(screen.queryByText('今天的话术')).not.toBeInTheDocument();
  await user.click(start!);
  await user.clear(start!);
  await user.type(start!, day(older));
  const end = screen.getAllByRole('textbox')[1]!;
  await user.clear(end);
  await user.type(end, `${day(older)}{Enter}`);
  await waitFor(() => expect(tileText('被复制')).toBe('被复制0只表示复制了'));
  expect(tileText('查询次数')).toBe('查询次数1');
  expect(tileText('没查到')).toBe('没查到1');
  expect(screen.getByText('二十天前的话术')).toBeInTheDocument();
  expect(screen.queryByText('今天的话术')).not.toBeInTheDocument();
});

it('asks a signed-out seat to log in and does not call the read a failure', async () => {
  window.dashboardUsageLog = {
    list: vi.fn(async () => ({ ok: false as const, code: 'UNAUTHORIZED', message: '请先登录' })),
    previewExport: vi.fn(async () => ({ ok: false as const, code: 'UNAUTHORIZED', message: '请先登录' })),
    export: vi.fn(async () => ({ ok: false as const, code: 'UNAUTHORIZED', message: '请先登录' })),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  const status = await screen.findByTestId('overview-usage-status');
  expect(status).toHaveTextContent('请先登录。');
  expect(status).not.toHaveTextContent('使用记录暂时读不出来');
  expect(status).not.toHaveTextContent('使用记录还不能在这里看');
  expect(status).not.toHaveTextContent('没读到');
  expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  expect(tileText('查询次数')).toBe('查询次数');
  expect(tileText('没查到')).toBe('没查到');
  expect(tileText('被复制')).toBe('被复制只表示复制了');
  expect(screen.queryByText('话术使用次数')).not.toBeInTheDocument();
});

it('says 坐席查询后会出现 when usage is not mounted', async () => {
  window.dashboardUsageLog = {
    list: vi.fn(async () => ({ ok: false as const, code: 'UNAVAILABLE', message: WORKBENCH_EMPTY.usageUnmounted })),
    previewExport: vi.fn(),
    export: vi.fn(),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  const status = await screen.findByTestId('overview-usage-status');
  expect(status).toHaveTextContent('坐席查询后会出现');
  expect(status).not.toHaveTextContent('没读到');
  expect(status).not.toHaveTextContent('请先登录');
  expect(within(status).queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: '没查到的问题' })).toHaveTextContent('坐席查询后会出现');
  expect(screen.queryByText('这段时间所有查询都有结果。')).not.toBeInTheDocument();
  expect(screen.queryByText(WORKBENCH_EMPTY.usageUnmounted)).not.toBeInTheDocument();
  expect(tileText('查询次数')).toBe('查询次数');
});

it('says 没读到 when a mounted usage read fails for another reason', async () => {
  window.dashboardUsageLog = {
    list: vi.fn(async () => ({ ok: false as const, code: 'UNAVAILABLE', message: '服务暂不可用' })),
    previewExport: vi.fn(),
    export: vi.fn(),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  const status = await screen.findByTestId('overview-usage-status');
  expect(status).toHaveTextContent('没读到。');
  expect(within(status).getByRole('button', { name: '重试' })).toBeInTheDocument();
  expect(status).not.toHaveTextContent('坐席查询后会出现');
  expect(status).not.toHaveTextContent('请先登录');
  expect(tileText('查询次数')).toBe('查询次数');
});

const SHOP_RATE_SCOPE = '命中率、无命中率和不准反馈率是全店这段时间的查询，不是当前登录者的使用记录。';

it('shows an empty shop window as 没有查询 and keeps the personal counts at 0', async () => {
  window.dashboardIteration = {
    list: vi.fn(async () => ({ ok: true as const, items: [], nextCursor: null })),
    start: vi.fn(),
    close: vi.fn(),
  };
  window.dashboardUsageLog = {
    list: vi.fn(async () => ({ ok: true as const, rows: [], nextCursor: null, canExport: false })),
    previewExport: vi.fn(async () => ({ ok: true as const, exportable: 0, redacted: 0, withoutConsent: 0 })),
    export: vi.fn(async () => ({ ok: true as const, written: 0 })),
  };
  window.dashboardOps = {
    questionRates: vi.fn(async () => ({
      ok: true as const,
      queryCount: 0,
      hitCount: 0,
      noHitCount: 0,
      otherCount: 0,
      inaccuracyCount: 0,
      hitRate: null,
      noHitRate: null,
      inaccuracyRate: null,
    })),
  } as unknown as Window['dashboardOps'];
  render(<IntakeOverview onOpen={() => undefined} />);
  expect(await screen.findAllByText('没有查询')).toHaveLength(3);
  expect(tileText('命中率')).toBe('命中率没有查询');
  expect(tileText('无命中率')).toBe('无命中率没有查询');
  expect(tileText('不准反馈率')).toBe('不准反馈率没有查询');
  expect(screen.getByText(SHOP_RATE_SCOPE)).toBeInTheDocument();
  expect(tileText('查询次数')).toBe('查询次数0');
});

it('rounds 23 of 80 queries so the two rates sum to 100', async () => {
  window.dashboardOps = {
    questionRates: vi.fn(async () => ({
      ok: true as const,
      queryCount: 80,
      hitCount: 23,
      noHitCount: 57,
      otherCount: 0,
      inaccuracyCount: 87,
      hitRate: '0.2875',
      noHitRate: '0.7125',
      inaccuracyRate: '1.0875',
    })),
  } as unknown as Window['dashboardOps'];
  render(<IntakeOverview onOpen={() => undefined} />);
  expect(await screen.findByText('28.7%')).toBeInTheDocument();
  expect(screen.getByText('71.3%')).toBeInTheDocument();
  expect(screen.getByText('108.8%')).toBeInTheDocument();
  expect(screen.getByText('报告数除以查询数，可以超过 100%。')).toBeInTheDocument();
  expect(screen.queryByText('28.8%')).not.toBeInTheDocument();
});

// Value: protects=when hit plus no-hit is not the query count, 0.2875 displays 28.8% and the other-count note; fails_when=the UI always allocates tenths from counts or truncates the rate text; why_new=the 23 and 57 of 80 test covers only a complete pair and forbids 28.8%; seam=none; no_claim=mocked questionRates payload, not the HTTP API
it('rounds an incomplete pair from the decimal text instead of the 100 percent split', async () => {
  window.dashboardOps = {
    questionRates: vi.fn(async () => ({
      ok: true as const,
      queryCount: 100,
      hitCount: 23,
      noHitCount: 57,
      otherCount: 20,
      inaccuracyCount: 0,
      hitRate: '0.2875',
      noHitRate: '0.7125',
      inaccuracyRate: '0.1',
    })),
  } as unknown as Window['dashboardOps'];
  render(<IntakeOverview onOpen={() => undefined} />);
  expect(await screen.findByText('28.8%')).toBeInTheDocument();
  expect(screen.getByText('71.3%')).toBeInTheDocument();
  expect(screen.getByText('10.0%')).toBeInTheDocument();
  expect(screen.getByText(/另有未归入命中或无命中的查询/)).toBeInTheDocument();
  expect(screen.queryByText('23.0%')).not.toBeInTheDocument();
  expect(screen.queryByText('28.7%')).not.toBeInTheDocument();
  expect(screen.queryByText('报告数除以查询数，可以超过 100%。')).not.toBeInTheDocument();
});

// Value: protects=in-flight shop rates show 正在读取全店比率 and a new window hides the previous percentages; fails_when=loading is omitted or ready tiles render for a mismatched window; why_new=both shop-rate tests resolve a single window before the assertion; seam=none; no_claim=mocked questionRates; the 近 30 天 preset stands in for a slow response
it('shows a loading row and hides the previous rates when the window changes', async () => {
  const shown = {
    ok: true as const,
    queryCount: 80,
    hitCount: 23,
    noHitCount: 57,
    otherCount: 0,
    inaccuracyCount: 0,
    hitRate: '0.2875',
    noHitRate: '0.7125',
    inaccuracyRate: '0',
  };
  let releaseFirst: (value: typeof shown) => void = () => undefined;
  const first = new Promise<typeof shown>((resolve) => { releaseFirst = resolve; });
  const questionRates = vi.fn()
    .mockImplementationOnce(() => first)
    .mockImplementationOnce(() => new Promise(() => undefined));
  window.dashboardOps = { questionRates } as unknown as Window['dashboardOps'];
  render(<IntakeOverview onOpen={() => undefined} />);
  expect(await screen.findByRole('status', { name: '正在读取全店比率' })).toBeInTheDocument();
  expect(screen.queryByText('28.7%')).not.toBeInTheDocument();
  await act(async () => { releaseFirst(shown); });
  expect(await screen.findByText('28.7%')).toBeInTheDocument();
  const user = userEvent.setup({ delay: null });
  await user.click(screen.getByPlaceholderText('开始日期'));
  await user.click(await screen.findByText('近 30 天'));
  expect(screen.queryByText('28.7%')).not.toBeInTheDocument();
  expect(await screen.findByRole('status', { name: '正在读取全店比率' })).toBeInTheDocument();
  expect(questionRates).toHaveBeenCalledTimes(2);
  expect(questionRates.mock.calls[1]?.[0]).not.toBe(questionRates.mock.calls[0]?.[0]);
});

// Value: protects=a 366-day inclusive range is kept and a longer range is clamped to that end of day; fails_when=the picker submits an end past start plus 365 days or shortens the exact inclusive range; why_new=no overview test changes the range picker off the default week; seam=none; no_claim=jsdom RangePicker, not the packaged Electron calendar
it('keeps 366 inclusive days and clamps a longer shop window', async () => {
  const startOf = (year: number, month: number, day: number) => new Date(year, month, day, 0, 0, 0, 0).toISOString();
  const endOf = (year: number, month: number, day: number) => new Date(year, month, day, 23, 59, 59, 999).toISOString();
  async function pick(endText: string): Promise<readonly [string, string]> {
    cleanup();
    const questionRates = vi.fn(async (_start: string, _end: string) => ({
      ok: true as const,
      queryCount: 0,
      hitCount: 0,
      noHitCount: 0,
      otherCount: 0,
      inaccuracyCount: 0,
      hitRate: null,
      noHitRate: null,
      inaccuracyRate: null,
    }));
    window.dashboardOps = { questionRates } as unknown as Window['dashboardOps'];
    render(<IntakeOverview onOpen={() => undefined} />);
    await screen.findAllByText('没有查询');
    const user = userEvent.setup({ delay: null });
    const startInput = screen.getByPlaceholderText('开始日期');
    const endInput = screen.getByPlaceholderText('结束日期');
    await user.click(startInput);
    await user.clear(startInput);
    await user.type(startInput, '2025-01-01');
    await user.click(endInput);
    await user.clear(endInput);
    await user.type(endInput, `${endText}{Enter}`);
    await waitFor(() => expect(questionRates.mock.calls.length).toBeGreaterThan(1));
    const call = questionRates.mock.calls.at(-1);
    return [String(call?.[0]), String(call?.[1])];
  }
  const inclusive = await pick('2026-01-01');
  expect(inclusive[0]).toBe(startOf(2025, 0, 1));
  expect(inclusive[1]).toBe(endOf(2026, 0, 1));
  const clamped = await pick('2026-06-01');
  expect(clamped[0]).toBe(startOf(2025, 0, 1));
  expect(clamped[1]).toBe(endOf(2026, 0, 1));
  expect(clamped[1]).not.toBe(endOf(2026, 5, 1));
}, 15000);

it('shows the digit 0 when the signed-in reads are empty', async () => {
  window.dashboardIteration = {
    list: vi.fn(async () => ({ ok: true as const, items: [], nextCursor: null })),
    start: vi.fn(),
    close: vi.fn(),
  };
  window.dashboardUsageLog = {
    list: vi.fn(async () => ({ ok: true as const, rows: [], nextCursor: null, canExport: false })),
    previewExport: vi.fn(async () => ({ ok: true as const, exportable: 0, redacted: 0, withoutConsent: 0 })),
    export: vi.fn(async () => ({ ok: true as const, written: 0 })),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  expect(await screen.findByText('这段时间所有查询都有结果。')).toBeInTheDocument();
  expect(await screen.findByText('现在没有待办。')).toBeInTheDocument();
  expect(tileText('查询次数')).toBe('查询次数0');
  expect(tileText('没查到')).toBe('没查到0');
  expect(tileText('被复制')).toBe('被复制0只表示复制了');
  expect(tileText('不准次数')).toBe('不准次数0只含已开待办记下的样本，不是这段时间的全部。');
  expect(screen.getByText('当前没有达到开单阈值的不准稿。')).toBeInTheDocument();
  expect(screen.queryByText('暂无使用记录')).not.toBeInTheDocument();
  expect(screen.queryByText('使用趋势')).not.toBeInTheDocument();
  expect(screen.queryByText('话术类型占比')).not.toBeInTheDocument();
  expect(screen.queryByText('—')).not.toBeInTheDocument();
  expect(document.querySelector('.donut-wrap')).toBeNull();
});

it('says 没读到 and runs the usage read again', async () => {
  let failed = true;
  const list = vi.fn(async () => failed
    ? { ok: false as const, code: 'FAILED', message: 'x' }
    : { ok: true as const, rows: [], nextCursor: null, canExport: false });
  window.dashboardUsageLog = {
    list,
    previewExport: vi.fn(),
    export: vi.fn(),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  const status = await screen.findByTestId('overview-usage-status');
  expect(status).toHaveTextContent('没读到。');
  expect(tileText('查询次数')).toBe('查询次数');
  const before = list.mock.calls.length;
  failed = false;
  await userEvent.setup().click(within(status).getByRole('button', { name: '重试' }));
  expect(await screen.findByText('这段时间所有查询都有结果。')).toBeInTheDocument();
  expect(list.mock.calls.length).toBeGreaterThan(before);
  expect(tileText('查询次数')).toBe('查询次数0');
  expect(tileText('没查到')).toBe('没查到0');
  expect(screen.queryByText('没读到。')).not.toBeInTheDocument();
});

it('keeps an unauthorized task read on the logged-out sentence', async () => {
  window.dashboardIteration = {
    list: vi.fn(async () => ({ ok: false as const, code: 'UNAUTHORIZED' as const, message: '请先登录' })),
    start: vi.fn(),
    close: vi.fn(),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  const todo = screen.getByRole('region', { name: '待办' });
  expect(await within(todo).findByText('请先登录。')).toBeInTheDocument();
  expect(todo).not.toHaveTextContent('没读到');
  expect(screen.getByRole('region', { name: '不准的话术' })).toHaveTextContent('请先登录。');
  expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  expect(tileText('不准次数')).toBe('不准次数');
  expect(screen.queryByText('现在没有待办。')).not.toBeInTheDocument();
});

it('says 没读到 when the task read fails for another reason', async () => {
  window.dashboardIteration = {
    list: vi.fn(async () => ({ ok: false as const, code: 'UNAVAILABLE' as const, message: '服务暂不可用' })),
    start: vi.fn(),
    close: vi.fn(),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  const todo = screen.getByRole('region', { name: '待办' });
  expect(await within(todo).findByText('没读到。')).toBeInTheDocument();
  expect(within(todo).getByRole('button', { name: '重试' })).toBeInTheDocument();
  expect(todo).not.toHaveTextContent('请先登录');
  expect(screen.getByRole('region', { name: '不准的话术' })).toHaveTextContent('没读到。');
  expect(tileText('不准次数')).toBe('不准次数');
});

it('does not render the frozen sample catalog on the live overview', () => {
  render(<IntakeOverview onOpen={() => undefined} />);
  expect(screen.queryByText(/虚构合成结构样例/)).not.toBeInTheDocument();
  expect(screen.queryByText('DEMO · 合成数据')).not.toBeInTheDocument();
  expect(screen.queryByText(/澄芽氨基酸/)).not.toBeInTheDocument();
  expect(screen.queryByText('较上期')).not.toBeInTheDocument();
  expect(screen.queryByText('未接入')).not.toBeInTheDocument();
  expect(screen.queryByText('内容管理')).not.toBeInTheDocument();
  expect(screen.queryByText('系统同步')).not.toBeInTheDocument();
  const outcomes = screen.getByTestId('overview-outcomes');
  expect(outcomes).toHaveTextContent('已处理的不准待办出现后，这里比较处理前后 7 天。');
  expect(outcomes).not.toHaveTextContent('现在没有已处理的不准待办。');
});

it('shows the seven-day comparison only from a real outcome read', async () => {
  window.dashboardIteration = {
    list: vi.fn(async () => ({ ok: true as const, items: [], nextCursor: null })),
    start: vi.fn(),
    close: vi.fn(),
    outcomes: vi.fn(async () => ({
      ok: true as const,
      items: [{
        scriptId: 'script-a',
        resolvedAt: '2026-10-20T00:00:00.000Z',
        ready: true,
        beforeCount: 4,
        afterCount: 1,
        windowDays: 7,
      }],
    })),
  };
  render(<IntakeOverview onOpen={() => undefined} />);
  const outcomes = screen.getByTestId('overview-outcomes');
  expect(await within(outcomes).findByText(/处理前 7 天 4 次，处理后 7 天 1 次。/)).toBeInTheDocument();
  expect(outcomes).not.toHaveTextContent('已处理的不准待办出现后');
});
