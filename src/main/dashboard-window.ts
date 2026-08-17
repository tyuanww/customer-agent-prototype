import { BrowserWindow, nativeTheme, type WebPreferences } from 'electron';
import {
  DASHBOARD_WINDOW_CHROME,
  DASHBOARD_WINDOW_SECURITY,
  DASHBOARD_WINDOW_TITLE,
  dashboardTitleBarStyleFor,
  resolveDashboardNativeChrome,
  usesIntegratedDashboardChrome,
  type DashboardTitleBarStyle,
} from '../shared/dashboard-window';
import { loadBrandNativeImage } from './app-identity';

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
  title: string;
  titleBarStyle: DashboardTitleBarStyle;
  integratedChrome: boolean;
};

const DASHBOARD_WEB_PREFERENCES: WebPreferences = {
  ...DASHBOARD_WINDOW_SECURITY,
};

export function createDashboardBrowserWindow(): BrowserWindow {
  const nativeChrome = resolveDashboardNativeChrome(process.platform);
  const icon = loadBrandNativeImage();
  const win = new BrowserWindow({
    ...nativeChrome,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16151a' : nativeChrome.backgroundColor,
    title: DASHBOARD_WINDOW_TITLE,
    ...(icon ? { icon } : {}),
    webPreferences: DASHBOARD_WEB_PREFERENCES,
  });
  win.setMenuBarVisibility(false);
  // The shared renderer document title is the overlay product name. Keep the
  // Dashboard window title as the business label for taskbar / Mission Control
  // without painting a second native title on macOS hiddenInset chrome.
  win.on('page-title-updated', (event) => {
    event.preventDefault();
    if (win.getTitle() !== DASHBOARD_WINDOW_TITLE) {
      win.setTitle(DASHBOARD_WINDOW_TITLE);
    }
  });
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
    title: win.getTitle(),
    titleBarStyle: dashboardTitleBarStyleFor(process.platform),
    integratedChrome: usesIntegratedDashboardChrome(
      process.platform === 'darwin' ? 'darwin' : 'unknown',
    ),
  };
}
