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

/** Isolated window to the exact loopback help path. Not a transfer receipt. */
export function openSyntheticHelp(identityOrigin: string): Promise<boolean> {
  return new Promise(resolve => {
    try {
      const origin = loopbackOrigin(identityOrigin);
      const target = `${origin}/synthetic-help`;
      if (!allowedHelpUrl(target, origin)) { resolve(false); return; }
      const isolated = session.fromPartition(`synthetic-help-${randomUUID()}`);
      isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      isolated.setPermissionCheckHandler(() => false);
      isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowedHelpUrl(details.url, origin) }));
      try {
        isolated.protocol.handle('http', request => allowedHelpUrl(request.url, origin)
          ? new Response(SYNTHETIC_HELP_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
          : new Response(null, { status: 403 }));
      } catch { /* Navigation guard still applies if intercept is unavailable. */ }
      const window = new BrowserWindow({
        width: 420, height: 360, title: '合成求助入口', show: false,
        webPreferences: { session: isolated, contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return; settled = true; clearTimeout(deadline);
        if (ok) window.show();
        else if (!window.isDestroyed()) window.destroy();
        resolve(ok);
      };
      const deadline = setTimeout(() => finish(false), 5_000);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => { if (!allowedHelpUrl(url, origin)) event.preventDefault(); });
      window.webContents.on('will-redirect', (event, url) => { if (!allowedHelpUrl(url, origin)) event.preventDefault(); });
      window.webContents.on('did-finish-load', () => {
        if (allowedHelpUrl(window.webContents.getURL(), origin)) finish(true);
      });
      window.webContents.on('did-fail-load', (_event, _code, _desc, url) => {
        if (allowedHelpUrl(url, origin) || url === target) finish(false);
      });
      window.on('closed', () => finish(false));
      void window.loadURL(target).catch(() => finish(false));
    } catch {
      resolve(false);
    }
  });
}
