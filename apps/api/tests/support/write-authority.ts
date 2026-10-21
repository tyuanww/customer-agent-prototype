import type { Client } from 'pg';

type IntakeRole = 'agent' | 'enabler' | 'lead' | 'supervisor' | 'manager' | 'director' | 'engineer';

export type WriteAuthorityRecipient = Readonly<{
  principalId: string;
  userId: string;
  jobId: string;
  role: IntakeRole;
}>;

/** Explicit synthetic bootstrap for fixtures that call publish, import, or rollback.
 * Those paths read authorization_sources now, so a session role alone admits nothing.
 * The signer issues the business rows; the recipients hold the live ones. */
export async function seedContentWriteAuthority(admin: Client, input: Readonly<{
  tenantId: string; appId: string; brandId: string;
  signer: WriteAuthorityRecipient;
  recipients: readonly WriteAuthorityRecipient[];
  domains: readonly string[];
  actions: readonly string[];
  /** Grant a query row stamped with the current policy and store set version. */
  query?: boolean;
  /** Extra sources a fixture already registered and the recipients must reach. */
  extraSources?: readonly { scopeId: string; sourceId: string; domain: string }[];
  /** Grant id prefix, so a fixture can name the live rows it revokes later. */
  idPrefix?: string;
}>): Promise<void> {
  const { tenantId, appId, brandId, signer, recipients, domains, actions } = input;
  const prefix = input.idPrefix ?? `business-${tenantId}`;
  // Fixtures may already own a principal for a user id; grants must name that one.
  const effective = new Map<string, string>();
  let policyVersion: string | null = null, storeSetVersion: string | null = null;
  await admin.query('BEGIN');
  try {
    await admin.query(`INSERT INTO content_intake.policy_versions(tenant_id, app_id, version)
      VALUES ($1,$2,1) ON CONFLICT DO NOTHING`, [tenantId, appId]);
    for (const person of [signer, ...recipients]) {
      await admin.query(`INSERT INTO backend_identity.subject_bindings(
          binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
        VALUES ($1,'synthetic','synthetic-tenant',$1,$2,repeat('a',64),true,$3)
        ON CONFLICT (user_id) DO NOTHING`, [person.principalId, person.userId, person.role === 'agent' ? 'agent' : 'owner']);
      const known = await admin.query<{ principal_id: string }>(
        'SELECT principal_id FROM content_intake.principals WHERE user_id = $1', [person.userId]);
      if (known.rows[0]) {
        // Reuse the principal the fixture already registered for this user.
        effective.set(person.principalId, known.rows[0].principal_id);
        continue;
      }
      effective.set(person.principalId, person.principalId);
      await admin.query(`INSERT INTO content_intake.principals(
          principal_id, user_id, tenant_id, app_id, identity_scope, person_key, current_facts_version, revocation_generation)
        VALUES ($1,$2,$3,$4,'confirmed-synthetic',$5,1,0)
        ON CONFLICT (principal_id) DO NOTHING`, [person.principalId, person.userId, tenantId, appId, person.principalId]);
      await admin.query(`INSERT INTO content_intake.principal_facts(
          principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest)
        VALUES ($1,1,ARRAY[$2],$3,true,statement_timestamp()-interval '1 second',
          statement_timestamp()+interval '299 seconds',repeat('a',64))
        ON CONFLICT (principal_id, facts_version) DO NOTHING`, [person.principalId, `dept-${tenantId}`, person.jobId]);
      await admin.query(`INSERT INTO content_intake.role_rules(
          tenant_id, app_id, department_id, job_id, policy_version, role)
        VALUES ($1,$2,$3,$4,1,$5) ON CONFLICT DO NOTHING`,
      [tenantId, appId, `dept-${tenantId}`, person.jobId, person.role]);
    }
    if (input.query === true) {
      await admin.query(`INSERT INTO content_intake.store_sets(tenant_id, app_id, version, approved_at, provenance)
        VALUES ($1,$2,1,clock_timestamp(),'synthetic') ON CONFLICT DO NOTHING`, [tenantId, appId]);
      await admin.query(`INSERT INTO content_intake.store_set_current(tenant_id, app_id, version)
        VALUES ($1,$2,1) ON CONFLICT (tenant_id, app_id) DO UPDATE SET version = 1`, [tenantId, appId]);
    }
    const targets = [
      ...domains.map((domain) => ({ domain, scopeId: `scope-${tenantId}-${domain}`, sourceId: `source-${tenantId}-${domain}`, own: true })),
      ...(input.extraSources ?? []).map((extra) => ({ ...extra, own: false })),
    ];
    for (const { domain, scopeId, sourceId, own } of targets) {
      if (own) await admin.query(`INSERT INTO content_intake.scopes(scope_id, tenant_id, app_id, brand_id, domain)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (scope_id) DO NOTHING`,
      [scopeId, tenantId, appId, brandId, domain]);
      if (own) {
        await admin.query(`INSERT INTO content_intake.sources(source_id, scope_id, current_mapping_version, mode)
          VALUES ($1,$2,1,'v2-preview') ON CONFLICT (source_id) DO NOTHING`, [sourceId, scopeId]);
        await admin.query(`INSERT INTO content_intake.source_mappings(
            source_id, version, template_version, rule_version, mapping_version, structure_digest)
          VALUES ($1,1,'faq-p1.1','intake-p1.1','faq-map',repeat('ab',32)) ON CONFLICT DO NOTHING`, [sourceId]);
      }
      if (input.query === true) {
        await admin.query(`INSERT INTO content_intake.store_set_members(
            tenant_id, app_id, version, scope_id, source_id, content_valid_until)
          VALUES ($1,$2,1,$3,$4,clock_timestamp()+interval '1 hour')
          ON CONFLICT (tenant_id, app_id, version, scope_id, source_id) DO NOTHING`,
        [tenantId, appId, scopeId, sourceId]);
      }
    }
    // Every row that can bump the policy version is written before this read, so the query
    // grants below carry the version the reader will actually compare against.
    if (input.query === true) {
      const stamped = await admin.query<{ policy_version: string | null; store_set_version: string | null }>(`
        SELECT (SELECT version::text FROM content_intake.policy_versions WHERE tenant_id=$1 AND app_id=$2) AS policy_version,
               (SELECT version::text FROM content_intake.store_set_current WHERE tenant_id=$1 AND app_id=$2) AS store_set_version`,
      [tenantId, appId]);
      policyVersion = stamped.rows[0]?.policy_version ?? null;
      storeSetVersion = stamped.rows[0]?.store_set_version ?? null;
    }
    for (const { scopeId, sourceId } of targets) {
      for (const action of actions) {
        await admin.query(`INSERT INTO content_intake.grants(
            grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, action,
            starts_at, expires_at, reason, steward_id)
          VALUES ($1,'allocation',$2,$2,$3,$4,$5,$6,
            clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '2 days','合成分配。',$2)
          ON CONFLICT (grant_id) DO NOTHING`,
        [`alloc-${tenantId}-${sourceId}-${action}`, effective.get(signer.principalId)!, tenantId, appId, scopeId, action]);
        for (const recipient of recipients) {
          const stampQuery = input.query === true && action === 'query';
          // A query row must name its source: the deadline compares source_id for equality,
          // so a scope-wide query grant can never match. Other actions may stay scope-wide.
          await admin.query(`INSERT INTO content_intake.grants(
              grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
              starts_at, expires_at, reason, steward_id, parent_grant_id, policy_version, store_set_version)
            VALUES ($1,'business',$2,$5,$3,$4,$6,$11,$7,
              clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day','合成授权。',$2,$8,$9,$10)
            ON CONFLICT (grant_id) DO NOTHING`,
          [`${prefix}-${recipient.principalId}-${sourceId}-${action}`, effective.get(signer.principalId)!, tenantId, appId,
            effective.get(recipient.principalId)!, scopeId, action, `alloc-${tenantId}-${sourceId}-${action}`,
            stampQuery ? policyVersion : null, stampQuery ? storeSetVersion : null,
            stampQuery ? sourceId : null]);
        }
      }
    }
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
}
