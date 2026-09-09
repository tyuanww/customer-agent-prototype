import { expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { registerProductAnnounceIpc } from '../../src/main/product-announce-ipc';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
const handlers = vi.hoisted(() => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>());
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => handlers.set(name, fn) } }));
it('rejects Fox, subframes, extra arguments and unsigned Query', async () => {
  const frame = { parent: null };
  const query = { id: 1, isDestroyed: () => false, getURL: () => 'http://127.0.0.1:5173/?role=query', mainFrame: frame } as unknown as WebContents;
  const fox = { ...query, id: 2 } as WebContents;
  registerProductAnnounceIpc(null, () => [query, fox], wc => wc.id === 1 ? 'query' : 'fox', () => 'http://127.0.0.1:5173/');
  const event = (sender: WebContents, senderFrame: unknown = frame) => ({ sender, senderFrame }) as IpcMainInvokeEvent;
  const invoke = handlers.get(IPC_CHANNELS.PRODUCT_ANNOUNCE_REFRESH)!;
  expect(await invoke(event(fox), { sessionEpoch: 1, generation: 1 })).toMatchObject({ code: 'FORBIDDEN' });
  expect(await invoke(event(query, {}), { sessionEpoch: 1, generation: 1 })).toMatchObject({ code: 'FORBIDDEN' });
  expect(await invoke(event(query), {}, {})).toMatchObject({ code: 'VALIDATION' });
  expect(await invoke(event(query), { sessionEpoch: 1, generation: 1 })).toMatchObject({ code: 'UNAUTHORIZED' });
});
