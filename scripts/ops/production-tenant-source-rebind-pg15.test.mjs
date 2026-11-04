import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { applyDatabaseMigrations } from '../../packages/database/dist/index.js';
import { Pg15Harness } from '../../packages/database/dist/testkit/index.js';
import {
  applyTenantSourceRebind,
  inspectTenantSourceRebind,
  readEvidence,
} from './production-tenant-source-rebind.mjs';

const enabled = process.env.CUSTOMER_AGENT_TENANT_REBIND_PG15_INTEGRATION === '1';
const productVersion = readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim();
const migrationCount = JSON.parse(
  readFileSync(new URL('../../packages/database/migrations/manifest.generated.json', import.meta.url), 'utf8'),
).migrations.length;
let harness;
let client;

beforeEach(async () => {
  if (!enabled) return;
  harness = new Pg15Harness();
  harness.start();
  const database = harness.createDatabase('tenant_source_rebind');
  client = await harness.connect(database.config);
  await applyDatabaseMigrations(client);
});

afterEach(async () => {
  await client?.end();
  const root = harness?.root;
  harness?.stop();
  if (root) assert.equal(existsSync(root), false);
});

async function seedLegacyRelease({
  approvedBy = 'synthetic-owner',
  publishedBy = 'usr_synthetic_owner',
} = {}) {
  const approvedBySql = client.escapeLiteral(approvedBy);
  const publishedBySql = client.escapeLiteral(publishedBy);
  await client.query(`
    BEGIN;
    INSERT INTO public.authoritative_source_versions(
      tenant_id, source_version_id, source_ref, domain, upstream_version,
      snapshot_sha256, use_class, owner_role, approval_evd, approved_by,
      approved_at, review_due_at
    ) VALUES
      ('default', 'srcv_stack_presale', 'SRC-STACK-PRESALE', 'presale', 'synthetic-stack-v1',
        repeat('1', 64), 'canonical', 'ROLE-CONTENT-LEAD', 'EVD-STACK-SOURCE',
        ${approvedBySql}, clock_timestamp() - interval '1 day', clock_timestamp() + interval '1 year'),
      ('default', 'srcv_stack_campaign', 'SRC-STACK-CAMPAIGN', 'campaign', 'synthetic-stack-v1',
        repeat('2', 64), 'canonical', 'ROLE-CONTENT-LEAD', 'EVD-STACK-SOURCE',
        ${approvedBySql}, clock_timestamp() - interval '1 day', clock_timestamp() + interval '1 year'),
      ('default', 'srcv_stack_aftersale', 'SRC-STACK-AFTERSALE', 'aftersale', 'synthetic-stack-v1',
        repeat('3', 64), 'canonical', 'ROLE-CONTENT-LEAD', 'EVD-STACK-SOURCE',
        ${approvedBySql}, clock_timestamp() - interval '1 day', clock_timestamp() + interval '1 year'),
      ('default', 'srcv_stack_product', 'SRC-STACK-PRODUCT', 'product', 'synthetic-stack-v1',
        repeat('4', 64), 'canonical', 'ROLE-CONTENT-LEAD', 'EVD-STACK-SOURCE',
        ${approvedBySql}, clock_timestamp() - interval '1 day', clock_timestamp() + interval '1 year');
    INSERT INTO public.intent_taxonomy_versions(
      intent_taxonomy_version, approval_evd, approved_by, approved_at
    ) VALUES ('itax_rebind', 'EVD-REBIND', 'synthetic-owner', clock_timestamp());
    INSERT INTO public.intent_taxonomy_entries(
      intent_taxonomy_version, intent_id, label, lifecycle
    ) VALUES ('itax_rebind', 'intent_rebind', 'rebind', 'active');
    WITH source_set AS (
      SELECT encode(digest(convert_to(
        string_agg(domain || ':' || source_version_id, '|' ORDER BY domain COLLATE "C"),
        'UTF8'
      ), 'sha256'), 'hex') AS hash
      FROM public.authoritative_source_versions
      WHERE source_version_id LIKE 'srcv_stack_%'
    )
    INSERT INTO public.content_releases(
      release_id, release_seq, title, summary, status, source_binding_hash,
      published_by, published_by_role, published_at, tenant_id
    )
    SELECT
      'rel_legacy', 7, 'Synthetic legacy', NULL, 'published', hash,
      ${publishedBySql}, 'owner', clock_timestamp() - interval '1 day', 'tenant-menokin'
    FROM source_set;
    SELECT set_config('app.publishing', 'on', false);
    INSERT INTO public.release_source_bindings(release_id, domain, source_version_id)
    VALUES
      ('rel_legacy', 'presale', 'srcv_stack_presale'),
      ('rel_legacy', 'campaign', 'srcv_stack_campaign'),
      ('rel_legacy', 'aftersale', 'srcv_stack_aftersale'),
      ('rel_legacy', 'product', 'srcv_stack_product');
    SELECT set_config('app.publishing', 'off', false);
    SELECT set_config('app.semantic_asset_write', 'publish', false);
    INSERT INTO public.semantic_source_assets(
      source_asset_id, source, origin_fingerprint, origin_fingerprint_key_version
    ) VALUES ('sa_rebind', 'manual', repeat('c', 64), 'synthetic-rebind-v1');
    INSERT INTO public.release_items(
      release_id, script_id, script_version, content_hash, answer_text, title,
      category, source_ref, source_version_id, owner_role, review_due_at,
      effective_from, effective_to, platform_scope, product_scope_type,
      product_scope_refs, intent_taxonomy_version, intent_id, risk_level,
      risk_categories, has_conflict, review_mode, primary_reviewer_id,
      primary_reviewer_role, primary_review_evd, secondary_reviewer_id,
      secondary_reviewer_role, secondary_review_evd, placeholder_keys,
      questions_json, search_document, search_fallback_text,
      owner_acceptance_record_sha256
    ) VALUES (
      'rel_legacy', 'script_rebind', 1, repeat('a', 64), 'synthetic answer', 'Synthetic title',
      'aftersale', 'SRC-STACK-AFTERSALE', 'srcv_stack_aftersale', 'ROLE-CONTENT-LEAD',
      clock_timestamp() + interval '1 year', clock_timestamp() - interval '1 day', NULL,
      ARRAY['qianniu'], 'storewide', ARRAY[]::text[], 'itax_rebind', 'intent_rebind',
      'medium', ARRAY[]::text[], false, 'single', repeat('b', 64),
      'ROLE-CONTENT-LEAD', 'EVD-REBIND', NULL, NULL, NULL, ARRAY[]::text[],
      jsonb_build_array(jsonb_build_object(
        'question_id', 'q_rebind_question',
        'question_version', 1,
        'question_text', 'synthetic question',
        'question_hash', public.content_question_hash(jsonb_build_object(
          'question_id', 'q_rebind_question',
          'question_version', 1,
          'question_text', 'synthetic question',
          'semantic_family_id', 'sf_rebind',
          'origin_fingerprint', repeat('c', 64),
          'origin_fingerprint_key_version', 'synthetic-rebind-v1',
          'source_asset_id', 'sa_rebind',
          'source', 'manual',
          'intent_taxonomy_version', 'itax_rebind',
          'intent_id', 'intent_rebind'
        )),
        'semantic_family_id', 'sf_rebind',
        'origin_fingerprint', repeat('c', 64),
        'origin_fingerprint_key_version', 'synthetic-rebind-v1',
        'source_asset_id', 'sa_rebind',
        'source', 'manual',
        'intent_taxonomy_version', 'itax_rebind',
        'intent_id', 'intent_rebind'
      )),
      to_tsvector('simple', 'synthetic'), 'synthetic', NULL
    );
    INSERT INTO content_intake.release_catalogs(release_id, format_version)
    VALUES ('rel_legacy', 'intake-v2.1');
    INSERT INTO public.announcements(announcement_id, release_id, title, summary)
    VALUES ('ann_legacy', 'rel_legacy', 'Synthetic legacy', NULL);
    INSERT INTO public.content_current(id, current_release_id)
    VALUES (1, 'rel_legacy');
    SELECT setval('public.content_release_seq', 7, true);
    COMMIT;
  `);
}

