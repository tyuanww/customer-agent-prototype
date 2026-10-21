#!/usr/bin/env node
/**
 * Search door latency probe, runnable on both sides of the deadline work.
 *
 * It drives the public HTTP surface only, so the same script measures trunk (where the search
 * function takes three arguments and no gate exists) and a branch that gates the door on the
 * query source set. One JSON line per run keeps trunk and head comparable.
 *
 * Usage, from a repository checkout that has already been built:
 *
 *   node scripts/probe-search-latency.mjs
 *
 * Environment:
 *   CUSTOMER_AGENT_PG15_BIN   directory holding initdb/pg_ctl (default: Homebrew postgresql@15)
 *   PROBE_SAMPLES             samples per door (default 20)
 *   PROBE_LABEL               free-text label echoed in the output
 *
 * Each door prints the status every sample returned, so an accepted request can never be
 * reported as a refusal latency.
 */
import { createHash, randomUUID } from 'node:crypto';

const samples = Number(process.env.PROBE_SAMPLES ?? '20');
process.env.CUSTOMER_AGENT_PG15_BIN ??= '/Users/hutou/homebrew/opt/postgresql@15/bin';

const { Pg15Harness } = await import('../../../packages/database/dist/testkit/index.js');
const { applyDatabaseMigrations } = await import('../../../packages/database/dist/index.js');
const { registerSearchRoute } = await import('../dist/search-routes.js');
const { createEventRepository } = await import('../dist/event-repository.js');
const { createMockAuthService } = await import('../dist/auth-service.js');
const { default: Fastify } = await import('fastify');
const { Pool } = await import('pg');

const T = Object.freeze({
  tenant: 'tenant_probe', app: 'app_probe', brand: 'brand_probe', dept: 'dept_probe',
  job: 'job_probe', scope: 'scope_probe', source: 'source_probe',
  release: 'rel_probe', user: 'usr_probe_reader', actor: 'prn_probe_reader',
  issuer: 'prn_probe_issuer', issuerUser: 'usr_probe_issuer',
});
/** A release carries exactly one source version per domain, so the fixture has all four. */
const DOMAINS = ['presale', 'campaign', 'aftersale', 'product'];
const versionOf = (domain) => `srcv_probe_${domain}`;
const sha = (value) => createHash('sha256').update(value).digest('hex');

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : Math.round(sorted[middle]);
}

