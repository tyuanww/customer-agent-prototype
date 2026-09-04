import type { Client } from 'pg';
import { normalizeSearchText, unicodeBigramTokens } from '../../../src/search-text.js';
import type {
  G1aContentItem,
  G1aEvaluationPackage,
  G1aSourceBinding,
} from './input-package.js';

export type G1aLoadErrorCode =
  | 'G1A_LOAD_CONTRACT_INVALID'
  | 'G1A_LOAD_GOVERNANCE_HASH_MISMATCH'
  | 'G1A_LOAD_SOURCE_GATE_NOT_READY'
  | 'G1A_LOAD_POSTCONDITION_FAILED';

export class G1aLoadError extends Error {
  readonly code: G1aLoadErrorCode;

  constructor(code: G1aLoadErrorCode) {
    super(code);
    this.name = 'G1aLoadError';
    this.code = code;
  }
}

function fail(code: G1aLoadErrorCode): never {
  throw new G1aLoadError(code);
}

function tokenStream(texts: readonly string[]): string {
  const tokens = texts.flatMap((text) => unicodeBigramTokens(normalizeSearchText(text)));
  return [...new Set(tokens)].join(' ');
}

function fallbackText(item: G1aContentItem): string {
  return normalizeSearchText([
    ...item.questions.map((question) => question.question_text),
    item.title,
    item.answer_text,
  ].join(' '));
}

function sourceBindingFor(
  input: G1aEvaluationPackage,
  item: G1aContentItem,
): G1aSourceBinding {
  const binding = input.manifest.source_bindings.find((candidate) => (
    candidate.domain === item.domain && candidate.source_version_id === item.source_version_id
  ));
  if (!binding) fail('G1A_LOAD_CONTRACT_INVALID');
  return binding;
}

async function assertQuestionHashes(owner: Client, item: G1aContentItem): Promise<void> {
  for (const question of item.questions) {
    const result = await owner.query<{ computed_hash: string; valid: boolean }>(`
      SELECT
        public.content_question_hash($1::jsonb) AS computed_hash,
        public.content_questions_align_intent(
          pg_catalog.jsonb_build_array($1::jsonb),
          $2::text,
          $3::text
        ) AS valid
    `, [JSON.stringify(question), item.intent_taxonomy_version, item.intent_id]);
    const row = result.rows[0];
    if (!row?.valid || row.computed_hash !== question.question_hash) fail('G1A_LOAD_CONTRACT_INVALID');
  }
}

async function governanceHash(
  owner: Client,
  input: G1aEvaluationPackage,
  item: G1aContentItem,
): Promise<string> {
  const binding = sourceBindingFor(input, item);
  const result = await owner.query<{ content_hash: string }>(`
    SELECT public.content_governance_hash(
      $1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text,
      $8::timestamptz, $9::text[], $10::text, $11::text[], $12::timestamptz,
      $13::timestamptz, $14::text, $15::text, $16::text, $17::text[], $18::boolean,
      $19::text, $20::text, $21::text, $22::text, $23::text, $24::text, $25::text,
      $26::text[], $27::jsonb
    ) AS content_hash
  `, [
    item.script_id,
    item.domain,
    item.title,
    item.answer_text,
    binding.source_ref,
    item.source_version_id,
    item.owner_role,
    item.review_due_at,
    [...item.platform_scope],
    item.product_scope_type,
    [...item.product_scope_refs],
    item.effective_from,
    item.effective_to,
    item.intent_taxonomy_version,
    item.intent_id,
    item.risk_level,
    [...item.risk_categories],
    item.has_conflict,
    item.review_mode,
    item.primary_reviewer_id_hash,
    item.primary_reviewer_role,
    item.primary_review_evd,
    item.secondary_reviewer_id_hash,
    item.secondary_reviewer_role,
    item.secondary_review_evd,
    [...item.placeholder_keys],
    JSON.stringify(item.questions),
  ]);
  const computed = result.rows[0]?.content_hash;
  if (!computed) fail('G1A_LOAD_CONTRACT_INVALID');
  return computed;
}

async function insertSourceBindings(owner: Client, input: G1aEvaluationPackage): Promise<void> {
  for (const binding of input.manifest.source_bindings) {
    await owner.query(`
      INSERT INTO public.authoritative_source_versions(
        source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
        use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        'canonical', $6, $7, $8, $9::timestamptz, $10::timestamptz
      )
    `, [
      binding.source_version_id,
      binding.source_ref,
      binding.domain,
      input.manifest.content_snapshot_id,
      binding.snapshot_sha256,
      input.manifest.business_owner_role,
      binding.approval_evd,
      input.manifest.business_owner_subject_hash,
      input.manifest.created_at,
      binding.review_due_at,
    ]);
  }
}