async function databaseState() {
  return (await client.query(`
    SELECT
      (SELECT count(*)::int FROM public.authoritative_source_versions) AS sources,
      (SELECT count(*)::int FROM public.content_releases) AS releases,
      (SELECT count(*)::int FROM public.release_items) AS items,
      (SELECT count(*)::int FROM content_intake.release_catalogs) AS catalogs,
      (SELECT count(*)::int FROM public.announcements) AS announcements,
      (SELECT count(*)::int FROM content_intake.release_lineage) AS lineage,
      (SELECT count(*)::int FROM content_intake.release_rollback_lineage) AS rollback_lineage
  `)).rows[0];
}

async function promoteLegacyReleaseAsCurrentChild() {
  await client.query(`
    BEGIN;
    SELECT set_config('app.publishing', 'on', true);
    INSERT INTO public.content_releases(
      release_id, release_seq, title, summary, rollback_of_release_id,
      status, source_binding_hash, published_by, published_by_role,
      published_at, tenant_id
    )
    SELECT
      'rel_current', 8, title, summary, release_id,
      'published', source_binding_hash, published_by, published_by_role,
      published_at, tenant_id
    FROM public.content_releases
    WHERE release_id = 'rel_legacy';
    INSERT INTO public.release_source_bindings(release_id, domain, source_version_id)
    SELECT 'rel_current', domain, source_version_id
    FROM public.release_source_bindings
    WHERE release_id = 'rel_legacy';
    INSERT INTO public.release_items
    SELECT (pg_catalog.jsonb_populate_record(
      NULL::public.release_items,
      pg_catalog.to_jsonb(item)
        || pg_catalog.jsonb_build_object('release_id', 'rel_current')
    )).*
    FROM public.release_items AS item
    WHERE item.release_id = 'rel_legacy';
    INSERT INTO content_intake.release_catalogs(
      release_id, format_version, sop_nodes, sop_edges, media
    )
    SELECT 'rel_current', format_version, sop_nodes, sop_edges, media
    FROM content_intake.release_catalogs
    WHERE release_id = 'rel_legacy';
    INSERT INTO public.announcements(announcement_id, release_id, title, summary)
    SELECT 'ann_current', 'rel_current', title, summary
    FROM public.announcements
    WHERE release_id = 'rel_legacy';
    UPDATE public.content_releases SET status = 'superseded' WHERE release_id = 'rel_legacy';
    UPDATE public.content_current SET current_release_id = 'rel_current' WHERE id = 1;
    SELECT setval('public.content_release_seq', 8, true);
    COMMIT;
  `);
}

