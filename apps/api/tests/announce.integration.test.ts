import { createHash as sha, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Client } from 'pg';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createAnnounceServiceForPool } from '../src/announce-service.js';
import { createApiApp } from '../src/app.js';
import { createContentImportService } from '../src/content-import-service.js';
import { createContentObjectStore } from '../src/content-object-store.js';
import { createContentReleaseService } from '../src/content-release-service.js';
import { createContentReviewService } from '../src/content-review-service.js';
import { createContentWorker } from '../src/content-worker.js';
import { createProductAuthService } from '../src/product-auth-service.js';
import { parseApiRuntimeConfig } from '../src/runtime-config.js';
import { createServiceRepository, sharedRuntimePool } from '../src/service-repository.js';
import type { ApiRuntimeDiagnostic } from '../src/runtime-diagnostics.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const HMAC = Object.freeze({
  currentVersion: 'hmac-idempotency-v1',
  keys: Object.freeze({ 'hmac-idempotency-v1': 'synthetic-t5-idempotency-material-0001' }),
});
const LOG_HASH = Object.freeze({ version: 'hmac-log-v1', key: 'synthetic-t5-log-hash-material-00000001' });
const INTENT = Object.freeze({ version: 'itax_synthetic_t5_v1', id: 'intent_synthetic_t5_shipping' });
const REVIEW = Object.freeze({
  leadSubject: 'synthetic_lead',
  managerSubject: 'synthetic_manager',
  evidenceId: 'EVD-T5-REVIEW-001',
});
const BINDINGS = Object.freeze([
  { domain: 'aftersale', source_version_id: 'srcv_t5_aftersale_v1', source_ref: 'SRC-T5-AFTERSALE' },
  { domain: 'campaign', source_version_id: 'srcv_t5_campaign_v1', source_ref: 'SRC-T5-CAMPAIGN' },
  { domain: 'presale', source_version_id: 'srcv_t5_presale_v1', source_ref: 'SRC-T5-PRESALE' },
  { domain: 'product', source_version_id: 'srcv_t5_product_v1', source_ref: 'SRC-T5-PRODUCT' },
] as const);
const CSV = Buffer.from([
  'script_id,category,title,answer_text,source_version_id,source_ref,question_text,risk_level,has_conflict',
  'shipping-001,presale,发货时效,您好订单将在付款后发出,srcv_t5_presale_v1,SRC-T5-PRESALE,什么时候发货,high,false',
  '',
].join('\n'));
const verifier = 'v'.repeat(43);
const challenge = sha('sha256').update(verifier).digest('base64url');
const CLIENT_ID = 'mac-cs-t5-001';

