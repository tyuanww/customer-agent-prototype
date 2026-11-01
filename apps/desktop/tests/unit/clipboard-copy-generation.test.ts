// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, value: unknown) => Promise<unknown>>(),
  writeText: vi.fn(),
}));
vi.mock('electron', () => ({
  clipboard: { writeText: electron.writeText },
  ipcMain: { handle: (channel: string, handler: (event: unknown, value: unknown) => Promise<unknown>) => electron.handlers.set(channel, handler) },
}));
vi.mock('../../src/main/sender-guard', () => ({ isTrustedSender: () => true }));

it('announces only successful clipboard writes and returns their generation', async () => {
  const { registerClipboardIpc } = await import('../../src/main/clipboard-ipc');
  const committed = vi.fn(() => 7);
  registerClipboardIpc(() => [], () => 'query', () => undefined, () => false, committed);
  const copy = electron.handlers.get(IPC_CHANNELS.COPY_TEXT);
  if (!copy) throw new Error('Missing clipboard handler');

  await expect(copy({ sender: {} }, '合成话术')).resolves.toEqual({ ok: true, copyGeneration: 7 });
  expect(committed).toHaveBeenCalledTimes(1);
  electron.writeText.mockImplementationOnce(() => { throw new Error('clipboard unavailable'); });
  await expect(copy({ sender: {} }, '另一条合成话术')).resolves.toEqual({ ok: false, message: '复制失败，请重试' });
  expect(committed).toHaveBeenCalledTimes(1);
  committed.mockImplementationOnce(() => { throw new Error('notification failed'); });
  await expect(copy({ sender: {} }, '第三条合成话术')).resolves.toEqual({ ok: true, feedbackSyncFailed: true });
});