test('rebinds only synthetic legacy source metadata into a new tenant-consistent release', {
  skip: !enabled,
}, async () => {
  await seedLegacyRelease();
  const beforeDryRun = await databaseState();
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const plan = await inspectTenantSourceRebind(client, {
    releaseId: 'rel_legacy',
    tenant: 'tenant-menokin',
  });
  await client.query('ROLLBACK');
  assert.deepEqual(await databaseState(), beforeDryRun);
  assert.equal(plan.status, 'rebind-required');
  assert.equal(plan.itemCount, 1);
  assert.equal(plan.sourceCount, 4);
  assert.equal(plan.catalogCount, 1);
  assert.equal(plan.announcementCount, 1);

  const result = await applyTenantSourceRebind(client, {
    releaseId: 'rel_legacy',
    tenant: 'tenant-menokin',
    backupId: 'synthetic-backup',
  });
  assert.equal(result.status, 'rebound');
  assert.match(result.releaseId, /^rel_/u);
  const state = await client.query(`
    SELECT
      current.current_release_id,
      release.tenant_id,
      release.rollback_of_release_id,
      (SELECT status FROM public.content_releases WHERE release_id = 'rel_legacy') AS previous_status,
      (SELECT count(*)::int FROM public.release_items WHERE release_id = current.current_release_id) AS item_count,
      (SELECT count(*)::int FROM public.release_source_bindings binding
        JOIN public.authoritative_source_versions source USING (source_version_id, domain)
        WHERE binding.release_id = current.current_release_id
          AND source.tenant_id = 'tenant-menokin') AS source_count,
      (SELECT count(*)::int FROM content_intake.release_catalogs WHERE release_id = current.current_release_id) AS catalog_count,
      (SELECT count(*)::int FROM public.announcements WHERE release_id = current.current_release_id) AS announcement_count,
      (SELECT count(*)::int FROM content_intake.release_lineage WHERE release_id = current.current_release_id) AS lineage_count,
      (SELECT count(*)::int FROM content_intake.release_rollback_lineage WHERE release_id = current.current_release_id) AS rollback_lineage_count
    FROM public.content_current current
    JOIN public.content_releases release ON release.release_id = current.current_release_id
    WHERE current.id = 1
  `);
  assert.deepEqual(state.rows[0], {
    current_release_id: result.releaseId,
    tenant_id: 'tenant-menokin',
    rollback_of_release_id: 'rel_legacy',
    previous_status: 'superseded',
    item_count: 1,
    source_count: 4,
    catalog_count: 1,
    announcement_count: 1,
    lineage_count: 0,
    rollback_lineage_count: 0,
  });
  const item = await client.query(`
    SELECT
      item.content_hash,
      public.content_governance_hash(
        item.script_id, item.category, item.title, item.answer_text,
        item.source_ref, item.source_version_id, item.owner_role, item.review_due_at,
        item.platform_scope, item.product_scope_type, item.product_scope_refs,
        item.effective_from, item.effective_to, item.intent_taxonomy_version,
        item.intent_id, item.risk_level, item.risk_categories, item.has_conflict,
        item.review_mode, item.primary_reviewer_id, item.primary_reviewer_role,
        item.primary_review_evd, item.secondary_reviewer_id,
        item.secondary_reviewer_role, item.secondary_review_evd,
        item.placeholder_keys, item.questions_json
      ) AS expected_hash
    FROM public.release_items item
    WHERE item.release_id = $1
  `, [result.releaseId]);
  assert.equal(item.rows[0].content_hash, item.rows[0].expected_hash);

  const retry = await applyTenantSourceRebind(client, {
    releaseId: 'rel_legacy',
    tenant: 'tenant-menokin',
    backupId: 'synthetic-backup',
  });
  assert.equal(retry.status, 'already-ready');
  assert.equal(retry.plan.releaseId, result.releaseId);
});

