import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchIntakeElectron } from '../support/intake-electron';
import { closeOwnedElectron } from '../support/owned-electron';
import { waitForFocusedWindow } from '../support/electron-focus';
import { createSopCandidateDesktopFixture } from '../support/sop-v12-normal-host';

test('one FAQ submission discovers SOPs and only a chosen candidate opens a case', async () => {
  test.skip(process.env.CUSTOMER_AGENT_SOP_CANDIDATES_E2E !== '1', 'Requires the isolated PG15 and Electron fixture');
  test.setTimeout(120_000);
  const fixture = await createSopCandidateDesktopFixture();
  const { host, admin } = fixture;
  const directory = mkdtempSync(path.join(tmpdir(), 'sop-candidates-electron-'));
  let app: ElectronApplication | undefined;
  const counts = async () => (await admin.query(`SELECT
    (SELECT count(*)::int FROM content_intake.sop_query_leases) AS selections,
    (SELECT count(*)::int FROM content_intake.sop_active_uses) AS openings`)).rows[0];
  try {
    app = await launchIntakeElectron({ desktopRoot: fileURLToPath(new URL('../..', import.meta.url)),
      userDataDirectory: directory, evidenceDirectory: test.info().outputDir,
      apiOrigin: host.apiOrigin, identityOrigin: host.identityOrigin, sopCandidates: {
        sopContractSet: fixture.desktopProfile.sopContractSet, sopCandidateContractSet: fixture.desktopProfile.sopCandidateContractSet,
      } });
    const running = app;
    const sopWindows = () => running.windows().filter(page => page.url().includes('role=sop'));
    await expect.poll(() => running.windows().some(page => page.url().includes('role=query'))).toBe(true);
    const query = running.windows().find(page => page.url().includes('role=query'))!;
    await running.evaluate(({ app: native }) => native.focus({ steal: true }));
    await query.evaluate(() => window.customerAgent!.openSearch());
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await waitForFocusedWindow(running, 'query');
    const question = query.getByTestId('question-input');
    const submit = async (text: string) => {
      await question.fill(text);
      await query.getByTestId('search-button').click();
    };
    await query.getByRole('button', { name: '登录', exact: true }).click();
    await expect.poll(() => running.windows().some(page => page.url().includes('role=login'))).toBe(true);
    const login = running.windows().find(page => page.url().includes('role=login'))!;
    await login.getByRole('button', { name: '飞书登录' }).click();
    await expect.poll(() => query.evaluate(async () => {
      const state = await window.customerAgent!.product!.sessionStatus();
      return state.ok && state.signedIn;
    })).toBe(true);
    await query.getByRole('button', { name: '筛选', exact: true }).click();
    const shop = query.getByRole('combobox', { name: '当前店铺', exact: true });
    await shop.selectOption('shop-a');
    await expect(shop).toHaveValue('shop-a');

    const candidates = query.getByTestId('sop-candidates').getByRole('button');
    const faq = query.getByTestId('script-card-1');
    await submit('合成入口');
    await expect(faq).toBeVisible();
    await expect(candidates).toHaveCount(2);
    expect(await counts()).toEqual({ selections: 0, openings: 0 });
    expect(sopWindows()).toHaveLength(0);
    await query.screenshot({ path: test.info().outputPath('faq-and-sop.png') });

    // Both click events can arrive before React commits its disabled state.
    fixture.loseNextResponse('query');
    await candidates.first().evaluate(button => {
      if (!(button instanceof HTMLButtonElement)) throw new Error('SOP candidate must be a button');
      button.click(); button.click();
    });
    await expect(query.getByText('流程没有打开。请再次点击流程名称重试。')).toBeVisible();
    expect(await counts()).toEqual({ selections: 1, openings: 0 });
    expect(sopWindows()).toHaveLength(0);
    fixture.loseNextResponse('open');
    await candidates.first().click();
    await expect.poll(() => sopWindows().length).toBe(1);
    const sop = sopWindows()[0]!;
    await expect(sop.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'paused');
    await sop.getByRole('button', { name: '重新确认并继续' }).click();
    await expect(sop.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'ready');
    await expect(sop.getByText('合成对客原文 A\n版本 1', { exact: true })).toBeVisible();
    expect(await counts()).toEqual({ selections: 1, openings: 1 });
    const confirmation = sop.getByRole('checkbox', { name: '1. 合成确认 confirm-a', exact: true });
    await confirmation.click();
    await expect(confirmation).toBeChecked();
    await query.evaluate(() => window.customerAgent!.openSearch());
    await submit('鹭鸶');
    await expect(candidates).toHaveCount(2);
    await expect(faq).toHaveCount(0);
    await expect(query.getByText('没有匹配的 FAQ 话术，可选择下方 SOP 办理。')).toBeVisible();
    await expect(query.getByTestId('no-hit')).toHaveCount(0);
    await expect(confirmation).toBeChecked();

    await submit('洁面频次');
    await expect(faq).toBeVisible();
    await expect(candidates).toHaveCount(0);
    await submit('雪绒');
    await expect(query.getByTestId('no-hit')).toBeVisible();
    await expect(candidates).toHaveCount(0);

    await fixture.facts(await fixture.publish({ sourceId: 'source-optional', validImages: true }), '品质售后SOP');
    await submit('合成入口');
    await expect(faq).toBeVisible();
    await expect.poll(async () => (await admin.query(
      "SELECT count(*)::int AS n FROM w5_sop_candidate_draft.discovery WHERE status='ambiguous'",
    )).rows[0].n).toBe(1);
    await expect(candidates).toHaveCount(0);
    expect(await counts()).toEqual({ selections: 1, openings: 1 });
  } finally {
    try { if (app) await closeOwnedElectron(app); }
    finally { try { await host.close(); } finally { rmSync(directory, { recursive: true, force: true }); } }
  }
});
