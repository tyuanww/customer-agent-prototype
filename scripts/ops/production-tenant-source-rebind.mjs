#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { parseStackProfile } from '../synthetic-stack/profile.ts';

const PRODUCTION_STACK_ROOT = '/srv/customer-agent/stack';
const PRODUCTION_EVIDENCE_ROOT = '/srv/customer-agent/catalog-backups/restore-drills';
const RELEASE_PATTERN = /^rel_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/u;
const TENANT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SYNTHETIC_SOURCE_PREFIX = 'srcv_stack_';
const DOMAINS = Object.freeze(['aftersale', 'campaign', 'presale', 'product']);
const MAX_EVIDENCE_BYTES = 1024 * 1024;
const PACKAGE_VERSION = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).version;

export class TenantSourceRebindError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'TenantSourceRebindError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new TenantSourceRebindError(code, message, cause === undefined ? {} : { cause });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sourceBindingHash(sources) {
  return sha256(sources
    .slice()
    .sort((left, right) => compareText(left.domain, right.domain))
    .map((source) => `${source.domain}:${source.sourceVersionId}`)
    .join('|'));
}

function projectedSourceVersionId(sourceVersionId, tenantId) {
  return `srcv_rebind_${sha256(`${sourceVersionId}\0${tenantId}`)}`;
}

export function readEvidence(file, { environment }) {
  let info;
  try {
    info = lstatSync(file);
  } catch {
    fail('BACKUP_EVIDENCE_INVALID', 'backup evidence is missing');
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > MAX_EVIDENCE_BYTES) {
    fail('BACKUP_EVIDENCE_INVALID', 'backup evidence is not a bounded regular file');
  }
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    fail('BACKUP_EVIDENCE_INVALID', 'backup evidence is invalid JSON');
  }
  const restoredAt = Date.parse(evidence?.restoreCompletedAt);
  const backupCompletedAt = Date.parse(evidence?.backupCompletedAt);
  if (evidence?.status !== 'PASS'
    || evidence?.verifierStatus !== 'PASS'
    || evidence?.sourceVerifierStatus !== 'PASS'
    || evidence?.metadataAndObjectFidelity !== 'PASS'
    || evidence?.scratchCleaned !== true
    || evidence?.dataClassification !== 'metadata-only'
    || evidence?.candidateVersion !== PACKAGE_VERSION
    || typeof evidence?.candidateGitSha !== 'string'
    || !/^[0-9a-f]{40}$/u.test(evidence.candidateGitSha)
    || typeof evidence?.backupId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(evidence.backupId)
    || !Number.isFinite(backupCompletedAt)
    || !Number.isFinite(restoredAt)
    || restoredAt < backupCompletedAt
    || restoredAt > Date.now() + 5 * 60_000
    || !Number.isSafeInteger(evidence?.migrationCount)
    || evidence.migrationCount < 1) {
    fail('BACKUP_EVIDENCE_INVALID', 'backup evidence is not a completed restore drill');
  }
  const resolvedFile = path.resolve(file);
  if (environment === 'production') {
    let canonicalFile;
    try {
      canonicalFile = realpathSync(resolvedFile);
    } catch {
      fail('BACKUP_EVIDENCE_INVALID', 'backup evidence path is unreadable');
    }
    if (path.dirname(canonicalFile) !== PRODUCTION_EVIDENCE_ROOT
      || path.basename(canonicalFile)
        !== `candidate-${evidence.candidateGitSha}-${evidence.backupId}.json`) {
      fail('BACKUP_EVIDENCE_INVALID', 'production backup evidence is outside the controlled evidence set');
    }
  }
  return Object.freeze({
    path: resolvedFile,
    backupId: evidence.backupId,
  });
}

