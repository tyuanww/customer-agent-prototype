import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { closeOwnedElectron } from '../support/owned-electron';
import { launchIntakeElectron } from '../support/intake-electron';

/** Synthetic identity only. The capability-candidate host must register grants
 * against its existing service. No renderer/IPC/network stubs replace the flow. */
test('director previews without saving, grants a named seat query access, then revokes it through real Electron/HTTP/PG', async () => {
  test.skip(process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E !== '1', 'Explicit PG15/Electron synthetic gate');
  test.setTimeout(180_000);
  const { createIntakeSyntheticHost } = await import('../../../api/tests/support/intake-synthetic-host.ts');
  const options = { prepareCandidate: false as const, profile: 'purpose-runtime' as const };
  const host = await createIntakeSyntheticHost(options);
  const directory = mkdtempSync(path.join(tmpdir(), 'intake-permissions-electron-'));
  const desktopRoot = fileURLToPath(new URL('../..', import.meta.url));
  const evidence = path.resolve(desktopRoot, '../../.gstack/intake-permissions', new Date().toISOString().replaceAll(':','-'));
  mkdirSync(evidence, { recursive: true });
  let app: ElectronApplication | undefined;
  try {
    // Integration seam added by the parallel host task; fail closed on the old
    // host, never silently test with its unrestricted profile or starting grant.
    const revokeInitial = Reflect.get(host, 'revokeSyntheticQuery');
    expect(typeof revokeInitial).toBe('function');
    await Reflect.apply(revokeInitial, host, []);
    Reflect.apply(host.selectIdentity, host, ['roster-director']);
    let generation = 0;
    const entitlement = () => host.requestAs('agent', '/v1/intake/entitlements', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopId: 'shop-a', contextGeneration: ++generation, productIds: [], scenarioIds: [], releaseId: null }),
    });
    expect((await entitlement()).ok).toBe(false);
    app = await launchIntakeElectron({ desktopRoot, userDataDirectory: directory,
      apiOrigin: host.apiOrigin, identityOrigin: host.identityOrigin, evidenceDirectory: evidence });
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=query'))).toBe(true);
    const query = app.windows().find(w => w.url().includes('role=query'))!;
    await query.waitForFunction(() => Boolean(window.customerAgent?.product));
    await app.evaluate(({ app }) => app.focus({ steal: true }));
    await query.evaluate(() => window.customerAgent!.openSearch());
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.getByRole('button', { name: '登录', exact: true }).click();
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=login'))).toBe(true);
    await app.windows().find(w => w.url().includes('role=login'))!.getByRole('button', { name: '飞书登录' }).click();
    await expect.poll(() => query.evaluate(async () => { const s = await window.customerAgent!.product!.sessionStatus(); return s.ok && s.signedIn; })).toBe(true);
    expect(await query.evaluate(() => window.customerAgent!.openDashboard())).toMatchObject({ ok: true });
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=dashboard'))).toBe(true);
    const dashboard = app.windows().find(w => w.url().includes('role=dashboard'))!;
    await dashboard.getByRole('tab', { name: '成员与权限', exact: true }).click();
    const panel = dashboard.getByRole('region', { name: '权限配置', exact: true });
    await expect(panel.getByRole('table', { name: '成员权限', exact: true })).toBeVisible();
    // Appearance is judged on the panel before the modal opens, because an antd mask owns the
    // pointer and would intercept the chrome menu.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('role=dashboard'))!.setSize(980, 680));
    for (const theme of ['light','dark'] as const) {
      await dashboard.getByTestId('dashboard-theme-trigger').click();
      await dashboard.getByTestId(`dashboard-theme-${theme}`).click();
      await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-theme', theme);
      expect(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await dashboard.screenshot({ path: path.join(evidence, `permissions-${theme}.png`) });
    }
    // The grant form is an antd Modal portalled to body, so the dialog owns the fields while the
    // panel keeps the entry button, the grant list, and the status sentence.
    await panel.getByRole('button', { name: '新增授权', exact: true }).click();
    const dialog = dashboard.getByRole('dialog', { name: '新增授权', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox', { name: '成员', exact: true }).click();
    await dashboard.getByRole('option', { name: '合成坐席', exact: true }).click();
    await expect(dialog.getByRole('combobox', { name: '岗位', exact: true })
      .locator('xpath=ancestor::*[contains(@class,"ant-select")][1]')).toContainText('客服');
    await dialog.screenshot({ path: path.join(evidence, 'permissions-grant-dialog.png') });
    const localTime = (offset: number) => {
      const d = new Date(Date.now() + offset);
      const pad = (value: number) => String(value).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const start = dialog.getByRole('textbox', { name: '生效时间', exact: true });
    const end = dialog.getByRole('textbox', { name: '失效时间', exact: true });
    await start.fill(localTime(-60_000));
    await start.press('Enter');
    // The issuer facts window is capped at five minutes by a database check, so the granted
    // window has to stay inside it or the server refuses to preview a longer grant.
    await end.fill(localTime(180_000));
    await end.press('Enter');
    await dialog.getByLabel('授权原因', { exact: true }).fill('合成桌面验收授予查询');
    await dialog.getByRole('button', { name: '预览权限', exact: true }).click();
    const preview = dashboard.getByRole('dialog', { name: '预览，尚未保存', exact: true });
    await expect(preview).toBeVisible();
    await expect(preview.getByRole('region', { name: '权限预览', exact: true })).toBeVisible();
    expect((await entitlement()).ok).toBe(false);
    // While the preview is open the mask owns the pointer, so an outer tab click cannot move the
    // page. The preview has to survive that blocked attempt, not be dropped by it.
    await dashboard.getByTestId('nav-overview').click({ timeout: 1_000 }).catch(() => undefined);
    await expect(preview).toBeVisible();
    expect((await entitlement()).ok).toBe(false);
    await preview.getByRole('button', { name: '返回修改', exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dashboard.getByRole('region', { name: '权限预览', exact: true })).toHaveCount(0);
    expect((await entitlement()).ok).toBe(false);
    await dialog.getByRole('button', { name: '预览权限', exact: true }).click();
    await preview.getByRole('button', { name: '确认保存权限', exact: true }).click();
    await expect(dashboard.getByRole('dialog', { name: '预览，尚未保存', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('status')).toContainText('已保存');
    const granted = await entitlement(); expect(granted.status).toBe(200);
    await panel.getByRole('button', { name: '刷新权限列表', exact: true }).click();
    await panel.getByRole('table', { name: '成员权限', exact: true }).getByRole('row').filter({ hasText: '合成坐席' }).getByRole('button', { name: '查看权限', exact: true }).click();
    const detail = dashboard.getByRole('dialog', { name: '合成坐席的权限', exact: true });
    const grants = detail.getByRole('table', { name: '权限明细', exact: true });
    const record = grants.getByRole('row').filter({ hasText: '合成桌面验收授予查询' });
    await expect(record).toHaveCount(1);
    await record.getByRole('button', { name: '撤销该权限', exact: true }).click();
    await detail.getByLabel('撤销原因', { exact: true }).fill('合成桌面验收撤销');
    await detail.getByRole('button', { name: '确认撤销', exact: true }).click();
    const revokeDialog = dashboard.getByRole('dialog', {
      name: '收回 合成坐席 在 该店铺 / 产品 / 该来源的查询复制',
      exact: true,
    });
    await expect(revokeDialog).toBeVisible();
    await expect(revokeDialog).toContainText('仅撤销这条权限。撤销后如需使用，须重新授权。');
    await revokeDialog.getByRole('button', { name: '确认收回', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('已保存');
    expect((await entitlement()).ok).toBe(false);
    console.info(JSON.stringify({status:'PASS',flow:'director-named-seat-preview-cancel-save-revoke',profile:'purpose-runtime',entitlements:'denied-enabled-denied',appearance:'980x680-light-dark',screenshots:evidence}));
  } finally {
    try { if (app) await closeOwnedElectron(app); }
    finally { try { await host.close(); } finally { rmSync(directory, { recursive: true, force: true }); } }
  }
});
