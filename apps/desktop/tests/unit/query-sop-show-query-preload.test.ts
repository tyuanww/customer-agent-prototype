// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { CustomerAgentApi } from '../../src/shared/contracts';

const electron = vi.hoisted(() => ({
  expose: vi.fn(), invoke: vi.fn(), listeners: new Map<string, (event: unknown, payload: unknown) => void>(),
}));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.expose },
  ipcRenderer: {
    on: (channel: string, listener: (event: unknown, payload: unknown) => void) => electron.listeners.set(channel, listener),
    removeListener: (channel: string) => electron.listeners.delete(channel),
    invoke: electron.invoke,
  },
}));

it('exposes only validated show-query requests and acknowledgements', async () => {
  await import('../../src/preload/index');
  const exposed = electron.expose.mock.calls.find(call => call[0] === 'customerAgent');
  if (!exposed) throw new Error('Missing overlay preload API');
  const api: CustomerAgentApi = exposed[1];
  if (!api.sopWindow?.onShowQueryRequest || !api.sopWindow.showQueryReady) throw new Error('Missing query handoff API');
  const callback = vi.fn();
  const stop = api.sopWindow.onShowQueryRequest(callback);
  const listener = electron.listeners.get('sop-window:show-query-request');
  if (!listener) throw new Error('Missing query handoff listener');
  const request = { requestId: 3, taskId: 'synthetic-task', hostEpoch: 9 };
  listener({}, { ...request, unexpected: true });
  listener({}, request);
  expect(callback).toHaveBeenCalledOnce();
  expect(callback).toHaveBeenCalledWith(request);
  electron.invoke.mockResolvedValueOnce(true);
  await expect(api.sopWindow.showQueryReady({ ...request, accepted: true })).resolves.toBe(true);
  expect(electron.invoke).toHaveBeenCalledWith('query-sop:show-query-ready', { ...request, accepted: true });
  electron.invoke.mockRejectedValueOnce(new Error('IPC unavailable'));
  await expect(api.sopWindow.showQueryReady({ ...request, accepted: false })).resolves.toBe(false);
  stop();
  expect(electron.listeners.has('sop-window:show-query-request')).toBe(false);
});
