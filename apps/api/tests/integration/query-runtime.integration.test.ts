import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import {
  materializeSopReleaseFacts,
  type SopAuthoringDocument,
} from '@customer-agent/content-intake';
import { createIntakePurposePool, type IntakePurposePool } from '../../src/content-intake/runtime-pool.js';
import { publishSopReleaseFacts } from '../../src/content-intake/publication.js';
import {
  createApiQueryRuntime,
  type QueryObservation,
} from '../../src/integration/query-runtime.js';
import { createPostgresAccessEvaluator } from '../../src/integration/access.js';
import {
  createPostgresCurrentReleaseIdentityReader,
  createPostgresQueryReleaseLoader,
} from '../../src/integration/release.js';
import { assembleTrace, serializeAssembledTrace } from '../../src/observability/index.js';
import type { PreparedSearchOperation } from '../../src/search-routes.js';
import { seedIntakeSyntheticHost } from '../support/intake-synthetic-seed.js';

const enabled = process.env.CUSTOMER_AGENT_INT_API_PG15_INTEGRATION === '1';

function request(queryText = '合成发货时效'): PreparedSearchOperation {
  return {
    actor: {
      user_id: 'user-agent',
      role: 'agent',
      auth_mode: 'mock',
    } as never,
    requestId: 'pg15-request-001',
    queryId: '10000000-0000-4000-8000-000000000001',
    parentQueryId: null,
    interactionReason: 'original',
    collectionMode: 'synthetic',
    detectedPlatform: 'qianniu',
    platformSource: 'manual',
    search: {
      normalizedQuery: queryText,
      platform: 'qianniu',
      productContextType: null,
      productContextRef: null,
      topK: 3,
    },
    queryTextRedacted: queryText,
    retainQueryText: false,
    redactionPolicyVersion: 'synthetic-redaction-v1',
    queryHash: 'a'.repeat(64),
    queryHashKeyVersion: 'hmac-log-v1',
    productContextRefHash: null,
    requestHashes: {
      currentVersion: 'hmac-idempotency-v1',
      hashes: { 'hmac-idempotency-v1': 'b'.repeat(64) },
    },
    sourceDenial: {
      denialKey: `sda_${'c'.repeat(64)}`,
      actorSubjectHash: 'd'.repeat(64),
      hashKeyVersion: 'hmac-log-v1',
      diagnosticId: `diag_${'e'.repeat(32)}`,
    },
  };
}

