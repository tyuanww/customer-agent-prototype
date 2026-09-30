import { expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { registerProductIpc } from '../../src/main/product-ipc';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
const handlers = vi.hoisted(() => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>());
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => handlers.set(name, callback) } }));
it('fans session changes to query and dashboard, not fox', () => {
  const frame = { parent: null };
  const query = {
    id: 1,
    isDestroyed: () => false,
    getURL: () => 'http://127.0.0.1:5173/?role=query',
    mainFrame: frame,
    send: vi.fn(),
  } as unknown as WebContents;
  const fox = { ...query, id: 2, send: vi.fn() } as unknown as WebContents;
  const dashboard = { ...query, id: 10, send: vi.fn() } as unknown as WebContents;
  const listeners = new Set<(value: unknown) => void>();
  const session = {
    subscribe: (listener: (value: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  };
  registerProductIpc(
    session as never,
    () => [query, fox],
    (wc) => (wc.id === 1 ? 'query' : 'fox'),
    () => 'http://127.0.0.1:5173/',
    () => [dashboard],
  );
  const payload = { ok: true, signedIn: true };
  for (const listener of listeners) listener(payload);
  expect(query.send).toHaveBeenCalledWith(IPC_CHANNELS.PRODUCT_SESSION_CHANGED, payload);
  expect(dashboard.send).toHaveBeenCalledWith(IPC_CHANNELS.PRODUCT_SESSION_CHANGED, payload);
  expect(fox.send).not.toHaveBeenCalled();
});

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

it('keeps notice reads and decisions query-only with strict arguments', async () => {
  const frame = { parent: null };
  const query = { id: 21, isDestroyed: () => false, getURL: () => 'http://127.0.0.1:5173/?role=query', mainFrame: frame } as unknown as WebContents;
  const fox = { ...query, id: 22 } as WebContents;
  const session = {
    subscribe: () => () => {},
    status: vi.fn(), login: vi.fn(), logout: vi.fn(),
    currentNotice: vi.fn().mockResolvedValue({ ok: true, sessionEpoch: 4, notice: {}, decision: null, decided_at: null }),
    decideNotice: vi.fn().mockResolvedValue({ ok: true, sessionEpoch: 4, version: 'pilot-notice-v1', decision: 'accepted', decided_at: '2026-09-30T00:00:00.000Z' }),
  };
  registerProductIpc(session as never, () => [query, fox], wc => wc.id === 21 ? 'query' : 'fox', () => 'http://127.0.0.1:5173/');
  const event = (sender: WebContents) => ({ sender, senderFrame: frame }) as IpcMainInvokeEvent;
  expect(await handlers.get(IPC_CHANNELS.PRODUCT_NOTICE_CURRENT)!(event(query))).toMatchObject({ ok: true, sessionEpoch: 4 });
  expect(await handlers.get(IPC_CHANNELS.PRODUCT_NOTICE_DECISION)!(event(fox), { version: 'pilot-notice-v1', decision: 'accepted' })).toMatchObject({ code: 'FORBIDDEN' });
  expect(await handlers.get(IPC_CHANNELS.PRODUCT_NOTICE_DECISION)!(event(query), { version: '../notice', decision: 'accepted' })).toMatchObject({ code: 'VALIDATION' });
  expect(await handlers.get(IPC_CHANNELS.PRODUCT_NOTICE_DECISION)!(event(query), { version: 'pilot-notice-v1', decision: 'accepted' })).toMatchObject({ ok: true, decision: 'accepted' });
  expect(session.decideNotice).toHaveBeenCalledWith({ version: 'pilot-notice-v1', decision: 'accepted' });
});
