import { BrowserWindow } from 'electron';

export type OverlayChromeWindowSize = {
  width: number;
  height: number;
  title: string;
  backgroundThrottling?: boolean;
  macPanel?: boolean;
};

export function createOverlayChromeWindow(
  preloadPath: string,
  size: OverlayChromeWindowSize,
): BrowserWindow {
  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    title: size.title,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // Both overlay surfaces draw their own CSS shadow. A second native shadow
    // gives transparent-window animations another cached layer to invalidate.
    hasShadow: false,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    autoHideMenuBar: true,
    roundedCorners: true,
    ...(process.platform === 'darwin'
      ? {
          ...(size.macPanel === false ? {} : { type: 'panel' as const }),
          hiddenInMissionControl: true,
        }
      : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: size.backgroundThrottling ?? true,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setMenuBarVisibility(false);
  return win;
}