test('rejects sources without the registered synthetic owner approval', {
  skip: !enabled,
}, async () => {
  await seedLegacyRelease({ approvedBy: 'registered-human-owner' });
  await assert.rejects(
    applyTenantSourceRebind(client, {
      releaseId: 'rel_legacy',
      tenant: 'tenant-menokin',
      backupId: 'synthetic-backup',
    }),
    { code: 'SOURCE_SET_INVALID' },
  );
});

test('rejects a current release without the synthetic pilot publisher', {
  skip: !enabled,
}, async () => {
  await seedLegacyRelease({ publishedBy: 'usr_registered_owner' });
  await assert.rejects(
    applyTenantSourceRebind(client, {
      releaseId: 'rel_legacy',
      tenant: 'tenant-menokin',
      backupId: 'synthetic-backup',
    }),
    { code: 'RELEASE_STATE_INVALID' },
  );
});

test('rejects a preexisting projected source whose immutable fields differ', {
  skip: !enabled,
}, async () => {
  await seedLegacyRelease();
  const projected = `srcv_rebind_${createHash('sha256')
    .update(`srcv_stack_aftersale\0tenant-menokin`)
    .digest('hex')}`;
  await client.query(`
    INSERT INTO public.authoritative_source_versions(
      tenant_id, source_version_id, source_ref, domain, upstream_version,
      snapshot_sha256, use_class, owner_role, approval_evd, approved_by,
      approved_at, review_due_at
    ) VALUES (
      'tenant-menokin', $1, 'SRC-STACK-AFTERSALE', 'aftersale', 'tampered-v1',
      repeat('3', 64), 'canonical', 'ROLE-CONTENT-LEAD', 'EVD-STACK-SOURCE',
      'synthetic-owner', clock_timestamp() - interval '1 day',
      clock_timestamp() + interval '1 year'
    )
  `, [projected]);
  await assert.rejects(
    applyTenantSourceRebind(client, {
      releaseId: 'rel_legacy',
      tenant: 'tenant-menokin',
      backupId: 'synthetic-backup',
    }),
    { code: 'SOURCE_TENANT_REBIND_FAILED' },
  );
  assert.equal((await databaseState()).releases, 1);
});

