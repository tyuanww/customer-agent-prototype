import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { closeOwnedElectron } from '../support/owned-electron';
import { launchIntakeElectron } from '../support/intake-electron';

test('grants quality review through the dashboard only to an eligible synthetic person', async () => {
  test.skip(process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E !== '1', 'Explicit PG15/Electron synthetic gate');
  test.setTimeout(180_000);
  const { createIntakeSyntheticHost } = await import('../../../api/tests/support/intake-synthetic-host.ts');
  const { parseContractSchema } = await import('../../../../packages/contracts/dist/index.js');
  const host = await createIntakeSyntheticHost({ profile: 'purpose-runtime' });
  const directory = mkdtempSync(path.join(tmpdir(), 'intake-review-grant-electron-'));
  const reviewerDirectory = mkdtempSync(path.join(tmpdir(), 'intake-review-recipient-electron-'));
  const desktopRoot = fileURLToPath(new URL('../..', import.meta.url));
  const evidence = path.resolve(desktopRoot, '../../.gstack/intake-review-grant', new Date().toISOString().replaceAll(':', '-'));
  mkdirSync(evidence, { recursive: true });
  let app: ElectronApplication | undefined, reviewerApp: ElectronApplication | undefined;
  try {
    const directorAuthorization = parseContractSchema('IntakeAuthorization', await (await host.requestAs('director', '/v1/intake/authorization')).json());
    const source = directorAuthorization.capabilities.find(item => item.scope.sourceId === 'source-a');
    expect(source).toBeDefined();
    const setup = await host.requestAs('director', '/v1/intake/grants', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: 'synthetic-review-issuer-setup', issuerFactsVersion: directorAuthorization.factsVersion,
        policyVersion: directorAuthorization.policyVersion, items: ['content-manage', 'review'].map(action => ({
          kind: 'business', recipientPrincipalId: 'roster-director', recipientFactsVersion: 1, action, scope: source!.scope,
          startsAt: new Date(Date.now() - 1_000).toISOString(), expiresAt: new Date(Date.now() + 180_000).toISOString(), reason: '合成授权人准备',
        })) }),
    });
    expect(setup.status).toBe(200);

    const key = host.candidate.key;
    const qualityUrl = `/v1/intake/candidates/${key.candidateId}/versions/${key.version}/quality?digest=${key.digest}`;
    expect((await host.requestAs('roster-nogrant', qualityUrl)).ok).toBe(false);
    const publicationsBefore = (await host.status()).publications;
    host.selectIdentity('roster-director');
    app = await launchIntakeElectron({ desktopRoot, userDataDirectory: directory,
      apiOrigin: host.apiOrigin, identityOrigin: host.identityOrigin, evidenceDirectory: evidence });
    await expect.poll(() => app!.windows().some(window => window.url().includes('role=query'))).toBe(true);
    const query = app.windows().find(window => window.url().includes('role=query'))!;
    await query.waitForFunction(() => Boolean(window.customerAgent?.product));
    await app.evaluate(({ app: electronApp }) => electronApp.focus({ steal: true }));
    await query.evaluate(() => window.customerAgent!.openSearch());
    await query.getByRole('button', { name: '登录', exact: true }).click();
    await expect.poll(() => app!.windows().some(window => window.url().includes('role=login'))).toBe(true);
    await app.windows().find(window => window.url().includes('role=login'))!.getByRole('button', { name: '飞书登录' }).click();
    await expect.poll(() => query.evaluate(async () => {
      const view = await window.customerAgent!.product!.sessionStatus();
      return view.ok && view.signedIn;
    })).toBe(true);
    expect(await query.evaluate(() => window.customerAgent!.openDashboard())).toMatchObject({ ok: true });
    await expect.poll(() => app!.windows().some(window => window.url().includes('role=dashboard'))).toBe(true);
    const dashboard = app.windows().find(window => window.url().includes('role=dashboard'))!;
    await dashboard.getByRole('tab', { name: '权限', exact: true }).click();
    await dashboard.getByRole('region', { name: '权限配置' }).getByRole('button', { name: '新增授权' }).click();
    const form = dashboard.getByRole('dialog', { name: '新增业务权限' });
    await form.getByRole('combobox', { name: '人员' }).click();
    await dashboard.getByRole('option', { name: '合成坐席', exact: true }).click();
    await form.getByRole('combobox', { name: '授权方案' }).click();
    await dashboard.getByRole('option', { name: '资料审核', exact: true }).click();
    const localTime = (offset: number) => {
      const date = new Date(Date.now() + offset), pad = (value: number) => String(value).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };
    await form.getByLabel('生效时间').fill(localTime(-60_000));
    await form.getByLabel('生效时间').press('Enter');
    await form.getByLabel('失效时间').fill(localTime(120_000));
    await form.getByLabel('失效时间').press('Enter');
    await form.getByLabel('授权原因').fill('合成质量检查');
    await form.getByRole('button', { name: '预览权限' }).click();
    await expect(form.getByRole('alert')).toContainText('所选人员不能执行这些动作');
    expect((await host.requestAs('roster-nogrant', qualityUrl)).ok).toBe(false);

    await form.getByRole('combobox', { name: '人员' }).click();
    await dashboard.getByRole('option', { name: '合成无授权总监', exact: true }).click();
    await form.getByRole('button', { name: '预览权限' }).click();
    const preview = dashboard.getByRole('dialog', { name: '预览，尚未保存' });
    await expect(preview).toContainText('查看与管理资料、人工质量检查');
    await expect(preview).not.toContainText('发布资料');
    expect((await host.requestAs('roster-nogrant', qualityUrl)).ok).toBe(false);
    await preview.getByRole('button', { name: '确认保存权限' }).click();
    await expect(dashboard.getByRole('region', { name: '权限配置' }).getByRole('status')).toContainText('已保存');
    const authorization = parseContractSchema('IntakeAuthorization', await (await host.requestAs('roster-nogrant', '/v1/intake/authorization')).json());
    expect(authorization.capabilities.find(item => item.scope.sourceId === 'source-a')?.actions).toEqual(['content-manage', 'review']);
    expect((await host.requestAs('roster-nogrant', qualityUrl)).status).toBe(200);

    const sourceConfirmation = await host.requestAs('enabler', `/v1/intake/candidates/${key.candidateId}/versions/${key.version}/source-confirmation`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        operationId: 'synthetic-review-source', key, expectedEvidenceVersion: 0, confirmedVersionKind: 'opaque',
        confirmedVersionValue: 'synthetic-export', acquisition: 'controlled-synthetic-export', objectSha256: host.object.sha256, reason: '合成来源核对',
      }),
    });
    expect(sourceConfirmation.status).toBe(200);
    host.selectIdentity('roster-nogrant');
    reviewerApp = await launchIntakeElectron({ desktopRoot, userDataDirectory: reviewerDirectory,
      apiOrigin: host.apiOrigin, identityOrigin: host.identityOrigin, evidenceDirectory: evidence });
    await expect.poll(() => reviewerApp!.windows().some(window => window.url().includes('role=query'))).toBe(true);
    const reviewerQuery = reviewerApp.windows().find(window => window.url().includes('role=query'))!;
    await reviewerQuery.waitForFunction(() => Boolean(window.customerAgent?.product));
    await reviewerApp.evaluate(({ app: electronApp }) => electronApp.focus({ steal: true }));
    await reviewerQuery.evaluate(() => window.customerAgent!.openSearch());
    await reviewerQuery.getByRole('button', { name: '登录', exact: true }).click();
    await expect.poll(() => reviewerApp!.windows().some(window => window.url().includes('role=login'))).toBe(true);
    await reviewerApp.windows().find(window => window.url().includes('role=login'))!.getByRole('button', { name: '飞书登录' }).click();
    await expect.poll(() => reviewerQuery.evaluate(async () => {
      const view = await window.customerAgent!.product!.sessionStatus();
      return view.ok && view.signedIn;
    })).toBe(true);
    expect(await reviewerQuery.evaluate(() => window.customerAgent!.openDashboard())).toMatchObject({ ok: true });
    await expect.poll(() => reviewerApp!.windows().some(window => window.url().includes('role=dashboard'))).toBe(true);
    const reviewerDashboard = reviewerApp.windows().find(window => window.url().includes('role=dashboard'))!;
    await reviewerDashboard.getByTestId('nav-materials').click();
    await reviewerDashboard.getByRole('region', { name: '候选列表' }).getByRole('button', { name: /第 1 版/ }).click();
    await reviewerDashboard.getByRole('button', { name: '查看材料' }).click();
    await expect(reviewerDashboard.getByRole('region', { name: '当前步骤' })).toContainText('完成质量检查');
    await expect(reviewerDashboard.getByRole('button', { name: '读取初检' })).toBeVisible();
    await reviewerDashboard.getByRole('button', { name: '读取初检' }).click();
    await expect(reviewerDashboard.getByRole('region', { name: '人工质量检查' })).toBeVisible();
    await reviewerDashboard.getByRole('button', { name: '冻结本次抽样' }).click();
    await expect(reviewerDashboard.getByRole('status').filter({ hasText: '操作回执：' })).toBeVisible();
    await reviewerDashboard.getByRole('button', { name: '读取初检' }).click();
    await expect(reviewerDashboard.getByRole('combobox', { name: /^检查结论/ }).first()).toBeEnabled();
    await expect(reviewerDashboard.getByRole('button', { name: '发布当前候选' })).toHaveCount(0);
    expect((await host.status()).publications).toBe(publicationsBefore);
  } finally {
    try { if (reviewerApp) await closeOwnedElectron(reviewerApp); }
    finally { try { if (app) await closeOwnedElectron(app); }
      finally { try { await host.close(); } finally { rmSync(directory, { recursive: true, force: true }); rmSync(reviewerDirectory, { recursive: true, force: true }); } } }
  }
});
