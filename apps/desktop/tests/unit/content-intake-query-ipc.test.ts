// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { registerContentIntakeQueryIpc } from '../../src/main/content-intake-query-ipc';
import { ProductHttpError } from '../../src/main/product-http';
import { IPC_CHANNELS as C } from '../../src/shared/ipc-channels';
import type { IntakeUsageSession } from '../../src/main/content-intake-usage';
import { intakeQueryData } from '../fixtures/intake-query-data';
import { intakeQuery } from '../../src/preload/content-intake-query';
const handlers = vi.hoisted(() => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>());
const clipboardWrite = vi.hoisted(() => vi.fn());
const renderer = vi.hoisted(() => ({ event: null as IpcMainInvokeEvent | null,
  listeners: new Map<string, (event: unknown, ...args: unknown[]) => void>() }));
const oldContext = '11111111-1111-4111-8111-111111111111';
const newContext = '22222222-2222-4222-8222-222222222222';
vi.mock('electron', () => ({ clipboard: {},
  ipcMain: { handle: (name: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => handlers.set(name, fn), removeHandler: (name: string) => handlers.delete(name) },
  ipcRenderer: {
    on: (name: string, fn: (event: unknown, ...args: unknown[]) => void) => renderer.listeners.set(name, fn),
    invoke: (name: string, ...args: unknown[]) => {
      const handler = handlers.get(name);
      if (!handler || !renderer.event) throw new Error('missing synthetic IPC handler');
      return handler(renderer.event, ...args);
    },
  },
}));
vi.mock('../../src/main/system-clipboard', () => ({ writeSystemClipboard: clipboardWrite }));
it('guards all FAQ capabilities with trusted Query main-frame identity, exact payload and profile', async () => {
  const frame = { parent: null };
  const query = { id: 1, isDestroyed: () => false, getURL: () => 'http://127.0.0.1:5173/?role=query', mainFrame: frame } as unknown as WebContents;
  const fox = { ...query, id: 2 } as WebContents;
  const dispose = registerContentIntakeQueryIpc(null, () => [query, fox], wc => wc.id === 1 ? 'query' : 'fox', () => 'http://127.0.0.1:5173/');
  const event = (sender: WebContents, senderFrame: unknown = frame) => ({ sender, senderFrame }) as IpcMainInvokeEvent;
  try {
    for (const [channel, args] of [
      [C.INTAKE_QUERY_MODE, []], [C.INTAKE_QUERY_ACCESS, []], [C.INTAKE_QUERY_SELECT, [{ shopId: 'shop-a' }]],
      [C.INTAKE_QUERY_CONDITIONS, [{ productIds: [], scenarioIds: [] }]],
      [C.INTAKE_QUERY_SEARCH, [{ queryText: '洁面', contextId: oldContext }]], [C.INTAKE_QUERY_COPY, [{ key: 'opaque' }]], [C.INTAKE_QUERY_CANCEL, []],
    ] as const) {
      const invoke = handlers.get(channel)!;
      for (const ev of [event(fox), event(query, {}), event(query, { parent: frame }), event({ ...query, id: 3 } as WebContents)]) {
        expect(await invoke(ev, ...args)).toMatchObject({ code: 'FORBIDDEN' });
      }
      expect(await invoke(event(query), ...args, {})).toMatchObject({ code: 'VALIDATION' });
      expect(await invoke(event(query), ...args)).toMatchObject(channel === C.INTAKE_QUERY_MODE ? { enabled: false } : { code: 'UNAVAILABLE' });
    }
    expect(await handlers.get(C.INTAKE_QUERY_COPY)!(event(query), { key: 'opaque', text: 'forged' })).toMatchObject({ code: 'VALIDATION' });
    expect(await handlers.get(C.INTAKE_QUERY_SEARCH)!(event(query), { queryText: 'x'.repeat(501), contextId: oldContext })).toMatchObject({ code: 'VALIDATION' });
    expect(await handlers.get(C.INTAKE_QUERY_SEARCH)!(event(query), { queryText: '洁面', contextId: 'invalid' })).toMatchObject({ code: 'VALIDATION' });
  } finally { dispose(); }
  expect(handlers.size).toBe(0);
});
it('awaits online copy verification and forwards denial and invalidation through the Query IPC', async () => {
  const wire = intakeQueryData(), sent = vi.fn();
  let factsExpired = false;
  const frame = { parent: null };
  const query = { id: 1, isDestroyed: () => false, getURL: () => 'http://127.0.0.1:5173/?role=query',
    mainFrame: frame, send: sent, once: vi.fn() } as unknown as WebContents;
  const session: IntakeUsageSession = { view: () => ({ signedIn: true, sessionEpoch: 1 }),
    subscribe: () => () => undefined, request: async (_epoch, path, options) => {
      if (factsExpired && path.startsWith('/v1/intake/snapshot?')) throw new ProductHttpError('FORBIDDEN', 'ORG_FACTS_UNAVAILABLE');
      return { value: wire.respond(path, options.body) };
    } };
  const dispose = registerContentIntakeQueryIpc(session, () => [query], () => 'query', () => 'http://127.0.0.1:5173/');
  const event = { sender: query, senderFrame: frame } as IpcMainInvokeEvent;
  try {
    clipboardWrite.mockClear();
    await handlers.get(C.INTAKE_QUERY_SELECT)!(event, { shopId: 'shop-a' });
    const result = await handlers.get(C.INTAKE_QUERY_SEARCH)!(event, { queryText: '洁面', contextId: oldContext });
    expect(result).toMatchObject({ ok: true });
    if (!result || typeof result !== 'object' || !('rows' in result) || !Array.isArray(result.rows)) throw new Error('missing rows');
    const key = result.rows[0].key;
    expect(await handlers.get(C.INTAKE_QUERY_COPY)!(event, { key })).toEqual({ ok: true, copied: true });
    expect(clipboardWrite).toHaveBeenCalledTimes(1);
    factsExpired = true;
    expect(await handlers.get(C.INTAKE_QUERY_COPY)!(event, { key })).toMatchObject({ ok: false, code: 'FACTS_EXPIRED' });
    expect(sent).toHaveBeenCalledWith(C.INTAKE_QUERY_INVALIDATED, { reason: 'facts-expired', contextId: oldContext });
    expect(clipboardWrite).toHaveBeenCalledTimes(1);
    factsExpired = false;
    const fresh = await handlers.get(C.INTAKE_QUERY_SEARCH)!(event, { queryText: '洁面', contextId: newContext });
    if (!fresh || typeof fresh !== 'object' || !('rows' in fresh) || !Array.isArray(fresh.rows)) throw new Error('missing fresh rows');
    wire.state.revoked = true;
    expect(await handlers.get(C.INTAKE_QUERY_COPY)!(event, { key: fresh.rows[0].key })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(clipboardWrite).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledWith(C.INTAKE_QUERY_INVALIDATED, { reason: 'invalidated', contextId: newContext });
  } finally { dispose(); }
});

it('queues a Main invalidation before a replacement search and delivers it through preload while that search waits', async () => {
  const wire = intakeQueryData(), queued: { channel: string; value: unknown }[] = [];
  let factsExpired = false, waitForReplacement = false, replacementStarted = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const frame = { parent: null };
  const query = { id: 1, isDestroyed: () => false, getURL: () => 'http://127.0.0.1:5173/?role=query',
    mainFrame: frame, send: (channel: string, value: unknown) => queued.push({ channel, value }), once: vi.fn() } as unknown as WebContents;
  const session: IntakeUsageSession = { view: () => ({ signedIn: true, sessionEpoch: 1 }),
    subscribe: () => () => undefined, request: async (_epoch, path, options) => {
      if (factsExpired && path.startsWith('/v1/intake/snapshot?')) throw new ProductHttpError('FORBIDDEN', 'ORG_FACTS_UNAVAILABLE');
      if (waitForReplacement && path === '/v1/intake/entitlements') { replacementStarted = true; await gate; }
      return { value: wire.respond(path, options.body) };
    } };
  const dispose = registerContentIntakeQueryIpc(session, () => [query], () => 'query', () => 'http://127.0.0.1:5173/');
  renderer.event = { sender: query, senderFrame: frame } as IpcMainInvokeEvent;
  const listener = vi.fn(), unsubscribe = intakeQuery.onInvalidated(listener);
  try {
    clipboardWrite.mockClear();
    expect(await intakeQuery.selectShop({ shopId: 'shop-a' })).toMatchObject({ ok: true });
    const old = await intakeQuery.search({ queryText: '洁面', contextId: oldContext });
    if (!old.ok || !old.rows[0]) throw new Error('missing old result');
    factsExpired = true;
    expect(await intakeQuery.copy({ key: old.rows[0].key })).toMatchObject({ code: 'FACTS_EXPIRED' });
    expect(queued).toEqual([{ channel: C.INTAKE_QUERY_INVALIDATED, value: { reason: 'facts-expired', contextId: oldContext } }]);
    expect(listener).not.toHaveBeenCalled();
    factsExpired = false; waitForReplacement = true;
    const pending = intakeQuery.search({ queryText: '洁面', contextId: newContext });
    await vi.waitUntil(() => replacementStarted);
    const deliver = renderer.listeners.get(C.INTAKE_QUERY_INVALIDATED)!;
    deliver({}, 'facts-expired');
    deliver({}, { reason: 'facts-expired', contextId: 'bad' });
    deliver({}, { reason: 'facts-expired', contextId: oldContext, extra: true });
    expect(listener).not.toHaveBeenCalled();
    deliver({}, queued[0]!.value);
    expect(listener).toHaveBeenCalledExactlyOnceWith({ reason: 'facts-expired', contextId: oldContext });
    release();
    const fresh = await pending;
    if (!fresh.ok || !fresh.rows[0]) throw new Error('missing replacement result');
    expect(await intakeQuery.copy({ key: fresh.rows[0].key })).toEqual({ ok: true, copied: true });
    expect(clipboardWrite).toHaveBeenCalledTimes(1);
  } finally { release(); unsubscribe(); renderer.event = null; dispose(); }
});
