// @vitest-environment node
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';

const expose = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn());
const on = vi.hoisted(() => vi.fn());
const removeListener = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: expose },
  ipcRenderer: { invoke, on, removeListener },
}));

beforeAll(async () => {
  await import('../../src/preload/dashboard');
});

beforeEach(() => {
  invoke.mockClear();
  on.mockClear();
  removeListener.mockClear();
});

const operation = {
  domain: 'materials' as const,
  operationId: 'operation-1',
  command: 'publish' as const,
  state: 'unknown' as const,
  updatedAt: '2026-11-05T08:00:00.000Z',
  recoveryDeadline: '2026-11-06T08:00:00.000Z',
  canCancel: false,
  canRecover: true,
  releaseInvalidationPending: false,
};

function api() {
  return expose.mock.calls.find((entry) => entry[0] === 'dashboardOperations')?.[1] as {
    current(): Promise<unknown>;
    command(value: unknown): Promise<unknown>;
    onChanged(listener: () => void): () => void;
  };
}

it('validates the minimal operation projection and fail-closes identity leakage', async () => {
  invoke.mockResolvedValueOnce({ ok: true, view: operation, views: [operation] });
  await expect(api().current()).resolves.toEqual({ ok: true, view: operation, views: [operation] });
  invoke.mockResolvedValueOnce({
    ok: true,
    view: { ...operation, userId: 'private' },
    views: [{ ...operation, userId: 'private' }],
  });
  await expect(api().current()).resolves.toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  invoke.mockRejectedValueOnce(new Error('ipc down'));
  await expect(api().current()).resolves.toMatchObject({ ok: false, code: 'UNAVAILABLE' });
});

it('accepts only fixed cancel or recover intent and no operation id', async () => {
  invoke.mockResolvedValueOnce({ ok: true, view: operation, views: [operation] });
  await expect(api().command({ action: 'recover', domain: 'materials' }))
    .resolves.toMatchObject({ ok: true, view: { state: 'unknown' } });
  expect(invoke).toHaveBeenLastCalledWith('dashboard:operation-command', {
    action: 'recover',
    domain: 'materials',
  });
  await expect(api().command({
    action: 'recover',
    domain: 'materials',
    operationId: 'forged',
  })).resolves.toMatchObject({ ok: false, message: '操作输入无效。' });
  expect(invoke).toHaveBeenCalledTimes(1);
});

it('subscribes to the typed change event with a removable fixed handler', () => {
  const listener = vi.fn();
  const stop = api().onChanged(listener);
  const handler = on.mock.calls.find((entry) => entry[0] === 'dashboard:operation-changed')?.[1] as () => void;
  handler();
  expect(listener).toHaveBeenCalledOnce();
  stop();
  expect(removeListener).toHaveBeenCalledWith('dashboard:operation-changed', handler);
});
