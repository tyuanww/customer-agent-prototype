import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IterationModule } from '../../src/renderer/features/dashboard/IterationModule';
import { ITERATION_COPY, type DashboardIterationApi, type DashboardIterationTask } from '../../src/shared/dashboard-iteration';

const openTask: DashboardIterationTask = {
  taskId: 'itask-01J4PF9TQX7G',
  signalId: 'sig-no-hit-shipping',
  clusterKey: 'no_hit:shipping',
  sampleQueryIds: ['q-syn-001'],
  suspectedCause: 'content_gap',
  suggestedScriptIds: ['script-synthetic-001'],
  status: 'open',
  assigneeRole: 'coach',
  resolution: null,
  resolutionNote: null,
  version: 1,
  createdAt: '2026-09-20T03:14:15.000Z',
  updatedAt: '2026-09-20T03:14:15.000Z',
  resolvedAt: null,
};

function mockApi(overrides: Partial<DashboardIterationApi> = {}): DashboardIterationApi {
  return {
    list: vi.fn(async () => ({ ok: true as const, items: [], nextCursor: null })),
    start: vi.fn(async () => ({
      ok: false as const,
      code: 'UNAVAILABLE' as const,
      message: ITERATION_COPY.unavailable,
    })),
    close: vi.fn(async () => ({
      ok: false as const,
      code: 'UNAVAILABLE' as const,
      message: ITERATION_COPY.unavailable,
    })),
    ...overrides,
  };
}

