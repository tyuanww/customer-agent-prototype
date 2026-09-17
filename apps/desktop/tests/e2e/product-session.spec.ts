import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

const root = fileURLToPath(new URL('../..', import.meta.url));

function listenProductWire() {
  const token = 's'.repeat(43);
  const state = { authorized: false, revoked: false };
  const server = createServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/v1/auth/login-requests') {
      res.statusCode = 201; res.end(JSON.stringify({ login_id: `login_${'l'.repeat(43)}`, authorize_url: `${url.origin}/authorize?state=s`, expires_at: new Date(Date.now() + 300_000).toISOString() }));
    } else if (url.pathname === '/authorize') {
      res.writeHead(302, { location: `${url.origin}/v1/auth/callback?state=s&code=c` }); res.end();
    } else if (url.pathname === '/password') {
      let body = ''; req.on('data', (chunk) => { body += String(chunk); }); req.on('end', () => {
        try {
          const parsed: unknown = JSON.parse(body);
          const username = parsed && typeof parsed === 'object' ? Reflect.get(parsed, 'username') : undefined;
          const password = parsed && typeof parsed === 'object' ? Reflect.get(parsed, 'password') : undefined;
          if (username === 'synthetic_agent' && password === 'synthetic-password') {
            res.end(JSON.stringify({ code: 'synthetic_agent' }));
            return;
          }
        } catch { /* invalid JSON is an invalid credential */ }
        res.statusCode = 401; res.end(JSON.stringify({ error: 'invalid_credentials' }));
      });
    } else if (url.pathname === '/v1/auth/callback') {
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
  });
  return {
    token,
    state,
    listen: () => new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      });
    }),
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => { server.close(() => resolve()); });
    },
  };
}

async function launchQuery(origin: string) {
  const directory = mkdtempSync(path.join(tmpdir(), 'desktop-product-e2e-'));
  const app = await electron.launch({
    cwd: root,
    args: [`--user-data-dir=${directory}`, path.join(root, 'out/main/index.js'), '--demo-e2e'],
    env: { ...process.env, DEMO_E2E: '1', CUSTOMER_AGENT_DESKTOP_API_ORIGIN: origin, CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN: origin },
    timeout: 30_000,
  });
  await expect.poll(() => app.windows().some((window) => window.url().includes('role=query'))).toBe(true);
  const query = app.windows().find((window) => window.url().includes('role=query'))!;
  await query.evaluate(() => window.customerAgent!.openSearch());
  return { app, query, directory };
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
    await expect(query.getByRole('button', { name: 'agent · 退出' })).toBeVisible();
    await expect(query.getByTestId('announce-banner')).toContainText('ACK 不是已读');
    const view = await query.evaluate(() => window.customerAgent!.product!.sessionStatus());
    expect(JSON.stringify(view)).not.toContain(wire.token);
    const loginWindows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((window) => window.webContents.getURL().includes('/authorize')).length);
    expect(loginWindows).toBe(0);
    expect(existsSync(path.join(directory, 'product-session.enc'))).toBe(true);
    expect(await query.evaluate(() => window.customerAgent!.copyText('绕过候选'))).toMatchObject({ ok: false });
    await query.evaluate(() => window.customerAgent!.product!.logout());
    await expect(query.getByRole('button', { name: '登录' })).toBeVisible();
    expect(wire.state.revoked).toBe(true); expect(existsSync(path.join(directory, 'product-session.enc'))).toBe(false);
  } finally {
    await app?.close();
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
    await login.getByRole('button', { name: '账号' }).click();
    await login.getByRole('textbox', { name: '账号' }).fill('synthetic_agent');
    await login.locator('input[name="password"]').fill('synthetic-password');
    await login.getByRole('button', { name: '登录' }).click();
    await expect(query.getByRole('button', { name: 'agent · 退出' })).toBeVisible();
    const view = await query.evaluate(() => window.customerAgent!.product!.sessionStatus());
    expect(JSON.stringify(view)).not.toContain(wire.token);
    expect(existsSync(path.join(directory, 'product-session.enc'))).toBe(true);
    await query.evaluate(() => window.customerAgent!.product!.logout());
    await expect(query.getByRole('button', { name: '登录' })).toBeVisible();
  } finally {
    await app?.close();
    await wire.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});
