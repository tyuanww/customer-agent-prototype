// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { registerDashboardIterationIpc } from '../../src/main/dashboard-iteration-ipc';
import {
  dashboardIterationClose,
  dashboardIterationList,
  dashboardIterationStart,
} from '../../src/main/dashboard-iteration';
import { ITERATION_COPY } from '../../src/shared/dashboard-iteration';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { ProductHttpError } from '../../src/main/product-http';
import type { ProductSession } from '../../src/main/product-session';

const handlers = vi.hoisted(() => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>());
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
      handlers.set(name, callback);
    },
  },
}));

const contractTask = {
  task_id: 'itask-01J4PF9TQX7G',
  signal_id: 'sig-no-hit-shipping',
  cluster_key: 'no_hit:shipping',
  sample_query_ids: ['q-syn-001'],
  suspected_cause: 'content_gap',
  suggested_script_ids: ['script-synthetic-001'],
  status: 'open',
  assignee_role: 'coach',
  resolution: null,
  resolution_note: null,
  version: 1,
  created_at: '2026-09-20T03:14:15.000Z',
  updated_at: '2026-09-20T03:14:15.000Z',
  resolved_at: null,
};

function fakeSession(
  role: 'agent' | 'coach' | 'owner' | null,
  signedIn = true,
  enabled = true,
): Pick<ProductSession, 'view' | 'request'> {
  return {
    view: () => ({
      ok: true,
      enabled,
      signedIn,
      sessionEpoch: 1,
      userId: signedIn ? 'usr_synthetic' : null,
      role,
      authMode: signedIn ? 'mock' : null,
      expiresAt: signedIn ? new Date(Date.now() + 60_000).toISOString() : null,
      displayName: signedIn ? 'synthetic' : null,
    }),
    request: vi.fn(),
  };
}

function trustedDashboard() {
  const frame = { parent: null };
  const dashboard = {
    id: 10,
    isDestroyed: () => false,
    getURL: () => 'http://127.0.0.1:5173/?role=dashboard',
    mainFrame: frame,
  } as unknown as WebContents;
  const query = { ...dashboard, id: 1 } as WebContents;
  const event = (sender: WebContents, senderFrame: unknown = frame) => (
    { sender, senderFrame } as IpcMainInvokeEvent
  );
  return { dashboard, query, event };
}

it('fail-closes unsigned dashboard senders and does not leak the product token', async () => {
  const frame = { parent: null };
  const dashboard = {
    id: 10,
    isDestroyed: () => false,
    getURL: () => 'http://127.0.0.1:5173/?role=dashboard',
    mainFrame: frame,
  } as unknown as WebContents;
  const query = { ...dashboard, id: 1 } as WebContents;
  const session = fakeSession('owner');
  registerDashboardIterationIpc(session as ProductSession, () => dashboard, () => 'http://127.0.0.1:5173/');
  const event = (sender: WebContents, senderFrame: unknown = frame) => ({ sender, senderFrame }) as IpcMainInvokeEvent;
  const list = handlers.get(IPC_CHANNELS.DASHBOARD_ITERATION_LIST)!;
  expect(await list(event(query))).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(await list(event(dashboard), { extra: true })).toMatchObject({ ok: false, code: 'VALIDATION' });
  vi.mocked(session.request).mockResolvedValueOnce({ status: 200, value: { items: [], next_cursor: null } });
  const view = await list(event(dashboard));
  expect(view).toEqual({ ok: true, items: [], nextCursor: null });
  expect(JSON.stringify(view)).not.toContain('usr_synthetic');
  expect(JSON.stringify(view)).not.toContain('access_token');
});

