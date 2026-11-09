import { expect, test } from '@playwright/test';
import { runSopQueryProbe } from '../support/sop-query-probe';

/** The API worker owns migrations, persisted fixtures, HTTP and identity.
 * This test consumes those facts through the shipped desktop, never an injected projection. */
test('temporary PG SOP release reaches Electron and parent revocation removes copy authority', async () => {
  test.skip(process.env.CUSTOMER_AGENT_SOP_QUERY_CANDIDATE !== '1', 'Requires the isolated SOP query candidate host');
  test.setTimeout(180_000);
  const moduleUrl = new URL('../../../api/tests/support/sop-query-synthetic-host.ts', import.meta.url);
  const { createSopQuerySyntheticHost } = await import(moduleUrl.href);
  const host = await createSopQuerySyntheticHost();
  try {
    // The product profile requires independent adjacent loopback origins. The
    // host must implement normal authorization discovery as well as SOP reads.
    expect(host.identityOrigin, 'SOP host must expose the ordinary distinct identity origin').not.toBe(host.apiOrigin);
    await runSopQueryProbe({
      synthetic: true,
      apiOrigin: host.apiOrigin,
      identityOrigin: host.identityOrigin,
      shop: 'shop-a',
      group: '过敏流程SOP',
      query: '合成过敏',
      branches: [],
      expectedMessage: host.graph.graph.entries[0].entry.answerText,
    }, async ({ app, sop }) => {
      await sop.screenshot({ path: test.info().outputPath('sop-query-ready.png') });
      const leases = await host.admin.query('SELECT request_id,release_id,issued_at,expires_at FROM content_intake.sop_query_leases ORDER BY issued_at');
      expect(leases.rows.length).toBeGreaterThanOrEqual(2);
      for (const lease of leases.rows) {
        expect(lease.release_id).toBe('rel_graph_initial');
        expect(new Date(lease.expires_at).getTime()).toBeGreaterThan(new Date(lease.issued_at).getTime());
      }
      await test.info().attach('sop-query-release-leases', {
        body: Buffer.from(JSON.stringify(leases.rows, null, 2)), contentType: 'application/json',
      });
      const query = app.windows().find(window => window.url().includes('role=query'))!;
      await query.evaluate(() => window.customerAgent!.product!.logout());
      await expect(sop.locator('article')).toHaveCount(0);
      await sop.getByRole('button', { name: '收起流程，保留进度' }).click();
      await query.evaluate(() => window.customerAgent!.openSearch());
      await query.getByRole('button', { name: '登录', exact: true }).click();
      await expect.poll(() => app.windows().some(window => window.url().includes('role=login'))).toBe(true);
      const login = app.windows().find(window => window.url().includes('role=login'))!;
      await login.getByRole('button', { name: '飞书登录' }).click();
      await expect.poll(() => query.evaluate(async () => {
        const status = await window.customerAgent!.product!.sessionStatus();
        return status.ok && status.signedIn;
      })).toBe(true);
      await query.getByRole('button', { name: '打开 SOP 流程' }).click();
      await expect(sop.getByRole('combobox', { name: '店铺' }).locator('option')).toHaveCount(2);
      await sop.getByRole('combobox', { name: '店铺' }).selectOption({ label: 'shop-a' });
      await sop.getByRole('button', { name: '查询流程' }).click();
      await expect(sop.getByTestId('sop-query-shell')).toHaveAttribute('data-state', 'ready');
      await host.revokeQuery();
      const before = await app.evaluate(({ clipboard }) => clipboard.readText());
      await sop.getByRole('button', { name: '复制话术' }).click();
      await expect(sop.getByTestId('sop-query-shell')).toHaveAttribute('data-state', /stale|blocked/);
      await expect(sop.locator('article')).toHaveCount(0);
      expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(before);
    });
  } finally { await host.close(); }
});
