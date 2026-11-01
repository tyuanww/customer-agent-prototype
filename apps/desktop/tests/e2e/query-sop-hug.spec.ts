import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchSopElectron } from '../support/sop-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function geometry(app: ElectronApplication, query: Page) {
  const native = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('role=query'));
    if (!window) throw new Error('Query missing');
    return window.getBounds();
  });
  const content = await query.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('.query-shell');
    const capsule = document.querySelector<HTMLElement>('.query-capsule');
    const tasks = document.querySelector<HTMLElement>('.query-sop-tasks');
    if (!shell || !capsule || !tasks) throw new Error('Query content missing');
    const shellTop = shell.getBoundingClientRect().top;
    const taskBottom = tasks.offsetHeight ? tasks.getBoundingClientRect().bottom : null;
    return {
      viewport: innerHeight,
      capsuleBottom: capsule.getBoundingClientRect().bottom - shellTop,
      taskBottom: taskBottom === null ? null : taskBottom - shellTop,
      taskCount: tasks.querySelectorAll('.query-sop-task-row').length,
    };
  });
  return { native, content };
}

test('home height follows remaining task rows and returns to the capsule when the last task ends', async () => {
  const evidenceDir = process.env.CUSTOMER_AGENT_TEST_OUTPUT ?? test.info().outputPath('sop-hug');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-hug-e2e-'));
  const app = await launchSopElectron({ desktopRoot: root, userDataDirectory: dir });
  const measurements: Record<string, Awaited<ReturnType<typeof geometry>>> = {};
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const query = app.windows().find(page => page.url().includes('role=query'));
    const fox = app.windows().find(page => page.url().includes('role=fox'));
    if (!query || !fox) throw new Error('Query missing');
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    for (let index = 0; index < 5; index += 1) {
      await query.evaluate(() => window.customerAgent!.sopWindow!.open('missing-item-demo'));
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-workspace-view', 'sop');
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
      await query.getByRole('button', { name: '返回搜索', exact: true }).click();
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-workspace-view', 'query-home');
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
      await expect(query.locator('.query-sop-task-row')).toHaveCount(index + 1);
    }
    for (let remaining = 4; remaining >= 0; remaining -= 1) {
      if (remaining === 0) {
        await query.getByRole('button', { name: '改名', exact: true }).click();
        await query.getByRole('button', { name: /^修改 少件处理 #5 的昵称/ }).click();
        await query.getByRole('textbox', { name: '待办昵称' }).fill('合成验收客户'.repeat(3) + '测试');
        await query.getByRole('button', { name: '保存昵称', exact: true }).click();
        await expect(query.getByRole('textbox', { name: '待办昵称' })).toHaveCount(0);
        await app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('role=query'));
          if (!window) throw new Error('Query missing');
          window.setBounds({ width: 420 });
        });
        await expect.poll(() => query.evaluate(() => innerWidth)).toBe(420);
      }
      const close = query.locator('.query-sop-task-close').first();
      const before = await geometry(app, query);
      await close.click();
      const confirmation = query.getByRole('dialog', { name: '结束流程？' });
      await expect(confirmation).toBeVisible();
      expect((await geometry(app, query)).native.height).toBe(before.native.height);
      const popup = await confirmation.boundingBox();
      if (!popup) throw new Error('Close confirmation missing');
      expect(popup.y).toBeGreaterThanOrEqual(0);
      expect(popup.y + popup.height).toBeLessThanOrEqual(before.native.height);
      if (remaining === 1) {
        await query.keyboard.press('Escape');
        await expect(confirmation).not.toBeVisible();
        await expect(query.locator('.ant-modal-wrap')).toBeHidden();
        await expect(query.locator('.query-sop-task-row')).toHaveCount(2);
        await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
        await expect(close).toBeFocused();
        await close.click();
        await expect(confirmation).toBeVisible();
      }
      if (remaining === 1 || remaining === 0) {
        await expect.poll(() => confirmation.evaluate(element => ({
          animating: element.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'),
          preparing: /ant-zoom-(appear|enter|leave)/.test(element.className),
          opacity: getComputedStyle(element).opacity,
        }))).toEqual({ animating: false, preparing: false, opacity: '1' });
        await query.screenshot({ path: path.join(evidenceDir, `close-confirmation-${remaining + 1}.png`) });
      }
      await confirmation.getByRole('button', { name: '结束流程' }).click();
      await expect(query.locator('.query-sop-task-row')).toHaveCount(remaining);
      await expect.poll(async () => {
        const current = await geometry(app, query);
        measurements[String(remaining)] = current;
        return current.native.height - (current.content.taskBottom ?? current.content.capsuleBottom);
      }, { timeout: 5000 }).toBeLessThanOrEqual(14);
      await query.screenshot({ path: path.join(evidenceDir, `remaining-${remaining}.png`) });
      if (remaining === 2 || remaining === 0) {
        await query.getByTestId('capsule-fox').click();
        await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');
        await fox.getByTestId('fox-button').click();
        await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
        await expect.poll(async () => {
          const current = await geometry(app, query);
          measurements[`reopened-${remaining}`] = current;
          return current.native.height - (current.content.taskBottom ?? current.content.capsuleBottom);
        }, { timeout: 5000 }).toBeLessThanOrEqual(14);
      }
    }
  } finally {
    fs.writeFileSync(path.join(evidenceDir, 'measurements.json'), JSON.stringify(measurements, null, 2));
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
