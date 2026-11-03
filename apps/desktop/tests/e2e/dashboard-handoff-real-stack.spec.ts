import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { closeOwnedElectron } from '../support/owned-electron';
import { launchIntakeElectron } from '../support/intake-electron';

test('dashboard handoff: collapsed filters and account logout across windows', async () => {
  test.skip(process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E !== '1', 'Explicit synthetic PG15/Electron gate');
  test.setTimeout(180_000);
  const { createIntakeSyntheticHost } = await import('../../../api/tests/support/intake-synthetic-host.ts');
  const host = await createIntakeSyntheticHost({ prepareCandidate: false, profile: 'purpose-runtime' });
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-handoff-electron-'));
  const desktopRoot = fileURLToPath(new URL('../..', import.meta.url));
  const evidence = path.resolve(desktopRoot, '../../.gstack/dashboard-handoff', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(evidence, { recursive: true });
  const userData = path.join(directory, 'user');
  mkdirSync(userData);
  let app: ElectronApplication | undefined;
  try {
    app = await launchIntakeElectron({ desktopRoot, userDataDirectory: userData, apiOrigin: host.apiOrigin, identityOrigin: host.identityOrigin, evidenceDirectory: evidence });
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=query'))).toBe(true);
    const query = app.windows().find(w => w.url().includes('role=query'))!;
    await query.waitForFunction(() => Boolean(window.customerAgent?.intakeQuery));
    await app.evaluate(({ app }) => app.focus({ steal: true }));
    const fox = app.windows().find(w => w.url().includes('role=fox'))!;
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.getByRole('button', { name: '登录', exact: true }).click();
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=login'))).toBe(true);
    await app.windows().find(w => w.url().includes('role=login'))!.getByRole('button', { name: '飞书登录' }).click();
    await expect.poll(() => query.evaluate(async () => { const v = await window.customerAgent!.product!.sessionStatus(); return v.ok && v.signedIn; })).toBe(true);

    await query.getByRole('textbox').first().fill('洁面');
    await query.getByRole('button', { name: '查询', exact: true }).click();
    const filters = query.getByTestId('intake-query-filters');
    await expect(filters).toHaveAttribute('data-open', 'false');
    await expect(query.getByRole('combobox', { name: '当前店铺' })).toHaveCount(0);
    await query.screenshot({ path: path.join(evidence, 'query-filters-collapsed.png') });
    await filters.getByRole('button', { name: '筛选', exact: true }).click();
    await expect(query.getByRole('combobox', { name: '当前店铺' })).toBeEnabled();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-layout-ready', 'true');
    const fits = await query.evaluate(() => { const b = document.querySelector('.intake-filter-body')!.getBoundingClientRect(); return b.bottom <= innerHeight; });
    expect(fits).toBe(true);
    await query.screenshot({ path: path.join(evidence, 'query-filters-open.png') });

    expect(await query.evaluate(() => window.customerAgent!.openDashboard())).toMatchObject({ ok: true });
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=dashboard'))).toBe(true);
    const dashboard = app.windows().find(w => w.url().includes('role=dashboard'))!;

    await dashboard.getByTestId('nav-overview').click();
    await expect.poll(() => dashboard.evaluate(async () => {
      const mode = await window.dashboardWorkbench?.mode();
      return mode?.ok ? mode.kind : null;
    })).toBe('faq-v2');
    await expect(dashboard.getByTestId('module-overview')).toBeVisible();
    await expect(dashboard.getByRole('textbox', { name: '时间范围' })).toHaveCount(0);
    await expect(dashboard.getByText('当前查询暂不能统计')).toHaveCount(0);
    const overviewRequests = (await host.status()).requests;
    for (const route of ['/v1/events/usage', '/v1/metrics/question', '/v1/metrics/iteration-tasks', '/v1/metrics/inaccuracy-outcomes']) expect(overviewRequests).not.toContain(route);
    await dashboard.screenshot({ path: path.join(evidence, 'workspace.png') });
    await dashboard.getByTestId('nav-sop').click();
    await expect(dashboard.getByTestId('module-sop')).toContainText('SOP 学习与执行尚未开放。');
    await expect(dashboard.getByTestId('sop-upload')).toHaveCount(0);
    await dashboard.getByTestId('nav-wording').click();
    await expect(dashboard.getByRole('tab', { name: '本机草稿', exact: true })).toHaveCount(0);

    const before = (await host.status()).requests.filter(p => p === '/v1/auth/logout').length;
    const account = dashboard.getByRole('button', { name: '账号信息' });
    await expect(account).toBeVisible();
    await dashboard.screenshot({ path: path.join(evidence, 'account.png') });
    await account.click();
    await dashboard.getByRole('menuitem', { name: /退出登录/ }).click();
    await expect(dashboard.getByText('未登录')).toBeVisible();
    await expect.poll(async () => (await host.status()).requests.filter(p => p === '/v1/auth/logout').length).toBe(before + 1);
    await expect.poll(() => query.evaluate(async () => { const v = await window.customerAgent!.product!.sessionStatus(); return v.ok && v.signedIn; })).toBe(false);
    await expect(query.getByRole('combobox', { name: '当前店铺' })).toHaveCount(0);
    await expect(query.getByRole('button', { name: '筛选', exact: true })).toBeDisabled();
    await expect(query.locator('[data-testid^="answer-text-"]')).toHaveCount(0);
    const hasToken = await dashboard.evaluate(() => JSON.stringify(Object.keys(window.dashboardContent ?? {})));
    expect(hasToken).not.toMatch(/token|invoke|send/i);
    await dashboard.screenshot({ path: path.join(evidence, 'signed-out.png') });
    console.info(JSON.stringify({ status: 'PASS', screenshots: evidence }));
  } finally {
    try { if (app) await closeOwnedElectron(app); }
    finally { try { await host.close(); } finally { rmSync(directory, { recursive: true, force: true }); } }
  }
});
