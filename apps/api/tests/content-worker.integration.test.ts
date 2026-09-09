import { createHash as sha } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createApiApp } from '../src/app.js';
import { createContentImportService } from '../src/content-import-service.js';
import { createContentObjectStore } from '../src/content-object-store.js';
import { createContentReviewService } from '../src/content-review-service.js';
import { createContentWorker } from '../src/content-worker.js';
import { createProductAuthService } from '../src/product-auth-service.js';
import { parseApiRuntimeConfig } from '../src/runtime-config.js';
import { createServiceRepository } from '../src/service-repository.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const HMAC = Object.freeze({
  currentVersion: 'hmac-idempotency-v1',
  keys: Object.freeze({ 'hmac-idempotency-v1': 'synthetic-t3-idempotency-material-0001' }),
});
const LOG_HASH = Object.freeze({ version: 'hmac-log-v1', key: 'synthetic-t3-log-hash-material-00000001' });
const INTENT = Object.freeze({ version: 'itax_synthetic_t3_v1', id: 'intent_synthetic_t3_shipping' });
const REVIEW = Object.freeze({
  leadSubject: 'synthetic_lead',
  managerSubject: 'synthetic_manager',
  evidenceId: 'EVD-T3-REVIEW-001',
});
const BINDINGS = Object.freeze([
  { domain: 'aftersale', source_version_id: 'srcv_t3_aftersale_v1', source_ref: 'SRC-T3-AFTERSALE' },
  { domain: 'campaign', source_version_id: 'srcv_t3_campaign_v1', source_ref: 'SRC-T3-CAMPAIGN' },
  { domain: 'presale', source_version_id: 'srcv_t3_presale_v1', source_ref: 'SRC-T3-PRESALE' },
  { domain: 'product', source_version_id: 'srcv_t3_product_v1', source_ref: 'SRC-T3-PRODUCT' },
] as const);
const CSV = Buffer.from([
  'script_id,category,title,answer_text,source_version_id,source_ref,question_text,risk_level,has_conflict',
  'shipping-001,presale,发货时效,您好订单将在付款后发出,srcv_t3_presale_v1,SRC-T3-PRESALE,什么时候发货,high,false',
  '',
].join('\n'));
const verifier = 'v'.repeat(43);
const challenge = sha('sha256').update(verifier).digest('base64url');

