import { existsSync, unlinkSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';

vi.hoisted(() => {
  process.env.CUSTOMER_AGENT_RETRIEVAL_PREFERENCE =
    `${process.env.TMPDIR || '/tmp'}/retrieval-pref-ipc-${process.pid}.json`;
});

import { registerProductSearchIpc } from '../../src/main/product-search-ipc';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { DEFAULT_RETRIEVAL_PREFERENCE } from '../../src/shared/retrieval-preference';
const handlers = vi.hoisted(() => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>());
vi.mock('electron', () => ({ clipboard: { writeText: vi.fn() }, ipcMain: { handle: (name: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => handlers.set(name, fn) } }));
beforeEach(() => {
  const file = process.env.CUSTOMER_AGENT_RETRIEVAL_PREFERENCE;
  if (file && existsSync(file)) unlinkSync(file);
});
it('rejects Fox, unknown windows, subframes, extra arguments and unsigned Query', async () => {
  const frame = { parent: null };
  const query = { id: 1, isDestroyed: () => false, getURL: () => 'http://127.0.0.1:5173/?role=query', mainFrame: frame } as unknown as WebContents;
  const fox = { ...query, id: 2 } as WebContents;
  registerProductSearchIpc(null, null, () => [query, fox], wc => wc.id === 1 ? 'query' : 'fox', () => 'http://127.0.0.1:5173/');
  const event = (sender: WebContents, senderFrame: unknown = frame) => ({ sender, senderFrame }) as IpcMainInvokeEvent;
  for (const channel of [IPC_CHANNELS.PRODUCT_SEARCH, IPC_CHANNELS.PRODUCT_COPY_ADOPT, IPC_CHANNELS.PRODUCT_CANCEL_SEARCH,
    IPC_CHANNELS.PRODUCT_ESCALATE, IPC_CHANNELS.PRODUCT_RECORD_TERMINAL]) {
    const invoke = handlers.get(channel)!;
    expect(await invoke(event(fox), {})).toMatchObject({ code: 'FORBIDDEN' });
    expect(await invoke(event(query, {}), {})).toMatchObject({ code: 'FORBIDDEN' });
    expect(await invoke(event({ ...query, id: 3 } as WebContents), {})).toMatchObject({ code: 'FORBIDDEN' });
    expect(await invoke(event(query), {}, {})).toMatchObject({ code: 'VALIDATION' });
    expect(await invoke(event(query), {})).toMatchObject({ code: 'UNAUTHORIZED' });
  }
});

it('defaults retrieval preference for Fox senders and refuses invalid writes', async () => {
  const frame = { parent: null };
  const query = { id: 1, isDestroyed: () => false, getURL: () => 'http://127.0.0.1:5173/?role=query', mainFrame: frame } as unknown as WebContents;
  const fox = { ...query, id: 2 } as WebContents;
  registerProductSearchIpc(null, null, () => [query, fox], wc => wc.id === 1 ? 'query' : 'fox', () => 'http://127.0.0.1:5173/');
  const event = (sender: WebContents, senderFrame: unknown = frame) => ({ sender, senderFrame }) as IpcMainInvokeEvent;
  const get = handlers.get(IPC_CHANNELS.PRODUCT_RETRIEVAL_PREFERENCE_GET)!;
  const set = handlers.get(IPC_CHANNELS.PRODUCT_RETRIEVAL_PREFERENCE_SET)!;
  expect(await get(event(fox))).toEqual(DEFAULT_RETRIEVAL_PREFERENCE);
  expect(await set(event(fox), { smartEnabled: false })).toEqual(DEFAULT_RETRIEVAL_PREFERENCE);
  expect(await get(event(query))).toEqual(DEFAULT_RETRIEVAL_PREFERENCE);
  expect(await set(event(query), { smartEnabled: false })).toEqual({ smartEnabled: false });
  expect(await get(event(query))).toEqual({ smartEnabled: false });
  expect(await set(event(query), { smartEnabled: false }, 'extra')).toEqual({ smartEnabled: false });
  expect(await set(event(query), { smartEnabled: 'yes' })).toEqual({ smartEnabled: false });
  expect(await get(event(fox))).toEqual(DEFAULT_RETRIEVAL_PREFERENCE);
});
