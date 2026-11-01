import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { launchSopElectron } from '../support/sop-electron';

// Regression: ISSUE-002 — unavailable offline pages show an explanation, not a retry.
// Found by /qa on 2026-11-01.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidenceDir = process.env.CUSTOMER_AGENT_TEST_OUTPUT ?? path.join(root, '../../test-output/offline-pages');

function luminance(color: string): number {
  const values = color.match(/[\d.]+/g)?.map(Number);
  if (!values || values.length !== 3) throw new Error(`Expected opaque RGB, received ${color}`);
  const [red = 0, green = 0, blue = 0] = values.map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

test('offline workspace explains unavailable business pages and retains the synthetic SOP manual', async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-pages-'));
  const app = await launchSopElectron({ desktopRoot: root, userDataDirectory: dir });
  try {
    await expect.poll(() => app.windows().some(page => page.url().includes('role=query'))).toBe(true);
    const query = app.windows().find(page => page.url().includes('role=query'));
    if (!query) throw new Error('Query missing');
    await query.evaluate(() => window.customerAgent!.openDashboard());
    await expect.poll(() => app.windows().some(page => page.url().includes('role=dashboard'))).toBe(true);
    const dashboard = app.windows().find(page => page.url().includes('role=dashboard'));
    if (!dashboard) throw new Error('Dashboard missing');
    for (const [nav, label] of [['wording', '话术库'], ['content', '知识库'], ['materials', '资料']] as const) {
      await dashboard.getByTestId(`nav-${nav}`).click();
      const panel = dashboard.getByTestId('dashboard-content');
      await expect(panel).toContainText(`当前为离线预览，${label}需在业务环境登录后查看`);
      await expect(panel.getByRole('button', { name: /重试|重新读取|刷新/ })).toHaveCount(0);
      await expect(panel.getByRole('alert')).toHaveCount(0);
      await expect(panel.getByRole('textbox')).toHaveCount(0);
      for (const colorScheme of ['light', 'dark'] as const) {
        await dashboard.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await expect(dashboard.locator('.dashboard-shell')).toHaveAttribute('data-theme', colorScheme);
        const colors = await panel.getByText(`当前为离线预览，${label}需在业务环境登录后查看`).evaluate(element => {
          let ancestor: Element | null = element;
          while (ancestor) {
            const background = getComputedStyle(ancestor).backgroundColor;
            if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') return { foreground: getComputedStyle(element).color, background };
            ancestor = ancestor.parentElement;
          }
          throw new Error('No painted background behind the offline explanation');
        });
        const foreground = luminance(colors.foreground), background = luminance(colors.background);
        const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        expect(ratio, `${nav} ${colorScheme} contrast`).toBeGreaterThanOrEqual(4.5);
        fs.writeFileSync(path.join(evidenceDir, `contrast-${nav}-${colorScheme}.json`), JSON.stringify({ ...colors, ratio }, null, 2));
        await dashboard.screenshot({ path: path.join(evidenceDir, `offline-${nav}-${colorScheme}.png`) });
      }
    }
    await dashboard.getByTestId('nav-sop').click();
    await expect(dashboard.getByRole('region', { name: 'SOP 手册' })).toBeVisible();
    await dashboard.getByTestId('nav-overview').click();
    await expect(dashboard.getByTestId('module-overview')).toContainText('当前为离线预览');
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
