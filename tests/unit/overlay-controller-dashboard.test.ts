import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const mocks = vi.hoisted(() => ({
  createDashboardBrowserWindow: vi.fn(),
  loadRenderer: vi.fn(),
  lockRendererWindow: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    isReady: () => true,
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
  globalShortcut: {
    register: vi.fn(),
    unregister: vi.fn(),
  },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
  },
  systemPreferences: {
    getUserDefault: () => false,
  },
}));

vi.mock('../../src/main/dashboard-window', () => ({
  createDashboardBrowserWindow: mocks.createDashboardBrowserWindow,
  readDashboardWindowSnapshot: vi.fn(),
}));

vi.mock('../../src/main/overlay-renderer-loader', () => ({
  loadRenderer: mocks.loadRenderer,
}));

vi.mock('../../src/main/window-security', () => ({
  lockRendererWindow: mocks.lockRendererWindow,
}));

vi.mock('../../src/main/overlay-test-harness', () => ({
  attachTestHarness: vi.fn(),
}));

import { OverlayController } from '../../src/main/overlay-controller';
import { createShutdownFence } from '../../src/main/shutdown-fence';
import { OPEN_DASHBOARD_FAILURE_MESSAGE } from '../../src/shared/dashboard-access';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function createWindowFixture() {
  let destroyed = false;
  const listeners = new Map<string, () => void>();
  const win = {
    close: vi.fn(() => {
      destroyed = true;
      listeners.get('closed')?.();
    }),
    destroy: vi.fn(() => {
      destroyed = true;
      listeners.get('closed')?.();
    }),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => destroyed),
    isMinimized: vi.fn(() => false),
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
      return win;
    }),
    restore: vi.fn(),
    show: vi.fn(),
    webContents: {
      id: 91,
      isDestroyed: () => destroyed,
    },
  };
  return win as unknown as BrowserWindow & {
    destroy: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    isMinimized: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
  };
}

