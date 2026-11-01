import { afterEach, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import { SopPresentationOwner } from '../../src/main/sop-presentation-owner';
import { SopWindowController } from '../../src/main/sop-window-controller';
import { MISSING_ITEM_SOP_SCENE_ID } from '../../src/shared/sop-entry';
vi.mock('electron', () => ({ clipboard: { writeText: vi.fn() }, BrowserWindow: vi.fn() }));
const owners: SopPresentationOwner[] = [];
afterEach(() => owners.splice(0).forEach(owner => owner.destroy()));
afterEach(() => vi.useRealTimers());
function setup(options: { showFloating?: () => boolean; restoreQuery?: () => boolean; createDelay?: Promise<void>; floatingContents?: () => WebContents | null; queryContents?: () => WebContents | null; queryHome?: () => void } = {}) {
  let bounds = { x: 0, y: 0, width: 600, height: 420 };
  const area = { x: 0, y: 0, width: 1400, height: 1000 };
  const slot = { getBounds: () => bounds, getWorkArea: () => area, prepare: () => true,
    applyBounds: (next: typeof bounds) => { bounds = next; return true; }, show: () => true, restore: options.restoreQuery ?? (() => true), hide: () => true, failClosed: () => true };
  let floatingBounds = { x: 640, y: 0, width: 580, height: 620 };
  const floating = { ...slot, getBounds: () => floatingBounds, applyBounds: (next: typeof bounds) => { floatingBounds = next; return true; }, show: options.showFloating ?? (() => true), contents: options.floatingContents ?? (() => null), destroy: vi.fn() };
  const domain: SopWindowController = new SopWindowController({ enabled: () => true, sessionRole: () => 'agent',
    presentation: { selectedTask: () => owner.selectedTask(), showTask: id => owner.showTask(id), removeTask: id => owner.removeTask(id), changed: () => owner.publish() } });
  const createFloating = vi.fn(async () => { await options.createDelay; return floating; });
  const queryHome = vi.fn(options.queryHome ?? (() => {}));
  const owner: SopPresentationOwner = new SopPresentationOwner({ domain, query: slot, queryContents: options.queryContents ?? (() => null),
    showOrdinaryQuery: () => true, queryHome, queryPresentation: () => ({ view: { kind: 'query-home' }, viewEpoch: 1, transition: null }), createFloating });
  owners.push(owner);
  return { owner, domain, slot, floating, area, queryHome, createFloating, bounds: () => bounds };
}
it('keeps source executable until target preview ready, then rejects its old epoch', async () => {
  const { owner, domain } = setup();
  const opened = domain.open(MISSING_ITEM_SOP_SCENE_ID);
  await Promise.resolve();
  const preview = owner.snapshot('query');
  expect(preview).toMatchObject({ access: { kind: 'preview' } });
  if (preview.kind !== 'ready' || preview.access.kind !== 'preview') throw new Error('Expected preview');
  expect(owner.ready('query', { mountId: preview.access.mountId })).toBe(true);
  await opened;
  const active = owner.snapshot('query');
  if (active.kind !== 'ready' || active.access.kind !== 'executable' || !active.projection) throw new Error('Expected execution');
  const moving = owner.windowIntent('query', { type: 'detach', taskId: active.projection.taskId, hostEpoch: active.access.hostEpoch });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(owner.canExecute('query', active.projection.taskId, active.access.hostEpoch)).toBe(true);
  const target = owner.snapshot('floating');
  if (target.kind !== 'ready' || target.access.kind !== 'preview') throw new Error('Expected float preview');
  expect(owner.ready('floating', { mountId: target.access.mountId })).toBe(true);
  expect(await moving).toBe(true);
  expect(owner.canExecute('query', active.projection.taskId, active.access.hostEpoch)).toBe(false);
  expect(owner.snapshot('floating')).toMatchObject({ mode: 'floating', access: { kind: 'executable' } });
});
it('renames without resetting checks, selection or copied state', async () => {
  const { owner, domain } = setup();
  const opened = domain.open(MISSING_ITEM_SOP_SCENE_ID); await Promise.resolve();
  const preview = owner.snapshot('query');
  if (preview.kind !== 'ready' || preview.access.kind !== 'preview') throw new Error('Expected preview');
  owner.ready('query', { mountId: preview.access.mountId }); await opened;
  const current = domain.current(); if (!current) throw new Error('Expected task');
  domain.copyCurrent({ taskId: current.taskId, revision: current.revision, stepIndex: current.stepIndex, scriptId: 'syn-missing-ask' });
  const before = domain.current(); if (!before) throw new Error('Expected task');
  expect(domain.rename({ taskId: before.taskId, revision: before.revision, displayName: '合成客户甲' })).toEqual({ ok: true });
  expect(domain.current()).toEqual({ ...before, revision: before.revision + 1 });
  expect(domain.summaries()[0]?.displayName).toBe('合成客户甲');
  expect(domain.rename({ taskId: before.taskId, revision: before.revision, displayName: '过期更名' })).toMatchObject({ ok: false });
  expect(domain.summaries()[0]?.displayName).toBe('合成客户甲');
});

async function activate(owner: SopPresentationOwner, domain: SopWindowController) {
  const opening = domain.open(MISSING_ITEM_SOP_SCENE_ID); await Promise.resolve();
  const snapshot = owner.snapshot('query');
  if (snapshot.kind !== 'ready' || snapshot.access.kind !== 'preview') throw new Error('Expected preview');
  owner.ready('query', snapshot.access); await opening;
}
function execution(owner: SopPresentationOwner, host: 'query' | 'floating') {
  const snap = owner.snapshot(host);
  if (snap.kind !== 'ready' || snap.access.kind !== 'executable' || !snap.projection) throw new Error('Expected execution');
  return { taskId: snap.projection.taskId, hostEpoch: snap.access.hostEpoch };
}
async function finishMove(owner: SopPresentationOwner, host: 'query' | 'floating') {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  const preview = owner.snapshot(host);
  if (preview.kind !== 'ready' || preview.access.kind !== 'preview') throw new Error('Expected preview');
  owner.ready(host, preview.access);
}
it('performs symmetric attach and rejects stale readiness after cancellation', async () => {
  const { owner, domain } = setup(); await activate(owner, domain);
  const detached = owner.windowIntent('query', { ...execution(owner, 'query'), type: 'detach' });
  await finishMove(owner, 'floating'); expect(await detached).toBe(true);
  const original = execution(owner, 'floating');
  const attaching = owner.windowIntent('floating', { ...original, type: 'attach' }, original.taskId); await Promise.resolve();
  const preview = owner.snapshot('query');
  if (preview.kind !== 'ready' || preview.access.kind !== 'preview') throw new Error('Expected preview');
  expect(owner.canExecute('floating', original.taskId, original.hostEpoch, original.taskId)).toBe(true);
  owner.hide('floating');
  expect(await attaching).toBe(false);
  expect(owner.ready('query', preview.access)).toBe(false);
  expect(owner.snapshot('query')).toMatchObject({ access: { kind: 'none' } });
  expect(domain.summaries()).toHaveLength(1);
});
it('shares committed manual dimensions across tasks and hosts, rejecting old gestures', async () => {
  const { owner, domain, floating, area, bounds } = setup(); await activate(owner, domain);
  const identity = execution(owner, 'query');
  await owner.windowIntent('query', { ...identity, type: 'resize-start', gesture: 100, edge: 'se' });
  await owner.windowIntent('query', { ...identity, type: 'resize', gesture: 100, dx: -100, dy: -100 });
  await owner.windowIntent('query', { ...identity, type: 'resize-end', gesture: 100 });
  const detach = owner.windowIntent('query', { ...identity, type: 'detach' }); await finishMove(owner, 'floating'); await detach;
  expect(floating.getBounds()).toMatchObject({ width: 480, height: 520 });
  area.width = 300; area.height = 250;
  const next = execution(owner, 'floating');
  expect(await owner.windowIntent('query', { ...identity, type: 'resize-end', gesture: 100 })).toBe(false);
  expect(await owner.windowIntent('floating', { ...next, type: 'resize-start', gesture: 1, edge: 'se' }, next.taskId)).toBe(true);
  await owner.windowIntent('floating', { ...next, type: 'resize-cancel', gesture: 1 }, next.taskId);
  floating.applyBounds({ x: 0, y: 0, width: 300, height: 250 });
  expect(await owner.windowIntent('floating', { ...next, type: 'resize-start', gesture: 2, edge: 'se' }, next.taskId)).toBe(true);
  expect(await owner.windowIntent('floating', { ...next, type: 'resize-end', gesture: 2 }, next.taskId)).toBe(true);
  area.width = 1400; area.height = 1000;
  const attach = owner.windowIntent('floating', { ...next, type: 'attach' }, next.taskId); await finishMove(owner, 'query'); await attach;
  expect(owner.snapshot('query')).toMatchObject({ access: { kind: 'executable' } });
  owner.finishTransition();
  expect(bounds()).toMatchObject({ width: 480, height: 520 });
});
it('restores the surviving source with a new epoch after native commit fails', async () => {
  const { owner, domain } = setup({ showFloating: () => false }); await activate(owner, domain);
  const source = execution(owner, 'query');
  const moving = owner.windowIntent('query', { ...source, type: 'detach' });
  await finishMove(owner, 'floating'); expect(await moving).toBe(false);
  const restored = execution(owner, 'query');
  expect(restored.hostEpoch).toBeGreaterThan(source.hostEpoch);
  expect(owner.canExecute('query', source.taskId, source.hostEpoch)).toBe(false);
  expect(domain.summaries()).toHaveLength(1);
});
it('settles failed migration even when compensating native cleanup also throws', async () => {
  const { owner, domain, floating } = setup({ showFloating: () => false }); await activate(owner, domain);
  floating.hide = () => { throw new Error('Synthetic native cleanup failure'); };
  const moving = owner.windowIntent('query', { ...execution(owner, 'query'), type: 'detach' });
  await finishMove(owner, 'floating'); expect(await moving).toBe(false);
  expect(owner.snapshot('query')).toMatchObject({ access: { kind: 'executable' } });
});
it('creates only one floating native surface across concurrent migration requests', async () => {
  let release: () => void = () => {};
  const createDelay = new Promise<void>(resolve => { release = resolve; });
  const { owner, domain, createFloating } = setup({ createDelay }); await activate(owner, domain);
  const source = execution(owner, 'query');
  const first = owner.windowIntent('query', { ...source, type: 'detach' });
  const second = owner.windowIntent('query', { ...source, type: 'detach' });
  expect(createFloating).toHaveBeenCalledOnce();
  release(); await finishMove(owner, 'floating');
  expect(await first).toBe(false); expect(await second).toBe(true);
});
it('cancels a closing Query preview while preserving the floating source lease', async () => {
  const { owner, domain } = setup(); await activate(owner, domain);
  const detached = owner.windowIntent('query', { ...execution(owner, 'query'), type: 'detach' });
  await finishMove(owner, 'floating'); await detached;
  const source = execution(owner, 'floating');
  const attaching = owner.windowIntent('floating', { ...source, type: 'attach' }, source.taskId); await Promise.resolve();
  owner.queryDismissed();
  expect(await attaching).toBe(false);
  expect(owner.canExecute('floating', source.taskId, source.hostEpoch, source.taskId)).toBe(true);
  expect(owner.snapshot('floating')).toMatchObject({ access: { kind: 'executable', hostEpoch: source.hostEpoch } });
});
it('keeps a hidden Query lease alive until its already-sent draft updates arrive', async () => {
  const { owner, domain } = setup(); await activate(owner, domain);
  const task = execution(owner, 'query');
  const current = domain.projection(task.taskId); if (!current) throw new Error('Expected task');
  const draft = owner.draftStart(task.taskId, current.revision); if (!draft) throw new Error('Expected draft');
  owner.queryDismissed();
  expect(owner.canExecute('query', task.taskId, task.hostEpoch)).toBe(false);
  expect(owner.canEditDraft('query', task.taskId, task.hostEpoch)).toBe(true);
  expect(owner.draftUpdate(task.taskId, draft.draftId, 1, '输入法草稿')).toBe(true);
  expect(await domain.restore(task.taskId, current.revision)).toEqual({ ok: true });
  owner.queryShown();
  expect(owner.canExecute('query', task.taskId, task.hostEpoch)).toBe(true);
  expect(owner.draftCurrent(task.taskId)?.value).toBe('输入法草稿');
});
it('settles an interrupted Query resize on reopen without moving its closing animation frame', async () => {
  const { owner, domain, bounds } = setup(); await activate(owner, domain);
  const a = execution(owner, 'query');
  const detached = owner.windowIntent('query', { ...a, type: 'detach' }); await finishMove(owner, 'floating'); await detached;
  const floating = execution(owner, 'floating');
  const opening = domain.open(MISSING_ITEM_SOP_SCENE_ID); await finishMove(owner, 'query'); await opening;
  const query = execution(owner, 'query');
  expect(await owner.windowIntent('query', { ...query, type: 'resize-start', gesture: 1, edge: 'e' })).toBe(true);
  await owner.windowIntent('query', { ...query, type: 'resize', gesture: 1, dx: -80, dy: 0 });
  const closingFrame = bounds();
  owner.queryDismissed();
  expect(bounds()).toEqual(closingFrame);
  expect(await owner.windowIntent('floating', { ...floating, type: 'resize-start', gesture: 1, edge: 'e' }, floating.taskId)).toBe(true);
  await owner.windowIntent('floating', { ...floating, type: 'resize', gesture: 1, dx: -100, dy: 0 }, floating.taskId);
  await owner.windowIntent('floating', { ...floating, type: 'resize-end', gesture: 1 }, floating.taskId);
  expect(bounds()).toEqual(closingFrame);
  owner.queryShown();
  expect(bounds()).toMatchObject({ width: 480, height: 620 });
});
it('cancels a closing floating preview while preserving the Query source lease', async () => {
  const { owner, domain } = setup(); await activate(owner, domain);
  const source = execution(owner, 'query');
  const detached = owner.windowIntent('query', { ...source, type: 'detach' });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  owner.hide('floating');
  expect(await detached).toBe(false);
  expect(owner.canExecute('query', source.taskId, source.hostEpoch)).toBe(true);
});
it('preserves an existing floating lease when an unrelated Query preview closes', async () => {
  const { owner, domain } = setup(); await activate(owner, domain);
  const detached = owner.windowIntent('query', { ...execution(owner, 'query'), type: 'detach' });
  await finishMove(owner, 'floating'); await detached;
  const floating = execution(owner, 'floating');
  const second = domain.open(MISSING_ITEM_SOP_SCENE_ID); await Promise.resolve();
  owner.queryDismissed();
  expect(await second).toMatchObject({ ok: false });
  expect(owner.canExecute('floating', floating.taskId, floating.hostEpoch, floating.taskId)).toBe(true);
  expect(domain.summaries()).toHaveLength(2);
});

function floatingContents() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const send = vi.fn();
  const isDestroyed = vi.fn(() => false);
  const contents = { send, isDestroyed,
    on: (name: string, callback: (...args: unknown[]) => void) => { const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set); },
    removeListener: (name: string, callback: (...args: unknown[]) => void) => { listeners.get(name)?.delete(callback); },
  } as unknown as WebContents;
  return { contents, send, isDestroyed, emit: (name: string, ...args: unknown[]) => listeners.get(name)?.forEach(callback => callback(...args)) };
}

