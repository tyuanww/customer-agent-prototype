import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

const root = fileURLToPath(new URL('../..', import.meta.url));
/** Native IPC/login-window test. HTTP is a synthetic wire double; PG integration belongs to D5. */
test('product session native login, logout and renderer isolation', async () => {
  const token = 's'.repeat(43); let authorized = false; let revoked = false;
  const server = createServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/v1/auth/login-requests') {
      res.statusCode = 201; res.end(JSON.stringify({ login_id: `login_${'l'.repeat(43)}`, authorize_url: `${url.origin}/authorize?state=s`, expires_at: new Date(Date.now() + 300_000).toISOString() }));
    } else if (url.pathname === '/authorize') {
      res.writeHead(302, { location: `${url.origin}/v1/auth/callback?state=s&code=c` }); res.end();
    } else if (url.pathname === '/v1/auth/callback') {
      authorized = true; res.setHeader('content-type', 'text/html'); res.end('<p>合成登录完成</p>');
    } else if (url.pathname.endsWith('/exchange')) {
      res.statusCode = authorized ? 200 : 202;
      res.end(JSON.stringify(authorized ? { access_token: token, token_type: 'Bearer', expires_at: new Date(Date.now() + 899_000).toISOString() } : { status: 'pending', retry_after_seconds: 2 }));
    } else if (url.pathname === '/v1/auth/me') {
      res.statusCode = req.headers.authorization === `Bearer ${token}` && !revoked ? 200 : 401;
      res.end(JSON.stringify({ user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'mock' }));
    } else if (url.pathname === '/v1/auth/logout') { revoked = true; res.statusCode = 204; res.end(); }
    else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const directory = mkdtempSync(path.join(tmpdir(), 'desktop-product-e2e-')); let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ cwd: root, args: [`--user-data-dir=${directory}`, path.join(root, 'out/main/index.js'), '--demo-e2e'],
      env: { ...process.env, DEMO_E2E: '1', CUSTOMER_AGENT_DESKTOP_API_ORIGIN: origin, CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN: origin }, timeout: 30_000 });
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=query'))).toBe(true);
    const query = app.windows().find(w => w.url().includes('role=query'))!;
    await query.evaluate(() => window.customerAgent!.openSearch());
    await query.getByRole('button', { name: '合成登录' }).click();
    await expect(query.getByRole('button', { name: 'agent · 退出' })).toBeVisible();
    const view = await query.evaluate(() => window.customerAgent!.product!.sessionStatus());
    expect(JSON.stringify(view)).not.toContain(token);
    const loginWindows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().includes('/authorize')).length);
    expect(loginWindows).toBe(0);
    expect(existsSync(path.join(directory, 'product-session.enc'))).toBe(true);
    await query.getByRole('button', { name: 'agent · 退出' }).click();
    await expect(query.getByRole('button', { name: '合成登录' })).toBeVisible();
    expect(revoked).toBe(true); expect(existsSync(path.join(directory, 'product-session.enc'))).toBe(false);
  } finally {
    await app?.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
