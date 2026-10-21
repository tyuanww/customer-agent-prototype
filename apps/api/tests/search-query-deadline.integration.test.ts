import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import type { Client } from 'pg';
import { createHash } from 'node:crypto';
import { seedQueryPrincipal } from './support/query-principal.js';
import { createAuthorizationFixture } from './support/authorization-sources-fixture.js';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const DENIED = '没有权限，请找人开通。';
const STALE = '资料资格过期了，请稍后重试。';
const ACTOR = 'usr_synthetic_search_deadline';
const DOMAINS = ['presale', 'campaign', 'aftersale', 'product'] as const;

/**
 * PR-A unit: search reads the query source set at one clock and returns only items whose
 * registered source version belongs to an allowed domain. The plan's lineage join was
 * replaced by this domain gate because release_items and release_lineage are written by
 * two disjoint publishers; the tests below pin the behaviour that decision produces.
 */
describe.skipIf(!enabled)('search reads the query source set by domain', () => {
  let harness: Pg15Harness;
  let admin: Client;

  beforeEach(async () => {
    harness = new Pg15Harness();
    harness.start();
    admin = await harness.connect(harness.createDatabase('search_deadline').config);
    await applyDatabaseMigrations(admin);
    await seedRelease(admin);
  }, 120_000);

  afterEach(async () => {
    await admin?.end();
    harness?.stop();
  }, 60_000);

  /** One published release with one item per domain, so a grant for a subset is observable. */
  const seedRelease = async (client: Client): Promise<void> => {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.publishing', 'on', true)");
    await client.query("SELECT set_config('app.semantic_asset_write', 'publish', true)");
    for (const domain of DOMAINS) {
      await client.query(
        `INSERT INTO public.authoritative_source_versions(
           source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
           use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at)
         VALUES ($1, $2, $3, 'v1', repeat(substr(pg_catalog.md5($3), 1, 2), 32), 'canonical', 'ROLE-CONTENT-LEAD',
           'EVD', 'synthetic-owner', clock_timestamp() - interval '1 day',
           clock_timestamp() + interval '365 days')
         ON CONFLICT (source_version_id) DO NOTHING`,
        [`srcv_dl_${domain}`, `SRC-DL-${domain.toUpperCase()}`, domain]);
    }
    await client.query(
      `INSERT INTO public.intent_taxonomy_versions(intent_taxonomy_version, approval_evd, approved_by, approved_at)
       VALUES ('itax_dl', 'EVD', 'synthetic-owner', clock_timestamp()) ON CONFLICT DO NOTHING`);
    await client.query(
      `INSERT INTO public.intent_taxonomy_entries(intent_taxonomy_version, intent_id, label, lifecycle)
       VALUES ('itax_dl', 'intent_dl', '合成意图', 'active') ON CONFLICT DO NOTHING`);
    // The gate recomputes this digest from the release bindings, so it has to be the same
    // sha256 over `domain:source_version_id` that the bindings below describe.
    // The deferred constraint trigger orders the pairs by domain, not by declaration order.
    const sourceBindingHash = sha256(
      [...DOMAINS].sort().map(domain => `${domain}:srcv_dl_${domain}`).join('|'));
    await client.query(
      `INSERT INTO public.content_releases(
         release_id, release_seq, title, status, source_binding_hash, published_by, published_by_role)
       VALUES ('rel_dl', 1, '合成搜索发布', 'published', $1, 'synthetic-owner', 'owner')
       ON CONFLICT (release_id) DO NOTHING`,
      [sourceBindingHash]);
    for (const domain of DOMAINS) {
      await client.query(
        `INSERT INTO public.release_source_bindings(release_id, domain, source_version_id)
         VALUES ('rel_dl', $1, $2) ON CONFLICT DO NOTHING`,
        [domain, `srcv_dl_${domain}`]);
      // A release item needs at least one question aligned to its intent, so each item gets
      // a real question row rather than an empty array.
      const questionBase = {
        question_id: `q_dl_${domain}`,
        question_version: 1,
        question_text: `合成${domain}问题`,
        semantic_family_id: `sf_dl_${domain}`,
        origin_fingerprint: sha256(`synthetic-dl-origin-${domain}`),
        origin_fingerprint_key_version: 'hmac-synthetic-v1',
        source_asset_id: `sa_dl_${domain}`,
        source: 'manual',
        intent_taxonomy_version: 'itax_dl',
        intent_id: 'intent_dl',
      };
      await client.query(
        `INSERT INTO public.semantic_source_assets(
           source_asset_id, source, origin_fingerprint, origin_fingerprint_key_version)
         VALUES ($1, 'manual', $2, 'hmac-synthetic-v1') ON CONFLICT DO NOTHING`,
        [questionBase.source_asset_id, questionBase.origin_fingerprint]);
      const questionHash = await client.query<{ question_hash: string }>(
        'SELECT public.content_question_hash($1::jsonb) AS question_hash',
        [JSON.stringify(questionBase)]);
      const questions = [{ ...questionBase, question_hash: questionHash.rows[0]?.question_hash }];
      // Read the source version back from the table instead of re-deriving its domain and
      // source_ref: the release item's foreign key compares all three columns.
      await client.query(
        `INSERT INTO public.release_items(
           release_id, script_id, script_version, content_hash, answer_text, title, category,
           source_ref, source_version_id, owner_role, review_due_at, effective_from, effective_to,
           platform_scope, product_scope_type, product_scope_refs, intent_taxonomy_version,
           intent_id, risk_level, risk_categories, has_conflict, review_mode,
           primary_reviewer_id, primary_reviewer_role, primary_review_evd, placeholder_keys,
           questions_json, search_document, search_fallback_text)
         SELECT 'rel_dl', $1, 1, repeat('ab', 32), $2, $2, source_version.domain,
           source_version.source_ref, source_version.source_version_id, 'ROLE-CONTENT-LEAD',
           pg_catalog.clock_timestamp() + interval '90 days',
           pg_catalog.clock_timestamp() - interval '1 day',
           -- A campaign item is required to carry a closing date; the others stay open.
           CASE WHEN source_version.domain = 'campaign'
                THEN pg_catalog.clock_timestamp() + interval '30 days' ELSE NULL END,
           ARRAY['qianniu'], 'storewide', ARRAY[]::text[], 'itax_dl', 'intent_dl', 'low',
           ARRAY[]::text[], false, 'single', repeat('a', 64), 'ROLE-CONTENT-LEAD', 'EVD',
           ARRAY[]::text[], $3::jsonb, pg_catalog.to_tsvector('simple', $2), $2
         FROM public.authoritative_source_versions source_version
         WHERE source_version.source_version_id = $4
         ON CONFLICT (release_id, script_id) DO NOTHING`,
        [`script_dl_${domain}`, `合成${domain}话术`, JSON.stringify(questions), `srcv_dl_${domain}`]);
    }
    await client.query(
      `INSERT INTO public.content_current(id, current_release_id) VALUES (1, 'rel_dl')
       ON CONFLICT (id) DO UPDATE SET current_release_id = 'rel_dl'`);
    await client.query('COMMIT');
  };

  const search = async (actor: string): Promise<{ scriptIds: string[] } | { message: string }> => {
    try {
      const result = await admin.query<{ script_id: string | null }>(
        `SELECT script_id FROM public.search_recommendable_scripts($1::text, 'qianniu', NULL, NULL)`,
        [actor]);
      return { scriptIds: result.rows.map(row => row.script_id).filter((id): id is string => id !== null) };
    } catch (error) {
      return { message: error instanceof Error ? error.message : 'error' };
    }
  };

  it('refuses a session with no principal and a session with no query grant', async () => {
    await seedQueryPrincipal(admin, { userId: ACTOR, domains: ['product'] });
    // A user id with no principal row cannot be resolved into an allowed set.
    expect(await search('usr_missing_principal')).toEqual({ message: DENIED });
    // A principal with facts and a role but no grant is refused on the same rule. The
    // principals/facts foreign key is deferred, so both rows go in one transaction.
    await admin.query('BEGIN');
    await admin.query(
      `INSERT INTO backend_identity.subject_bindings(
         binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
       VALUES ('binding-no-grant', 'synthetic', 'tenant-search-fixture', 'binding-no-grant',
         'usr_no_grant', repeat('ab', 32), true, 'owner')`);
    await admin.query(
      `INSERT INTO content_intake.principals(
         principal_id, user_id, tenant_id, app_id, identity_scope, person_key,
         current_facts_version, revocation_generation)
       VALUES ('prn-no-grant', 'usr_no_grant', 'tenant-search-fixture', 'app-search-fixture',
         'confirmed-synthetic', 'prn-no-grant', 1, 0)`);
    await admin.query(
      `INSERT INTO content_intake.principal_facts(
         principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest)
       VALUES ('prn-no-grant', 1, ARRAY['dept-search-fixture']::text[], 'job-search-fixture', true,
         statement_timestamp() - interval '1 second',
         statement_timestamp() + interval '4 minutes 59 seconds', repeat('ab', 32))`);
    await admin.query('COMMIT');
    expect(await search('usr_no_grant')).toEqual({ message: DENIED });
  });

  it('returns only the items whose domain the grant reaches, in both directions', async () => {
    await seedQueryPrincipal(admin, { userId: ACTOR, domains: ['product'] });
    const allowed = await search(ACTOR);
    expect(allowed).toEqual({ scriptIds: ['script_dl_product'] });

    // Both EXCEPT directions: the returned ids equal the product item, and nothing else.
    const difference = await admin.query<{ missing: string[] | null; extra: string[] | null }>(`
      WITH returned AS (
        SELECT script_id FROM public.search_recommendable_scripts($1::text, 'qianniu', NULL, NULL)
        WHERE script_id IS NOT NULL
      ), expected AS (SELECT 'script_dl_product'::text AS script_id)
      SELECT
        (SELECT array_agg(script_id) FROM (SELECT script_id FROM expected EXCEPT SELECT script_id FROM returned) x) AS missing,
        (SELECT array_agg(script_id) FROM (SELECT script_id FROM returned EXCEPT SELECT script_id FROM expected) x) AS extra`,
      [ACTOR]);
    expect(difference.rows[0]).toEqual({ missing: null, extra: null });
  });

  it('gives a closed facts window its own sentence instead of the denial', async () => {
    // The facts history is immutable, so the window is seeded closed instead of edited later.
    await seedQueryPrincipal(admin, { userId: ACTOR, domains: ['product'], factsWindow: 'expired' });
    expect(await search(ACTOR)).toEqual({ message: STALE });
  });

  it('sends both refusal sentences over the real HTTP search door', async () => {
    // The operator reads a response body, not a caught SQL message. A route that dropped the
    // sentence would still pass every SQL-level case above, and would tell an operator whose
    // facts window closed to go ask for access.
    const http = await createAuthorizationFixture('search_http');
    try {
      await seedQueryPrincipal(http.admin, { userId: ACTOR, domains: ['product'] });
      await seedQueryPrincipal(http.admin, { userId: `${ACTOR}-stale`, domains: ['product'], factsWindow: 'expired' });
      const mounted = await http.mountSearchRoutes();
      try {
        const ask = (userId: string, queryId: string) => mounted.app.inject({
          method: 'POST', url: '/v1/search',
          headers: { authorization: `Bearer ${mounted.tokenFor(userId)}` },
          payload: {
            query_id: queryId, parent_query_id: null, interaction_reason: 'original',
            query_text: '合成查询', collection_mode: 'synthetic',
            detected_platform: 'qianniu', platform: 'qianniu', platform_source: 'manual',
            product_context_type: null, product_context_ref: null, top_k: 3,
          },
        });
        const stale = await ask(`${ACTOR}-stale`, '0f0f0f0f-1111-2222-3333-444444444451');
        expect(stale.statusCode).toBe(403);
        expect(stale.json()).toMatchObject({ error: { message: STALE } });

        // Revoke the only query grant, then ask again as the same session.
        await http.admin.query(`UPDATE content_intake.grants SET version = version + 1,
          revoked_at = clock_timestamp(), last_change_reason = 'synthetic lane revoke'
          WHERE recipient_id = $1 AND action = 'query' AND revoked_at IS NULL`, [`prn-search-${ACTOR}`]);
        const denied = await ask(ACTOR, '0f0f0f0f-1111-2222-3333-444444444452');
        expect(denied.statusCode).toBe(403);
        expect(denied.json()).toMatchObject({ error: { message: DENIED } });
      } finally {
        await mounted.close();
      }
    } finally {
      await http.close();
    }
  });

  it('refuses the ungated three-argument signature for every caller', async () => {
    // Historical migrations verify their own step against this signature, so it must exist;
    // it must not be a way to read scripts without a source set.
    const exists = await admin.query<{ present: boolean }>(
      `SELECT pg_catalog.to_regprocedure('public.search_recommendable_scripts(text,text,text)') IS NOT NULL AS present`);
    expect(exists.rows[0]?.present).toBe(true);
    // Even the schema owner gets the sentence, so an empty result can never mean "allowed".
    await expect(admin.query(
      `SELECT * FROM public.search_recommendable_scripts('qianniu', NULL, NULL) LIMIT 1`,
    )).rejects.toMatchObject({ message: DENIED });
  });
});
