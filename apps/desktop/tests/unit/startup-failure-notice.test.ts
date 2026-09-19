import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MessageBoxSyncOptions } from 'electron';
import {
  STARTUP_FAILURE_TITLE,
  STARTUP_PROFILE_INVALID_DETAIL,
  STARTUP_PROFILE_MISSING_DETAIL,
  STARTUP_PROFILE_UNREADABLE_DETAIL,
  STARTUP_UNKNOWN_DETAIL,
  createStartupFailureNotifier,
  startupFailureNotice,
} from '../../src/main/startup-failure-notice';
import { PackagedProfileError } from '../../src/main/product-runtime-config';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const electronMocks = vi.hoisted(() => ({
  showMessageBoxSync: vi.fn((_options: unknown): number => 1),
  relaunch: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { relaunch: electronMocks.relaunch },
  dialog: { showMessageBoxSync: electronMocks.showMessageBoxSync },
}));

/** The button list the notifier asked the native dialog to show. */
function buttonsOf(call: number): readonly string[] {
  const invocation = electronMocks.showMessageBoxSync.mock.calls[call];
  const options = invocation?.[0] as { buttons?: readonly string[] } | undefined;
  return options?.buttons ?? [];
}

type MessageBoxOptions = MessageBoxSyncOptions;
/** A dialog double that returns `button`, typed so `.mock.calls[0][0]` is readable. */
function dialogReturning(button: number) {
  return vi.fn((_options: MessageBoxOptions) => button);
}