it('does not report showing Query after its native contents are destroyed', async () => {
  const query = floatingContents();
  const { owner, domain } = setup({ queryContents: () => query.contents });
  await activate(owner, domain);
  const task = execution(owner, 'query');
  const detached = owner.windowIntent('query', { ...task, type: 'detach' });
  await finishMove(owner, 'floating');
  expect(await detached).toBe(true);
  const floating = execution(owner, 'floating');
  query.isDestroyed.mockReturnValue(true);
  expect(await owner.windowIntent('floating', { ...floating, type: 'show-query' }, floating.taskId)).toBe(false);
  expect(owner.canExecute('floating', floating.taskId, floating.hostEpoch, floating.taskId)).toBe(true);
});

it('waits for the Query task to finish preparing before showing ordinary query', async () => {
  const query = floatingContents();
  const { owner, domain } = setup({ queryContents: () => query.contents });
  await activate(owner, domain);
  const a = execution(owner, 'query');
  const detached = owner.windowIntent('query', { ...a, type: 'detach' }); await finishMove(owner, 'floating'); await detached;
  const floating = execution(owner, 'floating');
  const opening = domain.open(MISSING_ITEM_SOP_SCENE_ID); await finishMove(owner, 'query'); await opening;
  const b = execution(owner, 'query');
  const projection = domain.projection(b.taskId); if (!projection) throw new Error('Expected Query task');
  const draft = owner.draftStart(b.taskId, projection.revision); if (!draft) throw new Error('Expected draft');
  expect(owner.draftUpdate(b.taskId, draft.draftId, 1, '合成未保存草稿')).toBe(true);
  const show = owner.windowIntent('floating', { ...floating, type: 'show-query' }, floating.taskId);
  const request = query.send.mock.calls.filter(([channel]) => channel === 'sop-window:show-query-request').at(-1)?.[1];
  expect(request).toMatchObject({ taskId: b.taskId, hostEpoch: b.hostEpoch });
  expect(owner.canExecute('query', b.taskId, b.hostEpoch)).toBe(true);
  expect(owner.showQueryReady({ ...request, requestId: request.requestId + 1, accepted: true })).toBe(false);
  expect(owner.canExecute('query', b.taskId, b.hostEpoch)).toBe(true);
  expect(owner.showQueryReady({ ...request, accepted: true })).toBe(true);
  expect(await show).toBe(true);
  expect(owner.snapshot('query')).toMatchObject({ access: { kind: 'none' }, projection: null });
  expect(owner.draftCurrent(b.taskId)?.value).toBe('合成未保存草稿');
  expect(domain.summaries()).toHaveLength(2);
  expect(owner.showQueryReady({ ...request, accepted: true })).toBe(false);
});