async function insertTaxonomy(owner: Client, input: G1aEvaluationPackage): Promise<void> {
  const versions = new Map<string, Map<string, string>>();
  for (const item of input.content) {
    const entries = versions.get(item.intent_taxonomy_version) ?? new Map<string, string>();
    const existing = entries.get(item.intent_id);
    if (existing !== undefined && existing !== item.intent_label) fail('G1A_LOAD_CONTRACT_INVALID');
    entries.set(item.intent_id, item.intent_label);
    versions.set(item.intent_taxonomy_version, entries);
  }
  for (const [version, entries] of versions) {
    await owner.query(`
      INSERT INTO public.intent_taxonomy_versions(
        intent_taxonomy_version, approval_evd, approved_by, approved_at
      ) VALUES ($1, $2, $3, $4::timestamptz)
    `, [
      version,
      input.manifest.independence_evidence_id,
      input.manifest.business_owner_subject_hash,
      input.manifest.created_at,
    ]);
    for (const [intentId, label] of entries) {
      await owner.query(`
        INSERT INTO public.intent_taxonomy_entries(
          intent_taxonomy_version, intent_id, label, lifecycle
        ) VALUES ($1, $2, $3, 'active')
      `, [version, intentId, label]);
    }
  }
}

async function insertSemanticAssets(owner: Client, input: G1aEvaluationPackage): Promise<void> {
  const assets = new Map<string, G1aContentItem['questions'][number]>();
  for (const item of input.content) {
    for (const question of item.questions) {
      const existing = assets.get(question.source_asset_id);
      if (existing && (
        existing.origin_fingerprint !== question.origin_fingerprint
        || existing.origin_fingerprint_key_version !== question.origin_fingerprint_key_version
        || existing.source !== question.source
      )) fail('G1A_LOAD_CONTRACT_INVALID');
      assets.set(question.source_asset_id, question);
    }
  }
  for (const question of assets.values()) {
    await owner.query(`
      INSERT INTO public.semantic_source_assets(
        source_asset_id, source, origin_fingerprint, origin_fingerprint_key_version
      ) VALUES ($1, $2, $3, $4)
    `, [
      question.source_asset_id,
      question.source,
      question.origin_fingerprint,
      question.origin_fingerprint_key_version,
    ]);
  }
}

async function insertRelease(owner: Client, input: G1aEvaluationPackage): Promise<void> {
  await owner.query(`
    INSERT INTO public.content_releases(
      release_id, release_seq, title, status, source_binding_hash,
      published_by, published_by_role, published_at
    ) VALUES ($1, $2, $3, 'published', $4, $5, $6, $7::timestamptz)
  `, [
    input.manifest.release_id,
    input.manifest.release_seq,
    input.manifest.release_title,
    input.manifest.source_binding_hash,
    input.manifest.business_owner_subject_hash,
    input.manifest.business_owner_role,
    input.manifest.created_at,
  ]);
  for (const binding of input.manifest.source_bindings) {
    await owner.query(`
      INSERT INTO public.release_source_bindings(release_id, domain, source_version_id)
      VALUES ($1, $2, $3)
    `, [input.manifest.release_id, binding.domain, binding.source_version_id]);
  }
}