export function parseOptions(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv[0] === '--' ? argv.slice(1) : argv,
      allowPositionals: false,
      strict: true,
      options: {
        apply: { type: 'boolean', default: false },
        environment: { type: 'string', default: 'production' },
        'stack-root': { type: 'string', default: PRODUCTION_STACK_ROOT },
        'release-id': { type: 'string' },
        tenant: { type: 'string' },
        'backup-evidence': { type: 'string' },
        authorization: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch {
    fail('INVALID_ARGUMENTS', 'arguments are invalid');
  }
  if (parsed.values.help) return Object.freeze({ help: true });
  const environment = parsed.values.environment;
  const stackRoot = path.resolve(parsed.values['stack-root']);
  const releaseId = parsed.values['release-id'];
  const tenant = parsed.values.tenant;
  const backupEvidence = parsed.values['backup-evidence'];
  const authorization = parsed.values.authorization
    ?? process.env.CUSTOMER_AGENT_TENANT_REBIND_AUTHORIZATION;
  if (!['production', 'test'].includes(environment)
    || !path.isAbsolute(parsed.values['stack-root'])
    || (environment === 'production' && stackRoot !== PRODUCTION_STACK_ROOT)
    || (environment === 'test' && stackRoot === PRODUCTION_STACK_ROOT)
    || typeof releaseId !== 'string' || !RELEASE_PATTERN.test(releaseId)
    || typeof tenant !== 'string' || tenant === 'default' || !TENANT_PATTERN.test(tenant)
    || typeof backupEvidence !== 'string' || !path.isAbsolute(backupEvidence)
    || (authorization !== undefined && typeof authorization !== 'string')) {
    fail('INVALID_ARGUMENTS', 'release, tenant, environment, absolute stack root and backup evidence are required');
  }
  return Object.freeze({
    help: false,
    apply: parsed.values.apply,
    environment,
    stackRoot,
    releaseId,
    tenant,
    backupEvidence: path.resolve(backupEvidence),
    authorization,
  });
}

function readProfile(stackRoot, environment) {
  let canonicalRoot;
  try {
    canonicalRoot = realpathSync(stackRoot);
  } catch {
    fail('STACK_PROFILE_INVALID', 'stack root is unreadable');
  }
  const profilePath = path.join(canonicalRoot, 'profile.json');
  let info;
  try {
    info = lstatSync(profilePath);
  } catch {
    fail('STACK_PROFILE_INVALID', 'stack profile is missing');
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 256 * 1024) {
    fail('STACK_PROFILE_INVALID', 'stack profile is not a bounded regular file');
  }
  let profile;
  try {
    profile = parseStackProfile(JSON.parse(readFileSync(profilePath, 'utf8')), canonicalRoot, profilePath);
  } catch {
    fail('STACK_PROFILE_INVALID', 'stack profile is invalid');
  }
  if (profile.stackRoot !== canonicalRoot
    || (environment === 'production'
      && (profile.environment !== 'production' || profile.databaseName !== 'customer_agent_formal'))
    || (environment === 'test'
      && (profile.environment === 'production' || profile.databaseName === 'customer_agent_formal'))) {
    fail('STACK_PROFILE_INVALID', 'stack profile does not match the requested environment');
  }
  return Object.freeze({
    databaseName: profile.databaseName,
    socket: profile.pgSocketDirectory,
    port: profile.pgPort,
  });
}

async function count(client, sql, values) {
  const result = await client.query(sql, values);
  const value = Number(result.rows[0]?.count);
  if (!Number.isSafeInteger(value) || value < 0) fail('DATABASE_STATE_INVALID', 'database count is invalid');
  return value;
}

export async function inspectTenantSourceRebind(client, { releaseId, tenant }) {
  const current = await client.query(`
    SELECT
      current.current_release_id,
      release.release_seq,
      release.title,
      release.summary,
      release.status,
      release.source_binding_hash,
      release.rollback_of_release_id,
      release.published_by,
      release.published_by_role,
      release.tenant_id
    FROM public.content_current AS current
    JOIN public.content_releases AS release
      ON release.release_id = current.current_release_id
    WHERE current.id = 1
  `);
  const release = current.rows[0];
  const requestedMatchesCurrent = release?.current_release_id === releaseId;
  const requestedMatchesRollbackParent = !requestedMatchesCurrent
    && release?.rollback_of_release_id === releaseId;
  if (!release || release.status !== 'published'
    || (!requestedMatchesCurrent && !requestedMatchesRollbackParent)) {
    fail('RELEASE_STATE_INVALID', 'expected release is not the published current release');
  }
  const targetReleaseId = release.current_release_id;
  if (release.tenant_id === 'default' || release.tenant_id !== tenant) {
    fail('TENANT_STATE_INVALID', 'target tenant does not match the current release tenant');
  }
  if (release.published_by_role !== 'owner'
    || !release.published_by.startsWith('usr_synthetic_')) {
    fail('RELEASE_STATE_INVALID', 'current release is not owned by the synthetic pilot publisher');
  }

  const sourcesResult = await client.query(`
    SELECT
      binding.domain,
      binding.source_version_id,
      source.tenant_id,
      source.use_class,
      source.approved_by
    FROM public.release_source_bindings AS binding
    JOIN public.authoritative_source_versions AS source
      ON source.source_version_id = binding.source_version_id
     AND source.domain = binding.domain
    WHERE binding.release_id = $1
    ORDER BY binding.domain
  `, [targetReleaseId]);
  if (sourcesResult.rows.length !== DOMAINS.length
    || new Set(sourcesResult.rows.map((source) => source.domain)).size !== DOMAINS.length) {
    fail('SOURCE_SET_INVALID', 'current release does not have exactly four source domains');
  }
  const sources = sourcesResult.rows.map((source) => Object.freeze({
    domain: source.domain,
    sourceVersionId: source.source_version_id,
    currentTenant: source.tenant_id,
    useClass: source.use_class,
    approvedBy: source.approved_by,
  }));
  if (sources.some((source) => !(
    source.sourceVersionId.startsWith(SYNTHETIC_SOURCE_PREFIX)
      || (source.currentTenant === tenant && source.sourceVersionId.startsWith('srcv_rebind_'))
  )
    || source.approvedBy !== 'synthetic-owner'
    || source.useClass !== 'canonical')) {
    fail('SOURCE_SET_INVALID', 'this repair is limited to the registered synthetic legacy sources');
  }
  const currentBindingHash = sourceBindingHash(sources);
  if (release.source_binding_hash !== currentBindingHash) {
    fail('SOURCE_SET_INVALID', 'current release source binding hash does not match its bindings');
  }
  if (sources.some((source) => !['default', tenant].includes(source.currentTenant))) {
    fail('SOURCE_TENANT_STATE_INVALID', 'source tenants are neither legacy default nor the target tenant');
  }
  const isReady = sources.every((source) => source.currentTenant === tenant);
  if (!isReady && sources.some((source) => source.currentTenant === tenant)) {
    fail('SOURCE_TENANT_STATE_INVALID', 'source tenant rebind is partially applied');
  }
  if (!isReady && !requestedMatchesCurrent) {
    fail('RELEASE_STATE_INVALID', 'rebind must be requested for the current release');
  }

  const itemCount = await count(client,
    'SELECT count(*)::int AS count FROM public.release_items WHERE release_id = $1',
    [targetReleaseId]);
  const nonSingleCount = await count(client,
    `SELECT count(*)::int AS count
     FROM public.release_items
     WHERE release_id = $1 AND review_mode <> 'single'`,
    [targetReleaseId]);
  if (itemCount < 1 || nonSingleCount !== 0) {
    fail('RELEASE_ITEMS_INVALID', 'source-only rebind requires reviewed single-mode content');
  }
  const missingSourceCount = await count(client, `
    SELECT count(*)::int AS count
    FROM public.release_items AS item
    LEFT JOIN public.release_source_bindings AS binding
      ON binding.release_id = item.release_id
     AND binding.domain = item.category
     AND binding.source_version_id = item.source_version_id
    WHERE item.release_id = $1 AND binding.source_version_id IS NULL
  `, [targetReleaseId]);
  if (missingSourceCount !== 0) {
    fail('RELEASE_ITEMS_INVALID', 'release items do not map to their four-domain source set');
  }
  const suspendedSourceCount = await count(client, `
    SELECT count(*)::int AS count
    FROM public.authoritative_source_suspensions target
    JOIN public.release_source_bindings binding
      ON binding.source_version_id = target.source_version_id
    WHERE binding.release_id = $1
  `, [targetReleaseId]);
  if (suspendedSourceCount !== 0) {
    fail('SOURCE_SET_INVALID', 'current release contains a suspended source');
  }

  const catalog = await client.query(`
    SELECT format_version, sop_nodes, sop_edges, media
    FROM content_intake.release_catalogs
    WHERE release_id = $1
  `, [targetReleaseId]);
  const announcements = await client.query(`
    SELECT title, summary, created_at
    FROM public.announcements
    WHERE release_id = $1
    ORDER BY announcement_id
  `, [targetReleaseId]);
  if (catalog.rows.length !== 1 || announcements.rows.length < 1) {
    fail('RELEASE_STATE_INVALID', 'current release must have one catalog and at least one announcement');
  }
  const lineageCount = await count(client,
    'SELECT count(*)::int AS count FROM content_intake.release_lineage WHERE release_id = $1',
    [targetReleaseId]);
  const rollbackLineageCount = await count(client,
    'SELECT count(*)::int AS count FROM content_intake.release_rollback_lineage WHERE release_id = $1',
    [targetReleaseId]);
  const publicationCount = await count(client,
    'SELECT count(*)::int AS count FROM content_intake.publications WHERE release_id = $1',
    [targetReleaseId]);
  const revocationCount = await count(client,
    'SELECT count(*)::int AS count FROM content_intake.release_revocations WHERE release_id = $1',
    [targetReleaseId]);
  if (publicationCount !== 0 || revocationCount !== 0) {
    fail('RELEASE_STATE_INVALID',
      'publication identity and revoked approvals require a domain-specific repair');
  }

  const maxSeq = Number((await client.query(
    'SELECT coalesce(max(release_seq), 0)::bigint AS value FROM public.content_releases',
  )).rows[0]?.value);
  if (!Number.isSafeInteger(maxSeq) || maxSeq < release.release_seq) {
    fail('DATABASE_STATE_INVALID', 'release sequence state is invalid');
  }
  const sourceMap = sources.map((source) => Object.freeze({
    ...source,
    nextSourceVersionId: projectedSourceVersionId(source.sourceVersionId, tenant),
  }));
  return Object.freeze({
    status: isReady ? 'ready' : 'rebind-required',
    releaseId: targetReleaseId,
    releaseSeq: release.release_seq,
    tenantId: release.tenant_id,
    itemCount,
    sourceCount: sources.length,
    catalogCount: catalog.rows.length,
    announcementCount: announcements.rows.length,
    lineageCount,
    rollbackLineageCount,
    projectedReleaseId: isReady ? targetReleaseId : `rel_${String(maxSeq + 1)}`,
    projectedReleaseSeq: isReady ? release.release_seq : maxSeq + 1,
    sources: Object.freeze(sourceMap.map((source) => Object.freeze({
      domain: source.domain,
      currentSourceVersionId: source.sourceVersionId,
      nextSourceVersionId: isReady ? source.sourceVersionId : source.nextSourceVersionId,
    }))),
    release,
    sourceMap: Object.freeze(sourceMap),
    catalog: Object.freeze(catalog.rows),
    announcements: Object.freeze(announcements.rows),
  });
}

export async function applyTenantSourceRebind(client, options) {
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('customer-agent-tenant-source-rebind'))");
    await client.query('SELECT current_release_id FROM public.content_current WHERE id = 1 FOR UPDATE');
    const plan = await inspectTenantSourceRebind(client, options);
    if (plan.status === 'ready') {
      await client.query('ROLLBACK');
      return Object.freeze({ status: 'already-ready', plan });
    }

    const mappingRows = plan.sourceMap.map((source) => ({
      old_id: source.sourceVersionId,
      new_id: source.nextSourceVersionId,
      domain: source.domain,
    }));
    await client.query(`
      CREATE TEMP TABLE customer_agent_source_rebind_map (
        old_id TEXT PRIMARY KEY,
        new_id TEXT NOT NULL UNIQUE,
        domain TEXT NOT NULL
      ) ON COMMIT DROP
    `);
    await client.query(`
      INSERT INTO customer_agent_source_rebind_map(old_id, new_id, domain)
      SELECT old_id, new_id, domain
      FROM pg_catalog.jsonb_to_recordset($1::jsonb)
        AS source(old_id TEXT, new_id TEXT, domain TEXT)
    `, [JSON.stringify(mappingRows)]);

    await client.query(`
      INSERT INTO public.authoritative_source_versions(
        tenant_id, source_version_id, source_ref, domain, upstream_version,
        snapshot_sha256, use_class, owner_role, approval_evd, approved_by,
        approved_at, review_due_at
      )
      SELECT
        $1, mapped.new_id, source.source_ref, source.domain, source.upstream_version,
        source.snapshot_sha256, source.use_class, source.owner_role,
        source.approval_evd, source.approved_by, source.approved_at, source.review_due_at
      FROM customer_agent_source_rebind_map AS mapped
      JOIN public.authoritative_source_versions AS source
        ON source.source_version_id = mapped.old_id
       AND source.domain = mapped.domain
      ON CONFLICT (source_version_id) DO NOTHING
    `, [options.tenant]);
    const cloned = await client.query(`
      SELECT
        mapped.domain AS expected_domain,
        clone.tenant_id AS next_tenant_id,
        clone.source_ref AS next_source_ref,
        clone.domain AS next_domain,
        clone.upstream_version AS next_upstream_version,
        clone.snapshot_sha256 AS next_snapshot_sha256,
        clone.use_class AS next_use_class,
        clone.owner_role AS next_owner_role,
        clone.approval_evd AS next_approval_evd,
        clone.approved_by AS next_approved_by,
        clone.approved_at AS next_approved_at,
        clone.review_due_at AS next_review_due_at,
        source.source_ref AS previous_source_ref,
        source.upstream_version AS previous_upstream_version,
        source.snapshot_sha256 AS previous_snapshot_sha256,
        source.use_class AS previous_use_class,
        source.owner_role AS previous_owner_role,
        source.approval_evd AS previous_approval_evd,
        source.approved_by AS previous_approved_by,
        source.approved_at AS previous_approved_at,
        source.review_due_at AS previous_review_due_at
      FROM customer_agent_source_rebind_map AS mapped
      JOIN public.authoritative_source_versions AS source
        ON source.source_version_id = mapped.old_id
       AND source.domain = mapped.domain
      JOIN public.authoritative_source_versions AS clone
        ON clone.source_version_id = mapped.new_id
       AND clone.domain = mapped.domain
    `);
    if (cloned.rows.length !== DOMAINS.length
      || cloned.rows.some((source) => source.next_tenant_id !== options.tenant
        || source.next_domain !== source.expected_domain
        || source.next_source_ref !== source.previous_source_ref
        || source.next_upstream_version !== source.previous_upstream_version
        || source.next_snapshot_sha256 !== source.previous_snapshot_sha256
        || source.next_use_class !== source.previous_use_class
        || source.next_owner_role !== source.previous_owner_role
        || source.next_approval_evd !== source.previous_approval_evd
        || source.next_approved_by !== source.previous_approved_by
        || source.next_approved_at.getTime() !== source.previous_approved_at.getTime()
        || source.next_review_due_at.getTime() !== source.previous_review_due_at.getTime())) {
      fail('SOURCE_TENANT_REBIND_FAILED', 'tenant-bound source clones were not created exactly');
    }

    const mappedSources = mappingRows.map((source) => ({
      domain: source.domain,
      sourceVersionId: source.new_id,
    }));
    const nextBindingHash = sourceBindingHash(mappedSources);
    const sequence = await client.query(
      "SELECT nextval('public.content_release_seq')::bigint AS value",
    );
    const releaseSeq = Number(sequence.rows[0]?.value);
    if (!Number.isSafeInteger(releaseSeq) || releaseSeq < 1) {
      fail('DATABASE_STATE_INVALID', 'release sequence allocation failed');
    }
    const nextReleaseId = `rel_${String(releaseSeq)}`;
    await client.query(`
      INSERT INTO public.content_releases(
        release_id, release_seq, title, summary, rollback_of_release_id,
        status, source_binding_hash, published_by, published_by_role,
        published_at, tenant_id
      ) VALUES ($1,$2,$3,$4,$5,'published',$6,$7,$8,clock_timestamp(),$9)
    `, [
      nextReleaseId,
      releaseSeq,
      plan.release.title,
      plan.release.summary,
      plan.releaseId,
      nextBindingHash,
      plan.release.published_by,
      plan.release.published_by_role,
      options.tenant,
    ]);

    await client.query("SELECT set_config('app.publishing', 'on', true)");
    await client.query(`
      INSERT INTO public.release_source_bindings(release_id, domain, source_version_id)
      VALUES ($1, 'aftersale', $2), ($1, 'campaign', $3),
             ($1, 'presale', $4), ($1, 'product', $5)
    `, [
      nextReleaseId,
      mappingRows.find((source) => source.domain === 'aftersale').new_id,
      mappingRows.find((source) => source.domain === 'campaign').new_id,
      mappingRows.find((source) => source.domain === 'presale').new_id,
      mappingRows.find((source) => source.domain === 'product').new_id,
    ]);
    await client.query("SELECT set_config('app.publishing', 'off', true)");

    await client.query(`
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
      )
      SELECT
        $2, item.script_id, item.script_version,
        public.content_governance_hash(
          item.script_id, item.category, item.title, item.answer_text,
          item.source_ref, mapped.new_id, item.owner_role, item.review_due_at,
          item.platform_scope, item.product_scope_type, item.product_scope_refs,
          item.effective_from, item.effective_to, item.intent_taxonomy_version,
          item.intent_id, item.risk_level, item.risk_categories, item.has_conflict,
          item.review_mode, item.primary_reviewer_id, item.primary_reviewer_role,
          item.primary_review_evd, item.secondary_reviewer_id,
          item.secondary_reviewer_role, item.secondary_review_evd,
          item.placeholder_keys, item.questions_json
        ),
        item.answer_text, item.title, item.category, item.source_ref, mapped.new_id,
        item.owner_role, item.review_due_at, item.effective_from, item.effective_to,
        item.platform_scope, item.product_scope_type, item.product_scope_refs,
        item.intent_taxonomy_version, item.intent_id, item.risk_level,
        item.risk_categories, item.has_conflict, item.review_mode,
        item.primary_reviewer_id, item.primary_reviewer_role, item.primary_review_evd,
        item.secondary_reviewer_id, item.secondary_reviewer_role,
        item.secondary_review_evd, item.placeholder_keys, item.questions_json,
        item.search_document, item.search_fallback_text,
        item.owner_acceptance_record_sha256
      FROM public.release_items AS item
      JOIN customer_agent_source_rebind_map AS mapped
        ON mapped.old_id = item.source_version_id
       AND mapped.domain = item.category
      WHERE item.release_id = $1
    `, [plan.releaseId, nextReleaseId]);
    const copiedItems = await count(client,
      'SELECT count(*)::int AS count FROM public.release_items WHERE release_id = $1',
      [nextReleaseId]);
    if (copiedItems !== plan.itemCount) fail('RELEASE_ITEMS_REBIND_FAILED', 'release item copy is incomplete');

    for (const catalog of plan.catalog) {
      await client.query(`
        INSERT INTO content_intake.release_catalogs(
          release_id, format_version, sop_nodes, sop_edges, media
        ) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb)
      `, [
        nextReleaseId,
        catalog.format_version,
        JSON.stringify(catalog.sop_nodes),
        JSON.stringify(catalog.sop_edges),
        JSON.stringify(catalog.media),
      ]);
    }
    await client.query(`
      INSERT INTO content_intake.release_lineage(
        release_id, source_id, business_entry_id, script_version,
        candidate_id, candidate_version, review_request_id,
        content_valid_until, publication_policy
      )
      SELECT
        $2, source_id, business_entry_id, script_version,
        candidate_id, candidate_version, review_request_id,
        content_valid_until, publication_policy
      FROM content_intake.release_lineage
      WHERE release_id = $1
    `, [plan.releaseId, nextReleaseId]);
    await client.query(`
      INSERT INTO content_intake.release_rollback_lineage(release_id, review_request_id)
      SELECT $2, review_request_id
      FROM content_intake.release_rollback_lineage
      WHERE release_id = $1
    `, [plan.releaseId, nextReleaseId]);
    for (const [index, announcement] of plan.announcements.entries()) {
      await client.query(`
        INSERT INTO public.announcements(announcement_id, release_id, title, summary, created_at)
        VALUES ($1,$2,$3,$4,$5)
      `, [
        `ann_${String(releaseSeq)}_rebind_${String(index + 1)}`,
        nextReleaseId,
        announcement.title,
        announcement.summary,
        announcement.created_at,
      ]);
    }
    const copiedCatalogCount = await count(client,
      'SELECT count(*)::int AS count FROM content_intake.release_catalogs WHERE release_id = $1',
      [nextReleaseId]);
    const copiedAnnouncementCount = await count(client,
      'SELECT count(*)::int AS count FROM public.announcements WHERE release_id = $1',
      [nextReleaseId]);
    if (copiedCatalogCount !== plan.catalogCount
      || copiedAnnouncementCount !== plan.announcementCount) {
      fail('RELEASE_METADATA_REBIND_FAILED', 'catalog or announcement copy is incomplete');
    }

    await client.query(
      "UPDATE public.content_releases SET status = 'superseded' WHERE release_id = $1 AND status = 'published'",
      [plan.releaseId],
    );
    const switched = await client.query(`
      UPDATE public.content_current
      SET current_release_id = $2, updated_at = clock_timestamp()
      WHERE id = 1 AND current_release_id = $1
      RETURNING current_release_id
    `, [plan.releaseId, nextReleaseId]);
    if (switched.rows[0]?.current_release_id !== nextReleaseId) {
      fail('CURRENT_RELEASE_SWITCH_FAILED', 'current release changed during tenant source rebind');
    }
    const copiedLineage = await count(client,
      'SELECT count(*)::int AS count FROM content_intake.release_lineage WHERE release_id = $1',
      [nextReleaseId]);
    const copiedRollbackLineage = await count(client,
      'SELECT count(*)::int AS count FROM content_intake.release_rollback_lineage WHERE release_id = $1',
      [nextReleaseId]);
    if (copiedLineage !== plan.lineageCount
      || copiedRollbackLineage !== plan.rollbackLineageCount) {
      fail('RELEASE_LINEAGE_REBIND_FAILED', 'release lineage copy is incomplete');
    }

    await client.query(`
      INSERT INTO public.change_audits(
        change_id, action, actor_role, source, metadata, created_at
      ) VALUES (
        'chg_' || pg_catalog.gen_random_uuid()::text,
        'tenant_source_rebind',
        'system',
        'production-tenant-source-rebind',
        pg_catalog.jsonb_build_object(
          'previous_release_id', $1::text,
          'release_id', $2::text,
          'tenant_id', $3::text,
          'source_count', $4::integer,
          'item_count', $5::integer
        ),
        clock_timestamp()
      )
    `, [plan.releaseId, nextReleaseId, options.tenant, DOMAINS.length, copiedItems]);
    await client.query('COMMIT');
    return Object.freeze({
      status: 'rebound',
      previousReleaseId: plan.releaseId,
      releaseId: nextReleaseId,
      releaseSeq,
      tenantId: options.tenant,
      sourceCount: DOMAINS.length,
      itemCount: copiedItems,
      catalogCount: copiedCatalogCount,
      announcementCount: copiedAnnouncementCount,
      lineageCount: copiedLineage,
      rollbackLineageCount: copiedRollbackLineage,
      backupId: options.backupId,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof TenantSourceRebindError) throw error;
    fail('TENANT_SOURCE_REBIND_FAILED', 'tenant source rebind transaction failed', error);
  }
}

