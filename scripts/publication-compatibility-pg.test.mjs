import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import test, { beforeEach, afterEach } from 'node:test';
import { Pool } from 'pg';
import { Pg15Harness } from '../packages/database/dist/testkit/index.js';
import { applyDatabaseMigrations } from '../packages/database/dist/index.js';
import { createContentReleaseServiceForPool } from '../apps/api/dist/content-release-service.js';
import { publicationCandidateSql } from '../apps/api/tests/support/publication-candidate.ts';

const candidate = publicationCandidateSql();
assert.ok(candidate, 'Set CUSTOMER_AGENT_PUBLICATION_CANDIDATE_DIR to the hash-bound external DRAFT input');
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const hmac = { currentVersion: 'synthetic-v1', keys: { 'synthetic-v1': 'synthetic-publication-hmac-material-0001' } };
const logHash = { version: 'synthetic-log-v1', key: 'synthetic-publication-log-material-00001' };
let pg, admin, pool;
beforeEach(async () => {
  pg = new Pg15Harness(); pg.start(); const db = pg.createDatabase('publication_matrix');
  admin = await pg.connect(db.config); await applyDatabaseMigrations(admin);
  await admin.query('BEGIN'); await admin.query(candidate); await admin.query('COMMIT');
  await admin.query('CREATE ROLE matrix_admin LOGIN NOINHERIT; GRANT app_content_admin TO matrix_admin');
  pool = new Pool({ ...db.config, user: 'matrix_admin', max: 4, options: '-c statement_timeout=10000 -c lock_timeout=5000' });
});
afterEach(async () => { try { await pool?.end(); await admin?.end(); } finally { pg?.stop(); } assert.equal(existsSync(pg.root), false); });

/** Only invented data. Staging is deliberately the publisher boundary; the
 * existing import/worker/HTTP suite separately exercises the upstream pipeline. */
