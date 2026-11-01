import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchSopElectron } from '../support/sop-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function withApp(run: (app: ElectronApplication, query: Page, fox: Page) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-rename-drafts-'));
  const app = await launchSopElectron({ desktopRoot: root, userDataDirectory: dir });
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const query = app.windows().find(page => page.url().includes('role=query'));
    const fox = app.windows().find(page => page.url().includes('role=fox'));
    if (!query || !fox) throw new Error('Overlay windows missing');
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await run(app, query, fox);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function stable(query: Page, view: 'sop' | 'query-home') {
  await expect(query.getByTestId('query-shell')).toHaveAttribute('data-workspace-view', view);
  await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
}

async function openScene(query: Page, scene: 'allergy' | 'missing') {
  const search = scene === 'allergy' ? '用了露芷面膜过敏了怎么办' : '少件了，没收到全部';
  const id = scene === 'allergy' ? 'allergy-aftersale-demo' : 'missing-item-demo';
  await query.getByTestId('question-input').fill(search);
  await query.getByTestId('search-button').click();
  const entry = scene === 'allergy' ? `sop-query-open-${id}` : `sop-no-hit-open-${id}`;
  await query.getByTestId(entry).click();
  await stable(query, 'sop');
}

async function returnHome(query: Page) {
  await query.getByRole('button', { name: '返回搜索', exact: true }).click();
  await stable(query, 'query-home');
}

async function draft(page: Page, value: string) {
  await page.getByRole('button', { name: '编辑流程名称' }).click();
  await page.getByRole('textbox', { name: '流程名称' }).fill(value);
}

async function floatingWindow(app: ElectronApplication) {
  await expect.poll(() => app.windows().some(page => page.url().includes('role=sop-floating'))).toBe(true);
  const floating = app.windows().find(page => page.url().includes('role=sop-floating'));
  if (!floating) throw new Error('Floating window missing');
  return floating;
}

