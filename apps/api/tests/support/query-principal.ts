import type { Client } from 'pg';

/** A tenant/app pair that exists only inside the disposable test cluster. */
const TENANT = 'tenant-search-fixture';
const APP = 'app-search-fixture';
const BRAND = 'brand-search-fixture';
const DEPARTMENT = 'dept-search-fixture';
const JOB = 'job-search-fixture';
const ROLE = 'director';

export type QueryPrincipalSeed = Readonly<{
  userId: string;
  /** One scope, source and query grant is created per domain. */
  domains: readonly string[];
  /** 'expired' seeds a principal whose facts window has already closed, so the source set
   * drops every row and search reports the stale sentence rather than a missing grant. */
  factsWindow?: 'fresh' | 'expired';
}>;

/**
 * Make `userId` a principal that a search can run as: one scope per domain, a live store
 * set that contains every source, one role rule, and a query grant stamped with the policy
 * and store-set versions the source set reads.
 *
 * Search now refuses a caller with no live query source set, so every suite that used to
 * call the search function anonymously has to name one. The tenant names here are synthetic
 * and collide with nothing: the intake tables key on (tenant, app), not on release data.
 *
 * Order matters. Inserting a role rule records a policy-version bump, so the grants are
 * stamped last, from whatever version is current at that moment.
 */
