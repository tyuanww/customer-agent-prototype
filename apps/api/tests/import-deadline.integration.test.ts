import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthorizationFixture, type AuthorizationFixture } from './support/authorization-sources-fixture.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const DENIED = '没有权限，请找人开通。';

/** PR-C unit: import reads the import set by domain, and a missing domain denies the whole
 * call before any snapshot revision is written. */
describe.skipIf(!enabled)('import reads the source set by domain', () => {
  let fixture: AuthorizationFixture;

  beforeEach(async () => { fixture = await createAuthorizationFixture('import_deadline'); }, 120_000);
  afterEach(async () => { await fixture?.close(); }, 60_000);

  it('rejects an import domain outside the import set and does not advance snapshots', async () => {
    await fixture.admin.query(`INSERT INTO content_intake.grants(
        grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, action, starts_at, expires_at, reason)
      VALUES ('grant-alloc-import','allocation','signer','signer','tenant-menokin','app-customer-agent','scope-product','import',
        clock_timestamp()-interval '2 minutes', clock_timestamp()+interval '2 days', '分配导入。')`);
    await fixture.admin.query(`INSERT INTO content_intake.grants(
        grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
        starts_at, expires_at, reason, parent_grant_id)
      VALUES ('grant-import','business','signer','director','tenant-menokin','app-customer-agent','scope-product',NULL,'import',
        clock_timestamp()-interval '1 minute', clock_timestamp()+interval '1 day', '导入。','grant-alloc-import')`);

    const missing = '[{"domain":"aftersale","source_version_id":"srcv_missing"}]';
    const covered = '[{"domain":"product","source_version_id":"srcv_product"}]';
    expect(await fixture.importMessage('user-director', 'agent', missing)).toBe(DENIED);

    // The snapshot advance shares the same gate, so the refused batch cannot have moved a hash.
    let advanceMessage = 'accepted';
    try {
      await fixture.admin.query(
        'SELECT public.advance_source_snapshots($1::jsonb,$2,$3,$4)',
        [missing, 'ab'.repeat(32), 'user-director', 'imp_probe'],
      );
    } catch (error) {
      advanceMessage = error instanceof Error ? error.message : 'error';
    }
    expect(advanceMessage).toBe(DENIED);
    const advanced = await fixture.admin.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM public.source_snapshot_revisions');
    expect(advanced.rows[0]?.count).toBe(0);

    const accepted = await fixture.importMessage('user-director', 'agent', covered);
    expect(accepted).not.toBe(DENIED);
    expect(accepted).not.toBe('资料资格过期了，请稍后重试。');
  });

  it('sends the denial sentence in the HTTP body of a refused import', async () => {
    // The operator reads a response. A route that replaced this sentence with the generic
    // forbidden copy would still pass the SQL-level tests above.
    const mounted = await fixture.mountImportRoutes();
    try {
      const form = new FormData();
      form.set('file', new Blob([Buffer.from('script_id,category,title,answer_text\nx,product,标题,正文\n')], { type: 'text/csv' }), 'denied.csv');
      form.set('source_bindings', JSON.stringify([{ domain: 'product', source_version_id: 'srcv_product' }]));
      const response = await mounted.app.inject({
        method: 'POST', url: '/v1/content/import',
        headers: { authorization: `Bearer ${mounted.tokenFor('user-agent', 'agent')}`, 'idempotency-key': 'import-denial-sentence' },
        payload: form,
      });
      // The agent holds no import grant, so the source set refuses before any batch is created.
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { message: DENIED } });

      // A closed facts window on the same door gets the other sentence, not this one.
      const stale = await mounted.app.inject({
        method: 'POST', url: '/v1/content/import',
        headers: { authorization: `Bearer ${mounted.tokenFor('user-stale', 'owner')}`, 'idempotency-key': 'import-stale-sentence' },
        payload: form,
      });
      expect(stale.statusCode).toBe(403);
      expect(stale.json()).toMatchObject({ error: { message: '资料资格过期了，请稍后重试。' } });
    } finally {
      await mounted.close();
    }
  });
});