it('rejects or times out a show-query handshake without revoking the Query task', async () => {
  vi.useFakeTimers();
  const query = floatingContents();
  const { owner, domain } = setup({ queryContents: () => query.contents });
  await activate(owner, domain);
  const a = execution(owner, 'query');
  const detached = owner.windowIntent('query', { ...a, type: 'detach' }); await finishMove(owner, 'floating'); await detached;
  const floating = execution(owner, 'floating');
  const opening = domain.open(MISSING_ITEM_SOP_SCENE_ID); await finishMove(owner, 'query'); await opening;
  const b = execution(owner, 'query');
  const rejected = owner.windowIntent('floating', { ...floating, type: 'show-query' }, floating.taskId);
  const request = query.send.mock.calls.filter(([channel]) => channel === 'sop-window:show-query-request').at(-1)?.[1];
  expect(owner.showQueryReady({ ...request, accepted: false })).toBe(false);
  expect(await rejected).toBe(false);
  const timedOut = owner.windowIntent('floating', { ...floating, type: 'show-query' }, floating.taskId);
  const last = query.send.mock.calls.filter(([channel]) => channel === 'sop-window:show-query-request').at(-1)?.[1];
  await vi.advanceTimersByTimeAsync(5000);
  expect(await timedOut).toBe(false);
  expect(owner.showQueryReady({ ...last, accepted: true })).toBe(false);
  expect(owner.canExecute('query', b.taskId, b.hostEpoch)).toBe(true);
  expect(domain.summaries()).toHaveLength(2);
});

