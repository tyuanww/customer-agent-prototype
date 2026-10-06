import { createHash as sha } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Client } from 'pg';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createApiApp } from '../src/app.js';
import { createContentImportService } from '../src/content-import-service.js';
import { createContentObjectStore } from '../src/content-object-store.js';
import { createContentReleaseService } from '../src/content-release-service.js';
import { createContentReviewService } from '../src/content-review-service.js';
import { createContentWorker } from '../src/content-worker.js';
import { createProductAuthService } from '../src/product-auth-service.js';
import { parseApiRuntimeConfig } from '../src/runtime-config.js';
import { createServiceRepository } from '../src/service-repository.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const HMAC = Object.freeze({
  currentVersion: 'hmac-idempotency-v1',
  keys: Object.freeze({ 'hmac-idempotency-v1': 'synthetic-t4-idempotency-material-0001' }),
});
const LOG_HASH = Object.freeze({ version: 'hmac-log-v1', key: 'synthetic-t4-log-hash-material-00000001' });
const INTENT = Object.freeze({ version: 'itax_synthetic_t4_v1', id: 'intent_synthetic_t4_shipping' });
const REVIEW = Object.freeze({
  leadSubject: 'synthetic_lead',
  managerSubject: 'synthetic_manager',
  evidenceId: 'EVD-T4-REVIEW-001',
});
const BINDINGS = Object.freeze([
  { domain: 'aftersale', source_version_id: 'srcv_t4_aftersale_v1', source_ref: 'SRC-T4-AFTERSALE' },
  { domain: 'campaign', source_version_id: 'srcv_t4_campaign_v1', source_ref: 'SRC-T4-CAMPAIGN' },
  { domain: 'presale', source_version_id: 'srcv_t4_presale_v1', source_ref: 'SRC-T4-PRESALE' },
  { domain: 'product', source_version_id: 'srcv_t4_product_v1', source_ref: 'SRC-T4-PRODUCT' },
] as const);
const CSV = Buffer.from([
  'script_id,category,title,answer_text,source_version_id,source_ref,question_text,risk_level,has_conflict',
  'shipping-001,presale,发货时效,您好订单将在付款后发出,srcv_t4_presale_v1,SRC-T4-PRESALE,什么时候发货,high,false',
  '',
].join('\n'));
const verifier = 'v'.repeat(43);
const challenge = sha('sha256').update(verifier).digest('base64url');

