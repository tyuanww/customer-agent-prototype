import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';

async function closeOwnedElectron(app: ElectronApplication) {
  const process = app.process();
  // Playwright calls app.quit(), which may open the native unsaved-work dialog
  // after an assertion fails. Only this test's own process is terminated.
  const force = setTimeout(() => { process.kill('SIGKILL'); }, 5000);
  try {
    await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
    await app.close();
  } catch (error) {
    if (process.exitCode === null && process.signalCode === null) throw error;
  } finally { clearTimeout(force); }
}

/** Real Electron + production preload/Main + HTTP modules + isolated PG15.
 * Identity and approval are explicit synthetic transports. This does not claim
 * real Feishu, manual OS focus, Stage Manager or Windows compositor evidence. */
test('ordinary seat consumes the same FAQ release approved and published in Dashboard through real API/PG', async () => {
  test.skip(process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E !== '1', 'Explicit PG15/Electron synthetic gate');
  test.setTimeout(120_000);
  // Keep ungated test discovery independent of built API artifacts and PG.
  const { createIntakeSyntheticHost, INTAKE_SYNTHETIC_FAQ } = await import('../../../api/tests/support/intake-synthetic-host.ts');
  const host = await createIntakeSyntheticHost();
  const directory = mkdtempSync(path.join(tmpdir(), 'intake-real-stack-electron-'));
  const desktopRoot = fileURLToPath(new URL('../..', import.meta.url));
  const evidence = process.env.INTAKE_REAL_STACK_SCREENSHOT_DIR
    ?? path.resolve(desktopRoot, '../../.gstack/intake-synthetic', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(evidence, { recursive: true });
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ cwd: desktopRoot, args: [`--user-data-dir=${directory}`, 'out/main/index.js', '--demo-e2e'], env: {
      ...process.env, DEMO_E2E: '1', CUSTOMER_AGENT_DESKTOP_API_ORIGIN: host.apiOrigin,
      CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN: host.identityOrigin, CUSTOMER_AGENT_DESKTOP_CONTENT_INTAKE: 'faq-v2',
    } });
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=query'))).toBe(true);
    const query = app.windows().find(w => w.url().includes('role=query'))!;
    await query.waitForFunction(() => Boolean(window.customerAgent?.intakeQuery));
    async function login() {
      await query.evaluate(() => window.customerAgent!.openSearch());
      await query.getByRole('button', { name: '登录', exact: true }).click();
      await expect.poll(() => app!.windows().some(w => w.url().includes('role=login'))).toBe(true);
      await app!.windows().find(w => w.url().includes('role=login'))!.getByRole('button', { name: '飞书登录' }).click();
      await expect.poll(async () => query.evaluate(async () => { const s = await window.customerAgent!.product!.sessionStatus(); return s.ok && s.signedIn; })).toBe(true);
    }
    await login();
    expect(await query.evaluate(() => window.customerAgent!.openDashboard())).toMatchObject({ ok: true });
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=dashboard'))).toBe(true);
    const dashboard = app.windows().find(w => w.url().includes('role=dashboard'))!;
    await dashboard.getByRole('button', { name: /source-a/ }).click();
    await dashboard.getByRole('button', { name: '查看材料', exact: true }).click();
    const material = dashboard.getByRole('region', { name: '当前页材料与差异' });
    await expect(material.getByRole('article')).toHaveCount(3);
    await expect(material.getByText(INTAKE_SYNTHETIC_FAQ[0]!.answer, { exact: true })).toHaveCSS('white-space', 'pre-wrap');
    await dashboard.getByRole('textbox', { name: '来源版本', exact: true }).fill('synthetic-export-one');
    await dashboard.getByRole('textbox', { name: '来源确认说明', exact: true }).fill('已人工核对本轮合成导出及三条材料');
    await dashboard.getByRole('button', { name: '确认来源版本', exact: true }).click();
    await expect(dashboard.getByText('本次操作结果：来源已确认', { exact: false })).toBeVisible();
    await dashboard.getByRole('button', { name: '发起组织审批', exact: true }).click();
    await expect.poll(async () => (await host.status()).pendingApprovals).toBe(1);
    await dashboard.getByRole('button', { name: '刷新审批结果', exact: true }).click();
    await expect(dashboard.getByRole('status').filter({ hasText: '等待组织审批' }).first()).toBeVisible();
    expect((await host.status()).publications).toBe(0);
    await expect(dashboard.getByRole('button', { name: '发布当前候选', exact: true })).toBeDisabled();
    // Independent provider action: a request alone never approves its own data.
    host.approveReview();
    await dashboard.getByRole('button', { name: '刷新审批结果', exact: true }).click();
    await expect(dashboard.getByRole('status').filter({ hasText: '组织审批已通过' }).first()).toBeVisible();
    await dashboard.screenshot({ path: path.join(evidence, 'dashboard-approved-material.png'), fullPage: true });
    await dashboard.getByRole('button', { name: '读取初检', exact: true }).click();
    await dashboard.getByRole('button', { name: '冻结本次抽样', exact: true }).click();
    await expect(dashboard.getByRole('status').filter({ hasText: '操作回执：' })).toBeVisible();
    await dashboard.getByRole('button', { name: '读取初检', exact: true }).click();
    const quality = dashboard.getByRole('region', { name: '人工质量检查' });
    await expect(quality.getByRole('article')).toHaveCount(3);
    for (const faq of INTAKE_SYNTHETIC_FAQ) {
      const row = quality.getByRole('article').filter({ has: dashboard.getByRole('combobox', { name: `检查结论 ${faq.title}`, exact: true }) });
      await row.getByRole('combobox').selectOption('pass');
      await row.getByRole('button', { name: '保存本条判断', exact: true }).click();
    }
    await dashboard.getByRole('button', { name: '提交本轮人工检查', exact: true }).click();
    await expect(dashboard.getByRole('status').filter({ hasText: '质量检查通过' }).first()).toBeVisible();
    await dashboard.getByRole('button', { name: '刷新候选状态', exact: true }).click();
    await dashboard.getByRole('button', { name: '查看材料', exact: true }).click();
    await dashboard.getByRole('textbox', { name: '发布标题', exact: true }).fill('合成桌面实链发布');
    await dashboard.getByRole('textbox', { name: '发布摘要', exact: true }).fill('三条FAQ：真实API/PG、手动模拟组织审批、逐条人工质量判断');
    await dashboard.getByRole('button', { name: '发布当前候选', exact: true }).click();
    await expect(dashboard.getByRole('status').filter({ hasText: '当前候选已发布：' })).toBeVisible();
    const result = await host.status();
    expect(result.publications).toBe(1); expect(result.currentReleaseId).not.toBe('rel_native_base'); expect(result.diagnostics).toEqual([]);
    await expect(dashboard.getByRole('status').filter({ hasText: '当前候选已发布：' })).toContainText(result.currentReleaseId);
    await dashboard.getByRole('status').filter({ hasText: '当前候选已发布：' }).scrollIntoViewIfNeeded();
    await dashboard.screenshot({ path: path.join(evidence, 'dashboard-published.png') });
    expect(await dashboard.evaluate(() => ({ node: typeof window.require, overlay: !!window.customerAgent }))).toEqual({ node: 'undefined', overlay: false });
    const security = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('role=dashboard'))!;
      const p = (win.webContents as unknown as { getLastWebPreferences(): { sandbox: boolean; nodeIntegration: boolean; contextIsolation: boolean } }).getLastWebPreferences();
      return { sandbox: p.sandbox, nodeIntegration: p.nodeIntegration, contextIsolation: p.contextIsolation };
    });
    expect(security).toEqual({ sandbox: true, nodeIntegration: false, contextIsolation: true });
    // Explicitly discard completed local UI state before closing the window.
    dashboard.once('dialog', dialog => dialog.accept());
    await dashboard.getByRole('button', { name: '关闭当前候选', exact: true }).click();
    await expect(dashboard.getByRole('region', { name: '当前候选', exact: true })).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('role=dashboard'))!.close());
    host.selectIdentity('agent');
    await query.evaluate(() => window.customerAgent!.openSearch());
    await query.getByRole('button', { name: / · 退出$/ }).click();
    await expect(query.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    await login();
    expect(await query.evaluate(() => window.customerAgent!.product!.sessionStatus())).toMatchObject({ role: 'agent', signedIn: true });
    const shops = query.getByRole('combobox', { name: '当前店铺' });
    await expect(shops.locator('option')).toHaveCount(2);
    await shops.selectOption('shop-a');
    await query.getByTestId('question-input').fill('洁面');
    await query.getByTestId('search-button').click();
    await expect(query.getByTestId('answer-text-1')).toBeVisible();
    const answers = await query.locator('[data-testid^="answer-text-"]').allTextContents();
    expect(answers.sort()).toEqual(INTAKE_SYNTHETIC_FAQ.map(f => f.answer).sort());
    await expect(query.getByTestId('answer-text-1')).toHaveCSS('white-space', 'pre-wrap');
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(w => w.webContents.getURL().includes('role=query'))!.getBounds().height)).toBeGreaterThan(150);
    await query.screenshot({ path: path.join(evidence, 'query-published-faq.png') });
    const firstAnswer = await query.getByTestId('answer-text-1').textContent();
    await query.getByTestId('copy-button-1').click();
    await expect(query.getByTestId('toast')).toContainText('已复制');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(firstAnswer);
    expect(await query.evaluate(() => window.customerAgent!.intakeQuery!.selectShop({ shopId: 'shop-b' }))).toMatchObject({ code: 'FORBIDDEN' });
    const final = await host.status();
    expect(final.currentReleaseId).toBe(result.currentReleaseId);
    expect(final.requests.some(p => p.startsWith('/v1/announce') || p === '/v1/search')).toBe(false);
    console.info(JSON.stringify({ status: 'PASS', electron: process.platform, api: 'actual', postgres: 15,
      approval: 'manual-synthetic-transport', ordinarySeat: true, releaseId: final.currentReleaseId, screenshots: evidence }));
  } finally {
    try { if (app) await closeOwnedElectron(app); }
    finally { await host.close(); rmSync(directory, { recursive: true, force: true }); }
  }
  expect(existsSync(host.root)).toBe(false);
});
