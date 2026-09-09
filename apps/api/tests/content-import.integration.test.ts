import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Client } from 'pg';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createApiApp } from '../src/app.js';
import { createMockAuthService } from '../src/auth-service.js';
import { createContentImportService } from '../src/content-import-service.js';
import { createContentObjectStore } from '../src/content-object-store.js';
import { parseApiRuntimeConfig } from '../src/runtime-config.js';
import { createServiceRepository } from '../src/service-repository.js';
import { CONTENT_UPLOAD_MAX_BYTES } from '../src/content-object-store.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const HMAC = Object.freeze({
  currentVersion: 'hmac-idempotency-v1',
  keys: Object.freeze({ 'hmac-idempotency-v1': 'synthetic-t2-idempotency-material-0001' }),
});
const LOG_HASH = Object.freeze({
  version: 'hmac-log-v1',
  key: 'synthetic-t2-log-hash-material-00000001',
});
const CSV = Buffer.from('script_id,title\nsynthetic,import\n');
const XLSX = Buffer.from('PK\x03\x04synthetic-xlsx-bytes');
const BINDINGS = Object.freeze([
  { domain: 'aftersale', source_version_id: 'srcv_t2_aftersale_v1', source_ref: 'SRC-T2-AFTERSALE' },
  { domain: 'campaign', source_version_id: 'srcv_t2_campaign_v1', source_ref: 'SRC-T2-CAMPAIGN' },
  { domain: 'presale', source_version_id: 'srcv_t2_presale_v1', source_ref: 'SRC-T2-PRESALE' },
  { domain: 'product', source_version_id: 'srcv_t2_product_v1', source_ref: 'SRC-T2-PRODUCT' },
] as const);

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function multipart(file: Buffer, type: string, bindings = BINDINGS, filename = 'upload.bin'): Buffer {
  const boundary = '----t2boundary';
  const json = JSON.stringify(bindings.map(({ domain, source_version_id }) => ({ domain, source_version_id })));
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="source_bindings"\r\n\r\n${json}\r\n--${boundary}--\r\n`),
  ]);
}

describe.skipIf(!enabled)('persistent content import receive', () => {
  let harness: Pg15Harness;
  let admin: Client;
  let app: FastifyInstance;
  let storeRoot: string;
  let runtimeUrl: string;

  beforeEach(async () => {
    harness = new Pg15Harness();
    harness.start();
    const db = harness.createDatabase('import');
    admin = await harness.connect(db.config);
    await applyDatabaseMigrations(admin);
    await admin.query('CREATE ROLE t2_runtime LOGIN; GRANT app_runtime TO t2_runtime');
    runtimeUrl = `postgresql://t2_runtime@localhost/${db.name}?${new URLSearchParams({
      host: harness.socket,
      port: String(harness.port),
    })}`;
    storeRoot = mkdtempSync(path.join(tmpdir(), 'ca-t2-store-'));
    const repository = createServiceRepository({
      connectionString: runtimeUrl,
      poolMax: 4,
      connectionTimeoutMs: 2000,
      readinessTimeoutMs: 3000,
    });
    const store = createContentObjectStore(storeRoot);
    app = createApiApp(
      parseApiRuntimeConfig({
        CUSTOMER_AGENT_PROFILE: 'test',
        AUTH_MODE: 'mock',
        CUSTOMER_AGENT_API_PORT: '0',
        CUSTOMER_AGENT_BUILD_VERSION: 'synthetic-t2',
      }),
      repository,
      undefined,
      createMockAuthService(),
      undefined,
      undefined,
      undefined,
      { service: createContentImportService(store, repository.contentImport, HMAC, LOG_HASH) },
    );
  }, 120_000);

  afterEach(async () => {
    await app?.close();
    await admin?.end();
    harness?.stop();
  }, 60_000);

  async function seedSources(snapshot: string, useClass = 'canonical'): Promise<void> {
    for (const binding of BINDINGS) {
      await admin.query(`
        INSERT INTO public.authoritative_source_versions(
          source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
          use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at
        ) VALUES (
          $1, $2, $3, 'synthetic-t2', $4,
          $5, 'ROLE-CONTENT-LEAD', 'EVD-T2-SOURCE',
          'synthetic-owner', pg_catalog.clock_timestamp() - INTERVAL '1 day',
          pg_catalog.clock_timestamp() + INTERVAL '365 days'
        )
      `, [binding.source_version_id, binding.source_ref, binding.domain, snapshot, useClass]);
    }
  }

  async function login(role: 'coach' | 'owner' | 'agent' = 'coach') {
    const session = await app.inject({
      method: 'POST',
      url: '/v1/auth/mock-login',
      payload: { user_id: `usr_t2_${role}`, role },
    });
    expect(session.statusCode).toBe(200);
    return { authorization: `Bearer ${session.json().token}` };
  }

  function importHeaders(auth: Record<string, string>, boundary = '----t2boundary', key = 'idem-t2-1') {
    return {
      ...auth,
      'idempotency-key': key,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    };
  }

  it('returns 202 only after durable persist and enqueue commit, then serves status and cancel', async () => {
    const digest = sha256(CSV);
    await seedSources(digest);
    const auth = await login('owner');
    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/content/import',
      headers: importHeaders(auth),
      payload: multipart(CSV, 'text/csv', BINDINGS, '../../evil.csv'),
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.headers['cache-control']).toBe('no-store');
    const body = accepted.json();
    expect(body.status).toBe('validating');
    expect(body.source_binding_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.import_batch_id).toMatch(/^imp_/);
    const batches = await admin.query(
      'SELECT source_ref, source_sha256, source_size_bytes, status FROM public.import_batches WHERE import_batch_id = $1',
      [body.import_batch_id],
    );
    expect(batches.rows[0]).toMatchObject({
      source_sha256: digest,
      source_size_bytes: String(CSV.length),
      status: 'validating',
    });
    expect(batches.rows[0].source_ref).toMatch(/^obj_[0-9a-f]{64}$/);
    expect(accepted.body).not.toContain(batches.rows[0].source_ref);
    const jobs = await admin.query(
      `SELECT status FROM public.outbox_jobs WHERE payload ->> 'import_batch_id' = $1`,
      [body.import_batch_id],
    );
    expect(jobs.rows[0]?.status).toBe('pending');

    const status = await app.inject({
      url: `/v1/content/import/${body.import_batch_id}`,
      headers: auth,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      import_batch_id: body.import_batch_id,
      status: 'validating',
      preview: [],
      quality_review: null,
      error_report: null,
    });
    expect(status.json().source_bindings).toEqual(BINDINGS.map(({ domain, source_version_id, source_ref }) => ({
      domain, source_version_id, source_ref,
    })));

    const cancelled = await app.inject({
      method: 'POST',
      url: `/v1/content/import/${body.import_batch_id}/cancel`,
      headers: { ...auth, 'idempotency-key': 'idem-t2-cancel', 'content-type': 'application/json' },
      payload: { reason: 'synthetic-revise' },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toEqual({
      ok: true,
      import_batch_id: body.import_batch_id,
      status: 'failed',
    });
    const failed = await admin.query(
      'SELECT status, error_report FROM public.import_batches WHERE import_batch_id = $1',
      [body.import_batch_id],
    );
    expect(failed.rows[0].status).toBe('failed');
    expect(failed.rows[0].error_report).toMatchObject({ code: 'CANCELLED' });
  });

  it('accepts a declared XLSX payload after persist and digest verification', async () => {
    await seedSources(sha256(XLSX));
    const auth = await login();
    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/content/import',
      headers: importHeaders(auth, '----t2boundary', 'idem-t2-xlsx'),
      payload: multipart(XLSX, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json().status).toBe('validating');
  });

  it('rejects oversized, truncated, unauthenticated, agent, and Feishu JSON uploads without creating a batch', async () => {
    await seedSources(sha256(CSV));
    const auth = await login();
    const oversized = await app.inject({
      method: 'POST',
      url: '/v1/content/import',
      headers: importHeaders(auth, '----t2boundary', 'idem-oversize'),
      payload: multipart(Buffer.alloc(CONTENT_UPLOAD_MAX_BYTES + 1, 0x61), 'text/csv'),
    });
    expect(oversized.statusCode).toBe(400);

    const truncated = Buffer.from('------t2boundary\r\nContent-Disposition: form-data; name="file"\r\n\r\nincomplete');
    const cut = await app.inject({
      method: 'POST',
      url: '/v1/content/import',
      headers: importHeaders(auth, '----t2boundary', 'idem-trunc'),
      payload: truncated,
    });
    expect(cut.statusCode).toBe(400);

    expect((await app.inject({
      method: 'POST',
      url: '/v1/content/import',
      headers: importHeaders({}, '----t2boundary', 'idem-noauth'),
      payload: multipart(CSV, 'text/csv'),
    })).statusCode).toBe(401);

    const agent = await login('agent');
    expect((await app.inject({
      method: 'POST',
      url: '/v1/content/import',
      headers: importHeaders(agent, '----t2boundary', 'idem-agent'),
      payload: multipart(CSV, 'text/csv'),
    })).statusCode).toBe(403);

    const feishu = await app.inject({
      method: 'POST',
      url: '/v1/content/import',
      headers: { ...auth, 'idempotency-key': 'idem-feishu', 'content-type': 'application/json' },
      payload: { source_type: 'feishu_api', source_bindings: BINDINGS.map(({ domain, source_version_id }) => ({ domain, source_version_id })) },
    });
    expect(feishu.statusCode).toBe(400);
    const count = await admin.query('SELECT count(*)::int AS n FROM public.import_batches');
    expect(count.rows[0].n).toBe(0);
  });

  it('audits ineligible and mismatched sources after rolling back enqueue', async () => {
    const auth = await login('owner');
    const missing = await app.inject({
      method: 'POST',
      url: '/v1/content/import',
      headers: importHeaders(auth, '----t2boundary', 'idem-missing'),
      payload: multipart(CSV, 'text/csv'),
    });
    expect(missing.statusCode).toBe(403);
    expect(missing.json().error.details.reason).toBe('SOURCE_NOT_ELIGIBLE');
    await seedSources('d'.repeat(64));
    const mismatch = await app.inject({
      method: 'POST',
      url: '/v1/content/import',
      headers: importHeaders(auth, '----t2boundary', 'idem-mismatch'),
      payload: multipart(CSV, 'text/csv'),
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error.details.reason).toBe('SOURCE_SNAPSHOT_MISMATCH');
    const audits = await admin.query('SELECT reason_code, operation FROM public.source_denial_audits ORDER BY committed_at');
    expect(audits.rows.map((row: { reason_code: string }) => row.reason_code).sort()).toEqual([
      'SOURCE_NOT_ELIGIBLE',
      'SOURCE_SNAPSHOT_MISMATCH',
    ]);
    expect(audits.rows.every((row: { operation: string }) => row.operation === 'content_import')).toBe(true);
    expect((await admin.query('SELECT count(*)::int AS n FROM public.import_batches')).rows[0].n).toBe(0);
  });

  it('reclaims the object after a known database enqueue failure', async () => {
    await seedSources(sha256(CSV));
    const auth = await login('owner');
    await admin.query('REVOKE EXECUTE ON FUNCTION public.enqueue_content_import(text,text,text,text,bigint,jsonb,text,text) FROM app_runtime');
    const failed = await app.inject({
      method: 'POST',
      url: '/v1/content/import',
      headers: importHeaders(auth, '----t2boundary', 'idem-dbfail'),
      payload: multipart(CSV, 'text/csv'),
    });
    expect(failed.statusCode).toBe(403);
    expect((await admin.query('SELECT count(*)::int AS n FROM public.import_batches')).rows[0].n).toBe(0);
    const store = createContentObjectStore(storeRoot);
    const leftover = await store.readReceipt('imp_doesnotexist0001');
    expect(leftover).toBeNull();
  });

  it('replays the same idempotency key and rejects a different body', async () => {
    await seedSources(sha256(CSV));
    const auth = await login('owner');
    const headers = importHeaders(auth, '----t2boundary', 'idem-replay');
    const first = await app.inject({
      method: 'POST', url: '/v1/content/import', headers, payload: multipart(CSV, 'text/csv'),
    });
    const second = await app.inject({
      method: 'POST', url: '/v1/content/import', headers, payload: multipart(CSV, 'text/csv'),
    });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json().import_batch_id).toBe(first.json().import_batch_id);
    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/content/import',
      headers,
      payload: multipart(Buffer.from('script_id,title\nother,row\n'), 'text/csv'),
    });
    expect(conflict.statusCode).toBe(409);
  });
});
