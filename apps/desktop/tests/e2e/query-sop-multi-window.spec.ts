import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchSopElectron } from '../support/sop-electron';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function stable(query: Page, view: 'sop' | 'query-home') {
  await expect(query.getByTestId('query-shell')).toHaveAttribute('data-workspace-view', view);
  await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
}

async function floatingPages(app: ElectronApplication, count: number) {
  await expect.poll(() => app.windows().filter(page => page.url().includes('role=sop-floating')).length).toBe(count);
  return app.windows().filter(page => page.url().includes('role=sop-floating'));
}

test('two SOP windows keep independent progress while ordinary query remains usable', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-multi-window-'));
  const app = await launchSopElectron({ desktopRoot, userDataDirectory: userData, archive: process.env.CUSTOMER_AGENT_SOP_E2E_ENTRY });
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const query = app.windows().find(page => page.url().includes('role=query'));
    const fox = app.windows().find(page => page.url().includes('role=fox'));
    if (!fox || !query) throw new Error('Overlay windows missing');

    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.getByTestId('question-input').fill('用了露芷面膜过敏了怎么办');
    await query.getByTestId('search-button').click();
    await query.getByTestId('sop-query-open-allergy-aftersale-demo').click();
    await stable(query, 'sop');
    await query.getByRole('button', { name: '独立悬浮', exact: true }).click();
    const [allergy] = await floatingPages(app, 1);
    await expect(allergy.getByRole('heading', { name: '核实凭证' })).toBeVisible();
    await allergy.getByRole('button', { name: /已给照片/ }).click();
    await expect(allergy.getByRole('heading', { name: '核实不适情况' })).toBeVisible();

    await allergy.getByRole('button', { name: '更多操作' }).click();
    await allergy.getByRole('menuitem', { name: '显示查询', exact: true }).click();
    await query.getByTestId('question-input').fill('少件了，没收到全部');
    await query.getByTestId('search-button').click();
    await query.getByRole('button', { name: '进入少件处理', exact: true }).click();
    await expect(query.getByRole('heading', { name: '核对订单与实收数量' })).toBeVisible({ timeout: 5_000 });
    await query.getByRole('button', { name: '独立悬浮', exact: true }).click();
    const [first, missing] = await floatingPages(app, 2);
    await expect(first.getByRole('heading', { name: '核实不适情况' })).toBeVisible();
    await expect(missing.getByRole('heading', { name: '核对订单与实收数量' })).toBeVisible();

    await missing.getByRole('checkbox', { name: '已核对订单应收数量' }).click();
    await first.getByRole('button', { name: /信息不足/ }).click();
    await expect(first.getByRole('heading', { name: '补充不适信息' })).toBeVisible();
    await expect(missing.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();

    const windowBounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .filter(window => window.webContents.getURL().includes('role=sop-floating')).map(window => window.getBounds()));
    await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('role=sop-floating'));
      if (!window) throw new Error('Floating window missing');
      const area = screen.getDisplayMatching(window.getBounds()).workArea;
      if (area.width < 800 || area.height < 520) throw new Error('Display is too small for the shared resize test');
      window.setBounds({ ...window.getBounds(), x: area.x + 20, y: area.y + 20 });
    });
    const grip = await first.locator('.sop-resize-e').boundingBox();
    if (!grip) throw new Error('Floating east resize grip missing');
    await first.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await first.mouse.down();
    await first.mouse.move(grip.x + grip.width / 2 + 160, grip.y + grip.height / 2, { steps: 4 });
    await first.mouse.up();
    await expect.poll(async () => {
      const [a, b] = await windowBounds();
      return a.width > 580 && a.width === b.width;
    }).toBe(true);
    const sharedWidth = (await windowBounds())[0].width;
    await first.getByRole('button', { name: '收起', exact: true }).click();
    await expect(first.getByRole('button', { name: '展开流程', exact: true })).toBeVisible();
    await expect(missing.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
    await first.bringToFront();
    await first.getByRole('button', { name: '展开流程', exact: true }).focus();
    await first.getByRole('button', { name: '展开流程', exact: true }).press('Enter');
    await expect(first.getByRole('heading', { name: '补充不适信息' })).toBeVisible();
    await expect.poll(async () => (await windowBounds()).map(bounds => bounds.width)).toEqual([sharedWidth, sharedWidth]);
    await expect(missing.getByRole('heading', { name: '核对订单与实收数量' })).toBeVisible();

    await first.getByRole('button', { name: '更多操作' }).click();
    await first.getByRole('menuitem', { name: '显示查询', exact: true }).click();
    await query.getByTestId('question-input').fill('澄芽氨基酸洁面怎么用');
    await query.getByTestId('search-button').click();
    await expect(query.getByTestId('copy-button-1')).toBeVisible();
    await expect(first.getByRole('heading', { name: '补充不适信息' })).toBeVisible();
    await expect(missing.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
  } finally {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('showing Query from one float preserves a different active task and its draft', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-show-query-'));
  const app = await launchSopElectron({ desktopRoot, userDataDirectory: userData, archive: process.env.CUSTOMER_AGENT_SOP_E2E_ENTRY });
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const query = app.windows().find(page => page.url().includes('role=query'));
    const fox = app.windows().find(page => page.url().includes('role=fox'));
    if (!fox || !query) throw new Error('Overlay windows missing');
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.getByTestId('question-input').fill('澄芽氨基酸洁面怎么用');
    await query.getByTestId('search-button').click();
    await expect(query.getByTestId('copy-button-1')).toBeVisible();

    await query.evaluate(() => window.customerAgent!.sopWindow!.open('allergy-aftersale-demo'));
    await stable(query, 'sop');
    await query.getByRole('button', { name: '独立悬浮' }).click();
    const [allergy] = await floatingPages(app, 1);
    await expect(allergy.getByRole('button', { name: '更多操作' })).toBeEnabled();
    await allergy.getByRole('button', { name: '更多操作' }).click();
    await allergy.getByRole('menuitem', { name: '显示查询' }).click();
    await query.getByTestId('question-input').fill('澄芽氨基酸洁面怎么用');
    await query.getByTestId('search-button').click();
    await expect(query.getByTestId('copy-button-1')).toBeVisible();
    await query.evaluate(() => window.customerAgent!.sopWindow!.open('missing-item-demo'));
    await expect(query.getByRole('heading', { name: '核对订单与实收数量' })).toBeVisible();
    await query.getByRole('button', { name: '编辑流程名称' }).click();
    await query.getByRole('textbox', { name: '流程名称' }).fill('尚未保存的合成昵称');
    await allergy.getByRole('button', { name: '更多操作' }).click();
    await allergy.getByRole('menuitem', { name: '显示查询' }).click();
    await expect(query.getByTestId('copy-button-1')).toBeVisible({ timeout: 5_000 });
    await expect(query.getByRole('heading', { name: '核对订单与实收数量' })).not.toBeVisible();
    await query.getByRole('button', { name: /^少件处理 #2/ }).click();
    await expect(query.getByRole('textbox', { name: '流程名称' })).toHaveValue('尚未保存的合成昵称');
  } finally {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
