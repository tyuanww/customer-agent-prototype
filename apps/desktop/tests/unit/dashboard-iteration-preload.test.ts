// @vitest-environment node
import { beforeAll, expect, it, vi } from 'vitest';
import type { DashboardIterationApi } from '../../src/shared/dashboard-iteration';

const expose = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: expose },
  ipcRenderer: { invoke, on: vi.fn() },
}));

const task = Object.freeze({
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
});

const unavailable = {
  ok: false as const,
  code: 'UNAVAILABLE' as const,
  message: '服务暂不可用，请重试',
};

beforeAll(async () => {
  await import('../../src/preload/dashboard');
});

function iterationApi(): DashboardIterationApi {
  const call = expose.mock.calls.find((entry) => entry[0] === 'dashboardIteration');
  return call?.[1] as DashboardIterationApi;
}

it('fail-closes malformed iteration IPC payloads and invoke throws', async () => {
  const api = iterationApi();
  invoke.mockResolvedValueOnce({ ok: true, items: [], nextCursor: null, truncated: false });
  await expect(api.list()).resolves.toEqual({ ok: true, items: [], nextCursor: null, truncated: false });

  invoke.mockResolvedValueOnce({ ok: true, items: [task], nextCursor: null, extra: true });
  await expect(api.list()).resolves.toEqual(unavailable);

  invoke.mockResolvedValueOnce({
    ok: true,
    items: [{ ...task, sampleQueryIds: ['q-1', 'q-1'] }],
    nextCursor: null,
  });
  await expect(api.list()).resolves.toEqual(unavailable);

  invoke.mockResolvedValueOnce({
    ok: true,
    items: [{ ...task, createdAt: 'nope' }],
    nextCursor: null,
  });
  await expect(api.list()).resolves.toEqual(unavailable);

  invoke.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN', message: '坐席不能查看或处理话术优化待办' });
  await expect(api.list()).resolves.toMatchObject({ ok: false, code: 'FORBIDDEN' });

  invoke.mockRejectedValueOnce(new Error('ipc down'));
  await expect(api.list()).resolves.toEqual(unavailable);

  invoke.mockResolvedValueOnce({ ok: true, task });
  await expect(api.start({ taskId: 'itask-01J4PF9TQX7G', expectedVersion: 1 })).resolves.toEqual({
    ok: true,
    task,
  });
  invoke.mockResolvedValueOnce({ ok: true, task: { ...task, extra: true } });
  await expect(api.start({ taskId: 'itask-01J4PF9TQX7G', expectedVersion: 1 })).resolves.toEqual(unavailable);

  invoke.mockResolvedValueOnce({
    ok: true,
    task: { ...task, status: 'wont_fix', resolution: 'wont_fix', resolutionNote: '样本不足', version: 3 },
  });
  await expect(api.close({
    taskId: 'itask-01J4PF9TQX7G',
    expectedVersion: 2,
    status: 'wont_fix',
    resolutionNote: '样本不足',
  })).resolves.toMatchObject({ ok: true, task: { status: 'wont_fix' } });
  invoke.mockRejectedValueOnce(new Error('ipc down'));
  await expect(api.close({
    taskId: 'itask-01J4PF9TQX7G',
    expectedVersion: 2,
    status: 'resolved',
    resolutionNote: '已核对',
  })).resolves.toEqual(unavailable);

  expect(JSON.stringify(invoke.mock.calls)).not.toContain('access_token');
});

it('accepts a truncated outcome list and rejects a bad item', async () => {
  const api = iterationApi();
  const row = {
    scriptId: 'shipping-001',
    resolvedAt: '2026-10-01T00:00:00.000Z',
    ready: true,
    beforeCount: 4,
    afterCount: 1,
    windowDays: 7,
  };
  invoke.mockResolvedValueOnce({ ok: true, items: [row], truncated: false });
  await expect(api.outcomes?.()).resolves.toEqual({ ok: true, items: [row], truncated: false });
  invoke.mockResolvedValueOnce({ ok: true, items: [{ ...row, windowDays: 3 }], truncated: false });
  await expect(api.outcomes?.()).resolves.toEqual(unavailable);
});
