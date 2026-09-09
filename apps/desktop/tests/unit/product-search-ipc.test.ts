import { expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { registerProductSearchIpc } from '../../src/main/product-search-ipc';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
const handlers = vi.hoisted(() => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>());
vi.mock('electron', () => ({ clipboard: { writeText: vi.fn() }, ipcMain: { handle: (name: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => handlers.set(name, fn) } }));
it('rejects Fox, unknown windows, subframes, extra arguments and unsigned Query', async () => {
  const frame = { parent: null };
  const query = { id: 1, isDestroyed: () => false, getURL: () => 'http://127.0.0.1:5173/?role=query', mainFrame: frame } as unknown as WebContents;
  const fox = { ...query, id: 2 } as WebContents;
  registerProductSearchIpc(null, null, () => [query, fox], wc => wc.id === 1 ? 'query' : 'fox', () => 'http://127.0.0.1:5173/');
  const event = (sender: WebContents, senderFrame: unknown = frame) => ({ sender, senderFrame }) as IpcMainInvokeEvent;
  for (const channel of [IPC_CHANNELS.PRODUCT_SEARCH, IPC_CHANNELS.PRODUCT_COPY_ADOPT, IPC_CHANNELS.PRODUCT_CANCEL_SEARCH]) {
    const invoke = handlers.get(channel)!;
    expect(await invoke(event(fox), {})).toMatchObject({ code: 'FORBIDDEN' });
    expect(await invoke(event(query, {}), {})).toMatchObject({ code: 'FORBIDDEN' });
    expect(await invoke(event({ ...query, id: 3 } as WebContents), {})).toMatchObject({ code: 'FORBIDDEN' });
    expect(await invoke(event(query), {}, {})).toMatchObject({ code: 'VALIDATION' });
    expect(await invoke(event(query), {})).toMatchObject({ code: 'UNAUTHORIZED' });
  }
});
