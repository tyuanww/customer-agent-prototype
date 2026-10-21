import type { Client } from 'pg';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { previewGrants } from '../../src/content-intake/authority.js';
import { IntakeRejection, principal, type IntakeTransaction } from '../../src/content-intake/transaction.js';

/** One live two-source scope, four principals, and the grants the overlay tests need.
 * Every write-deadline test file (publish, import, grant issuer) and the source-set test file
 * share this, so a card's unit box can be read on its own file without repeating the shape.
 *
 * The tenant names are synthetic. Nothing here reads an environment database, and the cluster
 * is thrown away on close. */
export type AuthorizationFixture = Readonly<{
  admin: Client;
  close: () => Promise<void>;
  /** Rows of the set function for one principal and action, ordered for stable comparison. */
  sources: (principalId: string, action: string) => Promise<{ source_id: string; valid_until: Date; policy_version: string | null }[]>;
  publishMessage: (userId: string, role: string, batchId: string) => Promise<string>;
  rollbackMessage: (userId: string, role: string, releaseId: string) => Promise<string>;
  resolvePreviousMessage: (userId: string) => Promise<string>;
  importMessage: (userId: string, role: string, bindings: string) => Promise<string>;
  /** A four-domain release with a canonical source per domain. */
  seedFourDomainRelease: (releaseId: string, seq: number) => Promise<void>;
  /** Self-held allocation plus a live business rollback grant on each of the four domains. */
  grantRollbackOnEveryDomain: () => Promise<void>;
  intakeClient: () => IntakeTransaction;
  grantRejection: (issuerId: string, recipientId: string, sourceId: string) => Promise<string>;
}>;