describe.skipIf(!enabled)('announce current snapshot ack and readiness', () => {
  let harness: Pg15Harness;
  let admin: Client;
  let app: FastifyInstance;
  let worker: ReturnType<typeof createContentWorker>;
  let diagnostics: ApiRuntimeDiagnostic[];

  beforeEach(async () => {
    diagnostics = [];
    harness = new Pg15Harness();
    harness.start();
    const db = harness.createDatabase('announce');
    admin = await harness.connect(db.config);
    await applyDatabaseMigrations(admin);
    await admin.query(`
      CREATE ROLE t5_runtime LOGIN; GRANT app_runtime TO t5_runtime;
      CREATE ROLE t5_admin LOGIN; GRANT app_content_admin TO t5_admin;
      CREATE ROLE t5_auth LOGIN NOINHERIT; GRANT app_backend_auth TO t5_auth;
      CREATE ROLE t5_worker LOGIN NOINHERIT; GRANT app_backend_worker TO t5_worker;
      CREATE ROLE t5_review LOGIN NOINHERIT; GRANT app_backend_review TO t5_review;
    `);
    const socket = new URLSearchParams({ host: harness.socket, port: String(harness.port) });
    const conn = (user: string) => `postgresql://${user}@localhost/${db.name}?${socket}`;
    const storeRoot = mkdtempSync(path.join(tmpdir(), 'ca-t5-store-'));
    const digest = sha('sha256').update(CSV).digest('hex');
    for (const binding of BINDINGS) {
      await admin.query(`
        INSERT INTO public.authoritative_source_versions(
          source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
          use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at
        ) VALUES ($1,$2,$3,'synthetic-t5',$4,'canonical','ROLE-CONTENT-LEAD','EVD-T5-SOURCE',
          'synthetic-owner', clock_timestamp() - interval '1 day', clock_timestamp() + interval '365 days')
      `, [binding.source_version_id, binding.source_ref, binding.domain, digest]);
    }
    await admin.query(`
      INSERT INTO public.intent_taxonomy_versions(intent_taxonomy_version, approval_evd, approved_by, approved_at)
      VALUES ($1,'EVD-T5-TAXONOMY','synthetic-owner', clock_timestamp())
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
      ['synthetic_owner', 'usr_t5_owner', null, 'owner'],
      ['synthetic_lead', 'usr_t5_lead', 'content_review_lead', 'coach'],
      ['synthetic_manager', 'usr_t5_manager', 'content_review_manager', 'coach'],
      ['synthetic_quality', 'usr_t5_quality', 'content_quality_reviewer', 'coach'],
    ] as const) {
      await admin.query(`
        INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
        VALUES ($1,'synthetic','synthetic-tenant',$1,$2,encode(sha256(convert_to($1,'UTF8')),'hex'),true,$3)
      `, [id, user, role]);
      if (cap) {
        await admin.query(`
          INSERT INTO backend_identity.capability_bindings(user_id,capability,enabled,evidence_id)
          VALUES ($1,$2,true,'EVD-T5-CAP')
        `, [user, cap]);
      }
    }
    const repository = createServiceRepository({
      connectionString: conn('t5_runtime'), poolMax: 4, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000,
    });
    const runtimePool = sharedRuntimePool(repository);
    if (runtimePool === undefined) throw new Error('runtime pool must be shared for announce');
    const store = createContentObjectStore(storeRoot);
    const auth = await createProductAuthService(
      { connectionString: conn('t5_auth'), poolMax: 2, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000 },
      {
        authorizeUrl: (state) => `http://127.0.0.1:9/authorize?state=${state}`,
        exchange: async (code) => code,
        close: () => undefined,
      },
    );
    app = createApiApp(
      parseApiRuntimeConfig({
        CUSTOMER_AGENT_PROFILE: 'test', AUTH_MODE: 'mock', AUTH_SESSION_MODE: 'product',
        CUSTOMER_AGENT_API_PORT: '0', CUSTOMER_AGENT_BUILD_VERSION: 'synthetic-t5',
      }),
      repository, undefined, auth, undefined,
      {
        operation: { execute: (request) => repository.executeSearch(request) },
        logHash: LOG_HASH, idempotencyHmac: HMAC,
      },
      { repository, idempotencyHmac: HMAC },
      { service: createContentImportService(store, repository.contentImport, HMAC, LOG_HASH) },
      { service: createContentReviewService({
        connectionString: conn('t5_review'), poolMax: 2, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000,
      }) },
      { service: createContentReleaseService(
        { connectionString: conn('t5_admin'), poolMax: 2, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000 },
        HMAC, LOG_HASH,
      ) },
      { service: createAnnounceServiceForPool(runtimePool, LOG_HASH, false, (entry) => diagnostics.push(entry)) },
    );
    worker = createContentWorker(
      { connectionString: conn('t5_worker'), poolMax: 2, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000 },
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
    const boundary = '----t5boundary';
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
        'content-type': 'multipart/form-data; boundary=----t5boundary',
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
        review_revision: revision, phase: 'initial', evidence_id: 'EVD-T5-QUALITY-001',
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

  it('proves storage/content readiness and fail-closes current, snapshot, ack, search', async () => {
    const ready = await app.inject({ url: '/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      status: 'ready',
      checks: { database: 'ok', schema: 'ok', auth: 'ok', storage: 'ok', content: 'ok' },
    });

    expect((await app.inject({ url: '/v1/announce/current' })).statusCode).toBe(401);
    const owner = await productToken('synthetic_owner');
    const auth = { authorization: `Bearer ${owner}` };
    expect((await app.inject({
      url: '/v1/announce/current', headers: auth,
    })).statusCode).toBe(400);

    const emptyCurrent = await app.inject({
      url: '/v1/announce/current',
      headers: { ...auth, 'x-client-id': CLIENT_ID },
    });
    expect(emptyCurrent.statusCode).toBe(503);
    expect(emptyCurrent.json().error.details.reason).toBe('SOURCE_GATE_NOT_READY');

    const batchId = await stageBatch('idem-t5-a');
    const published = await app.inject({
      method: 'POST', url: '/v1/content/publish',
      headers: { ...auth, 'idempotency-key': 'pub-t5', 'content-type': 'application/json' },
      payload: { import_batch_id: batchId, title: '合成公告', summary: 'T5' },
    });
    expect(published.statusCode).toBe(200);
    const release = published.json() as { release_id: string; release_seq: number };

    const current = await app.inject({
      url: '/v1/announce/current',
      headers: { ...auth, 'x-client-id': CLIENT_ID },
    });
    expect(current.statusCode).toBe(200);
    expect(current.headers['cache-control']).toBe('max-age=10');
    expect(current.headers.etag).toBe(`W/"${release.release_seq}"`);
    const currentBody = current.json() as {
      current_release_id: string;
      release_seq: number;
      source_binding_hash: string;
      offline_lease: { token: string; expires_at: string; release_id: string };
      announcement: { title: string; summary: string };
    };
    expect(currentBody.current_release_id).toBe(release.release_id);
    expect(currentBody.release_seq).toBe(1);
    expect(currentBody.announcement.title).toBe('合成公告');
    expect(currentBody.offline_lease.token).toMatch(/^osl_[0-9a-f]{64}$/);
    expect(currentBody).not.toHaveProperty('announcement_id');

    const cached = await app.inject({
      url: '/v1/announce/current',
      headers: {
        ...auth,
        'x-client-id': CLIENT_ID,
        'if-none-match': current.headers.etag as string,
        'x-snapshot-lease': currentBody.offline_lease.token,
      },
    });
    expect(cached.statusCode).toBe(304);
    expect(cached.body).toBe('');
    expect(cached.headers['x-snapshot-lease']).toBe(currentBody.offline_lease.token);

    const snapshot = await app.inject({
      url: `/v1/announce/snapshot?release_id=${release.release_id}&limit=1`,
      headers: {
        ...auth,
        'x-client-id': CLIENT_ID,
        'x-snapshot-lease': currentBody.offline_lease.token,
      },
    });
    expect(snapshot.statusCode).toBe(200);
    const page = snapshot.json() as {
      release_id: string;
      items: { script_id: string; questions: { question_text: string }[] }[];
      next_cursor: string | null;
    };
    expect(page.release_id).toBe(release.release_id);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.script_id).toBe('shipping-001');
    expect(page.items[0]?.questions[0]?.question_text).toBe('什么时候发货');
    expect(page.next_cursor).toBeNull();
    expect(JSON.stringify(page)).not.toContain('origin_fingerprint');

    const continued = await app.inject({
      url: `/v1/announce/snapshot?release_id=${release.release_id}&limit=1&cursor=shipping-001`,
      headers: {
        ...auth,
        'x-client-id': CLIENT_ID,
        'x-snapshot-lease': currentBody.offline_lease.token,
      },
    });
    expect(continued.statusCode).toBe(200);
    expect(continued.json().items).toEqual([]);
    expect(continued.json().next_cursor).toBeNull();

    const ack = await app.inject({
      method: 'POST', url: '/v1/announce/ack',
      headers: { ...auth, 'content-type': 'application/json' },
      payload: {
        client_id: CLIENT_ID,
        release_id: release.release_id,
        release_seq: release.release_seq,
        offline_lease_token: currentBody.offline_lease.token,
      },
    });
    expect(ack.statusCode).toBe(200);
    expect(ack.json()).toEqual({ ok: true });

    const mismatched = await app.inject({
      method: 'POST', url: '/v1/announce/ack',
      headers: { ...auth, 'content-type': 'application/json' },
      payload: {
        client_id: 'other-client',
        release_id: release.release_id,
        release_seq: release.release_seq,
        offline_lease_token: currentBody.offline_lease.token,
      },
    });
    expect(mismatched.statusCode).toBe(403);
    expect(mismatched.json().error.details.reason).toBe('OFFLINE_LEASE_BINDING_MISMATCH');

    const search = await app.inject({
      method: 'POST', url: '/v1/search',
      headers: { ...auth, 'content-type': 'application/json' },
      payload: {
        query_id: randomUUID(),
        parent_query_id: null,
        interaction_reason: 'original',
        query_text: '什么时候发货',
        collection_mode: 'synthetic',
        detected_platform: 'qianniu',
        platform: 'qianniu',
        platform_source: 'foreground_process',
        product_context_type: null,
        product_context_ref: null,
        top_k: 3,
      },
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().hit_status).toBe('hit');
    expect(search.json().release_id).toBe(release.release_id);

    const unknownLease = `osl_${'ab'.repeat(32)}`;
    const invalidLease = await app.inject({
      url: `/v1/announce/snapshot?release_id=${release.release_id}`,
      headers: {
        ...auth,
        'x-client-id': CLIENT_ID,
        'x-snapshot-lease': unknownLease,
      },
    });
    expect(invalidLease.statusCode, JSON.stringify({ response: invalidLease.json(), diagnostics })).toBe(403);
    expect(invalidLease.json().error.details.reason).toBe('OFFLINE_LEASE_INVALID');

    const refreshed = await app.inject({
      url: '/v1/announce/current',
      headers: {
        ...auth,
        'x-client-id': CLIENT_ID,
        'if-none-match': current.headers.etag as string,
        'x-snapshot-lease': unknownLease,
      },
    });
    expect(refreshed.statusCode).toBe(200);
    const freshLease = refreshed.json().offline_lease.token as string;
    expect(freshLease).not.toBe(currentBody.offline_lease.token);

    await admin.query(
      `SELECT public.suspend_authoritative_source($1,'SOURCE_REVOKED','EVD-T5-SUSPEND','usr_t5_owner','owner')`,
      [BINDINGS[0].source_version_id],
    );
    const gated = await app.inject({
      url: '/v1/announce/current',
      headers: { ...auth, 'x-client-id': CLIENT_ID },
    });
    expect(gated.statusCode).toBe(503);
    expect(gated.json().error.details.reason).toBe('SOURCE_GATE_NOT_READY');

    const gatedSnapshot = await app.inject({
      url: `/v1/announce/snapshot?release_id=${release.release_id}`,
      headers: {
        ...auth,
        'x-client-id': CLIENT_ID,
        'x-snapshot-lease': freshLease,
      },
    });
    expect(gatedSnapshot.statusCode).toBe(503);
    expect(gatedSnapshot.json().error.details.reason).toBe('SOURCE_GATE_NOT_READY');

    const gatedSearch = await app.inject({
      method: 'POST', url: '/v1/search',
      headers: { ...auth, 'content-type': 'application/json' },
      payload: {
        query_id: randomUUID(),
        parent_query_id: null,
        interaction_reason: 'original',
        query_text: '什么时候发货',
        collection_mode: 'synthetic',
        detected_platform: 'qianniu',
        platform: 'qianniu',
        platform_source: 'foreground_process',
        product_context_type: null,
        product_context_ref: null,
        top_k: 3,
      },
    });
    expect(gatedSearch.statusCode).toBe(503);
    expect(gatedSearch.json().error.details.reason).toBe('SOURCE_GATE_NOT_READY');

    const audits = await admin.query<{ operation: string; reason_code: string }>(
      `SELECT operation, reason_code FROM public.source_denial_audits ORDER BY committed_at`,
    );
    const reasons = audits.rows.map((row) => `${row.operation}:${row.reason_code}`);
    expect(reasons).toEqual(expect.arrayContaining([
      'announce_current:SOURCE_GATE_NOT_READY',
      'announce_snapshot:OFFLINE_LEASE_INVALID',
      'announce_ack:OFFLINE_LEASE_BINDING_MISMATCH',
      'search:SOURCE_GATE_NOT_READY',
    ]));
  }, 180_000);
});
