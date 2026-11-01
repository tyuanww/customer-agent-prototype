import { beforeEach, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { registerSopWindowIpc, type SopWindowIpcHost } from '../../src/main/sop-window-ipc';
import type { OverlayController } from '../../src/main/overlay-controller';
import type { SopWindowController } from '../../src/main/sop-window-controller';
import type { SopPresentationOwner } from '../../src/main/sop-presentation-owner';
import { SopRenameDraftOwner } from '../../src/main/sop-rename-draft-owner';
type Handler = (event: IpcMainInvokeEvent, request?: unknown) => unknown;
const handlers = vi.hoisted(() => new Map<string, Handler>());
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: Handler) => handlers.set(name, fn) } }));
function sender(id: number, role: string) {
  const mainFrame = { parent: null };
  const sender = { id, mainFrame, isDestroyed: () => false, getURL: () => `http://127.0.0.1:5173/?role=${role}` } as unknown as WebContents;
  return { sender, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
}
const query = sender(1, 'query'), floating = sender(2, 'sop-floating'), fox = sender(3, 'fox'), impostor = sender(4, 'sop-floating'), otherFloating = sender(5, 'sop-floating');
const command = vi.fn(() => ({ ok: true })), copy = vi.fn(() => ({ ok: false, message: '测试' })), rename = vi.fn(() => ({ ok: true })), ready = vi.fn(() => true);
const showQueryReady = vi.fn(() => true);
const currentSnapshot = vi.fn(() => ({ kind: 'ready' }));
const drafts = new SopRenameDraftOwner();
const current = { taskId: 'task-a', revision: 1, stepIndex: 1 }, epoch = 7;
let activeHost: 'query' | 'floating' = 'floating';
beforeEach(() => {
  handlers.clear(); vi.clearAllMocks(); drafts.clearAll(); activeHost = 'floating';
  const overlay = { rendererDevServerUrl: 'http://127.0.0.1:5173/', trustedContents: () => [query.sender, fox.sender],
    overlayRoleOf: (content: WebContents) => content.id === 1 ? 'query' : 'fox', queryPresentation: () => ({ viewEpoch: 1 }) } as unknown as OverlayController;
  const sop = { command, copyCurrent: copy, rename, open: vi.fn(), entryAvailable: () => true } as unknown as SopWindowController;
  const canExecute = (host: string, id: string, value: number, floatingTask?: string) => host === activeHost && ((id === current.taskId && value === epoch) || (id === 'task-b' && value === 9))
      && (host !== 'floating' || floatingTask === id);
  const presentation = { floatingTaskFor: (content: WebContents) => content === floating.sender ? current.taskId : content === otherFloating.sender ? 'task-b' : null,
    canExecute, canEditDraft: canExecute, showQueryReady, clearDraft: (id: string) => drafts.clear(id),
    draftCurrent: (id: string) => drafts.current(id), draftStart: (id: string, revision: number) => drafts.start(id, revision, null),
    draftUpdate: (id: string, draftId: number, sequence: number, value: string) => drafts.update(id, draftId, sequence, value),
    draftDiscard: (id: string, draftId: number) => drafts.discard(id, draftId),
    ready, snapshot: () => ({ kind: 'ready' }), currentSnapshot, windowIntent: vi.fn() } as unknown as SopPresentationOwner;
  const host: SopWindowIpcHost = { getOverlay: () => overlay, getSop: () => sop, getPresentation: () => presentation };
  registerSopWindowIpc(host);
});
it('only accepts exact show-query acknowledgements from the trusted Query main frame', () => {
  const request = { requestId: 1, taskId: 'task-a', hostEpoch: 7, accepted: true };
  expect(call('query-sop:show-query-ready', query, request)).toBe(true);
  expect(call('query-sop:show-query-ready', floating, request)).toBe(false);
  expect(call('query-sop:show-query-ready', { ...query, senderFrame: { parent: null } } as IpcMainInvokeEvent, request)).toBe(false);
  expect(call('query-sop:show-query-ready', query, { ...request, role: 'query' })).toBe(false);
  expect(call('query-sop:show-query-ready', query, { ...request, requestId: 0 })).toBe(false);
  expect(showQueryReady).toHaveBeenCalledExactlyOnceWith(request);
});
it('binds draft edits to the sender lease, preserves composition length, and rejects delayed writes', () => {
  const identity = { taskId: current.taskId, hostEpoch: epoch };
  const started = call('sop-floating:draft-start', floating, { ...identity, revision: 1 });
  expect(started).toMatchObject({ ok: true, draft: { sequence: 0 } });
  const draft = drafts.current(current.taskId);
  if (!draft) throw new Error('Expected draft');
  const update = { ...identity, draftId: draft.draftId, sequence: 1, value: '甲'.repeat(21) };
  expect(call('sop-floating:draft-update', floating, update)).toBe(true);
  expect(call('sop-floating:draft-update', otherFloating, { ...update, sequence: 2 })).toBe(false);
  expect(call('sop-floating:draft-update', floating, { ...update, hostEpoch: epoch - 1, sequence: 2 })).toBe(false);
  expect(call('sop-floating:draft-update', floating, { ...update, sequence: 2, value: '甲'.repeat(257) })).toBe(false);
  expect(call('sop-floating:draft-current', floating, identity)).toMatchObject({ ok: true, draft: { value: '甲'.repeat(21) } });
  expect(call('sop-floating:draft-discard', floating, { ...identity, draftId: draft.draftId })).toBe(true);
  expect(call('sop-floating:draft-update', floating, { ...update, sequence: 2 })).toBe(false);
});
it('binds a floating sender to its own task even if another lease is known', () => {
  expect(call('sop-floating:command', otherFloating, { ...current, type: 'next', hostEpoch: epoch })).toMatchObject({ ok: false });
  expect(call('sop-floating:command', otherFloating, { taskId: 'task-b', revision: 1, stepIndex: 1, type: 'next', hostEpoch: 9 })).toEqual({ ok: true });
  expect(command).toHaveBeenCalledOnce();
});
function call(channel: string, event: IpcMainInvokeEvent, request: unknown) { const fn = handlers.get(channel); if (!fn) throw new Error('Missing channel'); return fn(event, request); }
it('requires actual floating contents, expected role, main frame and current execution epoch', () => {
  const request = { ...current, type: 'next', hostEpoch: epoch };
  expect(call('sop-floating:command', floating, request)).toEqual({ ok: true });
  expect(command).toHaveBeenCalledWith({ ...current, type: 'next' });
  for (const event of [query, fox, impostor, { ...floating, senderFrame: { parent: null } } as IpcMainInvokeEvent]) {
    expect(call('sop-floating:command', event, request)).toMatchObject({ ok: false });
  }
  for (const invalid of [{ ...request, hostEpoch: epoch - 1 }, { ...request, hostEpoch: undefined }, { ...request, role: 'floating' }]) {
    expect(call('sop-floating:command', floating, invalid)).toMatchObject({ ok: false });
  }
  expect(command).toHaveBeenCalledOnce();
});
it('does not grant floating task management, ordinary search or background close', () => {
  expect(call('query-sop:rename', floating, { taskId: 'task-a', revision: 1, displayName: '甲' })).toMatchObject({ ok: false });
  expect(call('query-sop:end-task', floating, current)).toMatchObject({ ok: false });
  expect(call('sop-floating:command', floating, { ...current, type: 'end' })).toMatchObject({ ok: false });
  expect(rename).not.toHaveBeenCalled(); expect(command).not.toHaveBeenCalled();
  expect(call('query-sop:end-task', query, { ...current, type: 'next' })).toMatchObject({ ok: false });
  expect(call('query-sop:end-task', query, current)).toEqual({ ok: true });
});
it('validates exact ready intent and sender before handing it to presentation', () => {
  expect(call('sop-floating:ready', floating, { mountId: 2 })).toBe(true);
  expect(call('sop-floating:ready', query, { mountId: 2 })).toBe(false);
  expect(call('sop-floating:ready', floating, { mountId: 2, hostEpoch: 9 })).toBe(false);
  expect(ready).toHaveBeenCalledOnce();
});
it('records current projection delivery only for the trusted floating main frame', () => {
  expect(call('sop-floating:current', floating, undefined)).toEqual({ kind: 'ready' });
  expect(currentSnapshot).toHaveBeenCalledExactlyOnceWith('floating', 'task-a');
  expect(call('sop-floating:current', query, undefined)).toMatchObject({ kind: 'unavailable' });
  expect(currentSnapshot).toHaveBeenCalledOnce();
  expect(call('query-sop:current', query, undefined)).toEqual({ kind: 'ready' });
  expect(currentSnapshot).toHaveBeenLastCalledWith('query', undefined);
  expect(call('query-sop:current', floating, undefined)).toMatchObject({ kind: 'unavailable' });
  expect(currentSnapshot).toHaveBeenCalledTimes(2);
});
it('renames only the task currently executable in the floating host', () => {
  const request = { taskId: current.taskId, revision: current.revision, displayName: '合成客户甲', hostEpoch: epoch };
  expect(call('sop-floating:rename-current', floating, request)).toEqual({ ok: true });
  expect(rename).toHaveBeenCalledWith({ taskId: current.taskId, revision: current.revision, displayName: '合成客户甲' });
  for (const event of [query, fox, impostor, { ...floating, senderFrame: { parent: null } } as IpcMainInvokeEvent]) {
    expect(call('sop-floating:rename-current', event, request)).toMatchObject({ ok: false });
  }
  for (const invalid of [
    { ...request, taskId: 'other-task' }, { ...request, hostEpoch: epoch - 1 },
    { ...request, hostEpoch: undefined }, { ...request, role: 'floating' },
    { ...request, displayName: '' }, { ...request, displayName: '甲'.repeat(21) },
    { ...request, revision: 0 },
  ]) {
    expect(call('sop-floating:rename-current', floating, invalid)).toMatchObject({ ok: false });
  }
  expect(rename).toHaveBeenCalledOnce();
});
it('requires the query host to own the active task before renaming from its steps page', () => {
  const request = { taskId: current.taskId, revision: current.revision, displayName: null, hostEpoch: epoch };
  expect(call('query-sop:rename-current', query, request)).toMatchObject({ ok: false });
  activeHost = 'query';
  expect(call('query-sop:rename-current', query, request)).toEqual({ ok: true });
  expect(rename).toHaveBeenCalledExactlyOnceWith({ taskId: current.taskId, revision: current.revision, displayName: null });
  expect(call('query-sop:rename-current', floating, request)).toMatchObject({ ok: false });
});
