import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { launchSopElectron } from '../support/sop-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function titleIconGap(page: Page): Promise<number> {
  return page.locator('.query-sop-title-line').evaluate(line => {
    const title = line.querySelector('.ant-typography');
    const button = line.querySelector('button');
    if (!title || !button) throw new Error('Title or edit button missing');
    const range = document.createRange();
    range.selectNodeContents(title);
    return button.getBoundingClientRect().left - range.getBoundingClientRect().right;
  });
}

test('renames the current SOP in both hosts while preserving progress and other tasks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-inline-rename-'));
  const app = await launchSopElectron({ desktopRoot: root, userDataDirectory: dir });
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const query = app.windows().find(page => page.url().includes('role=query'));
    const fox = app.windows().find(page => page.url().includes('role=fox'));
    if (!query || !fox) throw new Error('Overlay windows missing');
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.evaluate(() => window.customerAgent!.sopWindow!.open('missing-item-demo'));
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
    await query.getByRole('checkbox', { name: '已核对订单应收数量' }).click();
    await query.getByRole('button', { name: '编辑流程名称' }).click();
    const input = query.getByRole('textbox', { name: '流程名称' });
    await expect(input).toHaveValue('少件处理 #1');
    await input.fill('合成客户甲');
    await input.press('Enter');
    await expect(query.getByLabel('合成客户甲', { exact: true })).toBeVisible();
    const notice = query.getByRole('status', { name: '名称已调整' });
    await expect(notice).toHaveText('已调整');
    if (process.env.CUSTOMER_AGENT_TEST_OUTPUT) {
      fs.mkdirSync(process.env.CUSTOMER_AGENT_TEST_OUTPUT, { recursive: true });
      await expect.poll(() => notice.evaluate(element => Number(getComputedStyle(element).opacity))).toBeGreaterThan(0.95);
      await query.screenshot({ path: path.join(process.env.CUSTOMER_AGENT_TEST_OUTPUT, 'rename-label.png') });
    }
    await expect(notice).toHaveAttribute('data-phase', 'check');
    if (process.env.CUSTOMER_AGENT_TEST_OUTPUT) await query.screenshot({ path: path.join(process.env.CUSTOMER_AGENT_TEST_OUTPUT, 'rename-check.png') });
    await expect(notice).toHaveCount(0);
    await expect(query.getByRole('button', { name: '编辑流程名称' })).toBeVisible();
    await expect(query.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
    await query.getByRole('button', { name: '独立悬浮' }).click();
    await expect.poll(() => app.windows().some(page => page.url().includes('role=sop-floating'))).toBe(true);
    const floating = app.windows().find(page => page.url().includes('role=sop-floating'));
    if (!floating) throw new Error('Floating window missing');
    await expect(floating.getByLabel('合成客户甲', { exact: true })).toBeVisible();
    await floating.getByRole('button', { name: '编辑流程名称' }).click();
    await floating.getByRole('textbox', { name: '流程名称' }).fill('合成客户乙');
    await floating.getByRole('button', { name: '保存流程名称' }).click();
    await expect(floating.getByLabel('合成客户乙', { exact: true })).toBeVisible();
    await floating.getByRole('button', { name: '更多操作' }).click();
    await floating.getByRole('menuitem', { name: '显示查询' }).click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
    await expect(query.getByRole('button', { name: /^合成客户乙/ })).toBeVisible();
    await expect(floating.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
    await query.getByTestId('question-input').fill('澄芽氨基酸洁面怎么用');
    await query.getByTestId('search-button').click();
    await expect(query.getByTestId('copy-button-1')).toBeVisible();
    await expect(floating.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
    await floating.getByRole('button', { name: '合回查询' }).click();
    await expect(query.getByLabel('合成客户乙', { exact: true })).toBeVisible();
    await expect(query.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
  } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('edit icon stays beside the title in both SOP windows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-title-icon-'));
  const app = await launchSopElectron({ desktopRoot: root, userDataDirectory: dir });
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const query = app.windows().find(page => page.url().includes('role=query'));
    const fox = app.windows().find(page => page.url().includes('role=fox'));
    if (!query || !fox) throw new Error('Overlay windows missing');
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.evaluate(() => window.customerAgent!.sopWindow!.open('missing-item-demo'));
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
    expect(await titleIconGap(query)).toBeLessThanOrEqual(8);
    await query.getByRole('button', { name: '独立悬浮' }).click();
    await expect.poll(() => app.windows().some(page => page.url().includes('role=sop-floating'))).toBe(true);
    const floating = app.windows().find(page => page.url().includes('role=sop-floating'));
    if (!floating) throw new Error('Floating window missing');
    await expect(floating.getByRole('button', { name: '编辑流程名称' })).toBeEnabled();
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('role=sop-floating'));
      if (!win) throw new Error('Floating window missing');
      win.setBounds({ width: 420 });
    });
    await expect.poll(() => floating.evaluate(() => innerWidth)).toBe(420);
    const icon = floating.getByRole('button', { name: '编辑流程名称' });
    expect(await titleIconGap(floating)).toBeLessThanOrEqual(8);
    await icon.click();
    await floating.getByRole('textbox', { name: '流程名称' }).fill('甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉');
    await floating.getByRole('button', { name: '保存流程名称' }).click();
    await expect(floating.getByLabel('甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉', { exact: true })).toBeVisible();
    await expect(icon).toBeEnabled();
    const layout = await floating.locator('.query-sop-header').evaluate(header => {
      const title = header.querySelector('.query-sop-title-line .ant-typography');
      const button = header.querySelector('button[aria-label="编辑流程名称"]');
      if (!title || !button) throw new Error('Title layout missing');
      return { titleRight: title.getBoundingClientRect().right, buttonLeft: button.getBoundingClientRect().left,
        buttonRight: button.getBoundingClientRect().right, headerRight: header.getBoundingClientRect().right };
    });
    expect(layout.titleRight).toBeLessThanOrEqual(layout.buttonLeft + 1);
    expect(layout.buttonRight).toBeLessThanOrEqual(layout.headerRight);
    await floating.getByRole('button', { name: '结束流程' }).focus();
    await floating.keyboard.press('Tab');
    await expect(floating.getByLabel('甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉', { exact: true })).toBeFocused();
    await floating.keyboard.press('Tab');
    await expect(icon).toBeFocused();
  } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('task close target stays inside its border at both widths and color schemes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-close-border-'));
  const app = await launchSopElectron({ desktopRoot: root, userDataDirectory: dir });
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const query = app.windows().find(page => page.url().includes('role=query'));
    const fox = app.windows().find(page => page.url().includes('role=fox'));
    if (!query || !fox) throw new Error('Overlay windows missing');
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.evaluate(() => window.customerAgent!.sopWindow!.open('missing-item-demo'));
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
    await query.getByRole('button', { name: '返回搜索' }).click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
    const restore = query.locator('.query-sop-task-restore').first();
    const close = query.locator('.query-sop-task-close').first();
    for (const width of [600, 420]) {
      await app.evaluate(({ BrowserWindow }, targetWidth) => {
        const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('role=query'));
        if (!win) throw new Error('Query window missing');
        win.setBounds({ width: targetWidth });
      }, width);
      await expect.poll(() => query.evaluate(() => innerWidth)).toBe(width);
      for (const colorScheme of ['light', 'dark'] as const) {
        await query.emulateMedia({ colorScheme });
        await restore.hover();
        await expect(close).toBeVisible();
        const bounds = await close.boundingBox();
        const restoreBounds = await restore.boundingBox();
        if (!bounds || !restoreBounds) throw new Error('Task bounds missing');
        expect(bounds.width).toBe(44);
        expect(bounds.height).toBe(44);
        expect(restoreBounds.x + restoreBounds.width - bounds.x - bounds.width).toBeGreaterThanOrEqual(4);
        await restore.focus();
        await query.keyboard.press('Tab');
        await expect(close).toBeFocused();
        if (process.env.CUSTOMER_AGENT_TEST_OUTPUT) {
          fs.mkdirSync(process.env.CUSTOMER_AGENT_TEST_OUTPUT, { recursive: true });
          await query.screenshot({ path: path.join(process.env.CUSTOMER_AGENT_TEST_OUTPUT, `close-${width}-${colorScheme}-focus.png`) });
        }
      }
    }
  } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
