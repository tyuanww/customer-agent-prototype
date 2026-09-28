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

it('marks read on the session userId only, ignoring any renderer-supplied identity', async () => {
  const frame = { parent: null };
  const query = { id: 1, isDestroyed: () => false, getURL: () => 'http://127.0.0.1:5173/?role=query', mainFrame: frame } as unknown as WebContents;
  const fox = { ...query, id: 2 } as WebContents;
  const markRead = vi.fn();
  const unread = vi.fn(() => ({ ok: true as const, signedIn: true as const, unread: true, domains: ['presale'] as const }));
  const announce = {
    markRead, unread,
    onInvalidated: () => () => {},
    onContentUpdated: () => () => {},
  } as unknown as Parameters<typeof registerProductAnnounceIpc>[0];
  registerProductAnnounceIpc(announce, () => [query, fox], wc => wc.id === 1 ? 'query' : 'fox', () => 'http://127.0.0.1:5173/');
  const event = (sender: WebContents) => ({ sender, senderFrame: frame }) as IpcMainInvokeEvent;

  // A renderer that smuggles a foreign userId as a second argument is rejected: only the
  // domain list argument is accepted, and the store keys off session.view().userId.
  const mark = handlers.get(IPC_CHANNELS.PRODUCT_ANNOUNCE_MARK_READ)!;
  await mark(event(query), ['presale'], 'usr_other');
  expect(markRead).not.toHaveBeenCalled();
  await mark(event(query), ['presale']);
  expect(markRead).toHaveBeenCalledWith(['presale']);
  // Fox may not mark read.
  await mark(event(fox), ['presale']);
  expect(markRead).toHaveBeenCalledTimes(1);

  const read = handlers.get(IPC_CHANNELS.PRODUCT_ANNOUNCE_UNREAD)!;
  expect(await read(event(fox))).toMatchObject({ ok: true, unread: true, domains: ['presale'] });
  // An unknown role gets no projection.
  const other = { ...query, id: 3 } as WebContents;
  registerProductAnnounceIpc(announce, () => [other], () => null, () => 'http://127.0.0.1:5173/');
  const readOther = handlers.get(IPC_CHANNELS.PRODUCT_ANNOUNCE_UNREAD)!;
  expect(await readOther(event(other))).toMatchObject({ ok: false, unread: false });
});