async function seed({ mode = 'owner_acceptance', domain = 'presale', tenant = 'tenant-synthetic', onlyDomain = false,
  expiryMs = 3_600_000, label = 'one', baseReleaseId = null, sensitive = false, version = 1, extraApproved = false } = {}) {
  const now = Date.now(); const start = new Date(now - 60_000).toISOString(), end = new Date(now + expiryMs).toISOString();
  const domains = ['aftersale', 'campaign', 'presale', 'product'];
  const sources = domains.map(domain => ({ domain, source_version_id: `srcv_synthetic_${domain}`, snapshot_sha256: hash(`source-${domain}`), review_due_at: new Date(now + 86_400_000).toISOString() }));
  const owner = hash('synthetic-owner'); const batch = `batch_${label}`, script = `script_${label}`;
  await admin.query('BEGIN');
  try {
    for (const s of sources) await admin.query(`INSERT INTO public.authoritative_source_versions
      (tenant_id,source_version_id,source_ref,domain,upstream_version,snapshot_sha256,use_class,owner_role,approval_evd,approved_by,approved_at,review_due_at)
      VALUES ($1,$2,'SRC-SYNTHETIC-' || upper($3),$3,'synthetic-v1',$4,'canonical','ROLE-CONTENT-LEAD','EVD-SYNTHETIC-SOURCE','synthetic',$5,$6) ON CONFLICT DO NOTHING`, [tenant,s.source_version_id,s.domain,s.snapshot_sha256,start,s.review_due_at]);
    const actualSources = (await admin.query('SELECT domain,source_version_id,snapshot_sha256,review_due_at FROM public.authoritative_source_versions WHERE tenant_id=$1 ORDER BY domain',[tenant])).rows
      .map(s => ({ ...s, review_due_at: s.review_due_at.toISOString() }));
    await admin.query("INSERT INTO public.intent_taxonomy_versions VALUES ('itax_synthetic','EVD-SYNTHETIC-TAXONOMY','synthetic',clock_timestamp()) ON CONFLICT DO NOTHING");
    await admin.query("INSERT INTO public.intent_taxonomy_entries(intent_taxonomy_version,intent_id,label,lifecycle) VALUES ('itax_synthetic','intent_synthetic','合成','active') ON CONFLICT DO NOTHING");
    await admin.query("SELECT set_config('app.semantic_asset_write','publish',true)");
    await admin.query("INSERT INTO public.semantic_source_assets(source_asset_id,source,origin_fingerprint,origin_fingerprint_key_version) VALUES ($1,'manual',$2,'synthetic-v1')", [`sa_${label}`,hash(`origin-${label}`)]);
    const question = { question_id: `q_synthetic_${label}`,question_version: 1,question_text: '合成问题',semantic_family_id: `sf_${label}`,
      origin_fingerprint: hash(`origin-${label}`),origin_fingerprint_key_version: 'synthetic-v1',source_asset_id: `sa_${label}`,source: 'manual',intent_taxonomy_version:'itax_synthetic',intent_id:'intent_synthetic' };
    question.question_hash = (await admin.query('SELECT public.content_question_hash($1::jsonb) AS hash',[JSON.stringify(question)])).rows[0].hash;
    const row = { tenant_id:tenant,script_id:script,category:domain,title:'合成标题',answer_text:sensitive?'过敏合成说明':'合成正文',status:'draft',version:1,script_version:mode==='owner_acceptance'?version:null,
      source_ref:`SRC-SYNTHETIC-${domain.toUpperCase()}`,source_version_id:`srcv_synthetic_${domain}`,platform_scope:['douyin','qianniu'],product_scope_type:'storewide',product_scope_refs:[],campaign_tag:domain==='campaign'?'synthetic-campaign':null,
      effective_from:start,effective_to:domain==='campaign'?end:null,intent_taxonomy_version:'itax_synthetic',intent_id:'intent_synthetic',risk_level:mode==='single'?'medium':'high',risk_categories:mode==='single'?[]:['legal_commitment'],has_conflict:false,
      review_mode:mode,primary_reviewer_id:mode==='owner_acceptance'?owner:hash('synthetic-lead'),primary_reviewer_role:'ROLE-CONTENT-LEAD',primary_review_evd:'EVD-SYNTHETIC-REVIEW',
      secondary_reviewer_id:mode==='dual'?hash('synthetic-manager'):null,secondary_reviewer_role:mode==='dual'?'ROLE-CS-MANAGER':null,secondary_review_evd:mode==='dual'?'EVD-SYNTHETIC-SECONDARY':null,
      placeholder_keys:[],questions_json:[question],priority:0,owner_role:'ROLE-CONTENT-LEAD',review_due_at:end,created_at:start,updated_at:start,published_at:null,
      staging_id:`stg_${label}`,import_batch_id:batch,operation:'upsert',search_document:"'synthetic':1",search_fallback_text:'synthetic',validation_ok:true,validation_errors:null,
      quality_status:'clean',quality_issue_codes:[],quality_gate_passed:true,owner_acceptance_record_sha256:null };
    const snapshot = (await admin.query(`SELECT public.content_governance_snapshot(
      r.script_id,r.category,r.title,r.answer_text,r.source_ref,r.source_version_id,r.owner_role,r.review_due_at,
      r.platform_scope,r.product_scope_type,r.product_scope_refs,r.effective_from,r.effective_to,r.intent_taxonomy_version,r.intent_id,
      r.risk_level,r.risk_categories,r.has_conflict,r.review_mode,r.primary_reviewer_id,r.primary_reviewer_role,r.primary_review_evd,
      r.secondary_reviewer_id,r.secondary_reviewer_role,r.secondary_review_evd,r.placeholder_keys,r.questions_json) AS value
      FROM jsonb_populate_record(NULL::public.scripts,$1::jsonb) r`,[JSON.stringify(row)])).rows[0].value;
    const record = { schema:'customer-agent/owner-acceptance/v1',review_mode:'owner_acceptance',purpose:'g1a_offline_only',owner_subject_hash:owner,
      approval_evidence_id:row.primary_review_evd,accepted_at:start,expires_at:end,scope:{source_bindings:actualSources,items:[{script_id:script,script_version:version,domain,source_version_id:row.source_version_id,
        review_input_sha256:(await admin.query('SELECT public.owner_acceptance_review_input_sha256($1::jsonb,$2) AS hash',[JSON.stringify(snapshot),version])).rows[0].hash,
        risk_level:row.risk_level,risk_categories:row.risk_categories,has_conflict:false}]}};
    if(extraApproved) record.scope.items.push({...record.scope.items[0],script_id:'zscript_extra'});
    if(mode==='owner_acceptance') {
      const raw=canonical(record)+'\n';row.owner_acceptance_record_sha256=hash(raw);
      await admin.query('SELECT public.register_owner_acceptance($1,$2,$3,$4)',[tenant,raw,row.owner_acceptance_record_sha256,owner]);
      row.content_hash=(await admin.query('SELECT public.owner_acceptance_content_hash($1::jsonb,$3,$2) AS hash',[JSON.stringify(snapshot),row.owner_acceptance_record_sha256,version])).rows[0].hash;
    } else {
      row.content_hash=hash(canonical(snapshot));
      for(const [suffix,role,id,evd,cap] of [['lead','ROLE-CONTENT-LEAD',row.primary_reviewer_id,row.primary_review_evd,'content_review_lead'],...(mode==='dual'?[['manager','ROLE-CS-MANAGER',row.secondary_reviewer_id,row.secondary_review_evd,'content_review_manager']]:[])])
        await admin.query('SELECT public.record_content_review_decision($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp(),$9)',[`crd_${label}_${suffix}`,script,row.content_hash,role,id,'synthetic-v1',evd,'approved',cap]);
    }
    const boundSources=onlyDomain?actualSources.filter(s=>s.domain===domain):actualSources;
    const bindingHash=hash((baseReleaseId?actualSources:boundSources).map(s=>`${s.domain}:${s.source_version_id}`).join('|'));
    await admin.query("INSERT INTO public.import_batches(import_batch_id,source_type,source_binding_hash,status,tenant_id,base_release_id) VALUES ($1,'seed',$2,'validating',$3,$4)",[batch,bindingHash,tenant,baseReleaseId]);
    await admin.query("SELECT set_config('app.import_binding_write','on',true)");
    for(const s of boundSources)await admin.query('INSERT INTO public.import_batch_source_bindings VALUES ($1,$2,$3)',[batch,s.domain,s.source_version_id]);
    await admin.query(`INSERT INTO public.outbox_jobs(job_id,job_type,payload,status,lease_owner,lease_version,lease_expires_at)
      VALUES ($1,'import_validate',$2::jsonb,'running','synthetic-worker',1,clock_timestamp()+interval '1 hour')`,[`job_${label}`,JSON.stringify({import_batch_id:batch})]);
    const mandatory=mode==='single'?0:1;
    await admin.query(`SELECT * FROM public.freeze_content_quality_review_plan($1,'synthetic-worker',1,$2,$3,'synthetic-v1',clock_timestamp(),1,$4,$5,$6,$7,'sha256-ranked-v1',$8::jsonb)`,[`job_${label}`,batch,`qplan_${label}`,1-mandatory,mandatory,hash('seed'),hash('selection'),JSON.stringify([row])]);
    await admin.query(`SELECT public.record_content_quality_review_evidence($1,$2,0,NULL,NULL,$3,0,1,0,'passed','EVD-SYNTHETIC-QUALITY','content_quality_reviewer')`,[`qplan_${label}`,1-mandatory,mandatory]);
    await admin.query('INSERT INTO public.staging_scripts SELECT * FROM jsonb_populate_record(NULL::public.staging_scripts,$1::jsonb)',[JSON.stringify(row)]);
    await admin.query("UPDATE public.import_batches SET status='staged', quality_gate_passed=true, clean_count=1 WHERE import_batch_id=$1",[batch]);
    await admin.query('COMMIT');
    return {batch,row,record,anchor:row.owner_acceptance_record_sha256,tenant};
  } catch(error){await admin.query('ROLLBACK');throw error;}
}
async function publish(f,role='owner') {
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE app_content_admin');
    const result=await c.query('SELECT * FROM public.publish_content_release($1,$2,$3,$4,$5)',[f.batch,'合成发布','合成摘要','synthetic-user',role]);await c.query('COMMIT');return result.rows[0];
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
async function state(f) {return (await admin.query(`SELECT
  (SELECT status FROM public.import_batches WHERE import_batch_id=$1) AS batch,
  (SELECT count(*)::int FROM public.scripts) AS scripts,
  (SELECT count(*)::int FROM public.content_releases) AS releases,
  (SELECT count(*)::int FROM public.release_items) AS items,
  (SELECT count(*)::int FROM content_intake.release_lineage) AS lineage,
  (SELECT count(*)::int FROM public.change_audits) AS audits,
  (SELECT current_release_id FROM public.content_current WHERE id=1) AS current,
  (SELECT count(*)::int FROM public.announcements) AS announcements`,[f.batch])).rows[0];}
async function rejectsAtomically(f,work,pattern){const before=await state(f);await assert.rejects(work,pattern);assert.deepEqual(await state(f),before);}
const sqlError=code=>error=>error.code===code;

test('owner acceptance publishes original anchor, tenant, approved version and searchable text',async()=>{
  const f=await seed();const r=await publish(f);
  const rows=(await admin.query('SELECT r.tenant_id,i.script_version,i.owner_acceptance_record_sha256,i.answer_text FROM public.release_items i JOIN public.content_releases r USING (release_id) WHERE release_id=$1',[r.release_id])).rows;
  assert.equal(rows.length,1);assert.deepEqual(rows[0],{tenant_id:f.tenant,script_version:1,owner_acceptance_record_sha256:f.anchor,answer_text:'合成正文'});
  assert.equal((await admin.query('SELECT public.owner_acceptance_release_content_ready($1) AS ready',[r.release_id])).rows[0].ready,true);
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM public.search_recommendable_scripts('qianniu') WHERE is_candidate")).rows[0].n,1);
});
for(const mode of ['single','dual'])test(`legacy ${mode} keeps its publication path`,async()=>{const f=await seed({mode});await publish(f);assert.equal((await state(f)).releases,1);});
test('revoked acceptance denies publication without partial writes',async()=>{const f=await seed();await admin.query('SELECT public.revoke_owner_acceptance($1,$2,$3)',[f.tenant,f.anchor,'EVD-SYNTHETIC-REVOKED']);await rejectsAtomically(f,()=>publish(f),sqlError('ZA004'));});

const errorDetail = (code, detail) => error => error.code === code && error.detail === detail;
test('acceptance expiry before publish denies the complete transaction', async () => {
  const f = await seed({ expiryMs: 350 });
  await admin.query('SELECT pg_sleep(GREATEST(0, extract(epoch FROM $1::timestamptz-clock_timestamp()))+0.02)', [f.record.expires_at]);
  await rejectsAtomically(f, () => publish(f), sqlError('ZA004'));
});
test('approval for a future version cannot skip the next authoring version', async () => {
  const f = await seed({ version: 2 });
  await rejectsAtomically(f, () => publish(f), errorDetail('ZA003','OWNER_ACCEPTANCE_IMPORT_VERSION_MISMATCH'));
});
test('batch cannot adopt sources and acceptance from another tenant', async () => {
  const f = await seed(); await admin.query('UPDATE public.import_batches SET tenant_id=$2 WHERE import_batch_id=$1',[f.batch,'tenant-other']);
  await rejectsAtomically(f, () => publish(f), errorDetail('ZA004','OWNER_ACCEPTANCE_NOT_ACTIVE'));
});
test('current release from another tenant cannot be inherited', async () => {
  const first = await seed({mode:'single'}); const r = await publish(first);
  const f = await seed({label:'second',baseReleaseId:r.release_id});
  await admin.query("BEGIN; SET LOCAL app.publishing='on'");
  await admin.query('UPDATE public.content_releases SET tenant_id=$2 WHERE release_id=$1',[r.release_id,'tenant-other']); await admin.query('COMMIT');
  await rejectsAtomically(f, () => publish(f), errorDetail('ZA004','OWNER_ACCEPTANCE_NOT_ACTIVE'));
});
for(const role of ['agent','enabler','manager','director','',null]) test(`legacy SQL role ${JSON.stringify(role)} cannot use owner/coach capability`, async () => {
  const f = await seed(); await rejectsAtomically(f, () => publish(f,role), sqlError('ZA005'));
});
for(const domain of ['product','campaign']) test(`SQL coach can publish only the approved ${domain} subset`, async () => {
  const base = await publish(await seed({mode:'single'}));
  const f = await seed({mode:'single',domain,onlyDomain:true,label:'second',baseReleaseId:base.release_id});
  await publish(f,'coach'); assert.equal((await state(f)).releases,2);
});
for(const scenario of [ {domain:'presale',onlyDomain:true}, {domain:'aftersale',onlyDomain:true},
  {domain:'product',onlyDomain:false}, {domain:'product',onlyDomain:true,sensitive:true}])
  test(`SQL coach refuses out-of-scope/sensitive ${JSON.stringify(scenario)}`, async () => {
    const f = await seed({mode:'single',...scenario}); await rejectsAtomically(f, () => publish(f,'coach'), sqlError('ZA005'));
  });
test('publisher workload cannot register an owner acceptance record', async () => {
  const f = await seed(); const c = await pool.connect();
  try { await c.query('BEGIN'); await c.query('SET LOCAL ROLE app_content_admin');
    await assert.rejects(() => c.query('SELECT public.register_owner_acceptance($1,$2,$3,$4)',[f.tenant,canonical(f.record)+'\n',f.anchor,f.record.owner_subject_hash]),sqlError('42501'));
  } finally { await c.query('ROLLBACK'); c.release(); }
});
const requestFor = f => ({ actor:{user_id:'synthetic-owner',role:'owner'},idempotencyKey:'synthetic-publish-key',body:{import_batch_id:f.batch,title:'合成发布',summary:'合成摘要'} });
test('concurrent identical service requests commit one release and replay one response', async () => {
  const f = await seed(); const svc = createContentReleaseServiceForPool(pool,hmac,logHash,false); const req=requestFor(f);
  const results=await Promise.all([svc.publish(req),svc.publish(req)]);
  assert.equal(results[0].ok,true); assert.deepEqual(results[1],results[0]); assert.equal((await state(f)).releases,1);
  const before=await state(f);const changed=await svc.publish({...req,body:{...req.body,title:'不同标题'}});
  assert.deepEqual(changed,{ok:false,code:'CONFLICT',commit:'rolled_back'});assert.deepEqual(await state(f),before);
});
test('lost COMMIT acknowledgement preserves the committed object and replays the original key', async () => {
  const f=await seed();let lose=true;
  const lossy={end:()=>pool.end(),connect:async()=>{const c=await pool.connect();return {release:broken=>c.release(broken),query:async(...args)=>{
    const result=await c.query(...args);if(lose&&args[0]==='COMMIT'){lose=false;throw new Error('synthetic lost COMMIT acknowledgement');}return result;
  }};}};
  const svc=createContentReleaseServiceForPool(lossy,hmac,logHash,false);const req=requestFor(f);
  assert.deepEqual(await svc.publish(req),{ok:false,code:'OVERLOADED',commit:'unknown'});
  const committed=await state(f);assert.equal(committed.releases,1);
  const replay=await svc.publish(req);assert.equal(replay.ok,true);assert.equal(replay.response.release_id,committed.current);assert.deepEqual(await state(f),committed);
});
for(const domain of ['product','campaign']) test(`SQL coach preserves owner-signed acceptance in ${domain}, without signing it`, async () => {
  const base=await publish(await seed({mode:'single'}));
  const f=await seed({domain,onlyDomain:true,label:'accepted',baseReleaseId:base.release_id});const r=await publish(f,'coach');
  assert.equal((await admin.query('SELECT owner_acceptance_record_sha256 FROM public.release_items WHERE release_id=$1 AND script_id=$2',[r.release_id,f.row.script_id])).rows[0].owner_acceptance_record_sha256,f.anchor);
  assert.equal((await admin.query('SELECT public.owner_acceptance_release_content_ready($1) AS ready',[r.release_id])).rows[0].ready,true);
});
test('changed expected source set is refused without publishing', async () => {
  const f=await seed();await admin.query('UPDATE public.import_batches SET source_binding_hash=$2 WHERE import_batch_id=$1',[f.batch,hash('changed-scope')]);
  await rejectsAtomically(f,()=>publish(f),errorDetail('ZA003','SOURCE_BINDING_HASH_MISMATCH'));
});
async function waitForBlocked(pid) {
  for(let i=0;i<200;i++){
    const blocked=(await admin.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[pid])).rows[0].blocked;
    if(blocked)return;await new Promise(resolve=>setTimeout(resolve,10));
  }throw new Error('Expected actual PG lock wait was not observed');
}
test('revocation committed while publisher waits is observed after its lock resumes', async () => {
  const f=await seed();const revoker=await pool.connect(),publisher=await pool.connect();let outcome;
  // Registrar is separate from publisher and is only used by this synthetic setup.
  await admin.query('GRANT app_owner_acceptance_registrar TO matrix_admin');
  try {
    await revoker.query('BEGIN');await revoker.query('SET LOCAL ROLE app_owner_acceptance_registrar');
    await revoker.query('SELECT public.revoke_owner_acceptance($1,$2,$3)',[f.tenant,f.anchor,'EVD-SYNTHETIC-CONCURRENT']);
    await publisher.query('BEGIN');await publisher.query('SET LOCAL ROLE app_content_admin');
    const pid=(await publisher.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;const before=await state(f);
    outcome=publisher.query('SELECT * FROM public.publish_content_release($1,$2,$3,$4,$5)',[f.batch,'合成','合成','synthetic','owner']).then(value=>({value}),error=>({error}));
    await waitForBlocked(pid);await revoker.query('COMMIT');const result=await outcome;
    assert.equal(result.error?.code,'ZA004');await publisher.query('ROLLBACK');assert.deepEqual(await state(f),before);
  }finally{await revoker.query('ROLLBACK');await outcome;await publisher.query('ROLLBACK');revoker.release();publisher.release();}
});
test('publishing only a subset of the owner-approved scope is refused', async () => {
  const f=await seed({extraApproved:true});await rejectsAtomically(f,()=>publish(f),errorDetail('ZA004','OWNER_ACCEPTANCE_NOT_ACTIVE'));
});
test('source suspension after staging rejects publication atomically', async () => {
  const f=await seed();await admin.query("SELECT public.suspend_authoritative_source($1,'SOURCE_REVOKED','EVD-SYNTHETIC-SUSPENDED','synthetic','owner')",[f.row.source_version_id]);
  await rejectsAtomically(f,()=>publish(f),errorDetail('ZA004','SOURCE_SUSPENDED'));
});
test('revocation waits for an already publishing transaction then invalidates its read eligibility', async () => {
  const f=await seed();await admin.query('GRANT app_owner_acceptance_registrar TO matrix_admin');
  const publisher=await pool.connect(),revoker=await pool.connect();let pending;
  try {
    await publisher.query('BEGIN');await publisher.query('SET LOCAL ROLE app_content_admin');
    const r=(await publisher.query('SELECT * FROM public.publish_content_release($1,$2,$3,$4,$5)',[f.batch,'合成','合成','synthetic','owner'])).rows[0];
    await revoker.query('BEGIN');await revoker.query('SET LOCAL ROLE app_owner_acceptance_registrar');
    const pid=(await revoker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pending=revoker.query('SELECT public.revoke_owner_acceptance($1,$2,$3)',[f.tenant,f.anchor,'EVD-SYNTHETIC-CONCURRENT']).then(()=>({ok:true}),error=>({error}));
    await waitForBlocked(pid);await publisher.query('COMMIT');assert.deepEqual(await pending,{ok:true});await revoker.query('COMMIT');
    assert.equal((await state(f)).current,r.release_id);
    assert.equal((await admin.query('SELECT public.owner_acceptance_release_content_ready($1) AS ready',[r.release_id])).rows[0].ready,false);
  }finally{await publisher.query('ROLLBACK');await pending;await revoker.query('ROLLBACK');publisher.release();revoker.release();}
});
test('review claim: an existing GRANT ALL FUNCTIONS does not grant future organization functions',async()=>{
  await admin.query('BEGIN');try{
    await admin.query('CREATE FUNCTION intake_organization.synthetic_future_probe() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$');
    await admin.query('REVOKE ALL ON FUNCTION intake_organization.synthetic_future_probe() FROM PUBLIC');
    assert.equal((await admin.query("SELECT has_function_privilege('intake_org_writer','intake_organization.synthetic_future_probe()','EXECUTE') AS allowed")).rows[0].allowed,false);
  }finally{await admin.query('ROLLBACK');}
});
test('review claim: restricted business caller cannot execute the ungranted SOP row deletion',async()=>{
  await admin.query('CREATE ROLE matrix_business LOGIN NOINHERIT; GRANT intake_business TO matrix_business');
  const c=await pg.connect({...pool.options,user:'matrix_business'});
  try{await c.query('SET ROLE intake_business');
    await assert.rejects(()=>c.query("SELECT content_intake.delete_unused_sop_row('synthetic-candidate',1,'sop:Sheet:1')"),sqlError('42501'));
  }finally{await c.end();}
});
