import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchIntakeElectron } from '../support/intake-electron';
import { closeOwnedElectron } from '../support/owned-electron';
import { returnToQueryWindow, waitForFocusedWindow } from '../support/electron-focus';
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
    await returnToQueryWindow(running, query);
    const question = query.getByTestId('question-input');
    const shell = query.getByTestId('query-shell');
    const manual = query.getByRole('button', { name: '手动找流程', exact: true });
    const scope = query.getByRole('button', { name: '查询范围', exact: true });
    const submit = async (text: string) => {
      await question.fill(text);
      await query.getByTestId('search-button').click();
    };
    await question.fill('合成入口');
    const openedLogin = running.waitForEvent('window');
    await question.press('Enter');
    const login = await openedLogin;
    await expect.poll(() => login.url()).toContain('role=login');
    await login.getByRole('button', { name: '飞书登录' }).click();
    await expect.poll(() => query.evaluate(async () => {
      const state = await window.customerAgent!.product!.sessionStatus();
      return state.ok && state.signedIn;
    })).toBe(true);
    await expect(question).toHaveValue('合成入口');
    await expect(question).toBeFocused();
    await waitForFocusedWindow(running, 'query');
    for (const text of ['', '问'.repeat(501)]) {
      await question.fill(text);
      await question.press('Enter');
      await expect(query.getByTestId('validation-error')).toBeInViewport({ ratio: 1 });
      await expect(manual).toBeInViewport({ ratio: 1 });
      await expect(scope).toBeInViewport({ ratio: 1 });
      await expect(shell).toHaveAttribute('data-query-height', '88');
    }
    await scope.click();
    await expect(shell).toHaveAttribute('data-layout-ready', 'true');
    await expect(scope).toBeFocused();
    const shop = query.getByRole('combobox', { name: '当前店铺', exact: true });
    await shop.selectOption('shop-a');
    await expect(shop).toHaveValue('shop-a');

    const candidates = query.getByTestId('sop-candidates').getByRole('button');
    const faq = query.getByTestId('script-card-1');
    await submit('合成入口');
    await expect(faq).toBeVisible();
    await expect(candidates).toHaveCount(2);
    const matched = query.getByRole('region', { name: '办理流程' });
    const viewport = await matched.evaluate(entry => {
      const pane = entry.closest('.result-pane');
      const rect = (element: Element | null) => element?.getBoundingClientRect().toJSON();
      return { viewport: [window.innerWidth, window.innerHeight], scrollTop: pane?.scrollTop,
        pane: rect(pane), entry: rect(entry), actions: [...entry.querySelectorAll('button')].map(rect) };
    });
    await test.info().attach('first-result-viewport', { body: JSON.stringify(viewport), contentType: 'application/json' });
    expect(viewport.scrollTop).toBe(0);
    await expect(candidates.first()).toBeInViewport({ ratio: 1 });
    await expect(candidates.last()).toBeInViewport({ ratio: 1 });
    await expect(manual).toBeInViewport({ ratio: 1 });
    const [capsuleBounds, matchedBounds, filterBounds] = await Promise.all([
      query.locator('.query-capsule').boundingBox(),
      matched.boundingBox(),
      query.getByTestId('intake-query-filters').boundingBox(),
    ]);
    if (!capsuleBounds || !matchedBounds || !filterBounds) throw new Error('Expected Query, SOP matches and expanded filters');
    const gap = matchedBounds.y - (capsuleBounds.y + capsuleBounds.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(4);
    expect(matchedBounds.y + matchedBounds.height).toBeLessThanOrEqual(filterBounds.y);
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
    await expect(query.getByText('流程窗口已打开。')).toBeVisible();
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
    await expect(query.getByText('没有匹配的 FAQ 话术，可从上方选择流程办理。')).toBeVisible();
    await expect(query.getByTestId('no-hit')).toHaveCount(0);
    await expect(confirmation).toBeChecked();

    await submit('洁面频次');
    await expect(faq).toBeVisible();
    await expect(candidates).toHaveCount(0);
    await submit('雪绒');
    await expect(query.getByTestId('no-hit')).toBeVisible();
    await expect(candidates).toHaveCount(0);

    await submit('合成入口');
    await expect(faq).toBeVisible();
    await expect(candidates).toHaveCount(2);
    const blocked = query.getByRole('button', { name: /品质售后SOP/ });
    const available = query.getByRole('button', { name: /税收相关规则/ });
    const { rows: [requiredMedia] } = await admin.query<{ payload_object_id: string }>(`
      SELECT object.payload_object_id FROM content_intake.sop_graph_release_media media
      JOIN public.content_current current ON current.current_release_id=media.release_id
      JOIN content_intake.sop_graph_media_bindings binding USING
        (candidate_id,candidate_version,source_id,flow_id,owner_kind,owner_id,resource_id,object_id)
      JOIN content_intake.sop_media_objects object ON object.media_object_id=media.object_id
      WHERE media.source_id='source-resource' AND binding.required
      ORDER BY object.payload_object_id LIMIT 1`);
    if (!requiredMedia) throw new Error('Expected required media for the synthetic candidate');
    const mediaFile = path.join(host.root, 'objects', 'objects', requiredMedia.payload_object_id);
    const hiddenFile = `${mediaFile}.synthetic-missing`;
    renameSync(mediaFile, hiddenFile);
    try {
      await blocked.click();
      await expect(query.getByText('此流程暂不可用。')).toBeVisible();
      await expect(blocked).toBeDisabled();
      await expect(available).toBeEnabled();
      await expect(query.getByTestId('copy-button-1')).toBeEnabled();
      expect(await counts()).toEqual({ selections: 1, openings: 1 });

      await available.click();
      await expect(query.getByText('流程窗口已打开。')).toBeVisible();
      await expect.poll(() => sopWindows().length).toBe(2);
      const second = sopWindows().find(page => page !== sop);
      if (!second) throw new Error('Expected a window for the available candidate');
      await expect(second.getByTestId('sop-unified-shell')).toHaveAttribute('data-state', 'ready');
    } finally { renameSync(hiddenFile, mediaFile); }

    await returnToQueryWindow(running, query);
    await submit('合成入口');
    await expect(blocked).toBeEnabled();
    await fixture.facts(fixture.qualityCase, '品质售后SOP', 1);
    await blocked.click();
    await expect(query.getByText('此流程暂不可用。', { exact: true })).toBeVisible();
    await expect(blocked).toBeDisabled();
    await expect(available).toBeEnabled();
    await expect(faq).toBeVisible();
    await available.click();
    await expect.poll(counts).toEqual({ selections: 3, openings: 3 });
    await returnToQueryWindow(running, query);

    const optionalCase = await fixture.publish({ sourceId: 'source-optional', validImages: true });
    await fixture.facts(optionalCase, '少错破SOP');
    await submit('合成入口');
    const disclosure = matched.getByText('选择办理流程（3）', { exact: true });
    await expect(disclosure).toBeVisible();
    await expect(manual).toHaveCount(1);
    await expect(candidates).toHaveCount(0);
    const clipboardProbe = '__sopCandidateShortcutClipboard';
    await running.evaluate(({ clipboard }, key) => {
      const probe = { writes: 0 };
      clipboard.writeText = () => { probe.writes += 1; };
      Reflect.set(globalThis, key, probe);
    }, clipboardProbe);
    await disclosure.press('1');
    await expect(query.getByTestId('toast')).toHaveCount(0);
    await disclosure.press('Enter');
    await expect(disclosure).toBeFocused();
    await expect(candidates).toHaveText([
      /（品质售后SOP）$/, /（少错破SOP）$/, /（税收相关规则）$/,
    ]);
    expect(await running.evaluate((_, key) => Reflect.get(globalThis, key)?.writes, clipboardProbe)).toBe(0);
    expect(await counts()).toEqual({ selections: 3, openings: 3 });
    await query.screenshot({ path: test.info().outputPath('faq-and-three-sops.png') });
    const resize = query.getByRole('separator', { name: '调整查询窗宽度', exact: true });
    for (let width = 576; width >= 360; width -= 24) {
      await resize.press('Shift+ArrowLeft');
      await expect(resize).toHaveAttribute('aria-valuenow', String(width));
    }
    await expect(disclosure).toBeInViewport({ ratio: 1 });
    await expect(manual).toBeInViewport({ ratio: 1 });

    await fixture.facts(optionalCase, '品质售后SOP', 1);
    await submit('合成入口');
    await expect(faq).toBeVisible();
    await expect.poll(async () => (await admin.query(
      "SELECT count(*)::int AS n FROM w5_sop_candidate_draft.discovery WHERE status='ambiguous'",
    )).rows[0].n).toBe(1);
    await expect(candidates).toHaveCount(0);
    await expect(query.locator('[data-sop-candidates]')).toHaveCount(0);
    await expect(manual).toBeVisible();
    await expect(disclosure).toHaveCount(0);
    expect(await counts()).toEqual({ selections: 3, openings: 3 });
  } finally {
    try { if (app) await closeOwnedElectron(app); }
    finally { try { await host.close(); } finally { rmSync(directory, { recursive: true, force: true }); } }
  }
});
