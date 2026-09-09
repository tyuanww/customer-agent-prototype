import { expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { registerProductIpc } from '../../src/main/product-ipc';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
const handlers = vi.hoisted(() => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>());
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => handlers.set(name, callback) } }));
it('admits only known main frames; fox can read status but cannot login', async () => {
  const frame = { parent: null };
  const query = { id: 1, isDestroyed: () => false, getURL: () => 'http://127.0.0.1:5173/?role=query', mainFrame: frame } as unknown as WebContents;
  const fox = { ...query, id: 2 } as WebContents;
  registerProductIpc(null, () => [query, fox], wc => wc.id === 1 ? 'query' : 'fox', () => 'http://127.0.0.1:5173/');
  const event = (sender: WebContents, senderFrame: unknown = frame) => ({ sender, senderFrame }) as IpcMainInvokeEvent;
  expect(await handlers.get(IPC_CHANNELS.PRODUCT_LOGIN)!(event(fox))).toMatchObject({ code: 'FORBIDDEN' });
  expect(await handlers.get(IPC_CHANNELS.PRODUCT_SESSION_STATUS)!(event(fox))).toMatchObject({ enabled: false });
  expect(await handlers.get(IPC_CHANNELS.PRODUCT_LOGIN)!(event(query, {}))).toMatchObject({ code: 'FORBIDDEN' });
  expect(await handlers.get(IPC_CHANNELS.PRODUCT_LOGIN)!(event(query), { role: 'owner' })).toMatchObject({ code: 'VALIDATION' });
  expect(await handlers.get(IPC_CHANNELS.PRODUCT_LOGIN)!(event({ ...query, id: 3 } as WebContents))).toMatchObject({ code: 'FORBIDDEN' });
});
