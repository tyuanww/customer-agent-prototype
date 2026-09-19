import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  attachTestHarness: vi.fn(),
  loadRenderer: vi.fn(),
  unregisterAll: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    focus: vi.fn(),
    hide: vi.fn(),
    show: vi.fn(),
    isHidden: vi.fn(() => false),
    isReady: () => true,
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  globalShortcut: {
    register: vi.fn(),
    unregister: vi.fn(),
    unregisterAll: mocks.unregisterAll,
  },
  screen: {
    getCursorScreenPoint: () => ({ x: 24, y: 120 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
  },
  systemPreferences: {
    getAnimationSettings: () => ({ prefersReducedMotion: false }),
  },
}));

vi.mock('../../src/main/dashboard-window', () => ({
  createDashboardBrowserWindow: vi.fn(),
  readDashboardWindowSnapshot: vi.fn(),
}));

vi.mock('../../src/main/overlay-renderer-loader', () => ({
  loadRenderer: mocks.loadRenderer,
}));

vi.mock('../../src/main/window-security', () => ({
  lockRendererWindow: vi.fn(),
}));

vi.mock('../../src/main/overlay-test-harness', () => ({
  attachTestHarness: mocks.attachTestHarness,
  isTestHarnessEnabled: () => false,
}));

import { OverlayController } from '../../src/main/overlay-controller';
import { app, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../src/shared/contracts';
import type { FoxDragSettleAck, OverlayCommand } from '../../src/shared/overlay-events';

type FoxWindowFixture = BrowserWindow & {
  sent: OverlayCommand[];
  showInactive: ReturnType<typeof vi.fn>;
  setFocusable: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  blur: ReturnType<typeof vi.fn>;
  acceptNativeBounds(
    bounds: { x: number; y: number; width: number; height: number },
    event: 'move' | 'moved',
  ): void;
};

function createFoxWindow(): FoxWindowFixture {
  let bounds = { x: 0, y: 100, width: 88, height: 88 };
  const sent: OverlayCommand[] = [];
  const nativeBoundsListeners = new Map<'move' | 'moved', Set<() => void>>();
  return {
    getBounds: vi.fn(() => ({ ...bounds })),
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    on: vi.fn((event: 'move' | 'moved', listener: () => void) => {
      const listeners = nativeBoundsListeners.get(event) ?? new Set<() => void>();
      listeners.add(listener);
      nativeBoundsListeners.set(event, listeners);
    }),
    setBounds: vi.fn((next: typeof bounds) => {
      bounds = { ...next };
    }),
    showInactive: vi.fn(),
    setFocusable: vi.fn(),
    hide: vi.fn(),
    blur: vi.fn(),
    webContents: {
      isDestroyed: () => false,
      send: vi.fn((channel: string, command: OverlayCommand) => {
        if (channel === IPC_CHANNELS.OVERLAY_COMMAND) {
          sent.push(command);
        }
      }),
    },
    sent,
    acceptNativeBounds: (
      next: { x: number; y: number; width: number; height: number },
      event: 'move' | 'moved',
    ) => {
      bounds = { ...next };
      for (const listener of nativeBoundsListeners.get(event) ?? []) {
        listener();
      }
    },
  } as unknown as FoxWindowFixture;
}

function controllerWithDockedFox(): { controller: OverlayController; fox: FoxWindowFixture } {
  const controller = new OverlayController();
  const fox = createFoxWindow();
  Object.assign(controller as object, {
    fox,
    foxDockEdge: 'left',
    foxOrigin: { x: 0, y: 100 },
  });
  return { controller, fox };
}

function finishDrag(
  controller: OverlayController,
  generation: number,
  dx = 24,
): FoxDragSettleAck {
  expect(controller.moveBy(dx, 0, false, generation)).toBeNull();
  const settle = controller.moveBy(0, 0, true, generation);
  expect(settle).not.toBeNull();
  return settle as FoxDragSettleAck;
}

describe('OverlayController fox drag settle transaction', () => {
  const controllers: OverlayController[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const controller of controllers.splice(0)) {
      controller.dispose();
    }
  });

  it.each(['move', 'moved'] as const)(
    'adopts the native Fox frame from the BrowserWindow %s event',
    (event) => {
      const { controller, fox } = controllerWithDockedFox();
      controllers.push(controller);
      const bindNativeReadback = Reflect.get(
        controller,
        'bindFoxNativeBoundsReadback',
      ) as (win: BrowserWindow) => void;

      bindNativeReadback.call(controller, fox);
      fox.acceptNativeBounds({ x: 96, y: 124, width: 88, height: 88 }, event);

      expect(Reflect.get(controller, 'foxOrigin')).toEqual({ x: 96, y: 124 });
      expect(fox.setBounds).not.toHaveBeenCalled();
    },
  );

  it('holds repeated shortcut intents until the exact final settle commit, then opens once', () => {
    const { controller, fox } = controllerWithDockedFox();
    controllers.push(controller);
    const openSearch = vi.spyOn(controller, 'openSearch');

    expect(controller.moveBy(24, 0, false, 1)).toBeNull();
    controller.openSearch();
    controller.openSearch();
    expect(controller.phase).toBe('FOX_IDLE');

    const settle = controller.moveBy(0, 0, true, 1) as FoxDragSettleAck;
    expect(settle).toMatchObject({ generation: 1, settleId: 1 });
    controller.openSearch();
    expect(controller.phase).toBe('FOX_IDLE');
    expect(fox.sent).toContainEqual({ type: 'fox-drag-settled', ...settle });

    controller.commitFoxDragSettle(settle.settleId + 1);
    expect(controller.phase).toBe('FOX_IDLE');

    controller.commitFoxDragSettle(settle.settleId);
    expect(controller.phase).toBe('SEARCH_INPUT');
    expect(openSearch).toHaveBeenCalledTimes(4);

    controller.commitFoxDragSettle(settle.settleId);
    expect(openSearch).toHaveBeenCalledTimes(4);
  });

  it('keeps the open intent across a superseding generation and rejects old commits', () => {
    const { controller } = controllerWithDockedFox();
    controllers.push(controller);
    const openSearch = vi.spyOn(controller, 'openSearch');

    const first = finishDrag(controller, 1);
    controller.openSearch();
    expect(controller.phase).toBe('FOX_IDLE');

    expect(controller.moveBy(-12, 0, false, 2)).toBeNull();
    controller.commitFoxDragSettle(first.settleId);
    expect(controller.phase).toBe('FOX_IDLE');

    const second = controller.moveBy(0, 0, true, 2) as FoxDragSettleAck;
    expect(second.generation).toBe(2);
    expect(second.settleId).toBeGreaterThan(first.settleId);
    controller.commitFoxDragSettle(first.settleId);
    expect(controller.phase).toBe('FOX_IDLE');

    controller.commitFoxDragSettle(second.settleId);
    expect(controller.phase).toBe('SEARCH_INPUT');
    expect(openSearch).toHaveBeenCalledTimes(2);
  });

  it('fails closed for an out-of-order finish and leaves the active generation settleable', () => {
    const { controller } = controllerWithDockedFox();
    controllers.push(controller);

    expect(controller.moveBy(16, 0, false, 7)).toBeNull();
    expect(controller.moveBy(0, 0, true, 6)).toBeNull();
    controller.openSearch();
    expect(controller.phase).toBe('FOX_IDLE');

    const settle = controller.moveBy(0, 0, true, 7) as FoxDragSettleAck;
    expect(settle.generation).toBe(7);
    controller.commitFoxDragSettle(settle.settleId);
    expect(controller.phase).toBe('SEARCH_INPUT');
  });
});

