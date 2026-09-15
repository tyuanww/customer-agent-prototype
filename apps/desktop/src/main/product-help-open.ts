import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { loopbackOrigin } from './product-http';
import { SYNTHETIC_HELP_HTML } from '../shared/product-help';

export function allowedHelpUrl(value: string, origin: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash && !url.search
      && url.origin === origin && url.pathname === '/synthetic-help';
  } catch { return false; }
}

/** Isolated help window. Not a transfer receipt. Does not hit leftover search. */
export function openSyntheticHelp(identityOrigin: string): Promise<boolean> {
  return new Promise(resolve => {
    try {
      const origin = loopbackOrigin(identityOrigin);
      if (!allowedHelpUrl(`${origin}/synthetic-help`, origin)) { resolve(false); return; }
      const isolated = session.fromPartition(`synthetic-help-${randomUUID()}`);
      isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      isolated.setPermissionCheckHandler(() => false);
      const window = new BrowserWindow({
        width: 420, height: 360, title: '合成求助入口', show: false, alwaysOnTop: true,
        webPreferences: { session: isolated, contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      if (process.platform === 'darwin') window.setAlwaysOnTop(true, 'floating');
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return; settled = true; clearTimeout(deadline);
        if (ok) { window.show(); window.focus(); }
        else if (!window.isDestroyed()) window.destroy();
        resolve(ok);
      };
      const deadline = setTimeout(() => finish(false), 5_000);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith('data:text/html')) event.preventDefault();
      });
      window.webContents.on('will-redirect', (event) => { event.preventDefault(); });
      window.webContents.on('did-finish-load', () => finish(true));
      window.webContents.on('did-fail-load', () => finish(false));
      window.on('closed', () => finish(false));
      void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SYNTHETIC_HELP_HTML)}`).catch(() => finish(false));
    } catch {
      resolve(false);
    }
  });
}