test('uses the current release for writes and reserves its parent as a ready retry alias', {
  skip: !enabled,
}, async () => {
  await seedLegacyRelease();
  await promoteLegacyReleaseAsCurrentChild();
  await assert.rejects(
    applyTenantSourceRebind(client, {
      releaseId: 'rel_legacy',
      tenant: 'tenant-menokin',
      backupId: 'synthetic-backup',
    }),
    { code: 'RELEASE_STATE_INVALID' },
  );

  const result = await applyTenantSourceRebind(client, {
    releaseId: 'rel_current',
    tenant: 'tenant-menokin',
    backupId: 'synthetic-backup',
  });
  assert.equal(result.previousReleaseId, 'rel_current');
  assert.equal((await client.query(
    'SELECT count(*)::int AS count FROM public.release_items WHERE release_id = $1',
    [result.releaseId],
  )).rows[0].count, 1);

  const retry = await applyTenantSourceRebind(client, {
    releaseId: 'rel_current',
    tenant: 'tenant-menokin',
    backupId: 'synthetic-backup',
  });
  assert.equal(retry.status, 'already-ready');
  assert.equal(retry.plan.releaseId, result.releaseId);
});

test('accepts only a complete candidate-bound restore drill as evidence', (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'customer-agent-tenant-rebind-evidence-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const backupId = 'customer_agent_formal-20261104T170351Z-001';
  const evidencePath = path.join(
    directory,
    `candidate-${'a'.repeat(40)}-${backupId}.json`,
  );
  const evidence = {
    status: 'PASS',
    verifierStatus: 'PASS',
    sourceVerifierStatus: 'PASS',
    metadataAndObjectFidelity: 'PASS',
    scratchCleaned: true,
    dataClassification: 'metadata-only',
    candidateVersion: productVersion,
    candidateGitSha: 'a'.repeat(40),
    backupId,
    backupCompletedAt: new Date(Date.now() - 60_000).toISOString(),
    restoreCompletedAt: new Date(Date.now() - 30_000).toISOString(),
    migrationCount,
  };
  writeFileSync(evidencePath, JSON.stringify(evidence), { mode: 0o600 });
  assert.equal(readEvidence(evidencePath, { environment: 'test' }).backupId, backupId);

  writeFileSync(evidencePath, JSON.stringify({
    ...evidence,
    candidateVersion: '0.0.0-invalid',
  }), { mode: 0o600 });
  assert.throws(
    () => readEvidence(evidencePath, { environment: 'test' }),
    { code: 'BACKUP_EVIDENCE_INVALID' },
  );
});
