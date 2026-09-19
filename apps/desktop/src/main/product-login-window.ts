import { BrowserWindow, ipcMain, session, shell, type Event } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { productOrigin, ProductHttpError } from './product-http';
import { loadRenderer } from './overlay-renderer-loader';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import type { LoginWindow } from './product-session';
import type { LoginWindowCommandResult } from '../shared/login-window';

const FEISHU_AUTHORIZE_HOST = 'accounts.feishu.cn';
/** Password POST and callback GET go through the named tunnel on product-remote. */
export const LOGIN_IDENTITY_TIMEOUT_MS = 15_000;

export type LoginWindowHost = {
  openExternal(url: string): Promise<void>;
  fetch: typeof fetch;
};

export function allowedLoginUrl(value: string, provider: string, api: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash
      && ((url.origin === provider && url.pathname === '/authorize')
        || (url.origin === api && url.pathname === '/v1/auth/callback')
        || isFeishuAuthorize(url));
  } catch { return false; }
}

export function isFeishuAuthorize(url: URL): boolean {
  return url.protocol === 'https:' && url.hostname === FEISHU_AUTHORIZE_HOST
    && url.pathname === '/open-apis/authen/v1/authorize';
}

/** One allowlisted hop only. Used by DEMO_E2E instead of unrestricted redirect:follow. */
export function followAllowedLoginRedirects(
  providerOrigin: string,
  apiOrigin: string,
  transport: typeof fetch = fetch,
): (url: string) => Promise<void> {
  const provider = productOrigin(providerOrigin);
  const api = productOrigin(apiOrigin);
  return async (url: string) => {
    if (!allowedLoginUrl(url, provider, api)) throw new Error('unavailable');
    const first = await transport(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(5_000) });
    const location = first.headers.get('location');
    await first.body?.cancel().catch(() => undefined);
    if (first.status < 300 || first.status >= 400 || !location) throw new Error('unavailable');
    let next: string;
    try { next = new URL(location, url).href; } catch { throw new Error('unavailable'); }
    if (!allowedLoginUrl(next, provider, api)) throw new Error('unavailable');
    const second = await transport(next, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5_000) });
    if (!second.ok) throw new Error('unavailable');
  };
}

export function createLoginWindow(
  providerOrigin: string,
  apiOrigin: string,
  devServerUrl?: () => string | undefined,
  host: Partial<LoginWindowHost> = {},
): LoginWindow {
  const provider = productOrigin(providerOrigin); const api = productOrigin(apiOrigin);
  const openExternal = host.openExternal ?? ((url: string) => shell.openExternal(url));
  const transport = host.fetch ?? fetch;
  return {
    open(url, operation) {
      const signal = operation.signal;
      if (signal.aborted || !allowedLoginUrl(url, provider, api)) return Promise.reject(new ProductHttpError('VALIDATION'));
      ipcMain.removeHandler(IPC_CHANNELS.LOGIN_WINDOW_CHOOSE_FEISHU);
      ipcMain.removeHandler(IPC_CHANNELS.LOGIN_WINDOW_SUBMIT_ACCOUNT);
      ipcMain.removeHandler(IPC_CHANNELS.LOGIN_WINDOW_CANCEL);
      return new Promise<void>((resolve, reject) => {
        // Isolated cookies/storage. Renderer HTML must not emit `crossorigin`
        // (see stripCrossOriginAttributes) or this partition cannot load file:// modules.
        const isolated = session.fromPartition(`synthetic-login-${randomUUID()}`);
        isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
        isolated.setPermissionCheckHandler(() => false);
        isolated.webRequest.onBeforeRequest((details, callback) => {
          try { callback({ cancel: !isChooserUrl(details.url, devServerUrl?.()) }); }
          catch { callback({ cancel: true }); }
        });
        const window = new BrowserWindow({
          width: 520, height: 420, title: '登录', show: false,
          webPreferences: {
            session: isolated, contextIsolation: true, sandbox: true, nodeIntegration: false,
            preload: join(__dirname, '../preload/login.cjs'),
          },
        });
        let closed = false;
        let handedOff = false;
        const finish = (error?: ProductHttpError) => {
          if (closed) return; closed = true; signal.removeEventListener('abort', cancel);
          ipcMain.removeHandler(IPC_CHANNELS.LOGIN_WINDOW_CHOOSE_FEISHU);
          ipcMain.removeHandler(IPC_CHANNELS.LOGIN_WINDOW_SUBMIT_ACCOUNT);
          ipcMain.removeHandler(IPC_CHANNELS.LOGIN_WINDOW_CANCEL);
          if (!window.isDestroyed()) window.destroy();
          if (error?.code === 'CANCELLED' && !signal.aborted) operation.abort();
          if (handedOff) return;
          handedOff = true;
          if (error) reject(error); else resolve();
        };
        const handoff = () => {
          if (handedOff) return;
          handedOff = true;
          resolve();
        };
        const cancel = () => finish(new ProductHttpError('CANCELLED'));
        signal.addEventListener('abort', cancel, { once: true });
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        const guardNavigation = (e: Event, target: string) => {
          if (!isChooserUrl(target, devServerUrl?.())) { e.preventDefault(); finish(new ProductHttpError('FORBIDDEN')); }
        };
        window.webContents.on('will-navigate', guardNavigation);
        window.webContents.on('will-redirect', guardNavigation);
        window.on('closed', cancel);
        ipcMain.handle(IPC_CHANNELS.LOGIN_WINDOW_CHOOSE_FEISHU, async (event) => {
          if (event.sender !== window.webContents || window.isDestroyed()) return { ok: false, code: 'CANCELLED' } satisfies LoginWindowCommandResult;
          if (!allowedLoginUrl(url, provider, api)) return { ok: false, code: 'VALIDATION' } satisfies LoginWindowCommandResult;
          try {
            await openExternal(url);
            handoff();
            return { ok: true } satisfies LoginWindowCommandResult;
          } catch {
            return { ok: false, code: 'UNAVAILABLE' } satisfies LoginWindowCommandResult;
          }
        });
        ipcMain.handle(IPC_CHANNELS.LOGIN_WINDOW_SUBMIT_ACCOUNT, async (event, payload: unknown) => {
          if (event.sender !== window.webContents || window.isDestroyed()) return { ok: false, code: 'CANCELLED' } satisfies LoginWindowCommandResult;
          const credentials = readCredentials(payload);
          if (!credentials) return { ok: false, code: 'INVALID' } satisfies LoginWindowCommandResult;
          const code = await verifySyntheticPassword(provider, credentials.username, credentials.password, transport);
          if (code === 'invalid') return { ok: false, code: 'INVALID' } satisfies LoginWindowCommandResult;
          if (code === 'unavailable') return { ok: false, code: 'UNAVAILABLE' } satisfies LoginWindowCommandResult;
          const callback = callbackUrl(url, api, code);
          if (!callback || !allowedLoginUrl(callback, provider, api)) return { ok: false, code: 'UNAVAILABLE' } satisfies LoginWindowCommandResult;
          try {
            const response = await transport(callback, {
              method: 'GET', redirect: 'error', signal: AbortSignal.timeout(LOGIN_IDENTITY_TIMEOUT_MS),
            });
            if (!response.ok) return { ok: false, code: 'UNAVAILABLE' } satisfies LoginWindowCommandResult;
            finish();
            return { ok: true } satisfies LoginWindowCommandResult;
          } catch {
            return { ok: false, code: 'UNAVAILABLE' } satisfies LoginWindowCommandResult;
          }
        });
        ipcMain.handle(IPC_CHANNELS.LOGIN_WINDOW_CANCEL, async (event) => {
          if (event.sender !== window.webContents) return;
          cancel();
        });
        void loadChooser(window, 'entry', devServerUrl?.()).then(() => { if (!closed && !window.isDestroyed()) window.show(); })
          .catch(() => finish(new ProductHttpError('UNAVAILABLE')));
      });
    },
  };
}

