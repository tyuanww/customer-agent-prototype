import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { closeOwnedElectron } from '../support/owned-electron';
import { launchIntakeElectron } from '../support/intake-electron';

test('a director with query but no allocation cannot grant permissions', async () => {
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
    host.selectIdentity('roster-query-only');
    const { parseContractSchema } = await import('../../../../packages/contracts/dist/index.js');
    const authorizationResponse = await host.requestAs('roster-query-only', '/v1/intake/authorization');
    expect(authorizationResponse.status).toBe(200);
    const authorization = parseContractSchema('IntakeAuthorization', await authorizationResponse.json());
    const scope = authorization.capabilities.find(row => row.scope.sourceId === 'source-a');
    expect(scope).toMatchObject({ actions: ['query'], mayAllocate: [], mayDelegate: [] });
    expect(scope).toBeDefined();
    const grant = {
      operationId: 'synthetic-denied-query-grant', issuerFactsVersion: authorization.factsVersion,
      policyVersion: authorization.policyVersion, items: [{ kind: 'business', recipientPrincipalId: 'roster-agent',
        recipientFactsVersion: 1, action: 'query', scope: scope!.scope,
        startsAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), reason: '合成拒绝验收' }],
    };
    const preview = (identity: 'roster-query-only' | 'roster-director') => host.requestAs(identity, '/v1/intake/grants/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(grant),
    });
    const control = await preview('roster-director');
    expect(control.status).toBe(200);
    const denied = await preview('roster-query-only');
    expect(denied.status).toBe(404);
    expect(await denied.json()).toMatchObject({ error: { details: { reason: 'GRANT_AUTHORITY_DENIED' } } });
    const deniedSave = await host.requestAs('roster-query-only', '/v1/intake/grants', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(grant),
    });
    expect(deniedSave.status).toBe(404);
    expect(await deniedSave.json()).toMatchObject({ error: { details: { reason: 'GRANT_AUTHORITY_DENIED' } } });
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

    await expect.poll(async () => (await dashboard.evaluate(() => window.dashboardPageUse!.current())).phase).toBe('ready');
    await expect.poll(async () => {
      const snapshot = await dashboard.evaluate(() => window.dashboardPageUse!.current());
      return snapshot.phase === 'ready' ? snapshot.permissions.state : snapshot.phase;
    }).toBe('closed');
    await expect(dashboard.getByTestId('nav-permissions')).toHaveCount(0);
    await expect(dashboard.getByRole('region', { name: '权限配置', exact: true })).toHaveCount(0);
    await expect(dashboard.getByRole('button', { name: '新增授权', exact: true })).toHaveCount(0);

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