it('rejects a late show-query acknowledgement when the initiating window is gone', async () => {
  const query = floatingContents();
  const { owner, domain } = setup({ queryContents: () => query.contents });
  await activate(owner, domain);
  const a = execution(owner, 'query');
  const detached = owner.windowIntent('query', { ...a, type: 'detach' }); await finishMove(owner, 'floating'); await detached;
  const floating = execution(owner, 'floating');
  const opening = domain.open(MISSING_ITEM_SOP_SCENE_ID); await finishMove(owner, 'query'); await opening;
  const b = execution(owner, 'query');
  const show = owner.windowIntent('floating', { ...floating, type: 'show-query' }, floating.taskId);
  const request = query.send.mock.calls.filter(([channel]) => channel === 'sop-window:show-query-request').at(-1)?.[1];
  owner.hide('floating', floating.taskId);
  expect(await show).toBe(false);
  expect(owner.showQueryReady({ ...request, accepted: true })).toBe(false);
  expect(owner.canExecute('query', b.taskId, b.hostEpoch)).toBe(true);
});

it('cancels a pending show-query request if Query is closed before its acknowledgement', async () => {
  const query = floatingContents();
  const { owner, domain } = setup({ queryContents: () => query.contents });
  await activate(owner, domain);
  const a = execution(owner, 'query');
  const detached = owner.windowIntent('query', { ...a, type: 'detach' }); await finishMove(owner, 'floating'); await detached;
  const floating = execution(owner, 'floating');
  const opening = domain.open(MISSING_ITEM_SOP_SCENE_ID); await finishMove(owner, 'query'); await opening;
  const b = execution(owner, 'query');
  const show = owner.windowIntent('floating', { ...floating, type: 'show-query' }, floating.taskId);
  const request = query.send.mock.calls.filter(([channel]) => channel === 'sop-window:show-query-request').at(-1)?.[1];
  owner.queryDismissed();
  expect(owner.showQueryReady({ ...request, accepted: true })).toBe(false);
  expect(await show).toBe(false);
  expect(owner.canExecute('query', b.taskId, b.hostEpoch)).toBe(false);
  expect(owner.canEditDraft('query', b.taskId, b.hostEpoch)).toBe(true);
  expect(domain.projection(b.taskId)).not.toBeNull();
});