export async function seedQueryPrincipal(admin: Client, seed: QueryPrincipalSeed): Promise<void> {
  const { userId, domains, factsWindow = 'fresh' } = seed;
  await admin.query('BEGIN');
  try {
    await admin.query(
      `INSERT INTO content_intake.policy_versions(tenant_id, app_id, version)
       VALUES ($1, $2, 1) ON CONFLICT DO NOTHING`,
      [TENANT, APP]);
    for (const domain of domains) {
      await admin.query(
        `INSERT INTO content_intake.scopes(scope_id, tenant_id, app_id, brand_id, domain)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (scope_id) DO NOTHING`,
        [`scope-search-${domain}`, TENANT, APP, BRAND, domain]);
      await admin.query(
        `INSERT INTO content_intake.sources(source_id, scope_id, current_mapping_version, mode)
         VALUES ($1, $2, 1, 'v2-preview') ON CONFLICT (source_id) DO NOTHING`,
        [`source-search-${domain}`, `scope-search-${domain}`]);
      await admin.query(
        `INSERT INTO content_intake.source_mappings(
           source_id, version, template_version, rule_version, mapping_version, structure_digest)
         VALUES ($1, 1, 'faq-p1.1', 'intake-p1.1', 'faq-map', repeat('ab', 32))
         ON CONFLICT (source_id, version) DO NOTHING`,
        [`source-search-${domain}`]);
    }
    await admin.query(
      `INSERT INTO content_intake.store_sets(tenant_id, app_id, version, approved_at, provenance)
       VALUES ($1, $2, 1, clock_timestamp(), 'proof') ON CONFLICT DO NOTHING`,
      [TENANT, APP]);
    await admin.query(
      `INSERT INTO content_intake.store_set_current(tenant_id, app_id, version)
       VALUES ($1, $2, 1) ON CONFLICT (tenant_id, app_id) DO UPDATE SET version = 1`,
      [TENANT, APP]);
    for (const domain of domains) {
      await admin.query(
        `INSERT INTO content_intake.store_set_members(
           tenant_id, app_id, version, scope_id, source_id, content_valid_until)
         VALUES ($1, $2, 1, $3, $4, clock_timestamp() + interval '1 day')
         ON CONFLICT DO NOTHING`,
        [TENANT, APP, `scope-search-${domain}`, `source-search-${domain}`]);
    }

    const principalId = `prn-search-${userId}`;
    // A principal's user_id must already be a bound subject, so bind one for each identity.
    for (const [bindingId, bindingUser] of [
      [`binding-search-${userId}`, userId],
      [`binding-search-issuer-${userId}`, `${userId}-issuer`],
    ] as const) {
      await admin.query(
        `INSERT INTO backend_identity.subject_bindings(
           binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
         VALUES ($1, 'synthetic', $2, $3, $4, repeat('ab', 32), true, 'owner')
         ON CONFLICT (binding_id) DO NOTHING`,
        [bindingId, TENANT, bindingId, bindingUser]);
    }
    await admin.query(
      `INSERT INTO content_intake.role_rules(tenant_id, app_id, department_id, job_id, policy_version, role)
       VALUES ($1, $2, $3, $4, 1, $5)
       ON CONFLICT DO NOTHING`,
      [TENANT, APP, DEPARTMENT, JOB, ROLE]);

    const issuerId = `prn-search-issuer-${userId}`;
    // Both identities need a facts row: principals.current_facts_version is a deferred foreign
    // key, so a missing row only fails at COMMIT and reads like an unrelated error.
    for (const identity of [principalId, issuerId]) {
      await admin.query(
        `INSERT INTO content_intake.principals(
           principal_id, user_id, tenant_id, app_id, identity_scope, person_key,
           current_facts_version, revocation_generation)
         VALUES ($1, $2, $3, $4, 'confirmed-synthetic', $1, 1, 0)
         ON CONFLICT (principal_id) DO NOTHING`,
        [identity, identity === issuerId ? `${userId}-issuer` : userId, TENANT, APP]);
      await admin.query(
        `INSERT INTO content_intake.principal_facts(
           principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest)
         VALUES ($1, 1, ARRAY[$2]::text[], $3, true,
           CASE WHEN $4 = 'expired'
             THEN statement_timestamp() - interval '4 minutes'
             ELSE statement_timestamp() - interval '1 second' END,
           CASE WHEN $4 = 'expired'
             THEN statement_timestamp() - interval '1 minute'
             ELSE statement_timestamp() + interval '4 minutes 59 seconds' END,
           repeat('ab', 32))
         ON CONFLICT (principal_id, facts_version) DO NOTHING`,
        [identity, DEPARTMENT, JOB, factsWindow]);
    }
    // Read the versions once, after the role rule has recorded its policy bump. Passing them
    // as plain values avoids inferring one parameter as both a domain-typed column and text.
    const versions = await admin.query<{ policy: string; store_set: string }>(
      `SELECT
         (SELECT version::text FROM content_intake.policy_versions
           WHERE tenant_id = $1 AND app_id = $2) AS policy,
         (SELECT version::text FROM content_intake.store_set_current
           WHERE tenant_id = $1 AND app_id = $2) AS store_set`,
      [TENANT, APP]);
    const policyVersion = versions.rows[0]?.policy;
    const storeSetVersion = versions.rows[0]?.store_set;
    for (const domain of domains) {
      // A business grant has to hang off an allocation with the same issuer, scope and action.
      await admin.query(
        `INSERT INTO content_intake.grants(
           grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id,
           action, starts_at, expires_at, reason, steward_id)
         VALUES ($1, 'allocation', $2, $2, $3, $4, $5, 'query',
           clock_timestamp() - interval '2 minutes',
           clock_timestamp() + interval '2 days',
           '合成查询分配', $2)
         ON CONFLICT (grant_id) DO NOTHING`,
        [`grant-search-alloc-${userId}-${domain}`, issuerId, TENANT, APP,
          `scope-search-${domain}`]);
      await admin.query(
        `INSERT INTO content_intake.grants(
           grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id,
           action, starts_at, expires_at, reason, policy_version, store_set_version, parent_grant_id,
           steward_id)
         VALUES ($1, 'business', $2, $3, $4, $5, $6, $7, 'query',
           clock_timestamp() - interval '1 minute',
           clock_timestamp() + interval '1 day',
           '合成查询授权', $8::bigint, $9::bigint, $10, $2)
         ON CONFLICT (grant_id) DO NOTHING`,
        [`grant-search-${userId}-${domain}`, issuerId, principalId, TENANT, APP,
          `scope-search-${domain}`, `source-search-${domain}`, policyVersion, storeSetVersion,
          `grant-search-alloc-${userId}-${domain}`]);
    }
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
}