export function isChooserUrl(value: string, devServerUrl?: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (devServerUrl) {
      const dev = new URL(devServerUrl);
      return (url.protocol === 'http:' || url.protocol === 'https:')
        && url.host === dev.host && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
    }
    if (url.protocol !== 'file:') return false;
    const path = decodeURIComponent(url.pathname).replace(/\\/g, '/');
    if (path.includes('/..') || path.includes('//')) return false;
    return /(?:^|\/)out\/renderer\/(?:index\.html|assets\/(?:[^/]+\/)*[^/]+)$/.test(path)
      || /(?:^|\/)[^/]+\.asar\/(?:out\/)?renderer\/(?:index\.html|assets\/(?:[^/]+\/)*[^/]+)$/.test(path);
  } catch { return false; }
}

function readCredentials(payload: unknown): { username: string; password: string } | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const username = Reflect.get(payload, 'username');
  const password = Reflect.get(payload, 'password');
  if (typeof username !== 'string' || typeof password !== 'string') return undefined;
  if (username.trim() !== username || password.trim() !== password) return undefined;
  if (username.length < 1 || username.length > 128 || password.length < 1 || password.length > 128) return undefined;
  return { username, password };
}

function callbackUrl(authorizeUrl: string, api: string, code: string): string | undefined {
  try {
    const source = new URL(authorizeUrl);
    const state = source.searchParams.get('state') ?? source.searchParams.get('state'.toLowerCase());
    if (!state) return undefined;
    const target = new URL('/v1/auth/callback', api);
    target.searchParams.set('state', state);
    target.searchParams.set('code', code);
    return target.href;
  } catch { return undefined; }
}

async function verifySyntheticPassword(
  origin: string,
  username: string,
  password: string,
  transport: typeof fetch,
): Promise<string | 'invalid' | 'unavailable'> {
  try {
    const response = await transport(new URL('/password', origin), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(LOGIN_IDENTITY_TIMEOUT_MS),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (response.status === 401 || response.status === 400) return 'invalid';
    if (!response.ok) return 'unavailable';
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || typeof Reflect.get(value, 'code') !== 'string') return 'unavailable';
    return Reflect.get(value, 'code') as string;
  } catch {
    return 'unavailable';
  }
}

async function loadChooser(window: BrowserWindow, loginState: 'entry' | 'failed' | 'cancelled', devServerUrl?: string) {
  if (devServerUrl) {
    const target = new URL(devServerUrl);
    target.searchParams.set('role', 'login');
    target.searchParams.set('platform', process.platform);
    if (loginState !== 'entry') target.searchParams.set('loginState', loginState);
    await window.loadURL(target.href);
    return;
  }
  await loadRenderer(window, 'login');
  if (loginState !== 'entry' && !window.isDestroyed()) {
    const current = window.webContents.getURL();
    const next = new URL(current);
    next.searchParams.set('loginState', loginState);
    await window.loadURL(next.href);
  }
}
