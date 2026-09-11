import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

const root = fileURLToPath(new URL('../..', import.meta.url));
/** Native IPC/login-window test. HTTP is a synthetic wire double; PG integration belongs to D5. */
test('product session native login, search, copy, logout and renderer isolation', async ({ browserName }, testInfo) => {
  const token = 's'.repeat(43); let authorized = false; let revoked = false; let adopted = false;
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
    }
    else if (url.pathname === '/v1/search') {
      let body = ''; req.on('data', chunk => { body += String(chunk); }); req.on('end', () => {
        const request = JSON.parse(body);
        res.end(JSON.stringify({ query_id: request.query_id, hit_status: 'hit', release_id: 'rel-synthetic-001', source_binding_hash: 'b'.repeat(64), telemetry_status: 'recorded', candidates: [{
          rank: 1, release_id: 'rel-synthetic-001', script_id: 'script-synthetic-001', script_version: 1, content_hash: 'a'.repeat(64), title: '合成发货', category: 'presale', answer_text: '这是合成订单 {订单号}。', platform_scope: ['qianniu'], product_scope_type: 'storewide', product_scope_refs: [], effective_from: '2026-01-01T00:00:00Z', effective_to: null, intent_taxonomy_version: 'itax_synthetic_v1', intent_id: 'intent_synthetic_shipping', risk_level: 'low', risk_categories: [], has_conflict: false, placeholder_keys: ['order_id'],
        }] }));
      });
    } else if (url.pathname === '/v1/events/adoption') {
      let body = ''; req.on('data', chunk => { body += String(chunk); }); req.on('end', () => { adopted = true; res.end(JSON.stringify({ ok: true, query_id: JSON.parse(body).query_id })); });
    } else { res.statusCode = 404; res.end('{}'); }
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
    await expect(query.getByTestId('announce-banner')).toContainText('ACK 不是已读');
    const view = await query.evaluate(() => window.customerAgent!.product!.sessionStatus());
    expect(JSON.stringify(view)).not.toContain(token);
    const loginWindows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().includes('/authorize')).length);
    expect(loginWindows).toBe(0);
    expect(existsSync(path.join(directory, 'product-session.enc'))).toBe(true);
    await query.getByTestId('question-input').fill('合成发货问题');
    await query.getByTestId('search-button').click();
    await query.getByLabel('查询平台').selectOption('qianniu');
    await query.getByTestId('search-button').click();
    await expect(query.getByTestId('answer-text-1')).toHaveText('这是合成订单 {订单号}。');
    await query.getByLabel('订单号').fill('SYNTHETIC-A');
    await query.getByTestId('question-input').fill('第二个合成订单发货问题');
    await query.getByTestId('search-button').click();
    await expect(query.getByLabel('订单号')).toHaveValue('');
    await query.getByLabel('订单号').fill('SYNTHETIC-B');
    await expect(query.getByTestId('copy-button-1')).toBeVisible();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-layout-ready', 'true');
    await query.screenshot({ path: testInfo.outputPath(`product-query-${browserName}.png`) });
    expect(await query.evaluate(() => window.customerAgent!.copyText('绕过候选'))).toMatchObject({ ok: false });
    await query.getByTestId('copy-button-1').click();
    await expect.poll(() => adopted).toBe(true);
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('这是合成订单 SYNTHETIC-B。');
    await query.evaluate(() => window.customerAgent!.product!.logout());
    await expect(query.getByRole('button', { name: '合成登录' })).toBeVisible();
    expect(revoked).toBe(true); expect(existsSync(path.join(directory, 'product-session.enc'))).toBe(false);
  } finally {
    await app?.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
