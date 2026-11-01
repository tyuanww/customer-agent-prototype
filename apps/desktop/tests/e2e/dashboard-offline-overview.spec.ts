import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { launchSopElectron } from '../support/sop-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidenceDir = process.env.CUSTOMER_AGENT_TEST_OUTPUT ?? path.join(root, '../../test-output/sop');

function luminance(color: string): number {
  const values = color.match(/[\d.]+/g)?.map(Number);
  if (!values || values.length !== 3) throw new Error(`Expected opaque RGB, received ${color}`);
  const [r = 0, g = 0, b = 0] = values.map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

test('offline overview explains availability without failed reads and preserves the SOP manual', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-overview-e2e-'));
  const app = await launchSopElectron({ desktopRoot: root, userDataDirectory: userData });
  try {
    await expect.poll(() => app.windows().some(page => page.url().includes('role=query'))).toBe(true);
    const query = app.windows().find(page => page.url().includes('role=query'))!;
    await query.evaluate(() => window.customerAgent!.openDashboard());
    await expect.poll(() => app.windows().some(page => page.url().includes('role=dashboard'))).toBe(true);
    const dashboard = app.windows().find(page => page.url().includes('role=dashboard'))!;
    await dashboard.getByTestId('nav-overview').click();
    const overview = dashboard.getByTestId('module-overview');
    await expect(overview).toBeVisible();
    fs.mkdirSync(evidenceDir, { recursive: true });
    await dashboard.screenshot({ path: path.join(evidenceDir, 'offline-overview.png') });
    await expect(overview).toContainText('当前为离线预览，查询和待办需在业务环境登录后查看');
    await expect(overview.getByText('没读到。', { exact: true })).toHaveCount(0);
    await expect(overview.getByRole('button', { name: /重试/ })).toHaveCount(0);
    await expect(overview.getByRole('table')).toHaveCount(0);
    for (const colorScheme of ['light', 'dark'] as const) {
      await dashboard.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await expect(dashboard.locator('.dashboard-shell')).toHaveAttribute('data-theme', colorScheme);
      const colors = await overview.locator('p').evaluate(element => {
        let ancestor: Element | null = element;
        while (ancestor) {
          const background = getComputedStyle(ancestor).backgroundColor;
          if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') {
            return { foreground: getComputedStyle(element).color, background };
          }
          ancestor = ancestor.parentElement;
        }
        throw new Error('No painted background behind the offline explanation');
      });
      const foreground = luminance(colors.foreground), background = luminance(colors.background);
      expect((Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05), `${colorScheme} offline explanation contrast`).toBeGreaterThanOrEqual(4.5);
      fs.writeFileSync(path.join(evidenceDir, `contrast-${colorScheme}.json`), JSON.stringify({ ...colors, ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) }, null, 2));
      await dashboard.screenshot({ path: path.join(evidenceDir, `offline-overview-${colorScheme}.png`) });
    }
    await dashboard.getByTestId('nav-sop').click();
    await expect(dashboard.getByRole('region', { name: 'SOP 手册' })).toBeVisible();
    await expect(dashboard.getByRole('combobox', { name: '选择流程' })).toBeVisible();
    await dashboard.screenshot({ path: path.join(evidenceDir, 'offline-manual.png') });
    await dashboard.getByTestId('nav-overview').click();
    await expect(overview).toContainText('当前为离线预览，查询和待办需在业务环境登录后查看');
    await expect(overview.getByRole('button', { name: /重试/ })).toHaveCount(0);
  } finally {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
