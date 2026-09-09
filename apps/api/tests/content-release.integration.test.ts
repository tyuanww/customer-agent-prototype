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
  let app: FastifyInstance;
  let worker: ReturnType<typeof createContentWorker>;

  beforeEach(async () => {
    harness = new Pg15Harness();
    harness.start();
    const db = harness.createDatabase('release');
    admin = await harness.connect(db.config);
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
    const boundary = '----t4boundary';
    const json = JSON.stringify(BINDINGS.map(({ domain, source_version_id }) => ({ domain, source_version_id })));
    return Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.csv"\r\nContent-Type: text/csv\r\n\r\n`),
      CSV,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="source_bindings"\r\n\r\n${json}\r\n--${boundary}--\r\n`),
    ]);
  }

  async function stageBatch(idempotencyKey: string): Promise<string> {
    const owner = await productToken('synthetic_owner');
    const imported = await app.inject({
      method: 'POST', url: '/v1/content/import',
      headers: {
        authorization: `Bearer ${owner}`,
        'idempotency-key': idempotencyKey,
        'content-type': 'multipart/form-data; boundary=----t4boundary',
      },
      payload: multipart(),
    });
    expect(imported.statusCode).toBe(202);
    const batchId = imported.json().import_batch_id as string;
    expect(await worker.runOnce()).toBe('parked');
    const lead = await productToken('synthetic_lead');
    const manager = await productToken('synthetic_manager');
    const quality = await productToken('synthetic_quality');
    const listed = await app.inject({ url: '/v1/admin/content/reviews', headers: { authorization: `Bearer ${lead}` } });
    const summary = (listed.json().items as { batch_id: string; review_revision: string }[])
      .find((item) => item.batch_id === batchId);
    expect(summary).toBeTruthy();
    const revision = summary!.review_revision;
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
    expect((await decide(lead, `dec-lead-${idempotencyKey}`)).statusCode).toBe(200);
    expect((await decide(manager, `dec-manager-${idempotencyKey}`)).statusCode).toBe(200);
    expect((await app.inject({
      method: 'POST', url: `/v1/admin/content/reviews/${batchId}/quality-evidence`,
      headers: { authorization: `Bearer ${quality}`, 'idempotency-key': `qual-${idempotencyKey}`, 'content-type': 'application/json' },
      payload: {
        review_revision: revision, phase: 'initial', evidence_id: 'EVD-T4-QUALITY-001',
        checks: [{ script_id: item.script_id, content_hash: item.content_hash, defect: false }],
      },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: 'POST', url: `/v1/admin/content/reviews/${batchId}/resume`,
      headers: { authorization: `Bearer ${quality}`, 'content-type': 'application/json' },
      payload: { review_revision: revision },
    })).statusCode).toBe(200);
    expect(await worker.runOnce()).toBe('finished');
    return batchId;
  }

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
});
