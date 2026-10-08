import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';
import { closeOwnedElectron } from '../support/owned-electron';

/** Synthetic identity only. The capability-candidate host must register grants
 * against its existing service. No renderer/IPC/network stubs replace the flow. */
test('director previews without saving, grants a named seat query access, then revokes it through real Electron/HTTP/PG', async () => {
  test.skip(process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E !== '1', 'Explicit PG15/Electron synthetic gate');
  test.setTimeout(180_000);
  const { createIntakeSyntheticHost } = await import('../../../api/tests/support/intake-synthetic-host.ts');
  const options = { prepareCandidate: false as const, profile: 'purpose-candidate' as const };
  const host = await createIntakeSyntheticHost(options);
  const directory = mkdtempSync(path.join(tmpdir(), 'intake-permissions-electron-'));
  const desktopRoot = fileURLToPath(new URL('../..', import.meta.url));
  let app: ElectronApplication | undefined;
  try {
    // Integration seam added by the parallel host task; fail closed on the old
    // host, never silently test with its unrestricted profile or starting grant.
    const revokeInitial = Reflect.get(host, 'revokeSyntheticQuery');
    expect(typeof revokeInitial).toBe('function');
    await Reflect.apply(revokeInitial, host, []);
    Reflect.apply(host.selectIdentity, host, ['director']);
    let generation = 0;
    const entitlement = () => host.requestAs('agent', '/v1/intake/entitlements', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopId: 'shop-a', contextGeneration: ++generation, productIds: [], scenarioIds: [], releaseId: null }),
    });
    expect((await entitlement()).ok).toBe(false);
    app = await electron.launch({ cwd: desktopRoot, args: [`--user-data-dir=${directory}`, 'out/main/index.js', '--demo-e2e'], env: {
      ...process.env, DEMO_E2E: '1', CUSTOMER_AGENT_DESKTOP_API_ORIGIN: host.apiOrigin,
      CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN: host.identityOrigin, CUSTOMER_AGENT_DESKTOP_CONTENT_INTAKE: 'faq-v2',
    } });
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
    await dashboard.getByRole('group', { name: '内容管理工作区' }).getByRole('button', { name: '权限配置', exact: true }).click();
    const panel = dashboard.getByRole('region', { name: '权限配置', exact: true });
    await panel.getByRole('combobox', { name: '人员', exact: true }).selectOption({ label: '合成坐席' });
    await panel.getByRole('checkbox', { name: '查询复制', exact: true }).check();
    const localTime = (offset: number) => {
      const d = new Date(Date.now() + offset); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16);
    };
    await panel.getByLabel('生效时间', { exact: true }).fill(localTime(-60_000));
    await panel.getByLabel('失效时间', { exact: true }).fill(localTime(600_000));
    await panel.getByLabel('授权原因', { exact: true }).fill('合成桌面验收授予查询');
    await panel.getByRole('button', { name: '预览权限', exact: true }).click();
    await expect(panel.getByRole('heading', { name: '预览 · 尚未保存' })).toBeVisible();
    expect((await entitlement()).ok).toBe(false);
    await panel.getByRole('button', { name: '返回修改', exact: true }).click();
    await expect(panel.getByRole('region', { name: '权限预览', exact: true })).toHaveCount(0);
    expect((await entitlement()).ok).toBe(false);
    await panel.getByRole('button', { name: '预览权限', exact: true }).click();
    await panel.getByRole('button', { name: '确认保存权限', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('已保存');
    const granted = await entitlement(); expect(granted.status).toBe(200);
    await panel.getByRole('button', { name: '刷新权限列表', exact: true }).click();
    const record = panel.getByRole('article').filter({ hasText: '合成桌面验收授予查询' });
    await expect(record).toHaveCount(1);
    await record.getByRole('button', { name: '撤销该权限', exact: true }).click();
    await record.getByLabel('撤销原因', { exact: true }).fill('合成桌面验收撤销');
    await record.getByRole('button', { name: '确认撤销', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('已保存');
    expect((await entitlement()).ok).toBe(false);
    console.info('PASS synthetic director named-seat preview/cancel/save/revoke; fresh query entitlement enabled then denied; purpose-candidate profile');
  } finally {
    try { if (app) await closeOwnedElectron(app); }
    finally { try { await host.close(); } finally { rmSync(directory, { recursive: true, force: true }); } }
  }
});