describe.skipIf(!enabled)('content worker and restricted review', () => {
  let harness: Pg15Harness;
  let admin: Client;
  let app: FastifyInstance;
  let worker: ReturnType<typeof createContentWorker>;
  let storeRoot: string;
  let workerUrl: string;
  let reviewUrl: string;

  beforeEach(async () => {
    harness = new Pg15Harness();
    harness.start();
    const db = harness.createDatabase('worker');
    admin = await harness.connect(db.config);
    await applyDatabaseMigrations(admin);
    await admin.query(`
      CREATE ROLE t3_runtime LOGIN; GRANT app_runtime TO t3_runtime;
      CREATE ROLE t3_admin LOGIN; GRANT app_content_admin TO t3_admin;
      CREATE ROLE t3_auth LOGIN NOINHERIT; GRANT app_backend_auth TO t3_auth;
      CREATE ROLE t3_worker LOGIN NOINHERIT; GRANT app_backend_worker TO t3_worker;
      CREATE ROLE t3_review LOGIN NOINHERIT; GRANT app_backend_review TO t3_review;
    `);
    const socket = new URLSearchParams({ host: harness.socket, port: String(harness.port) });
    const conn = (user: string) => `postgresql://${user}@localhost/${db.name}?${socket}`;
    workerUrl = conn('t3_worker');
    reviewUrl = conn('t3_review');
    storeRoot = mkdtempSync(path.join(tmpdir(), 'ca-t3-store-'));
    const digest = sha('sha256').update(CSV).digest('hex');
    for (const binding of BINDINGS) {
      await admin.query(`
        INSERT INTO public.authoritative_source_versions(
          source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
          use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at
        ) VALUES ($1,$2,$3,'synthetic-t3',$4,'canonical','ROLE-CONTENT-LEAD','EVD-T3-SOURCE',
          'synthetic-owner', clock_timestamp() - interval '1 day', clock_timestamp() + interval '365 days')
      `, [binding.source_version_id, binding.source_ref, binding.domain, digest]);
    }
    await admin.query(`
      INSERT INTO public.intent_taxonomy_versions(intent_taxonomy_version, approval_evd, approved_by, approved_at)
      VALUES ($1,'EVD-T3-TAXONOMY','synthetic-owner', clock_timestamp())
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
    for (const [id, user, cap] of [
      ['synthetic_lead', 'usr_t3_lead', 'content_review_lead'],
      ['synthetic_manager', 'usr_t3_manager', 'content_review_manager'],
      ['synthetic_quality', 'usr_t3_quality', 'content_quality_reviewer'],
      ['synthetic_seat', 'usr_t3_seat', null],
    ] as const) {
      await admin.query(`
        INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
        VALUES ($1,'synthetic','synthetic-tenant',$1,$2,encode(sha256(convert_to($1,'UTF8')),'hex'),true,'coach')
      `, [id, user]);
      if (cap) {
        await admin.query(`
          INSERT INTO backend_identity.capability_bindings(user_id,capability,enabled,evidence_id)
          VALUES ($1,$2,true,'EVD-T3-CAP')
        `, [user, cap]);
      }
    }
    const repository = createServiceRepository({
      connectionString: conn('t3_runtime'), poolMax: 4, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000,
    });
    const store = createContentObjectStore(storeRoot);
    const auth = await createProductAuthService(
      { connectionString: conn('t3_auth'), poolMax: 2, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000 },
      {
        authorizeUrl: (state) => `http://127.0.0.1:9/authorize?state=${state}`,
        exchange: async (code) => code,
        close: () => undefined,
      },
    );
    app = createApiApp(
      parseApiRuntimeConfig({
        CUSTOMER_AGENT_PROFILE: 'test', AUTH_MODE: 'mock', AUTH_SESSION_MODE: 'product',
        CUSTOMER_AGENT_API_PORT: '0', CUSTOMER_AGENT_BUILD_VERSION: 'synthetic-t3',
      }),
      repository, undefined, auth, undefined, undefined, undefined,
      { service: createContentImportService(store, repository.contentImport, HMAC, LOG_HASH) },
      { service: createContentReviewService({
        connectionString: reviewUrl, poolMax: 2, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000,
      }) },
    );
    worker = createContentWorker(
      { connectionString: workerUrl, poolMax: 2, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000 },
      store,
      { intentTaxonomyVersion: INTENT.version, intentId: INTENT.id, reviewCommitment: REVIEW },
    );
  }, 120_000);

  afterEach(async () => {
    await worker?.close();
    await app?.close();
    await admin?.end();
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

  function multipart(): Buffer {
    const boundary = '----t3boundary';
    const json = JSON.stringify(BINDINGS.map(({ domain, source_version_id }) => ({ domain, source_version_id })));
    return Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.csv"\r\nContent-Type: text/csv\r\n\r\n`),
      CSV,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="source_bindings"\r\n\r\n${json}\r\n--${boundary}--\r\n`),
    ]);
  }

  async function importBatch(key: string): Promise<string> {
    const owner = await productToken('synthetic_lead');
    const imported = await app.inject({
      method: 'POST', url: '/v1/content/import',
      headers: {
        authorization: `Bearer ${owner}`,
        'idempotency-key': key,
        'content-type': 'multipart/form-data; boundary=----t3boundary',
      },
      payload: multipart(),
    });
    expect(imported.statusCode).toBe(202);
    return imported.json().import_batch_id as string;
  }

  it('parks a claimed import, requires distinct dual reviewers, then resumes to staged', async () => {
    const owner = await productToken('synthetic_lead');
    const batchId = await importBatch('idem-t3-1');
    expect(await worker.runOnce()).toBe('parked');
    const seat = await productToken('synthetic_seat');
    expect((await app.inject({
      url: '/v1/admin/content/reviews', headers: { authorization: `Bearer ${seat}` },
    })).statusCode).toBe(403);
    const lead = await productToken('synthetic_lead');
    const manager = await productToken('synthetic_manager');
    const quality = await productToken('synthetic_quality');
    const listed = await app.inject({ url: '/v1/admin/content/reviews', headers: { authorization: `Bearer ${lead}` } });
    expect(listed.statusCode).toBe(200);
    const revision = listed.json().items[0].review_revision as string;
    const page = await app.inject({
      url: `/v1/admin/content/reviews/${batchId}?review_revision=${revision}`,
      headers: { authorization: `Bearer ${lead}` },
    });
    expect(page.statusCode).toBe(200);
    const item = page.json().items[0] as { script_id: string; content_hash: string };
    const decide = async (token: string, key: string) => app.inject({
      method: 'POST', url: `/v1/admin/content/reviews/${batchId}/decisions`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key, 'content-type': 'application/json' },
      payload: {
        review_revision: revision, script_id: item.script_id, content_hash: item.content_hash,
        decision: 'approved', evidence_id: REVIEW.evidenceId,
      },
    });
    expect((await decide(lead, 'dec-lead')).statusCode).toBe(200);
    expect((await decide(manager, 'dec-manager')).statusCode).toBe(200);
    const qualityBody = {
      review_revision: revision, phase: 'initial', evidence_id: 'EVD-T3-QUALITY-001',
      checks: [{ script_id: item.script_id, content_hash: item.content_hash, defect: false }],
    };
    expect((await app.inject({
      method: 'POST', url: `/v1/admin/content/reviews/${batchId}/quality-evidence`,
      headers: { authorization: `Bearer ${quality}`, 'idempotency-key': 'qual-1', 'content-type': 'application/json' },
      payload: qualityBody,
    })).statusCode).toBe(200);
    const resumed = await app.inject({
      method: 'POST', url: `/v1/admin/content/reviews/${batchId}/resume`,
      headers: { authorization: `Bearer ${quality}`, 'content-type': 'application/json' },
      payload: { review_revision: revision },
    });
    expect(resumed.statusCode).toBe(200);
    expect(await worker.runOnce()).toBe('finished');
    const status = await app.inject({ url: `/v1/content/import/${batchId}`, headers: { authorization: `Bearer ${owner}` } });
    expect(status.json().status).toBe('staged');
  });

  it('cancel after park never stages', async () => {
    const owner = await productToken('synthetic_lead');
    const batchId = await importBatch('idem-t3-cancel');
    expect(await worker.runOnce()).toBe('parked');
    const cancelled = await app.inject({
      method: 'POST', url: `/v1/admin/content/reviews/${batchId}/cancel`,
      headers: { authorization: `Bearer ${owner}` },
    });
    expect(cancelled.statusCode).toBe(200);
    expect((await admin.query('SELECT status FROM public.import_batches WHERE import_batch_id=$1', [batchId])).rows[0].status).toBe('failed');
    expect((await admin.query('SELECT count(*)::int AS n FROM public.staging_scripts WHERE import_batch_id=$1', [batchId])).rows[0].n).toBe(0);
  });

  it('rejects resume when dual reviewers share a subject hash', async () => {
    await admin.query(`
      INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
      VALUES ('synthetic_alias','synthetic','synthetic-tenant','synthetic_alias','usr_t3_alias',
        encode(sha256(convert_to('synthetic_lead','UTF8')),'hex'),true,'coach')
    `);
    await admin.query(`
      INSERT INTO backend_identity.capability_bindings(user_id,capability,enabled,evidence_id)
      VALUES ('usr_t3_alias','content_review_manager',true,'EVD-T3-CAP')
    `);
    const batchId = await importBatch('idem-t3-same-subject');
    expect(await worker.runOnce()).toBe('parked');
    const lead = await productToken('synthetic_lead');
    const alias = await productToken('synthetic_alias');
    const quality = await productToken('synthetic_quality');
    const listed = await app.inject({ url: '/v1/admin/content/reviews', headers: { authorization: `Bearer ${lead}` } });
    const revision = listed.json().items[0].review_revision as string;
    const page = await app.inject({
      url: `/v1/admin/content/reviews/${batchId}?review_revision=${revision}`,
      headers: { authorization: `Bearer ${lead}` },
    });
    const item = page.json().items[0] as { script_id: string; content_hash: string };
    const decide = async (token: string, key: string) => app.inject({
      method: 'POST', url: `/v1/admin/content/reviews/${batchId}/decisions`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key, 'content-type': 'application/json' },
      payload: {
        review_revision: revision, script_id: item.script_id, content_hash: item.content_hash,
        decision: 'approved', evidence_id: REVIEW.evidenceId,
      },
    });
    expect((await decide(lead, 'same-lead')).statusCode).toBe(200);
    expect((await decide(alias, 'same-alias')).statusCode).toBe(200);
    expect((await app.inject({
      method: 'POST', url: `/v1/admin/content/reviews/${batchId}/quality-evidence`,
      headers: { authorization: `Bearer ${quality}`, 'idempotency-key': 'same-qual', 'content-type': 'application/json' },
      payload: {
        review_revision: revision, phase: 'initial', evidence_id: 'EVD-T3-QUALITY-002',
        checks: [{ script_id: item.script_id, content_hash: item.content_hash, defect: false }],
      },
    })).statusCode).toBe(200);
    const resumed = await app.inject({
      method: 'POST', url: `/v1/admin/content/reviews/${batchId}/resume`,
      headers: { authorization: `Bearer ${quality}`, 'content-type': 'application/json' },
      payload: { review_revision: revision },
    });
    expect(resumed.statusCode).toBe(409);
  });

  it('fences heartbeat on a mismatched lease_version', async () => {
    await importBatch('idem-t3-lease');
    const client = new Client({ connectionString: workerUrl });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_backend_worker');
      const claimed = await client.query<{ claimed_job_id: string; claimed_lease_version: string }>(
        "SELECT claimed_job_id, claimed_lease_version::text FROM public.claim_content_import_validation('fence_owner', 60)",
      );
      const job = claimed.rows[0];
      expect(job?.claimed_job_id).toBeTruthy();
      await expect(client.query(
        'SELECT public.heartbeat_content_import_validation($1,$2,$3,$4)',
        [job?.claimed_job_id, 'fence_owner', Number(job?.claimed_lease_version) + 1, 60],
      )).rejects.toThrow();
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  });
});
