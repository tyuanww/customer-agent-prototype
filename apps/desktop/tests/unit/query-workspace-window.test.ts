import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const screenState = vi.hoisted(() => ({ area: { x: 0, y: 0, width: 1440, height: 900 } }));
vi.mock('electron', () => ({
  app: { isReady: () => true },
  BrowserWindow: { getAllWindows: () => [] },
  globalShortcut: { unregister: vi.fn(), unregisterAll: vi.fn() },
  screen: { getDisplayNearestPoint: () => ({ workArea: screenState.area }) },
  systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: false }) },
}));
vi.mock('../../src/main/dashboard-window', () => ({ createDashboardBrowserWindow: vi.fn(), readDashboardWindowSnapshot: vi.fn() }));
vi.mock('../../src/main/overlay-test-harness', () => ({ attachTestHarness: vi.fn(), isTestHarnessEnabled: () => false }));
import { OverlayController } from '../../src/main/overlay-controller';

function setup(onQueryDismiss?: () => void, onQueryDestroyed?: () => void, onQueryShown?: () => void) {
  const changed = vi.fn();
  let bounds = { x: 100, y: 100, width: 600, height: 88 };
  let visible = true, destroyed = false;
  const window = {
    isDestroyed: () => destroyed, isVisible: () => visible, setAlwaysOnTop: vi.fn(),
    hide: vi.fn(() => { visible = false; }), destroy: vi.fn(() => { destroyed = true; visible = false; }),
    show: vi.fn(), focus: vi.fn(), setFocusable: vi.fn(),
    getBounds: () => ({ ...bounds }), setBounds: vi.fn(next => { bounds = { ...next }; }),
    webContents: { isDestroyed: () => false, send: vi.fn(), focus: vi.fn(), invalidate: vi.fn() },
  };
  const controller = new OverlayController({ onQueryViewChanged: changed, onQueryDismiss, onQueryDestroyed, onQueryShown });
  Object.assign(controller, { query: window, phase: 'SEARCH_INPUT', activeChromeHandoffId: 1 });
  const ready = (height: number, reducedMotion = true) => controller.navigateQuery({ type: 'view-ready', viewEpoch: controller.queryPresentation().viewEpoch, desiredHeight: height, reducedMotion });
  return { controller, window, changed, ready };
}
beforeEach(() => { vi.useFakeTimers(); screenState.area = { x: 0, y: 0, width: 1440, height: 900 }; });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('Query view and native slot ownership', () => {
  it('hides the Query window immediately on a failed SOP projection', () => {
    const { controller, window } = setup();
    expect(controller.querySopSlot().failClosed()).toBe(true);
    expect(window.hide).toHaveBeenCalledOnce();
    expect(window.isVisible()).toBe(false);
    expect(window.destroy).not.toHaveBeenCalled();
  });

  it('destroys the Query window if hiding it fails', () => {
    const notify = vi.fn();
    const { controller, window } = setup(undefined, notify);
    window.hide.mockImplementationOnce(() => { throw new Error('hide failed'); });
    expect(controller.querySopSlot().failClosed()).toBe(true);
    expect(window.destroy).toHaveBeenCalledOnce();
    expect(window.isDestroyed()).toBe(true);
    expect(notify).toHaveBeenCalledOnce();
  });

  it('reports when neither hiding nor destroying the Query window succeeds', () => {
    const { controller, window } = setup();
    window.hide.mockImplementationOnce(() => { throw new Error('hide failed'); });
    window.destroy.mockImplementationOnce(() => { throw new Error('destroy failed'); });
    expect(controller.querySopSlot().failClosed()).toBe(false);
    expect(window.isVisible()).toBe(true);
  });
  it('provides one stable native port without changing the ordinary Query view', () => {
    const { controller, changed } = setup();
    const slot = controller.querySopSlot();
    expect(controller.querySopSlot()).toBe(slot);
    const epoch = controller.queryPresentation().viewEpoch;
    expect(slot.prepare()).toBe(true);
    expect(controller.queryPresentation()).toMatchObject({ view: { kind: 'query-home' }, viewEpoch: epoch + 1 });
    expect(changed).toHaveBeenCalledOnce();
    expect(slot.applyBounds({ x: 100, y: 100, width: 540, height: 620 })).toBe(true);
    expect(controller.queryPresentation().view).toEqual({ kind: 'query-home' });
  });

  it('restores ordinary home size and rejects delayed layouts from before slot use', () => {
    const { controller, window, ready } = setup();
    const epoch = controller.queryPresentation().viewEpoch;
    controller.reportQueryLayout({ sessionId: 1, viewEpoch: epoch, sequence: 1, phase: 'SEARCH_INPUT', resultCount: 0, desiredHeight: 186 });
    const slot = controller.querySopSlot();
    slot.prepare();
    slot.applyBounds({ x: 100, y: 100, width: 500, height: 420 });
    expect(controller.reportQueryLayout({ sessionId: 1, viewEpoch: epoch, sequence: 2, phase: 'SEARCH_INPUT', resultCount: 0, desiredHeight: 620 }).ok).toBe(false);
    expect(slot.restore()).toBe(true);
    expect(controller.queryPresentation().transition?.stage).toBe('preparing');
    ready(186);
    expect(window.getBounds()).toMatchObject({ width: 600, height: 186 });
    expect(controller.queryPresentation().viewEpoch).toBe(epoch + 2);
    expect(slot.applyBounds({ x: 100, y: 100, width: 500, height: 420 })).toBe(false);
  });

  it('preserves results and their measured size while the native slot owns bounds', () => {
    const { controller, window, ready } = setup();
    controller.navigateQuery({ type: 'results', viewEpoch: controller.queryPresentation().viewEpoch });
    ready(430);
    controller.reportUiPhase('RESULTS', 3);
    const slot = controller.querySopSlot();
    slot.prepare();
    slot.applyBounds({ x: 100, y: 100, width: 540, height: 700 });
    controller.reportUiPhase('RESULTS', 3);
    vi.runAllTimers();
    expect(window.getBounds()).toMatchObject({ width: 540, height: 700 });
    slot.restore();
    ready(430);
    expect(controller.queryPresentation().view).toEqual({ kind: 'query-results' });
    expect(window.getBounds()).toMatchObject({ width: 600, height: 430 });
  });

  it.each([1, 3] as const)('clears %s old results when an active SOP is closed and reopened', resultCount => {
    const { controller, window, ready } = setup();
    controller.navigateQuery({ type: 'results', viewEpoch: controller.queryPresentation().viewEpoch });
    ready(430);
    controller.reportUiPhase('RESULTS', resultCount);
    const slot = controller.querySopSlot();
    slot.prepare();
    slot.applyBounds({ x: 100, y: 100, width: 540, height: 700 });
    const sopBounds = window.getBounds();
    controller.dismiss();
    expect(controller.phase).toBe('FOX_IDLE');
    expect(controller.queryLayoutDebugState().resultCount).toBe(0);
    expect(window.getBounds()).toEqual(sopBounds);
    controller.openSearch();
    expect(controller.phase).toBe('SEARCH_INPUT');
    expect(controller.queryLayoutDebugState().resultCount).toBe(0);
    expect(window.getBounds()).toEqual(sopBounds);
    expect(slot.restore()).toBe(true);
    expect(controller.navigateQuery({ type: 'home', viewEpoch: controller.queryPresentation().viewEpoch })).toBe(true);
    expect(ready(212)).toBe(true);
    const ack = controller.reportQueryLayout({ sessionId: 1, viewEpoch: controller.queryPresentation().viewEpoch, sequence: 1,
      phase: 'SEARCH_INPUT', resultCount: 0, desiredHeight: 212 });
    expect(ack.ok).toBe(true);
    expect(window.getBounds()).toMatchObject({ width: 600, height: 212 });
  });

  it('rejects a stale result count without resizing a naturally fitted home', () => {
    const { controller, window } = setup();
    const viewEpoch = controller.queryPresentation().viewEpoch;
    expect(controller.reportQueryLayout({ sessionId: 1, viewEpoch, sequence: 1,
      phase: 'SEARCH_INPUT', resultCount: 0, desiredHeight: 212 }).ok).toBe(true);
    expect(window.getBounds().height).toBe(212);
    expect(controller.reportQueryLayout({ sessionId: 1, viewEpoch, sequence: 2,
      phase: 'SEARCH_INPUT', resultCount: 1, desiredHeight: 430 }).ok).toBe(false);
    expect(window.getBounds().height).toBe(212);
  });

  it('clamps finite native frames and leaves invalid frames untouched', () => {
    const { controller, window } = setup();
    const slot = controller.querySopSlot();
    slot.prepare();
    screenState.area = { x: 0, y: 0, width: 380, height: 300 };
    expect(slot.applyBounds({ x: 300, y: 280, width: 540, height: 620 })).toBe(true);
    expect(window.getBounds()).toEqual({ x: 8, y: 8, width: 364, height: 284 });
    expect(slot.applyBounds({ x: Number.NaN, y: 0, width: 500, height: 420 })).toBe(false);
    expect(slot.applyBounds({ x: 0, y: 0, width: -1, height: 420 })).toBe(false);
    expect(window.getBounds()).toEqual({ x: 8, y: 8, width: 364, height: 284 });
  });

  it('discards an in-flight ordinary transition before giving bounds to the slot', () => {
    const { controller, window, ready } = setup();
    controller.navigateQuery({ type: 'results', viewEpoch: controller.queryPresentation().viewEpoch });
    const epoch = controller.queryPresentation().viewEpoch;
    ready(430, false);
    expect(controller.queryPresentation().transition?.stage).toBe('animating');
    const slot = controller.querySopSlot();
    slot.prepare();
    slot.applyBounds({ x: 100, y: 100, width: 540, height: 700 });
    expect(controller.navigateQuery({ type: 'view-finished', viewEpoch: epoch })).toBe(false);
    vi.runAllTimers();
    expect(window.getBounds()).toMatchObject({ width: 540, height: 700 });
    expect(controller.queryPresentation().transition).toBeNull();
  });

  it('keeps ordinary view changes out of an occupied slot', () => {
    const { controller, window } = setup();
    const slot = controller.querySopSlot();
    slot.prepare();
    slot.applyBounds({ x: 100, y: 100, width: 540, height: 700 });
    expect(controller.navigateQuery({ type: 'results', viewEpoch: controller.queryPresentation().viewEpoch })).toBe(false);
    expect(window.getBounds()).toMatchObject({ width: 540, height: 700 });
    expect(controller.queryPresentation().view).toEqual({ kind: 'query-home' });
  });

  it('shows the prepared native frame without rewriting ordinary Query state', () => {
    const { controller, window } = setup();
    const slot = controller.querySopSlot();
    expect(slot.show()).toBe(false);
    slot.prepare();
    slot.applyBounds({ x: 100, y: 100, width: 540, height: 700 });
    expect(slot.show()).toBe(true);
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    expect(window.webContents.focus).toHaveBeenCalledOnce();
    expect(controller.queryLayoutDebugState().handoffId).toBe(1);
    expect(window.getBounds()).toMatchObject({ width: 540, height: 700 });
    expect(controller.queryPresentation().view).toEqual({ kind: 'query-home' });
  });

  it('notifies that an already-visible Query was reopened even without another native show event', () => {
    const shown = vi.fn();
    const { controller, window } = setup(undefined, undefined, shown);
    const fox = { isDestroyed: () => false, isVisible: () => true, hide: vi.fn() };
    Object.assign(controller, { fox, phase: 'SEARCH_INPUT', chromeHandoffMode: 'preparing-open', activeChromeHandoffId: 7 });
    const start = Reflect.get(controller, 'startPreparedOpen');
    start.call(controller, 7, true);
    expect(window.isVisible()).toBe(true);
    expect(window.show).toHaveBeenCalledOnce();
    expect(shown).toHaveBeenCalledOnce();
  });

  it('notifies that an already-visible SOP slot is shown without relying on a native show event', () => {
    const shown = vi.fn();
    const { controller, window } = setup(undefined, undefined, shown);
    const slot = controller.querySopSlot();
    expect(slot.prepare()).toBe(true);
    expect(slot.show()).toBe(true);
    expect(window.isVisible()).toBe(true);
    expect(shown).toHaveBeenCalledOnce();
  });

  it('notifies dismissal once and preserves ordinary results through a slot hide', () => {
    const dismissed = vi.fn();
    const { controller, window, ready } = setup(dismissed);
    controller.navigateQuery({ type: 'results', viewEpoch: controller.queryPresentation().viewEpoch });
    ready(430);
    controller.reportUiPhase('RESULTS', 3);
    const slot = controller.querySopSlot();
    slot.prepare();
    slot.applyBounds({ x: 100, y: 100, width: 540, height: 700 });
    dismissed.mockImplementation(() => slot.hide());
    expect(slot.hide()).toBe(true);
    expect(dismissed).toHaveBeenCalledOnce();
    expect(controller.phase).toBe('FOX_IDLE');
    expect(slot.restore()).toBe(true);
    expect(window.getBounds()).toMatchObject({ width: 600, height: 430 });
    controller.dismiss();
    expect(dismissed).toHaveBeenCalledOnce();
  });

  it('refuses native slot mutations after disposal', () => {
    const { controller, window } = setup();
    const slot = controller.querySopSlot();
    slot.prepare();
    controller.dispose();
    const before = window.getBounds();
    expect(slot.prepare()).toBe(false);
    expect(slot.applyBounds({ x: 100, y: 100, width: 540, height: 700 })).toBe(false);
    expect(slot.show()).toBe(false);
    expect(slot.hide()).toBe(false);
    expect(slot.restore()).toBe(false);
    expect(window.getBounds()).toEqual(before);
  });

  it('keeps ordinary view transitions epoch-bound and uses their measured size', () => {
    const { controller, window, ready } = setup();
    const epoch = controller.queryPresentation().viewEpoch;
    controller.navigateQuery({ type: 'results', viewEpoch: epoch });
    const next = controller.queryPresentation().viewEpoch;
    ready(430, false);
    expect(controller.navigateQuery({ type: 'view-finished', viewEpoch: epoch })).toBe(false);
    expect(controller.navigateQuery({ type: 'view-finished', viewEpoch: next })).toBe(true);
    expect(window.getBounds()).toMatchObject({ width: 600, height: 430 });
    controller.navigateQuery({ type: 'home', viewEpoch: next });
    ready(188);
    expect(window.getBounds()).toMatchObject({ width: 600, height: 188 });
  });
});
it('releases the native slot without moving the source frame during an accepted close handshake', () => {
  const { controller, window } = setup();
  const slot = controller.querySopSlot();
  slot.prepare(); slot.applyBounds({ x: 200, y: 200, width: 500, height: 500 });
  Object.assign(controller, { phase: 'FOX_IDLE', chromeHandoffMode: 'closing' });
  const before = window.getBounds();
  expect(slot.restore()).toBe(true);
  expect(window.getBounds()).toEqual(before);
});

it('keeps the ordinary fox anchor while resizing a SOP slot', () => {
  const { controller } = setup();
  const before = Reflect.get(controller, 'foxOrigin');
  const slot = controller.querySopSlot();
  expect(slot.prepare()).toBe(true);
  expect(slot.applyBounds({ x: 300, y: 40, width: 700, height: 700 })).toBe(true);
  expect(Reflect.get(controller, 'foxOrigin')).toEqual(before);
});