it('keeps other floating tasks executable while the Query host is parked', async () => {
  const { owner, domain } = setup();
  await activate(owner, domain);
  const a = execution(owner, 'query');
  const detached = owner.windowIntent('query', { ...a, type: 'detach' }); await finishMove(owner, 'floating'); await detached;
  const floating = execution(owner, 'floating');
  const opening = domain.open(MISSING_ITEM_SOP_SCENE_ID); await finishMove(owner, 'query'); await opening;
  const query = execution(owner, 'query');
  owner.queryDismissed();
  expect(owner.canExecute('query', query.taskId, query.hostEpoch)).toBe(false);
  expect(owner.canEditDraft('query', query.taskId, query.hostEpoch)).toBe(true);
  expect(owner.canExecute('floating', floating.taskId, floating.hostEpoch, floating.taskId)).toBe(true);
});

it('preserves the Query task and draft if native restore fails after a valid acknowledgement', async () => {
  const query = floatingContents();
  const { owner, domain, slot } = setup({ queryContents: () => query.contents });
  await activate(owner, domain);
  const a = execution(owner, 'query');
  const detached = owner.windowIntent('query', { ...a, type: 'detach' }); await finishMove(owner, 'floating'); await detached;
  const floating = execution(owner, 'floating');
  const opening = domain.open(MISSING_ITEM_SOP_SCENE_ID); await finishMove(owner, 'query'); await opening;
  const b = execution(owner, 'query');
  const current = domain.projection(b.taskId); if (!current) throw new Error('Expected task');
  const draft = owner.draftStart(b.taskId, current.revision); if (!draft) throw new Error('Expected draft');
  expect(owner.draftUpdate(b.taskId, draft.draftId, 1, '合成输入')).toBe(true);
  const show = owner.windowIntent('floating', { ...floating, type: 'show-query' }, floating.taskId);
  const request = query.send.mock.calls.filter(([channel]) => channel === 'sop-window:show-query-request').at(-1)?.[1];
  slot.restore = () => false;
  expect(owner.showQueryReady({ ...request, accepted: true })).toBe(false);
  expect(await show).toBe(false);
  expect(owner.canExecute('query', b.taskId, b.hostEpoch)).toBe(true);
  expect(owner.draftCurrent(b.taskId)?.value).toBe('合成输入');
});

it('gives the floating host only currently valid IDs it has been sent, without background details', async () => {
  const receiver = floatingContents();
  const { owner, domain } = setup({ floatingContents: () => receiver.contents });
  await activate(owner, domain);
  const unseen = domain.current(); if (!unseen) throw new Error('Expected unseen task');
  const opening = domain.open(MISSING_ITEM_SOP_SCENE_ID); await finishMove(owner, 'query'); await opening;
  const firstSeen = execution(owner, 'query');
  const detached = owner.windowIntent('query', { ...firstSeen, type: 'detach' }); await finishMove(owner, 'floating'); await detached;
  const next = domain.open(MISSING_ITEM_SOP_SCENE_ID); await finishMove(owner, 'query'); await next;
  const secondSeen = domain.current(); if (!secondSeen) throw new Error('Expected floating task');
  const before = owner.currentSnapshot('floating');
  expect(before).toMatchObject({ seenActiveTaskIds: [firstSeen.taskId] });
  if (before.kind !== 'ready') throw new Error('Expected floating snapshot');
  expect(before.tasks.map(task => task.taskId)).toEqual([firstSeen.taskId]);
  expect(before.seenActiveTaskIds).not.toContain(secondSeen.taskId);
  expect(before.seenActiveTaskIds).not.toContain(unseen.taskId);
  const query = owner.currentSnapshot('query');
  expect(query).not.toHaveProperty('seenActiveTaskIds');
  expect(query.kind === 'ready' && query.tasks).toHaveLength(3);
  const background = domain.summaries().find(task => task.taskId === unseen.taskId);
  if (!background) throw new Error('Expected background task');
  expect(domain.command({ type: 'end', taskId: background.taskId, revision: background.revision, stepIndex: background.stepIndex })).toEqual({ ok: true });
  const after = owner.currentSnapshot('floating');
  expect(after).toMatchObject({ seenActiveTaskIds: [firstSeen.taskId] });
  const lastDelivery = receiver.send.mock.calls.filter(([channel]) => channel === 'sop-floating:projection').at(-1)?.[1];
  expect(lastDelivery).toMatchObject({ seenActiveTaskIds: [firstSeen.taskId] });
  expect(receiver.send.mock.calls.some(([channel]) => channel === 'sop-floating:task-removed')).toBe(false);
});

