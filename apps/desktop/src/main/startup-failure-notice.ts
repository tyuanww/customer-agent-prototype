import { app, dialog, type MessageBoxSyncOptions } from 'electron';
import { PackagedProfileError, type PackagedProfileErrorKind } from './product-runtime-config';

/**
 * Visible startup failure notice with a retry entry point.
 *
 * A packaged build that cannot resolve its synthetic profile fails closed: the
 * main process quits without starting any window. Double-clicking the installed
 * application shows no stdout, so the previous single `console.error` left an
 * operator staring at a window that flashed and vanished. This module is the
 * one Electron affordance that can report that before/without a window.
 *
 * `showMessageBoxSync` is used rather than `showErrorBox` because the latter
 * cannot offer a button. It still works before `app.whenReady()`, and it blocks
 * — which is what we want here, since the caller is already on its way out.
 *
 * The notice text is a fixed constant per failure class and never interpolates
 * the underlying error, the userData path, the host name or any configuration
 * value. The failure class is carried by `PackagedProfileError.kind`; anything
 * else gets an honest generic message rather than a misleading "configuration
 * is invalid".
 */
export const STARTUP_FAILURE_TITLE = '客服话术浮窗未能启动';
export const STARTUP_PROFILE_MISSING_DETAIL =
  '缺少运行配置，客户端无法启动。离线包应自带离线配置；产品主链请放置远端配置，不要在本机安装数据库。修复后选择「重试」。';
export const STARTUP_PROFILE_INVALID_DETAIL =
  '本地合成环境配置无效，客户端无法启动。该文件已存在但未通过校验，请检查后再重新打开本应用。';
export const STARTUP_PROFILE_UNREADABLE_DETAIL =
  '无法读取本地合成环境配置，客户端无法启动。请确认当前用户对该配置目录有读取权限，然后选择「重试」。';
export const STARTUP_UNKNOWN_DETAIL =
  '应用启动时发生错误，未能完成初始化。请重新打开本应用；若仍失败，请联系技术支持。';

export type StartupFailureNotice = Readonly<{ title: string; detail: string }>;

function noticeForKind(kind: PackagedProfileErrorKind): StartupFailureNotice {
  const detail = kind === 'missing'
    ? STARTUP_PROFILE_MISSING_DETAIL
    : kind === 'invalid' ? STARTUP_PROFILE_INVALID_DETAIL : STARTUP_PROFILE_UNREADABLE_DETAIL;
  return { title: STARTUP_FAILURE_TITLE, detail };
}

/**
 * Map a startup failure to the user-facing notice. Pure and total: an
 * unrecognized error deliberately falls back to the generic text instead of
 * mislabeling it as a configuration problem.
 */
export function startupFailureNotice(reason: unknown): StartupFailureNotice {
  if (reason instanceof PackagedProfileError) return noticeForKind(reason.kind);
  return { title: STARTUP_FAILURE_TITLE, detail: STARTUP_UNKNOWN_DETAIL };
}

type ShowMessageBox = (options: MessageBoxSyncOptions) => number;
type FailureLogger = (message: string, reason: unknown) => void;

export type StartupFailureNotifier = (reason: unknown) => Promise<void>;

/**
 * Button set per failure class.
 *
 * Only a failure the operator can actually act on gets a retry. A missing or
 * unreadable profile is fixable by installing the stack or fixing permissions
 * and then relaunching, so offering "重试" is honest. A rejected profile is a
 * different judgement — someone edited the file and got it wrong — and an
 * unrecognized error is not diagnosable from here; both get a single dismiss
 * button rather than a retry that would very likely land in the same state.
 */
function buttonsForKind(kind: PackagedProfileErrorKind | null): readonly string[] {
  return kind === 'missing' || kind === 'unreadable'
    ? ['重试', '退出'] as const
    : ['退出'] as const;
}

/** 0 is the first button. A dismissal (Esc / window close) also returns 0. */
const RETRY_BUTTON_INDEX = 0;
const QUIT_BUTTON_INDEX = 1;

export function createStartupFailureNotifier(options: {
  showMessageBox?: ShowMessageBox;
  /** Restart the app so a fixed configuration is re-read from scratch. */
  relaunch?: () => void;
  log?: FailureLogger;
} = {}): StartupFailureNotifier {
  const showMessageBox = options.showMessageBox ?? ((messageOptions) => dialog.showMessageBoxSync(messageOptions));
  const relaunch = options.relaunch ?? (() => { app.relaunch(); });
  const log = options.log ?? ((message, reason) => {
    console.error(message, reason);
  });

  return async (reason: unknown): Promise<void> => {
    const { title, detail } = startupFailureNotice(reason);
    const kind = reason instanceof PackagedProfileError ? reason.kind : null;
    const buttons = buttonsForKind(kind);
    let chosen: number;
    try {
      chosen = showMessageBox({
        type: 'error',
        title,
        message: title,
        detail,
        buttons: [...buttons],
        defaultId: 0,
        cancelId: buttons.length === 2 ? QUIT_BUTTON_INDEX : 0,
        noLink: true,
      });
    } catch (error: unknown) {
      // Failing to show the notice must not replace the original startup
      // failure, and must not stop the caller from quitting.
      log('[bootstrap] 启动失败提示无法显示。', error);
      return;
    }
    // Retry restarts the process rather than re-entering startup in place: by
    // this point the overlay controller, the IPC handlers and the desktop shell
    // are already installed, so re-running `whenReady` would register them a
    // second time. A relaunch re-reads the profile from a clean state.
    if (chosen === RETRY_BUTTON_INDEX && buttons.length === 2) {
      try {
        relaunch();
      } catch (error: unknown) {
        log('[bootstrap] 启动失败提示的重试无法重启应用。', error);
      }
    }
  };
}

export const notifyStartupFailure = createStartupFailureNotifier();