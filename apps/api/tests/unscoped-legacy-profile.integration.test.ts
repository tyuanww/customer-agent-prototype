import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Pool, type Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createApiApp, createSyntheticTestApiApp } from '../src/app.js';
import { unavailableContentImportRepository } from '../src/content-import-repository.js';
import { createIterationTaskRepository } from '../src/iteration-task-repository.js';
import { createOpsLoopRepository } from '../src/ops-loop-repository.js';
import { createProductAuthService, type SyntheticIdentityProvider } from '../src/product-auth-service.js';
import { parseApiRuntimeConfig, type ApiProfile } from '../src/runtime-config.js';
import type { ServiceRepository } from '../src/service-repository.js';
import { startApi } from '../src/server.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const keyRing = {
  currentVersion: 'hmac-idempotency-v1',
  keys: { 'hmac-idempotency-v1': 'synthetic-unscoped-metrics-key-material' },
};
const provider: SyntheticIdentityProvider = {
  authorizeUrl: state => `http://127.0.0.1/authorize?state=${state}`,
  exchange: async code => code,
  close: () => undefined,
};

function serviceRepository(): ServiceRepository {
  return {
    readiness: async () => ({ database: 'ok', schema: 'ok', auth: 'ok', storage: 'not_ready', content: 'not_ready' }),
    readPolicyFlags: async () => null,
    searchCandidates: async () => ({ ok: false, code: 'SOURCE_GATE_NOT_READY' }),
    executeSearch: async () => ({ ok: false, code: 'OVERLOADED' }),
    recordAdoption: async () => ({ ok: false, code: 'OVERLOADED' }),
    recordEscalation: async () => ({ ok: false, code: 'OVERLOADED' }),
    contentImport: unavailableContentImportRepository(),
    close: async () => undefined,
  };
}

type Server = {
  origin: string;
  checkouts: { count: number };
};
type Probe =
  | { method: 'GET'; path: string }
  | { method: 'POST' | 'PATCH' | 'DELETE'; path: string; body: Record<string, unknown> }
  | { method: 'POST'; path: string; csv: string };