describe('startup failure notice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.showMessageBoxSync.mockReturnValue(1);
  });

  it('routes the default notifier through the native message box', async () => {
    await createStartupFailureNotifier({ log: vi.fn() })(new PackagedProfileError('missing'));

    expect(electronMocks.showMessageBoxSync).toHaveBeenCalledOnce();
    const options = electronMocks.showMessageBoxSync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options.title).toBe(STARTUP_FAILURE_TITLE);
    expect(options.detail).toBe(STARTUP_PROFILE_MISSING_DETAIL);
    expect(options.type).toBe('error');
  });

  it('reports a missing profile without telling the operator to install PostgreSQL', async () => {
    expect(STARTUP_PROFILE_MISSING_DETAIL).not.toMatch(/PostgreSQL|合成栈安装脚本|pg15/i);
    expect(STARTUP_PROFILE_MISSING_DETAIL).toContain('不要在本机安装数据库');
    const showMessageBox = dialogReturning(1);
    const notify = createStartupFailureNotifier({ showMessageBox, log: vi.fn() });

    await notify(new PackagedProfileError('missing'));

    expect(showMessageBox).toHaveBeenCalledOnce();
    expect(showMessageBox.mock.calls[0]?.[0]).toMatchObject({
      title: STARTUP_FAILURE_TITLE,
      detail: STARTUP_PROFILE_MISSING_DETAIL,
    });
  });

  it('reports a rejected profile file with the regenerate message', async () => {
    const showMessageBox = dialogReturning(0);
    const notify = createStartupFailureNotifier({ showMessageBox, log: vi.fn() });

    await notify(new PackagedProfileError('invalid'));

    expect(showMessageBox.mock.calls[0]?.[0]).toMatchObject({
      title: STARTUP_FAILURE_TITLE,
      detail: STARTUP_PROFILE_INVALID_DETAIL,
    });
  });

  it('reports an unreadable profile file with the permission message', async () => {
    const showMessageBox = dialogReturning(1);
    const notify = createStartupFailureNotifier({ showMessageBox, log: vi.fn() });

    await notify(new PackagedProfileError('unreadable'));

    expect(showMessageBox.mock.calls[0]?.[0]).toMatchObject({
      title: STARTUP_FAILURE_TITLE,
      detail: STARTUP_PROFILE_UNREADABLE_DETAIL,
    });
  });

  it('falls back to a generic notice for an unknown startup error', async () => {
    const showMessageBox = dialogReturning(0);
    const notify = createStartupFailureNotifier({ showMessageBox, log: vi.fn() });

    await notify(new Error('some internal failure at C:\\Users\\operator\\app'));

    expect(showMessageBox.mock.calls[0]?.[0]).toMatchObject({
      title: STARTUP_FAILURE_TITLE,
      detail: STARTUP_UNKNOWN_DETAIL,
    });
  });

  it('offers retry only for failures the operator can act on', async () => {
    // Missing and unreadable are fixable (install the stack / fix permissions),
    // so a retry is honest. Invalid and unknown are not.
    for (const [kind, expected] of [
      ['missing', ['重试', '退出']],
      ['unreadable', ['重试', '退出']],
    ] as const) {
      electronMocks.showMessageBoxSync.mockClear();
      await createStartupFailureNotifier({ log: vi.fn() })(new PackagedProfileError(kind));
      expect(buttonsOf(0), kind).toEqual([...expected]);
    }

    for (const reason of [new PackagedProfileError('invalid'), new Error('unknown')]) {
      electronMocks.showMessageBoxSync.mockClear();
      await createStartupFailureNotifier({ log: vi.fn() })(reason);
      expect(buttonsOf(0)).toEqual(['退出']);
    }
  });

  it('restarts the app when retry is chosen', async () => {
    electronMocks.showMessageBoxSync.mockReturnValue(0);
    const relaunch = vi.fn();
    const notify = createStartupFailureNotifier({ showMessageBox: dialogReturning(0), relaunch, log: vi.fn() });

    await notify(new PackagedProfileError('missing'));

    // Retry relaunches instead of re-entering startup: the overlay controller,
    // IPC handlers and desktop shell are already installed by this point.
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it('does not restart the app when quit is chosen', async () => {
    const relaunch = vi.fn();
    const notify = createStartupFailureNotifier({ showMessageBox: dialogReturning(1), relaunch, log: vi.fn() });

    await notify(new PackagedProfileError('missing'));

    expect(relaunch).not.toHaveBeenCalled();
  });

  it('does not restart the app for a failure that offers no retry', async () => {
    const relaunch = vi.fn();
    // A dismissal (Esc / close) reports button 0. For the single-button case
    // that is "退出", not an accidental retry.
    const notify = createStartupFailureNotifier({ showMessageBox: dialogReturning(0), relaunch, log: vi.fn() });

    await notify(new PackagedProfileError('invalid'));
    await notify(new Error('unknown'));

    expect(relaunch).not.toHaveBeenCalled();
  });

  it('contains a relaunch failure instead of rejecting', async () => {
    const log = vi.fn();
    const notify = createStartupFailureNotifier({
      showMessageBox: dialogReturning(0),
      relaunch: () => {
        throw new Error('relaunch unavailable');
      },
      log,
    });

    await expect(notify(new PackagedProfileError('unreadable'))).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('[bootstrap] 启动失败提示的重试无法重启应用。', expect.any(Error));
  });

  it('never echoes the reason, a path, a host or a configuration value', () => {
    // The notice is built from constants only, so a hostile or leaky error
    // message cannot reach the dialog text.
    const leaky = new Error('open /Users/operator/Library/Application Support/x/synthetic-stack.json failed');
    Object.assign(leaky, { kind: 'missing' });

    for (const reason of [leaky, new PackagedProfileError('missing'), new PackagedProfileError('invalid')]) {
      const { title, detail } = startupFailureNotice(reason);
      expect(title).toBe(STARTUP_FAILURE_TITLE);
      expect(detail).not.toContain('/Users');
      expect(detail).not.toContain('Application Support');
      expect(detail).not.toContain('synthetic-stack.json');
      expect(detail).not.toContain('operator');
    }
  });

  it('contains a throwing dialog without rejecting or masking the failure', async () => {
    const dialogError = new Error('dialog unavailable');
    const log = vi.fn();
    const notify = createStartupFailureNotifier({
      showMessageBox: vi.fn((_options: MessageBoxOptions): number => {
        throw dialogError;
      }),
      log,
    });

    await expect(notify(new PackagedProfileError('missing'))).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('[bootstrap] 启动失败提示无法显示。', dialogError);
  });

  it('notifies and still quits fail-closed in the bootstrap catch path', () => {
    const main = readFileSync(path.join(desktopRoot, 'src/main/main.ts'), 'utf8');
    // Bound the search to the startup catch block. main.ts holds other
    // `app.quit()` calls (the single-instance guard and window-all-closed), so
    // an unbounded indexOf would keep satisfying this ordering even if the
    // catch block stopped quitting — the assertion would no longer pin the
    // fail-closed exit it claims to guard.
    const catchAt = main.indexOf('.catch((error: unknown) => {');
    const catchBlock = main.slice(catchAt, main.indexOf('\n  });', catchAt));
    const notifyAt = catchBlock.indexOf('void notifyStartupFailure(error);');
    const shutdownAt = catchBlock.indexOf('beginShutdown();', notifyAt);
    const quitAt = catchBlock.indexOf('app.quit();', shutdownAt);

    expect(catchAt).toBeGreaterThan(-1);
    expect(notifyAt).toBeGreaterThan(-1);
    // The notice must be attempted before the shutdown fence flips, then the
    // process quits exactly as before: the visible feedback does not weaken
    // the fail-closed exit.
    expect(notifyAt).toBeLessThan(shutdownAt);
    expect(shutdownAt).toBeLessThan(quitAt);
    expect(catchBlock).toContain("console.error('[bootstrap] 主进程启动失败，已安全退出。', error)");
  });
});
