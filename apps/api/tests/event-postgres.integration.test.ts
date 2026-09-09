import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool, type ClientConfig } from 'pg';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createApiApp } from '../src/app.js';
import {
  createEventRepository,
  type EventRepository,
  type PreparedAdoptionOperation,
  type PreparedEscalationOperation,
} from '../src/event-repository.js';
import { hmacSafeValue, prepareIdempotencyHashes } from '../src/idempotency.js';
import type { PreparedSearchOperation } from '../src/search-routes.js';
import { parseApiRuntimeConfig } from '../src/runtime-config.js';
import { unavailableContentImportRepository } from '../src/content-import-repository.js';
import type { ServiceRepository } from '../src/service-repository.js';

const describePg15 = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1'
  ? describe.sequential
  : describe.skip;

const RELEASE_ID = 'rel_synthetic_events_v1';
const SCRIPT_ID = 'script_synthetic_events_001';
const INTENT_TAXONOMY_VERSION = 'itax_synthetic_events_v1';
const INTENT_ID = 'intent_synthetic_events_shipping';
const SOURCE_BINDINGS = Object.freeze([
  ['aftersale', 'srcv_synth_events_aftersale_v1', 'SRC-SYNTH-EVENTS-AFTERSALE'],
  ['campaign', 'srcv_synth_events_campaign_v1', 'SRC-SYNTH-EVENTS-CAMPAIGN'],
  ['presale', 'srcv_synth_events_presale_v1', 'SRC-SYNTH-EVENTS-PRESALE'],
  ['product', 'srcv_synth_events_product_v1', 'SRC-SYNTH-EVENTS-PRODUCT'],
] as const);
const IDEMPOTENCY_KEYS = Object.freeze({
  currentVersion: 'hmac-idempotency-v1',
  keys: Object.freeze({
    'hmac-idempotency-v1': 'synthetic-events-idempotency-material-0001',
  }),
});
const LOG_HASH = Object.freeze({
  version: 'hmac-log-v1',
  key: 'synthetic-events-log-hash-material-00001',
});
const ACTOR = Object.freeze({
  user_id: 'usr_synthetic_events_agent_001',
  role: 'agent' as const,
  auth_mode: 'mock' as const,
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sourceBindingHash(): string {
  return sha256(SOURCE_BINDINGS
    .map(([domain, sourceVersionId]) => `${domain}:${sourceVersionId}`)
    .join('|'));
}

async function seedEventRelease(owner: Client): Promise<void> {
  const sourceAssetId = 'sa_synthetic_events_001';
  const originFingerprint = sha256('synthetic-events-origin');
  const questionBase = {
    question_id: 'q_synthetic_events_001',
    question_version: 1,
    question_text: '什么时候发货',
    semantic_family_id: 'sf_synthetic_events_001',
    origin_fingerprint: originFingerprint,
    origin_fingerprint_key_version: 'hmac-synthetic-v1',
    source_asset_id: sourceAssetId,
    source: 'manual',
    intent_taxonomy_version: INTENT_TAXONOMY_VERSION,
    intent_id: INTENT_ID,
  };

  await owner.query('BEGIN');
  try {
    await owner.query("SELECT pg_catalog.set_config('app.publishing', 'on', true)");
    await owner.query("SELECT pg_catalog.set_config('app.semantic_asset_write', 'publish', true)");
    for (const [domain, sourceVersionId, sourceRef] of SOURCE_BINDINGS) {
      await owner.query(`
        INSERT INTO public.authoritative_source_versions(
          source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
          use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at
        ) VALUES (
          $1, $2, $3, 'synthetic-v1', $4,
          'canonical', 'ROLE-CONTENT-LEAD', 'EVD-SYNTHETIC-EVENTS-SOURCE',
          'synthetic-owner', pg_catalog.clock_timestamp() - INTERVAL '1 day',
          pg_catalog.clock_timestamp() + INTERVAL '365 days'
        )
      `, [sourceVersionId, sourceRef, domain, sha256(`synthetic-events-source-${domain}`)]);
    }
    await owner.query(`
      INSERT INTO public.intent_taxonomy_versions(
        intent_taxonomy_version, approval_evd, approved_by, approved_at
      ) VALUES ($1, 'EVD-SYNTHETIC-EVENTS-TAXONOMY', 'synthetic-owner', pg_catalog.clock_timestamp())
    `, [INTENT_TAXONOMY_VERSION]);
    await owner.query(`
      INSERT INTO public.intent_taxonomy_entries(
        intent_taxonomy_version, intent_id, label, lifecycle
      ) VALUES ($1, $2, '合成发货事件意图', 'active')
    `, [INTENT_TAXONOMY_VERSION, INTENT_ID]);
    await owner.query(`
      INSERT INTO public.content_releases(
        release_id, release_seq, title, status, source_binding_hash,
        published_by, published_by_role
      ) VALUES ($1, 1, '合成事件发布', 'published', $2, 'synthetic-owner', 'owner')
    `, [RELEASE_ID, sourceBindingHash()]);
    for (const [domain, sourceVersionId] of SOURCE_BINDINGS) {
      await owner.query(`
        INSERT INTO public.release_source_bindings(release_id, domain, source_version_id)
        VALUES ($1, $2, $3)
      `, [RELEASE_ID, domain, sourceVersionId]);
    }
    await owner.query(`
      INSERT INTO public.semantic_source_assets(
        source_asset_id, source, origin_fingerprint, origin_fingerprint_key_version
      ) VALUES ($1, 'manual', $2, 'hmac-synthetic-v1')
    `, [sourceAssetId, originFingerprint]);
    const questionHash = await owner.query<{ question_hash: string }>(
      'SELECT public.content_question_hash($1::jsonb) AS question_hash',
      [JSON.stringify(questionBase)],
    );
    const questions = [{ ...questionBase, question_hash: questionHash.rows[0]?.question_hash }];
    await owner.query(`
      INSERT INTO public.release_items(
        release_id, script_id, script_version, content_hash, answer_text, title, category,
        source_ref, source_version_id, owner_role, review_due_at, effective_from, effective_to,
        platform_scope, product_scope_type, product_scope_refs, intent_taxonomy_version, intent_id,
        risk_level, risk_categories, has_conflict, review_mode, primary_reviewer_id,
        primary_reviewer_role, primary_review_evd, secondary_reviewer_id,
        secondary_reviewer_role, secondary_review_evd, placeholder_keys, questions_json,
        search_document, search_fallback_text
      ) VALUES (
        $1, $2, 1, $3, '这是合成发货回答。', '合成发货时效', 'presale',
        'SRC-SYNTH-EVENTS-PRESALE', 'srcv_synth_events_presale_v1', 'ROLE-CONTENT-LEAD',
        pg_catalog.clock_timestamp() + INTERVAL '365 days',
        pg_catalog.clock_timestamp() - INTERVAL '1 day', NULL,
        ARRAY['qianniu']::text[], 'storewide', ARRAY[]::text[], $4, $5,
        'low', ARRAY[]::text[], FALSE, 'single', $6,
        'ROLE-CONTENT-LEAD', 'EVD-SYNTHETIC-EVENTS-REVIEW', NULL, NULL, NULL,
        ARRAY[]::text[], $7::jsonb,
        pg_catalog.to_tsvector('simple', '什么 么时 时候 候发 发货'),
        '什么时候发货 合成发货时效'
      )
    `, [
      RELEASE_ID,
      SCRIPT_ID,
      sha256('synthetic-events-content'),
      INTENT_TAXONOMY_VERSION,
      INTENT_ID,
      sha256('synthetic-events-reviewer'),
      JSON.stringify(questions),
    ]);
    await owner.query('INSERT INTO public.content_current(id, current_release_id) VALUES (1, $1)', [
      RELEASE_ID,
    ]);
    await owner.query('COMMIT');
  } catch (error) {
    await owner.query('ROLLBACK');
    throw error;
  }
}

function searchRequest(queryId: string, overrides: Partial<PreparedSearchOperation> = {}): PreparedSearchOperation {
  const body = {
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
  } as const;
  const denialDigest = hmacSafeValue(
    `source-denial:${ACTOR.user_id}:${queryId}`,
    LOG_HASH.version,
    LOG_HASH.key,
  );
  const diagnosticDigest = hmacSafeValue(
    `diagnostic:${ACTOR.user_id}:${queryId}`,
    LOG_HASH.version,
    LOG_HASH.key,
  );
  return Object.freeze({
    actor: ACTOR,
    queryId,
    parentQueryId: null,
    interactionReason: 'original',
    collectionMode: 'synthetic',
    detectedPlatform: 'qianniu',
    platformSource: 'foreground_process',
    search: Object.freeze({
      normalizedQuery: '什么时候发货',
      platform: 'qianniu',
      productContextType: null,
      productContextRef: null,
      topK: 3,
    }),
    redactionPolicyVersion: 'redaction-synthetic-v1',
    queryHash: hmacSafeValue('什么时候发货', LOG_HASH.version, LOG_HASH.key),
    queryHashKeyVersion: LOG_HASH.version,
    productContextRefHash: null,
    requestHashes: prepareIdempotencyHashes(body, IDEMPOTENCY_KEYS),
    sourceDenial: Object.freeze({
      denialKey: `sda_${denialDigest}`,
      actorSubjectHash: hmacSafeValue(`actor:${ACTOR.user_id}`, LOG_HASH.version, LOG_HASH.key),
      hashKeyVersion: LOG_HASH.version,
      diagnosticId: `diag_${diagnosticDigest.slice(0, 32)}`,
    }),
    ...overrides,
  });
}

function adoptionRequest(
  queryId: string,
  idempotencyKey: string,
  outcome: 'adopted' | 'dismissed' = 'adopted',
): PreparedAdoptionOperation {
  const event = outcome === 'adopted'
    ? {
      query_id: queryId,
      outcome,
      chosen_rank: 1,
      chosen_script_id: SCRIPT_ID,
      push_method: 'clipboard' as const,
    }
    : {
      query_id: queryId,
      outcome,
      chosen_rank: null,
      chosen_script_id: null,
      push_method: null,
    };
  return Object.freeze({
    actor: ACTOR,
    idempotencyKey,
    requestHashes: prepareIdempotencyHashes(event, IDEMPOTENCY_KEYS),
    event,
  });
}

function escalationRequest(
  queryId: string,
  idempotencyKey: string,
  action: 'open_feishu' | 'copy_contact' = 'open_feishu',
): PreparedEscalationOperation {
  const event = { query_id: queryId, action };
  return Object.freeze({
    actor: ACTOR,
    idempotencyKey,
    requestHashes: prepareIdempotencyHashes(event, IDEMPOTENCY_KEYS),
    event,
  });
}

describePg15('DEV-M1 query and event PostgreSQL 15 transactions', () => {
  let harness: Pg15Harness;
  let database: Readonly<{ name: string; config: ClientConfig }>;
  let owner: Client;
  let runtimePool: Pool;
  let statelessPool: Pool;
  let repository: EventRepository;
  let statelessRepository: EventRepository;

  beforeAll(async () => {
    harness = new Pg15Harness();
    harness.start();
    database = harness.createDatabase('event_transactions');
    owner = await harness.connect(database.config);
    await applyDatabaseMigrations(owner);
    await owner.query('CREATE ROLE w34_event_runtime LOGIN');
    await owner.query('GRANT app_runtime TO w34_event_runtime');
    await owner.query('CREATE ROLE w34_stateless_runtime LOGIN');
    await owner.query('GRANT USAGE ON SCHEMA public TO w34_stateless_runtime');
    await owner.query(`GRANT EXECUTE ON FUNCTION
      public.search_recommendable_scripts(TEXT,TEXT,TEXT),
      public.idempotency_lookup(TEXT,TEXT,TEXT,TEXT,TEXT),
      public.idempotency_request_hash_version(TEXT,TEXT,TEXT),
      public.idempotency_claim(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INT),
      public.idempotency_complete(TEXT,TEXT,TEXT,BIGINT,INT,JSONB,BOOLEAN)
      TO w34_stateless_runtime`);
    await seedEventRelease(owner);
    runtimePool = new Pool({ ...database.config, user: 'w34_event_runtime', max: 6 });
    statelessPool = new Pool({ ...database.config, user: 'w34_stateless_runtime', max: 2 });
    repository = createEventRepository(runtimePool, 'instance_synthetic_events');
    statelessRepository = createEventRepository(statelessPool, 'instance_synthetic_stateless');
  }, 120_000);

  afterAll(async () => {
    await statelessPool?.end();
    await runtimePool?.end();
    await owner?.end();
    harness?.stop();
  }, 60_000);

  it('atomically records a suppressed query plus exact candidate tuple and replays the first response', async () => {
    const queryId = '10000000-0000-4000-8000-000000000001';
    const request = searchRequest(queryId);
    const first = await repository.executeSearch(request);
    const replay = await repository.executeSearch(request);

    expect(first).toMatchObject({
      ok: true,
      response: {
        query_id: queryId,
        hit_status: 'hit',
        telemetry_status: 'recorded',
        candidates: [{ rank: 1, release_id: RELEASE_ID, script_id: SCRIPT_ID, script_version: 1 }],
      },
    });
    expect(replay).toEqual(first);
    await expect(owner.query(`
      SELECT query_text_redacted, query_text_hash, text_storage_status, request_hash,
             request_hash_key_version, release_id
      FROM public.query_events WHERE query_id = $1
    `, [queryId])).resolves.toMatchObject({
      rows: [{
        query_text_redacted: null,
        query_text_hash: null,
        text_storage_status: 'suppressed',
        request_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        request_hash_key_version: 'hmac-idempotency-v1',
        release_id: RELEASE_ID,
      }],
    });
    await expect(owner.query(`
      SELECT rank, release_id, script_id, script_version, content_hash
      FROM public.candidate_impressions WHERE query_id = $1
    `, [queryId])).resolves.toMatchObject({
      rows: [{
        rank: 1,
        release_id: RELEASE_ID,
        script_id: SCRIPT_ID,
        script_version: 1,
        content_hash: sha256('synthetic-events-content'),
      }],
    });
  });

  it('rejects a reused search query id with a different body before any duplicate business write', async () => {
    const queryId = '10000000-0000-4000-8000-000000000002';
    await expect(repository.executeSearch(searchRequest(queryId))).resolves.toMatchObject({ ok: true });
    const changedHashes = prepareIdempotencyHashes({
      parent_query_id: null,
      interaction_reason: 'original',
      query_text: '不同的合成问题',
      collection_mode: 'synthetic',
      detected_platform: 'qianniu',
      platform: 'qianniu',
      platform_source: 'foreground_process',
      product_context_type: null,
      product_context_ref: null,
      top_k: 3,
    }, IDEMPOTENCY_KEYS);
    await expect(repository.executeSearch(searchRequest(queryId, {
      requestHashes: changedHashes,
      search: { ...searchRequest(queryId).search, normalizedQuery: '不同的合成问题' },
    }))).resolves.toEqual({ ok: false, code: 'CONFLICT' });
    const count = await owner.query<{ count: string }>(
      'SELECT pg_catalog.count(*) FROM public.query_events WHERE query_id = $1',
      [queryId],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('replays through the stored HMAC version after the current key rotates', async () => {
    const queryId = '10000000-0000-4000-8000-000000000009';
    const original = searchRequest(queryId);
    const first = await repository.executeSearch(original);
    const rotated = searchRequest(queryId, {
      requestHashes: prepareIdempotencyHashes({
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
      }, {
        currentVersion: 'hmac-idempotency-v2',
        keys: {
          'hmac-idempotency-v1': IDEMPOTENCY_KEYS.keys['hmac-idempotency-v1'],
          'hmac-idempotency-v2': 'synthetic-events-idempotency-material-0002',
        },
      }),
    });
    await expect(repository.executeSearch(rotated)).resolves.toEqual(first);
  });

  it('enforces terminal parent lineage before accepting a reselection', async () => {
    const parentId = '10000000-0000-4000-8000-000000000003';
    const childId = '10000000-0000-4000-8000-000000000004';
    await expect(repository.executeSearch(searchRequest(parentId))).resolves.toMatchObject({ ok: true });
    const childBody = {
      parent_query_id: parentId,
      interaction_reason: 'reselection',
      query_text: '什么时候发货',
      collection_mode: 'synthetic',
      detected_platform: 'qianniu',
      platform: 'qianniu',
      platform_source: 'foreground_process',
      product_context_type: null,
      product_context_ref: null,
      top_k: 3,
    } as const;
    const child = searchRequest(childId, {
      parentQueryId: parentId,
      interactionReason: 'reselection',
      requestHashes: prepareIdempotencyHashes(childBody, IDEMPOTENCY_KEYS),
    });
    await expect(repository.executeSearch(child)).resolves.toEqual({ ok: false, code: 'CONFLICT' });
    await expect(repository.recordAdoption(
      adoptionRequest(parentId, 'idem-synthetic-parent-terminal'),
    )).resolves.toMatchObject({ ok: true });
    await expect(repository.executeSearch(child)).resolves.toMatchObject({
      ok: true,
      response: { query_id: childId },
    });
  });

  it('serializes concurrent terminal outcomes so exactly one adoption wins', async () => {
    const queryId = '10000000-0000-4000-8000-000000000005';
    await repository.executeSearch(searchRequest(queryId));
    const results = await Promise.all([
      repository.recordAdoption(adoptionRequest(queryId, 'idem-synthetic-terminal-a', 'adopted')),
      repository.recordAdoption(adoptionRequest(queryId, 'idem-synthetic-terminal-b', 'dismissed')),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, code: 'CONFLICT' }]);
    const count = await owner.query<{ count: string }>(
      'SELECT pg_catalog.count(*) FROM public.adoption_events WHERE query_id = $1',
      [queryId],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('replays adoption and keeps escalation auxiliary, stable and non-terminal', async () => {
    const queryId = '10000000-0000-4000-8000-000000000006';
    await repository.executeSearch(searchRequest(queryId));
    const adoption = adoptionRequest(queryId, 'idem-synthetic-adoption-replay');
    const firstAdoption = await repository.recordAdoption(adoption);
    await expect(repository.recordAdoption(adoption)).resolves.toEqual(firstAdoption);

    const firstEscalation = await repository.recordEscalation(
      escalationRequest(queryId, 'idem-synthetic-escalate-a'),
    );
    const repeatedAction = await repository.recordEscalation(
      escalationRequest(queryId, 'idem-synthetic-escalate-b'),
    );
    const secondAction = await repository.recordEscalation(
      escalationRequest(queryId, 'idem-synthetic-escalate-c', 'copy_contact'),
    );
    expect(firstEscalation).toEqual(repeatedAction);
    expect(secondAction).toMatchObject({ ok: true, response: { action: 'copy_contact' } });
    const facts = await owner.query<{ terminals: string; actions: string }>(`
      SELECT
        (SELECT pg_catalog.count(*) FROM public.adoption_events WHERE query_id = $1) AS terminals,
        (SELECT pg_catalog.count(*) FROM public.escalate_actions WHERE query_id = $1) AS actions
    `, [queryId]);
    expect(facts.rows[0]).toEqual({ terminals: '1', actions: '2' });
  });

  it('executes search and adoption through the closed HTTP contract into PostgreSQL', async () => {
    const service = {
      readiness: async () => ({
        database: 'ok' as const,
        schema: 'ok' as const,
        auth: 'not_ready' as const,
        storage: 'not_ready' as const,
        content: 'not_ready' as const,
      }),
      readPolicyFlags: async () => null,
      searchCandidates: async () => ({ ok: false as const, code: 'SOURCE_GATE_NOT_READY' as const }),
      executeSearch: repository.executeSearch,
      recordAdoption: repository.recordAdoption,
      recordEscalation: repository.recordEscalation,
      contentImport: unavailableContentImportRepository(),
      close: async () => undefined,
    } satisfies ServiceRepository;
    const app = createApiApp(
      parseApiRuntimeConfig({
        CUSTOMER_AGENT_PROFILE: 'test',
        AUTH_MODE: 'mock',
        CUSTOMER_AGENT_API_PORT: '0',
        CUSTOMER_AGENT_BUILD_VERSION: '0.3.0-events-pg15',
      }),
      service,
      undefined,
      undefined,
      undefined,
      {
        operation: { execute: repository.executeSearch },
        logHash: LOG_HASH,
        idempotencyHmac: IDEMPOTENCY_KEYS,
      },
      { repository, idempotencyHmac: IDEMPOTENCY_KEYS },
    );
    const headers = {
      'x-mock-user': ACTOR.user_id,
      'x-mock-role': ACTOR.role,
    };
    const queryId = '10000000-0000-4000-8000-000000000010';
    try {
      const search = await app.inject({
        method: 'POST',
        url: '/v1/search',
        headers,
        payload: {
          query_id: queryId,
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
      expect(search.json()).toMatchObject({
        query_id: queryId,
        telemetry_status: 'recorded',
        candidates: [{ script_id: SCRIPT_ID }],
      });
      const adoption = await app.inject({
        method: 'POST',
        url: '/v1/events/adoption',
        headers: { ...headers, 'idempotency-key': 'idem-synthetic-http-pg15-adoption' },
        payload: {
          query_id: queryId,
          outcome: 'adopted',
          chosen_rank: 1,
          chosen_script_id: SCRIPT_ID,
          push_method: 'clipboard',
        },
      });
      expect(adoption.statusCode).toBe(200);
      expect(adoption.json()).toEqual({ ok: true, query_id: queryId });
    } finally {
      await app.close();
    }
  });

  it('returns a stateless search only for telemetry permission failure and leaves zero event state', async () => {
    const queryId = '10000000-0000-4000-8000-000000000007';
    await expect(statelessRepository.executeSearch(searchRequest(queryId))).resolves.toMatchObject({
      ok: true,
      response: { query_id: queryId, telemetry_status: 'collection_disabled' },
    });
    const facts = await owner.query<{ queries: string; impressions: string; idempotency: string }>(`
      SELECT
        (SELECT pg_catalog.count(*) FROM public.query_events WHERE query_id = $1) AS queries,
        (SELECT pg_catalog.count(*) FROM public.candidate_impressions WHERE query_id = $1) AS impressions,
        (SELECT pg_catalog.count(*) FROM public.idempotency_keys
          WHERE scope = '/v1/search' AND idem_key = $1) AS idempotency
    `, [queryId]);
    expect(facts.rows[0]).toEqual({ queries: '0', impressions: '0', idempotency: '0' });
    await expect(repository.recordAdoption(
      adoptionRequest(queryId, 'idem-synthetic-stateless-adoption'),
    )).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    await expect(repository.recordEscalation(
      escalationRequest(queryId, 'idem-synthetic-stateless-escalation'),
    )).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('rolls back source-denied business state, then commits one safe audit in a fresh transaction', async () => {
    await owner.query(`
      SELECT public.suspend_authoritative_source(
        'srcv_synth_events_presale_v1', 'SOURCE_REVOKED',
        'EVD-SYNTHETIC-EVENTS-SUSPENSION', 'synthetic-owner', 'owner'
      )
    `);
    const queryId = '10000000-0000-4000-8000-000000000008';
    const request = searchRequest(queryId);
    await expect(repository.executeSearch(request)).resolves.toEqual({
      ok: false,
      code: 'SOURCE_GATE_NOT_READY',
    });
    const facts = await owner.query<{
      queries: string;
      impressions: string;
      idempotency: string;
      audits: string;
    }>(`
      SELECT
        (SELECT pg_catalog.count(*) FROM public.query_events WHERE query_id = $1) AS queries,
        (SELECT pg_catalog.count(*) FROM public.candidate_impressions WHERE query_id = $1) AS impressions,
        (SELECT pg_catalog.count(*) FROM public.idempotency_keys
          WHERE scope = '/v1/search' AND idem_key = $1) AS idempotency,
        (SELECT pg_catalog.count(*) FROM public.source_denial_audits
          WHERE denial_key = $2 AND reason_code = 'SOURCE_GATE_NOT_READY') AS audits
    `, [queryId, request.sourceDenial.denialKey]);
    expect(facts.rows[0]).toEqual({ queries: '0', impressions: '0', idempotency: '0', audits: '1' });
  });
});