describe.skipIf(!enabled)('unscoped legacy profile boundary over HTTP and PostgreSQL', () => {
  let pg: Pg15Harness;
  let admin: Client;
  let pool: Pool;
  let auth: Awaited<ReturnType<typeof createProductAuthService>>;
  let connection: (user: string) => string;
  let servers: Record<ApiProfile | 'synthetic', Server>;
  const openApps: FastifyInstance[] = [];
  let tokens: Record<'agent' | 'coach' | 'owner', string>;
  let probes: readonly Probe[];
  const sopProbes: readonly Probe[] = [
    { method: 'GET', path: '/v1/sop/catalog' },
    { method: 'PATCH', path: '/v1/sop/nodes/sop-patch', body: { expected_version: 1, title: 'synthetic-patched' } },
    { method: 'DELETE', path: '/v1/sop/nodes/sop-delete', body: { expected_version: 1 } },
    { method: 'POST', path: '/v1/sop/import',
      csv: 'node_id,parent_node_id,title,body,sort_key\nsop-imported,,synthetic-import,synthetic-body,0\n' },
  ];
  const scriptProbes = [
    { method: 'PATCH', path: '/v1/content/scripts/script-feedback', body: {
      expected_version: 1, title: 'synthetic revised title', answer_text: 'synthetic revised answer',
      effective_from: '2026-01-01T00:00:00Z',
    } },
    { method: 'DELETE', path: '/v1/content/scripts/script-feedback', body: { expected_version: 1 } },
  ] as const satisfies readonly Probe[];

  async function login(binding: string): Promise<string> {
    const verifier = 'v'.repeat(43);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const loginRequest = await auth.createLogin(challenge);
    const state = new URL(loginRequest.authorize_url).searchParams.get('state');
    if (!state) throw new Error('synthetic login state missing');
    await auth.callback(state, binding);
    const session = await auth.exchange(loginRequest.login_id, verifier);
    if (!session) throw new Error('synthetic login session missing');
    return session.access_token;
  }

  async function start(profile: ApiProfile, assemble = createApiApp): Promise<Server> {
    const checkouts = { count: 0 };
    const observedPool = { connect: async () => { checkouts.count += 1; return pool.connect(); } };
    const config = parseApiRuntimeConfig({
      CUSTOMER_AGENT_PROFILE: profile,
      AUTH_MODE: 'feishu',
      AUTH_SESSION_MODE: 'product',
      CUSTOMER_AGENT_API_PORT: '3100',
      FEISHU_APP_ID: 'cli_synthetic123',
      FEISHU_APP_SECRET: 'synthetic-secret-material',
      FEISHU_REDIRECT_URI: 'https://example.invalid/v1/auth/callback',
    });
    const app = assemble({
      config,
      authService: auth,
      repository: serviceRepository(),
      opsLoopDependencies: { repository: createOpsLoopRepository(observedPool), idempotencyHmac: keyRing },
      iterationTaskDependencies: { repository: createIterationTaskRepository(observedPool), idempotencyHmac: keyRing },
    });
    openApps.push(app);
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    return { origin, checkouts };
  }

  async function request(server: Server, probe: Probe, token?: string): Promise<Response> {
    const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
    if (probe.method === 'GET') return fetch(`${server.origin}${probe.path}`, { headers });
    headers['idempotency-key'] = `synthetic-${probe.method}-${probe.path}`;
    if ('csv' in probe) {
      const form = new FormData();
      form.set('file', new Blob([probe.csv], { type: 'text/csv' }), 'synthetic.csv');
      return fetch(`${server.origin}${probe.path}`, { method: probe.method, headers, body: form });
    }
    headers['content-type'] = 'application/json';
    return fetch(`${server.origin}${probe.path}`, {
      method: probe.method,
      headers,
      body: JSON.stringify(probe.body),
    });
  }

  async function seedFeedbackRelease(): Promise<void> {
    // Seed a complete synthetic release and candidate provenance. Its third report would
    // cross the existing global threshold; all source and telemetry triggers stay enabled.
    await admin.query(`
      ALTER TABLE public.content_releases ENABLE TRIGGER release_source_set_complete;
      ALTER TABLE public.query_events ENABLE TRIGGER query_source_gate_telemetry_guard;
      BEGIN;
      SELECT set_config('app.publishing', 'on', true), set_config('app.semantic_asset_write', 'publish', true);
      INSERT INTO public.authoritative_source_versions(
        source_version_id,source_ref,domain,upstream_version,snapshot_sha256,use_class,owner_role,
        approval_evd,approved_by,approved_at,review_due_at)
      SELECT 'srcv_feedback_' || domain, 'SRC-FEEDBACK-' || upper(domain), domain, 'v1', repeat('a',64),
        'canonical', 'ROLE-CONTENT-LEAD', 'EVD-FEEDBACK', 'synthetic-owner', now(), now()+interval '1 year'
      FROM unnest(ARRAY['aftersale','campaign','presale','product']::text[]) AS domains(domain);
      INSERT INTO public.intent_taxonomy_versions(intent_taxonomy_version,approval_evd,approved_by,approved_at)
      VALUES ('itax_feedback','EVD-FEEDBACK','synthetic-owner',now());
      INSERT INTO public.intent_taxonomy_entries(intent_taxonomy_version,intent_id,label,lifecycle)
      VALUES ('itax_feedback','intent_feedback','synthetic','active');
      INSERT INTO public.semantic_source_assets(source_asset_id,source,origin_fingerprint,origin_fingerprint_key_version)
      VALUES ('sa_feedback','manual',repeat('e',64),'v1');
      INSERT INTO public.content_releases(release_id,release_seq,status,source_binding_hash)
      SELECT 'rel-feedback', 2, 'published', encode(public.digest(convert_to(
        string_agg(domain || ':srcv_feedback_' || domain, '|' ORDER BY domain), 'UTF8'), 'sha256'), 'hex')
      FROM unnest(ARRAY['aftersale','campaign','presale','product']::text[]) AS domains(domain);
      INSERT INTO public.release_source_bindings(release_id,domain,source_version_id)
      SELECT 'rel-feedback', domain, 'srcv_feedback_' || domain
      FROM unnest(ARRAY['aftersale','campaign','presale','product']::text[]) AS domains(domain);
      WITH question AS (
        SELECT jsonb_build_object(
          'question_id','q_synthetic_feedback', 'question_version',1, 'question_text','synthetic question',
          'semantic_family_id','sf_feedback', 'origin_fingerprint',repeat('e',64),
          'origin_fingerprint_key_version','v1', 'source_asset_id','sa_feedback', 'source','manual',
          'intent_taxonomy_version','itax_feedback', 'intent_id','intent_feedback') AS value
      )
      INSERT INTO public.release_items(
        release_id,script_id,script_version,content_hash,answer_text,title,category,source_ref,source_version_id,
        owner_role,review_due_at,effective_from,platform_scope,product_scope_type,product_scope_refs,
        intent_taxonomy_version,intent_id,risk_level,risk_categories,has_conflict,review_mode,
        primary_reviewer_id,primary_reviewer_role,primary_review_evd,placeholder_keys,questions_json,
        search_document,search_fallback_text)
      SELECT 'rel-feedback','script-feedback',1,repeat('f',64),'synthetic answer','synthetic title','presale',
        'SRC-FEEDBACK-PRESALE','srcv_feedback_presale','ROLE-CONTENT-LEAD',now()+interval '1 year',
        now()-interval '1 day',ARRAY['qianniu'],'storewide',ARRAY[]::text[],'itax_feedback','intent_feedback',
        'low',ARRAY[]::text[],false,'single',repeat('d',64),'ROLE-CONTENT-LEAD','EVD-FEEDBACK',
        ARRAY[]::text[],jsonb_build_array(value || jsonb_build_object('question_hash',public.content_question_hash(value))),
        to_tsvector('simple','synthetic'),'synthetic'
      FROM question;
      INSERT INTO public.scripts(
        script_id,category,title,answer_text,status,version,content_hash,source_ref,source_version_id,
        platform_scope,product_scope_type,product_scope_refs,effective_from,effective_to,
        intent_taxonomy_version,intent_id,risk_level,risk_categories,has_conflict,review_mode,
        primary_reviewer_id,primary_reviewer_role,primary_review_evd,
        secondary_reviewer_id,secondary_reviewer_role,secondary_review_evd,
        placeholder_keys,questions_json,owner_role,review_due_at)
      SELECT script_id,category,title,answer_text,'published',script_version,content_hash,source_ref,source_version_id,
        platform_scope,product_scope_type,product_scope_refs,effective_from,effective_to,
        intent_taxonomy_version,intent_id,risk_level,risk_categories,has_conflict,review_mode,
        primary_reviewer_id,primary_reviewer_role,primary_review_evd,
        secondary_reviewer_id,secondary_reviewer_role,secondary_review_evd,
        placeholder_keys,questions_json,owner_role,review_due_at
      FROM public.release_items WHERE release_id='rel-feedback' AND script_id='script-feedback';
      INSERT INTO public.content_current(id,current_release_id) VALUES (1,'rel-feedback')
      ON CONFLICT (id) DO UPDATE SET current_release_id=EXCLUDED.current_release_id;
      COMMIT;
    `);
    const gate = await admin.query<{ source_gate_ready: boolean }>(
      "SELECT source_gate_ready FROM public.v_release_source_gate WHERE release_id='rel-feedback'",
    );
    expect(gate.rows[0]?.source_gate_ready).toBe(true);
  }

  beforeAll(async () => {
    pg = new Pg15Harness();
    pg.start();
    const db = pg.createDatabase('unscoped_metrics');
    admin = await pg.connect(db.config);
    await applyDatabaseMigrations(admin);
    await admin.query(`
      CREATE ROLE synthetic_metrics_auth LOGIN NOINHERIT;
      GRANT app_backend_auth TO synthetic_metrics_auth;
      CREATE ROLE synthetic_metrics_runtime LOGIN INHERIT;
      GRANT app_runtime TO synthetic_metrics_runtime;
      CREATE ROLE synthetic_metrics_admin LOGIN NOINHERIT;
      GRANT app_content_admin TO synthetic_metrics_admin;
      INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
      VALUES ('synthetic_agent','synthetic','tenant-a','agent-a','user-agent',repeat('a',64),true,'agent'),
             ('synthetic_coach','synthetic','tenant-a','coach-a','user-coach',repeat('b',64),true,'coach'),
             ('synthetic_owner','synthetic','tenant-b','owner-b','user-owner',repeat('c',64),true,'owner');
      -- These test-only rows exercise the real queries; the source gate requires a full published catalog.
      ALTER TABLE public.content_releases DISABLE TRIGGER release_source_set_complete;
      ALTER TABLE public.query_events DISABLE TRIGGER query_source_gate_telemetry_guard;
      INSERT INTO public.content_releases(release_id,release_seq,status,source_binding_hash)
      VALUES ('rel-synthetic',1,'published',repeat('d',64));
      INSERT INTO public.query_events(query_id,user_id,tenant_id,request_hash,request_hash_key_version,hash_key_version,
        text_storage_status,collection_mode,platform_source,redaction_policy_version,hit_status,release_id)
      VALUES ('query-a','user-agent','tenant-a',repeat('a',64),'k','k','suppressed','synthetic','manual','v1','hit','rel-synthetic'),
             ('query-b','user-other','tenant-b',repeat('a',64),'k','k','suppressed','synthetic','manual','v1','no_hit','rel-synthetic');
      INSERT INTO ops_loop.inaccuracy_reports(query_id,script_id,actor_user_id,evidence_hash,created_at)
      VALUES ('query-b','script-b','user-other',repeat('a',64),now()-interval '3 days');
      INSERT INTO public.iteration_tasks(task_id,signal_id,cluster_key,sample_query_ids,suspected_cause)
      VALUES ('task-start','signal-start','cluster-start',ARRAY['query-b'],'content_gap'),
             ('task-close','signal-close','cluster-close',ARRAY['query-b'],'content_gap'),
             ('task-outcome','inaccuracy:script-b','cluster-outcome',ARRAY['query-b'],'content_gap');
      UPDATE public.iteration_tasks SET status='in_progress',version=2 WHERE task_id IN ('task-close','task-outcome');
      UPDATE public.iteration_tasks SET status='resolved',resolution='resolved',resolution_note='synthetic',
        resolved_at=now()-interval '8 days',version=3 WHERE task_id='task-outcome';
      INSERT INTO ops_loop.sop_nodes(node_id,parent_node_id,product_session_id,title,body,sort_key,version,lifecycle)
      VALUES ('sop-patch',NULL,'default','synthetic-patch','synthetic-body',0,1,'active'),
             ('sop-delete',NULL,'default','synthetic-delete','synthetic-body',1,1,'active');
    `);
    await seedFeedbackRelease();
    connection = (user: string) => `postgresql://${user}@localhost/${db.name}?${new URLSearchParams({ host: pg.socket, port: String(pg.port) })}`;
    auth = await createProductAuthService({ connectionString: connection('synthetic_metrics_auth'),
      poolMax: 2, connectionTimeoutMs: 2_000, readinessTimeoutMs: 3_000 }, provider, 'feishu');
    pool = new Pool({ connectionString: connection('synthetic_metrics_runtime'), max: 2 });
    tokens = {
      agent: await login('synthetic_agent'),
      coach: await login('synthetic_coach'),
      owner: await login('synthetic_owner'),
    };
    servers = {
      production: await start('production'),
      'formal-dev': await start('formal-dev'),
      test: await start('test'),
      synthetic: await start('test', createSyntheticTestApiApp),
    };
    const startAt = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const endAt = new Date(Date.now() + 86_400_000).toISOString();
    probes = [
      { method: 'GET', path: `/v1/metrics/question?${new URLSearchParams({ start: startAt, end: endAt })}` },
      { method: 'GET', path: '/v1/metrics/retrieval?window=last_7d' },
      { method: 'GET', path: '/v1/metrics/inaccuracy-outcomes' },
      { method: 'GET', path: '/v1/metrics/iteration-tasks' },
      { method: 'POST', path: '/v1/events/iteration-tasks/task-start/start', body: { expected_version: 1 } },
      { method: 'POST', path: '/v1/events/iteration-tasks/task-close/close', body: { expected_version: 2, status: 'resolved', resolution_note: 'synthetic' } },
    ];
  }, 180_000);

  afterAll(async () => {
    await Promise.all(openApps.map(app => app.close()));
    await auth?.close();
    await pool?.end();
    await admin?.end();
    pg?.stop();
  }, 60_000);

  it.each(['production', 'formal-dev', 'test'] as const)('denies scoped-unknown reads and writes in ordinary %s after authentication', async profile => {
    const server = servers[profile];
    for (const probe of probes) {
      expect((await request(server, probe)).status, probe.path).toBe(401);
      expect((await request(server, probe, tokens.agent)).status, probe.path).toBe(403);
      for (const token of [tokens.coach, tokens.owner]) {
        const response = await request(server, probe, token);
        expect(response.status, probe.path).toBe(503);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toMatchObject({ error: { code: 'OVERLOADED', message: '服务暂不可用' } });
      }
    }
    expect(server.checkouts.count).toBe(0);
    const tasks = await admin.query<{ task_id: string; status: string; version: number }>(
      `SELECT task_id,status,version FROM public.iteration_tasks WHERE task_id IN ('task-start','task-close') ORDER BY task_id`,
    );
    expect(tasks.rows).toEqual([
      { task_id: 'task-close', status: 'in_progress', version: 2 },
      { task_id: 'task-start', status: 'open', version: 1 },
    ]);
    const usage = await request(server, { method: 'GET', path: '/v1/events/usage' }, tokens.agent);
    expect(usage.status).toBe(200);
    expect(await usage.json()).toMatchObject({ rows: [{ id: 'query-a' }] });
  });

  it.each(['production', 'formal-dev', 'test'] as const)('denies unscoped SOP reads and writes in ordinary %s after role checks', async profile => {
    const server = servers[profile];
    const before = server.checkouts.count;
    for (const probe of sopProbes) {
      expect((await request(server, probe)).status, probe.path).toBe(401);
      expect((await request(server, probe, tokens.agent)).status, probe.path).toBe(403);
      const coach = await request(server, probe, tokens.coach);
      expect(coach.status, probe.path).toBe(probe.method === 'DELETE' ? 403 : 503);
      const owner = await request(server, probe, tokens.owner);
      expect(owner.status, probe.path).toBe(503);
      expect(owner.headers.get('cache-control')).toBe('no-store');
      expect(await owner.json()).toMatchObject({ error: { code: 'OVERLOADED', message: '服务暂不可用' } });
    }
    expect(server.checkouts.count).toBe(before);
    const nodes = await admin.query<{ node_id: string; title: string; version: number; lifecycle: string }>(
      `SELECT node_id,title,version,lifecycle FROM ops_loop.sop_nodes ORDER BY node_id`,
    );
    expect(nodes.rows).toEqual([
      { node_id: 'sop-delete', title: 'synthetic-delete', version: 1, lifecycle: 'active' },
      { node_id: 'sop-patch', title: 'synthetic-patch', version: 1, lifecycle: 'active' },
    ]);
  });

  it.each(['production', 'formal-dev', 'test'] as const)('denies unscoped script drafts in ordinary %s without writing', async profile => {
    const server = servers[profile];
    const beforeCheckouts = server.checkouts.count;
    const before = await admin.query('SELECT * FROM ops_loop.script_mutations WHERE script_id=$1', ['script-feedback']);
    for (const probe of scriptProbes) {
      expect((await request(server, probe)).status, probe.method).toBe(401);
      for (const token of [tokens.agent, tokens.coach]) {
        expect((await request(server, probe, token)).status, probe.method).toBe(403);
      }
      const owner = await request(server, probe, tokens.owner);
      expect(owner.status, probe.method).toBe(503);
      expect(owner.headers.get('cache-control')).toBe('no-store');
      expect(await owner.json()).toMatchObject({ error: { code: 'OVERLOADED', message: '服务暂不可用' } });
    }
    expect(server.checkouts.count).toBe(beforeCheckouts);
    const after = await admin.query('SELECT * FROM ops_loop.script_mutations WHERE script_id=$1', ['script-feedback']);
    expect(after.rows).toEqual(before.rows);
  });

  it('keeps the actual test-profile startup closed against the isolated database', async () => {
    for (const key of ['INTAKE_BUSINESS_DATABASE_URL', 'INTAKE_USAGE_DATABASE_URL', 'INTAKE_WORKER_DATABASE_URL']) {
      vi.stubEnv(key, undefined);
    }
    let started: Awaited<ReturnType<typeof startApi>> | undefined;
    try {
      started = await startApi({ environment: {
        CUSTOMER_AGENT_PROFILE: 'test', AUTH_MODE: 'mock', CUSTOMER_AGENT_API_PORT: '0',
        DATABASE_URL: connection('synthetic_metrics_runtime'),
        CONTENT_ADMIN_DATABASE_URL: connection('synthetic_metrics_admin'),
        IDEMPOTENCY_HMAC_KEYS: JSON.stringify(keyRing.keys),
        IDEMPOTENCY_HMAC_CURRENT_VERSION: keyRing.currentVersion,
        LOG_HASH_KEY: 'synthetic-startup-log-hash-material-0001', LOG_HASH_KEY_VERSION: 'hmac-log-v1',
      } });
      const headers = { 'x-mock-user': 'user-coach', 'x-mock-role': 'coach' };
      for (const path of [
        '/v1/metrics/question?start=2026-01-01T00:00:00Z&end=2026-02-01T00:00:00Z',
        '/v1/metrics/iteration-tasks',
        '/v1/sop/catalog',
      ]) {
        const response = await fetch(`${started.address}${path}`, { headers });
        expect(response.status, path).toBe(503);
        expect(await response.json()).toMatchObject({ error: { code: 'OVERLOADED' } });
      }
      for (const probe of scriptProbes) {
        const response = await fetch(`${started.address}${probe.path}`, {
          method: probe.method,
          headers: { 'x-mock-user': 'user-owner', 'x-mock-role': 'owner',
            'content-type': 'application/json', 'idempotency-key': `startup-${probe.method}` },
          body: JSON.stringify(probe.body),
        });
        expect(response.status, probe.method).toBe(503);
        expect(await response.json()).toMatchObject({ error: { code: 'OVERLOADED' } });
      }
      const mutations = await admin.query('SELECT mutation_id FROM ops_loop.script_mutations WHERE script_id=$1', ['script-feedback']);
      expect(mutations.rows).toEqual([]);
      const tasks = await admin.query<{ task_id: string; status: string; version: number }>(
        `SELECT task_id,status,version FROM public.iteration_tasks WHERE task_id IN ('task-start','task-close') ORDER BY task_id`,
      );
      expect(tasks.rows).toEqual([
        { task_id: 'task-close', status: 'in_progress', version: 2 },
        { task_id: 'task-start', status: 'open', version: 1 },
      ]);
    } finally {
      try { await started?.close(); } finally { vi.unstubAllEnvs(); }
    }
  });

  it('keeps the explicitly assembled synthetic fixture reading and updating the same records', async () => {
    const server = servers.synthetic;
    const responses: unknown[] = [];
    for (const probe of probes) {
      const response = await request(server, probe, tokens.coach);
      expect(response.status, probe.path).toBe(200);
      responses.push(await response.json());
    }
    expect(responses[0]).toMatchObject({ query_count: 2, hit_count: 1, no_hit_count: 1, inaccuracy_count: 1 });
    expect(responses[1]).toMatchObject({ no_hit_rate: 0.5 });
    expect(responses[2]).toMatchObject({ items: [{ scriptId: 'script-b', afterCount: 1 }] });
    expect(responses[3]).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ task_id: 'task-start' })]) });
    expect(responses[4]).toMatchObject({ task_id: 'task-start', status: 'in_progress', version: 2 });
    expect(responses[5]).toMatchObject({ task_id: 'task-close', status: 'resolved', version: 3 });
    expect(server.checkouts.count).toBeGreaterThanOrEqual(probes.length);
  });

  it('keeps legacy SOP catalog, patch, delete and import usable in the synthetic fixture', async () => {
    const server = servers.synthetic;
    const responses: unknown[] = [];
    for (const [index, probe] of sopProbes.entries()) {
      const response = await request(server, probe, tokens.owner);
      expect(response.status, probe.path).toBe(index === 3 ? 202 : 200);
      responses.push(await response.json());
    }
    expect(responses[0]).toMatchObject({ product_session_id: 'default', items: expect.arrayContaining([
      expect.objectContaining({ node_id: 'sop-patch', title: 'synthetic-patch' }),
      expect.objectContaining({ node_id: 'sop-delete', title: 'synthetic-delete' }),
    ]) });
    expect(responses[1]).toMatchObject({ node_id: 'sop-patch', title: 'synthetic-patched', version: 2 });
    expect(responses[2]).toMatchObject({ node_id: 'sop-delete', lifecycle: 'deleted', version: 2 });
    expect(responses[3]).toMatchObject({ ok: true, product_session_id: 'default', node_count: 1 });
    const nodes = await admin.query<{ node_id: string }>('SELECT node_id FROM ops_loop.sop_nodes');
    expect(nodes.rows).toEqual([{ node_id: 'sop-imported' }]);
  });

  it('allows only the owner to create pending script drafts in the synthetic fixture', async () => {
    const server = servers.synthetic;
    for (const probe of scriptProbes) {
      expect((await request(server, probe)).status, probe.method).toBe(401);
      for (const token of [tokens.agent, tokens.coach]) {
        expect((await request(server, probe, token)).status, probe.method).toBe(403);
      }
      const owner = await request(server, probe, tokens.owner);
      expect(owner.status, probe.method).toBe(200);
      const body = await owner.json() as { mutation_id: string };
      expect(body).toMatchObject({ ok: true, script_id: 'script-feedback', review_status: 'pending_review' });
      const replay = await request(server, probe, tokens.owner);
      expect(replay.status, probe.method).toBe(200);
      expect(await replay.json()).toMatchObject({ mutation_id: body.mutation_id, review_status: 'pending_review' });
    }
    const drafts = await admin.query<{ action: string; review_status: string; actor_user_id: string }>(
      `SELECT action,review_status,actor_user_id FROM ops_loop.script_mutations WHERE script_id=$1 ORDER BY action`,
      ['script-feedback'],
    );
    expect(drafts.rows).toEqual([
      { action: 'delete', review_status: 'pending_review', actor_user_id: 'user-owner' },
      { action: 'patch', review_status: 'pending_review', actor_user_id: 'user-owner' },
    ]);
    const current = await admin.query<{ status: string; version: number; title: string; current_release_id: string }>(
      `SELECT s.status,s.version,s.title,c.current_release_id FROM public.scripts s CROSS JOIN public.content_current c
       WHERE s.script_id=$1 AND c.id=1`, ['script-feedback'],
    );
    expect(current.rows).toEqual([{ status: 'published', version: 1, title: 'synthetic title', current_release_id: 'rel-feedback' }]);
  });

  it('blocks feedback and task creation in every ordinary profile while preserving the synthetic fixture', async () => {
    await admin.query(`
      INSERT INTO public.query_events(query_id,user_id,tenant_id,request_hash,request_hash_key_version,
        hash_key_version,text_storage_status,collection_mode,platform_source,redaction_policy_version,hit_status,release_id)
      VALUES ('11111111-1111-1111-1111-111111111111','user-agent','tenant-a',repeat('a',64),'k','k','suppressed','synthetic','manual','v1','hit','rel-feedback'),
             ('22222222-2222-2222-2222-222222222222','user-other','tenant-b',repeat('a',64),'k','k','suppressed','synthetic','manual','v1','hit','rel-feedback'),
             ('33333333-3333-3333-3333-333333333333','user-agent','tenant-a',repeat('a',64),'k','k','suppressed','synthetic','manual','v1','hit','rel-feedback');
      INSERT INTO public.candidate_impressions(query_id,rank,release_id,script_id,script_version,content_hash)
      SELECT query_id,1,'rel-feedback','script-feedback',1,repeat('f',64)
      FROM public.query_events WHERE release_id='rel-feedback';
      INSERT INTO ops_loop.inaccuracy_reports(query_id,script_id,actor_user_id,evidence_hash)
      VALUES ('11111111-1111-1111-1111-111111111111','script-feedback','user-agent',repeat('a',64)),
             ('22222222-2222-2222-2222-222222222222','script-feedback','user-other',repeat('a',64));
    `);
    const probe: Probe = {
      method: 'POST', path: '/v1/inaccuracy-reports',
      body: { query_id: '33333333-3333-3333-3333-333333333333', script_id: 'script-feedback' },
    };
    const counts = async () => (await admin.query<{ reports: number; tasks: number }>(`
      SELECT
        (SELECT count(*)::int FROM ops_loop.inaccuracy_reports WHERE script_id='script-feedback') AS reports,
        (SELECT count(*)::int FROM public.iteration_tasks WHERE cluster_key='script-feedback') AS tasks
    `)).rows[0];
    expect(await counts()).toEqual({ reports: 2, tasks: 0 });
    for (const profile of ['production', 'formal-dev', 'test'] as const) {
      const server = servers[profile];
      const before = server.checkouts.count;
      expect((await request(server, probe)).status).toBe(401);
      for (const token of [tokens.agent, tokens.coach, tokens.owner]) {
        const response = await request(server, probe, token);
        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toMatchObject({ error: { code: 'OVERLOADED', message: '服务暂不可用' } });
      }
      expect(server.checkouts.count).toBe(before);
      expect(await counts()).toEqual({ reports: 2, tasks: 0 });
    }
    const response = await request(servers.synthetic, probe, tokens.agent);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, ...probe.body });
    expect(await counts()).toEqual({ reports: 3, tasks: 1 });
    expect((await request(servers.synthetic, probe, tokens.agent)).status).toBe(200);
    expect(await counts()).toEqual({ reports: 3, tasks: 1 });
  });
});
