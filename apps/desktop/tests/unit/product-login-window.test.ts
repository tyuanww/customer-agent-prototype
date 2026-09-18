import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (event: { sender: unknown }, payload?: unknown) => Promise<unknown>>();
  const loadURL = vi.fn(async () => undefined);
  const webContents = {
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
    getURL: vi.fn(() => 'http://127.0.0.1:5173/?role=login'),
    loadURL,
  };
  const windowInstance = {
    loadURL,
    show: vi.fn(),
    destroy: vi.fn(),
    isDestroyed: vi.fn(() => false),
    webContents,
    on: vi.fn(),
  };
  return {
    handlers,
    loadURL,
    webContents,
    windowInstance,
    BrowserWindow: vi.fn(function MockBrowserWindow() {
      return windowInstance;
    }),
    ipcMain: {
      removeHandler: vi.fn((channel: string) => { handlers.delete(channel); }),
      handle: vi.fn((channel: string, fn: (event: { sender: unknown }, payload?: unknown) => Promise<unknown>) => {
        handlers.set(channel, fn);
      }),
    },
    session: {
      fromPartition: vi.fn(() => ({
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
        webRequest: { onBeforeRequest: vi.fn() },
      })),
    },
    shell: { openExternal: vi.fn(async () => undefined) },
  };
});

vi.mock('electron', () => ({
  BrowserWindow: mocks.BrowserWindow,
  ipcMain: mocks.ipcMain,
  session: mocks.session,
  shell: mocks.shell,
}));

vi.mock('../../src/main/overlay-renderer-loader', () => ({ loadRenderer: vi.fn() }));

import { allowedLoginUrl, createLoginWindow, followAllowedLoginRedirects, isChooserUrl } from '../../src/main/product-login-window';

const source = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/main/product-login-window.ts'),
  'utf8',
);

beforeEach(() => {
  mocks.handlers.clear();
  mocks.loadURL.mockClear();
  mocks.BrowserWindow.mockClear();
  mocks.windowInstance.destroy.mockClear();
  mocks.windowInstance.isDestroyed.mockReturnValue(false);
  mocks.shell.openExternal.mockClear();
});

it('allows only configured authorization and callback routes, not arbitrary loopback targets', () => {
  const check = (url: string) => allowedLoginUrl(url, 'http://127.0.0.1:4201', 'http://127.0.0.1:4200');
  expect(check('http://127.0.0.1:4201/authorize?state=s')).toBe(true);
  expect(check('http://127.0.0.1:4200/v1/auth/callback?state=s&code=c')).toBe(true);
  expect(check('https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id=cli_aaaaaaaaaaaaaaaa')).toBe(true);
  const credentialUrl = new URL('http://127.0.0.1:4201/authorize');
  credentialUrl.username = 'synthetic'; credentialUrl.password = 'invalid';
  expect(check(credentialUrl.href)).toBe(false);
  for (const url of ['https://example.com', 'http://127.0.0.1:9999/authorize', 'http://127.0.0.1:4200/v1/auth/me', 'file:///tmp/token', 'https://accounts.feishu.cn/open-apis/authen/v1/index']) expect(check(url)).toBe(false);
});

it('allows packaged renderer html and hashed assets, not parent-relative files', () => {
  expect(isChooserUrl('file:///Users/app/out/renderer/index.html')).toBe(true);
  expect(isChooserUrl('file:///Users/app/out/renderer/assets/index-Bvsq1Vx8.js')).toBe(true);
  expect(isChooserUrl('file:///Users/app/out/renderer/assets/LoginApp-BzcsWSWI.js')).toBe(true);
  expect(isChooserUrl('file:///Users/app/out/renderer/assets/fox-head-DuCgrBSA.png')).toBe(true);
  expect(isChooserUrl('file:///Users/app/out/renderer/assets/js/index-Bvsq1Vx8.js')).toBe(true);
  expect(isChooserUrl('file:///tmp/app.asar/out/renderer/index.html')).toBe(true);
  expect(isChooserUrl('file:///tmp/app.asar/out/renderer/assets/index.js')).toBe(true);
  expect(isChooserUrl('file:///tmp/app.asar/renderer/index.html')).toBe(true);
  expect(isChooserUrl('file:///tmp/app.asar/renderer/assets/js/index.js')).toBe(true);
  expect(isChooserUrl('file:///Users/app/out/renderer/assets/%2e%2e%2fsecret.js')).toBe(false);
  expect(isChooserUrl('file:///tmp/token')).toBe(false);
  expect(isChooserUrl('file:///Users/app/out/main/index.js')).toBe(false);
  expect(isChooserUrl('http://127.0.0.1:5173/index.html')).toBe(false);
  expect(isChooserUrl('http://127.0.0.1:5173/index.html', 'http://127.0.0.1:5173')).toBe(true);
});

it('does not keep an in-window identity-provider navigation phase', () => {
  expect(source).not.toContain('isFeishuPage');
  expect(source).not.toContain("phase = 'provider'");
  expect(source).not.toContain('allowedProviderNavigation');
});