it('blocks agent list/start/close before any product HTTP', async () => {
  const agent = fakeSession('agent');
  expect(await dashboardIterationList(agent)).toMatchObject({
    ok: false,
    code: 'FORBIDDEN',
    message: ITERATION_COPY.agent,
  });
  expect(agent.request).not.toHaveBeenCalled();
  expect(await dashboardIterationStart(agent, { taskId: 'itask-01J4PF9TQX7G', expectedVersion: 1 })).toMatchObject({
    ok: false,
    code: 'FORBIDDEN',
  });
  expect(await dashboardIterationClose(agent, {
    taskId: 'itask-01J4PF9TQX7G',
    expectedVersion: 1,
    status: 'resolved',
    resolutionNote: 'x',
  })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(agent.request).not.toHaveBeenCalled();
  expect(await dashboardIterationList(null)).toMatchObject({
    ok: false,
    code: 'UNAVAILABLE',
    message: ITERATION_COPY.noProduct,
  });
});

it('lists and starts through ProductSession.request with the token remaining in main', async () => {
  const coach = fakeSession('coach');
  vi.mocked(coach.request)
    .mockResolvedValueOnce({ status: 200, value: { items: [contractTask], next_cursor: null } })
    .mockResolvedValueOnce({
      status: 200,
      value: { ...contractTask, status: 'in_progress', version: 2, updated_at: '2026-09-20T03:20:00.000Z' },
    });
  expect(await dashboardIterationList(coach)).toMatchObject({
    ok: true,
    items: [{ taskId: 'itask-01J4PF9TQX7G', status: 'open' }],
    nextCursor: null,
  });
  const started = await dashboardIterationStart(coach, {
    taskId: 'itask-01J4PF9TQX7G',
    expectedVersion: 1,
  });
  expect(started).toMatchObject({ ok: true, task: { status: 'in_progress', version: 2 } });
  expect(vi.mocked(coach.request).mock.calls[0]?.[1]).toBe('/v1/metrics/iteration-tasks?limit=50');
  const paged = fakeSession('coach');
  vi.mocked(paged.request)
    .mockResolvedValueOnce({ status: 200, value: { items: [contractTask], next_cursor: 'page-2' } })
    .mockResolvedValueOnce({ status: 200, value: { items: [], next_cursor: null } });
  expect(await dashboardIterationList(paged)).toMatchObject({
    ok: true,
    items: [{ taskId: 'itask-01J4PF9TQX7G' }],
    nextCursor: null,
  });
  expect(vi.mocked(paged.request).mock.calls[1]?.[1]).toBe(
    '/v1/metrics/iteration-tasks?limit=50&cursor=page-2',
  );
  expect(vi.mocked(coach.request).mock.calls[1]?.[1]).toBe('/v1/events/iteration-tasks/itask-01J4PF9TQX7G/start');
  expect(vi.mocked(coach.request).mock.calls[1]?.[2]?.body).toEqual({ expected_version: 1 });
  expect(vi.mocked(coach.request).mock.calls[1]?.[2]?.headers?.['idempotency-key']).toEqual(expect.any(String));
  expect(JSON.stringify(started)).not.toContain('Bearer');
});

it('closes with expected_version and surfaces CONFLICT without rewriting answers', async () => {
  const owner = fakeSession('owner');
  vi.mocked(owner.request).mockRejectedValueOnce(new ProductHttpError('CONFLICT'));
  const result = await dashboardIterationClose(owner, {
    taskId: 'itask-01J4PF9TQX7G',
    expectedVersion: 2,
    status: 'resolved',
    resolutionNote: '已核对有效期过滤',
  });
  expect(result).toMatchObject({ ok: false, code: 'CONFLICT', message: ITERATION_COPY.conflict });
  expect(vi.mocked(owner.request).mock.calls[0]?.[1]).toBe('/v1/events/iteration-tasks/itask-01J4PF9TQX7G/close');
  expect(vi.mocked(owner.request).mock.calls[0]?.[2]?.body).toEqual({
    expected_version: 2,
    status: 'resolved',
    resolution_note: '已核对有效期过滤',
  });
});

it('maps session and HTTP failures before rewriting answers, including invalid payloads', async () => {
  const unsigned = fakeSession(null, false);
  expect(await dashboardIterationList(unsigned)).toMatchObject({
    ok: false,
    code: 'UNAUTHORIZED',
    message: ITERATION_COPY.noSession,
  });
  expect(unsigned.request).not.toHaveBeenCalled();

  const disabled = fakeSession('coach', true, false);
  expect(await dashboardIterationStart(disabled, {
    taskId: 'itask-01J4PF9TQX7G',
    expectedVersion: 1,
  })).toMatchObject({
    ok: false,
    code: 'UNAVAILABLE',
    message: ITERATION_COPY.noProduct,
  });
  expect(disabled.request).not.toHaveBeenCalled();

  expect(await dashboardIterationStart(fakeSession('coach'), { extra: true })).toMatchObject({
    ok: false,
    code: 'VALIDATION',
  });
  expect(await dashboardIterationClose(fakeSession('owner'), {
    taskId: 'itask-01J4PF9TQX7G',
    expectedVersion: 2,
    status: 'resolved',
    resolutionNote: '',
  })).toMatchObject({ ok: false, code: 'VALIDATION' });

  const coach = fakeSession('coach');
  vi.mocked(coach.request)
    .mockRejectedValueOnce(new ProductHttpError('GONE'))
    .mockRejectedValueOnce(new ProductHttpError('OVERLOADED'))
    .mockRejectedValueOnce(new ProductHttpError('SOURCE_GATE_NOT_READY'))
    .mockRejectedValueOnce(new ProductHttpError('CLIPBOARD_FAILED'))
    .mockRejectedValueOnce(new ProductHttpError('RATE_LIMITED'))
    .mockRejectedValueOnce(new Error('socket down'))
    .mockResolvedValueOnce({ status: 200, value: { items: 'nope' } })
    .mockResolvedValueOnce({ status: 200, value: { not: 'a-task' } })
    .mockResolvedValueOnce({
      status: 200,
      value: {
        ...contractTask,
        status: 'resolved',
        resolution: 'resolved',
        resolution_note: '已核对有效期过滤',
        version: 3,
        resolved_at: '2026-09-20T03:30:00.000Z',
        updated_at: '2026-09-20T03:30:00.000Z',
      },
    });
  expect(await dashboardIterationList(coach)).toMatchObject({
    ok: false, code: 'GONE', message: ITERATION_COPY.missing,
  });
  expect(await dashboardIterationList(coach)).toMatchObject({
    ok: false, code: 'OVERLOADED', message: ITERATION_COPY.unavailable,
  });
  expect(await dashboardIterationList(coach)).toMatchObject({
    ok: false, code: 'UNAVAILABLE',
  });
  expect(await dashboardIterationStart(coach, {
    taskId: 'itask-01J4PF9TQX7G', expectedVersion: 1,
  })).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(await dashboardIterationStart(coach, {
    taskId: 'itask-01J4PF9TQX7G', expectedVersion: 1,
  })).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  expect(await dashboardIterationClose(coach, {
    taskId: 'itask-01J4PF9TQX7G',
    expectedVersion: 2,
    status: 'wont_fix',
    resolutionNote: '样本不足',
  })).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(await dashboardIterationList(coach)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(await dashboardIterationStart(coach, {
    taskId: 'itask-01J4PF9TQX7G', expectedVersion: 1,
  })).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  const closed = await dashboardIterationClose(coach, {
    taskId: 'itask-01J4PF9TQX7G',
    expectedVersion: 2,
    status: 'resolved',
    resolutionNote: '已核对有效期过滤',
  });
  expect(closed).toMatchObject({ ok: true, task: { status: 'resolved', version: 3 } });
  expect(JSON.stringify(closed)).not.toContain('answer_text');
});

it('guards start/close IPC senders, argument counts, and thrown view errors', async () => {
  const { dashboard, query, event } = trustedDashboard();
  const exploding = {
    view: () => {
      throw new Error('view boom');
    },
    request: vi.fn(),
  };
  registerDashboardIterationIpc(
    exploding as unknown as ProductSession,
    () => dashboard,
    () => 'http://127.0.0.1:5173/',
  );
  const list = handlers.get(IPC_CHANNELS.DASHBOARD_ITERATION_LIST)!;
  const start = handlers.get(IPC_CHANNELS.DASHBOARD_ITERATION_START)!;
  const close = handlers.get(IPC_CHANNELS.DASHBOARD_ITERATION_CLOSE)!;
  expect(await list(event(dashboard))).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(await start(event(query), { taskId: 'itask-01J4PF9TQX7G', expectedVersion: 1 }))
    .toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(await start(event(dashboard))).toMatchObject({ ok: false, code: 'VALIDATION' });
  expect(await start(event(dashboard), { taskId: 'itask-01J4PF9TQX7G', expectedVersion: 1 }, true))
    .toMatchObject({ ok: false, code: 'VALIDATION' });
  expect(await close(event(dashboard))).toMatchObject({ ok: false, code: 'VALIDATION' });

  const coach = fakeSession('coach');
  vi.mocked(coach.request)
    .mockResolvedValueOnce({
      status: 200,
      value: { ...contractTask, status: 'in_progress', version: 2, updated_at: '2026-09-20T03:20:00.000Z' },
    })
    .mockResolvedValueOnce({
      status: 200,
      value: {
        ...contractTask,
        status: 'wont_fix',
        resolution: 'wont_fix',
        resolution_note: '样本不足',
        version: 3,
        resolved_at: '2026-09-20T03:30:00.000Z',
        updated_at: '2026-09-20T03:30:00.000Z',
      },
    });
  registerDashboardIterationIpc(coach as ProductSession, () => dashboard, () => 'http://127.0.0.1:5173/');
  const started = await handlers.get(IPC_CHANNELS.DASHBOARD_ITERATION_START)!(
    event(dashboard),
    { taskId: 'itask-01J4PF9TQX7G', expectedVersion: 1 },
  );
  expect(started).toMatchObject({ ok: true, task: { status: 'in_progress', version: 2 } });
  const closed = await handlers.get(IPC_CHANNELS.DASHBOARD_ITERATION_CLOSE)!(
    event(dashboard),
    {
      taskId: 'itask-01J4PF9TQX7G',
      expectedVersion: 2,
      status: 'wont_fix',
      resolutionNote: '样本不足',
    },
  );
  expect(closed).toMatchObject({ ok: true, task: { status: 'wont_fix' } });

  registerDashboardIterationIpc(coach as ProductSession, () => null, () => 'http://127.0.0.1:5173/');
  expect(await handlers.get(IPC_CHANNELS.DASHBOARD_ITERATION_LIST)!(event(dashboard)))
    .toMatchObject({ ok: false, code: 'FORBIDDEN' });
});
