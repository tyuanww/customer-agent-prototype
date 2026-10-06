// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { registerContentIntakeQueryIpc } from '../../src/main/content-intake-query-ipc';
import { IPC_CHANNELS as C } from '../../src/shared/ipc-channels';
const handlers = vi.hoisted(() => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>());
vi.mock('electron', () => ({ clipboard: {}, ipcMain: { handle: (name: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => handlers.set(name, fn), removeHandler: (name: string) => handlers.delete(name) } }));
it('guards all FAQ capabilities with trusted Query main-frame identity, exact payload and profile', async () => {
  const frame = { parent: null };
  const query = { id: 1, isDestroyed: () => false, getURL: () => 'http://127.0.0.1:5173/?role=query', mainFrame: frame } as unknown as WebContents;
  const fox = { ...query, id: 2 } as WebContents;
  const dispose = registerContentIntakeQueryIpc(null, () => [query, fox], wc => wc.id === 1 ? 'query' : 'fox', () => 'http://127.0.0.1:5173/');
  const event = (sender: WebContents, senderFrame: unknown = frame) => ({ sender, senderFrame }) as IpcMainInvokeEvent;
  try {
    for (const [channel, args] of [
      [C.INTAKE_QUERY_MODE, []], [C.INTAKE_QUERY_ACCESS, []], [C.INTAKE_QUERY_SELECT, [{ shopId: 'shop-a' }]],
      [C.INTAKE_QUERY_SEARCH, [{ queryText: '洁面' }]], [C.INTAKE_QUERY_COPY, [{ key: 'opaque' }]], [C.INTAKE_QUERY_CANCEL, []],
    ] as const) {
      const invoke = handlers.get(channel)!;
      for (const ev of [event(fox), event(query, {}), event(query, { parent: frame }), event({ ...query, id: 3 } as WebContents)]) {
        expect(await invoke(ev, ...args)).toMatchObject({ code: 'FORBIDDEN' });
      }
      expect(await invoke(event(query), ...args, {})).toMatchObject({ code: 'VALIDATION' });
      expect(await invoke(event(query), ...args)).toMatchObject(channel === C.INTAKE_QUERY_MODE ? { enabled: false } : { code: 'UNAVAILABLE' });
    }
    expect(await handlers.get(C.INTAKE_QUERY_COPY)!(event(query), { key: 'opaque', text: 'forged' })).toMatchObject({ code: 'VALIDATION' });
    expect(await handlers.get(C.INTAKE_QUERY_SEARCH)!(event(query), { queryText: 'x'.repeat(501) })).toMatchObject({ code: 'VALIDATION' });
  } finally { dispose(); }
  expect(handlers.size).toBe(0);
});
