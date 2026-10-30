import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';
import { intakeManagementData } from '../fixtures/intake-management-data';
import { closeOwnedElectron } from '../support/owned-electron';

/** Actual Electron / preload / Main. The loopback service only completes login.
 * The content page stores persona knowledge on this machine. */
test('knowledge desk uploads through the sandbox preload and keeps the row on disk', async () => {
  const wire = intakeManagementData(), token = 's'.repeat(43), requests: string[] = [];
  let authorized = false, apiOrigin = '', identityOrigin = '', dropFreeze = true;
  const api = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://synthetic.invalid'); requests.push(url.pathname);
    res.setHeader('Content-Type', 'application/json');
    const send = (value: unknown, status = 200) => { res.statusCode = status; res.end(JSON.stringify(value)); };
    if (url.pathname === '/v1/auth/login-requests') return send({ login_id: `login_${'l'.repeat(43)}`, authorize_url: `${identityOrigin}/authorize?state=synthetic`, expires_at: new Date(Date.now() + 300_000).toISOString() }, 201);
    if (url.pathname === '/v1/auth/callback') { authorized = true; return send({ ok: true }); }
    if (url.pathname.endsWith('/exchange')) return send(authorized ? { access_token: token, token_type: 'Bearer', expires_at: new Date(Date.now() + 899_000).toISOString() } : { status: 'pending', retry_after_seconds: 1 }, authorized ? 200 : 202);
    if (!authorized || req.headers.authorization !== `Bearer ${token}`) return send({ error: { code: 'UNAUTHORIZED' } }, 401);
    if (url.pathname === '/v1/auth/me') return send({ user_id: 'usr_synthetic_owner', role: 'owner', auth_mode: 'mock' });
    if (url.pathname === '/v1/auth/logout') { authorized = false; res.statusCode = 204; res.end(); return; }
    if (url.pathname === '/v1/notices/current') return send({ error: { code: 'GONE' } }, 410);
    if (url.pathname.startsWith('/v1/intake/')) {
      let text = ''; for await (const chunk of req) text += String(chunk);
      try { const value = wire.respond(req.url!, text ? JSON.parse(text) : undefined);
        if (dropFreeze && url.pathname.endsWith('/quality/freeze')) { dropFreeze = false; req.socket.destroy(); return; }
        return send(value); }
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
    await app.evaluate(({ app }) => app.focus({ steal: true }));
    await query.evaluate(() => window.customerAgent!.openSearch());
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.getByRole('button', { name: '登录', exact: true }).click();
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=login'))).toBe(true);
    await app.windows().find(w => w.url().includes('role=login'))!.getByRole('button', { name: '飞书登录' }).click();
    await expect.poll(async () => query.evaluate(async () => { const s = await window.customerAgent!.product!.sessionStatus(); return s.ok && s.signedIn; })).toBe(true);
    expect(await query.evaluate(() => window.customerAgent!.openDashboard())).toMatchObject({ ok: true });
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=dashboard'))).toBe(true);
    const dashboard = app.windows().find(w => w.url().includes('role=dashboard'))!;
    await expect(dashboard.getByRole('heading', { name: '本机草稿' })).toBeVisible();
    await dashboard.getByRole('tab', { name: '售前客服' }).click();
    await expect(dashboard.getByRole('tab', { name: '售前客服' })).toHaveAttribute('aria-selected', 'true');
    await dashboard.getByRole('button', { name: '添加话术' }).click();
    await dashboard.getByRole('textbox', { name: '问题' }).fill('退货时效');
    await dashboard.getByRole('combobox', { name: '分类' }).selectOption('aftersale');
    await dashboard.getByRole('textbox', { name: '答案' }).fill('七天内可退');
    await dashboard.getByRole('button', { name: '保存' }).click();
    await expect(dashboard.getByRole('cell', { name: /退货时效/ })).toBeVisible();
    await expect(dashboard.getByText('坐席会收到 1 条。全店生效的知识会一起送到这个人设。')).toBeVisible();
    const saved = JSON.parse(readFileSync(path.join(directory, 'desk-knowledge.json'), 'utf8')) as { revision: number; items: { name: string; personaId: string }[] };
    expect(saved.revision).toBe(1);
    expect(saved.items.map((item) => item.name)).toEqual(['退货时效']);
    expect(saved.items[0]?.personaId).toBe('presale');
    expect(requests.filter(p => p.endsWith('/publish') || p.endsWith('/quality/freeze'))).toHaveLength(0);
    expect(await dashboard.evaluate(() => ({ node: typeof (window as unknown as { require?: unknown }).require, overlay: !!window.customerAgent }))).toEqual({ node: 'undefined', overlay: false });
    expect(await query.evaluate(() => typeof window.dashboardIntake)).toBe('undefined');
    const security = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('role=dashboard'))!;
      const p = (win.webContents as unknown as { getLastWebPreferences(): { sandbox: boolean; nodeIntegration: boolean; contextIsolation: boolean } }).getLastWebPreferences(); return { sandbox: p.sandbox, nodeIntegration: p.nodeIntegration, contextIsolation: p.contextIsolation };
    });
    expect(security).toEqual({ sandbox: true, nodeIntegration: false, contextIsolation: true });
  } finally {
    try { if (app) await closeOwnedElectron(app); }
    finally {
      api.closeAllConnections(); identity.closeAllConnections();
      await Promise.all([new Promise<void>(r => api.close(() => r())), new Promise<void>(r => identity.close(() => r()))]);
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