it.each(['navigation', 'process-gone', 'replace', 'destroy'] as const)('retains only its own task after floating renderer %s', async mode => {
  const first = floatingContents(), next = floatingContents();
  let current = first.contents;
  const { owner, domain } = setup({ floatingContents: () => current });
  await activate(owner, domain);
  const firstTask = execution(owner, 'query');
  const detached = owner.windowIntent('query', { ...firstTask, type: 'detach' }); await finishMove(owner, 'floating'); await detached;
  const opening = domain.open(MISSING_ITEM_SOP_SCENE_ID); await finishMove(owner, 'query'); await opening;
  const secondTask = domain.current(); if (!secondTask) throw new Error('Expected second task');
  expect(owner.currentSnapshot('floating')).toMatchObject({ seenActiveTaskIds: [firstTask.taskId] });
  if (mode === 'navigation' || mode === 'process-gone') {
    if (mode === 'navigation') first.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    else first.emit('render-process-gone');
    expect(owner.currentSnapshot('floating')).toMatchObject({ kind: 'unavailable' });
    first.emit('dom-ready');
  }
  if (mode === 'replace') current = next.contents;
  if (mode === 'destroy') {
    first.isDestroyed.mockReturnValue(true);
    expect(owner.currentSnapshot('floating')).toMatchObject({ kind: 'unavailable' });
    current = next.contents;
  }
  expect(owner.currentSnapshot('floating')).toMatchObject({ seenActiveTaskIds: [firstTask.taskId] });
  if (mode === 'replace') {
    first.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    expect(owner.currentSnapshot('floating')).toMatchObject({ seenActiveTaskIds: [firstTask.taskId] });
  }
});

it.each([{ isMainFrame: false, isSameDocument: false }, { isMainFrame: true, isSameDocument: true }])('retains seen IDs for navigation that keeps the floating document', async navigation => {
  const receiver = floatingContents();
  const { owner, domain } = setup({ floatingContents: () => receiver.contents });
  await activate(owner, domain);
  const firstTask = execution(owner, 'query');
  const detached = owner.windowIntent('query', { ...firstTask, type: 'detach' }); await finishMove(owner, 'floating'); await detached;
  const opening = domain.open(MISSING_ITEM_SOP_SCENE_ID); await finishMove(owner, 'query'); await opening;
  const secondTask = domain.current(); if (!secondTask) throw new Error('Expected second task');
  receiver.emit('did-start-navigation', navigation);
  expect(owner.currentSnapshot('floating')).toMatchObject({ seenActiveTaskIds: [firstTask.taskId] });
});

it.each(['snapshot', 'current'] as const)('fails closed when floating delivery fails after an internal %s read', async read => {
  const receiver = floatingContents();
  const { owner, domain } = setup({ floatingContents: () => receiver.contents });
  await activate(owner, domain);
  const firstTask = execution(owner, 'query');
  const detached = owner.windowIntent('query', { ...firstTask, type: 'detach' }); await finishMove(owner, 'floating'); await detached;
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    receiver.send.mockImplementation(() => { throw new Error('synthetic send failure'); });
    receiver.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    receiver.emit('dom-ready');
    if (read === 'snapshot') owner.snapshot('floating');
    else owner.currentSnapshot('floating');
    const opening = domain.open(MISSING_ITEM_SOP_SCENE_ID); await finishMove(owner, 'query'); await opening;
    const secondTask = domain.current(); if (!secondTask) throw new Error('Expected second task');
    receiver.send.mockReset();
    const result = owner.currentSnapshot('floating');
    expect(result).toMatchObject({ kind: 'unavailable' });
    expect(owner.canExecute('floating', firstTask.taskId, firstTask.hostEpoch, firstTask.taskId)).toBe(false);
    expect(domain.projection(firstTask.taskId)).not.toBeNull();
  } finally { warning.mockRestore(); }
});

it.each(['query', 'floating'] as const)('delivers snapshots to the surviving host if %s broadcast fails', async failingHost => {
  const query = floatingContents(), floating = floatingContents();
  const { owner, domain } = setup({ queryContents: () => query.contents, floatingContents: () => floating.contents });
  await activate(owner, domain);
  const task = execution(owner, 'query');
  const detached = owner.windowIntent('query', { ...task, type: 'detach' }); await finishMove(owner, 'floating'); await detached;
  const current = domain.current(); if (!current) throw new Error('Expected current task');
  const failed = failingHost === 'query' ? query : floating;
  const surviving = failingHost === 'query' ? floating : query;
  failed.send.mockImplementation(() => { throw new Error('synthetic sensitive error'); });
  surviving.send.mockClear();
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(domain.rename({ taskId: current.taskId, revision: current.revision, displayName: '合成客户' })).toEqual({ ok: true });
    expect(domain.summaries()[0]?.displayName).toBe('合成客户');
    expect(surviving.send).toHaveBeenCalled();
    expect(warning).toHaveBeenCalled();
    expect(JSON.stringify(warning.mock.calls)).not.toContain('合成客户');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('synthetic sensitive error');
  } finally { warning.mockRestore(); }
});

