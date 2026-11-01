import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { launchSopElectron } from '../support/sop-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('SOP floating keeps the last valid size when pointer capture is lost after a large resize', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-resize-interruption-'));
  const app = await launchSopElectron({ desktopRoot: root, userDataDirectory: dir });
  try {
    await expect.poll(() => app.windows().length).toBeGreaterThanOrEqual(2);
    const query = app.windows().find(page => page.url().includes('role=query'));
    const fox = app.windows().find(page => page.url().includes('role=fox'));
    if (!query || !fox) throw new Error('Query or Fox missing');
    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await query.evaluate(() => window.customerAgent!.sopWindow!.open('missing-item-demo'));
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-view-transition', 'stable');
    await query.getByRole('button', { name: '独立悬浮', exact: true }).click();
    await expect.poll(() => app.windows().some(page => page.url().includes('role=sop-floating'))).toBe(true);
    const page = app.windows().find(candidate => candidate.url().includes('role=sop-floating'));
    if (!page) throw new Error('SOP window missing');
    await expect(page.getByRole('region', { name: 'SOP 流程' })).toBeVisible();
    const bounds = () => app.evaluate(({ BrowserWindow }, role) => {
      const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes(`role=${role}`));
      if (!window) throw new Error('SOP native window missing');
      return window.getBounds();
    }, 'sop-floating');
    const before = await bounds();
    await page.mouse.move(before.width - 17, before.height - 4);
    await page.mouse.down();
    await page.mouse.move(before.width - 250, before.height - 250, { steps: 10 });
    await expect.poll(async () => (await bounds()).width).toBeLessThan(before.width);
    const during = await bounds();
    await page.locator('.sop-resize-se').evaluate(element => element.releasePointerCapture(1));
    await page.mouse.move(before.width - 249, before.height - 249);
    await page.mouse.up();
    await expect.poll(bounds).toEqual(during);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
