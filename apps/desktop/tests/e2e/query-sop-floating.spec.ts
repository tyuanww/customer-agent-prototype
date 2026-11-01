import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { launchSopElectron } from '../support/sop-electron';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
test('independent SOP windows retain progress while Query searches, folds and attaches a task', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-floating-'));
  const app = await launchSopElectron({ desktopRoot: root, userDataDirectory: dir });
  const originalClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const query = app.windows().find(page => page.url().includes('role=query'));
    const fox = app.windows().find(page => page.url().includes('role=fox'));
    if (!query || !fox) throw new Error('Query missing');
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.evaluate(() => window.customerAgent!.sopWindow!.open('missing-item-demo'));
    await expect(query.getByRole('region', { name: 'SOP 流程' })).toBeVisible();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
    await query.getByRole('checkbox', { name: '已核对订单应收数量' }).click();
    await expect(query.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
    await query.getByRole('button', { name: '返回搜索', exact: true }).click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-workspace-view', 'query-home');
    await query.getByRole('button', { name: '改名', exact: true }).click();
    await query.getByRole('button', { name: /^修改 少件处理 #1 的昵称/ }).click();
    await expect(query.getByRole('region', { name: 'SOP 流程' })).toHaveCount(0);
    await query.getByRole('textbox', { name: '待办昵称' }).fill('合成客户甲');
    await query.getByRole('button', { name: '保存昵称', exact: true }).click();
    await query.getByRole('button', { name: /^合成客户甲/ }).click();
    await query.getByRole('button', { name: '独立悬浮', exact: true }).click();
    await expect.poll(() => app.windows().filter(page => page.url().includes('role=sop-floating')).length).toBe(1);
    const floating = app.windows().find(page => page.url().includes('role=sop-floating'));
    if (!floating) throw new Error('Floating missing');
    await expect(floating.getByLabel('合成客户甲', { exact: true })).toBeVisible();
    const floatingBounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(win => win.webContents.getURL().includes('role=sop-floating'))!.getBounds());
    const beforeResize = await floatingBounds();
    const eastGrip = await floating.locator('.sop-resize-e').boundingBox();
    if (!eastGrip) throw new Error('Floating east resize grip missing');
    await floating.mouse.move(eastGrip.x + eastGrip.width / 2, eastGrip.y + eastGrip.height / 2);
    await floating.mouse.down();
    await floating.mouse.move(eastGrip.x + eastGrip.width / 2 - 70, eastGrip.y + eastGrip.height / 2, { steps: 4 });
    await floating.mouse.up();
    await expect.poll(async () => (await floatingBounds()).width).toBeLessThan(beforeResize.width);
    const sharedSize = await floatingBounds();
    await expect(floating.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
    await expect(query.getByRole('region', { name: 'SOP 流程' })).toHaveCount(0);
    await floating.getByRole('button', { name: '更多操作' }).click();
    await floating.getByRole('menuitem', { name: '显示查询', exact: true }).click();
    await query.getByTestId('question-input').fill('澄芽氨基酸洁面怎么用');
    await query.getByTestId('search-button').click();
    await expect(query.getByTestId('copy-button-1')).toBeVisible();
    const resultText = await query.getByRole('region', { name: '候选话术' }).innerText();
    await floating.getByRole('button', { name: '更多操作' }).click();
    await floating.getByRole('menuitem', { name: '显示查询', exact: true }).click();
    await expect(query.getByRole('region', { name: '候选话术' })).toHaveText(resultText, { useInnerText: true });
    await expect(floating.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
    await query.getByTestId('copy-button-1').click();
    await expect(query.getByTestId('copy-button-1')).toContainText('已复制');
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('澄芽氨基酸洁面');
    await expect(floating.getByText('步骤 1', { exact: true })).toBeVisible();
    await expect(floating.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
    await query.evaluate(() => window.customerAgent!.sopWindow!.open('allergy-aftersale-demo'));
    await expect(query.getByRole('heading', { name: '核实凭证' })).toBeVisible();
    await query.getByRole('button', { name: '独立悬浮', exact: true }).click();
    await expect.poll(() => app.windows().filter(page => page.url().includes('role=sop-floating')).length).toBe(2);
    const allergy = app.windows().find(page => page.url().includes('role=sop-floating') && page !== floating);
    if (!allergy) throw new Error('Second floating window missing');
    await expect(allergy.getByRole('heading', { name: '核实凭证' })).toBeVisible();
    expect(await floatingBounds()).toMatchObject({ width: sharedSize.width, height: sharedSize.height });
    await allergy.getByRole('button', { name: '更多操作' }).click();
    await allergy.getByRole('menuitem', { name: '显示查询', exact: true }).click();
    await query.getByRole('button', { name: /^合成客户甲/ }).click();
    await expect(floating.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
    await floating.getByRole('button', { name: '收起', exact: true }).click();
    await expect(floating.getByRole('button', { name: '展开流程', exact: true })).toBeVisible();
    await expect(allergy.getByRole('heading', { name: '核实凭证' })).toBeVisible();
    await query.getByRole('button', { name: /^合成客户甲/ }).click();
    await expect(floating.getByRole('region', { name: 'SOP 流程' })).toBeVisible();
    await query.getByTestId('capsule-fox').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('role=sop-floating'))?.isVisible())).toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('role=sop-floating'))?.close());
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('role=sop-floating'))?.isVisible())).toBe(false);
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.getByRole('button', { name: /^合成客户甲/ }).click();
    await expect(floating.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
    await query.getByTestId('capsule-fox').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');
    await floating.getByRole('button', { name: '合回查询', exact: true }).click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
    await expect(query.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('role=query'))!.getBounds())).toMatchObject({ width: sharedSize.width, height: sharedSize.height });
    expect(await floating.evaluate(() => 'customerAgent' in window)).toBe(false);
    await query.getByRole('button', { name: '返回搜索', exact: true }).click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-workspace-view', 'query-home');
    await expect(query.getByRole('region', { name: '候选话术' })).toHaveCount(0);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('role=query'))!.getBounds().height)).toBeLessThan(sharedSize.height);
    await query.getByRole('button', { name: /^合成客户甲/ }).click();
    await expect(query.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
    if (process.env.CUSTOMER_AGENT_TEST_OUTPUT) {
      fs.mkdirSync(process.env.CUSTOMER_AGENT_TEST_OUTPUT, { recursive: true });
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
      await query.screenshot({ path: path.join(process.env.CUSTOMER_AGENT_TEST_OUTPUT, 'attached-nickname.png') });
    }
  } finally { await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), originalClipboard); await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('compact waiting tasks retain readable status and step numbers across window widths', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-task-layout-'));
  const app = await launchSopElectron({ desktopRoot: root, userDataDirectory: dir });
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const query = app.windows().find(page => page.url().includes('role=query'));
    const fox = app.windows().find(page => page.url().includes('role=fox'));
    if (!query || !fox) throw new Error('Query missing');
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    for (let index = 0; index < 5; index += 1) {
      await query.evaluate(() => window.customerAgent!.sopWindow!.open('missing-item-demo'));
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
      await query.getByRole('button', { name: '更多操作', exact: true }).click();
      await query.getByRole('menuitem', { name: '等待内部协助', exact: true }).click();
      await query.getByRole('button', { name: '返回搜索', exact: true }).click();
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-workspace-view', 'query-home');
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
    }
    for (const width of [600, 521, 420]) {
      await app.evaluate(({ BrowserWindow }, targetWidth) => {
        const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('role=query'));
        if (!win) throw new Error('Query missing');
        win.setBounds({ width: targetWidth });
      }, width);
      await expect.poll(() => query.evaluate(() => window.innerWidth)).toBe(width);
      const details = query.locator('.query-sop-task-detail');
      await expect(details).toHaveCount(5);
      for (const detail of await details.all()) {
        expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth), `waiting status fits at ${width}px`).toBe(true);
      }
      const rows = query.locator('.query-sop-task-row');
      const first = await rows.nth(0).boundingBox();
      const third = await rows.nth(2).boundingBox();
      const fifth = await rows.nth(4).boundingBox();
      if (!first || !third || !fifth) throw new Error('Task bounds missing');
      if (width === 600) expect(third.y).toBe(first.y);
      if (width === 420) expect(third.y).toBeGreaterThan(first.y);
      expect(fifth.y).toBeGreaterThan(first.y);
    }
  } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