async function main() {
  let options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'FAIL', code: error?.code ?? 'INVALID_ARGUMENTS' })}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write([
      'Usage: node scripts/ops/production-tenant-source-rebind.mjs',
      '  --release-id rel_N --tenant tenant-id --backup-evidence /absolute/path.json',
      '  [--environment production|test] [--stack-root /srv/customer-agent/stack]',
      '  [--apply --authorization rel_N:tenant-id:backup-id]',
      '',
      'Dry-run is the default. This tool only rebinds registered synthetic legacy sources.',
      '',
    ].join('\n'));
    return 0;
  }
  let profile;
  let evidence;
  try {
    profile = readProfile(options.stackRoot, options.environment);
    evidence = readEvidence(options.backupEvidence, { environment: options.environment });
    if (options.environment === 'production' && options.apply
      && options.authorization !== `${options.releaseId}:${options.tenant}:${evidence.backupId}`) {
      fail('REBIND_NOT_AUTHORIZED', 'apply authorization does not match release, tenant and backup');
    }
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'FAIL', code: error?.code ?? 'INVALID_ARGUMENTS' })}\n`);
    return 2;
  }
  const client = new pg.Client({
    host: profile.socket,
    port: profile.port,
    database: profile.databaseName,
    user: 'stack_owner',
    application_name: 'customer-agent-tenant-source-rebind',
    connectionTimeoutMillis: 15_000,
  });
  try {
    await client.connect();
    if (!options.apply) {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const plan = await inspectTenantSourceRebind(client, options);
      await client.query('ROLLBACK');
      process.stdout.write(`${JSON.stringify({
        status: 'dry-run',
        databaseName: profile.databaseName,
        backupId: evidence.backupId,
        ...plan,
        release: undefined,
        sourceMap: undefined,
        catalog: undefined,
        announcements: undefined,
      })}\n`);
      return 0;
    }
    const result = await applyTenantSourceRebind(client, {
      releaseId: options.releaseId,
      tenant: options.tenant,
      backupId: evidence.backupId,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'FAIL', code: error?.code ?? 'TENANT_SOURCE_REBIND_FAILED' })}\n`);
    return 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  process.exitCode = await main();
}
