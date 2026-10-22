import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthorizationFixture, type AuthorizationFixture } from './support/authorization-sources-fixture.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const DENIED = '没有权限，请找人开通。';
const DOMAINS = ['presale', 'campaign', 'aftersale', 'product'] as const;

/** One binding per domain. The enqueue body requires exactly the four source domains, so an
 * import can only be accepted with a complete set. */
function bindingsFor(domains: readonly string[]): string {
  return JSON.stringify(domains.map(domain => ({ domain, source_version_id: `srcv_${domain}` })));
}

/** Import reads the import set by domain, and a missing domain denies the whole
 * call before any snapshot revision is written. */
describe.skipIf(!enabled)('import reads the source set by domain', () => {
  let fixture: AuthorizationFixture;

  beforeEach(async () => { fixture = await createAuthorizationFixture('import_deadline'); }, 120_000);
  afterEach(async () => { await fixture?.close(); }, 60_000);

  /** Four canonical source versions and a live import grant on the named domains. The four
   * scopes come from the fixture's rollback helper, which registers one per domain. */
  const seedImport = async (domains: readonly string[]): Promise<void> => {
    await fixture.admin.query(`INSERT INTO public.authoritative_source_versions(
        source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
        use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at)
      SELECT 'srcv_' || domain, 'SRC-' || upper(domain), domain, 'v1', repeat('ab',32),
        'canonical','ROLE-CONTENT-LEAD','EVD','synthetic-owner','2020-01-01T00:00:00Z','2099-01-01T00:00:00Z'
      FROM unnest($1::text[]) AS domain
      ON CONFLICT (source_version_id) DO NOTHING`, [DOMAINS]);
    for (const domain of domains) {
      await fixture.admin.query(`INSERT INTO content_intake.grants(
          grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, action, starts_at, expires_at, reason)
        VALUES ($1,'allocation','signer','signer','tenant-menokin','app-customer-agent',$2,'import',
          clock_timestamp()-interval '2 minutes', clock_timestamp()+interval '2 days', '分配导入。')`,
        [`grant-alloc-import-${domain}`, `scope-${domain}`]);
      await fixture.admin.query(`INSERT INTO content_intake.grants(
          grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
          starts_at, expires_at, reason, parent_grant_id, steward_id)
        VALUES ($1,'business','signer','director','tenant-menokin','app-customer-agent',$2,NULL,'import',
          clock_timestamp()-interval '1 minute', clock_timestamp()+interval '1 day', '导入。',$3,'signer')`,
        [`grant-import-${domain}`, `scope-${domain}`, `grant-alloc-import-${domain}`]);
    }
  };

  const revisions = async (): Promise<number> => {
    const counted = await fixture.admin.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM public.source_snapshot_revisions');
    return counted.rows[0]?.count ?? -1;
  };

  it('rejects one missing import domain, accepts the complete set, and advances only then', async () => {
    await fixture.grantRollbackOnEveryDomain();
    await seedImport(['presale', 'campaign', 'aftersale']);

    // The product binding is outside the set, so the whole four-domain batch is refused.
    expect(await fixture.importMessage('user-director', 'agent', bindingsFor(DOMAINS))).toBe(DENIED);
    // A session role does not stand in for an import grant: an owner with no grant is refused.
    expect(await fixture.importMessage('user-signer', 'owner', bindingsFor(DOMAINS))).toBe(DENIED);

    // The snapshot advance shares the gate, so the refused batch cannot have moved a hash.
    let advanceMessage = 'accepted';
    try {
      await fixture.admin.query(
        'SELECT public.advance_source_snapshots($1::jsonb,$2,$3,$4)',
        [bindingsFor(DOMAINS), 'ab'.repeat(32), 'user-director', 'imp_probe'],
      );
    } catch (error) {
      advanceMessage = error instanceof Error ? error.message : 'error';
    }
    expect(advanceMessage).toBe(DENIED);
    expect(await revisions()).toBe(0);

    await seedImport(['product']);
    // Production calls the advance before the enqueue, so the covered set proves both halves:
    // four revisions are written, and the batch then reaches the accept path.
    await fixture.admin.query(
      'SELECT public.advance_source_snapshots($1::jsonb,$2,$3,$4)',
      [bindingsFor(DOMAINS), 'ab'.repeat(32), 'user-director', 'imp_probe'],
    );
    expect(await revisions()).toBe(4);
    expect(await fixture.importMessage('user-director', 'agent', bindingsFor(DOMAINS))).toBe('accepted');
  });

  it('matches the batch domains to the import set in both directions', async () => {
    // A pass/fail assertion alone cannot tell an over-wide set from a correct one, so compare
    // the allowed domains and the batch domains in both directions.
    await fixture.grantRollbackOnEveryDomain();
    await seedImport(['presale', 'campaign', 'aftersale']);

    const difference = async (domains: readonly string[]) => {
      const result = await fixture.admin.query<{ allowed_minus_batch: string[] | null; batch_minus_allowed: string[] | null }>(`
        WITH allowed AS (
          SELECT DISTINCT scope.domain
          FROM content_intake.authorization_sources('director', 'import', clock_timestamp()) allowed_row
          JOIN content_intake.scopes scope ON scope.scope_id = allowed_row.scope_id
        ), batch AS (
          SELECT domain FROM pg_catalog.jsonb_to_recordset($1::jsonb) AS requested(domain TEXT, source_version_id TEXT)
        )
        SELECT
          (SELECT array_agg(domain ORDER BY domain) FROM (SELECT domain FROM allowed EXCEPT SELECT domain FROM batch) x) AS allowed_minus_batch,
          (SELECT array_agg(domain ORDER BY domain) FROM (SELECT domain FROM batch EXCEPT SELECT domain FROM allowed) x) AS batch_minus_allowed`,
        [bindingsFor(domains)]);
      return result.rows[0];
    };

    // With one domain's grant missing the batch is wider by exactly that domain, and the
    // allowed side has nothing the batch lacks.
    expect(await difference(DOMAINS)).toEqual({ allowed_minus_batch: null, batch_minus_allowed: ['product'] });

    // Adding the fourth grant makes both directions empty: the set is neither short nor wide.
    await seedImport(['product']);
    expect(await difference(DOMAINS)).toEqual({ allowed_minus_batch: null, batch_minus_allowed: null });
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
        headers: { authorization: `Bearer ${mounted.tokenFor('user-signer', 'owner')}`, 'idempotency-key': 'import-denial-sentence' },
        payload: form,
      });
      // The historical batch chain is operator-only, so the caller must be an owner to reach
      // the source-set gate at all. This owner holds no import grant, so the source set still
      // refuses before any batch is created — which is the sentence this case pins.
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