describe.runIf(enabled).sequential('INT-API query runtime PostgreSQL 15', () => {
  let harness: Pg15Harness;
  let admin: Client;
  let business: IntakePurposePool;
  let usage: IntakePurposePool;
  const observations: QueryObservation[] = [];

  beforeAll(async () => {
    harness = new Pg15Harness();
    harness.start();
    const database = harness.createDatabase('int_api_query_runtime');
    admin = await harness.connect(database.config);
    await applyDatabaseMigrations(admin);
    await seedIntakeSyntheticHost(admin, 'presale');
    await admin.query(`
      INSERT INTO public.intent_taxonomy_versions(
        intent_taxonomy_version, approval_evd, approved_by, approved_at
      ) VALUES ('itax_int_api_v1', 'EVD-SYNTHETIC-INT-API', 'synthetic-owner', clock_timestamp())
    `);
    await admin.query(`
      INSERT INTO public.intent_taxonomy_entries(
        intent_taxonomy_version, intent_id, label, lifecycle
      ) VALUES ('itax_int_api_v1', 'intent_shipping', '合成发货意图', 'active')
    `);
    const questionBase = {
      question_id: 'q_int_api_shipping_01',
      question_version: 1,
      question_text: '什么时候发货',
      semantic_family_id: 'sf_int_api_shipping_01',
      origin_fingerprint: 'a'.repeat(64),
      origin_fingerprint_key_version: 'hmac-int-api-v1',
      source_asset_id: 'sa_int_api_shipping_01',
      source: 'manual',
      intent_taxonomy_version: 'itax_int_api_v1',
      intent_id: 'intent_shipping',
    };
    await admin.query("SELECT set_config('app.semantic_asset_write', 'publish', false)");
    await admin.query(`
      INSERT INTO public.semantic_source_assets(
        source_asset_id, source, origin_fingerprint, origin_fingerprint_key_version
      ) VALUES ($1, 'manual', $2, 'hmac-int-api-v1')
    `, [questionBase.source_asset_id, questionBase.origin_fingerprint]);
    const questionHash = await admin.query<{ question_hash: string }>(
      'SELECT public.content_question_hash($1::jsonb) AS question_hash',
      [JSON.stringify(questionBase)],
    );
    const questions = [{ ...questionBase, question_hash: questionHash.rows[0]!.question_hash }];
    await admin.query(`
      INSERT INTO public.release_items(
        release_id, script_id, script_version, content_hash, answer_text, title, category,
        source_ref, source_version_id, owner_role, review_due_at, effective_from, effective_to,
        platform_scope, product_scope_type, product_scope_refs, intent_taxonomy_version, intent_id,
        risk_level, risk_categories, has_conflict, review_mode, primary_reviewer_id,
        primary_reviewer_role, primary_review_evd, secondary_reviewer_id,
        secondary_reviewer_role, secondary_review_evd, placeholder_keys, questions_json,
        search_document, search_fallback_text
      ) VALUES (
        'rel_native_base', 'faq_int_api', 1, $1, '合成回答：今天发货。', '合成发货时效', 'presale',
        'SRC-SYNTH-PUB-PRESALE', 'srcv_pub_presale', 'ROLE-CONTENT-LEAD',
        clock_timestamp() + interval '365 days', clock_timestamp() - interval '1 hour', NULL,
        ARRAY['qianniu','douyin'], 'storewide', ARRAY[]::text[],
        'itax_int_api_v1', 'intent_shipping', 'low', ARRAY[]::text[], FALSE, 'single', $2,
        'ROLE-CONTENT-LEAD', 'EVD-SYNTHETIC-INT-API', NULL, NULL, NULL,
        ARRAY[]::text[], $3::jsonb, to_tsvector('simple', '合成发货时效'), '合成发货时效'
      )
    `, [
      createHash('sha256').update('synthetic-int-api-content').digest('hex'),
      createHash('sha256').update('synthetic-int-api-review').digest('hex'),
      JSON.stringify(questions),
    ]);
    await admin.query(`CREATE ROLE int_api_business LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`CREATE ROLE int_api_usage LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query('GRANT intake_business TO int_api_business');
    await admin.query('GRANT intake_usage TO int_api_usage');
    business = createIntakePurposePool({
      ...database.config,
      user: 'int_api_business',
      max: 2,
    }, 'business');
    usage = createIntakePurposePool({
      ...database.config,
      user: 'int_api_usage',
      max: 2,
    }, 'usage');
  }, 120_000);

  afterAll(async () => {
    await business?.end();
    await usage?.end();
    await admin?.end();
    harness?.stop();
  }, 60_000);

  it('prebuilds once, maps legacy ACL domains, and returns only the authorized source item', async () => {
    const access = createPostgresAccessEvaluator(business);
    const activationErrors: unknown[] = [];
    const runtime = createApiQueryRuntime({
      loader: createPostgresQueryReleaseLoader(usage),
      access,
      observer: { record: (observation) => observations.push(observation) },
      currentRelease: createPostgresCurrentReleaseIdentityReader(usage),
      onActivationFailure: (error) => activationErrors.push(error),
    });

    const initialized = await runtime.initialize();
    expect(activationErrors).toEqual([]);
    expect(initialized).toBe(true);
    const result = await runtime.search(request());
    expect(result).toMatchObject({
      ok: true,
      releaseId: 'rel_native_base',
      candidates: [{
        rank: 1,
        script_id: 'faq_int_api',
        answer_text: '合成回答：今天发货。',
      }],
    });
    await runtime.search(request());
    expect(runtime.inspect()).toMatchObject({
      activeReleaseId: 'rel_native_base',
      activationCount: 1,
      queryCount: 2,
    });
    expect(observations[0]?.trace.kind).toBe('ordinary');
    expect(JSON.stringify(observations[0])).not.toContain('合成发货时效');
    await runtime.close();
  }, 60_000);

  it('loads a release-scoped SOP projection and fails closed while the severity gate is open', async () => {
    const document: SopAuthoringDocument = {
      definitions: [{
        sopId: 'synthetic-allergy',
        sceneId: 'synthetic-allergy-scene',
        groupId: 'allergy',
        title: '合成过敏流程',
        entryStepId: 'step1',
        steps: [{
          stepId: 'step1',
          kind: 'ordered',
          sequence: 1,
          parentStepId: null,
          nextStepId: null,
          targetStepId: null,
          title: '步骤一',
          description: '',
        }],
        branches: [],
        messages: [{
          messageId: 'message-step1',
          stepId: 'step1',
          text: '合成步骤话术',
          riskLevel: 'low',
        }],
        resources: [],
        searchEntries: [{
          entryId: 'classify-allergy',
          stepId: 'step1',
          purpose: 'classify',
          text: '过敏流程',
        }],
      }],
    };
    await admin.query('BEGIN');
    try {
      await publishSopReleaseFacts(
        admin as unknown as Parameters<typeof publishSopReleaseFacts>[0],
        materializeSopReleaseFacts(document, 'rel_native_base', null),
      );
      await admin.query('COMMIT');
    } catch (error) {
      await admin.query('ROLLBACK');
      throw error;
    }
    const observations: QueryObservation[] = [];
    const activationErrors: unknown[] = [];
    const observationErrors: unknown[] = [];
    const runtime = createApiQueryRuntime({
      loader: createPostgresQueryReleaseLoader(usage),
      access: createPostgresAccessEvaluator(business),
      observer: { record: (observation) => observations.push(observation) },
      currentRelease: createPostgresCurrentReleaseIdentityReader(usage),
      onActivationFailure: (error) => activationErrors.push(error),
      onObservationFailure: (error) => observationErrors.push(error),
    });
    const initialized = await runtime.initialize();
    expect(activationErrors).toEqual([]);
    expect(initialized).toBe(true);
    await expect(runtime.search(request('过敏流程'))).resolves.toEqual({
      ok: false,
      code: 'OVERLOADED',
      reason: 'SOP_SEVERITY_ORDER_REQUIRED',
    });
    expect(observationErrors).toEqual([]);
    expect(runtime.inspect().queryCount).toBe(0);
    expect(observations.at(-1)?.trace.kind).toBe('sop');
    const observation = observations.at(-1)!;
    expect(() => serializeAssembledTrace(assembleTrace(
      observation.query!,
      observation.stages,
    ))).not.toThrow();
    await runtime.close();
  }, 60_000);

  it('fails closed instead of serving the cached release when current identity moves out of band', async () => {
    const runtime = createApiQueryRuntime({
      loader: createPostgresQueryReleaseLoader(usage),
      access: createPostgresAccessEvaluator(business),
      observer: { record: () => undefined },
      currentRelease: createPostgresCurrentReleaseIdentityReader(usage),
    });
    await runtime.initialize();
    await admin.query('BEGIN');
    try {
      await admin.query("SELECT set_config('app.publishing','on',true)");
      await admin.query(`
        INSERT INTO public.content_releases(
          release_id, release_seq, title, status, source_binding_hash, tenant_id
        )
        SELECT 'rel_out_of_band', release_seq + 1, '外部合成版本', 'published',
          source_binding_hash, tenant_id
        FROM public.content_releases WHERE release_id='rel_native_base'
      `);
      await admin.query(`
        INSERT INTO public.release_source_bindings(release_id, domain, source_version_id)
        SELECT 'rel_out_of_band', domain, source_version_id
        FROM public.release_source_bindings WHERE release_id='rel_native_base'
      `);
      await admin.query(`UPDATE public.content_current SET current_release_id='rel_out_of_band' WHERE id=1`);
      await admin.query('COMMIT');
    } catch (error) {
      await admin.query('ROLLBACK');
      throw error;
    }

    await expect(runtime.search(request())).resolves.toEqual({
      ok: false,
      code: 'OVERLOADED',
    });
    await runtime.close();
  }, 60_000);
});
