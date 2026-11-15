import { createServer } from 'node:net';
import { createIdentityProvider } from '../../../../scripts/synthetic-stack/identity-provider.ts';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { closeOwnedElectron } from '../support/owned-electron';
import { launchIntakeElectron } from '../support/intake-electron';

test('review-only administrator manages accounts from Settings without grant controls', async () => {
  test.skip(process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E !== '1', 'Explicit PG15/Electron synthetic gate');
  test.setTimeout(300_000);
  const directory = mkdtempSync(path.join(tmpdir(), 'settings-accounts-electron-'));
  const userData = path.join(directory, 'user');
  mkdirSync(userData);
  const desktopRoot = fileURLToPath(new URL('../..', import.meta.url));
  const evidence = path.resolve(desktopRoot, '../../.gstack/settings-accounts', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(evidence, { recursive: true });
  let app: ElectronApplication | undefined;
  let closeHost: (() => Promise<void>) | undefined;
  let closeIdentity: (() => Promise<void>) | undefined;
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
    await create.getByLabel('密码', { exact: true }).fill('short');
    await create.getByRole('button', { name: '保存账号', exact: true }).click();
    await expect(create.getByRole('alert')).toContainText('8 至 256');
    await expect(create.getByLabel('密码', { exact: true })).toHaveValue('short');
    const passwordA = ` ${'a'.repeat(254)} `;
    const passwordB = 'synthetic-reset-password-B';
    await create.getByLabel('密码', { exact: true }).fill(passwordA);
    await create.getByRole('button', { name: '保存账号', exact: true }).click();
    const row = table.getByRole('row').filter({ hasText: 'review-seat-ui' });
    await expect(row).toContainText('使用中');

    const reservation = createServer();
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('No synthetic identity port');
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
    const identity = createIdentityProvider({ port: address.port, accountsFile: host.seatPasswordAccountsFile,
      bindingAllowed: async binding => {
        const response = await host.requestAs('roster-review-only', '/v1/intake/seats');
        const body = await response.json() as { seats: { username: string; enabled: boolean }[] };
        return response.ok && body.seats.some(seat => `synthetic_seat_${seat.username}` === binding && seat.enabled);
      } });
    closeIdentity = () => identity.close();
    const passwordOrigin = await identity.listen();
    host.useSeatPasswordIdentity(passwordOrigin);
    let attempt = 0;
    const verifyDesktopLogin = async (password: string, previous?: string) => {
      const seatUserData = path.join(directory, `seat-${++attempt}`);
      mkdirSync(seatUserData);
      const seatApp = await launchIntakeElectron({ desktopRoot, userDataDirectory: seatUserData,
        apiOrigin: host.apiOrigin, identityOrigin: host.identityOrigin, evidenceDirectory: evidence });
      try {
        await expect.poll(() => seatApp.windows().some(window => window.url().includes('role=query'))).toBe(true);
        const seatQuery = seatApp.windows().find(window => window.url().includes('role=query'))!;
        await seatQuery.waitForFunction(() => Boolean(window.customerAgent?.product));
        await seatQuery.evaluate(() => window.customerAgent!.openSearch());
        await seatQuery.getByRole('button', { name: '登录', exact: true }).click();
        await expect.poll(() => seatApp.windows().some(window => window.url().includes('role=login'))).toBe(true);
        const login = seatApp.windows().find(window => window.url().includes('role=login'))!;
        await seatApp.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('role=login'))!.setContentSize(520, 360);
        });
        await login.getByText('账号', { exact: true }).click();
        await login.getByRole('textbox', { name: '登录名' }).fill('review-seat-ui');
        if (previous) {
          await login.getByLabel('密码', { exact: true }).fill(previous);
          await login.getByRole('button', { name: '登录', exact: true }).click();
          await expect(login.getByRole('alert')).toContainText('账号或密码不正确');
          const button = login.getByRole('button', { name: '登录', exact: true });
          await button.scrollIntoViewIfNeeded();
          expect(await button.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return rect.top >= 0 && rect.bottom <= window.innerHeight;
          })).toBe(true);
          await login.screenshot({ path: path.join(evidence, `login-error-${attempt}.png`) });
        }
        await login.getByLabel('密码', { exact: true }).fill(password);
        await login.getByRole('button', { name: '登录', exact: true }).click();
        await expect.poll(async () => {
          const status = await seatQuery.evaluate(() => window.customerAgent!.product!.sessionStatus());
          return status.ok && status.signedIn;
        }).toBe(true);
        await seatQuery.evaluate(() => window.customerAgent!.product!.logout());
      } finally { await closeOwnedElectron(seatApp); }
    };
    await verifyDesktopLogin(passwordA);
    let previous = passwordA;
    for (const password of [passwordA, passwordB, passwordA]) {
      await row.getByRole('button', { name: '重置密码', exact: true }).click();
      const reset = dashboard.getByRole('dialog', { name: '重置密码', exact: true });
      await reset.getByLabel('新密码', { exact: true }).fill(password);
      await reset.getByRole('button', { name: '确认重置', exact: true }).click();
      await expect(reset).toHaveCount(0);
      await verifyDesktopLogin(password, password === previous ? undefined : previous);
      previous = password;
    }

    await row.getByRole('button', { name: '停用', exact: true }).click();
    const disable = dashboard.getByRole('dialog', { name: '停用账号', exact: true });
    await disable.getByRole('button', { name: '确认停用', exact: true }).click();
    await expect(row).toContainText('已停用');

    const seats = await host.requestAs('roster-review-only', '/v1/intake/seats');
    expect(seats.ok).toBe(true);
    expect(((await seats.json()) as { seats: { username: string; enabled: boolean }[] }).seats)
      .toContainEqual(expect.objectContaining({ username: 'review-seat-ui', enabled: false }));

    const rejected = await fetch(`${passwordOrigin}/password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'review-seat-ui', password: passwordA }) });
    expect(rejected.status).toBe(401);

    const grantRead = await dashboard.evaluate(() => window.dashboardPermissions!.current());
    expect(grantRead).toMatchObject({ ok: false, message: '没有权限，请找人开通。', view: null });
    const grantCommand = await dashboard.evaluate(() => window.dashboardPermissions!.command({ action: 'refresh' }));
    expect(grantCommand).toMatchObject({ ok: false, message: '没有权限，请找人开通。', view: null });
    const requests = (await host.status()).requests;
    expect(requests).toContain('/v1/access/settings');
    expect(requests).toContain('/v1/intake/seats');
    expect(requests.some(path => path.startsWith('/v1/intake/sources?'))).toBe(false);
    expect(requests.some(path => path.startsWith('/v1/intake/principals?'))).toBe(false);
    const directoryPage = await host.requestAs('roster-director', '/v1/intake/principals?sourceId=source-a&purpose=contributor');
    expect(directoryPage.status).toBe(200);
    await dashboard.screenshot({ path: path.join(evidence, 'settings-accounts.png') });
    console.info(JSON.stringify({
      status: 'PASS',
      flow: 'review-only-settings-accounts',
      seats: ['list', 'create', 'reset-A-B-A', 'password-login', 'previous-password-refused', 'disable'],
      grantControls: 'absent',
      screenshots: evidence,
    }));
  } finally {
    try {
      if (app) await closeOwnedElectron(app);
    } finally {
      try {
        await closeIdentity?.();
        await closeHost?.();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  }
});