async function insertReleaseItem(
  owner: Client,
  input: G1aEvaluationPackage,
  item: G1aContentItem,
): Promise<void> {
  await assertQuestionHashes(owner, item);
  const computedHash = await governanceHash(owner, input, item);
  if (computedHash !== item.content_hash) fail('G1A_LOAD_GOVERNANCE_HASH_MISMATCH');
  const binding = sourceBindingFor(input, item);
  const questionTokens = tokenStream(item.questions.map((question) => question.question_text));
  const titleTokens = tokenStream([item.title]);
  const answerTokens = tokenStream([item.answer_text]);
  if ([questionTokens, titleTokens, answerTokens].every((tokens) => tokens.length === 0)) {
    fail('G1A_LOAD_CONTRACT_INVALID');
  }

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
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11::timestamptz, $12::timestamptz, $13::timestamptz,
      $14::text[], $15, $16::text[], $17, $18,
      $19, $20::text[], $21, $22, $23,
      $24, $25, $26,
      $27, $28, $29::text[], $30::jsonb,
      pg_catalog.setweight(pg_catalog.to_tsvector('simple', $31), 'A')
        || pg_catalog.setweight(pg_catalog.to_tsvector('simple', $32), 'B')
        || pg_catalog.setweight(pg_catalog.to_tsvector('simple', $33), 'C'),
      $34
    )
  `, [
    input.manifest.release_id,
    item.script_id,
    item.script_version,
    item.content_hash,
    item.answer_text,
    item.title,
    item.domain,
    binding.source_ref,
    item.source_version_id,
    item.owner_role,
    item.review_due_at,
    item.effective_from,
    item.effective_to,
    [...item.platform_scope],
    item.product_scope_type,
    [...item.product_scope_refs],
    item.intent_taxonomy_version,
    item.intent_id,
    item.risk_level,
    [...item.risk_categories],
    item.has_conflict,
    item.review_mode,
    item.primary_reviewer_id_hash,
    item.primary_reviewer_role,
    item.primary_review_evd,
    item.secondary_reviewer_id_hash,
    item.secondary_reviewer_role,
    item.secondary_review_evd,
    [...item.placeholder_keys],
    JSON.stringify(item.questions),
    questionTokens,
    titleTokens,
    answerTokens,
    fallbackText(item),
  ]);
}

async function assertPostconditions(owner: Client, input: G1aEvaluationPackage): Promise<void> {
  const result = await owner.query<{
    current_release_id: string | null;
    source_gate_ready: boolean | null;
    source_binding_hash: string | null;
    item_count: number;
    suspension_count: number;
    governance_mismatch_count: number;
  }>(`
    SELECT
      (SELECT current_release_id FROM public.content_current WHERE id = 1) AS current_release_id,
      (SELECT source_gate_ready FROM public.v_release_source_gate WHERE release_id = $1) AS source_gate_ready,
      (SELECT source_binding_hash FROM public.v_release_source_gate WHERE release_id = $1) AS source_binding_hash,
      (SELECT pg_catalog.count(*)::integer FROM public.release_items WHERE release_id = $1) AS item_count,
      (
        SELECT pg_catalog.count(*)::integer
        FROM public.release_source_bindings binding
        JOIN public.authoritative_source_suspensions suspension
          ON suspension.source_version_id = binding.source_version_id
        WHERE binding.release_id = $1
      ) AS suspension_count,
      (
        SELECT pg_catalog.count(*)::integer
        FROM public.release_items item
        WHERE item.release_id = $1
          AND item.content_hash IS DISTINCT FROM public.content_governance_hash(
            item.script_id, item.category, item.title, item.answer_text, item.source_ref,
            item.source_version_id, item.owner_role, item.review_due_at, item.platform_scope,
            item.product_scope_type, item.product_scope_refs, item.effective_from, item.effective_to,
            item.intent_taxonomy_version, item.intent_id, item.risk_level, item.risk_categories,
            item.has_conflict, item.review_mode, item.primary_reviewer_id, item.primary_reviewer_role,
            item.primary_review_evd, item.secondary_reviewer_id, item.secondary_reviewer_role,
            item.secondary_review_evd, item.placeholder_keys, item.questions_json
          )
      ) AS governance_mismatch_count
  `, [input.manifest.release_id]);
  const row = result.rows[0];
  if (!row || row.source_gate_ready !== true) fail('G1A_LOAD_SOURCE_GATE_NOT_READY');
  if (row.current_release_id !== input.manifest.release_id
    || row.source_binding_hash !== input.manifest.source_binding_hash
    || row.item_count !== input.content.length
    || row.suspension_count !== 0
    || row.governance_mismatch_count !== 0) fail('G1A_LOAD_POSTCONDITION_FAILED');
}

/** Loads one already-verified package as a single immutable evaluation release. */
export async function loadG1aEvaluationRelease(
  owner: Client,
  input: G1aEvaluationPackage,
): Promise<void> {
  await owner.query('BEGIN');
  try {
    await owner.query("SELECT pg_catalog.set_config('app.publishing', 'on', true)");
    await owner.query("SELECT pg_catalog.set_config('app.semantic_asset_write', 'publish', true)");
    await insertSourceBindings(owner, input);
    await insertTaxonomy(owner, input);
    await insertSemanticAssets(owner, input);
    await insertRelease(owner, input);
    for (const item of input.content) await insertReleaseItem(owner, input, item);
    await owner.query(
      'INSERT INTO public.content_current(id, current_release_id) VALUES (1, $1)',
      [input.manifest.release_id],
    );
    await assertPostconditions(owner, input);
    await owner.query('COMMIT');
  } catch (error: unknown) {
    try {
      await owner.query('ROLLBACK');
    } catch {
      // The lifecycle owner still closes the client and destroys the cluster.
    }
    if (error instanceof G1aLoadError) throw error;
    fail('G1A_LOAD_CONTRACT_INVALID');
  }
}