describe('OverlayController yield previous-app focus', () => {
  const controllers: OverlayController[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const controller of controllers.splice(0)) {
      controller.dispose();
    }
  });

  function yieldPalette(controller: OverlayController, fox: FoxWindowFixture) {
    const yieldOrKeepPalette = Reflect.get(controller, 'yieldOrKeepPalette') as (
      win: BrowserWindow,
    ) => void;
    yieldOrKeepPalette.call(controller, fox);
  }

  it('on darwin hides then shows the fox on the next scheduler tick, not synchronously', () => {
    vi.useFakeTimers();
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
    const { controller, fox } = controllerWithDockedFox();
    controllers.push(controller);
    Object.assign(controller as object, {
      restorePreviousAppOnIdle: true,
      chromeHandoffMode: null,
      phase: 'FOX_IDLE',
    });
    fox.showInactive.mockClear();

    yieldPalette(controller, fox);

    expect(fox.setFocusable).toHaveBeenCalledWith(false);
    expect(app.hide).toHaveBeenCalledOnce();
    expect(fox.showInactive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(34);
    expect(fox.showInactive).toHaveBeenCalledOnce();
  });

  it('cancels the delayed fox show when search opens', () => {
    vi.useFakeTimers();
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
    const { controller, fox } = controllerWithDockedFox();
    controllers.push(controller);
    Object.assign(controller as object, {
      restorePreviousAppOnIdle: true,
      chromeHandoffMode: null,
      phase: 'FOX_IDLE',
    });
    fox.showInactive.mockClear();
    yieldPalette(controller, fox);
    const clearFoxYieldShow = Reflect.get(controller, 'clearFoxYieldShow') as () => void;
    clearFoxYieldShow.call(controller);
    vi.advanceTimersByTime(34);
    expect(fox.showInactive).not.toHaveBeenCalled();
  });

  it('does not app.hide when another chrome window is visible', () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
    const { controller, fox } = controllerWithDockedFox();
    controllers.push(controller);
    const extra = { isDestroyed: () => false, isVisible: () => true } as unknown as BrowserWindow;
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([fox, extra]);
    Object.assign(controller as object, {
      restorePreviousAppOnIdle: true,
      chromeHandoffMode: null,
      phase: 'FOX_IDLE',
    });
    fox.showInactive.mockClear();
    yieldPalette(controller, fox);
    expect(app.hide).not.toHaveBeenCalled();
    expect(fox.showInactive).toHaveBeenCalled();
  });

  it('still yields when the extra window is DevTools', () => {
    vi.useFakeTimers();
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
    const { controller, fox } = controllerWithDockedFox();
    controllers.push(controller);
    const devtools = {
      isDestroyed: () => false,
      isVisible: () => true,
      webContents: {
        isDestroyed: () => false,
        getType: () => 'remote',
        getURL: () => 'devtools://devtools/bundled/devtools_app.html',
      },
    } as unknown as BrowserWindow;
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([fox, devtools]);
    Object.assign(controller as object, {
      restorePreviousAppOnIdle: true,
      chromeHandoffMode: null,
      phase: 'FOX_IDLE',
    });
    fox.showInactive.mockClear();
    yieldPalette(controller, fox);
    expect(app.hide).toHaveBeenCalledOnce();
    expect(fox.showInactive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(34);
    expect(fox.showInactive).toHaveBeenCalledOnce();
  });

  it('on win32 hides the fox one tick then showInactive, without app.hide or steal', () => {
    vi.useFakeTimers();
    const previous = process.platform;
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    try {
      const { controller, fox } = controllerWithDockedFox();
      controllers.push(controller);
      Object.assign(controller as object, {
        restorePreviousAppOnIdle: true,
        chromeHandoffMode: null,
        phase: 'FOX_IDLE',
      });
      fox.showInactive.mockClear();
      yieldPalette(controller, fox);
      expect(fox.setFocusable).toHaveBeenCalledWith(false);
      expect(fox.blur).toHaveBeenCalledOnce();
      expect(fox.hide).toHaveBeenCalledOnce();
      expect(app.hide).not.toHaveBeenCalled();
      expect(app.focus).not.toHaveBeenCalled();
      expect(fox.showInactive).not.toHaveBeenCalled();
      vi.advanceTimersByTime(34);
      expect(fox.showInactive).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(process, 'platform', { configurable: true, value: previous });
    }
  });
});
