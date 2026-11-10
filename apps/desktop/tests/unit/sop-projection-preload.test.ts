// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import type { SopWindowApi } from '../../src/shared/sop-window';
import type { SopUnifiedProjection } from '../../src/shared/sop-unified';
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

it('replays v11 concealed state and rejects protected fields or arbitrary image URLs', () => {
  const next = { projectionVersion: 'sop-unified-v11', sessionId: 3, shops: [], notice: '合成暂停', busy: false, copied: false, state: 'paused', title: '', node: null };
  send(next); send({ ...next, continuationId: 'forbidden' });
  const listener = vi.fn(); api.onProjection(listener);
  expect(listener).toHaveBeenCalledExactlyOnceWith(next);
});

it('accepts progressive image states and rejects contradictory or arbitrary image payloads', () => {
  const next: SopUnifiedProjection = {
    projectionVersion: 'sop-unified-v11', sessionId: 3, shops: [], notice: '', busy: false, copied: false,
    state: 'ready', title: '合成图', node: {
      kind: 'action', title: '合成任务', stage: '核对', instruction: '合成正文', requirements: [], scripts: [], knowledge: [],
      media: [{ key: 'synthetic-handle', alt: '合成图片', owner: 'task', required: false, state: 'loading', image: null }],
      choices: [], canAdvance: true, nextKey: 'synthetic-next',
    },
  };
  const receive = vi.fn(); api.onProjection(receive);
  send(next); expect(receive).toHaveBeenCalledExactlyOnceWith(next);
  for (const media of [
    { ...next.node.media[0], state: 'ready', image: null },
    { ...next.node.media[0], image: 'data:image/png;base64,AAAA' },
    { ...next.node.media[0], state: 'ready', image: 'https://synthetic.invalid/image' },
  ]) send({ ...next, node: { ...next.node, media: [media] } });
  expect(receive).toHaveBeenCalledTimes(1);
  const ready = { ...next, node: { ...next.node, media: [{ ...next.node.media[0], state: 'ready', image: 'data:image/png;base64,AAAA' }] } };
  send(ready); expect(receive).toHaveBeenLastCalledWith(ready);
});
