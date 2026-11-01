import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { launchSopElectron } from '../support/sop-electron';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('SOPs collapse to separate left bookmarks and restore without moving the fox', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-bookmark-'));
  const app = await launchSopElectron({ desktopRoot, userDataDirectory: userData });
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const query = app.windows().find(page => page.url().includes('role=query'))!;
    const fox = app.windows().find(page => page.url().includes('role=fox'))!;
    const foxBounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(window => window.webContents.getURL().includes('role=fox'))!.getBounds());
    // Startup loads both renderers before positioning and showing the fox.
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(window => window.webContents.getURL().includes('role=fox'))?.isVisible() ?? false)).toBe(true);
    const origin = await foxBounds();
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.evaluate(() => window.customerAgent!.sopWindow!.open('missing-item-demo'));
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
    await query.getByRole('checkbox', { name: '已核对订单应收数量' }).click();
    await query.getByRole('button', { name: '收起', exact: true }).click();
    await expect.poll(() => app.windows().filter(page => page.url().includes('role=sop-floating')).length).toBe(1);
    const first = app.windows().find(page => page.url().includes('role=sop-floating'))!;
    await expect(first.getByRole('button', { name: '展开流程', exact: true })).toBeVisible();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');
    await expect.poll(foxBounds).toEqual(origin);
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.evaluate(() => window.customerAgent!.sopWindow!.open('allergy-aftersale-demo'));
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
    await query.getByRole('button', { name: '独立悬浮', exact: true }).click();
    await expect.poll(() => app.windows().filter(page => page.url().includes('role=sop-floating')).length).toBe(2);
    const second = app.windows().find(page => page.url().includes('role=sop-floating') && page !== first)!;
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');
    await expect.poll(foxBounds).toEqual(origin);
    await second.getByRole('button', { name: '收起', exact: true }).click();
    await expect(second.getByRole('button', { name: '展开流程', exact: true })).toBeVisible();
    const bookmarks = await app.evaluate(({ BrowserWindow, screen }) => BrowserWindow.getAllWindows()
      .filter(window => window.webContents.getURL().includes('role=sop-floating'))
      .map(window => ({ bounds: window.getBounds(), area: screen.getDisplayMatching(window.getBounds()).workArea })));
    for (const { bounds, area } of bookmarks) {
      expect(bounds.x).toBe(area.x);
      expect(bounds.width).toBe(40);
      expect(bounds.height).toBe(96);
      expect(bounds.y).toBeGreaterThanOrEqual(area.y);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(area.y + area.height);
    }
    const [a, b] = bookmarks.map(item => item.bounds).sort((a, b) => a.y - b.y);
    expect(a.y + a.height).toBeLessThanOrEqual(b.y);
    await first.getByRole('button', { name: '展开流程', exact: true }).hover();
    await expect(first.getByRole('tooltip')).toHaveCount(0);
    await expect(first.locator('.floating-sop-collapsed-label')).toHaveCSS('writing-mode', 'vertical-rl');
    await expect(first.getByRole('button', { name: '展开流程', exact: true })).toBeVisible();
    if (process.env.CUSTOMER_AGENT_TEST_OUTPUT) {
      fs.mkdirSync(process.env.CUSTOMER_AGENT_TEST_OUTPUT, { recursive: true });
      await first.screenshot({ path: path.join(process.env.CUSTOMER_AGENT_TEST_OUTPUT, 'sop-bookmark-40x96.png') });
    }
    await first.bringToFront();
    await first.getByRole('button', { name: '展开流程', exact: true }).click();
    await expect(first.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked();
    await expect(second.getByRole('button', { name: '展开流程', exact: true })).toBeVisible();
  } finally {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