describe('createLoginWindow', () => {
  const authorize = 'http://127.0.0.1:4201/authorize?state=s';
  const event = { sender: mocks.webContents };

  function openWindow(host?: Parameters<typeof createLoginWindow>[3]) {
    const login = createLoginWindow(
      'http://127.0.0.1:4201',
      'http://127.0.0.1:4200',
      () => 'http://127.0.0.1:5173',
      host,
    );
    const operation = new AbortController();
    const opened = login.open(authorize, operation);
    return {
      operation,
      opened,
      choose: () => mocks.handlers.get('login-window:choose-feishu')!(event),
      submit: (payload: unknown) => mocks.handlers.get('login-window:submit-account')!(event, payload),
      cancel: () => mocks.handlers.get('login-window:cancel')!(event),
    };
  }

  it('rejects illegal authorize URLs before creating a window or opening a browser', async () => {
    const openExternal = vi.fn(async () => undefined);
    const login = createLoginWindow('http://127.0.0.1:4201', 'http://127.0.0.1:4200', () => 'http://127.0.0.1:5173', { openExternal });
    await expect(login.open('https://example.com/authorize', new AbortController())).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(openExternal).not.toHaveBeenCalled();
    expect(mocks.BrowserWindow).not.toHaveBeenCalled();
  });

  it('opens Feishu in the system browser and never loads the provider in the chooser window', async () => {
    const openExternal = vi.fn(async () => undefined);
    const { opened, choose } = openWindow({ openExternal });
    expect(await choose()).toEqual({ ok: true });
    expect(openExternal).toHaveBeenCalledWith(authorize);
    expect(JSON.stringify(mocks.loadURL.mock.calls)).not.toContain('/authorize');
    expect(JSON.stringify(mocks.loadURL.mock.calls)).not.toContain('/v1/auth/callback');
    await opened;
    expect(mocks.windowInstance.destroy).not.toHaveBeenCalled();
  });

  it('does not call openExternal when the injected opener is skipped by a failed allowlist re-check', async () => {
    const openExternal = vi.fn(async () => undefined);
    const login = createLoginWindow('http://127.0.0.1:4201', 'http://127.0.0.1:4200', () => 'http://127.0.0.1:5173', { openExternal });
    await expect(login.open('http://127.0.0.1:4200/v1/auth/me', new AbortController())).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('returns UNAVAILABLE when the system browser cannot open, without loading a provider URL', async () => {
    const openExternal = vi.fn(async () => { throw new Error('blocked'); });
    const { choose } = openWindow({ openExternal });
    expect(await choose()).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(JSON.stringify(mocks.loadURL.mock.calls)).not.toContain('/authorize');
  });

  it('submits the account form in-process and GETs the callback instead of navigating the chooser', async () => {
    const openExternal = vi.fn(async () => undefined);
    const transport = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const target = String(input);
      if (init?.method === 'POST' && target.endsWith('/password')) return Response.json({ code: 'synthetic_agent' });
      if (target.includes('/v1/auth/callback')) return new Response('ok', { status: 200 });
      return new Response('missing', { status: 404 });
    }) as unknown as typeof fetch;
    const { opened, submit } = openWindow({ openExternal, fetch: transport });
    expect(await submit({ username: 'synthetic_agent', password: 'synthetic-password' })).toEqual({ ok: true });
    expect(openExternal).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ method: 'POST' }));
    expect(transport).toHaveBeenCalledWith(
      'http://127.0.0.1:4200/v1/auth/callback?state=s&code=synthetic_agent',
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
    expect(JSON.stringify(mocks.loadURL.mock.calls)).not.toContain('/v1/auth/callback');
    await opened;
  });

  it('aborts the login operation when cancelled after the browser opens', async () => {
    const openExternal = vi.fn(async () => undefined);
    const { operation, opened, choose, cancel } = openWindow({ openExternal });
    expect(await choose()).toEqual({ ok: true });
    await opened;
    expect(operation.signal.aborted).toBe(false);
    await cancel();
    expect(operation.signal.aborted).toBe(true);
  });
});

describe('followAllowedLoginRedirects', () => {
  const authorize = 'http://127.0.0.1:4201/authorize?state=s';
  const callback = 'http://127.0.0.1:4200/v1/auth/callback?state=s&code=c';

  it('follows one allowlisted redirect and refuses any other Location', async () => {
    const transport = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const target = String(input);
      if (target === authorize && init?.redirect === 'manual') {
        return new Response(null, { status: 302, headers: { location: callback } });
      }
      if (target === callback) return new Response('ok', { status: 200 });
      return new Response('blocked', { status: 500 });
    }) as unknown as typeof fetch;
    await followAllowedLoginRedirects('http://127.0.0.1:4201', 'http://127.0.0.1:4200', transport)(authorize);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport).toHaveBeenNthCalledWith(1, authorize, expect.objectContaining({ redirect: 'manual' }));
    expect(transport).toHaveBeenNthCalledWith(2, callback, expect.objectContaining({ redirect: 'error' }));

    const evil = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://example.com/steal' } })) as unknown as typeof fetch;
    await expect(followAllowedLoginRedirects('http://127.0.0.1:4201', 'http://127.0.0.1:4200', evil)(authorize))
      .rejects.toThrow('unavailable');
    expect(evil).toHaveBeenCalledTimes(1);
  });
});
