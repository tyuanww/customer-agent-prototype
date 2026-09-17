import { BrowserWindow, ipcMain, session, type Event } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loopbackOrigin, ProductHttpError } from './product-http';
import { loadRenderer } from './overlay-renderer-loader';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import type { LoginWindow } from './product-session';
import type { LoginWindowCommandResult } from '../shared/login-window';

const FEISHU_AUTHORIZE_HOST = 'accounts.feishu.cn';

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

function isFeishuPage(url: URL): boolean {
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash
    && (url.hostname === FEISHU_AUTHORIZE_HOST || url.hostname === 'open.feishu.cn'
      || url.hostname.endsWith('.feishu.cn'));
}

export function createLoginWindow(
  providerOrigin: string,
  apiOrigin: string,
  devServerUrl?: () => string | undefined,
): LoginWindow {
  const provider = loopbackOrigin(providerOrigin); const api = loopbackOrigin(apiOrigin);
  return {
    open(url, signal) {
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
        let phase: 'chooser' | 'provider' = 'chooser';
        isolated.webRequest.onBeforeRequest((details, callback) => {
          try {
            const allow = phase === 'chooser'
              ? isChooserUrl(details.url, devServerUrl?.())
              : allowedProviderNavigation(details.url, provider, api);
            callback({ cancel: !allow });
          } catch { callback({ cancel: true }); }
        });
        const window = new BrowserWindow({
          width: 520, height: 420, title: '合成身份登录', show: false,
          webPreferences: {
            session: isolated, contextIsolation: true, sandbox: true, nodeIntegration: false,
            preload: join(__dirname, '../preload/login.cjs'),
          },
        });
        let settled = false;
        const finish = (error?: ProductHttpError) => {
          if (settled) return; settled = true; signal.removeEventListener('abort', cancel);
          ipcMain.removeHandler(IPC_CHANNELS.LOGIN_WINDOW_CHOOSE_FEISHU);
          ipcMain.removeHandler(IPC_CHANNELS.LOGIN_WINDOW_SUBMIT_ACCOUNT);
          ipcMain.removeHandler(IPC_CHANNELS.LOGIN_WINDOW_CANCEL);
          if (!window.isDestroyed()) window.destroy();
          if (error) reject(error); else resolve();
        };
        const cancel = () => finish(new ProductHttpError('CANCELLED'));
        signal.addEventListener('abort', cancel, { once: true });
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        const guardNavigation = (e: Event, target: string) => {
          if (phase === 'chooser') {
            if (!isChooserUrl(target, devServerUrl?.())) { e.preventDefault(); finish(new ProductHttpError('FORBIDDEN')); }
            return;
          }
          if (!allowedProviderNavigation(target, provider, api)) { e.preventDefault(); finish(new ProductHttpError('FORBIDDEN')); }
        };
        window.webContents.on('will-navigate', guardNavigation);
        window.webContents.on('will-redirect', guardNavigation);
        window.on('closed', cancel);
        window.webContents.on('did-navigate', (_event, target, responseCode) => {
          if (phase !== 'provider') return;
          try {
            const location = new URL(target);
            if (location.origin === api && location.pathname === '/v1/auth/callback') {
              finish(responseCode >= 200 && responseCode < 300 && location.searchParams.has('code')
                ? undefined : new ProductHttpError('VALIDATION'));
            }
          } catch { finish(new ProductHttpError('VALIDATION')); }
        });
        const senderOk = () => !window.isDestroyed() && window.webContents === window.webContents;
        ipcMain.handle(IPC_CHANNELS.LOGIN_WINDOW_CHOOSE_FEISHU, async (event) => {
          if (event.sender !== window.webContents) return { ok: false, code: 'CANCELLED' } satisfies LoginWindowCommandResult;
          phase = 'provider';
          try {
            await window.loadURL(url);
            return { ok: true } satisfies LoginWindowCommandResult;
          } catch {
            phase = 'chooser';
            await loadChooser(window, 'failed', devServerUrl?.());
            return { ok: false, code: 'FAILED' } satisfies LoginWindowCommandResult;
          }
        });
        ipcMain.handle(IPC_CHANNELS.LOGIN_WINDOW_SUBMIT_ACCOUNT, async (event, payload: unknown) => {
          if (event.sender !== window.webContents || !senderOk()) return { ok: false, code: 'CANCELLED' } satisfies LoginWindowCommandResult;
          const credentials = readCredentials(payload);
          if (!credentials) return { ok: false, code: 'INVALID' } satisfies LoginWindowCommandResult;
          const code = await verifySyntheticPassword(provider, credentials.username, credentials.password);
          if (code === 'invalid') return { ok: false, code: 'INVALID' } satisfies LoginWindowCommandResult;
          if (code === 'unavailable') return { ok: false, code: 'UNAVAILABLE' } satisfies LoginWindowCommandResult;
          const callback = callbackUrl(url, api, code);
          if (!callback) return { ok: false, code: 'UNAVAILABLE' } satisfies LoginWindowCommandResult;
          phase = 'provider';
          try {
            await window.loadURL(callback);
            return { ok: true } satisfies LoginWindowCommandResult;
          } catch {
            phase = 'chooser';
            return { ok: false, code: 'UNAVAILABLE' } satisfies LoginWindowCommandResult;
          }
        });
        ipcMain.handle(IPC_CHANNELS.LOGIN_WINDOW_CANCEL, async (event) => {
          if (event.sender !== window.webContents) return;
          cancel();
        });
        void loadChooser(window, 'entry', devServerUrl?.()).then(() => { if (!settled && !window.isDestroyed()) window.show(); })
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

function allowedProviderNavigation(value: string, provider: string, api: string): boolean {
  try {
    const url = new URL(value);
    return allowedLoginUrl(value, provider, api) || isFeishuPage(url);
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

async function verifySyntheticPassword(origin: string, username: string, password: string): Promise<string | 'invalid' | 'unavailable'> {
  try {
    const response = await fetch(new URL('/password', origin), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5_000),
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
