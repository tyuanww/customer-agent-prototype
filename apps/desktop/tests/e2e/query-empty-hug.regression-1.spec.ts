import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchSopElectron } from '../support/sop-electron';

// Regression: ISSUE-001 — an empty query must not create a blank results window.
// Found by /qa on 2026-11-01.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidenceDir = process.env.CUSTOMER_AGENT_TEST_OUTPUT ?? path.join(root, '../../test-output/empty-hug');

async function height(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => {
    const query = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('role=query'));
    if (!query) throw new Error('Query missing');
    return query.getBounds().height;
  });
}

test('blank search keeps the visible home and task list at their natural height', async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-query-hug-'));
  const app = await launchSopElectron({ desktopRoot: root, userDataDirectory: dir });
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const query = app.windows().find(page => page.url().includes('role=query'));
    const fox = app.windows().find(page => page.url().includes('role=fox'));
    if (!query || !fox) throw new Error('Overlay windows missing');
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await expect.poll(() => height(app)).toBe(88);
    await query.getByTestId('search-button').click();
    await expect(query.getByTestId('validation-error')).toBeVisible();
    await query.waitForTimeout(600);
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
    await query.screenshot({ path: path.join(evidenceDir, 'blank-no-task.png') });
    await expect.poll(() => height(app)).toBe(88);
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-workspace-view', 'query-home');

    await query.getByTestId('question-input').fill('露芷面膜孕期能用吗');
    await query.getByTestId('search-button').click();
    await expect(query.getByTestId('script-card-1')).toBeVisible();
    await query.getByTestId('question-input').fill('');
    await query.getByTestId('search-button').click();
    await expect(query.getByTestId('validation-error')).toBeVisible();
    await expect(query.getByTestId('script-card-1')).toHaveCount(0);
    await query.waitForTimeout(600);
    await expect.poll(() => height(app)).toBe(88);

    await query.evaluate(() => window.customerAgent!.sopWindow!.open('missing-item-demo'));
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-workspace-view', 'sop');
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
    await query.getByRole('button', { name: '返回搜索', exact: true }).click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-workspace-view', 'query-home');
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
    await expect(query.locator('.query-sop-task-row')).toHaveCount(1);
    const taskHeight = await height(app);
    await query.getByTestId('question-input').fill('');
    await query.getByTestId('search-button').click();
    await expect(query.getByTestId('validation-error')).toBeVisible();
    await query.waitForTimeout(600);
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
    await query.screenshot({ path: path.join(evidenceDir, 'blank-one-task.png') });
    await expect.poll(() => height(app)).toBe(taskHeight);
    await expect(query.locator('.query-sop-task-row')).toHaveCount(1);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reopening after a search fits the empty query and retained SOP tasks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reopen-query-hug-'));
  const app = await launchSopElectron({ desktopRoot: root, userDataDirectory: dir });
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const query = app.windows().find(page => page.url().includes('role=query'));
    const fox = app.windows().find(page => page.url().includes('role=fox'));
    if (!query || !fox) throw new Error('Overlay windows missing');
    const openQuery = async () => {
      await fox.getByTestId('fox-button').click();
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-workspace-view', 'query-home');
    };
    const searchAndReopen = async () => {
      await query.getByTestId('question-input').fill('澄芽氨基酸洁面怎么用');
      await query.getByTestId('search-button').click();
      await expect(query.getByTestId('script-card-1')).toBeVisible();
      await query.getByRole('button', { name: '点击收起查询，拖拽移动查询窗' }).click();
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');
      await openQuery();
      await expect(query.getByTestId('script-card-1')).toHaveCount(0);
    };
    await openQuery();
    await searchAndReopen();
    await query.waitForTimeout(600);
    await expect.poll(() => height(app)).toBe(88);

    await query.evaluate(() => window.customerAgent!.sopWindow!.open('missing-item-demo'));
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-workspace-view', 'sop');
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
    await query.getByRole('button', { name: '返回搜索' }).click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-workspace-view', 'query-home');
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
    await expect(query.locator('.query-sop-task-row')).toHaveCount(1);
    const taskHeight = await height(app);
    await searchAndReopen();
    await expect(query.locator('.query-sop-task-row')).toHaveCount(1);
    await expect(query.locator('.query-sop-task-row')).toBeVisible();
    await query.waitForTimeout(600);
    await expect.poll(() => height(app)).toBe(taskHeight);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
