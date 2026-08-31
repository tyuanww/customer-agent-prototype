import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GuardedScheduler } from '../../src/main/guarded-scheduler';
import {
  createShutdownFence,
  isInactiveOverlay,
  isUsableWindow,
} from '../../src/main/shutdown-fence';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('shutdown fence', () => {
  it('starts open and becomes sticky after begin', () => {
    const fence = createShutdownFence();
    expect(fence.isShuttingDown()).toBe(false);
    fence.begin();
    expect(fence.isShuttingDown()).toBe(true);
    fence.begin();
    expect(fence.isShuttingDown()).toBe(true);
    expect(isInactiveOverlay(false, fence)).toBe(true);
    expect(isInactiveOverlay(true)).toBe(true);
    expect(isInactiveOverlay(false)).toBe(false);
  });

  it('treats destroyed or inactive windows as unusable', () => {
    const fence = createShutdownFence();
    const live = { isDestroyed: () => false };
    const dead = { isDestroyed: () => true };
    expect(isUsableWindow(live)).toBe(true);
    expect(isUsableWindow(dead)).toBe(false);
    expect(isUsableWindow(null)).toBe(false);
    expect(isUsableWindow(live, true)).toBe(false);
    fence.begin();
    expect(isUsableWindow(live, false, fence)).toBe(false);
  });
});

describe('guarded scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops callbacks scheduled after dispose and after a late timer fire', () => {
    vi.useFakeTimers();
    const scheduler = new GuardedScheduler();
    const late = vi.fn();
    const cancelled = vi.fn();
    scheduler.schedule(cancelled, 20);
    scheduler.dispose();
    scheduler.schedule(late, 10);
    vi.advanceTimersByTime(50);
    expect(cancelled).not.toHaveBeenCalled();
    expect(late).not.toHaveBeenCalled();
    expect(scheduler.isDisposed).toBe(true);
    expect(scheduler.schedule(late, 1)).toBeNull();
  });
});

describe('overlay shutdown contract', () => {
  it('disposes before quit, fail-closes IPC, and does not use skipTransform with regular Dock', () => {
    const main = readFileSync(path.join(root, 'src/main/main.ts'), 'utf8');
    const controller = [
      readFileSync(path.join(root, 'src/main/overlay-controller.ts'), 'utf8'),
      readFileSync(path.join(root, 'src/main/overlay-renderer-loader.ts'), 'utf8'),
      readFileSync(path.join(root, 'src/main/overlay-chrome-window.ts'), 'utf8'),
    ].join('\n');
    const identity = readFileSync(path.join(root, 'src/main/app-identity.ts'), 'utf8');

    expect(main).toContain('const shuttingDown = createShutdownFence()');
    expect(main).toContain('const handleActivate = (): void =>');
    expect(main).toContain('app.removeListener(\'activate\', handleActivate)');
    expect(main).toContain('controllerReady = false');
    expect(main).toContain('controller = null');
    expect(main.indexOf('controller = null')).toBeLessThan(main.indexOf('outgoing?.dispose()'));
    expect(main).toContain('outgoing?.dispose()');
    expect(main).toContain('app.on(\'before-quit\', beginShutdown)');
    expect(main).toContain("}).catch((error: unknown) => {");
    expect(main).toContain("console.error('[bootstrap] 主进程启动失败，已安全退出。', error)");
    expect(main).toContain('process.env.DEMO_E2E_ACCELERATOR');
    expect(main).not.toContain('uncaughtException');
    expect(main).not.toContain('skipTransformProcessType');

    expect(controller).toContain('dispose(): void');
    expect(controller).not.toContain('unregisterShortcut(): void');
    expect(controller).toContain('if (this.isInactive())');
    expect(controller).toContain(
      "loadRenderer(this.fox, 'fox', this.rendererDevServerUrl, () => this.isInactive())",
    );
    expect(controller).toContain("Promise<'loaded' | 'cancelled'>");
    expect(controller).toContain("return 'cancelled'");
    expect(controller).toContain("return 'loaded'");
    expect(controller).toMatch(
      /loadState = await loadRenderer\(\s*win,\s*'dashboard',\s*this\.rendererDevServerUrl,/,
    );
    expect(controller).toContain('this.abandonDashboardWindow(win)');
    expect(controller).toContain('private abandonDashboardWindow');
    expect(controller).not.toContain('skipTransformProcessType: true');
    expect(controller).not.toContain('setVisibleOnAllWorkspaces(');
    expect(controller).toContain('this.scheduler.dispose()');

    expect(identity).toContain('if (dock && !dock.isVisible())');
    expect(identity).toContain('fence?.isShuttingDown()');
  });
});