test('query drafts stay separate across task switches and native close', async () => {
  await withApp(async (app, query, fox) => {
    await openScene(query, 'allergy');
    await draft(query, '合成甲草稿');
    await expect(query.getByRole('button', { name: '独立悬浮' })).toBeEnabled();
    await returnHome(query);
    await expect(query.getByRole('button', { name: /^过敏流程 #1/ })).toBeVisible();
    await openScene(query, 'missing');
    await draft(query, '合成乙草稿');
    await returnHome(query);

    await query.getByRole('button', { name: /^过敏流程 #1/ }).click();
    await expect(query.getByRole('textbox', { name: '流程名称' })).toHaveValue('合成甲草稿');
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('role=query'));
      if (!window) throw new Error('Query window missing');
      window.close();
    });
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
    await stable(query, 'sop');
    await expect(query.getByRole('textbox', { name: '流程名称' })).toHaveValue('合成甲草稿');
    await query.getByRole('button', { name: '保存流程名称' }).click();
    await expect(query.getByLabel('合成甲草稿', { exact: true })).toBeVisible();
    await expect(query.getByRole('status', { name: '名称已调整' })).toHaveText('已调整');
    await expect(query.getByRole('button', { name: '独立悬浮' })).toBeEnabled();
    await returnHome(query);
    await query.getByRole('button', { name: /^少件处理 #2/ }).click();
    await expect(query.getByRole('textbox', { name: '流程名称' })).toHaveValue('合成乙草稿');
    await query.getByRole('textbox', { name: '流程名称' }).press('Escape');
    await expect(query.getByRole('button', { name: '独立悬浮' })).toBeEnabled();
  });
});

test('reopens an active Query during its close transition without losing execution', async () => {
  await withApp(async (app, query) => {
    await openScene(query, 'allergy');
    const wasVisibleDuringClose = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('role=query'));
      const harness = (globalThis as { __demoTest?: { expand: () => void } }).__demoTest;
      if (!window || !harness) throw new Error('Query window or test harness missing');
      window.close();
      const visible = window.isVisible();
      harness.expand();
      return visible;
    });
    expect(wasVisibleDuringClose).toBe(true);
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
    await stable(query, 'sop');
    await query.getByRole('button', { name: /已给照片/ }).click();
    await expect(query.getByRole('heading', { name: '核实不适情况' })).toBeVisible();
  });
});

test('a step-name draft follows the task between Query and its floating window', async () => {
  await withApp(async (app, query) => {
    await openScene(query, 'allergy');
    await draft(query, '同一任务草稿');
    await query.getByRole('button', { name: '独立悬浮' }).click();
    const floating = await floatingWindow(app);
    await expect(floating.getByRole('textbox', { name: '流程名称' })).toHaveValue('同一任务草稿');
    await floating.getByRole('textbox', { name: '流程名称' }).fill('跨窗口继续编辑');
    await floating.getByRole('button', { name: '合回查询' }).click();
    await expect(query.getByRole('textbox', { name: '流程名称' })).toHaveValue('跨窗口继续编辑');
    await expect(query.getByRole('heading', { name: '核实凭证' })).toBeVisible();
  });
});

test('independent floating drafts survive native close, and ending one task clears only its draft', async () => {
  await withApp(async (app, query) => {
    await openScene(query, 'allergy');
    await returnHome(query);
    await openScene(query, 'missing');
    await returnHome(query);
    await query.getByRole('button', { name: /^过敏流程 #1/ }).click();
    await query.getByRole('button', { name: '独立悬浮' }).click();
    const floating = await floatingWindow(app);
    await draft(floating, '浮窗甲草稿');
    await expect(floating.getByRole('button', { name: '合回查询' })).toBeEnabled();
    await floating.getByRole('button', { name: '更多操作' }).click();
    await floating.getByRole('menuitem', { name: '显示查询' }).click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
    await query.getByRole('button', { name: /^少件处理 #2/ }).click();
    await expect(query.getByRole('heading', { name: '核对订单与实收数量' })).toBeVisible();
    await query.getByRole('button', { name: '独立悬浮' }).click();
    await expect.poll(() => app.windows().filter(page => page.url().includes('role=sop-floating')).length).toBe(2);
    const second = app.windows().find(page => page.url().includes('role=sop-floating') && page !== floating);
    if (!second) throw new Error('Second floating window missing');
    await draft(second, '浮窗乙草稿');
    await second.getByRole('button', { name: '更多操作' }).click();
    await second.getByRole('menuitem', { name: '显示查询' }).click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().filter(item => item.webContents.getURL().includes('role=sop-floating'))[1];
      if (!window) throw new Error('Floating window missing');
      window.close();
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .filter(window => window.webContents.getURL().includes('role=sop-floating'))[1]?.isVisible())).toBe(false);
    await query.getByRole('button', { name: /^少件处理 #2/ }).click();
    await expect(second.getByRole('textbox', { name: '流程名称' })).toHaveValue('浮窗乙草稿');
    await query.getByRole('button', { name: /^过敏流程 #1/ }).click();
    await expect(floating.getByRole('textbox', { name: '流程名称' })).toHaveValue('浮窗甲草稿');
    await query.getByRole('button', { name: '结束 过敏流程 #1', exact: true }).click();
    await query.getByRole('dialog', { name: '结束流程？' }).getByRole('button', { name: '结束流程', exact: true }).click();
    await expect(query.getByRole('button', { name: /^过敏流程 #1/ })).toHaveCount(0);
    await query.getByRole('button', { name: /^少件处理 #2/ }).click();
    await expect(second.getByRole('textbox', { name: '流程名称' })).toHaveValue('浮窗乙草稿');
    await second.getByRole('textbox', { name: '流程名称' }).press('Escape');
    await expect(second.getByRole('button', { name: '合回查询' })).toBeEnabled();
    await second.getByRole('button', { name: '合回查询' }).click();
    await expect(query.getByRole('heading', { name: '核对订单与实收数量' })).toBeVisible();
  });
});

test('list drafts survive opening another task and require confirmation after a concurrent rename', async () => {
  await withApp(async (app, query) => {
    await openScene(query, 'allergy');
    await returnHome(query);
    await openScene(query, 'missing');
    await returnHome(query);
    await query.getByRole('button', { name: '改名', exact: true }).click();
    await query.getByRole('button', { name: /^修改 过敏流程 #1 的昵称/ }).click();
    await query.getByRole('textbox', { name: '待办昵称' }).fill('列表草稿');
    await query.getByRole('button', { name: /^少件处理 #2/ }).click();
    await returnHome(query);
    await expect(query.getByRole('textbox', { name: '待办昵称' })).toHaveValue('列表草稿');
    await query.getByRole('button', { name: /^过敏流程 #1/ }).click();
    await query.getByRole('button', { name: '独立悬浮' }).click();
    const floating = await floatingWindow(app);
    await floating.getByRole('button', { name: '更多操作' }).click();
    await floating.getByRole('menuitem', { name: '显示查询' }).click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
    await expect(query.getByRole('textbox', { name: '待办昵称' })).toHaveValue('列表草稿');
    await draft(floating, '浮窗已保存');
    await floating.getByRole('button', { name: '保存流程名称' }).click();
    await expect(floating.getByLabel('浮窗已保存', { exact: true })).toBeVisible();
    await query.getByRole('button', { name: '保存昵称' }).click();
    await expect(query.getByRole('alert')).toContainText('待办已变化，请核对后再次保存');
    await expect(query.getByRole('textbox', { name: '待办昵称' })).toHaveValue('列表草稿');
    await expect(floating.getByLabel('浮窗已保存', { exact: true })).toBeVisible();
    await query.getByRole('button', { name: '保存昵称' }).click();
    await expect(floating.getByLabel('列表草稿', { exact: true })).toBeVisible();
  });
});