const harness = new Pg15Harness();
harness.start();
const database = harness.createDatabase('search_probe');
const admin = await harness.connect(database.config);
let app;
const pools = [];
try {
  await applyDatabaseMigrations(admin);

  // One published release with one item, and one principal with a live query grant, written
  // with plain SQL so the seed compiles against either side. On trunk the door ignores the
  // grant; on head the same rows make it live. Both sides therefore read the same data shape.
  await admin.query('BEGIN');
  await admin.query("SELECT set_config('app.publishing','on',true)");
  await admin.query("SELECT set_config('app.semantic_asset_write','publish',true)");
  for (const domain of DOMAINS) {
    await admin.query(
      `INSERT INTO public.authoritative_source_versions(
         source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
         use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at)
       VALUES ($1,$2,$3,'v1',$4,'canonical','ROLE-CONTENT-LEAD','EVD','probe_owner',
         clock_timestamp()-interval '1 day', clock_timestamp()+interval '365 days')`,
      [versionOf(domain), `SRC-PROBE-${domain.toUpperCase()}`, domain, sha(`probe-source-${domain}`)]);
  }
  await admin.query(
    `INSERT INTO public.intent_taxonomy_versions(intent_taxonomy_version,approval_evd,approved_by,approved_at)
     VALUES ('itax_probe','EVD','probe_owner',clock_timestamp())`);
  await admin.query(
    `INSERT INTO public.intent_taxonomy_entries(intent_taxonomy_version,intent_id,label,lifecycle)
     VALUES ('itax_probe','intent_probe','探针意图','active')`);
  await admin.query(
    `INSERT INTO public.semantic_source_assets(source_asset_id,source,origin_fingerprint,origin_fingerprint_key_version)
     VALUES ('sa_probe','manual',$1,'hmac-probe')`, [sha('probe-origin')]);
  const question = {
    question_id: 'q_probe_0001', question_version: 1, question_text: '探针发货时效',
    semantic_family_id: 'sf_probe', origin_fingerprint: sha('probe-origin'),
    origin_fingerprint_key_version: 'hmac-probe', source_asset_id: 'sa_probe', source: 'manual',
    intent_taxonomy_version: 'itax_probe', intent_id: 'intent_probe',
  };
  const hash = await admin.query('SELECT public.content_question_hash($1::jsonb) AS h',
    [JSON.stringify(question)]);
  await admin.query(
    `INSERT INTO public.content_releases(
       release_id, release_seq, title, status, source_binding_hash, published_by, published_by_role)
     VALUES ($1,1,'探针发布','published',$2,'probe_owner','owner')`,
    [T.release, sha([...DOMAINS].sort().map(domain => `${domain}:${versionOf(domain)}`).join('|'))]);
  for (const domain of DOMAINS) {
    await admin.query(
      `INSERT INTO public.release_source_bindings(release_id,domain,source_version_id) VALUES ($1,$2,$3)`,
      [T.release, domain, versionOf(domain)]);
  }
  await admin.query(
    `INSERT INTO public.release_items(
       release_id, script_id, script_version, content_hash, answer_text, title, category,
       source_ref, source_version_id, owner_role, review_due_at, effective_from, effective_to,
       platform_scope, product_scope_type, product_scope_refs, intent_taxonomy_version,
       intent_id, risk_level, risk_categories, has_conflict, review_mode, primary_reviewer_id,
       primary_reviewer_role, primary_review_evd, placeholder_keys, questions_json,
       search_document, search_fallback_text)
     VALUES ($1,'script_probe',1,$2,'探针回答 48 小时内发出。','探针发货时效','product',
       'SRC-PROBE-PRODUCT',$3,'ROLE-CONTENT-LEAD',clock_timestamp()+interval '90 days',
       clock_timestamp()-interval '1 day',NULL,ARRAY['qianniu'],'storewide',ARRAY[]::text[],
       'itax_probe','intent_probe','low',ARRAY[]::text[],false,'single',$4,
       'ROLE-CONTENT-LEAD','EVD',ARRAY[]::text[],$5::jsonb,
       to_tsvector('simple','探针 发货 时效'),'探针发货时效')`,
    [T.release, sha('probe-item'), versionOf('product'), sha('probe-reviewer'),
      JSON.stringify([{ ...question, question_hash: hash.rows[0].h }])]);
  await admin.query(
    `INSERT INTO public.content_current(id,current_release_id) VALUES (1,$1)
     ON CONFLICT (id) DO UPDATE SET current_release_id=$1`, [T.release]);
  await admin.query('COMMIT');

  // The intake rows the query source set reads on head. Trunk ignores them, but writing them
  // on both sides keeps the fixture identical.
  await admin.query('BEGIN');
  await admin.query('SET CONSTRAINTS ALL DEFERRED');
  for (const [binding, user] of [['binding_probe', T.user], ['binding_probe_issuer', T.issuerUser]]) {
    await admin.query(
      `INSERT INTO backend_identity.subject_bindings(
         binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
       VALUES ($1,'synthetic',$2,$1,$3,repeat('ab',32),true,'owner')`,
      [binding, T.tenant, user]);
  }
  await admin.query(
    'INSERT INTO content_intake.policy_versions(tenant_id,app_id,version) VALUES ($1,$2,1)',
    [T.tenant, T.app]);
  await admin.query(
    `INSERT INTO content_intake.scopes(scope_id,tenant_id,app_id,brand_id,shop_id,domain)
     VALUES ($1,$2,$3,$4,NULL,'product')`, [T.scope, T.tenant, T.app, T.brand]);
  await admin.query(
    `INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode)
     VALUES ($1,$2,1,'v2-preview')`, [T.source, T.scope]);
  // A source's current mapping version has to exist, so the mapping row comes with it.
  await admin.query(
    `INSERT INTO content_intake.source_mappings(
       source_id,version,template_version,rule_version,mapping_version,structure_digest)
     VALUES ($1,1,'faq-p1.1','intake-p1.1','faq-map',repeat('ab',32))`, [T.source]);
  for (const [principalId, userId] of [[T.actor, T.user], [T.issuer, T.issuerUser]]) {
    await admin.query(
      `INSERT INTO content_intake.principals(
         principal_id,user_id,tenant_id,app_id,identity_scope,person_key,
         current_facts_version,revocation_generation)
       VALUES ($1,$2,$3,$4,'confirmed-synthetic',$1,1,0)`, [principalId, userId, T.tenant, T.app]);
    await admin.query(
      `INSERT INTO content_intake.principal_facts(
         principal_id,facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest)
       VALUES ($1,1,ARRAY[$2]::text[],$3,true,
         statement_timestamp()-interval '1 second',
         statement_timestamp()+interval '4 minutes 59 seconds',
         repeat('ab',32))`, [principalId, T.dept, T.job]);
  }
  await admin.query(
    `INSERT INTO content_intake.role_rules(tenant_id,app_id,department_id,job_id,policy_version,role)
     VALUES ($1,$2,$3,$4,1,'director')`, [T.tenant, T.app, T.dept, T.job]);
  await admin.query(
    `INSERT INTO content_intake.store_sets(tenant_id,app_id,version,approved_at,provenance)
     VALUES ($1,$2,1,clock_timestamp(),'probe')`, [T.tenant, T.app]);
  await admin.query(
    'INSERT INTO content_intake.store_set_current(tenant_id,app_id,version) VALUES ($1,$2,1)',
    [T.tenant, T.app]);
  await admin.query(
    `INSERT INTO content_intake.store_set_members(
       tenant_id,app_id,version,scope_id,source_id,content_valid_until)
     VALUES ($1,$2,1,$3,$4,clock_timestamp()+interval '1 day')`,
    [T.tenant, T.app, T.scope, T.source]);
  await admin.query(
    `INSERT INTO content_intake.grants(
       grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,
       starts_at,expires_at,reason,steward_id)
     VALUES ('alloc_probe','allocation',$1,$1,$2::text,$3::text,$4::text,'query',
       clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '2 days','probe',$1)`,
    [T.issuer, T.tenant, T.app, T.scope]);
  await admin.query(
    `INSERT INTO content_intake.grants(
       grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,
       starts_at,expires_at,reason,steward_id,parent_grant_id,policy_version,store_set_version)
     VALUES ('grant_probe','business',$1,$2,$3::text,$4::text,$5::text,$6::text,'query',
       clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day','probe',$1,'alloc_probe',
       (SELECT version FROM content_intake.policy_versions WHERE tenant_id=$3::text AND app_id=$4::text),
       (SELECT version FROM content_intake.store_set_current WHERE tenant_id=$3::text AND app_id=$4::text))`,
    [T.issuer, T.actor, T.tenant, T.app, T.scope, T.source]);
  await admin.query('COMMIT');

  // The runtime executes the search function, so it must be a real non-superuser login.
  await admin.query(
    'CREATE ROLE probe_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
  await admin.query('GRANT app_runtime TO probe_runtime');
  const pool = new Pool({ ...database.config, user: 'probe_runtime', max: 4 });
  pools.push(pool);
  const events = createEventRepository(pool, 'probe_search');
  const auth = createMockAuthService();
  app = Fastify({ logger: false });
  registerSearchRoute(app, auth, {
    operation: { execute: (request) => events.executeSearch(request) },
    logHash: { version: 'hmac-log-v1', key: 'probe-log-hash-material-0000000000000001' },
    idempotencyHmac: {
      currentVersion: 'hmac-idempotency-v1',
      keys: { 'hmac-idempotency-v1': 'probe-idempotency-material-00000000000001' },
    },
  });
  await app.ready();

  const allowedToken = auth.createMockSession({ user_id: T.user, role: 'agent' }).token;
  const strangerToken = auth.createMockSession({ user_id: 'usr_probe_stranger', role: 'agent' }).token;
  const body = (queryId) => ({
    query_id: queryId, parent_query_id: null, interaction_reason: 'original',
    query_text: '探针发货时效', collection_mode: 'synthetic',
    detected_platform: 'qianniu', platform: 'qianniu', platform_source: 'manual',
    product_context_type: null, product_context_ref: null, top_k: 3,
  });
  const measure = async (token) => {
    const elapsed = [];
    const statuses = [];
    for (let index = 0; index < samples; index += 1) {
      const started = performance.now();
      const response = await app.inject({
        method: 'POST', url: '/v1/search',
        headers: { authorization: `Bearer ${token}` },
        payload: body(randomUUID()),
      });
      elapsed.push(performance.now() - started);
      statuses.push(response.statusCode);
    }
    return {
      statuses: [...new Set(statuses)],
      medianMs: median(elapsed),
      minMs: Math.round(Math.min(...elapsed)),
      maxMs: Math.round(Math.max(...elapsed)),
    };
  };

  // Warm both paths once so the first sample does not pay for pool connect and plan cache.
  await measure(allowedToken);
  console.log(JSON.stringify({
    label: process.env.PROBE_LABEL ?? 'unlabelled',
    samples,
    allowed: await measure(allowedToken),
    denied: await measure(strangerToken),
  }));
} finally {
  if (app) await app.close().catch(() => undefined);
  for (const pool of pools) await pool.end().catch(() => undefined);
  await admin.end().catch(() => undefined);
  harness.stop();
}
