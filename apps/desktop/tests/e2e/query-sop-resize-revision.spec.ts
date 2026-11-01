import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { launchSopElectron } from '../support/sop-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('finishes a mouse resize when a keyboard choice advances the SOP', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'query-sop-resize-'));
  const app = await launchSopElectron({ desktopRoot: root, userDataDirectory: userData });
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const fox = app.windows().find(page => page.url().includes('role=fox'))!;
    const query = app.windows().find(page => page.url().includes('role=query'))!;
    const originalFox = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(item => item.webContents.getURL().includes('role=fox'))!.getBounds());
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.getByTestId('question-input').fill('用了露芷面膜过敏了怎么办');
    await query.getByTestId('question-input').press('Enter');
    await query.getByTestId('sop-query-open-allergy-aftersale-demo').click();
    await expect(query.getByText('步骤 1', { exact: true })).toBeVisible();
    const placed = await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('role=query'))!;
      const area = screen.getDisplayMatching(win.getBounds()).workArea;
      const width = Math.min(600, area.width - 40), height = Math.min(620, area.height - 80);
      const bounds = { x: area.x + 20, y: area.y + 20, width, height };
      win.setBounds(bounds);
      return bounds;
    });
    const choice = query.getByRole('button', { name: /^已给照片/ });
    await choice.focus();
    const edge = query.locator('.sop-resize-n');
    const box = await edge.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error('resize edge missing');
    await query.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await query.mouse.down();
    await query.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 40, { steps: 4 });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(item => item.webContents.getURL().includes('role=query'))!.getBounds().y)).toBeGreaterThan(placed.y);
    await query.keyboard.press('Enter');
    await expect(query.getByText('步骤 2', { exact: true })).toBeVisible();
    await query.mouse.up();
    await query.getByRole('button', { name: '收起', exact: true }).click();
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(item => item.webContents.getURL().includes('role=fox'))!.isVisible())).toBe(true);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(item => item.webContents.getURL().includes('role=fox'))!.getBounds().y)).toBe(originalFox.y);
  } finally {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