export async function createAuthorizationFixture(databaseName = 'authorization_sources'): Promise<AuthorizationFixture> {
  const harness = new Pg15Harness();
  harness.start();
  const admin = await harness.connect(harness.createDatabase(databaseName).config);
  try {
    await applyDatabaseMigrations(admin);
    await admin.query('BEGIN');
    await admin.query(`INSERT INTO content_intake.policy_versions(tenant_id, app_id, version)
      VALUES ('tenant-menokin','app-customer-agent',1)`);
    await admin.query(`INSERT INTO content_intake.scopes(scope_id, tenant_id, app_id, brand_id, domain)
      VALUES ('scope-product','tenant-menokin','app-customer-agent','brand-a','product')`);
    await admin.query(`INSERT INTO content_intake.sources(source_id, scope_id, current_mapping_version, mode)
      VALUES ('source-a','scope-product',1,'v2-preview'), ('source-b','scope-product',1,'v2-preview')`);
    await admin.query(`INSERT INTO content_intake.source_mappings(
        source_id, version, template_version, rule_version, mapping_version, structure_digest)
      VALUES
        ('source-a',1,'faq-p1.1','intake-p1.1','faq-map',repeat('ab',32)),
        ('source-b',1,'faq-p1.1','intake-p1.1','faq-map',repeat('cd',32))`);
    await admin.query(`INSERT INTO content_intake.store_sets(tenant_id, app_id, version, approved_at, provenance)
      VALUES ('tenant-menokin','app-customer-agent',1,clock_timestamp(),'proof')`);
    await admin.query(`INSERT INTO content_intake.store_set_current(tenant_id, app_id, version)
      VALUES ('tenant-menokin','app-customer-agent',1)`);
    await admin.query(`INSERT INTO content_intake.store_set_members(
        tenant_id, app_id, version, scope_id, source_id, content_valid_until)
      VALUES
        ('tenant-menokin','app-customer-agent',1,'scope-product','source-a',clock_timestamp()+interval '1 day'),
        ('tenant-menokin','app-customer-agent',1,'scope-product','source-b',clock_timestamp()+interval '1 day')`);
    for (const [id, job] of [
      ['director', 'job-director'],
      ['signer', 'job-director'],
      ['agent', 'job-agent'],
      ['stale', 'job-director'],
    ] as const) {
      await admin.query(`INSERT INTO backend_identity.subject_bindings(
          binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
        VALUES ($1,'synthetic','tenant-menokin',$1,$2,repeat('ab',32),true,'owner')`, [id, `user-${id}`]);
      await admin.query(`INSERT INTO content_intake.principals(
          principal_id, user_id, tenant_id, app_id, identity_scope, person_key, current_facts_version, revocation_generation)
        VALUES ($1,$2,'tenant-menokin','app-customer-agent','confirmed-synthetic',$1,1,0)`, [id, `user-${id}`]);
      // The stale principal's window has already closed; the others stay inside the five
      // minute cap the facts check enforces.
      const checked = id === 'stale' ? "statement_timestamp() - interval '4 minutes'" : "statement_timestamp() - interval '1 second'";
      const until = id === 'stale' ? "statement_timestamp() - interval '1 minute'" : "statement_timestamp() + interval '4 minutes'";
      await admin.query(`INSERT INTO content_intake.principal_facts(
          principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest)
        VALUES ($1,1,ARRAY['dept-a'],$2,true, ${checked}, ${until}, repeat('ab',32))`, [id, job]);
    }
    await admin.query(`INSERT INTO content_intake.role_rules(tenant_id, app_id, department_id, job_id, policy_version, role)
      VALUES
        ('tenant-menokin','app-customer-agent','dept-a','job-director',1,'director'),
        ('tenant-menokin','app-customer-agent','dept-a','job-agent',1,'agent')`);
    await admin.query(`INSERT INTO content_intake.grants(
        grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, action, starts_at, expires_at, reason)
      VALUES
        ('grant-alloc-query','allocation','signer','signer','tenant-menokin','app-customer-agent','scope-product','query',
          clock_timestamp()-interval '2 minutes', clock_timestamp()+interval '2 days', '分配查询。'),
        ('grant-alloc-publish','allocation','signer','signer','tenant-menokin','app-customer-agent','scope-product','publish',
          clock_timestamp()-interval '2 minutes', clock_timestamp()+interval '2 days', '分配发布。')`);
    await admin.query(`INSERT INTO content_intake.grants(
        grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
        starts_at, expires_at, reason, parent_grant_id, policy_version, store_set_version)
      VALUES
        ('grant-query-a','business','signer','director','tenant-menokin','app-customer-agent','scope-product','source-a','query',
          clock_timestamp()-interval '1 minute', clock_timestamp()+interval '60 seconds', '查询甲。','grant-alloc-query',3,1),
        ('grant-query-b','business','signer','director','tenant-menokin','app-customer-agent','scope-product','source-b','query',
          clock_timestamp()-interval '1 minute', clock_timestamp()+interval '180 seconds', '查询乙。','grant-alloc-query',3,1),
        ('grant-publish','business','signer','director','tenant-menokin','app-customer-agent','scope-product',NULL,'publish',
          clock_timestamp()-interval '1 minute', clock_timestamp()+interval '1 day', '发布。','grant-alloc-publish',NULL,NULL),
        ('grant-agent-publish','business','signer','agent','tenant-menokin','app-customer-agent','scope-product',NULL,'publish',
          clock_timestamp()-interval '1 minute', clock_timestamp()+interval '1 day', '客服发布。','grant-alloc-publish',NULL,NULL),
        ('grant-agent-query','business','signer','agent','tenant-menokin','app-customer-agent','scope-product','source-a','query',
          clock_timestamp()-interval '1 minute', clock_timestamp()+interval '60 seconds', '客服查询。','grant-alloc-query',3,1),
        ('grant-stale','business','signer','stale','tenant-menokin','app-customer-agent','scope-product','source-a','query',
          clock_timestamp()-interval '1 minute', clock_timestamp()+interval '60 seconds', '过期查询。','grant-alloc-query',3,1)`);
    await admin.query('COMMIT');
  } catch (error) {
    await admin.end();
    harness.stop();
    throw error;
  }

  const sources = async (principalId: string, action: string) => {
    const result = await admin.query<{ source_id: string; valid_until: Date; policy_version: string | null }>(
      `SELECT source_id, valid_until, policy_version::text AS policy_version
       FROM content_intake.authorization_sources($1, $2, clock_timestamp())
       ORDER BY source_id, valid_until`,
      [principalId, action]);
    return result.rows;
  };

  /** Message of whichever refusal the function raised, or 'accepted'. The message is the
   * product's own sentence, so a test asserts on text the operator would see. */
  const messageOf = async (work: () => Promise<unknown>): Promise<string> => {
    try {
      await work();
      return 'accepted';
    } catch (error) {
      return error instanceof Error ? error.message : 'error';
    }
  };

  const publishMessage = (userId: string, role: string, batchId: string) => messageOf(() =>
    admin.query('SELECT * FROM public.publish_content_release($1,$2,$3,$4,$5)', [batchId, '标题', '摘要', userId, role]));

  const rollbackMessage = (userId: string, role: string, releaseId: string) => messageOf(() =>
    admin.query('SELECT * FROM public.rollback_content_release($1,$2,$3,$4,$5)', [releaseId, '标题', '摘要', userId, role]));

  const resolvePreviousMessage = (userId: string) => messageOf(() =>
    admin.query('SELECT * FROM public.resolve_previous_content_release($1)', [userId]));

  const importMessage = (userId: string, role: string, bindings: string) => messageOf(() =>
    admin.query(
      'SELECT * FROM public.enqueue_content_import($1,$2,$3,$4,$5,$6::jsonb,$7,$8)',
      ['imp_probe', 'csv', 'upload-object', 'ab'.repeat(32), 1, bindings, userId, role],
    ));

  const releaseDomains = ['aftersale', 'campaign', 'presale', 'product'] as const;

  const seedFourDomainRelease = async (releaseId: string, seq: number): Promise<void> => {
    const joined = releaseDomains.map(domain => `${domain}:srcv_roll_${domain}`).join('|');
    await admin.query('BEGIN');
    await admin.query("SELECT set_config('app.publishing','on',true)");
    await admin.query(`INSERT INTO public.authoritative_source_versions(
        source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
        use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at)
      SELECT 'srcv_roll_' || domain, 'SRC-ROLL-' || upper(domain), domain, 'v1', repeat('ef',32),
        'canonical','ROLE-CONTENT-LEAD','EVD','synthetic-owner','2020-01-01T00:00:00Z','2099-01-01T00:00:00Z'
      FROM unnest($1::text[]) AS domain
      ON CONFLICT (source_version_id) DO NOTHING`, [releaseDomains]);
    const hash = (await admin.query<{ hash: string }>(
      `SELECT encode(public.digest(convert_to($1,'UTF8'),'sha256'),'hex') AS hash`, [joined])).rows[0]?.hash;
    await admin.query(`INSERT INTO public.content_releases(release_id, release_seq, status, source_binding_hash)
      VALUES ($1, $2, 'published', $3)`, [releaseId, seq, hash]);
    await admin.query(`INSERT INTO public.release_source_bindings(release_id, domain, source_version_id)
      SELECT $1, domain, 'srcv_roll_' || domain FROM unnest($2::text[]) AS domain`, [releaseId, releaseDomains]);
    await admin.query('COMMIT');
  };

  const grantRollbackOnEveryDomain = async (): Promise<void> => {
    await admin.query('BEGIN');
    await admin.query('SET CONSTRAINTS ALL DEFERRED');
    for (const domain of releaseDomains) {
      await admin.query(`INSERT INTO content_intake.scopes(scope_id, tenant_id, app_id, brand_id, domain)
        VALUES ($1,'tenant-menokin','app-customer-agent','brand-a',$2)
        ON CONFLICT (scope_id) DO NOTHING`, [`scope-${domain}`, domain]);
      await admin.query(`INSERT INTO content_intake.sources(source_id, scope_id, current_mapping_version, mode)
        VALUES ($1,$2,1,'v2-preview')
        ON CONFLICT (source_id) DO NOTHING`, [`source-roll-${domain}`, `scope-${domain}`]);
      await admin.query(`INSERT INTO content_intake.source_mappings(
          source_id, version, template_version, rule_version, mapping_version, structure_digest)
        VALUES ($1,1,'faq-p1.1','intake-p1.1','faq-map',repeat('ef',32))
        ON CONFLICT (source_id, version) DO NOTHING`, [`source-roll-${domain}`]);
      await admin.query(`INSERT INTO content_intake.grants(
          grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, action, starts_at, expires_at, reason)
        VALUES ($1,'allocation','signer','signer','tenant-menokin','app-customer-agent',$2,'rollback',
          clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '2 days','分配回滚。')`,
      [`grant-alloc-rollback-${domain}`, `scope-${domain}`]);
      await admin.query(`INSERT INTO content_intake.grants(
          grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
          starts_at, expires_at, reason, parent_grant_id)
        VALUES ($1,'business','signer','director','tenant-menokin','app-customer-agent',$2,NULL,'rollback',
          clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day','回滚。',$3)`,
      [`grant-rollback-${domain}`, `scope-${domain}`, `grant-alloc-rollback-${domain}`]);
    }
    await admin.query('COMMIT');
  };

  const intakeClient = (): IntakeTransaction => Object.assign(admin, { validUntil() {}, beforeCommit() {} });

  const grantRejection = async (issuerId: string, recipientId: string, sourceId: string): Promise<string> => {
    const client = intakeClient();
    const issuer = await principal(client, { id: issuerId });
    const recipient = await principal(client, { id: recipientId });
    const policy = await admin.query<{ version: string }>(
      'SELECT version::text AS version FROM content_intake.policy_versions WHERE tenant_id=$1 AND app_id=$2',
      [issuer.tenantId, issuer.appId]);
    try {
      await previewGrants(client, issuer, {
        operationId: 'grant-probe',
        issuerFactsVersion: issuer.factsVersion,
        policyVersion: Number(policy.rows[0]?.version),
        items: [{
          kind: 'business',
          recipientPrincipalId: recipient.id,
          recipientFactsVersion: recipient.factsVersion,
          action: 'publish',
          scope: {
            tenantId: issuer.tenantId,
            appId: issuer.appId,
            brandId: 'brand-a',
            shopId: null,
            domain: 'product',
            sourceId,
          },
          startsAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          reason: '合成授权',
        }],
      });
      return 'accepted';
    } catch (error) {
      return error instanceof IntakeRejection ? error.reason : 'error';
    }
  };

  return Object.freeze({
    admin,
    close: async () => { await admin.end(); harness.stop(); },
    sources,
    publishMessage,
    rollbackMessage,
    resolvePreviousMessage,
    importMessage,
    seedFourDomainRelease,
    grantRollbackOnEveryDomain,
    intakeClient,
    grantRejection,
  });
}
