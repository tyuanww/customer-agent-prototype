import { createServer } from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { parseContractSchema as parse, type components } from '@customer-agent/contracts';
import { startApi, type StartedApi } from '../src/server.js';
import { createIntakePurposePool } from '../src/content-intake/runtime-pool.js';
import { inspectCurrentIntakeRelease } from '../src/integration/intake-readiness.js';
import { createPostgresQueryReleaseLoader } from '../src/integration/release.js';
import { createIntakeSyntheticHost, INTAKE_SYNTHETIC_FAQ, type IntakeSyntheticHost } from './support/intake-synthetic-host.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const headers = { 'content-type': 'application/json' };

describe.skipIf(!enabled).sequential('persisted intake catalog through the actual API composition', () => {
  let host: IntakeSyntheticHost;
  let admin: Client;
  let environment: Record<string, string>;
  let authorization = '';
  let releaseId: string;
  let started: StartedApi | undefined;

  async function json(response: Response) {
    const value: unknown = await response.json();
    expect(response.ok, `${response.status} ${JSON.stringify(value)}`).toBe(true);
    return value;
  }

  beforeAll(async () => {
    host = await createIntakeSyntheticHost({ profile: 'purpose-runtime', includeLegacySearch: false,
      configureDatabase: async client => { admin = client; },
      observeSyntheticRequest: (actor, requestHeaders) => {
        if (actor === 'agent') authorization = requestHeaders.get('authorization') ?? '';
      },
    });
    const candidate = host.candidate;
    if (!candidate || !host.object) throw new Error('Missing prepared synthetic candidate');
    const key = candidate.key;
    const url = `/v1/intake/candidates/${key.candidateId}/versions/${key.version}`;
    const post = (suffix: string, body: unknown) => host.requestAs('enabler', `${url}/${suffix}`,
      { method: 'POST', headers, body: JSON.stringify(body) }).then(json);
    await post('source-confirmation', { operationId: 'compat-source', key, expectedEvidenceVersion: 0,
      confirmedVersionKind: 'opaque', confirmedVersionValue: 'synthetic-original-export',
      acquisition: 'controlled-synthetic-export', objectSha256: host.object.sha256, reason: '合成来源确认' });
    await post('quality/freeze', { operationId: 'compat-freeze', key });
    const quality = parse('IntakeQualityStatus', await json(await host.requestAs('enabler', `${url}/quality?digest=${key.digest}`)));
    const samples = parse('IntakeQualitySamplePage', await json(await host.requestAs('enabler',
      `${url}/quality/samples?${new URLSearchParams({ digest: key.digest, viewHash: quality.viewHash, phase: 'initial', limit: '100' })}`)));
    expect(samples.nextCursor).toBeNull();
    await post('quality/checks', { operationId: 'compat-checks', key, phase: 'initial',
      checks: samples.items.map(item => ({ scriptId: item.scriptId, contentHash: item.contentHash, defect: false, reason: '' })) });
    const receipt = parse('IntakeReceipt', await post('publish', { operationId: 'compat-publish', key,
      baseReleaseId: 'rel_native_base', sourceEvidenceVersion: 1, confirmed: true,
      title: '合成兼容目录', summary: '正常导入与发布入口' }));
    if (!receipt.releaseId) throw new Error('Missing published synthetic release');
    releaseId = receipt.releaseId;
    await json(await host.requestAs('agent', '/v1/auth/me'));
    await admin.query(`CREATE ROLE compatibility_runtime LOGIN; GRANT app_runtime TO compatibility_runtime;
      CREATE ROLE compatibility_admin LOGIN; GRANT app_content_admin TO compatibility_admin`);
    const databasePort = Number((await admin.query<{ port: string }>('SHOW port')).rows[0]!.port);
    const databaseName = (await admin.query<{ name: string }>('SELECT current_database() AS name')).rows[0]!.name;
    const connection = (user: string) => `postgresql://${user}@localhost/${databaseName}?${new URLSearchParams({
      host: path.join(host.root, 'socket'), port: String(databasePort),
    })}`;
    const reservation = createServer();
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('Missing reserved API port');
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    environment = {
      CUSTOMER_AGENT_PROFILE: 'test', AUTH_MODE: 'mock', AUTH_SESSION_MODE: 'product',
      CUSTOMER_AGENT_API_PORT: String(address.port), SYNTHETIC_IDENTITY_PROVIDER_ORIGIN: host.identityOrigin,
      DATABASE_URL: connection('compatibility_runtime'), CONTENT_ADMIN_DATABASE_URL: connection('compatibility_admin'),
      AUTH_DATABASE_URL: connection('stack_backend_auth'), INTAKE_BUSINESS_DATABASE_URL: connection('synthetic_business'),
      INTAKE_USAGE_DATABASE_URL: connection('synthetic_usage'), INTAKE_WORKER_DATABASE_URL: connection('synthetic_worker'),
      CONTENT_OBJECT_STORE_DIR: path.join(host.root, 'objects'),
      IDEMPOTENCY_HMAC_KEYS: JSON.stringify({ 'hmac-idempotency-v1': 'synthetic-compatibility-idempotency-0001' }),
      IDEMPOTENCY_HMAC_CURRENT_VERSION: 'hmac-idempotency-v1', LOG_HASH_KEY: 'synthetic-compatibility-log-hash-0001', LOG_HASH_KEY_VERSION: 'hmac-log-v1',
    };
    for (const purpose of ['BUSINESS', 'USAGE', 'WORKER']) vi.stubEnv(`INTAKE_${purpose}_DATABASE_URL`, 'invalid-ambient-database');
  }, 90_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await started?.close();
    await host?.close();
  });

  it('preserves unified fail-closed startup for an actual published intake lineage', async () => {
    const usage = createIntakePurposePool({ connectionString: environment.INTAKE_USAGE_DATABASE_URL, max: 1 }, 'usage');
    try {
      await expect(createPostgresQueryReleaseLoader(usage)()).rejects.toThrow('RELEASE_INDEX_ITEM_GAP');
      expect(await inspectCurrentIntakeRelease(usage)).toMatchObject({ releaseId });
    } finally { await usage.end(); }
    started = await startApi({ environment });
    const ready = await fetch(`${started.address}/ready`);
    expect(ready.status).toBe(503);
    expect(ready.headers.get('x-customer-agent-query-mode')).toBe('unified');
    expect(parse('NotReadyResponse', await ready.json()).checks.content).toBe('not_ready');
    await started.close();
    started = undefined;
  }, 30_000);

  it('serves the published FAQ through explicit intake composition and disables ordinary search without events', async () => {
    started = await startApi({ environment: { ...environment, CUSTOMER_AGENT_QUERY_MODE: 'intake-compat' } });
    const ready = await fetch(`${started.address}/ready`);
    expect(ready.status, JSON.stringify(await ready.clone().json())).toBe(200);
    expect(ready.headers.get('x-customer-agent-query-mode')).toBe('intake-compat');
    parse('ReadyResponse', await ready.json());
    const request = (url: string, body?: unknown) => fetch(`${started!.address}${url}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { ...headers, authorization },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const entitlement = parse('IntakeEntitlement', await json(await request('/v1/intake/entitlements', {
      shopId: 'shop-a', contextGeneration: 1, releaseId, productIds: [], scenarioIds: [],
    })));
    const answers: string[] = [];
    let cursor: string | null = null;
    do {
      const query: URLSearchParams = new URLSearchParams({ entitlementId: entitlement.entitlementId, limit: '1', ...(cursor ? { cursor } : {}) });
      const page: components['schemas']['IntakeSnapshot'] = parse('IntakeSnapshot', await json(await request(`/v1/intake/snapshot?${query}`)));
      answers.push(...page.faq.map(row => row.entry.answerText));
      cursor = page.nextCursor;
    } while (cursor);
    expect(answers).toEqual(INTAKE_SYNTHETIC_FAQ.map(faq => faq.answer));
    const before = await admin.query('SELECT count(*)::int AS count FROM public.query_events');
    const search = await request('/v1/search', { query_id: randomUUID(), parent_query_id: null, interaction_reason: 'original',
      query_text: '合成发货', collection_mode: 'synthetic', detected_platform: 'qianniu', platform: 'qianniu',
      platform_source: 'foreground_process', product_context_type: null, product_context_ref: null, top_k: 3 });
    expect(search.status, JSON.stringify(await search.clone().json())).toBe(503);
    expect(await search.json()).toMatchObject({ error: { code: 'OVERLOADED' } });
    expect((await admin.query('SELECT count(*)::int AS count FROM public.query_events')).rows).toEqual(before.rows);
  }, 30_000);

  it('reports content lock contention as retryable after rolling back the rejected transaction', async () => {
    const issue = () => fetch(`${started!.address}/v1/intake/entitlements`, {
      method: 'POST', headers: { ...headers, authorization },
      body: JSON.stringify({ shopId: 'shop-a', contextGeneration: 1, releaseId, productIds: [], scenarioIds: [] }),
    });
    const before = await admin.query('SELECT count(*)::int AS count FROM content_intake.entitlements');
    await admin.query('BEGIN');
    try {
      await admin.query('SELECT backend_review.lock_content()');
      const response = await issue();
      expect(response.status).toBe(503);
      expect(parse('IntakeError', await response.json()).error).toMatchObject({
        code: 'OVERLOADED', details: { reason: 'COMMIT_UNKNOWN' },
      });
      expect((await admin.query('SELECT count(*)::int AS count FROM content_intake.entitlements')).rows).toEqual(before.rows);
    } finally { await admin.query('ROLLBACK'); }
    parse('IntakeEntitlement', await json(await issue()));
  }, 15_000);

  it('rechecks current publication gates on every readiness request', async () => {
    await admin.query("INSERT INTO content_intake.release_revocations(release_id,generation,reason,revoked_at) VALUES($1,1,'synthetic revocation',clock_timestamp())", [releaseId]);
    const ready = await fetch(`${started!.address}/ready`);
    expect(ready.status).toBe(503);
    expect(parse('NotReadyResponse', await ready.json()).checks.content).toBe('not_ready');
  });
});