describe('OverlayController dashboard opening', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('awaits one renderer load before showing a singleton dashboard', async () => {
    const load = deferred<'loaded' | 'cancelled'>();
    const win = createWindowFixture();
    mocks.createDashboardBrowserWindow.mockReturnValue(win);
    mocks.loadRenderer.mockReturnValue(load.promise);
    const controller = new OverlayController();
    const dismissSpy = vi.spyOn(controller, 'dismiss');

    const first = controller.openDashboard();
    const second = controller.openDashboard();

    expect(mocks.createDashboardBrowserWindow).toHaveBeenCalledOnce();
    expect(mocks.loadRenderer).toHaveBeenCalledOnce();
    expect(win.show).not.toHaveBeenCalled();
    expect(win.focus).not.toHaveBeenCalled();
    expect(dismissSpy).not.toHaveBeenCalled();

    load.resolve('loaded');
    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(dismissSpy).toHaveBeenCalledOnce();
    expect(win.show).toHaveBeenCalledOnce();
    expect(win.focus).toHaveBeenCalledOnce();
    expect(win.focus.mock.invocationCallOrder[0]).toBeLessThan(
      dismissSpy.mock.invocationCallOrder[0]!,
    );
  });

  it('restores an existing dashboard and dismisses Query only after reveal succeeds', async () => {
    const win = createWindowFixture();
    mocks.createDashboardBrowserWindow.mockReturnValue(win);
    mocks.loadRenderer.mockResolvedValue('loaded');
    const controller = new OverlayController();
    const dismissSpy = vi.spyOn(controller, 'dismiss');

    await expect(controller.openDashboard()).resolves.toEqual({ ok: true });
    vi.clearAllMocks();
    dismissSpy.mockClear();
    win.isMinimized.mockReturnValue(true);

    await expect(controller.openDashboard()).resolves.toEqual({ ok: true });

    expect(mocks.createDashboardBrowserWindow).not.toHaveBeenCalled();
    expect(mocks.loadRenderer).not.toHaveBeenCalled();
    expect(win.restore).toHaveBeenCalledOnce();
    expect(win.show).toHaveBeenCalledOnce();
    expect(win.focus).toHaveBeenCalledOnce();
    expect(dismissSpy).toHaveBeenCalledOnce();
    expect(win.restore.mock.invocationCallOrder[0]).toBeLessThan(win.show.mock.invocationCallOrder[0]!);
    expect(win.show.mock.invocationCallOrder[0]).toBeLessThan(win.focus.mock.invocationCallOrder[0]!);
    expect(win.focus.mock.invocationCallOrder[0]).toBeLessThan(
      dismissSpy.mock.invocationCallOrder[0]!,
    );
  });

  it.each(['restore', 'show', 'focus'] as const)(
    'keeps Query available and abandons an existing dashboard when %s throws',
    async (method) => {
      const win = createWindowFixture();
      const retryWin = createWindowFixture();
      mocks.createDashboardBrowserWindow.mockReturnValueOnce(win).mockReturnValueOnce(retryWin);
      mocks.loadRenderer.mockResolvedValue('loaded');
      const controller = new OverlayController();
      const dismissSpy = vi.spyOn(controller, 'dismiss');

      await expect(controller.openDashboard()).resolves.toEqual({ ok: true });
      dismissSpy.mockClear();
      win.isMinimized.mockReturnValue(method === 'restore');
      win[method].mockImplementationOnce(() => {
        throw new Error(`${method} failed`);
      });

      await expect(controller.openDashboard()).resolves.toEqual({
        ok: false,
        message: OPEN_DASHBOARD_FAILURE_MESSAGE,
      });
      expect(dismissSpy).not.toHaveBeenCalled();
      expect(win.destroy).toHaveBeenCalledOnce();

      await expect(controller.openDashboard()).resolves.toEqual({ ok: true });
      expect(mocks.createDashboardBrowserWindow).toHaveBeenCalledTimes(2);
      expect(retryWin.show).toHaveBeenCalledOnce();
      expect(retryWin.focus).toHaveBeenCalledOnce();
    },
  );

  it.each(['show', 'focus'] as const)(
    'returns one typed failure to concurrent callers when a new dashboard %s throws',
    async (method) => {
      const load = deferred<'loaded' | 'cancelled'>();
      const win = createWindowFixture();
      const retryWin = createWindowFixture();
      win[method].mockImplementationOnce(() => {
        throw new Error(`${method} failed`);
      });
      mocks.createDashboardBrowserWindow.mockReturnValueOnce(win).mockReturnValueOnce(retryWin);
      mocks.loadRenderer.mockReturnValueOnce(load.promise).mockResolvedValueOnce('loaded');
      const controller = new OverlayController();
      const dismissSpy = vi.spyOn(controller, 'dismiss');

      const first = controller.openDashboard();
      const second = controller.openDashboard();
      load.resolve('loaded');

      await expect(Promise.all([first, second])).resolves.toEqual([
        { ok: false, message: OPEN_DASHBOARD_FAILURE_MESSAGE },
        { ok: false, message: OPEN_DASHBOARD_FAILURE_MESSAGE },
      ]);
      expect(dismissSpy).not.toHaveBeenCalled();
      expect(win.destroy).toHaveBeenCalledOnce();

      await expect(controller.openDashboard()).resolves.toEqual({ ok: true });
      expect(mocks.createDashboardBrowserWindow).toHaveBeenCalledTimes(2);
      expect(retryWin.show).toHaveBeenCalledOnce();
      expect(retryWin.focus).toHaveBeenCalledOnce();
    },
  );

  it('fails every concurrent caller and destroys the hidden window when loading fails', async () => {
    const load = deferred<'loaded' | 'cancelled'>();
    const win = createWindowFixture();
    mocks.createDashboardBrowserWindow.mockReturnValue(win);
    mocks.loadRenderer.mockReturnValue(load.promise);
    const controller = new OverlayController();
    const dismissSpy = vi.spyOn(controller, 'dismiss');

    const first = controller.openDashboard();
    const second = controller.openDashboard();
    expect(dismissSpy).not.toHaveBeenCalled();
    load.reject(new Error('renderer failed'));

    await expect(first).resolves.toEqual({ ok: false, message: OPEN_DASHBOARD_FAILURE_MESSAGE });
    await expect(second).resolves.toEqual({ ok: false, message: OPEN_DASHBOARD_FAILURE_MESSAGE });
    expect(dismissSpy).not.toHaveBeenCalled();
    expect(win.destroy).toHaveBeenCalledOnce();
    expect(win.show).not.toHaveBeenCalled();

    const retryLoad = deferred<'loaded' | 'cancelled'>();
    const retryWin = createWindowFixture();
    mocks.createDashboardBrowserWindow.mockReturnValueOnce(retryWin);
    mocks.loadRenderer.mockReturnValueOnce(retryLoad.promise);
    const retry = controller.openDashboard();

    expect(mocks.createDashboardBrowserWindow).toHaveBeenCalledTimes(2);
    expect(mocks.loadRenderer).toHaveBeenCalledTimes(2);
    expect(retryWin.show).not.toHaveBeenCalled();
    expect(dismissSpy).not.toHaveBeenCalled();

    retryLoad.resolve('loaded');
    await expect(retry).resolves.toEqual({ ok: true });
    expect(dismissSpy).toHaveBeenCalledOnce();
    expect(retryWin.show).toHaveBeenCalledOnce();
    expect(retryWin.focus).toHaveBeenCalledOnce();
  });

  it('fails every concurrent caller and cleans the hidden window when a deferred load is cancelled', async () => {
    const load = deferred<'loaded' | 'cancelled'>();
    const win = createWindowFixture();
    mocks.createDashboardBrowserWindow.mockReturnValue(win);
    mocks.loadRenderer.mockReturnValue(load.promise);
    const controller = new OverlayController();
    const dismissSpy = vi.spyOn(controller, 'dismiss');

    const first = controller.openDashboard();
    const second = controller.openDashboard();
    expect(win.show).not.toHaveBeenCalled();
    load.resolve('cancelled');

    await expect(first).resolves.toEqual({ ok: false, message: OPEN_DASHBOARD_FAILURE_MESSAGE });
    await expect(second).resolves.toEqual({ ok: false, message: OPEN_DASHBOARD_FAILURE_MESSAGE });
    expect(dismissSpy).not.toHaveBeenCalled();
    expect(win.destroy).toHaveBeenCalledOnce();
    expect(win.show).not.toHaveBeenCalled();

    const retryLoad = deferred<'loaded' | 'cancelled'>();
    const retryWin = createWindowFixture();
    mocks.createDashboardBrowserWindow.mockReturnValueOnce(retryWin);
    mocks.loadRenderer.mockReturnValueOnce(retryLoad.promise);
    const retry = controller.openDashboard();
    retryLoad.resolve('loaded');
    await expect(retry).resolves.toEqual({ ok: true });
    expect(retryWin.show).toHaveBeenCalledOnce();
  });

  it('does not create a window after shutdown', async () => {
    const fence = createShutdownFence();
    fence.begin();
    const controller = new OverlayController({ fence });

    await expect(controller.openDashboard()).resolves.toEqual({
      ok: false,
      message: OPEN_DASHBOARD_FAILURE_MESSAGE,
    });
    expect(mocks.createDashboardBrowserWindow).not.toHaveBeenCalled();
    expect(mocks.loadRenderer).not.toHaveBeenCalled();
  });
});
