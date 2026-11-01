import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { launchSopElectron } from '../support/sop-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

for (const mode of ['query', 'sop-floating'] as const) {
  test(`${mode} resizes in eight directions, including the visible rounded corners`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-resize-directions-'));
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
      if (mode === 'sop-floating') {
        await query.getByRole('button', { name: '独立悬浮', exact: true }).click();
        await expect.poll(() => app.windows().some(page => page.url().includes('role=sop-floating'))).toBe(true);
      }
      const page = app.windows().find(candidate => candidate.url().includes(`role=${mode}`));
      if (!page) throw new Error('SOP window missing');
      await expect(page.getByRole('region', { name: 'SOP 流程' })).toBeVisible();
      for (const name of [mode === 'query' ? '返回搜索' : '结束流程', '更多操作']) {
        const button = page.getByRole('button', { name, exact: true });
        expect(await button.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return [rect.left + 4, rect.right - 4].every(x => element.contains(document.elementFromPoint(x, rect.top + 4)));
        }), `${name} remains clickable at both top corners`).toBe(true);
      }
      const bounds = () => app.evaluate(({ BrowserWindow }, role) => {
        const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes(`role=${role}`));
        if (!window) throw new Error('SOP native window missing');
        return window.getBounds();
      }, mode);
      for (const edge of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
        for (const direction of [1, -1]) {
          const before = await bounds();
          const point = {
            x: edge.includes('w') ? 17 : edge.includes('e') ? before.width - 17 : before.width / 2,
            y: edge.includes('n') ? 4 : edge.includes('s') ? before.height - 4 : before.height / 2,
          };
          if (edge === 'e') point.x = before.width - 4;
          if (edge === 'w') point.x = 4;
          const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, point);
          expect(hit, `${edge} rounded edge hit target`).toContain(`sop-resize-${edge}`);
          const dx = (edge.includes('w') ? 10 : edge.includes('e') ? -10 : 0) * direction;
          const dy = (edge.includes('n') ? 10 : edge.includes('s') ? -10 : 0) * direction;
          await page.mouse.move(point.x, point.y);
          await page.mouse.down();
          await page.mouse.move(point.x + dx, point.y + dy);
          await page.mouse.up();
          await expect.poll(bounds, { message: `${edge} changes both requested dimensions` }).toMatchObject({
            width: before.width - Math.abs(dx) * direction, height: before.height - Math.abs(dy) * direction,
          });
        }
      }
    } finally {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
