import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { closeOwnedElectron } from '../support/owned-electron';
import { launchIntakeElectron } from '../support/intake-electron';

const domains = { product: '产品', campaign: '活动', presale: '售前', aftersale: '售后' } as const;
for (const [domain, label] of Object.entries(domains) as [keyof typeof domains, string][]) {
  test(`unified workspace reads the qualified ${domain} publication without legacy content adapters or Query selection coupling`, async () => {
    test.skip(process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E !== '1', 'Explicit synthetic PG15/Electron gate');
    test.setTimeout(120_000);
    const { parseContractSchema } = await import('../../../../packages/contracts/dist/index.js');
    const { createIntakeSyntheticHost, INTAKE_SYNTHETIC_FAQ } = await import('../../../api/tests/support/intake-synthetic-host.ts');
    const host = await createIntakeSyntheticHost({ profile: 'purpose-runtime', domain });
    const directory = mkdtempSync(path.join(tmpdir(), 'intake-workspace-electron-'));
    const desktopRoot = fileURLToPath(new URL('../..', import.meta.url));
    const evidence = path.resolve(desktopRoot, '../../.gstack/intake-workspace', `${domain}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    mkdirSync(evidence, { recursive: true });
    let app: ElectronApplication | undefined;
    const errors: string[] = [];
    async function json(response: Response) {
      const value: unknown = await response.json(); expect(response.ok, JSON.stringify(value)).toBe(true); return value;
    }
    const url = `/v1/intake/candidates/${host.candidate.key.candidateId}/versions/${host.candidate.key.version}`;
    const post = async (suffix: string, body: unknown) => json(await host.requestAs('enabler', `${url}/${suffix}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
    try {
      const key = host.candidate.key;
      // The producer uses real HTTP and the formal restricted business pool.
      // This case tests the published downstream artifact, not new publication UI.
      await post('source-confirmation', { operationId: 'workspace-source', key, expectedEvidenceVersion: 0,
        confirmedVersionKind: 'opaque', confirmedVersionValue: 'synthetic-workspace-export', acquisition: 'controlled-synthetic-export',
        objectSha256: host.object.sha256, reason: '合成工作台验收来源' });
      await post('quality/freeze', { operationId: 'workspace-freeze', key });
      const quality = parseContractSchema('IntakeQualityStatus', await json(await host.requestAs('enabler', `${url}/quality?digest=${key.digest}`)));
      const samples = parseContractSchema('IntakeQualitySamplePage', await json(await host.requestAs('enabler', `${url}/quality/samples?${new URLSearchParams({ digest: key.digest, viewHash: quality.viewHash, phase: 'initial', limit: '100' })}`)));
      expect(samples.nextCursor).toBeNull(); expect(samples.items).toHaveLength(3);
      await post('quality/checks', { operationId: 'workspace-checks', key, phase: 'initial',
        checks: samples.items.map(row => ({ scriptId: row.scriptId, contentHash: row.contentHash, defect: false, reason: '' })) });
      const receipt = parseContractSchema('IntakeReceipt', await post('publish', { operationId: 'workspace-publish', key,
        baseReleaseId: 'rel_native_base', sourceEvidenceVersion: 1, confirmed: true, title: '合成工作台发布', summary: domain }));
      expect(receipt.state).toBe('published');
      host.selectIdentity('agent');
      app = await launchIntakeElectron({ desktopRoot, userDataDirectory: directory,
        apiOrigin: host.apiOrigin, identityOrigin: host.identityOrigin, evidenceDirectory: evidence });
      const observe = (page: import('@playwright/test').Page) => page.on('pageerror', error => errors.push(error.message));
      app.on('window', observe); app.windows().forEach(observe);
      await expect.poll(() => app!.windows().some(w => w.url().includes('role=query'))).toBe(true);
      const query = app.windows().find(w => w.url().includes('role=query'))!;
      await query.waitForFunction(() => Boolean(window.customerAgent?.intakeQuery));
      await app.evaluate(({ app }) => app.focus({ steal: true }));
      await query.evaluate(() => window.customerAgent!.openSearch());
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
      await query.getByRole('button', { name: '登录', exact: true }).click();
      await expect.poll(() => app!.windows().some(w => w.url().includes('role=login'))).toBe(true);
      await app.windows().find(w => w.url().includes('role=login'))!.getByRole('button', { name: '飞书登录' }).click();
      await expect.poll(() => query.evaluate(async () => { const view = await window.customerAgent!.product!.sessionStatus(); return view.ok && view.signedIn; })).toBe(true);
      expect(await query.evaluate(() => window.customerAgent!.openDashboard())).toMatchObject({ ok: true });
      await expect.poll(() => app!.windows().some(w => w.url().includes('role=dashboard'))).toBe(true);
      const dashboard = app.windows().find(w => w.url().includes('role=dashboard'))!;
      const knowledgeNav = dashboard.getByTestId('nav-content');
      await knowledgeNav.click();
      await expect(knowledgeNav).toHaveAttribute('aria-selected', 'true');
      await expect(dashboard.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'content');
      await expect(dashboard.getByRole('region', { name: '知识库', exact: true })).toBeVisible();
      await dashboard.getByTestId('nav-overview').click();
      await expect(dashboard.getByTestId('nav-overview')).toHaveAttribute('aria-selected', 'true');
      await expect(dashboard.getByTestId('module-overview')).toBeVisible();
      await dashboard.getByTestId('nav-sop').click();
      await expect(dashboard.getByTestId('nav-sop')).toHaveAttribute('aria-selected', 'true');
      await expect(dashboard.getByTestId('module-sop')).toBeVisible();
      await expect(dashboard.getByTestId('dashboard-content')).not.toContainText('未接入');
      await dashboard.getByTestId('nav-wording').click();
      const library = dashboard.getByRole('region', { name: '可用话术目录', exact: true });
      const shops = library.getByRole('combobox', { name: '目录店铺', exact: true });
      await expect(shops).toBeEnabled();
      await shops.click();
      const shopOption = dashboard.getByRole('option', { name: '合成示例店', exact: true });
      await expect(shopOption).toHaveCount(1);
      await shopOption.click();
      const selectedShop = shops.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]');
      await expect(selectedShop).toContainText('合成示例店');
      // Opening Dashboard intentionally parks Query and cancels its old results.
      // Acquire after that lifecycle boundary to isolate directory refresh effects.
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');
      expect(await query.evaluate(() => window.customerAgent!.intakeQuery!.selectShop({ shopId: 'shop-a' }))).toMatchObject({ ok: true });
      const queryRows = await query.evaluate(() => window.customerAgent!.intakeQuery!.search({ queryText: '洁面', contextId: crypto.randomUUID() }));
      expect(queryRows.ok).toBe(true);
      if (!queryRows.ok) throw new Error('Expected qualified Query rows');
      expect(await query.evaluate(key => window.customerAgent!.intakeQuery!.copy({ key }), queryRows.rows[0]!.key)).toMatchObject({ ok: true, copied: true });
      await library.getByRole('button', { name: '刷新可用资料', exact: true }).click();
      await library.getByRole('tab', { name: label, exact: true }).click();
      const scripts = library.getByRole('table', { name: '可用话术', exact: true });
      await expect(scripts.getByRole('row')).toHaveCount(4);
      for (const faq of INTAKE_SYNTHETIC_FAQ) await expect(library.getByText(faq.answer, { exact: true })).toBeVisible();
      await expect(library.getByRole('status')).toContainText('当前可用 3 条');
      await expect(library.getByRole('button', { name: /复制|下架|导出/ })).toHaveCount(0);
      for (const other of Object.values(domains).filter(value => value !== label)) {
        await library.getByRole('tab', { name: other, exact: true }).click();
        await expect(scripts.getByRole('row')).toHaveCount(2);
        await expect(scripts.getByText('当前条件下没有此类可用话术。')).toBeVisible();
      }
      await library.getByRole('tab', { name: label, exact: true }).click();
      const nativeDashboard = await app.browserWindow(dashboard);
      await nativeDashboard.evaluate(win => win.setSize(980, 680));
      for (const theme of ['light', 'dark'] as const) {
        await dashboard.getByTestId('dashboard-theme-trigger').click();
        await dashboard.getByTestId(`dashboard-theme-${theme}`).click();
        await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-theme', theme);
        // Observe settled shared theme tokens, not a screenshot mid-transition.
        await expect.poll(() => selectedShop.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(theme === 'dark' ? 'rgb(18, 17, 19)' : 'rgb(253, 252, 253)');
        if (theme === 'dark') await expect.poll(() => library.getByRole('tab', { name: label, exact: true }).evaluate(el => getComputedStyle(el).color)).toBe('rgb(110, 86, 207)');
        expect(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth
          && document.querySelector<HTMLElement>('.dashboard-content')!.scrollWidth <= document.querySelector<HTMLElement>('.dashboard-content')!.clientWidth)).toBe(true);
        await dashboard.screenshot({ path: path.join(evidence, `library-${theme}.png`) });
      }
      await expect(library.getByRole('button', { name: /安装|下载|已读/ })).toHaveCount(0);
      await dashboard.getByTestId('nav-overview').click();
      await expect(dashboard.getByTestId('nav-overview')).toHaveAttribute('aria-selected', 'true');
      await expect(dashboard.getByTestId('module-overview')).toBeVisible();
      await dashboard.screenshot({ path: path.join(evidence, 'current-version.png') });
      // Directory refresh/navigation must leave Query's original qualification
      // intact; its still-valid opaque key remains usable in its own window.
      const retainedCopy = await query.evaluate(key => window.customerAgent!.intakeQuery!.copy({ key }), queryRows.rows[0]!.key);
      expect(retainedCopy, JSON.stringify(retainedCopy)).toMatchObject({ ok: true, copied: true });
      await host.revokeSyntheticQuery();
      await dashboard.getByTestId('nav-wording').click();
      await library.getByRole('button', { name: '刷新可用资料', exact: true }).click();
      for (const faq of INTAKE_SYNTHETIC_FAQ) await expect(library.getByText(faq.answer, { exact: true })).toHaveCount(0);
      await expect(library.getByText('请选择有权查看的店铺；没有可用店铺时请核对身份与范围。')).toBeVisible();
      expect(await query.evaluate(() => window.customerAgent!.intakeQuery!.search({ queryText: '洁面', contextId: crypto.randomUUID() }))).toMatchObject({ ok: false });
      expect(await query.evaluate(key => window.customerAgent!.intakeQuery!.copy({ key }), queryRows.rows[0]!.key)).toMatchObject({ ok: false });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('role=dashboard'))!.close());
      await expect.poll(() => app!.windows().some(w => w.url().includes('role=dashboard'))).toBe(false);
      const status = await host.status();
      const legacyRequests = status.requests.filter(p => /^\/v1\/(announce|content|iteration|metrics|software)(\/|\?|$)/.test(p));
      expect(legacyRequests, JSON.stringify(status.requests)).toEqual([]);
      expect(status.requests).toContain('/v1/sop/catalog');
      expect(status.requests).not.toContain('/v1/events/usage');
      expect(status.approvalFacts).toBe(0); expect(status.directPublications).toBe(1); expect(errors).toEqual([]);
      console.info(JSON.stringify({ status: 'PASS', domain, flow: 'restricted-publication-to-unified-workspace', screenshots: evidence, legacyContentAdapters: false }));
    } finally {
      try { if (app) await closeOwnedElectron(app); }
      finally { try { await host.close(); } finally { rmSync(directory, { recursive: true, force: true }); } }
    }
  });
}
