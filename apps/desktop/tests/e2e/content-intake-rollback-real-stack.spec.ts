import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';
import { closeOwnedElectron } from '../support/owned-electron';

/** Both starting releases pass actual upload/approval/quality HTTP. Rollback
 * then crosses renderer/preload/Main/HTTP/PG and a separately signed-in seat. */
test('independent rollback review creates a new release whose historical FAQ is consumed by another seat', async () => {
  test.skip(process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E !== '1', 'Explicit PG15/Electron synthetic gate');
  test.setTimeout(180_000);
  const { parseContractSchema } = await import('../../../../packages/contracts/dist/index.js');
  const { createIntakeSyntheticHost, createIntakeSyntheticWorkbook, INTAKE_SYNTHETIC_FAQ } = await import('../../../api/tests/support/intake-synthetic-host.ts');
  const host = await createIntakeSyntheticHost({ prepareCandidate: false });
  const directory = mkdtempSync(path.join(tmpdir(), 'intake-rollback-electron-'));
  const desktopRoot = fileURLToPath(new URL('../..', import.meta.url));
  const evidence = path.resolve(desktopRoot, '../../.gstack/intake-synthetic', `rollback-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(evidence, { recursive: true });
  let app: ElectronApplication | undefined;
  const errors: string[] = [];
  async function json(response: Response) {
    const value: unknown = await response.json();
    expect(response.ok, JSON.stringify(value)).toBe(true); return value;
  }
  const post = async (url: string, body: unknown) => json(await host.requestAs('enabler', url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  async function publish(prefix: string, baseReleaseId: string, suffix: string) {
    const workbook = await createIntakeSyntheticWorkbook({ answerSuffix: suffix });
    const form = new FormData(); form.set('operationId', `${prefix}-upload`);
    form.set('file', new Blob([new Uint8Array(workbook)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic-rollback.xlsx');
    const object = parseContractSchema('IntakeObject', await json(await host.requestAs('enabler', '/v1/intake/sources/source-a/objects', { method: 'POST', body: form })));
    let job = parseContractSchema('IntakeParseJob', await post('/v1/intake/sources/source-a/candidates', {
      operationId: `${prefix}-receive`, objectId: object.objectId, sourceVersion: 1, baseReleaseId,
      contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null,
    }));
    await expect.poll(async () => {
      job = parseContractSchema('IntakeParseJob', await json(await host.requestAs('enabler', `/v1/intake/parse-jobs/${job.jobId}`)));
      return job.state;
    }).toBe('validated');
    const url = `/v1/intake/candidates/${job.candidateId}/versions/${job.candidateVersion}`;
    const candidate = parseContractSchema('IntakeCandidate', await json(await host.requestAs('enabler', url)));
    const key = candidate.key;
    await post(`${url}/source-confirmation`, { operationId: `${prefix}-source`, key, expectedEvidenceVersion: 0,
      confirmedVersionKind: 'opaque', confirmedVersionValue: prefix, acquisition: 'controlled-synthetic-export', objectSha256: object.sha256, reason: '合成回退验收来源' });
    await post(`${url}/review`, { operationId: `${prefix}-review`, key, expectedEvidenceVersion: 0 });
    host.approveReview();
    await post(`${url}/review/refresh`, { operationId: `${prefix}-refresh`, key, expectedEvidenceVersion: 1 });
    await post(`${url}/quality/freeze`, { operationId: `${prefix}-freeze`, key });
    const quality = parseContractSchema('IntakeQualityStatus', await json(await host.requestAs('enabler', `${url}/quality?digest=${key.digest}`)));
    const samples = parseContractSchema('IntakeQualitySamplePage', await json(await host.requestAs('enabler', `${url}/quality/samples?${new URLSearchParams({ digest: key.digest, viewHash: quality.viewHash, phase: 'initial', limit: '100' })}`)));
    expect(samples.nextCursor).toBeNull(); expect(samples.items).toHaveLength(3);
    await post(`${url}/quality/checks`, { operationId: `${prefix}-checks`, key, phase: 'initial',
      checks: samples.items.map(row => ({ scriptId: row.scriptId, contentHash: row.contentHash, defect: false, reason: '' })) });
    const receipt = parseContractSchema('IntakeReceipt', await post(`${url}/publish`, { operationId: `${prefix}-publish`, key, baseReleaseId,
      sourceEvidenceVersion: 1, approvalEvidenceVersion: 1, title: '合成回退验收', summary: prefix }));
    expect(receipt.state).toBe('published'); expect(receipt.releaseId).not.toBeNull(); return receipt.releaseId!;
  }
  try {
    const target = await publish('rollback-target', 'rel_native_base', '');
    const base = await publish('rollback-current', target, '\n合成当前版本，等待纠正。');
    expect(base).not.toBe(target);
    app = await electron.launch({ cwd: desktopRoot, args: [`--user-data-dir=${directory}`, 'out/main/index.js', '--demo-e2e'], env: {
      ...process.env, DEMO_E2E: '1', CUSTOMER_AGENT_DESKTOP_API_ORIGIN: host.apiOrigin,
      CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN: host.identityOrigin, CUSTOMER_AGENT_DESKTOP_CONTENT_INTAKE: 'faq-v2',
    } });
    const observe = (page: import('@playwright/test').Page) => page.on('pageerror', error => errors.push(error.message));
    app.on('window', observe); app.windows().forEach(observe);
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=query'))).toBe(true);
    const query = app.windows().find(w => w.url().includes('role=query'))!;
    await query.waitForFunction(() => Boolean(window.customerAgent?.intakeQuery));
    async function openQuery() {
      await app!.evaluate(({ app }) => app.focus({ steal: true }));
      await query.evaluate(() => window.customerAgent!.openSearch());
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    }
    async function login() {
      await openQuery(); await query.getByRole('button', { name: '登录', exact: true }).click();
      await expect.poll(() => app!.windows().some(w => w.url().includes('role=login'))).toBe(true);
      await app!.windows().find(w => w.url().includes('role=login'))!.getByRole('button', { name: '飞书登录' }).click();
      await expect.poll(() => query.evaluate(async () => { const s = await window.customerAgent!.product!.sessionStatus(); return s.ok && s.signedIn; })).toBe(true);
    }
    await login();
    expect(await query.evaluate(() => window.customerAgent!.openDashboard())).toMatchObject({ ok: true });
    await expect.poll(() => app!.windows().some(w => w.url().includes('role=dashboard'))).toBe(true);
    const dashboard = app.windows().find(w => w.url().includes('role=dashboard'))!;
    const rollback = dashboard.getByRole('region', { name: '已发布目录纠正回退' });
    await rollback.getByLabel('当前发布版本', { exact: true }).fill(base);
    await rollback.getByLabel('目标历史版本', { exact: true }).fill(target);
    await rollback.getByRole('button', { name: '查看回退影响' }).click();
    await expect(rollback.getByText(/来源 source-a/)).toBeVisible();
    await expect(rollback.getByRole('button', { name: '确认回退并发布' })).toBeDisabled();
    await rollback.getByRole('button', { name: '发起回退复核', exact: true }).click();
    await expect.poll(async () => (await host.status()).pendingApprovals).toBe(1);
    host.approveReview();
    await rollback.getByRole('button', { name: '核验回退审批' }).click();
    await expect(rollback.getByRole('button', { name: '确认回退并发布' })).toBeEnabled();
    for (const mode of ['light', 'dark']) {
      await dashboard.getByTestId('dashboard-theme-trigger').click();
      await dashboard.getByTestId(`dashboard-theme-${mode}`).click();
      await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-theme', mode);
      await expect.poll(() => rollback.getByRole('button', { name: '读取回退审批' }).evaluate(el => getComputedStyle(el).backgroundColor))
        .toBe(mode === 'dark' ? 'rgb(28, 27, 32)' : 'rgb(255, 255, 255)');
      await rollback.scrollIntoViewIfNeeded();
      expect(await dashboard.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await dashboard.screenshot({ path: path.join(evidence, `rollback-${mode}.png`) });
    }
    dashboard.once('dialog', dialog => dialog.accept());
    await rollback.getByRole('button', { name: '确认回退并发布' }).click();
    await expect(rollback.getByText(/回退已发布/)).toBeVisible();
    const result = await host.status();
    expect(result.publications).toBe(3);
    expect(result.currentReleaseId).not.toBe(base); expect(result.currentReleaseId).not.toBe(target);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('role=dashboard'))!.close());
    host.selectIdentity('agent'); await openQuery();
    await query.getByRole('button', { name: / · 退出$/ }).click();
    await expect(query.getByRole('button', { name: '登录', exact: true })).toBeVisible(); await login();
    const shops = query.getByRole('combobox', { name: '当前店铺' });
    await expect(shops.locator('option')).toHaveCount(2); await shops.selectOption('shop-a');
    await expect(shops).toBeEnabled(); await expect(shops).toHaveValue('shop-a');
    await query.getByTestId('question-input').fill('洁面'); await query.getByTestId('search-button').click();
    await expect(query.getByTestId('answer-text-1')).toBeVisible();
    expect((await query.locator('[data-testid^="answer-text-"]').allTextContents()).sort()).toEqual(INTAKE_SYNTHETIC_FAQ.map(f => f.answer).sort());
    expect(await query.evaluate(() => window.customerAgent!.intakeQuery!.selectShop({ shopId: 'shop-b' }))).toMatchObject({ code: 'FORBIDDEN' });
    await query.screenshot({ path: path.join(evidence, 'rollback-ordinary-seat.png') });
    expect(errors).toEqual([]);
    console.info(JSON.stringify({ status: 'PASS', flow: 'rollback-review-publication-ordinary-seat', http: 'actual', postgres: 15,
      target, base, newRelease: result.currentReleaseId, approval: 'independent-manual-synthetic', screenshots: evidence }));
  } finally {
    try { if (app) await closeOwnedElectron(app); }
    finally { await host.close(); rmSync(directory, { recursive: true, force: true }); }
    expect(existsSync(host.root)).toBe(false); expect(existsSync(directory)).toBe(false);
  }
});
