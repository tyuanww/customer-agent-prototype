import { BrowserWindow, nativeTheme, type WebPreferences } from 'electron';
import {
  DASHBOARD_WINDOW_CHROME,
  DASHBOARD_WINDOW_SECURITY,
  DASHBOARD_WINDOW_TITLE,
} from '../shared/dashboard-window';

export type DashboardWindowSnapshot = {
  visible: boolean;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  resizable: boolean;
  maximizable: boolean;
  minimizable: boolean;
  closable: boolean;
  alwaysOnTop: boolean;
  skipTaskbar: boolean;
  transparent: boolean;
  hasPreload: boolean;
};

const DASHBOARD_WEB_PREFERENCES: WebPreferences = {
  ...DASHBOARD_WINDOW_SECURITY,
};

export function createDashboardBrowserWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...DASHBOARD_WINDOW_CHROME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111014' : '#F7F6F9',
    title: DASHBOARD_WINDOW_TITLE,
    webPreferences: DASHBOARD_WEB_PREFERENCES,
  });
  win.setMenuBarVisibility(false);
  return win;
}

export function readDashboardWindowSnapshot(win: BrowserWindow): DashboardWindowSnapshot {
  const bounds = win.getBounds();
  const minimumSize = win.getMinimumSize();
  const preload = DASHBOARD_WEB_PREFERENCES.preload;
  return {
    visible: win.isVisible(),
    width: bounds.width,
    height: bounds.height,
    minWidth: minimumSize[0],
    minHeight: minimumSize[1],
    resizable: win.isResizable(),
    maximizable: win.isMaximizable(),
    minimizable: win.isMinimizable(),
    closable: win.isClosable(),
    alwaysOnTop: win.isAlwaysOnTop(),
    skipTaskbar: DASHBOARD_WINDOW_CHROME.skipTaskbar,
    transparent: DASHBOARD_WINDOW_CHROME.transparent,
    hasPreload: typeof preload === 'string' && preload.length > 0,
  };
}