it('does not re-enter query hide when a failed delivery triggers a native dismiss callback', async () => {
  const receiver = floatingContents();
  const { owner, domain, slot } = setup({ queryContents: () => receiver.contents });
  await activate(owner, domain);
  const task = execution(owner, 'query');
  const projection = domain.projection(task.taskId); if (!projection) throw new Error('Expected task');
  receiver.send.mockImplementation(() => { throw new Error('synthetic failure'); });
  const hide = vi.fn(() => { owner.queryDismissed(); return true; });
  slot.failClosed = hide;
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(domain.rename({ taskId: task.taskId, revision: projection.revision, displayName: '合成名称' })).toEqual({ ok: true });
    expect(hide).toHaveBeenCalledOnce();
    expect(owner.canExecute('query', task.taskId, task.hostEpoch)).toBe(false);
  } finally { warning.mockRestore(); }
});

it.each(['false', 'throw'] as const)('reports failed Query native fail-closed when it returns %s', async mode => {
  const receiver = floatingContents();
  const { owner, domain, slot } = setup({ queryContents: () => receiver.contents });
  await activate(owner, domain);
  const task = execution(owner, 'query');
  const projection = domain.projection(task.taskId); if (!projection) throw new Error('Expected task');
  const draft = owner.draftStart(task.taskId, projection.revision); if (!draft) throw new Error('Expected draft');
  receiver.send.mockImplementation(() => { throw new Error('synthetic delivery failure'); });
  slot.failClosed = () => { if (mode === 'throw') throw new Error('synthetic native failure'); return false; };
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(domain.rename({ taskId: task.taskId, revision: projection.revision, displayName: '合成名称' })).toEqual({ ok: true });
    expect(owner.canExecute('query', task.taskId, task.hostEpoch)).toBe(false);
    expect(owner.draftCurrent(task.taskId)?.draftId).toBe(draft.draftId);
    expect(warning).toHaveBeenCalledWith('[sop-presentation] Query fail-closed failed');
  } finally { warning.mockRestore(); }
});

it.each([
  { action: 'end', failingHost: 'query' }, { action: 'end', failingHost: 'floating' },
  { action: 'check', failingHost: 'query' }, { action: 'check', failingHost: 'floating' },
  { action: 'copy', failingHost: 'query' }, { action: 'copy', failingHost: 'floating' },
] as const)('returns committed $action when $failingHost broadcast fails', async ({ action, failingHost }) => {
  const query = floatingContents(), floating = floatingContents();
  const { owner, domain } = setup({ queryContents: () => query.contents, floatingContents: () => floating.contents });
  await activate(owner, domain);
  const task = execution(owner, 'query');
  const detached = owner.windowIntent('query', { ...task, type: 'detach' }); await finishMove(owner, 'floating'); await detached;
  const current = domain.current(); if (!current) throw new Error('Expected current task');
  const failed = failingHost === 'query' ? query : floating;
  const surviving = failingHost === 'query' ? floating : query;
  failed.send.mockImplementation(() => { throw new Error('synthetic send failure'); });
  surviving.send.mockClear();
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const revision = { taskId: current.taskId, revision: current.revision, stepIndex: current.stepIndex };
    if (action === 'end') {
      expect(domain.command({ ...revision, type: 'end' })).toEqual({ ok: true });
      expect(domain.summaries()).toHaveLength(0);
      expect(owner.selectedTask()).toBeNull();
    } else if (action === 'check') {
      expect(domain.command({ ...revision, type: 'check', requirementId: 'ordered', checked: true })).toEqual({ ok: true });
      expect(domain.projection(current.taskId)?.requirements.find(item => item.id === 'ordered')?.checked).toBe(true);
    } else {
      expect(domain.copyCurrent({ ...revision, scriptId: 'syn-missing-ask' })).toMatchObject({ ok: true });
      expect(domain.projection(current.taskId)?.copied).toBe(true);
    }
    if (action !== 'end' || failingHost !== 'query') expect(surviving.send).toHaveBeenCalled();
  } finally { warning.mockRestore(); }
});

it('destroys an ended floating task when hide and delivery both fail while preserving another task', async () => {
  const query = floatingContents(), receiver = floatingContents();
  const { owner, domain, floating } = setup({ queryContents: () => query.contents, floatingContents: () => receiver.contents });
  await activate(owner, domain);
  const firstTask = execution(owner, 'query');
  const detached = owner.windowIntent('query', { ...firstTask, type: 'detach' }); await finishMove(owner, 'floating'); await detached;
  const identity = execution(owner, 'floating');
  const opening = domain.open(MISSING_ITEM_SOP_SCENE_ID); await finishMove(owner, 'query'); await opening;
  const current = domain.current(); if (!current) throw new Error('Expected second task');
  const ended = domain.projection(identity.taskId); if (!ended) throw new Error('Expected floating task');
  floating.hide = () => { throw new Error('sensitive hide failure'); };
  receiver.send.mockImplementation(() => { throw new Error('sensitive delivery failure'); });
  query.send.mockClear();
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(domain.command({ type: 'end', taskId: ended.taskId, revision: ended.revision, stepIndex: ended.stepIndex })).toEqual({ ok: true });
    expect(owner.canExecute('floating', identity.taskId, identity.hostEpoch, identity.taskId)).toBe(false);
    expect(domain.summaries().map(task => task.taskId)).toEqual([current.taskId]);
    expect(owner.currentSnapshot('floating', firstTask.taskId)).toMatchObject({ kind: 'unavailable' });
    expect(query.send).toHaveBeenCalled();
    expect(floating.destroy).toHaveBeenCalled();
    expect(JSON.stringify(warning.mock.calls)).not.toContain('sensitive');
  } finally { warning.mockRestore(); }
});

