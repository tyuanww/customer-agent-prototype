import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { closeOwnedElectron } from '../support/owned-electron';
import { launchIntakeElectron } from '../support/intake-electron';

/** Denial lane. A director title whose only live grant is query must see no write control,
 * and the sentence the operator specified. This is the review state the plan asks for, driven
 * through real Electron, HTTP and PG, with no renderer stub. */
test('a director title with a query grant only sees no write control and the denial sentence', async () => {
  test.skip(process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E !== '1', 'Explicit PG15/Electron synthetic gate');
  test.setTimeout(180_000);
  const { createIntakeSyntheticHost } = await import('../../../api/tests/support/intake-synthetic-host.ts');
  const host = await createIntakeSyntheticHost({ prepareCandidate: false, profile: 'purpose-runtime' });
  const directory = mkdtempSync(path.join(tmpdir(), 'intake-denial-electron-'));
  const desktopRoot = fileURLToPath(new URL('../..', import.meta.url));
  const evidence = path.resolve(desktopRoot, '../../.gstack/intake-permissions-denied',
    new Date().toISOString().replaceAll(':', '-'));
  mkdirSync(evidence, { recursive: true });
  let app: ElectronApplication | undefined;
  try {
    Reflect.apply(host.selectIdentity, host, ['roster-readonly']);
    app = await launchIntakeElectron({ desktopRoot, userDataDirectory: directory,
      apiOrigin: host.apiOrigin, identityOrigin: host.identityOrigin, evidenceDirectory: evidence });
    // Recording starts a capture layer, so the first window can take longer to appear.
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=query')), { timeout: 30_000 }).toBe(true);
    const query = app.windows().find(w => w.url().includes('role=query'))!;
    await query.waitForFunction(() => Boolean(window.customerAgent?.product));
    await app.evaluate(({ app: electronApp }) => electronApp.focus({ steal: true }));
    await query.evaluate(() => window.customerAgent!.openSearch());
    await query.getByRole('button', { name: '登录', exact: true }).click();
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=login'))).toBe(true);
    await app.windows().find(w => w.url().includes('role=login'))!.getByRole('button', { name: '飞书登录' }).click();
    await expect.poll(() => query.evaluate(async () => {
      const status = await window.customerAgent!.product!.sessionStatus();
      return status.ok && status.signedIn;
    })).toBe(true);
    expect(await query.evaluate(() => window.customerAgent!.openDashboard())).toMatchObject({ ok: true });
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=dashboard'))).toBe(true);
    const dashboard = app.windows().find(w => w.url().includes('role=dashboard'))!;
    await dashboard.screenshot({ path: path.join(evidence, 'denied-workbench.png') });

    // The session projection is the contract the renderer acts on, so read it first.
    const session = await dashboard.evaluate(async () => {
      const api = (window as unknown as { dashboardContent?: { session: () => Promise<unknown> } }).dashboardContent;
      return api ? await api.session() : null;
    }) as { ok: boolean; job: { status: string; title: string; actions: Record<string, boolean> } | null } | null;
    expect(session?.ok).toBe(true);
    expect(session?.job).toMatchObject({
      status: 'resolved',
      title: '客服总监',
      actions: { query: true, import: false, publish: false, rollback: false },
    });

    await dashboard.getByTestId('nav-materials').click();
    await expect(dashboard.getByRole('heading', { name: '资料' })).toBeVisible();
    await expect(dashboard.getByTestId('nav-publish')).toHaveCount(0);
    await expect(dashboard.getByTestId('module-content')).toHaveCount(0);
    await dashboard.screenshot({ path: path.join(evidence, 'denied-publish.png') });

    // The permission page still lists a scope, so the missing grant button cannot be blamed on
    // an empty list.
    await dashboard.getByTestId('nav-permissions').click();
    const panel = dashboard.getByRole('region', { name: '权限配置', exact: true });
    // Read the projection the panel renders from, so "no scope" cannot be mistaken for "no bit".
    // The first read is asynchronous, so wait for the panel to finish before judging it.
    const readPermission = () => dashboard.evaluate(async () => {
      const api = (window as unknown as { dashboardPermissions?: { current: () => Promise<unknown> } }).dashboardPermissions;
      return api ? await api.current() : null;
    }) as Promise<{ ok: boolean; view: { available: boolean; busy: boolean; sources: unknown[] } } | null>;
    await expect.poll(async () => (await readPermission())?.view.available).toBe(true);
    const permission = await readPermission();
    expect(permission?.ok).toBe(true);
    expect(permission?.view.sources.length).toBeGreaterThan(0);
    await expect(panel.getByRole('button', { name: '新增授权', exact: true })).toHaveCount(0);
    await expect(panel.getByText('没有权限，请找人开通。')).toBeVisible();

    await dashboard.screenshot({ path: path.join(evidence, 'denied-grant.png') });
    console.info(JSON.stringify({
      status: 'PASS',
      flow: 'director-query-only-no-write-control',
      actions: session?.job?.actions,
      screenshots: evidence,
    }));
  } finally {
    try { if (app) await closeOwnedElectron(app); }
    finally { try { await host.close(); } finally { rmSync(directory, { recursive: true, force: true }); } }
  }
});
