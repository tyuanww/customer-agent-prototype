import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { closeOwnedElectron } from '../support/owned-electron';
import { launchIntakeElectron } from '../support/intake-electron';

test('review-only administrator manages accounts from Settings without grant controls', async () => {
  test.skip(process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E !== '1', 'Explicit PG15/Electron synthetic gate');
  test.setTimeout(180_000);
  const directory = mkdtempSync(path.join(tmpdir(), 'settings-accounts-electron-'));
  const userData = path.join(directory, 'user');
  mkdirSync(userData);
  const desktopRoot = fileURLToPath(new URL('../..', import.meta.url));
  const evidence = path.resolve(desktopRoot, '../../.gstack/settings-accounts', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(evidence, { recursive: true });
  let app: ElectronApplication | undefined;
  let closeHost: (() => Promise<void>) | undefined;
  try {
    const { createIntakeSyntheticHost } = await import('../../../api/tests/support/intake-synthetic-host.ts');
    const host = await createIntakeSyntheticHost({ prepareCandidate: false, profile: 'purpose-runtime' });
    closeHost = () => host.close();
    host.selectIdentity('roster-review-only');
    app = await launchIntakeElectron({
      desktopRoot,
      userDataDirectory: userData,
      apiOrigin: host.apiOrigin,
      identityOrigin: host.identityOrigin,
      evidenceDirectory: evidence,
    });
    await expect.poll(() => app!.windows().some(window => window.url().includes('role=query'))).toBe(true);
    const query = app.windows().find(window => window.url().includes('role=query'))!;
    await query.waitForFunction(() => Boolean(window.customerAgent?.product));
    await app.evaluate(({ app }) => app.focus({ steal: true }));
    await query.evaluate(() => window.customerAgent!.openSearch());
    await query.getByRole('button', { name: '登录', exact: true }).click();
    await expect.poll(() => app!.windows().some(window => window.url().includes('role=login'))).toBe(true);
    await app.windows().find(window => window.url().includes('role=login'))!.getByRole('button', { name: '飞书登录' }).click();
    await expect.poll(async () => {
      const status = await query.evaluate(() => window.customerAgent!.product!.sessionStatus());
      return status.ok && status.signedIn;
    }).toBe(true);

    expect(await query.evaluate(() => window.customerAgent!.openDashboard())).toMatchObject({ ok: true });
    await expect.poll(() => app!.windows().some(window => window.url().includes('role=dashboard'))).toBe(true);
    const dashboard = app.windows().find(window => window.url().includes('role=dashboard'))!;
    await expect(dashboard.getByTestId('nav-settings')).toBeVisible();
    await dashboard.getByTestId('nav-settings').click();
    await expect(dashboard.getByRole('tab', { name: '账号', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(dashboard.getByRole('tab', { name: '权限', exact: true })).toHaveCount(0);
    await expect(dashboard.getByRole('button', { name: '新增授权', exact: true })).toHaveCount(0);
    const table = dashboard.getByRole('table', { name: '账号', exact: true });
    await expect(table).toBeVisible();

    await dashboard.getByRole('button', { name: '新建账号', exact: true }).click();
    const create = dashboard.getByRole('dialog', { name: '新建账号', exact: true });
    await create.getByLabel('姓名', { exact: true }).fill('合成审核账号');
    await create.getByLabel('登录名', { exact: true }).fill('review-seat-ui');
    await create.getByLabel('密码', { exact: true }).fill('pw-review-seat');
    await create.getByRole('button', { name: '保存账号', exact: true }).click();
    const row = table.getByRole('row').filter({ hasText: 'review-seat-ui' });
    await expect(row).toContainText('使用中');

    await row.getByRole('button', { name: '重置密码', exact: true }).click();
    const reset = dashboard.getByRole('dialog', { name: '重置密码', exact: true });
    await reset.getByLabel('新密码', { exact: true }).fill('pw-review-seat-2');
    await reset.getByRole('button', { name: '确认重置', exact: true }).click();
    await expect(reset).toHaveCount(0);

    await row.getByRole('button', { name: '停用', exact: true }).click();
    const disable = dashboard.getByRole('dialog', { name: '停用账号', exact: true });
    await disable.getByRole('button', { name: '确认停用', exact: true }).click();
    await expect(row).toContainText('已停用');

    const seats = await host.requestAs('roster-review-only', '/v1/intake/seats');
    expect(seats.ok).toBe(true);
    expect(((await seats.json()) as { seats: { username: string; enabled: boolean }[] }).seats)
      .toContainEqual(expect.objectContaining({ username: 'review-seat-ui', enabled: false }));

    const grantRead = await dashboard.evaluate(() => window.dashboardPermissions!.current());
    expect(grantRead).toMatchObject({ ok: false, message: '没有权限，请找人开通。', view: null });
    const grantCommand = await dashboard.evaluate(() => window.dashboardPermissions!.command({ action: 'refresh' }));
    expect(grantCommand).toMatchObject({ ok: false, message: '没有权限，请找人开通。', view: null });
    const requests = (await host.status()).requests;
    expect(requests).toContain('/v1/intake/seats/administration');
    expect(requests).toContain('/v1/intake/seats');
    expect(requests.some(path => path.startsWith('/v1/intake/sources?'))).toBe(false);
    expect(requests.some(path => path.startsWith('/v1/intake/principals?'))).toBe(false);
    await dashboard.screenshot({ path: path.join(evidence, 'settings-accounts.png') });
    console.info(JSON.stringify({
      status: 'PASS',
      flow: 'review-only-settings-accounts',
      seats: ['list', 'create', 'reset', 'disable'],
      grantControls: 'absent',
      screenshots: evidence,
    }));
  } finally {
    try {
      if (app) await closeOwnedElectron(app);
    } finally {
      try {
        await closeHost?.();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  }
});
