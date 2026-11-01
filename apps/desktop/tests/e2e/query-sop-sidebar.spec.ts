import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { launchSopElectron } from '../support/sop-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('compact SOP keeps editing, scrollable steps and end confirmation usable at 300 by 320', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-sidebar-'));
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
    await query.getByRole('button', { name: '独立悬浮' }).click();
    await expect.poll(() => app.windows().some(page => page.url().includes('role=sop-floating'))).toBe(true);
    const floating = app.windows().find(page => page.url().includes('role=sop-floating'));
    if (!floating) throw new Error('Floating SOP missing');
    await expect(floating.getByRole('button', { name: '编辑流程名称' })).toBeEnabled();
    await floating.evaluate(async () => {
      const api = window.sopFloating!;
      const snapshot = await api.current!();
      if (snapshot.kind !== 'ready' || !snapshot.projection || snapshot.access.kind !== 'executable') throw new Error('Missing executable SOP');
      const base = { taskId: snapshot.projection.taskId, hostEpoch: snapshot.access.hostEpoch, gesture: 901 };
      await api.windowIntent!({ ...base, type: 'resize-start', edge: 'se' });
      await api.windowIntent!({ ...base, type: 'resize', dx: -10000, dy: -10000 });
      await api.windowIntent!({ ...base, type: 'resize-end' });
    });
    await expect.poll(() => floating.evaluate(() => [innerWidth, innerHeight])).toEqual([300, 320]);
    await expect(floating.locator('.query-sop-step h5')).toHaveCSS('margin-top', '0px');
    await expect.poll(() => floating.evaluate(() => {
      const body = document.querySelector<HTMLElement>('.query-sop-body')!;
      const footer = document.querySelector<HTMLElement>('.query-sop-footer')!;
      return { overflow: document.documentElement.scrollWidth > innerWidth, bodyUsable: body.clientHeight >= 64,
        scrollable: body.scrollHeight > body.clientHeight, footerVisible: footer.getBoundingClientRect().bottom <= innerHeight };
    })).toEqual({ overflow: false, bodyUsable: true, scrollable: true, footerVisible: true });
    await expect(floating.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
    await floating.getByRole('button', { name: '编辑流程名称' }).click();
    await floating.getByRole('textbox', { name: '流程名称' }).fill('客户一');
    const input = await floating.getByRole('textbox', { name: '流程名称' }).boundingBox();
    const save = await floating.getByRole('button', { name: '保存流程名称' }).boundingBox();
    const collapse = await floating.getByRole('button', { name: '收起', exact: true }).boundingBox();
    if (!input || !save || !collapse) throw new Error('Editing controls missing');
    expect(input.x + input.width).toBeLessThanOrEqual(save.x + 1);
    expect(input.y + input.height).toBeLessThanOrEqual(collapse.y + 1);
    await floating.getByRole('button', { name: '保存流程名称' }).click();
    await expect(floating.getByLabel('客户一', { exact: true })).toBeVisible();
    await expect(floating.getByRole('status', { name: '名称已调整' })).toHaveCount(0);
    const output = process.env.CUSTOMER_AGENT_TEST_OUTPUT;
    if (output) {
      fs.mkdirSync(output, { recursive: true });
      await floating.screenshot({ path: path.join(output, 'sop-sidebar-300x320.png'), animations: 'disabled' });
      fs.writeFileSync(path.join(output, 'sop-sidebar-layout.json'), JSON.stringify(await floating.evaluate(() =>
        ['.query-sop-header', '.query-sop-title', '.query-sop-step', '.query-sop-step h5', '.query-sop-body', '.query-sop-footer'].map(selector => {
          const node = document.querySelector(selector)!;
          const style = getComputedStyle(node);
          return { selector, rect: node.getBoundingClientRect().toJSON(), margin: style.margin, padding: style.padding, rows: style.gridTemplateRows };
        })), null, 2));
    }
    await floating.getByRole('button', { name: '结束流程', exact: true }).click();
    const dialog = floating.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toHaveClass(/-enter|-appear/);
    const dialogBox = await dialog.boundingBox();
    if (!dialogBox) throw new Error('End confirmation missing');
    expect(dialogBox.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(300);
    expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(320);
    if (output) await floating.screenshot({ path: path.join(output, 'sop-sidebar-end-confirmation.png'), animations: 'disabled' });
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(floating.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
  } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
