import type { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { previewGrants } from '../src/content-intake/authority.js';
import { readAuthorizationActions } from '../src/project-roster-login.js';
import { IntakeRejection, principal, type IntakeTransaction } from '../src/content-intake/transaction.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';

describe.skipIf(!enabled)('authorization_sources returns one row per live grant source', () => {
  let harness: Pg15Harness;
  let admin: Client;

  beforeEach(async () => {
    harness = new Pg15Harness();
    harness.start();
    const db = harness.createDatabase('authorization_sources');
    admin = await harness.connect(db.config);
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
  }, 120_000);

  afterEach(async () => {
    await admin?.end();
    harness?.stop();
  }, 60_000);

  async function sources(principal: string, action: string) {
    const result = await admin.query<{ source_id: string; valid_until: Date; policy_version: string | null }>(
      `SELECT source_id, valid_until, policy_version::text AS policy_version
       FROM content_intake.authorization_sources($1, $2, clock_timestamp())
       ORDER BY source_id, valid_until`,
      [principal, action]);
    return result.rows;
  }

  it('keeps two query grants as two rows with their own deadlines', async () => {
    const rows = await sources('director', 'query');
    expect(rows.map(row => row.source_id)).toEqual(['source-a', 'source-b']);
    expect(rows[0]?.valid_until.getTime()).not.toBe(rows[1]?.valid_until.getTime());
    expect(rows.every(row => row.policy_version === '3')).toBe(true);
  });

  it('expands a publish grant with no source across the scope', async () => {
    const rows = await sources('director', 'publish');
    expect(rows.map(row => row.source_id)).toEqual(['source-a', 'source-b']);
    expect(rows.every(row => row.policy_version === null)).toBe(true);
  });

  it('drops an agent publish grant and a stale query grant', async () => {
    expect(await sources('agent', 'publish')).toEqual([]);
    expect((await sources('agent', 'query')).map(row => row.source_id)).toEqual(['source-a']);
    expect(await sources('stale', 'query')).toEqual([]);
  });

  async function publishMessage(userId: string, role: string, batchId: string) {
    try {
      await admin.query('SELECT * FROM public.publish_content_release($1,$2,$3,$4,$5)', [batchId, '标题', '摘要', userId, role]);
      return 'accepted';
    } catch (error) {
      return error instanceof Error ? error.message : 'error';
    }
  }

  it('rejects one missing batch domain and does not use the session role', async () => {
    await admin.query(`INSERT INTO public.authoritative_source_versions(
        source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
        use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at)
      VALUES
        ('srcv_product','SRC-PRODUCT','product','v1',repeat('ab',32),'canonical','ROLE-CONTENT-LEAD','EVD','synthetic-owner','2020-01-01T00:00:00Z','2099-01-01T00:00:00Z'),
        ('srcv_aftersale','SRC-AFTERSALE','aftersale','v1',repeat('cd',32),'canonical','ROLE-CONTENT-LEAD','EVD','synthetic-owner','2020-01-01T00:00:00Z','2099-01-01T00:00:00Z')`);
    await admin.query(`INSERT INTO public.import_batches(import_batch_id, source_type, source_binding_hash, status)
      VALUES ('batch-covered','csv',repeat('ab',32),'staged'), ('batch-missing','csv',repeat('cd',32),'staged')`);
    await admin.query("SELECT set_config('app.import_binding_write','on',false)");
    await admin.query(`INSERT INTO public.import_batch_source_bindings(import_batch_id, domain, source_version_id)
      VALUES ('batch-covered','product','srcv_product'), ('batch-missing','aftersale','srcv_aftersale')`);
    expect(await publishMessage('user-director', 'agent', 'batch-missing')).toBe('没有权限，请找人开通。');
    const covered = await publishMessage('user-director', 'agent', 'batch-covered');
    expect(covered).not.toBe('没有权限，请找人开通。');
    expect(covered).not.toBe('资料资格过期了，请稍后重试。');
    expect(await publishMessage('user-stale', 'owner', 'batch-covered')).toBe('资料资格过期了，请稍后重试。');
  });

  async function rollbackMessage(userId: string, role: string, releaseId: string) {
    try {
      await admin.query('SELECT * FROM public.rollback_content_release($1,$2,$3,$4,$5)', [releaseId, '标题', '摘要', userId, role]);
      return 'accepted';
    } catch (error) {
      return error instanceof Error ? error.message : 'error';
    }
  }

  it('rejects rollback when the release domain is outside the rollback set', async () => {
    const domains = ['aftersale', 'campaign', 'presale', 'product'] as const;
    const joined = domains.map(domain => `${domain}:srcv_roll_${domain}`).join('|');
    await admin.query('BEGIN');
    await admin.query("SELECT set_config('app.publishing','on',true)");
    await admin.query(`INSERT INTO public.authoritative_source_versions(
        source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
        use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at)
      SELECT 'srcv_roll_' || domain, 'SRC-ROLL-' || upper(domain), domain, 'v1', repeat('ef',32),
        'canonical','ROLE-CONTENT-LEAD','EVD','synthetic-owner','2020-01-01T00:00:00Z','2099-01-01T00:00:00Z'
      FROM unnest($1::text[]) AS domain`, [domains]);
    const hash = (await admin.query<{ hash: string }>(
      `SELECT encode(public.digest(convert_to($1,'UTF8'),'sha256'),'hex') AS hash`, [joined])).rows[0]?.hash;
    await admin.query(`INSERT INTO public.content_releases(release_id, release_seq, status, source_binding_hash)
      VALUES ('rel_roll', 1, 'published', $1)`, [hash]);
    await admin.query(`INSERT INTO public.release_source_bindings(release_id, domain, source_version_id)
      SELECT 'rel_roll', domain, 'srcv_roll_' || domain FROM unnest($1::text[]) AS domain`, [domains]);
    await admin.query('COMMIT');
    expect(await rollbackMessage('user-director', 'owner', 'rel_roll')).toBe('没有权限，请找人开通。');
  });

  async function importMessage(userId: string, role: string, bindings: string) {
    try {
      await admin.query(
        'SELECT * FROM public.enqueue_content_import($1,$2,$3,$4,$5,$6::jsonb,$7,$8)',
        ['imp_probe', 'csv', 'upload-object', 'ab'.repeat(32), 1, bindings, userId, role],
      );
      return 'accepted';
    } catch (error) {
      return error instanceof Error ? error.message : 'error';
    }
  }

  it('rejects an import domain outside the import set and does not advance snapshots', async () => {
    await admin.query(`INSERT INTO content_intake.grants(
        grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, action, starts_at, expires_at, reason)
      VALUES ('grant-alloc-import','allocation','signer','signer','tenant-menokin','app-customer-agent','scope-product','import',
        clock_timestamp()-interval '2 minutes', clock_timestamp()+interval '2 days', '分配导入。')`);
    await admin.query(`INSERT INTO content_intake.grants(
        grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
        starts_at, expires_at, reason, parent_grant_id)
      VALUES ('grant-import','business','signer','director','tenant-menokin','app-customer-agent','scope-product',NULL,'import',
        clock_timestamp()-interval '1 minute', clock_timestamp()+interval '1 day', '导入。','grant-alloc-import')`);
    const missing = '[{"domain":"aftersale","source_version_id":"srcv_missing"}]';
    const covered = '[{"domain":"product","source_version_id":"srcv_product"}]';
    expect(await importMessage('user-director', 'agent', missing)).toBe('没有权限，请找人开通。');
    let advanceMessage = 'accepted';
    try {
      await admin.query(
        'SELECT public.advance_source_snapshots($1::jsonb,$2,$3,$4)',
        [missing, 'ab'.repeat(32), 'user-director', 'imp_probe'],
      );
    } catch (error) {
      advanceMessage = error instanceof Error ? error.message : 'error';
    }
    expect(advanceMessage).toBe('没有权限，请找人开通。');
    const advanced = await admin.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM public.source_snapshot_revisions');
    expect(advanced.rows[0]?.count).toBe(0);
    const accepted = await importMessage('user-director', 'agent', covered);
    expect(accepted).not.toBe('没有权限，请找人开通。');
    expect(accepted).not.toBe('资料资格过期了，请稍后重试。');
  });

  function intakeClient(): IntakeTransaction {
    return Object.assign(admin, {
      validUntil() {},
      beforeCommit() {},
    });
  }

  async function grantRejection(issuerId: string, recipientId: string, sourceId: string) {
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
  }

  it('rejects a grant source outside the issuer set and a stale issuer', async () => {
    expect(await grantRejection('director', 'signer', 'source-missing')).toBe('SCOPE_DENIED');
    expect(await grantRejection('director', 'signer', 'source-a')).not.toBe('SCOPE_DENIED');
    expect(await grantRejection('stale', 'director', 'source-a')).toBe('ORG_FACTS_UNAVAILABLE');
  });

  it('reads action bits from the source set', async () => {
    const bits = await readAuthorizationActions(admin, 'user-director');
    expect(bits).toEqual({ query: true, import: false, publish: true, rollback: false });
  });
});