describe.skipIf(!enabled)('content publish and rollback', () => {
  let harness: Pg15Harness;
  let admin: Client;
  let competitor: Client;
  let app: FastifyInstance;
  let worker: ReturnType<typeof createContentWorker>;

  beforeEach(async () => {
    harness = new Pg15Harness();
    harness.start();
    const db = harness.createDatabase('release');
    admin = await harness.connect(db.config);
    competitor = await harness.connect(db.config);
    await applyDatabaseMigrations(admin);
    await admin.query(`
      CREATE ROLE t4_runtime LOGIN; GRANT app_runtime TO t4_runtime;
      CREATE ROLE t4_admin LOGIN; GRANT app_content_admin TO t4_admin;
      CREATE ROLE t4_auth LOGIN NOINHERIT; GRANT app_backend_auth TO t4_auth;
      CREATE ROLE t4_worker LOGIN NOINHERIT; GRANT app_backend_worker TO t4_worker;
      CREATE ROLE t4_review LOGIN NOINHERIT; GRANT app_backend_review TO t4_review;
    `);
    const socket = new URLSearchParams({ host: harness.socket, port: String(harness.port) });
    const conn = (user: string) => `postgresql://${user}@localhost/${db.name}?${socket}`;
    const storeRoot = mkdtempSync(path.join(tmpdir(), 'ca-t4-store-'));
    const digest = sha('sha256').update(CSV).digest('hex');
    for (const binding of BINDINGS) {
      await admin.query(`
        INSERT INTO public.authoritative_source_versions(
          source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
          use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at
        ) VALUES ($1,$2,$3,'synthetic-t4',$4,'canonical','ROLE-CONTENT-LEAD','EVD-T4-SOURCE',
          'synthetic-owner', clock_timestamp() - interval '1 day', clock_timestamp() + interval '365 days')
      `, [binding.source_version_id, binding.source_ref, binding.domain, digest]);
    }
    await admin.query(`
      INSERT INTO public.intent_taxonomy_versions(intent_taxonomy_version, approval_evd, approved_by, approved_at)
      VALUES ($1,'EVD-T4-TAXONOMY','synthetic-owner', clock_timestamp())
    `, [INTENT.version]);
    await admin.query(`
      INSERT INTO public.intent_taxonomy_entries(intent_taxonomy_version, intent_id, label, lifecycle)
      VALUES ($1,$2,'合成发货', 'active')
    `, [INTENT.version, INTENT.id]);
    await admin.query("SELECT pg_catalog.set_config('app.semantic_asset_write', 'publish', false)");
    await admin.query(`
      INSERT INTO public.semantic_source_assets(
        source_asset_id, source, origin_fingerprint, origin_fingerprint_key_version
      ) VALUES ('sa_shipping-001', 'manual', encode(sha256(convert_to('origin:shipping-001','UTF8')),'hex'), 'hmac-synthetic-v1')
    `);
    for (const [id, user, cap, role] of [
      ['synthetic_owner', 'usr_t4_owner', null, 'owner'],
      ['synthetic_lead', 'usr_t4_lead', 'content_review_lead', 'coach'],
      ['synthetic_manager', 'usr_t4_manager', 'content_review_manager', 'coach'],
      ['synthetic_quality', 'usr_t4_quality', 'content_quality_reviewer', 'coach'],
    ] as const) {
      await admin.query(`
        INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
        VALUES ($1,'synthetic','synthetic-tenant',$1,$2,encode(sha256(convert_to($1,'UTF8')),'hex'),true,$3)
      `, [id, user, role]);
      if (cap) {
        await admin.query(`
          INSERT INTO backend_identity.capability_bindings(user_id,capability,enabled,evidence_id)
          VALUES ($1,$2,true,'EVD-T4-CAP')
        `, [user, cap]);
      }
    }
    const repository = createServiceRepository({
      connectionString: conn('t4_runtime'), poolMax: 4, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000,
    });
    const store = createContentObjectStore(storeRoot);
    const auth = await createProductAuthService(
      { connectionString: conn('t4_auth'), poolMax: 2, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000 },
      {
        authorizeUrl: (state) => `http://127.0.0.1:9/authorize?state=${state}`,
        exchange: async (code) => code,
        close: () => undefined,
      },
      'mock',
    );
    app = createApiApp(
      parseApiRuntimeConfig({
        CUSTOMER_AGENT_PROFILE: 'test', AUTH_MODE: 'mock', AUTH_SESSION_MODE: 'product',
        CUSTOMER_AGENT_API_PORT: '0', CUSTOMER_AGENT_BUILD_VERSION: 'synthetic-t4',
      }),
      repository, undefined, auth, undefined, undefined, undefined,
      { service: createContentImportService(store, repository.contentImport, HMAC, LOG_HASH) },
      { service: createContentReviewService({
        connectionString: conn('t4_review'), poolMax: 2, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000,
      }) },
      { service: createContentReleaseService(
        { connectionString: conn('t4_admin'), poolMax: 2, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000 },
        HMAC, LOG_HASH,
      ) },
    );
    worker = createContentWorker(
      { connectionString: conn('t4_worker'), poolMax: 2, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000 },
      store,
      { intentTaxonomyVersion: INTENT.version, intentId: INTENT.id, reviewCommitment: REVIEW },
    );
  }, 120_000);

  afterEach(async () => {
    await worker?.close();
    await app?.close();
    await admin?.end();
    await competitor?.end();
    harness?.stop();
  }, 60_000);

  async function productToken(bindingId: string): Promise<string> {
    const created = await app.inject({
      method: 'POST', url: '/v1/auth/login-requests',
      payload: { client_challenge: challenge, challenge_method: 'S256' },
    });
    const login = created.json() as { login_id: string; authorize_url: string };
    const state = new URL(login.authorize_url).searchParams.get('state');
    expect((await app.inject({ url: `/v1/auth/callback?state=${state}&code=${bindingId}` })).statusCode).toBe(200);
    const exchanged = await app.inject({
      method: 'POST', url: `/v1/auth/login-requests/${login.login_id}/exchange`,
      payload: { client_verifier: verifier },
    });
    expect(exchanged.statusCode).toBe(200);
    return exchanged.json().access_token as string;
  }

  function multipart(csv: Buffer = CSV, domains?: readonly string[]): Buffer {
    const boundary = '----t4boundary';
    const json = JSON.stringify(BINDINGS.filter(b => !domains || domains.includes(b.domain))
      .map(({ domain, source_version_id }) => ({ domain, source_version_id })));
    return Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.csv"\r\nContent-Type: text/csv\r\n\r\n`),
      csv,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="source_bindings"\r\n\r\n${json}\r\n--${boundary}--\r\n`),
    ]);
  }

  async function stageBatch(idempotencyKey: string, csv: Buffer = CSV, domains?: readonly string[]): Promise<string> {
    const owner = await productToken('synthetic_owner');
    const imported = await app.inject({
      method: 'POST', url: '/v1/content/import',
      headers: {
        authorization: `Bearer ${owner}`,
        'idempotency-key': idempotencyKey,
        'content-type': 'multipart/form-data; boundary=----t4boundary',
      },
      payload: multipart(csv, domains),
    });
    expect(imported.statusCode).toBe(202);
    const batchId = imported.json().import_batch_id as string;
    expect(await worker.runOnce()).toBe('finished');
    return batchId;
  }

  async function intakeSource(domain: string, mode = 'v2-active') {
    // Synthetic mode fixture only. No application role gains a mode setter.
    await admin.query('BEGIN');
    try {
      await admin.query('SELECT backend_review.lock_content()');
      await admin.query("INSERT INTO content_intake.scopes VALUES ('scope-fence','synthetic-tenant','app-fence','brand-fence','shop-fence',$1)", [domain]);
      await admin.query("INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode) VALUES ('source-fence','scope-fence',1,$1)", [mode]);
      await admin.query("INSERT INTO content_intake.source_mappings VALUES ('source-fence',1,'faq-p1.1','intake-p1.1','mapping-p1.1',repeat('a',64))");
      await admin.query('COMMIT');
    } catch (error) { await admin.query('ROLLBACK'); throw error; }
  }
  async function publishBatch(batch: string, key: string) {
    return app.inject({ method:'POST',url:'/v1/content/publish',
      headers:{ authorization:`Bearer ${await productToken('synthetic_owner')}`,'idempotency-key':key },
      payload:{ import_batch_id:batch,title:'合成隔离验证',summary:'synthetic fence' } });
  }
  async function clearNoopReservations(batch: string) {
    // Fixture for the final-publish race: unchanged source hashes need no restore.
    // This models a staged legacy batch without an outstanding snapshot mutation;
    // real pending mutations are covered by the activation/cancellation test below.
    await admin.query('DELETE FROM public.source_snapshot_revisions WHERE import_batch_id=$1 AND previous_sha256=new_sha256',[batch]);
    expect((await admin.query('SELECT count(*) FROM public.source_snapshot_revisions WHERE import_batch_id=$1',[batch])).rows[0].count).toBe('0');
  }

  it('fences the entire bound domain set, including a source absent from the uploaded rows', async () => {
    const batch = await stageBatch('fence-whole-domain');
    await clearNoopReservations(batch);
    await intakeSource('product'); // CSV rows are presale, but the batch binds all four domains.
    const result = await publishBatch(batch,'fence-publish');
    expect(result.statusCode,result.body).toBe(409);
    expect((await admin.query('SELECT count(*) FROM public.content_releases')).rows[0].count).toBe('0');
    expect((await admin.query('SELECT status FROM public.import_batches WHERE import_batch_id=$1',[batch])).rows[0].status).toBe('staged');
  });

  it('inherits the catalog on a disjoint-domain legacy publish and refuses legacy rollback through it', async () => {
    const first = await publishBatch(await stageBatch('fence-first'),'fence-first-publish');
    expect(first.statusCode,first.body).toBe(200);
    const previous = first.json().release_id as string;
    // Seeds only the new catalog shape, not a P2 publication success.
    await admin.query("INSERT INTO content_intake.release_catalogs(release_id,format_version) VALUES ($1,'intake-v2.1')",[previous]);
    await intakeSource('product');
    const second = await publishBatch(await stageBatch('fence-second',CSV,['presale']),'fence-second-publish');
    expect(second.statusCode,second.body).toBe(200);
    expect((await admin.query('SELECT format_version,sop_nodes,sop_edges,media FROM content_intake.release_catalogs WHERE release_id=$1',[second.json().release_id])).rows)
      .toEqual([{ format_version:'intake-v2.1',sop_nodes:[],sop_edges:[],media:[] }]);
    const rollback = await app.inject({ method:'POST',url:'/v1/content/rollback',
      headers:{ authorization:`Bearer ${await productToken('synthetic_owner')}`,'idempotency-key':'fence-rollback' },
      payload:{ target_release_id:previous,title:'合成旧回退',summary:'blocked' } });
    expect(rollback.statusCode,rollback.body).toBe(409);
    expect((await admin.query('SELECT current_release_id FROM public.content_current')).rows[0].current_release_id).toBe(second.json().release_id);
  });

  it('does not inherit a revoked catalog or leave a partial release on refusal', async () => {
    const first = await publishBatch(await stageBatch('fence-revoked-first'),'fence-revoked-publish');
    expect(first.statusCode,first.body).toBe(200);
    const previous = first.json().release_id as string;
    await admin.query("INSERT INTO content_intake.release_catalogs(release_id,format_version) VALUES ($1,'intake-v2.1')",[previous]);
    await admin.query("INSERT INTO content_intake.release_revocations VALUES ($1,1,'APPROVAL_REVOKED',clock_timestamp())",[previous]);
    const result = await publishBatch(await stageBatch('fence-revoked-next',CSV,['presale']),'fence-revoked-next-publish');
    expect(result.statusCode,result.body).toBe(409);
    expect((await admin.query('SELECT count(*) FROM public.content_releases')).rows[0].count).toBe('1');
    expect((await admin.query('SELECT count(*) FROM public.announcements')).rows[0].count).toBe('1');
  });

  it('observes activation committed while the legacy publisher waits for the shared first lock', async () => {
    const batch = await stageBatch('fence-mode-wins');
    await clearNoopReservations(batch);
    await intakeSource('product','legacy');
    await admin.query('BEGIN');
    let pending: ReturnType<typeof publishBatch> | undefined;
    try {
      await admin.query('SELECT backend_review.lock_content()');
      pending = publishBatch(batch,'fence-mode-wins-publish');
      await expect.poll(async () => (await admin.query("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=724019 AND objid=1 AND NOT granted")).rows[0].count).toBe('1');
      // A waiting legacy publisher must not have acquired its second lock first.
      await competitor.query('BEGIN');
      try {
        expect((await competitor.query("SELECT pg_try_advisory_xact_lock(hashtext('cs_ai_content_publish')) AS free")).rows[0].free).toBe(true);
      } finally { await competitor.query('ROLLBACK'); }
      await admin.query("UPDATE content_intake.sources SET mode='v2-active',mode_version=mode_version+1 WHERE source_id='source-fence'");
      await admin.query('COMMIT');
      const result = await pending;
      expect(result.statusCode,result.body).toBe(409);
      expect((await admin.query('SELECT count(*) FROM public.content_releases')).rows[0].count).toBe('0');
    } finally { await admin.query('ROLLBACK'); await pending; }
  });

  it('holds the shared lock through publication so a queued mode CAS observes the new base', async () => {
    const batch = await stageBatch('fence-publish-wins');
    await clearNoopReservations(batch);
    await intakeSource('product','legacy');
    await admin.query('BEGIN');
    let pending: Promise<unknown> | undefined;
    try {
      await admin.query('SELECT * FROM public.publish_content_release($1,$2,$3,$4,$5)',[batch,'合成','合成','usr_t4_owner','owner']);
      // Synthetic control-plane CAS, not a production activation API.
      pending = competitor.query(`DO $$ BEGIN
        PERFORM backend_review.lock_content();
        IF EXISTS (SELECT 1 FROM public.content_current WHERE current_release_id IS NOT NULL) THEN
          RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MODE_BASE_CHANGED';
        END IF;
        UPDATE content_intake.sources SET mode='v2-active',mode_version=mode_version+1 WHERE source_id='source-fence';
      END $$`).then(() => 'unexpected activation', error => error);
      await expect.poll(async () => (await admin.query("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=724019 AND objid=1 AND NOT granted")).rows[0].count).toBe('1');
      await admin.query('COMMIT');
      expect(await pending).toMatchObject({ code:'ZA003',message:'MODE_BASE_CHANGED' });
      expect((await admin.query("SELECT mode FROM content_intake.sources WHERE source_id='source-fence'")).rows[0].mode).toBe('legacy');
    } finally { await admin.query('ROLLBACK'); await pending; }
  });

  it('rolls back the old release, pointer, announcement and catalog when inheritance cannot complete', async () => {
    const first = await publishBatch(await stageBatch('fence-fault-first'),'fence-fault-first-publish');
    expect(first.statusCode,first.body).toBe(200);
    const previous = first.json().release_id as string;
    await admin.query("INSERT INTO content_intake.release_catalogs(release_id,format_version) VALUES ($1,'intake-v2.1')",[previous]);
    const batch = await stageBatch('fence-fault-next',CSV,['presale']);
    await admin.query(`CREATE FUNCTION public.synthetic_catalog_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic catalog fault'; END $$;
      CREATE TRIGGER synthetic_catalog_failure BEFORE INSERT ON content_intake.release_catalogs
      FOR EACH ROW EXECUTE FUNCTION public.synthetic_catalog_failure()`);
    const result = await publishBatch(batch,'fence-fault-next-publish');
    expect(result.statusCode).toBe(500);
    expect((await admin.query('SELECT current_release_id FROM public.content_current')).rows[0].current_release_id).toBe(previous);
    for (const table of ['public.content_releases','public.announcements','content_intake.release_catalogs']) {
      expect((await admin.query(`SELECT count(*) FROM ${table}`)).rows[0].count).toBe('1');
    }
    expect((await admin.query('SELECT status FROM public.import_batches WHERE import_batch_id=$1',[batch])).rows[0].status).toBe('staged');
  });

  it('refuses active-domain upload before it can commit source hashes or snapshot revisions', async () => {
    await intakeSource('product');
    const before = (await admin.query('SELECT source_version_id,snapshot_sha256 FROM public.authoritative_source_versions ORDER BY source_version_id')).rows;
    const changed = Buffer.from(CSV.toString().replace('您好订单将在付款后发出','合成新正文'));
    const result = await app.inject({ method:'POST',url:'/v1/content/import',
      headers:{ authorization:`Bearer ${await productToken('synthetic_owner')}`,'idempotency-key':'fence-upload',
        'content-type':'multipart/form-data; boundary=----t4boundary' },payload:multipart(changed) });
    expect(result.statusCode,result.body).toBe(409);
    expect((await admin.query('SELECT source_version_id,snapshot_sha256 FROM public.authoritative_source_versions ORDER BY source_version_id')).rows).toEqual(before);
    expect((await admin.query('SELECT count(*) FROM public.source_snapshot_revisions')).rows[0].count).toBe('0');
    expect((await admin.query('SELECT count(*) FROM public.import_batches')).rows[0].count).toBe('0');
  });

  it('keeps cancellation able to restore by refusing activation while a legacy snapshot is pending', async () => {
    await intakeSource('product','legacy');
    const before = (await admin.query('SELECT source_version_id,snapshot_sha256 FROM public.authoritative_source_versions ORDER BY source_version_id')).rows;
    const changed = Buffer.from(CSV.toString().replace('您好订单将在付款后发出','合成新正文'));
    const batch = await stageBatch('fence-pending-snapshot',changed);
    await expect(admin.query("UPDATE content_intake.sources SET mode='v2-active',mode_version=mode_version+1 WHERE source_id='source-fence'"))
      .rejects.toMatchObject({ code:'ZA003',message:'pending legacy snapshot restoration' });
    await admin.query("SELECT public.cancel_content_import($1,'synthetic-cancel','usr_t4_owner','owner')",[batch]);
    expect((await admin.query('SELECT source_version_id,snapshot_sha256 FROM public.authoritative_source_versions ORDER BY source_version_id')).rows).toEqual(before);
    expect((await admin.query('SELECT count(*) FROM public.source_snapshot_revisions')).rows[0].count).toBe('0');
    await admin.query("UPDATE content_intake.sources SET mode='v2-active',mode_version=mode_version+1 WHERE source_id='source-fence'");
    expect((await admin.query("SELECT mode FROM content_intake.sources WHERE source_id='source-fence'")).rows[0].mode).toBe('v2-active');
  });

  it.each(['mode-first','snapshot-first'] as const)('serializes the earlier snapshot mutation and mode admission: %s', async order => {
    await intakeSource('product','legacy');
    const bindings = JSON.stringify(BINDINGS.filter(b => b.domain==='product').map(({domain,source_version_id}) => ({domain,source_version_id})));
    const advance = (client: Client) => client.query("SELECT public.advance_source_snapshots($1::jsonb,repeat('b',64),'owner','synthetic-reservation')",[bindings]);
    const activate = (client: Client) => client.query("UPDATE content_intake.sources SET mode='v2-active',mode_version=mode_version+1 WHERE source_id='source-fence'");
    await admin.query('BEGIN');
    let pending: Promise<unknown> | undefined;
    try {
      await (order==='mode-first' ? activate(admin) : advance(admin));
      pending = (order==='mode-first' ? advance(competitor) : activate(competitor)).then(() => 'unexpected success',error => error);
      await expect.poll(async () => (await admin.query("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=724019 AND objid=1 AND NOT granted")).rows[0].count).toBe('1');
      await admin.query('COMMIT');
      expect(await pending).toMatchObject({ code:'ZA003' });
      const revisions = Number((await admin.query('SELECT count(*) FROM public.source_snapshot_revisions')).rows[0].count);
      expect(revisions).toBe(order==='mode-first' ? 0 : 1);
      if (order==='snapshot-first') {
        await admin.query("SELECT public.restore_source_snapshots('synthetic-reservation')");
        await activate(admin);
      }
      expect((await admin.query("SELECT snapshot_sha256 FROM public.authoritative_source_versions WHERE domain='product'")).rows[0].snapshot_sha256)
        .toBe(sha('sha256').update(CSV).digest('hex'));
    } finally { await admin.query('ROLLBACK'); await pending; }
  });

  it('publishes a staged batch, rejects non-owners, replays, and refuses current/missing rollback', async () => {
    const batchId = await stageBatch('idem-t4-a');
    const owner = await productToken('synthetic_owner');
    const coach = await productToken('synthetic_lead');
    const body = { import_batch_id: batchId, title: '合成发布', summary: 'T4' };
    expect((await app.inject({
      method: 'POST', url: '/v1/content/publish',
      headers: { authorization: `Bearer ${coach}`, 'idempotency-key': 'pub-coach', 'content-type': 'application/json' },
      payload: body,
    })).statusCode).toBe(403);
    const published = await app.inject({
      method: 'POST', url: '/v1/content/publish',
      headers: { authorization: `Bearer ${owner}`, 'idempotency-key': 'pub-owner', 'content-type': 'application/json' },
      payload: body,
    });
    expect(published.statusCode).toBe(200);
    const first = published.json() as { release_id: string; release_seq: number };
    expect(first.release_seq).toBe(1);
    const replay = await app.inject({
      method: 'POST', url: '/v1/content/publish',
      headers: { authorization: `Bearer ${owner}`, 'idempotency-key': 'pub-owner', 'content-type': 'application/json' },
      payload: body,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().release_id).toBe(first.release_id);
    const concurrent = await Promise.all([0, 1].map((index) => app.inject({
      method: 'POST', url: '/v1/content/publish',
      headers: { authorization: `Bearer ${owner}`, 'idempotency-key': `pub-stale-${index}`, 'content-type': 'application/json' },
      payload: body,
    })));
    expect(concurrent.every((result) => result.statusCode === 409)).toBe(true);
    const currentRollback = await app.inject({
      method: 'POST', url: '/v1/content/rollback',
      headers: { authorization: `Bearer ${owner}`, 'idempotency-key': 'rb-current', 'content-type': 'application/json' },
      payload: { target_release_id: first.release_id, title: '回滚当前', summary: 'already current' },
    });
    expect(currentRollback.statusCode).toBe(409);
    const missing = await app.inject({
      method: 'POST', url: '/v1/content/rollback',
      headers: { authorization: `Bearer ${owner}`, 'idempotency-key': 'rb-missing', 'content-type': 'application/json' },
      payload: { target_release_id: 'rel_does_not_exist', title: '回滚缺失', summary: 'missing' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('reimports identical content and rolls back to a new release sequence', async () => {
    const batchId = await stageBatch('idem-t4-a');
    const owner = await productToken('synthetic_owner');
    const firstResponse = await app.inject({
      method: 'POST', url: '/v1/content/publish',
      headers: { authorization: `Bearer ${owner}`, 'idempotency-key': 'pub-first', 'content-type': 'application/json' },
      payload: { import_batch_id: batchId, title: '首版', summary: 'synthetic first' },
    });
    expect(firstResponse.statusCode, firstResponse.body).toBe(200);
    const first = firstResponse.json() as { release_id: string; release_seq: number };
    const secondBatch = await stageBatch('idem-t4-b');
    const second = await app.inject({
      method: 'POST', url: '/v1/content/publish',
      headers: { authorization: `Bearer ${owner}`, 'idempotency-key': 'pub-second', 'content-type': 'application/json' },
      payload: { import_batch_id: secondBatch, title: '再次发布', summary: 'synthetic repeat' },
    });
    expect(second.statusCode, second.body).toBe(200);
    const rollback = await app.inject({
      method: 'POST', url: '/v1/content/rollback',
      headers: { authorization: `Bearer ${owner}`, 'idempotency-key': 'rb-first', 'content-type': 'application/json' },
      payload: { target_release_id: first.release_id, title: '恢复首版', summary: 'synthetic rollback' },
    });
    expect(rollback.statusCode, rollback.body).toBe(200);
    expect(rollback.json().release_seq).toBeGreaterThan(second.json().release_seq);
    expect(rollback.json().release_id).not.toBe(first.release_id);

  });

  it('reports a stable-identity collision as a reason, not as an in-flight draft', async () => {
    const firstBatch = await stageBatch('idem-t4-id-a');
    const owner = await productToken('synthetic_owner');
    const first = await app.inject({
      method: 'POST', url: '/v1/content/publish',
      headers: { authorization: `Bearer ${owner}`, 'idempotency-key': 'pub-id-first', 'content-type': 'application/json' },
      payload: { import_batch_id: firstBatch, title: '首版', summary: 'synthetic first' },
    });
    expect(first.statusCode, first.body).toBe(200);
    // Same script_id and question_version, different question_text: the published lineage owns
    // this stable identity, so the database refuses the replacement.
    const reworded = Buffer.from([
      'script_id,category,title,answer_text,source_version_id,source_ref,question_text,risk_level,has_conflict',
      'shipping-001,presale,发货时效,您好订单将在付款后发出,srcv_t4_presale_v1,SRC-T4-PRESALE,请问何时发货,high,false',
      '',
    ].join('\n'));
    const secondBatch = await stageBatch('idem-t4-id-b', reworded);
    const conflict = await app.inject({
      method: 'POST', url: '/v1/content/publish',
      headers: { authorization: `Bearer ${owner}`, 'idempotency-key': 'pub-id-second', 'content-type': 'application/json' },
      payload: { import_batch_id: secondBatch, title: '改名版', summary: 'synthetic reword' },
    });
    expect(conflict.statusCode, conflict.body).toBe(400);
    // The operator has to edit the table; telling them "a draft is in flight" would send them to
    // the wrong button. The reason must survive the CONFLICT collapse of ZA003.
    expect(conflict.json()).toMatchObject({ error: { code: 'VALIDATION', details: { reason: 'QUESTION_IDENTITY_CONFLICT' } } });
  });
});
