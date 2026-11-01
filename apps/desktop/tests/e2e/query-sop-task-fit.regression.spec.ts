import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchSopElectron } from '../support/sop-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function stable(query: Page, view: 'sop' | 'query-home') {
  await expect(query.getByTestId('query-shell')).toHaveAttribute('data-workspace-view', view);
  await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
}

async function visibleTasks(app: ElectronApplication, query: Page, count: number) {
  await expect(query.locator('.query-sop-task-row')).toHaveCount(count);
  let observed: unknown;
  try { await expect.poll(async () => {
    const native = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('role=query'));
      if (!win) throw new Error('Query window missing');
      return win.getBounds();
    });
    const dom = await query.evaluate(() => {
      const capsule = document.querySelector<HTMLElement>('.query-capsule');
      const tasks = document.querySelector<HTMLElement>('.query-sop-tasks');
      const list = document.querySelector<HTMLElement>('.query-sop-task-list');
      if (!capsule || !tasks || !list) throw new Error('Query content missing');
      const bounds = list.getBoundingClientRect();
      const buttons = [...list.querySelectorAll<HTMLElement>('.query-sop-task-restore')].map(button => {
        const rect = button.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
      });
      return { width: innerWidth, height: innerHeight, capsuleBottom: capsule.getBoundingClientRect().bottom,
        tasksBottom: tasks.getBoundingClientRect().bottom, listTop: bounds.top, listBottom: bounds.bottom, buttons };
    });
    const layout = await app.evaluate(() => (globalThis as { __demoTest?: { queryLayoutDebug: () => unknown } }).__demoTest?.queryLayoutDebug());
    observed = { native, dom, layout };
    const bottom = count ? dom.tasksBottom : dom.capsuleBottom;
    return native.width === 600 && native.height <= 620 && dom.width === 600 && dom.height === native.height
      && native.height >= bottom && native.height - bottom <= 14
      && dom.buttons.length === count && dom.buttons.every(button => button.top >= dom.listTop - 1
        && button.bottom <= dom.listBottom + 1 && button.bottom <= dom.height + 1
        && button.left >= 0 && button.right <= dom.width);
  }, { timeout: 8000, message: `${count} 个待办应完整落在列表和窗口内` }).toBe(true); }
  catch (error) { console.error('Last task-layout observation:', JSON.stringify(observed)); throw error; }
}

test('task rows remain fully visible after rename, native close, return and count changes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-task-fit-'));
  const app = await launchSopElectron({ desktopRoot: root, userDataDirectory: dir });
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const query = app.windows().find(page => page.url().includes('role=query'));
    const fox = app.windows().find(page => page.url().includes('role=fox'));
    if (!query || !fox) throw new Error('Overlay windows missing');
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await visibleTasks(app, query, 0);
    await query.getByTestId('question-input').fill('用了露芷面膜过敏了怎么办');
    await query.getByTestId('search-button').click();
    await query.getByTestId('sop-query-open-allergy-aftersale-demo').click();
    await stable(query, 'sop');
    await query.getByRole('button', { name: '编辑流程名称' }).click();
    await query.getByRole('textbox', { name: '流程名称' }).fill('合成验收客户');
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('role=query'));
      if (!win) throw new Error('Query window missing');
      win.close();
    });
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await stable(query, 'sop');
    await expect(query.getByRole('textbox', { name: '流程名称' })).toHaveValue('合成验收客户');
    await query.getByRole('button', { name: '保存流程名称' }).click();
    await expect(query.getByLabel('合成验收客户', { exact: true })).toBeVisible();
    await query.getByRole('button', { name: '返回搜索' }).click();
    await stable(query, 'query-home');
    await visibleTasks(app, query, 1);

    for (let count = 2; count <= 5; count += 1) {
      await query.evaluate(() => window.customerAgent!.sopWindow!.open('missing-item-demo'));
      await stable(query, 'sop');
      await query.getByRole('button', { name: '返回搜索' }).click();
      await stable(query, 'query-home');
      await visibleTasks(app, query, count);
    }
    const naturalBounds = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('role=query'));
      if (!win) throw new Error('Query window missing');
      const bounds = win.getBounds();
      win.setBounds({ width: 420, height: 200 });
      return bounds;
    });
    await expect.poll(() => query.evaluate(() => [innerWidth, innerHeight])).toEqual([420, 200]);
    const list = query.locator('.query-sop-task-list');
    expect(await list.evaluate(node => node.scrollHeight)).toBeGreaterThan(await list.evaluate(node => node.clientHeight));
    const last = query.locator('.query-sop-task-restore').last();
    await last.scrollIntoViewIfNeeded();
    await expect.poll(() => last.evaluate(button => {
      const list = button.closest<HTMLElement>('.query-sop-task-list');
      if (!list) return false;
      const row = button.getBoundingClientRect(), viewport = list.getBoundingClientRect();
      return list.scrollTop > 0 && row.top >= viewport.top - 1 && row.bottom <= Math.min(viewport.bottom, innerHeight) + 1;
    })).toBe(true);
    await app.evaluate(({ BrowserWindow }, bounds) => {
      const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('role=query'));
      if (!win) throw new Error('Query window missing');
      win.setBounds(bounds);
    }, naturalBounds);
    await visibleTasks(app, query, 5);
    await query.getByTestId('question-input').fill('澄芽氨基酸洁面怎么用');
    await query.getByTestId('search-button').click();
    await expect(query.getByTestId('script-card-1')).toBeVisible();
    await expect.poll(() => query.evaluate(() => {
      const list = document.querySelector<HTMLElement>('.query-sop-task-list');
      if (!list) return false;
      const viewport = list.getBoundingClientRect();
      return [...list.querySelectorAll<HTMLElement>('.query-sop-task-restore')].every(button => {
        const row = button.getBoundingClientRect();
        return row.top >= viewport.top - 1 && row.bottom <= Math.min(viewport.bottom, innerHeight) + 1;
      });
    })).toBe(true);
    const resultBounds = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('role=query'));
      if (!win) throw new Error('Query window missing');
      return win.getBounds();
    });
    expect(resultBounds.width).toBe(600);
    expect(resultBounds.height).toBeLessThanOrEqual(620);
    await query.getByRole('button', { name: /^合成验收客户/ }).click();
    await stable(query, 'sop');
    await query.getByRole('button', { name: '返回搜索' }).click();
    await stable(query, 'query-home');
    await visibleTasks(app, query, 5);
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('role=query'));
      if (!win) throw new Error('Query window missing');
      win.close();
    });
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await stable(query, 'query-home');
    await visibleTasks(app, query, 5);
    for (let count = 4; count >= 0; count -= 1) {
      await query.locator('.query-sop-task-close').first().click();
      await query.getByRole('dialog', { name: '结束流程？' }).getByRole('button', { name: '结束流程' }).click();
      await visibleTasks(app, query, count);
    }
  } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
