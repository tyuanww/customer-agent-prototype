// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { CustomerAgentApi } from '../../src/shared/contracts';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
const electron = vi.hoisted(() => ({
  expose: vi.fn(),
  invoke: vi.fn().mockResolvedValue(undefined),
  listeners: new Map<string, (event: unknown, payload: unknown) => void>(),
}));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.expose },
  ipcRenderer: {
    on: (channel: string, listener: (event: unknown, payload: unknown) => void) => electron.listeners.set(channel, listener),
    invoke: electron.invoke,
  },
}));
it('installs the command receiver before readiness and reports only once per document', async () => {
  await import('../../src/preload/index');
  const api = electron.expose.mock.calls.find(call => call[0] === 'customerAgent')?.[1] as CustomerAgentApi;
  const receive = vi.fn();
  const command = { type: 'activate-search', anchor: 'left', animate: false };
  electron.invoke.mockImplementation(async (channel: string) => {
    if (channel === IPC_CHANNELS.QUERY_SUBSCRIBED) electron.listeners.get(IPC_CHANNELS.OVERLAY_COMMAND)?.({}, command);
  });
  const remove = api.onOverlayCommand(receive);
  expect(receive).toHaveBeenCalledWith(command);
  remove();
  const next = vi.fn();
  api.onOverlayCommand(next);
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.QUERY_SUBSCRIBED);
  electron.listeners.get(IPC_CHANNELS.OVERLAY_COMMAND)?.({}, command);
  expect(receive).toHaveBeenCalledOnce();
  expect(next).toHaveBeenCalledWith(command);
});
