import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthorizationFixture, type AuthorizationFixture } from './support/authorization-sources-fixture.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const DENIED = '没有权限，请找人开通。';
const STALE = '资料资格过期了，请稍后重试。';

/** Publish and rollback read authorization_sources at one clock, compare domains
 * only, and refuse the whole call when one domain is missing. The session role is never the
 * gate, so an owner or coach session without a grant is refused like anyone else. */
describe.skipIf(!enabled)('publish and rollback read the source set by domain', () => {
  let fixture: AuthorizationFixture;

  beforeEach(async () => { fixture = await createAuthorizationFixture('publish_deadline'); }, 120_000);
  afterEach(async () => { await fixture?.close(); }, 60_000);

  it('rejects one missing batch domain and does not use the session role', async () => {
    await fixture.admin.query(`INSERT INTO public.authoritative_source_versions(
        source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
        use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at)
      VALUES
        ('srcv_product','SRC-PRODUCT','product','v1',repeat('ab',32),'canonical','ROLE-CONTENT-LEAD','EVD','synthetic-owner','2020-01-01T00:00:00Z','2099-01-01T00:00:00Z'),
        ('srcv_aftersale','SRC-AFTERSALE','aftersale','v1',repeat('cd',32),'canonical','ROLE-CONTENT-LEAD','EVD','synthetic-owner','2020-01-01T00:00:00Z','2099-01-01T00:00:00Z')`);
    await fixture.admin.query(`INSERT INTO public.import_batches(import_batch_id, source_type, source_binding_hash, status)
      VALUES ('batch-covered','csv',repeat('ab',32),'staged'), ('batch-missing','csv',repeat('cd',32),'staged')`);
    await fixture.admin.query("SELECT set_config('app.import_binding_write','on',false)");
    await fixture.admin.query(`INSERT INTO public.import_batch_source_bindings(import_batch_id, domain, source_version_id)
      VALUES ('batch-covered','product','srcv_product'), ('batch-missing','aftersale','srcv_aftersale')`);

    // A batch domain outside the set denies the whole call, even for a director-role session.
    expect(await fixture.publishMessage('user-director', 'agent', 'batch-missing')).toBe(DENIED);
    // The signer holds no publish grant at all, so an owner session is refused on the same rule.
    expect(await fixture.publishMessage('user-signer', 'owner', 'batch-covered')).toBe(DENIED);
    const covered = await fixture.publishMessage('user-director', 'agent', 'batch-covered');
    expect(covered).not.toBe(DENIED);
    expect(covered).not.toBe(STALE);
    // A closed facts window gets its own sentence, not the generic denial.
    expect(await fixture.publishMessage('user-stale', 'owner', 'batch-covered')).toBe(STALE);
  });

  it('refuses 过敏 and 赔付 text for every publisher that passes the domain gate', async () => {
    await fixture.admin.query(`INSERT INTO public.authoritative_source_versions(
        source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
        use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at)
      VALUES ('srcv_product','SRC-PRODUCT','product','v1',repeat('ab',32),
        'canonical','ROLE-CONTENT-LEAD','EVD','synthetic-owner','2020-01-01T00:00:00Z','2099-01-01T00:00:00Z')
      ON CONFLICT (source_version_id) DO NOTHING`);
    await fixture.admin.query(`INSERT INTO public.import_batches(import_batch_id, source_type, source_binding_hash, status)
      VALUES ('batch-allergy','csv',repeat('ef',32),'validating')`);
    await fixture.admin.query("SELECT set_config('app.import_binding_write','on',false)");
    await fixture.admin.query(`INSERT INTO public.import_batch_source_bindings(import_batch_id, domain, source_version_id)
      VALUES ('batch-allergy','product','srcv_product')`);
    await fixture.admin.query(`WITH q AS (
        SELECT jsonb_build_object(
          'question_id','q_allergy_0001',
          'question_version',1,
          'question_text','过敏了怎么办',
          'semantic_family_id','sf_allergy',
          'origin_fingerprint',repeat('ab',32),
          'origin_fingerprint_key_version','v1',
          'source_asset_id','sa_allergy',
          'source','import',
          'intent_taxonomy_version','itax_v1',
          'intent_id','intent_allergy') AS base
      ), h AS (
        SELECT base, public.content_question_hash(base) AS hash FROM q
      )
      INSERT INTO public.staging_scripts(
        staging_id, import_batch_id, script_id, category, title, answer_text, content_hash,
        source_ref, source_version_id, owner_role, review_due_at, platform_scope,
        product_scope_type, product_scope_refs, effective_from, intent_taxonomy_version, intent_id,
        risk_level, risk_categories, has_conflict, review_mode,
        primary_reviewer_id, primary_reviewer_role, primary_review_evd, placeholder_keys,
        questions_json, search_document, search_fallback_text,
        validation_ok, quality_status, quality_gate_passed)
      SELECT 'stg_allergy','batch-allergy','sc_allergy','product','过敏了怎么办','先停用并观察',repeat('ab',32),
        'SRC-PRODUCT','srcv_product','ROLE-CONTENT-LEAD','2099-01-01T00:00:00Z',ARRAY['qianniu'],
        'storewide',ARRAY[]::text[],'2020-01-01T00:00:00Z','itax_v1','intent_allergy',
        'low',ARRAY[]::text[],false,'single',
        repeat('a',64),'ROLE-CONTENT-LEAD','EVD',ARRAY[]::text[],
        jsonb_build_array(jsonb_set(base,'{question_hash}',to_jsonb(hash))),to_tsvector('simple','过敏 处理'),'过敏 处理',
        true,'clean',true
      FROM h`);
    // The script-text refusal applies to every publisher, not only to a coach session.
    expect(await fixture.publishMessage('user-director', 'coach', 'batch-allergy'))
      .toBe('product and campaign scripts refuse 过敏 and 赔付');
  });

  it('rejects rollback when the release domain is outside the rollback set', async () => {
    await fixture.seedFourDomainRelease('rel_roll', 1);
    // The director holds a publish grant, which says nothing about rollback.
    expect(await fixture.rollbackMessage('user-director', 'owner', 'rel_roll')).toBe(DENIED);
  });

  it('passes the rollback gate once every release domain is in the rollback set', async () => {
    await fixture.seedFourDomainRelease('rel_roll', 1);
    await fixture.grantRollbackOnEveryDomain();
    const message = await fixture.rollbackMessage('user-director', 'agent', 'rel_roll');
    // The next refusal is about the release content, so the domain gate let this call through.
    expect(message).not.toBe(DENIED);
    expect(message).not.toBe(STALE);
    expect(message).toBe('target release snapshot is empty');
  });

  it('rejects rollback previous when the target domains are outside the rollback set', async () => {
    await fixture.seedFourDomainRelease('rel_roll', 1);
    await fixture.seedFourDomainRelease('rel_after', 2);
    await fixture.admin.query(`INSERT INTO public.content_current(id, current_release_id, updated_at)
      VALUES (1, 'rel_after', now()) ON CONFLICT (id) DO UPDATE SET current_release_id = 'rel_after'`);
    expect(await fixture.resolvePreviousMessage('user-signer')).toBe(DENIED);
  });

  it('matches the batch domains to the allowed set in both directions', async () => {
    // A pass/fail assertion alone cannot tell an over-wide set from a correct one. Comparing
    // both EXCEPT directions proves the allowed domains are exactly the batch domains for a
    // covered batch, and that the missing domain is the only difference for a refused one.
    await fixture.admin.query(`INSERT INTO public.authoritative_source_versions(
        source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
        use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at)
      VALUES
        ('srcv_product','SRC-PRODUCT','product','v1',repeat('ab',32),'canonical','ROLE-CONTENT-LEAD','EVD','synthetic-owner','2020-01-01T00:00:00Z','2099-01-01T00:00:00Z'),
        ('srcv_aftersale','SRC-AFTERSALE','aftersale','v1',repeat('cd',32),'canonical','ROLE-CONTENT-LEAD','EVD','synthetic-owner','2020-01-01T00:00:00Z','2099-01-01T00:00:00Z')`);
    await fixture.admin.query(`INSERT INTO public.import_batches(import_batch_id, source_type, source_binding_hash, status)
      VALUES ('batch-covered','csv',repeat('ab',32),'staged'), ('batch-missing','csv',repeat('cd',32),'staged')
      ON CONFLICT (import_batch_id) DO NOTHING`);
    await fixture.admin.query("SELECT set_config('app.import_binding_write','on',false)");
    await fixture.admin.query(`INSERT INTO public.import_batch_source_bindings(import_batch_id, domain, source_version_id)
      VALUES ('batch-covered','product','srcv_product'), ('batch-missing','aftersale','srcv_aftersale')
      ON CONFLICT DO NOTHING`);

    const difference = async (batchId: string) => {
      const result = await fixture.admin.query<{ allowed_minus_batch: string[] | null; batch_minus_allowed: string[] | null }>(`
        WITH allowed AS (
          SELECT DISTINCT scope.domain
          FROM content_intake.authorization_sources('director', 'publish', clock_timestamp()) allowed_row
          JOIN content_intake.scopes scope ON scope.scope_id = allowed_row.scope_id
        ), batch AS (
          SELECT domain FROM public.import_batch_source_bindings WHERE import_batch_id = $1
        )
        SELECT
          (SELECT array_agg(domain ORDER BY domain) FROM (SELECT domain FROM allowed EXCEPT SELECT domain FROM batch) x) AS allowed_minus_batch,
          (SELECT array_agg(domain ORDER BY domain) FROM (SELECT domain FROM batch EXCEPT SELECT domain FROM allowed) x) AS batch_minus_allowed`,
        [batchId]);
      return result.rows[0];
    };

    expect(await difference('batch-covered')).toEqual({ allowed_minus_batch: null, batch_minus_allowed: null });
    expect(await difference('batch-missing')).toEqual({
      allowed_minus_batch: ['product'],
      batch_minus_allowed: ['aftersale'],
    });
  });

  it('sends the denial sentence in the HTTP body, not only in the SQL message', async () => {
    await fixture.admin.query(`INSERT INTO public.authoritative_source_versions(
        source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
        use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at)
      VALUES ('srcv_product','SRC-PRODUCT','product','v1',repeat('ab',32),
        'canonical','ROLE-CONTENT-LEAD','EVD','synthetic-owner','2020-01-01T00:00:00Z','2099-01-01T00:00:00Z')
      ON CONFLICT (source_version_id) DO NOTHING`);
    await fixture.admin.query(`INSERT INTO public.import_batches(import_batch_id, source_type, source_binding_hash, status)
      VALUES ('batch_http_denied','csv',repeat('ab',32),'staged') ON CONFLICT DO NOTHING`);
    await fixture.admin.query("SELECT set_config('app.import_binding_write','on',false)");
    await fixture.admin.query(`INSERT INTO public.import_batch_source_bindings(import_batch_id, domain, source_version_id)
      VALUES ('batch_http_denied','product','srcv_product') ON CONFLICT DO NOTHING`);

    const mounted = await fixture.mountReleaseRoutes();
    try {
      const response = await mounted.app.inject({
        method: 'POST', url: '/v1/content/publish',
        headers: { authorization: `Bearer ${mounted.ownerToken}`, 'idempotency-key': 'denial-sentence', 'content-type': 'application/json' },
        payload: { import_batch_id: 'batch_http_denied', title: '标题', summary: '摘要' },
      });
      // The chain is operator-only, so reaching the domain gate requires an owner session.
      // This owner holds no publish grant, so the domain gate itself refuses — the sentence
      // this case pins. An agent session would stop earlier at admission with other wording.
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN', message: DENIED } });
    } finally {
      await mounted.close();
    }
  });
});