describe('IterationModule live list', () => {
  beforeEach(() => {
    delete window.dashboardIteration;
  });

  afterEach(() => {
    delete window.dashboardIteration;
  });

  it('keeps the synthetic five-task drill when dashboardIteration is absent', () => {
    render(<IterationModule />);
    expect(screen.getByTestId('iteration-it-2041')).toBeInTheDocument();
    expect(screen.getByTestId('iteration-filter-status')).toHaveTextContent('项合成待办');
    expect(screen.queryByTestId('iteration-live-status')).not.toBeInTheDocument();
  });

  it('shows 当前没有待办 for an empty live list and never the DEMO 5', async () => {
    const api = mockApi();
    window.dashboardIteration = api;
    render(<IterationModule />);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(screen.getByTestId('iteration-live-status')).toHaveTextContent('当前没有待办');
    expect(screen.queryByTestId('iteration-it-2041')).not.toBeInTheDocument();
    expect(screen.queryByTestId('iteration-it-2048')).not.toBeInTheDocument();
    expect(screen.queryByTestId('iteration-reset-drill')).not.toBeInTheDocument();
  });

  it('shows the agent 403 copy and does not fall back to DEMO 5', async () => {
    const api = mockApi({
      list: vi.fn(async () => ({
        ok: false as const,
        code: 'FORBIDDEN' as const,
        message: ITERATION_COPY.agent,
      })),
    });
    window.dashboardIteration = api;
    render(<IterationModule />);
    await waitFor(() => expect(screen.getByTestId('iteration-live-status')).toHaveTextContent(ITERATION_COPY.agent));
    expect(screen.queryByTestId('iteration-it-2041')).not.toBeInTheDocument();
    expect(screen.queryByTestId('iteration-reset-drill')).not.toBeInTheDocument();
  });

  it('shows 服务暂不可用 on UNAVAILABLE and does not fall back to DEMO 5', async () => {
    const api = mockApi({
      list: vi.fn(async () => ({
        ok: false as const,
        code: 'UNAVAILABLE' as const,
        message: '服务暂不可用，请重试',
      })),
    });
    window.dashboardIteration = api;
    render(<IterationModule />);
    await waitFor(() => expect(screen.getByTestId('iteration-live-status')).toHaveTextContent('服务暂不可用'));
    expect(screen.queryByTestId('iteration-it-2041')).not.toBeInTheDocument();
    expect(screen.queryByTestId('iteration-it-2055')).not.toBeInTheDocument();
  });

  it('starts and closes one open live task through dashboardIteration', async () => {
    const started: DashboardIterationTask = {
      ...openTask,
      status: 'in_progress',
      version: 2,
      updatedAt: '2026-09-20T03:20:00.000Z',
    };
    const closed: DashboardIterationTask = {
      ...started,
      status: 'resolved',
      resolution: 'resolved',
      resolutionNote: '已核对有效期过滤',
      version: 3,
      resolvedAt: '2026-09-20T03:30:00.000Z',
      updatedAt: '2026-09-20T03:30:00.000Z',
    };
    const api = mockApi({
      list: vi.fn(async () => ({ ok: true as const, items: [openTask], nextCursor: null })),
      start: vi.fn(async () => ({ ok: true as const, task: started })),
      close: vi.fn(async () => ({ ok: true as const, task: closed })),
    });
    window.dashboardIteration = api;
    const user = userEvent.setup();
    render(<IterationModule />);
    await waitFor(() => expect(screen.getByTestId('iteration-itask-01J4PF9TQX7G')).toBeInTheDocument());
    expect(screen.queryByTestId('iteration-it-2041')).not.toBeInTheDocument();
    expect(screen.getByTestId('iteration-detail')).toHaveTextContent('待处理');
    expect(screen.getByTestId('iteration-detail-version')).toHaveTextContent('v1');

    await user.click(screen.getByTestId('iteration-start'));
    await waitFor(() => expect(api.start).toHaveBeenCalledWith({
      taskId: 'itask-01J4PF9TQX7G',
      expectedVersion: 1,
    }));
    await waitFor(() => expect(screen.getByTestId('iteration-detail')).toHaveTextContent('处理中'));
    expect(screen.getByTestId('iteration-detail-version')).toHaveTextContent('v2');

    await user.type(screen.getByTestId('iteration-note'), '已核对有效期过滤');
    await user.click(screen.getByTestId('iteration-close-resolved'));
    await waitFor(() => expect(api.close).toHaveBeenCalledWith({
      taskId: 'itask-01J4PF9TQX7G',
      expectedVersion: 2,
      status: 'resolved',
      resolutionNote: '已核对有效期过滤',
    }));
    await waitFor(() => expect(screen.getByTestId('iteration-terminal')).toHaveTextContent('已核对有效期过滤'));
    expect(screen.getByTestId('iteration-detail-footnote')).toHaveTextContent('不自动改写 Answer');
    expect(screen.getByTestId('iteration-detail-footnote')).not.toHaveTextContent('演练不保存');
  });

  it('surfaces live CONFLICT/GONE, closes wont_fix, and never shows DEMO 5 or P0 reminder', async () => {
    const inProgress: DashboardIterationTask = {
      ...openTask,
      status: 'in_progress',
      version: 2,
      updatedAt: '2026-09-20T03:20:00.000Z',
      clusterKey: 'top1_skipped:shipping',
      assigneeRole: null,
    };
    const closed: DashboardIterationTask = {
      ...inProgress,
      status: 'wont_fix',
      resolution: 'wont_fix',
      resolutionNote: '样本不足',
      version: 3,
      resolvedAt: '2026-09-20T03:30:00.000Z',
      updatedAt: '2026-09-20T03:30:00.000Z',
    };
    const ranking: DashboardIterationTask = {
      ...openTask,
      taskId: 'itask-ranking-001',
      suspectedCause: 'ranking',
      clusterKey: 'no_hit:ranking',
      status: 'open',
    };
    const api = mockApi({
      list: vi.fn(async () => ({ ok: true as const, items: [inProgress, ranking], nextCursor: null })),
      start: vi.fn(async () => ({
        ok: false as const,
        code: 'CONFLICT' as const,
        message: ITERATION_COPY.conflict,
      })),
      close: vi.fn(async () => ({ ok: true as const, task: closed })),
    });
    window.dashboardIteration = api;
    const user = userEvent.setup();
    render(<IterationModule />);
    await waitFor(() => expect(screen.getByTestId('iteration-itask-01J4PF9TQX7G')).toBeInTheDocument());
    expect(screen.queryByTestId('iteration-reminder')).not.toBeInTheDocument();
    expect(screen.queryByTestId('iteration-reset-drill')).not.toBeInTheDocument();
    expect(screen.queryByTestId('iteration-it-2041')).not.toBeInTheDocument();
    expect(screen.getByTestId('iteration-filter-status')).toHaveTextContent('项待办');
    expect(screen.getByTestId('iteration-detail')).toHaveTextContent('未指派');
    expect(screen.getByTestId('iteration-detail')).toHaveTextContent('top1_skipped:shipping');

    await user.click(screen.getByTestId('iteration-itask-ranking-001'));
    await user.click(screen.getByTestId('iteration-start'));
    await waitFor(() => expect(screen.getByTestId('iteration-conflict')).toHaveTextContent(ITERATION_COPY.conflict));

    await user.click(screen.getByTestId(`iteration-${inProgress.taskId}`));
    expect(screen.getByTestId('iteration-close-resolved')).toBeDisabled();
    await user.type(screen.getByTestId('iteration-note'), '样本不足');
    await user.click(screen.getByTestId('iteration-close-wont-fix'));
    await waitFor(() => expect(api.close).toHaveBeenCalledWith({
      taskId: 'itask-01J4PF9TQX7G',
      expectedVersion: 2,
      status: 'wont_fix',
      resolutionNote: '样本不足',
    }));
    await waitFor(() => expect(screen.getByTestId('iteration-terminal')).toHaveTextContent('样本不足'));

    await user.selectOptions(screen.getByTestId('iteration-cause-filter'), 'stale');
    expect(screen.getByText('当前筛选没有待办')).toBeInTheDocument();
  });

  it('shows loading then GONE/OVERLOADED copy, refreshes empty lists, and swallows list throws', async () => {
    let resolveList!: (value: Awaited<ReturnType<DashboardIterationApi['list']>>) => void;
    const hanging = mockApi({
      list: vi.fn((): ReturnType<DashboardIterationApi['list']> => new Promise((resolve) => {
        resolveList = resolve;
      })),
    });
    window.dashboardIteration = hanging;
    const first = render(<IterationModule />);
    expect(screen.getByTestId('iteration-live-status')).toHaveTextContent('正在加载待办');
    expect(screen.queryByTestId('iteration-it-2041')).not.toBeInTheDocument();
    resolveList({
      ok: false,
      code: 'GONE',
      message: ITERATION_COPY.missing,
    });
    await waitFor(() => expect(screen.getByTestId('iteration-live-status')).toHaveTextContent(ITERATION_COPY.missing));
    first.unmount();

    const overloaded = mockApi({
      list: vi.fn()
        .mockResolvedValueOnce({
          ok: false as const,
          code: 'OVERLOADED' as const,
          message: 'ignored-driver-text',
        })
        .mockResolvedValueOnce({ ok: true as const, items: [], nextCursor: null }),
    });
    window.dashboardIteration = overloaded;
    const second = render(<IterationModule />);
    await waitFor(() => expect(screen.getByTestId('iteration-live-status')).toHaveTextContent(ITERATION_COPY.unavailable));
    expect(screen.queryByTestId('iteration-it-2048')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByTestId('iteration-refresh'));
    await waitFor(() => expect(overloaded.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('iteration-live-status')).toHaveTextContent('当前没有待办'));
    second.unmount();

    const throwing = mockApi({
      list: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    window.dashboardIteration = throwing;
    render(<IterationModule />);
    await waitFor(() => expect(screen.getByTestId('iteration-live-status')).toHaveTextContent(ITERATION_COPY.unavailable));
    expect(screen.queryByTestId('iteration-reset-drill')).not.toBeInTheDocument();
  });
});
