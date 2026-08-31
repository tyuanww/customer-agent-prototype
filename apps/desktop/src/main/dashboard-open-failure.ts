import { dialog, type MessageBoxOptions } from 'electron';
import type { OpenDashboardResult } from '../shared/dashboard-access';

export const NATIVE_DASHBOARD_FAILURE_TITLE = '运营工作台未打开';
export const NATIVE_DASHBOARD_FAILURE_DETAIL =
  '狐狸头和话术查询仍可继续使用，请稍后重试。';

const MESSAGE_BOX_OPTIONS: MessageBoxOptions = {
  type: 'warning',
  title: NATIVE_DASHBOARD_FAILURE_TITLE,
  message: NATIVE_DASHBOARD_FAILURE_TITLE,
  detail: NATIVE_DASHBOARD_FAILURE_DETAIL,
  buttons: ['知道了'],
  defaultId: 0,
  cancelId: 0,
  noLink: true,
};

type ShowMessageBox = (options: MessageBoxOptions) => Promise<unknown>;
type FailureLogger = (message: string, reason: unknown) => void;

export type DashboardOpenFailureNotifier = (reason: unknown) => Promise<void>;

export function createDashboardOpenFailureNotifier(options: {
  showMessageBox?: ShowMessageBox;
  log?: FailureLogger;
} = {}): DashboardOpenFailureNotifier {
  const showMessageBox = options.showMessageBox ?? ((messageOptions) =>
    dialog.showMessageBox(messageOptions));
  const log = options.log ?? ((message, reason) => {
    console.error(message, reason);
  });
  let pending: Promise<void> | null = null;

  return (reason: unknown): Promise<void> => {
    log('[dashboard] 原生入口打开工作台失败。', reason);
    if (pending) {
      return pending;
    }

    const current = Promise.resolve()
      .then(() => showMessageBox(MESSAGE_BOX_OPTIONS))
      .then(() => undefined)
      .catch((error: unknown) => {
        log('[dashboard] 原生失败提示无法显示。', error);
      })
      .finally(() => {
        if (pending === current) {
          pending = null;
        }
      });
    pending = current;
    return current;
  };
}

export const notifyDashboardOpenFailure = createDashboardOpenFailureNotifier();

export async function runDashboardOpenAttempt(
  openDashboard: () => Promise<OpenDashboardResult> | OpenDashboardResult,
  onFailure: DashboardOpenFailureNotifier = notifyDashboardOpenFailure,
): Promise<void> {
  let failure: { reason: unknown } | null = null;
  try {
    const result = await openDashboard();
    if (!result || result.ok !== true) {
      failure = { reason: result };
    }
  } catch (error: unknown) {
    failure = { reason: error };
  }

  if (!failure) {
    return;
  }
  try {
    await onFailure(failure.reason);
  } catch (error: unknown) {
    console.error('[dashboard] 打开失败通知器异常。', error);
  }
}
