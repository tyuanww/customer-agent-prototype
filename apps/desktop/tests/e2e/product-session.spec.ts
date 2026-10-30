import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { closeOwnedElectron } from '../support/owned-electron';

const root = fileURLToPath(new URL('../..', import.meta.url));

function savedSessionFile(directory: string): string {
  const files = readdirSync(directory).filter(file => /^product-session\.[a-f0-9]{16}\.enc$/u.test(file));
  expect(files).toHaveLength(1);
  return path.join(directory, files[0]);
}

function listenProductWire(options: { pausePassword?: boolean } = {}) {
  const token = 's'.repeat(43);
  const state = { authorized: false, revoked: false, passwordReceived: false, callbacks: 0 };
  let releasePassword: () => void = () => undefined;
  let apiOrigin = '';
  let identityOrigin = '';
  const handler: RequestListener = (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/v1/auth/login-requests') {
      res.statusCode = 201; res.end(JSON.stringify({ login_id: `login_${'l'.repeat(43)}`, authorize_url: `${identityOrigin}/authorize?state=s`, expires_at: new Date(Date.now() + 300_000).toISOString() }));
    } else if (url.pathname === '/authorize') {
      res.writeHead(302, { location: `${apiOrigin}/v1/auth/callback?state=s&code=c` }); res.end();
    } else if (url.pathname === '/password') {
      let body = ''; req.on('data', (chunk) => { body += String(chunk); }); req.on('end', () => {
        try {
          const parsed: unknown = JSON.parse(body);
          const username = parsed && typeof parsed === 'object' ? Reflect.get(parsed, 'username') : undefined;
          const password = parsed && typeof parsed === 'object' ? Reflect.get(parsed, 'password') : undefined;
          if (username === 'synthetic_agent' && password === 'synthetic-password') {
            state.passwordReceived = true;
            if (options.pausePassword) releasePassword = () => { res.end(JSON.stringify({ code: 'synthetic_agent' })); };
            else res.end(JSON.stringify({ code: 'synthetic_agent' }));
            return;
          }
        } catch { /* invalid JSON is an invalid credential */ }
        res.statusCode = 401; res.end(JSON.stringify({ error: 'invalid_credentials' }));
      });
    } else if (url.pathname === '/v1/auth/callback') {
      state.callbacks += 1;
      state.authorized = true; res.setHeader('content-type', 'text/html'); res.end('<p>合成登录完成</p>');
    } else if (url.pathname.endsWith('/exchange')) {
      res.statusCode = state.authorized ? 200 : 202;
      res.end(JSON.stringify(state.authorized ? { access_token: token, token_type: 'Bearer', expires_at: new Date(Date.now() + 899_000).toISOString() } : { status: 'pending', retry_after_seconds: 2 }));
    } else if (url.pathname === '/v1/auth/me') {
      res.statusCode = req.headers.authorization === `Bearer ${token}` && !state.revoked ? 200 : 401;
      res.end(JSON.stringify({ user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'mock' }));
    } else if (url.pathname === '/v1/auth/logout') { state.revoked = true; res.statusCode = 204; res.end(); }
    else if (url.pathname === '/v1/announce/current') {
      const lease = `osl_${'c'.repeat(64)}`;
      res.setHeader('etag', 'W/"13"');
      res.end(JSON.stringify({
        current_release_id: 'rel-synthetic-001', release_seq: 13, source_binding_hash: 'b'.repeat(64),
        offline_lease: { token: lease, expires_at: new Date(Date.now() + 600_000).toISOString(), release_id: 'rel-synthetic-001', source_binding_hash: 'b'.repeat(64) },
        announcement: { title: '合成公告', summary: '只读核验', created_at: '2026-09-09T00:00:00.000Z' },
      }));
    } else if (url.pathname === '/v1/announce/ack') {
      res.end(JSON.stringify({ ok: true }));
    } else if (url.pathname === '/v1/announce/snapshot') {
      res.end(JSON.stringify({
        release_id: 'rel-synthetic-001', release_seq: 13, source_binding_hash: 'b'.repeat(64),
        offline_lease: { token: `osl_${'c'.repeat(64)}`, expires_at: new Date(Date.now() + 600_000).toISOString(), release_id: 'rel-synthetic-001', source_binding_hash: 'b'.repeat(64) },
        items: [], next_cursor: null,
      }));
    } else { res.statusCode = 404; res.end('{}'); }
  };
  const server = createServer(handler);
  const identity = createServer(handler);
  const listen = (target: typeof server) => new Promise<string>((resolve) => {
    target.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(target.address() as AddressInfo).port}`);
    });
  });
  const close = (target: typeof server) => {
    target.closeAllConnections();
    return new Promise<void>((resolve) => { target.close(() => resolve()); });
  };
  return {
    token,
    state,
    releasePassword: () => releasePassword(),
    listen: async () => {
      [apiOrigin, identityOrigin] = await Promise.all([listen(server), listen(identity)]);
      return { apiOrigin, identityOrigin };
    },
    close: async () => { await Promise.all([close(server), close(identity)]); },
  };
}

async function launchQuery(origins: { apiOrigin: string; identityOrigin: string }) {
  const directory = mkdtempSync(path.join(tmpdir(), 'desktop-product-e2e-'));
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      cwd: root,
      args: [`--user-data-dir=${directory}`, path.join(root, 'out/main/index.js'), '--demo-e2e'],
      env: { ...process.env, DEMO_E2E: '1', CUSTOMER_AGENT_DESKTOP_API_ORIGIN: origins.apiOrigin,
        CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN: origins.identityOrigin },
      timeout: 30_000,
    });
    await expect.poll(() => app!.windows().some((window) => window.url().includes('role=query'))).toBe(true);
    const query = app.windows().find((window) => window.url().includes('role=query'))!;
    await expect.poll(() => app!.windows().some((window) => window.url().includes('role=fox'))).toBe(true);
    const fox = app.windows().find((window) => window.url().includes('role=fox'))!;
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    return { app, query, directory };
  } catch (error) {
    if (app) await closeOwnedElectron(app);
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Native IPC/login-window test. HTTP is a synthetic wire double; PG integration belongs to D5. */
test('product session native Feishu login, logout and renderer isolation', async () => {
  const wire = listenProductWire();
  const origin = await wire.listen();
  let app: ElectronApplication | undefined;
  let directory: string | undefined;
  try {
    const launched = await launchQuery(origin);
    app = launched.app;
    directory = launched.directory;
    const { query } = launched;
    await query.getByRole('button', { name: '登录' }).click();
    await expect.poll(() => app!.windows().some((window) => window.url().includes('role=login'))).toBe(true);
    const login = app.windows().find((window) => window.url().includes('role=login'))!;
    await login.getByRole('button', { name: '飞书登录' }).click();
    expect(login.url()).toMatch(/role=login/);
    await expect(query.getByRole('button', { name: /· 退出$/ })).toBeVisible();
    await expect(query.getByTestId('announce-banner')).toHaveCount(0);
    const view = await query.evaluate(() => window.customerAgent!.product!.sessionStatus());
    expect(JSON.stringify(view)).not.toContain(wire.token);
    const loginWindows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((window) => window.webContents.getURL().includes('/authorize')).length);
    expect(loginWindows).toBe(0);
    const sessionFile = savedSessionFile(directory);
    expect(existsSync(sessionFile)).toBe(true);
    expect(await query.evaluate(() => window.customerAgent!.copyText('绕过候选'))).toMatchObject({ ok: false });
    await query.evaluate(() => window.customerAgent!.product!.logout());
    await expect(query.getByRole('button', { name: '登录' })).toBeVisible();
    expect(wire.state.revoked).toBe(true); expect(existsSync(sessionFile)).toBe(false);
  } finally {
    if (app) await closeOwnedElectron(app);
    await wire.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

test('product session account login exchanges a synthetic password for the same session', async () => {
  const wire = listenProductWire();
  const origin = await wire.listen();
  let app: ElectronApplication | undefined;
  let directory: string | undefined;
  try {
    const launched = await launchQuery(origin);
    app = launched.app;
    directory = launched.directory;
    const { query } = launched;
    await query.getByRole('button', { name: '登录' }).click();
    await expect.poll(() => app!.windows().some((window) => window.url().includes('role=login'))).toBe(true);
    const login = app.windows().find((window) => window.url().includes('role=login'))!;
    await login.getByText('账号', { exact: true }).click();
    await login.getByRole('textbox', { name: '登录名' }).fill('synthetic_agent');
    await login.locator('input[name="password"]').fill('synthetic-password');
    await login.getByRole('button', { name: '登录' }).click();
    await expect(query.getByRole('button', { name: /· 退出$/ })).toBeVisible();
    const view = await query.evaluate(() => window.customerAgent!.product!.sessionStatus());
    expect(JSON.stringify(view)).not.toContain(wire.token);
    expect(existsSync(savedSessionFile(directory))).toBe(true);
    await query.evaluate(() => window.customerAgent!.product!.logout());
    await expect(query.getByRole('button', { name: '登录' })).toBeVisible();
  } finally {
    if (app) await closeOwnedElectron(app);
    await wire.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

test('cancelling account verification prevents a late identity callback', async () => {
  const wire = listenProductWire({ pausePassword: true });
  const origin = await wire.listen();
  let app: ElectronApplication | undefined;
  let directory: string | undefined;
  try {
    const launched = await launchQuery(origin);
    app = launched.app;
    directory = launched.directory;
    await launched.query.getByRole('button', { name: '登录' }).click();
    await expect.poll(() => app!.windows().some((window) => window.url().includes('role=login'))).toBe(true);
    const login = app.windows().find((window) => window.url().includes('role=login'))!;
    await login.getByText('账号', { exact: true }).click();
    await login.getByRole('textbox', { name: '登录名' }).fill('synthetic_agent');
    await login.locator('input[name="password"]').fill('synthetic-password');
    await login.getByRole('button', { name: '登录' }).click();
    await expect.poll(() => wire.state.passwordReceived).toBe(true);
    await login.getByRole('button', { name: '取消' }).click();
    await expect(launched.query.getByRole('button', { name: '登录' })).toBeVisible();
    wire.releasePassword();
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(wire.state.callbacks).toBe(0);
    expect(wire.state.authorized).toBe(false);
  } finally {
    if (app) await closeOwnedElectron(app);
    await wire.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});
