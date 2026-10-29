import { createHash } from 'node:crypto';
import { bindKnownPrincipal } from '../../apps/api/src/content-intake/bind-known-principal.ts';

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

const TENANT = 'tenant-menokin';
const APP = 'app-customer-agent';
const PEOPLE = [
  { principalId: 'synthetic_owner', userId: 'usr_synthetic_owner', jobId: 'job-director', role: 'director' },
  { principalId: 'synthetic_coach', userId: 'usr_synthetic_coach', jobId: 'job-lead', role: 'lead' },
  { principalId: 'synthetic_agent', userId: 'usr_synthetic_agent', jobId: 'job-agent', role: 'agent' },
] as const;
const OWNER_ACTIONS = ['query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback'] as const;
const SCOPES = [
  ['scope-menokin-product', 'src-menokin-faq'],
  ['scope-menokin-presale', 'src-menokin-presale'],
  ['scope-menokin-aftersale', 'src-menokin-aftersale'],
  ['scope-menokin-campaign', 'src-menokin-campaign'],
] as const;

/** Test-stack adapter only. The first allocation grant has no use-case parent,
 * so this bootstrap record stays outside the grant command. It never runs for
 * the formal database. */
export async function bindMenokinTestIdentities(client: Queryable, databaseName: string): Promise<string> {
  if (databaseName === 'customer_agent_formal') return 'menokin test binding skipped for the formal database';
  await client.query(
    `INSERT INTO content_intake.policy_versions(tenant_id, app_id, version) VALUES ($1, $2, 1) ON CONFLICT DO NOTHING`,
    [TENANT, APP],
  );
  for (const person of PEOPLE) {
    const bound = await bindKnownPrincipal(client, {
      principalId: person.principalId,
      userId: person.userId,
      tenantId: TENANT,
      appId: APP,
      identityScope: 'confirmed-synthetic',
      personKey: person.principalId,
      departmentIds: ['dept-menokin'],
      jobId: person.jobId,
    });
    if (bound !== 'bound') throw new Error(`Menokin test identity ${person.principalId} was not bound: ${bound}`);
    await client.query(
      `INSERT INTO content_intake.role_rules(tenant_id, app_id, department_id, job_id, policy_version, role)
       VALUES ($1, $2, 'dept-menokin', $3, 1, $4) ON CONFLICT DO NOTHING`,
      [TENANT, APP, person.jobId, person.role],
    );
  }
  for (const [scopeId, sourceId] of SCOPES) {
    for (const action of OWNER_ACTIONS) {
      const rootId = `menokin-root2-${scopeId}-${action}`;
      await client.query(
        `INSERT INTO content_intake.grants(grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, action, starts_at, expires_at, reason, steward_id)
         VALUES ($1, 'allocation', 'synthetic_owner', 'synthetic_owner', $2, $3, $4, $5, clock_timestamp() - interval '1 hour', clock_timestamp() + interval '2 days', '测试根资格', 'synthetic_owner')
         ON CONFLICT (grant_id) DO NOTHING`,
        [rootId, TENANT, APP, scopeId, action],
      );
    }
    const queryRoot = `menokin-root2-${scopeId}-query`;
    // BEFORE INSERT validates the parent even when ON CONFLICT would discard the row.
    // Reusing a fixture must retain its original deadline and revocation history.
    await client.query(
      `INSERT INTO content_intake.grants(grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action, starts_at, expires_at, reason, steward_id, parent_grant_id)
       SELECT $1::content_intake.identifier, 'business', 'synthetic_owner', 'synthetic_agent', $2, $3, $4, $5, 'query', clock_timestamp() - interval '1 minute', clock_timestamp() + interval '1 day', '测试坐席查询', 'synthetic_owner', $6
       WHERE NOT EXISTS (SELECT 1 FROM content_intake.grants WHERE grant_id=$1::content_intake.identifier)
       ON CONFLICT (grant_id) DO NOTHING`,
      [`menokin-agent2-${scopeId}-query`, TENANT, APP, scopeId, sourceId, queryRoot],
    );
    for (const action of OWNER_ACTIONS) {
      await client.query(
        `INSERT INTO content_intake.grants(grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action, starts_at, expires_at, reason, steward_id, parent_grant_id)
         SELECT $1::content_intake.identifier, 'business', 'synthetic_owner', 'synthetic_coach', $2, $3, $4, $5, $6, clock_timestamp() - interval '1 minute', clock_timestamp() + interval '1 day', '测试整理授权', 'synthetic_owner', $7
         WHERE NOT EXISTS (SELECT 1 FROM content_intake.grants WHERE grant_id=$1::content_intake.identifier)
         ON CONFLICT (grant_id) DO NOTHING`,
        [`menokin-coach2-${scopeId}-${action}`, TENANT, APP, scopeId, sourceId, action, `menokin-root2-${scopeId}-${action}`],
      );
    }
  }
  await client.query(
    `UPDATE content_intake.sources
     SET mode = 'v2-preview', mode_version = mode_version + 1
     WHERE source_id LIKE 'src-menokin-%' AND source_id <> 'src-menokin-sop' AND mode IS DISTINCT FROM 'v2-preview'`,
  );
  const domains = ['aftersale', 'campaign', 'presale', 'product'];
  const sourceHash = createHash('sha256').update(domains.map(domain => `${domain}:srcv_menokin_${domain}`).join('|')).digest('hex');
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.publishing','on',true)");
  for (const domain of domains) {
    await client.query(
      `INSERT INTO public.authoritative_source_versions(
        source_version_id, source_ref, domain, upstream_version, snapshot_sha256, use_class, owner_role,
        approval_evd, approved_by, approved_at, review_due_at, tenant_id)
       VALUES ($1, $2, $3, 'menokin-test-base', repeat('b', 64), 'canonical', 'ROLE-CONTENT-LEAD',
        'EVD-MENOKIN-TEST', 'synthetic-owner', '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z', $4)
       ON CONFLICT (source_version_id) DO NOTHING`,
      [`srcv_menokin_${domain}`, `SRC-MENOKIN-${domain.toUpperCase()}`, domain, TENANT],
    );
  }
  await client.query(
    `INSERT INTO public.content_releases(release_id, release_seq, title, status, source_binding_hash, tenant_id)
     VALUES ('rel_menokin_base', 1, 'Menokin 测试空目录基线', 'published', $1, $2)
     ON CONFLICT (release_id) DO NOTHING`,
    [sourceHash, TENANT],
  );
  for (const domain of domains) {
    await client.query(
      `INSERT INTO public.release_source_bindings(release_id, domain, source_version_id)
       VALUES ('rel_menokin_base', $1, $2) ON CONFLICT DO NOTHING`,
      [domain, `srcv_menokin_${domain}`],
    );
  }
  await client.query(
    `INSERT INTO content_intake.release_catalogs(release_id, format_version)
     VALUES ('rel_menokin_base', 'intake-v2.1') ON CONFLICT DO NOTHING`,
  );
  await client.query(
    `INSERT INTO public.content_current(id, current_release_id) VALUES (1, 'rel_menokin_base')
     ON CONFLICT (id) DO NOTHING`,
  );
  await client.query("SELECT setval('public.content_release_seq', (SELECT max(release_seq) FROM public.content_releases), true)");
  await client.query('COMMIT');
  return 'menokin test identities bound and sources opened to v2-preview';
}
