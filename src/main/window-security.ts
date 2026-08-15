import type { BrowserWindow, Session } from 'electron';

export function applySessionSecurity(target: Session): void {
  target.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  target.setPermissionCheckHandler(() => false);
}

export function lockRendererWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}
