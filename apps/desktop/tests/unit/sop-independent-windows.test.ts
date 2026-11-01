import { afterEach, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import { SopPresentationOwner } from '../../src/main/sop-presentation-owner';
import { SopWindowController } from '../../src/main/sop-window-controller';
import { ALLERGY_SOP_SCENE_ID, MISSING_ITEM_SOP_SCENE_ID } from '../../src/shared/sop-entry';

vi.mock('electron', () => ({ clipboard: { writeText: vi.fn() } }));

const owners: SopPresentationOwner[] = [];
afterEach(() => owners.splice(0).forEach(owner => owner.destroy()));

function contents(): WebContents {
  return { isDestroyed: () => false, send: vi.fn(), on: vi.fn(), removeListener: vi.fn() } as unknown as WebContents;
}

function nativeSlot(receiver: WebContents | null = null) {
  let bounds = { x: 100, y: 100, width: 580, height: 620 };
  return { getBounds: () => bounds, getWorkArea: () => ({ x: 0, y: 0, width: 2400, height: 1000 }),
    prepare: () => true, applyBounds: (next: typeof bounds) => { bounds = next; return true; },
    show: () => true, restore: () => true, hide: () => true, failClosed: () => true, contents: () => receiver, destroy: vi.fn() };
}

it('opens two tasks in different windows, preserves both leases, and synchronizes committed dimensions', async () => {
  const query = nativeSlot(), receivers = [contents(), contents()];
  const surfaces = receivers.map(contents => nativeSlot(contents));
  const lostCallbacks: Array<() => void> = [];
  let createIndex = 0;
  const domain: SopWindowController = new SopWindowController({ enabled: () => true, sessionRole: () => 'agent',
    presentation: { selectedTask: () => owner.selectedTask(), canExecuteTask: taskId => owner.isTaskExecutable(taskId),
      showTask: id => owner.showTask(id), removeTask: id => owner.removeTask(id), changed: () => owner.publish() } });
  const owner: SopPresentationOwner = new SopPresentationOwner({ domain, query, queryContents: () => null,
    queryPresentation: () => ({ view: { kind: 'query-home' }, viewEpoch: 1, transition: null }),
    showOrdinaryQuery: () => true, queryHome: () => {}, createFloating: async onLost => { lostCallbacks.push(onLost); return surfaces[createIndex++]; } });
  owners.push(owner);
  async function ready(host: 'query' | 'floating', taskId?: string) {
    for (let count = 0; count < 8; count++) await Promise.resolve();
    const snapshot = owner.snapshot(host, taskId);
    if (snapshot.kind !== 'ready' || snapshot.access.kind !== 'preview') throw new Error('Expected preview');
    expect(owner.ready(host, snapshot.access, taskId)).toBe(true);
  }
  function active(host: 'query' | 'floating', taskId?: string) {
    const snapshot = owner.snapshot(host, taskId);
    if (snapshot.kind !== 'ready' || snapshot.access.kind !== 'executable' || !snapshot.projection) throw new Error('Expected active task');
    return { taskId: snapshot.projection.taskId, hostEpoch: snapshot.access.hostEpoch, projection: snapshot.projection };
  }
  const openingA = domain.open(ALLERGY_SOP_SCENE_ID); await ready('query'); await openingA;
  const aQuery = active('query');
  const detachA = owner.windowIntent('query', { ...aQuery, type: 'detach' });
  await ready('floating', aQuery.taskId); expect(await detachA).toBe(true);
  const a = active('floating', aQuery.taskId);
  const openingB = domain.open(MISSING_ITEM_SOP_SCENE_ID); await ready('query'); await openingB;
  const bQuery = active('query');
  const detachB = owner.windowIntent('query', { ...bQuery, type: 'detach' });
  await ready('floating', bQuery.taskId); expect(await detachB).toBe(true);
  const b = active('floating', bQuery.taskId);
  const firstBounds = surfaces[0].getBounds(), secondBounds = surfaces[1].getBounds();
  expect(firstBounds.x + firstBounds.width <= secondBounds.x || secondBounds.x + secondBounds.width <= firstBounds.x
    || firstBounds.y + firstBounds.height <= secondBounds.y || secondBounds.y + secondBounds.height <= firstBounds.y).toBe(true);
  expect(owner.floatingTaskFor(receivers[0])).toBe(a.taskId);
  expect(owner.floatingTaskFor(receivers[1])).toBe(b.taskId);
  expect(owner.canExecute('floating', a.taskId, a.hostEpoch, a.taskId)).toBe(true);
  expect(owner.canExecute('floating', a.taskId, a.hostEpoch)).toBe(false);
  expect(owner.canExecute('floating', b.taskId, b.hostEpoch, a.taskId)).toBe(false);
  expect(domain.command({ type: 'choose', taskId: a.taskId, revision: a.projection.revision, stepIndex: a.projection.stepIndex, edgeId: 'has-photo' }).ok).toBe(true);
  expect(domain.projection(b.taskId)?.stepIndex).toBe(1);
  expect(await owner.windowIntent('floating', { type: 'resize-start', taskId: a.taskId, hostEpoch: a.hostEpoch, gesture: 1, edge: 'se' }, a.taskId)).toBe(true);
  await owner.windowIntent('floating', { type: 'resize', taskId: a.taskId, hostEpoch: a.hostEpoch, gesture: 1, dx: 200, dy: -100 }, a.taskId);
  await owner.windowIntent('floating', { type: 'resize-end', taskId: a.taskId, hostEpoch: a.hostEpoch, gesture: 1 }, a.taskId);
  expect(surfaces[0].getBounds()).toMatchObject({ width: 780, height: 520 });
  expect(surfaces[1].getBounds()).toMatchObject({ width: 780, height: 520 });
  expect(await owner.windowIntent('floating', { type: 'resize-start', taskId: a.taskId, hostEpoch: a.hostEpoch, gesture: 2, edge: 'e' }, a.taskId)).toBe(true);
  expect(await owner.windowIntent('floating', { type: 'resize-start', taskId: b.taskId, hostEpoch: b.hostEpoch, gesture: 1, edge: 'e' }, b.taskId)).toBe(true);
  await owner.windowIntent('floating', { type: 'resize', taskId: a.taskId, hostEpoch: a.hostEpoch, gesture: 2, dx: -60, dy: 0 }, a.taskId);
  await owner.windowIntent('floating', { type: 'resize', taskId: b.taskId, hostEpoch: b.hostEpoch, gesture: 1, dx: -100, dy: 0 }, b.taskId);
  await owner.windowIntent('floating', { type: 'resize-end', taskId: a.taskId, hostEpoch: a.hostEpoch, gesture: 2 }, a.taskId);
  expect(surfaces[1].getBounds().width).toBe(680);
  await owner.windowIntent('floating', { type: 'resize-cancel', taskId: b.taskId, hostEpoch: b.hostEpoch, gesture: 1 }, b.taskId);
  expect(surfaces[1].getBounds().width).toBe(720);
  expect(await owner.windowIntent('floating', { type: 'resize-start', taskId: a.taskId, hostEpoch: a.hostEpoch, gesture: 3, edge: 'e' }, a.taskId)).toBe(true);
  expect(await owner.windowIntent('floating', { type: 'resize-start', taskId: b.taskId, hostEpoch: b.hostEpoch, gesture: 2, edge: 'e' }, b.taskId)).toBe(true);
  await owner.windowIntent('floating', { type: 'resize', taskId: a.taskId, hostEpoch: a.hostEpoch, gesture: 3, dx: -30, dy: 0 }, a.taskId);
  await owner.windowIntent('floating', { type: 'resize-end', taskId: a.taskId, hostEpoch: a.hostEpoch, gesture: 3 }, a.taskId);
  expect(surfaces[1].getBounds().width).toBe(720);
  await owner.windowIntent('floating', { type: 'resize-end', taskId: b.taskId, hostEpoch: b.hostEpoch, gesture: 2 }, b.taskId);
  expect(surfaces[1].getBounds().width).toBe(690);
  expect(await owner.windowIntent('floating', { type: 'resize-start', taskId: b.taskId, hostEpoch: b.hostEpoch, gesture: 3, edge: 'e' }, b.taskId)).toBe(true);
  lostCallbacks[1]();
  const currentBForRestore = domain.projection(b.taskId); if (!currentBForRestore) throw new Error('Expected task B');
  expect(await domain.restore(b.taskId, currentBForRestore.revision)).toEqual({ ok: true });
  expect(await owner.windowIntent('floating', { type: 'resize-start', taskId: a.taskId, hostEpoch: a.hostEpoch, gesture: 4, edge: 'e' }, a.taskId)).toBe(true);
  await owner.windowIntent('floating', { type: 'resize', taskId: a.taskId, hostEpoch: a.hostEpoch, gesture: 4, dx: -40, dy: 0 }, a.taskId);
  await owner.windowIntent('floating', { type: 'resize-end', taskId: a.taskId, hostEpoch: a.hostEpoch, gesture: 4 }, a.taskId);
  expect(surfaces[1].getBounds().width).toBe(650);
  expect(await owner.windowIntent('floating', { type: 'resize-start', taskId: b.taskId, hostEpoch: b.hostEpoch, gesture: 4, edge: 'e' }, b.taskId)).toBe(true);
  await owner.windowIntent('floating', { type: 'resize', taskId: b.taskId, hostEpoch: b.hostEpoch, gesture: 4, dx: -40, dy: 0 }, b.taskId);
  expect(await owner.windowIntent('floating', { type: 'hide', taskId: b.taskId, hostEpoch: b.hostEpoch }, b.taskId)).toBe(true);
  expect(await domain.restore(b.taskId, currentBForRestore.revision)).toEqual({ ok: true });
  expect(surfaces[1].getBounds().width).toBe(650);
  expect(await owner.windowIntent('floating', { type: 'hide', taskId: a.taskId, hostEpoch: a.hostEpoch }, a.taskId)).toBe(true);
  expect(owner.currentSnapshot('floating', a.taskId)).toMatchObject({ collapsed: true });
  const expandedB = surfaces[1].getBounds();
  vi.spyOn(surfaces[1], 'getWorkArea').mockReturnValueOnce({ x: 0, y: 0, width: 2400, height: 64 });
  expect(await owner.windowIntent('floating', { type: 'hide', taskId: b.taskId, hostEpoch: b.hostEpoch }, b.taskId)).toBe(false);
  expect(surfaces[1].getBounds()).toEqual(expandedB);

  expect(await owner.windowIntent('floating', { type: 'hide', taskId: b.taskId, hostEpoch: b.hostEpoch }, b.taskId)).toBe(true);
  const bookmarkA = surfaces[0].getBounds(), bookmarkB = surfaces[1].getBounds();
  expect(bookmarkA).toMatchObject({ x: 0, width: 40, height: 96 });
  expect(bookmarkB).toMatchObject({ x: 0, width: 40, height: 96 });
  expect(Math.abs(bookmarkA.y - bookmarkB.y)).toBeGreaterThanOrEqual(96);
  expect(await owner.windowIntent('floating', { type: 'expand', taskId: b.taskId, hostEpoch: b.hostEpoch }, b.taskId)).toBe(true);

  expect(await domain.restore(a.taskId, domain.projection(a.taskId)!.revision)).toEqual({ ok: true });
  expect(owner.currentSnapshot('floating', a.taskId)).toMatchObject({ collapsed: false });
  const currentA = domain.projection(a.taskId); if (!currentA) throw new Error('Expected task A');
  const draft = owner.draftStart(a.taskId, currentA.revision); if (!draft) throw new Error('Expected draft');
  expect(owner.draftUpdate(a.taskId, draft.draftId, 1, '合成草稿')).toBe(true);
  lostCallbacks[0]();
  expect(owner.draftCurrent(a.taskId)?.value).toBe('合成草稿');
  expect(owner.canExecute('floating', a.taskId, a.hostEpoch, a.taskId)).toBe(false);
  expect(owner.canEditDraft('floating', a.taskId, a.hostEpoch, a.taskId)).toBe(true);
  expect(await domain.restore(a.taskId, currentA.revision)).toEqual({ ok: true });
  expect(owner.canExecute('floating', a.taskId, a.hostEpoch, a.taskId)).toBe(true);
  const openingC = domain.open(ALLERGY_SOP_SCENE_ID); await ready('query'); await openingC;
  const c = active('query');
  expect(await owner.windowIntent('floating', { type: 'attach', taskId: b.taskId, hostEpoch: b.hostEpoch }, b.taskId)).toBe(false);
  expect(owner.canExecute('query', c.taskId, c.hostEpoch)).toBe(true);
  vi.mocked(receivers[0].send).mockImplementation(() => { throw new Error('synthetic delivery failure'); });
  const currentB = domain.projection(b.taskId); if (!currentB) throw new Error('Expected task B');
  expect(domain.rename({ taskId: b.taskId, revision: currentB.revision, displayName: '合成名称' })).toEqual({ ok: true });
  expect(surfaces[0].destroy).toHaveBeenCalled();
  expect(owner.canExecute('floating', a.taskId, a.hostEpoch, a.taskId)).toBe(false);
  expect(owner.canExecute('floating', b.taskId, b.hostEpoch, b.taskId)).toBe(true);
  expect(owner.draftCurrent(a.taskId)?.value).toBe('合成草稿');
});
