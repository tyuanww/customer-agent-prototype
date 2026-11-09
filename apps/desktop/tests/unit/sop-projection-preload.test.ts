// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import type { SopWindowApi } from '../../src/shared/sop-window';
import type { SopQueryProjection } from '../../src/shared/sop-query';

const electron = vi.hoisted(() => ({
  expose: vi.fn(),
  receive: new Map<string, (event: unknown, payload: unknown) => void>(),
}));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.expose },
  ipcRenderer: {
    on: (channel: string, receive: (event: unknown, payload: unknown) => void) => electron.receive.set(channel, receive),
    invoke: vi.fn(),
  },
}));

let api: SopWindowApi;
const projection: SopQueryProjection = {
  projectionVersion: 'sop-query-v1', sessionId: 2, state: 'idle',
  shops: [{ key: 'opaque-shop', label: 'synthetic-shop' }], notice: '选择店铺和流程后查询。',
  messages: [], branches: [], terminal: false, copied: false,
};
function send(value: unknown) { electron.receive.get('sop-window:projection')!({}, value); }

beforeEach(async () => {
  vi.resetModules(); electron.expose.mockClear(); electron.receive.clear();
  await import('../../src/preload/sop');
  api = electron.expose.mock.calls[0][1] as SopWindowApi;
});

it('delivers the latest validated state when the renderer subscribes after Main has opened the flow', () => {
  send({ ...projection, state: 'loading', shops: [] });
  send(projection);
  const receive = vi.fn(); api.onProjection(receive);
  expect(receive).toHaveBeenCalledExactlyOnceWith(projection);
});

it('replays revocation instead of an older state after renderer remount', () => {
  const old = vi.fn(); const stop = api.onProjection(old);
  send(projection); stop();
  const revoked = { ...projection, state: 'stale', shops: [], notice: '登录状态已变化。' };
  send(revoked);
  const next = vi.fn(); api.onProjection(next);
  expect(old).toHaveBeenCalledExactlyOnceWith(projection);
  expect(next).toHaveBeenCalledExactlyOnceWith(revoked);
});

it('never retains or delivers a malformed projection', () => {
  send({ ...projection, userId: 'forbidden' });
  const receive = vi.fn(); api.onProjection(receive);
  expect(receive).not.toHaveBeenCalled();
  send(projection);
  send({ ...projection, messages: 'invalid' });
  expect(receive).toHaveBeenCalledExactlyOnceWith(projection);
});
