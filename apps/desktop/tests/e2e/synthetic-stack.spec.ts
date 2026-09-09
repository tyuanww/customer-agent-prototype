import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url));

/** Read the stack's own profile module so the test follows the same SSOT. */
async function readProfile() {
  const module = await import(pathToFileURL(path.join(repositoryRoot, 'scripts/synthetic-stack/profile.ts')).href);
  return module.readProfile();
}

/**
 * Real-stack end-to-end: the desktop client logs in through the synthetic
 * identity provider, searches the seeded PostgreSQL content over loopback, and
 * copies a candidate. Unlike product-session.spec.ts the HTTP side is a real
 * API process with a real isolated PG15 cluster, so this proves the M1 stack is
 * consumable — not just that the adapter works against a wire double.
 *
 * It still is not human acceptance: no Dock/Cmd+Tab/IME/Stage Manager evidence.
 * The stack must already be running (`stack.ts start`).
 */
test('desktop client queries the running synthetic stack and copies a candidate', async () => {
  const profile = await readProfile();
  expect(profile, 'run `node scripts/synthetic-stack/stack.ts start` first').toBeTruthy();
  const directory = mkdtempSync(path.join(tmpdir(), 'desktop-stack-e2e-'));
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      cwd: root,
      args: [`--user-data-dir=${directory}`, path.join(root, 'out/main/index.js')],
      env: {
        ...process.env,
        CUSTOMER_AGENT_DESKTOP_API_ORIGIN: profile!.apiOrigin,
        CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN: profile!.identityOrigin,
      },
      timeout: 30_000,
    });
    await expect.poll(() => app!.windows().some((window) => window.url().includes('role=query'))).toBe(true);
    const query = app.windows().find((window) => window.url().includes('role=query'))!;
    await query.evaluate(() => window.customerAgent!.openSearch());

    await query.getByRole('button', { name: '合成登录' }).click();
    await expect(query.getByRole('button', { name: /agent/ })).toBeVisible({ timeout: 30_000 });
    expect(JSON.stringify(await query.evaluate(() => window.customerAgent!.product!.sessionStatus())))
      .not.toContain('access_token');

    // The catalog is served by main, so the renderer never invents scope ids.
    const catalog = await query.evaluate(() => window.customerAgent!.productCatalog!.list());
    expect(catalog.ok).toBe(true);
    if (catalog.ok) {
      expect(catalog.entries).toContainEqual({ type: 'sku', id: 'sku_chengyajiemian', label: '澄芽氨基酸洁面乳', parentId: 'cat_cleanser' });
      expect(catalog.entries).toContainEqual({ type: 'category', id: 'cat_cleanser', label: '洁面', parentId: null });
    }

    await query.getByTestId('question-input').fill('什么时候发货');
    await query.getByTestId('search-button').click();
    await query.getByLabel('查询平台').selectOption('qianniu');
    await query.getByTestId('search-button').click();
    await expect(query.getByTestId('answer-text-1')).toContainText('48 小时', { timeout: 20_000 });

    await query.getByTestId('copy-button-1').click();
    await expect(query.getByTestId('copy-button-1')).toHaveText('已复制', { timeout: 20_000 });
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied).toContain('48 小时');
    expect(copied).not.toContain('{订单号}');

    await query.evaluate(() => window.customerAgent!.product!.logout());
    await expect(query.getByRole('button', { name: '合成登录' })).toBeVisible();
    expect(existsSync(path.join(directory, 'product-session.enc'))).toBe(false);
  } finally {
    await app?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
