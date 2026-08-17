import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageBoxOptions } from 'electron';
import {
  NATIVE_DASHBOARD_FAILURE_DETAIL,
  NATIVE_DASHBOARD_FAILURE_TITLE,
  createDashboardOpenFailureNotifier,
  runDashboardOpenAttempt,
} from '../../src/main/dashboard-open-failure';
import { openDashboardUnavailable } from '../../src/shared/dashboard-access';

const electronMocks = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: {
    showMessageBox: electronMocks.showMessageBox,
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('native dashboard open failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.showMessageBox.mockResolvedValue({ response: 0 });
  });

  it('notifies for a typed dashboard failure', async () => {
    const failure = openDashboardUnavailable();
    const notify = vi.fn().mockResolvedValue(undefined);

    await runDashboardOpenAttempt(() => failure, notify);

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(failure);
  });

  it('notifies when dashboard opening rejects', async () => {
    const error = new Error('dashboard renderer failed');
    const notify = vi.fn().mockResolvedValue(undefined);

    await runDashboardOpenAttempt(async () => {
      throw error;
    }, notify);

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(error);
  });

  it('deduplicates concurrent native dialogs and allows a later retry', async () => {
    const firstDialog = deferred<{ response: number }>();
    const showMessageBox = vi.fn<(options: MessageBoxOptions) => Promise<unknown>>()
      .mockReturnValueOnce(firstDialog.promise)
      .mockResolvedValueOnce({ response: 0 });
    const log = vi.fn();
    const notify = createDashboardOpenFailureNotifier({ showMessageBox, log });

    const first = notify({ ok: false, message: 'first' });
    const concurrent = notify(new Error('concurrent'));

    expect(first).toBe(concurrent);
    await vi.waitFor(() => {
      expect(showMessageBox).toHaveBeenCalledOnce();
    });
    expect(showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning',
      title: NATIVE_DASHBOARD_FAILURE_TITLE,
      message: NATIVE_DASHBOARD_FAILURE_TITLE,
      detail: NATIVE_DASHBOARD_FAILURE_DETAIL,
      buttons: ['知道了'],
      noLink: true,
    }));

    firstDialog.resolve({ response: 0 });
    await Promise.all([first, concurrent]);
    await notify({ ok: false, message: 'later' });
    expect(showMessageBox).toHaveBeenCalledTimes(2);
  });

  it('logs a rejected native dialog and allows the next failure to retry', async () => {
    const dialogError = new Error('message box failed');
    const showMessageBox = vi.fn<(options: MessageBoxOptions) => Promise<unknown>>()
      .mockRejectedValueOnce(dialogError)
      .mockResolvedValueOnce({ response: 0 });
    const log = vi.fn();
    const notify = createDashboardOpenFailureNotifier({ showMessageBox, log });

    await expect(notify(new Error('open failed'))).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      '[dashboard] 原生失败提示无法显示。',
      dialogError,
    );

    await notify(new Error('retry'));
    expect(showMessageBox).toHaveBeenCalledTimes(2);
  });

  it('contains a rejected external notifier without leaking an unhandled rejection', async () => {
    const notifierError = new Error('notifier failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(runDashboardOpenAttempt(
      () => openDashboardUnavailable(),
      vi.fn().mockRejectedValue(notifierError),
    )).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      '[dashboard] 打开失败通知器异常。',
      notifierError,
    );
    consoleError.mockRestore();
  });
});
