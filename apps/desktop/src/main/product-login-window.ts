import { BrowserWindow, session, type Event } from 'electron';
import { randomUUID } from 'node:crypto';
import { loopbackOrigin, ProductHttpError } from './product-http';
import type { LoginWindow } from './product-session';

export function allowedLoginUrl(value: string, provider: string, api: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash &&
      ((url.origin === provider && url.pathname === '/authorize')
      || (url.origin === api && url.pathname === '/v1/auth/callback'));
  } catch { return false; }
}
export function createLoginWindow(providerOrigin: string, apiOrigin: string): LoginWindow {
  const provider = loopbackOrigin(providerOrigin); const api = loopbackOrigin(apiOrigin);
  return {
    open(url, signal) {
      if (signal.aborted || !allowedLoginUrl(url, provider, api)) return Promise.reject(new ProductHttpError('VALIDATION'));
      return new Promise<void>((resolve, reject) => {
        // Non-persistent isolated partition. Query/Dashboard never share login navigation privileges.
        const isolated = session.fromPartition(`synthetic-login-${randomUUID()}`);
        isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
        isolated.setPermissionCheckHandler(() => false);
        isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowedLoginUrl(details.url, provider, api) }));
        const window = new BrowserWindow({ width: 520, height: 420, title: '合成身份登录', show: false,
          webPreferences: { session: isolated, contextIsolation: true, sandbox: true, nodeIntegration: false } });
        let settled = false;
        const finish = (error?: ProductHttpError) => {
          if (settled) return; settled = true; clearTimeout(deadline); signal.removeEventListener('abort', cancel);
          if (!window.isDestroyed()) window.destroy();
          if (error) reject(error); else resolve();
        };
        const cancel = () => finish(new ProductHttpError('CANCELLED'));
        const deadline = setTimeout(() => finish(new ProductHttpError('UNAVAILABLE')), 5_000);
        signal.addEventListener('abort', cancel, { once: true });
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        const guardNavigation = (e: Event, target: string) => {
          if (!allowedLoginUrl(target, provider, api)) { e.preventDefault(); finish(new ProductHttpError('FORBIDDEN')); }
        };
        window.webContents.on('will-navigate', guardNavigation);
        window.webContents.on('will-redirect', guardNavigation);
        window.on('closed', cancel);
        window.webContents.on('did-navigate', (_event, target, responseCode) => {
          const location = new URL(target);
          if (location.origin === api && location.pathname === '/v1/auth/callback') {
            finish(responseCode >= 200 && responseCode < 300 && location.searchParams.has('code')
              ? undefined : new ProductHttpError('VALIDATION'));
          }
        });
        void window.loadURL(url).then(() => { if (!settled) window.show(); })
          .catch(() => finish(new ProductHttpError('UNAVAILABLE')));
      });
    },
  };
}
