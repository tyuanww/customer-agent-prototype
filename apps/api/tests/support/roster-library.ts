import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { feishuUserId } from '../../src/feishu-admit.js';

const seat = 'ou_rosterseat01';
const director = 'ou_rosterdirector1';

export async function seedLibrary(client: Client, liveAllocation = true) {
  await applyDatabaseMigrations(client);
  await client.query('BEGIN');
  try {
    await client.query(`INSERT INTO backend_identity.subject_bindings
      (binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
      VALUES ('director','synthetic','tenant-a','director','user-director',repeat('ab',32),true,'owner')`);
    await client.query(`INSERT INTO content_intake.principals
      VALUES ('director','user-director','tenant-a','app-a','confirmed-synthetic','director',1,0)`);
    await client.query(`INSERT INTO content_intake.principal_facts
      VALUES ('director',1,ARRAY['dept-a'],'job-director',true,
        statement_timestamp()-interval '1 second', statement_timestamp()+interval '4 minutes', repeat('a',64))`);
    await client.query(`INSERT INTO content_intake.role_rules
      VALUES
        ('tenant-a','app-a','dept-a','job-customer-service-director',1,'director'),
        ('tenant-a','app-a','dept-a','job-customer-service-seat',1,'agent')`);
    await client.query(`INSERT INTO content_intake.scopes
      VALUES ('scope-a','tenant-a','app-a','brand-a','shop-a','product')`);
    await client.query(`INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode)
      VALUES ('source-a','scope-a',1,'v2-preview')`);
    await client.query(`INSERT INTO content_intake.source_mappings
      VALUES ('source-a',1,'faq-p1.1','intake-p1.1','mapping-p1.1',repeat('a',64))`);
    for (const action of ['query', 'publish', 'import']) {
      await client.query(`INSERT INTO content_intake.grants(
        grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
        VALUES ($1,'allocation','director','director','tenant-a','app-a','scope-a',$2,
          clock_timestamp()-interval '1 hour', clock_timestamp() + $3::interval,'合成根资格','director')`,
      [`root-${action}`, action, liveAllocation ? '1 day' : '-1 minute']);
    }
    for (const openId of [seat, director]) {
      await client.query(`INSERT INTO backend_identity.subject_bindings
        (binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
        VALUES ($1,'feishu','feishu-tenant',$1,$2,repeat('cd',32),true,'agent')`, [openId, feishuUserId(openId)]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

const material = JSON.stringify({
  canonicalEncodingVersion: 'candidate-p1.1',
  templateVersion: 'faq-p1.1',
  ruleVersion: 'intake-p1.1',
  mappingVersion: 'mapping-p1.1',
  sourceVersion: '1',
  scope: { tenantId: 'tenant-a', appId: 'app-a', brandId: 'brand-a', shopId: 'shop-a', domain: 'product', sourceId: 'source-a' },
  object: {
    objectId: 'obj-roster', sha256: 'a'.repeat(64), sourceId: 'source-a',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: '32',
  },
  sourceClaim: { fileSha256: 'a'.repeat(64) },
  contributors: ['director'],
  baseReleaseId: null,
  risk: { level: 'routine', explicitDisableCount: 0 },
  selectedSheets: ['来源', 'FAQ', '相似问法'],
});

export async function publishLineage(client: Client) {
  await client.query('BEGIN');
  try {
    await client.query(`INSERT INTO content_intake.objects(
      object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
      VALUES('obj-roster','source-a','director','tenant-a','app-a','intake/obj-roster',$1,32,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','input',clock_timestamp())`, ['a'.repeat(64)]);
    await client.query(`INSERT INTO content_intake.objects(
      object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
      VALUES('obj-review','source-a','director','tenant-a','app-a','intake/obj-review',$1,32,'application/json','review-package',clock_timestamp())`, ['d'.repeat(64)]);
    await client.query(`INSERT INTO content_intake.candidate_versions(
      candidate_id,version,source_id,scope_id,source_version,object_id,file_sha256,actor_id,canonical_encoding,canonical_material,material,
      risk,explicit_disable_count,state,created_at,updated_at,publication_policy)
      VALUES('cand-roster',1,'source-a','scope-a',1,'obj-roster',$1,'director','candidate-p1.1',$2,$3::jsonb,
      'routine',0,'awaiting-evidence',clock_timestamp(),clock_timestamp(),'approval-v1')`, ['a'.repeat(64), material, material]);
    const digest = (await client.query<{ digest: string }>(
      `SELECT digest FROM content_intake.candidate_versions WHERE candidate_id='cand-roster'`)).rows[0]!.digest;
    await client.query(`INSERT INTO content_intake.review_bindings(
      review_request_id,candidate_id,candidate_version,candidate_digest,evidence_version,tenant_id,app_id,definition_id,node_id,create_uuid,instance_code,package_object_id,package_sha256,attachment_file_code)
      VALUES('review-roster','cand-roster',1,$1,1,'tenant-a','app-a','historical-definition','human-node',gen_random_uuid(),'roster-instance','obj-review',$2,'roster-attachment')`,
    [digest, 'd'.repeat(64)]);
    await client.query("SELECT set_config('app.publishing','on',true)");
    const domains = ['aftersale', 'campaign', 'presale', 'product'];
    for (const domain of domains) await client.query(`INSERT INTO public.authoritative_source_versions(
      source_version_id,source_ref,domain,upstream_version,snapshot_sha256,use_class,owner_role,approval_evd,approved_by,approved_at,review_due_at,tenant_id)
      VALUES ($1,$2,$3,'synthetic-publication-v1',$4,'canonical','ROLE-CONTENT-LEAD','EVD-SYNTHETIC-PUBLICATION','synthetic-owner',
        '2020-01-01T00:00:00Z','2099-01-01T00:00:00Z','tenant-a')`,
    [`srcv_roster_${domain}`, `SRC-ROSTER-${domain.toUpperCase()}`, domain, 'b'.repeat(64)]);
    const domainsSorted = [...domains].sort();
    const sourceHash = createHash('sha256').update(domainsSorted.map((domain) => `${domain}:srcv_roster_${domain}`).join('|')).digest('hex');
    await client.query(`INSERT INTO public.content_releases(release_id,release_seq,title,status,source_binding_hash,tenant_id)
      VALUES('rel-roster',1,'合成职务发布','published',$1,'tenant-a')`, [sourceHash]);
    for (const domain of domains) await client.query(
      'INSERT INTO public.release_source_bindings(release_id,domain,source_version_id) VALUES ($1,$2,$3)',
      ['rel-roster', domain, `srcv_roster_${domain}`]);
    await client.query("INSERT INTO content_intake.release_catalogs(release_id,format_version) VALUES('rel-roster','intake-v2.1')");
    await client.query(`INSERT INTO content_intake.release_lineage(
      release_id,source_id,business_entry_id,script_version,candidate_id,candidate_version,review_request_id,content_valid_until,publication_policy)
      VALUES('rel-roster','source-a','faq-one',1,'cand-roster',1,'review-roster',clock_timestamp()+interval '1 day','approval-v1')`);
    await client.query("INSERT INTO public.content_current(id,current_release_id) VALUES(1,'rel-roster')");
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
