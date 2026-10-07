import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';
import { intakeQueryData } from '../fixtures/intake-query-data';

/** Actual Electron / preload / Main / HTTP / clipboard. The loopback service is
 * a contract wire double; actual PostgreSQL publication has separate evidence. */
test('FAQ Query logs in, selects shops, searches, copies, expires, recovers and isolates other windows', async () => {
  const wire = intakeQueryData(), token = 's'.repeat(43), requests: string[] = [];
  let authorized = false, apiOrigin = '', identityOrigin = '';
  const api = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://synthetic.invalid'); requests.push(url.pathname);
    res.setHeader('Content-Type', 'application/json');
    const send = (value: unknown, status = 200) => { res.statusCode = status; res.end(JSON.stringify(value)); };
    if (url.pathname === '/v1/auth/login-requests') return send({ login_id: `login_${'l'.repeat(43)}`, authorize_url: `${identityOrigin}/authorize?state=synthetic`, expires_at: new Date(Date.now() + 300_000).toISOString() }, 201);
    if (url.pathname === '/v1/auth/callback') { authorized = true; return send({ ok: true }); }
    if (url.pathname.endsWith('/exchange')) return send(authorized ? { access_token: token, token_type: 'Bearer', expires_at: new Date(Date.now() + 899_000).toISOString() } : { status: 'pending', retry_after_seconds: 1 }, authorized ? 200 : 202);
    if (!authorized || req.headers.authorization !== `Bearer ${token}`) return send({ error: { code: 'UNAUTHORIZED' } }, 401);
    if (url.pathname === '/v1/auth/me') return send({ user_id: 'usr_synthetic_agent', role: 'agent', auth_mode: 'mock' });
    if (url.pathname === '/v1/auth/logout') { authorized = false; res.statusCode = 204; res.end(); return; }
    if (url.pathname === '/v1/notices/current') return send({ error: { code: 'GONE' } }, 410);
    if (url.pathname.startsWith('/v1/intake/')) {
      let text = ''; for await (const chunk of req) text += String(chunk);
      try { return send(wire.respond(req.url!, text ? JSON.parse(text) : undefined)); }
      catch { return send({ error: { code: 'FORBIDDEN', details: { reason: 'PERMISSION_CHANGED' } } }, 403); }
    }
    return send({}, 404);
  });
  const identity = createServer((req, res) => {
    if (req.url?.startsWith('/authorize')) { res.writeHead(302, { location: `${apiOrigin}/v1/auth/callback?state=synthetic&code=synthetic` }); res.end(); }
    else { res.statusCode = 404; res.end(); }
  });
  const listen = (server: typeof api) => new Promise<string>(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  apiOrigin = await listen(api); identityOrigin = await listen(identity);
  const directory = mkdtempSync(path.join(tmpdir(), 'intake-query-native-'));
  let app: ElectronApplication | undefined;
  try {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    app = await electron.launch({ cwd: root, args: [`--user-data-dir=${directory}`, 'out/main/index.js', '--demo-e2e'], env: {
      ...process.env, DEMO_E2E: '1', CUSTOMER_AGENT_DESKTOP_API_ORIGIN: apiOrigin,
      CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN: identityOrigin, CUSTOMER_AGENT_DESKTOP_CONTENT_INTAKE: 'faq-v2',
    } });
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=query'))).toBe(true);
    const query = app.windows().find(w => w.url().includes('role=query'))!;
    await query.waitForFunction(() => Boolean(window.customerAgent?.intakeQuery));
    await query.evaluate(() => window.customerAgent!.openSearch());
    await query.getByRole('button', { name: '登录', exact: true }).click();
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=login'))).toBe(true);
    await app.windows().find(w => w.url().includes('role=login'))!.getByRole('button', { name: '飞书登录' }).click();
    const shop = query.getByRole('combobox', { name: '当前店铺' });
    await expect.poll(async () => {
      const status = await query.evaluate(() => window.customerAgent!.product!.sessionStatus());
      return { signedIn: status.ok && status.signedIn, options: await shop.locator('option').count(), error: await query.locator('[role=alert]').allTextContents(), requests: [...requests] };
    }).toEqual({ signedIn: true, options: 3, error: [], requests: expect.any(Array) });
    await shop.selectOption('shop-a');
    await expect(shop).toHaveValue('shop-a');
    await query.getByTestId('question-input').fill('洁面');
    await query.getByTestId('search-button').click();
    await expect(query.getByTestId('answer-text-1')).toHaveText(`shop-a ${wire.entries[0].answerText}`);
    await expect(query.getByTestId('answer-text-1')).toHaveCSS('white-space', 'pre-wrap');
    await expect(query.getByTestId('deep-thinking-toggle')).toHaveCount(0);
    await expect(query.getByTestId('report-inaccuracy-button-1')).toHaveCount(0);
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(w => w.webContents.getURL().includes('role=query'))!.getBounds().height)).toBeGreaterThan(150);
    if (process.env.INTAKE_QUERY_SCREENSHOT) await query.screenshot({ path: process.env.INTAKE_QUERY_SCREENSHOT });
    await query.getByTestId('copy-button-1').click();
    await expect(query.getByTestId('toast')).toContainText('已复制');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(`shop-a ${wire.entries[0].answerText}`);
    // Stop the success-dismiss timer by changing the query, then switch shops.
    await query.getByTestId('question-input').fill('如何洁面');
    await shop.selectOption('shop-b'); await expect(shop).toHaveValue('shop-b');
    wire.state.ttl = 2000;
    await query.getByTestId('search-button').click();
    await expect(query.getByTestId('answer-text-1')).toContainText('shop-b');
    await expect(query.getByTestId('answer-text-1')).toHaveCount(0, { timeout: 6000 });
    await expect(query.getByTestId('error-state')).toContainText('资格已失效');
    wire.state.ttl = 60_000; wire.state.revoked = true;
    await query.getByTestId('search-button').click();
    await expect(query.getByTestId('error-state')).toBeVisible();
    wire.state.revoked = false;
    await query.getByTestId('search-button').click();
    await expect(query.getByTestId('answer-text-1')).toContainText('shop-b');
    await query.getByTestId('question-input').fill('zzzz'); await query.getByTestId('search-button').click();
    await expect(query.getByTestId('no-hit')).toBeVisible();
    const fox = app.windows().find(w => w.url().includes('role=fox'))!;
    expect(await fox.evaluate(() => window.customerAgent!.intakeQuery!.access())).toMatchObject({ code: 'FORBIDDEN' });
    expect(await query.evaluate(() => window.customerAgent!.intakeQuery!.selectShop({ shopId: 'other-shop' }))).toMatchObject({ code: 'FORBIDDEN' });
    expect(await query.evaluate(() => window.customerAgent!.copyText('forged'))).toMatchObject({ ok: false });
    expect(await query.evaluate(() => window.customerAgent!.openDashboard())).toMatchObject({ ok: true });
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=dashboard'))).toBe(true);
    const dashboard = app.windows().find(w => w.url().includes('role=dashboard'))!;
    await expect(dashboard.getByText('当前没有可用的资料管理权限，请确认登录身份与店铺授权。')).toBeVisible();
    await expect(dashboard.getByRole('button', { name: '冻结本次抽样' })).toHaveCount(0);
    const nativeMenu = await app.evaluate(({ app: nativeApp, Menu, BrowserWindow }) => {
      nativeApp.emit('activate');
      return { labels: Menu.getApplicationMenu()?.getMenuItemById('customer-agent-menu')?.submenu?.items.map(i => i.label),
        dashboardCount: BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().includes('role=dashboard')).length };
    });
    expect(nativeMenu.labels).toContain('打开运营工作台'); expect(nativeMenu.dashboardCount).toBe(1);

    expect(await query.evaluate(() => ({ node: typeof window.require, process: typeof window.process }))).toEqual({ node: 'undefined', process: 'undefined' });
    expect(requests.some(p => p.startsWith('/v1/announce') || p === '/v1/search')).toBe(false);
    await query.evaluate(() => window.customerAgent!.product!.logout());
    await expect(shop).toBeDisabled();
  } finally {
    await app?.close(); api.closeAllConnections(); identity.closeAllConnections();
    await Promise.all([new Promise<void>(r => api.close(() => r())), new Promise<void>(r => identity.close(() => r()))]);
    rmSync(directory, { recursive: true, force: true });
  }
});