it.each([
  { failure: 'floating hide throws', host: 'floating' },
  { failure: 'floating hide returns false', host: 'floating' },
  { failure: 'query restore throws', host: 'query' },
  { failure: 'query restore returns false', host: 'query' },
  { failure: 'query home throws', host: 'query' },
] as const)('publishes revoked state when $failure after ending a task', async ({ failure, host }) => {
  const query = floatingContents(), receiver = floatingContents();
  const { owner, domain, slot, floating, queryHome } = setup({ queryContents: () => query.contents, floatingContents: () => receiver.contents });
  await activate(owner, domain);
  const detached = owner.windowIntent('query', { ...execution(owner, 'query'), type: 'detach' });
  await finishMove(owner, 'floating'); expect(await detached).toBe(true);
  if (host === 'query') {
    const source = execution(owner, 'floating');
    const attached = owner.windowIntent('floating', { ...source, type: 'attach' }, source.taskId);
    await finishMove(owner, 'query'); expect(await attached).toBe(true);
  }
  const task = domain.current(); if (!task) throw new Error('Expected current task');
  const identity = execution(owner, host);
  if (failure === 'floating hide throws') floating.hide = () => { throw new Error('sensitive floating failure'); };
  if (failure === 'floating hide returns false') floating.hide = () => false;
  if (failure === 'query restore throws') slot.restore = () => { throw new Error('sensitive restore failure'); };
  if (failure === 'query restore returns false') slot.restore = () => false;
  if (failure === 'query home throws') queryHome.mockImplementation(() => { throw new Error('sensitive home failure'); });
  const queryHide = vi.fn(() => { throw new Error('query hide must not be used'); });
  if (host === 'query') slot.hide = queryHide;
  query.send.mockClear(); receiver.send.mockClear();
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(domain.command({ type: 'end', taskId: task.taskId, revision: task.revision, stepIndex: task.stepIndex })).toEqual({ ok: true });
    expect(domain.summaries()).toEqual([]);
    expect(owner.canExecute(host, identity.taskId, identity.hostEpoch, host === 'floating' ? identity.taskId : undefined)).toBe(false);
    expect(owner.selectedTask()).toBeNull();
    const querySnapshot = query.send.mock.calls.filter(([channel]) => channel === 'sop-window:projection').at(-1)?.[1];
    const floatingSnapshot = receiver.send.mock.calls.filter(([channel]) => channel === 'sop-floating:projection').at(-1)?.[1];
    expect(querySnapshot).toMatchObject({ kind: 'ready', tasks: [], projection: null, access: { kind: 'none' } });
    if (host === 'floating') expect(floatingSnapshot).toMatchObject({ kind: 'unavailable' });
    expect(floating.destroy).toHaveBeenCalled();
    if (host === 'query') { expect(queryHome).toHaveBeenCalledOnce(); expect(queryHide).not.toHaveBeenCalled(); expect(warning).toHaveBeenCalled(); }
    expect(JSON.stringify(warning.mock.calls)).not.toContain('sensitive');
  } finally { warning.mockRestore(); }
});

it('collapses a Query SOP into a left bookmark and restores the same task and expanded position', async () => {
  const receiver = floatingContents();
  const { owner, domain, slot, floating } = setup({ floatingContents: () => receiver.contents }); await activate(owner, domain);
  const identity = execution(owner, 'query');
  const hide = vi.spyOn(slot, 'hide');
  const moving = owner.windowIntent('query', { ...identity, type: 'hide' });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(owner.currentSnapshot('floating', identity.taskId)).toMatchObject({ collapsed: true, access: { kind: 'preview' } });
  await finishMove(owner, 'floating');
  expect(await moving).toBe(true);
  expect(hide).toHaveBeenCalledOnce();
  expect(floating.getBounds()).toEqual({ x: 0, y: 0, width: 40, height: 96 });
  const current = execution(owner, 'floating');
  expect(current.taskId).toBe(identity.taskId);
  expect(await owner.windowIntent('floating', { ...current, type: 'expand' }, current.taskId)).toBe(true);
  expect(floating.getBounds()).toMatchObject({ width: 580, height: 620 });
  const expanded = floating.getBounds();
  expect(await owner.windowIntent('floating', { ...current, type: 'hide' }, current.taskId)).toBe(true);
  expect(await owner.windowIntent('floating', { ...current, type: 'expand' }, current.taskId)).toBe(true);
  expect(floating.getBounds()).toEqual(expanded);
});
it('keeps the Query source executable when detaching cannot collapse the Query', async () => {
  const { owner, domain, slot } = setup(); await activate(owner, domain);
  const identity = execution(owner, 'query');
  vi.spyOn(slot, 'hide').mockReturnValue(false);
  const moving = owner.windowIntent('query', { ...identity, type: 'hide' });
  await finishMove(owner, 'floating');
  expect(await moving).toBe(false);
  const restored = execution(owner, 'query');
  expect(restored.taskId).toBe(identity.taskId);
  expect(owner.canExecute('query', restored.taskId, restored.hostEpoch)).toBe(true);
});
