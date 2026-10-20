import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import { CSV_TEMPLATE_VERSION, CSV_POLICY_VERSION, CSV_MAPPING_VERSION, CSV_STRUCTURE_SHA256 } from '@customer-agent/content-intake';

export const INTAKE_SYNTHETIC_IDENTITIES = [
  ['director', 'director', '合成总监'],
  // id 是历史夹具名，当前职务角色是 lead。
  ['enabler', 'lead', '合成整理人'],
  ['reviewer', 'supervisor', '合成复核人'], ['agent', 'agent', '合成坐席'],
] as const;

/** Explicit throwaway bootstrap. These synthetic identities and the empty
 * intake catalog are never adopted by a production factory or an existing DB. */
export async function seedIntakeSyntheticHost(admin: Client, domain: 'product' | 'campaign' | 'presale' | 'aftersale' = 'product', inputFormat: 'xlsx' | 'csv' = 'xlsx', includeSopSource = false, factsLease: 'fresh' | 'expired' = 'fresh') {
  await admin.query('BEGIN');
  try {
    for (const [id, role] of INTAKE_SYNTHETIC_IDENTITIES) {
      await admin.query(`INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
        VALUES ($1,'synthetic','tenant-a',$1,$2,repeat('a',64),true,$3)`, [id, `user-${id}`, id === 'agent' ? 'agent' : 'owner']);
      await admin.query(`INSERT INTO content_intake.principals VALUES ($1,$2,'tenant-a','app-a','confirmed-synthetic',$1,1,0)`, [id, `user-${id}`]);
      // Expired coverage is the inserted start state. Tests must not move valid_until later.
      const factsWindow = factsLease === 'expired'
        ? `statement_timestamp()-interval '2 minutes',statement_timestamp()-interval '1 second'`
        : `statement_timestamp()-interval '1 second',statement_timestamp()+interval '299 seconds'`;
      await admin.query(`INSERT INTO content_intake.principal_facts VALUES ($1,1,ARRAY['dept-a'],$2,true,
        ${factsWindow},repeat('a',64))`, [id, `job-${role}`]);
      await admin.query(`INSERT INTO content_intake.role_rules VALUES ('tenant-a','app-a','dept-a',$1,1,$2) ON CONFLICT DO NOTHING`, [`job-${role}`, role]);
    }
    for (const suffix of ['a', 'b']) {
      await admin.query(`INSERT INTO content_intake.scopes VALUES ($1,'tenant-a','app-a','brand-a',$2,$3)`, [`scope-${suffix}`, `shop-${suffix}`, domain]);
      await admin.query(`INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode) VALUES ($1,$2,1,'v2-preview')`, [`source-${suffix}`, `scope-${suffix}`]);
      await admin.query('INSERT INTO content_intake.source_mappings VALUES ($1,1,$2,$3,$4,$5)', inputFormat === 'csv'
        ? [`source-${suffix}`, CSV_TEMPLATE_VERSION, CSV_POLICY_VERSION, CSV_MAPPING_VERSION, CSV_STRUCTURE_SHA256]
        : [`source-${suffix}`, 'faq-p1.1', 'intake-p1.1', 'mapping-p1.1', 'a'.repeat(64)]);
    }
    for (const action of ['query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback']) {
      await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
        VALUES ($1,'allocation','director','director','tenant-a','app-a','scope-a',$2,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day','合成根资格','director')`, [`root-${action}`, action]);
      for (const recipient of ['enabler', 'reviewer', ...(action === 'query' ? ['agent'] : [])]) {
        await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
          VALUES ($1,'business','director',$2,'tenant-a','app-a','scope-a','source-a',$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','合成业务授权','director',$4)`,
        [`business-${recipient}-${action}`, recipient, action, `root-${action}`]);
      }
    }
    // An issuer must already reach every source it hands out, so the root director holds its
    // own business rows. A business row needs a different issuer, hence the reviewer allocation.
    // Query rows are only live with a source, the current policy version and a store set member.
    await admin.query(`INSERT INTO content_intake.store_sets(tenant_id,app_id,version,approved_at,provenance)
      VALUES ('tenant-a','app-a',1,clock_timestamp(),'synthetic') ON CONFLICT DO NOTHING`);
    await admin.query(`INSERT INTO content_intake.store_set_current(tenant_id,app_id,version)
      VALUES ('tenant-a','app-a',1) ON CONFLICT (tenant_id,app_id) DO UPDATE SET version=1`);
    await admin.query(`INSERT INTO content_intake.store_set_members(
        tenant_id,app_id,version,scope_id,source_id,content_valid_until)
      VALUES ('tenant-a','app-a',1,'scope-a','source-a',clock_timestamp()+interval '2 hours')
      ON CONFLICT (tenant_id,app_id,version,scope_id,source_id) DO NOTHING`);
    for (const action of ['query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback']) {
      await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
        VALUES ($1,'allocation','director','reviewer','tenant-a','app-a','scope-a',$2,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day','合成复核分配','director')
        ON CONFLICT (grant_id) DO NOTHING`, [`alloc-reviewer-${action}`, action]);
      await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id,policy_version,store_set_version)
        VALUES ($1,'business','reviewer','director','tenant-a','app-a','scope-a','source-a',$2,clock_timestamp()-interval '5 minutes',clock_timestamp()+interval '45 minutes','合成签发资格','reviewer',$3,
          CASE WHEN $2='query' THEN (SELECT version FROM content_intake.policy_versions WHERE tenant_id='tenant-a' AND app_id='app-a') END,
          CASE WHEN $2='query' THEN 1 END)
        ON CONFLICT (grant_id) DO NOTHING`, [`issuer-director-${action}`, action, `alloc-reviewer-${action}`]);
    }
    // Test-only sibling source: exercise the same SOP opt-in as the API suite.
    if (includeSopSource) {
      await admin.query("INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode) VALUES ('source-sop','scope-a',1,'v2-preview')");
      await admin.query("INSERT INTO content_intake.source_mappings VALUES ('source-sop',1,'faq-p1.1','intake-p1.1','sop-not-imported',repeat('a',64))");
      await admin.query(`INSERT INTO content_intake.grants SELECT (jsonb_populate_record(NULL::content_intake.grants,
        to_jsonb(g)||jsonb_build_object('grant_id',grant_id||'-sop','source_id','source-sop'))).*
        FROM content_intake.grants g WHERE source_id='source-a' AND kind='business'`);
    }
    const domains = ['aftersale', 'campaign', 'presale', 'product'];
    const sourceHash = createHash('sha256').update(domains.map(d => `${d}:srcv_pub_${d}`).join('|')).digest('hex');
    await admin.query("SELECT set_config('app.publishing','on',true)");
    for (const domain of domains) await admin.query(`INSERT INTO public.authoritative_source_versions(
      source_version_id,source_ref,domain,upstream_version,snapshot_sha256,use_class,owner_role,approval_evd,approved_by,approved_at,review_due_at,tenant_id)
      VALUES ($1,$3,$2,'synthetic-publication-v1',repeat('a',64),'canonical','ROLE-CONTENT-LEAD','EVD-SYNTHETIC-PUBLICATION','synthetic-owner',
        '2020-01-01T00:00:00Z','2099-01-01T00:00:00Z','tenant-a')`, [`srcv_pub_${domain}`, domain, `SRC-SYNTH-PUB-${domain.toUpperCase()}`]);
    await admin.query(`INSERT INTO public.content_releases(release_id,release_seq,title,status,source_binding_hash,tenant_id)
      VALUES ('rel_native_base',1,'合成空目录基线','published',$1,'tenant-a')`, [sourceHash]);
    for (const domain of domains) await admin.query('INSERT INTO public.release_source_bindings(release_id,domain,source_version_id) VALUES ($1,$2,$3)',
      ['rel_native_base', domain, `srcv_pub_${domain}`]);
    await admin.query("INSERT INTO content_intake.release_catalogs(release_id,format_version) VALUES ('rel_native_base','intake-v2.1')");
    await admin.query("INSERT INTO public.content_current(id,current_release_id) VALUES (1,'rel_native_base')");
    await admin.query("SELECT setval('public.content_release_seq',1,true)");
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
}
