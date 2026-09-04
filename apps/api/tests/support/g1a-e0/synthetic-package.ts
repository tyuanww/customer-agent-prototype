import { createHash } from 'node:crypto';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  SYNTHETIC_G1A_CANDIDATES,
  SYNTHETIC_G1A_SOURCE_BINDINGS,
  readSyntheticG1aCases,
} from '../synthetic-g1a.js';
import { g1aComparisonManifestSha256 } from './input-package.js';

const INTENT_TAXONOMY_VERSION = 'itax_synthetic_g1a_e0_v1';
const INTENT_ID = 'intent_synthetic_g1a_e0';
const OWNER_ROLE = 'ROLE-CONTENT-LEAD';
const PRIMARY_REVIEWER = sha256('synthetic-g1a-e0-primary-reviewer');
const REVIEW_DUE_AT = '2099-01-01T00:00:00.000Z';

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function jcs(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
  const record = value as { readonly [key: string]: JsonValue };
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${jcs(record[key]!)}`).join(',')}}`;
}

function jsonLine(value: JsonValue): string {
  return `${jcs(value)}\n`;
}

function jsonLines(values: readonly JsonValue[]): string {
  return values.map((value) => jcs(value)).join('\n') + '\n';
}

function postgresTimestamp(value: string): string {
  return new Date(value).toISOString().replace(/\.(\d{3})Z$/, '.$1000Z');
}

function sourceFor(domain: string): Readonly<{ sourceRef: string; sourceVersionId: string }> {
  const binding = SYNTHETIC_G1A_SOURCE_BINDINGS.find(([bindingDomain]) => bindingDomain === domain);
  if (!binding) throw new Error('SYNTHETIC_G1A_SOURCE_BINDING_MISSING');
  return Object.freeze({ sourceVersionId: binding[1], sourceRef: binding[2] });
}

function questionHash(question: Readonly<Record<string, JsonValue>>): string {
  return sha256(jcs({
    intent_id: question.intent_id!,
    intent_taxonomy_version: question.intent_taxonomy_version!,
    origin_fingerprint: question.origin_fingerprint!,
    origin_fingerprint_key_version: question.origin_fingerprint_key_version!,
    question_id: question.question_id!,
    question_text: question.question_text!,
    question_version: question.question_version!,
    semantic_family_id: question.semantic_family_id!,
    source: question.source!,
    source_asset_id: question.source_asset_id!,
  }));
}

function governanceHash(
  item: Readonly<Record<string, JsonValue>>,
  sourceRef: string,
): string {
  const snapshot: JsonValue = {
    answer_text: item.answer_text!,
    category: item.domain!,
    effective_from: postgresTimestamp(item.effective_from as string),
    effective_to: item.effective_to === null ? null : postgresTimestamp(item.effective_to as string),
    has_conflict: item.has_conflict!,
    intent_id: item.intent_id!,
    intent_taxonomy_version: item.intent_taxonomy_version!,
    owner_role: item.owner_role!,
    placeholder_keys: [...(item.placeholder_keys as readonly string[])].sort(),
    platform_scope: [...(item.platform_scope as readonly string[])].sort(),
    primary_reviewer_id: item.primary_reviewer_id_hash!,
    primary_reviewer_role: item.primary_reviewer_role!,
    primary_review_evd: item.primary_review_evd!,
    product_scope_refs: [...(item.product_scope_refs as readonly string[])].sort(),
    product_scope_type: item.product_scope_type!,
    questions: [...(item.questions as readonly Readonly<Record<string, JsonValue>>[])]
      .sort((left, right) => String(left.question_id).localeCompare(String(right.question_id), 'en')),
    review_due_at: postgresTimestamp(item.review_due_at as string),
    review_mode: item.review_mode!,
    risk_categories: [...(item.risk_categories as readonly string[])].sort(),
    risk_level: item.risk_level!,
    script_id: item.script_id!,
    secondary_reviewer_id: item.secondary_reviewer_id_hash!,
    secondary_reviewer_role: item.secondary_reviewer_role!,
    secondary_review_evd: item.secondary_review_evd!,
    source_ref: sourceRef,
    source_version_id: item.source_version_id!,
    title: item.title!,
  };
  return sha256(jcs(snapshot));
}

function buildContent(sharedSourceRef?: string): readonly Readonly<Record<string, JsonValue>>[] {
  return SYNTHETIC_G1A_CANDIDATES.map((candidate, candidateIndex) => {
    const source = sourceFor(candidate.domain);
    const questions = candidate.searchTerms.map((questionText, questionIndex) => {
      const suffix = `${String(candidateIndex + 1).padStart(2, '0')}_${String(questionIndex + 1).padStart(2, '0')}`;
      const base: Readonly<Record<string, JsonValue>> = {
        question_id: `q_synthetic_g1a_e0_${suffix}`,
        question_version: 1,
        question_text: questionText,
        semantic_family_id: `sf_synthetic_g1a_e0_${String(candidateIndex + 1).padStart(2, '0')}`,
        origin_fingerprint: sha256(`synthetic-g1a-e0-origin-${suffix}`),
        origin_fingerprint_key_version: 'hmac-synthetic-g1a-e0-v1',
        source_asset_id: `sa_synthetic_g1a_e0_${suffix}`,
        source: 'manual',
        intent_taxonomy_version: INTENT_TAXONOMY_VERSION,
        intent_id: INTENT_ID,
      };
      return Object.freeze({ ...base, question_hash: questionHash(base) });
    });
    const validity = candidate.validity ?? 'active';
    const effectiveFrom = validity === 'future' ? '2099-01-01T00:00:00.000Z' : '2020-01-01T00:00:00.000Z';
    const effectiveTo = validity === 'expired' ? '2021-01-01T00:00:00.000Z' : '2100-01-01T00:00:00.000Z';
    const item: Readonly<Record<string, JsonValue>> = {
      script_id: candidate.id,
      script_version: 1,
      content_hash: '0'.repeat(64),
      answer_text: `纯合成回答 ${String(candidateIndex + 1).padStart(2, '0')}，仅用于本机确定性检索验证。`,
      title: candidate.title,
      domain: candidate.domain,
      source_version_id: source.sourceVersionId,
      owner_role: OWNER_ROLE,
      review_due_at: REVIEW_DUE_AT,
      questions,
      platform_scope: [...candidate.platformScope],
      product_scope_type: candidate.productScopeType ?? 'storewide',
      product_scope_refs: [...(candidate.productScopeRefs ?? [])],
      intent_taxonomy_version: INTENT_TAXONOMY_VERSION,
      intent_id: INTENT_ID,
      intent_label: '纯合成检索意图',
      risk_level: 'low',
      risk_categories: [],
      has_conflict: false,
      review_mode: 'single',
      primary_reviewer_id_hash: PRIMARY_REVIEWER,
      primary_reviewer_role: 'ROLE-CONTENT-LEAD',
      primary_review_evd: 'EVD-SYNTHETIC-G1A-E0-REVIEW',
      secondary_reviewer_id_hash: null,
      secondary_reviewer_role: null,
      secondary_review_evd: null,
      placeholder_keys: [],
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
    };
    return Object.freeze({ ...item, content_hash: governanceHash(item, sharedSourceRef ?? source.sourceRef) });
  });
}

function buildCasesAndExpectations(
  now: Date,
): Promise<Readonly<{
  cases: readonly Readonly<Record<string, JsonValue>>[];
  expectations: readonly Readonly<Record<string, JsonValue>>[];
}>> {
  return readSyntheticG1aCases().then((fixture) => {
    const cases = fixture.cases.map((testCase, index) => {
      const suffix = String(index + 1).padStart(3, '0');
      return Object.freeze({
        case_id: `case_g1a_e0_${suffix}`,
        stratum: testCase.stratum,
        query_text: testCase.query_text,
        platform: testCase.platform,
        product_context_type: testCase.product_context_type,
        product_context_ref: testCase.product_context_ref,
        as_of: now.toISOString(),
        core_intent_id: INTENT_ID,
        semantic_cluster_id: `cluster_g1a_e0_${suffix}`,
        source_asset_ids: [`sa_synthetic_g1a_e0_case_${suffix}`],
      });
    });
    const expectations = fixture.cases.map((testCase, index) => Object.freeze({
      case_id: cases[index]!.case_id,
      expected_search_action: testCase.expected_any_top3.length > 0 ? 'top3' : 'no_hit',
      downstream_action: testCase.expected_any_top3.length > 0 ? 'none' : 'escalate',
      acceptable_script_ids: [...testCase.expected_any_top3],
      forbidden_script_ids: [...testCase.forbidden_script_ids],
    }));
    return Object.freeze({ cases: Object.freeze(cases), expectations: Object.freeze(expectations) });
  });
}

export async function createSyntheticG1aE0Package(now = new Date(), sharedWorkbook = false): Promise<Readonly<{
  inputRoot: string;
  expectedManifestSha256: string;
  cleanup: () => Promise<void>;
}>> {
  const createdRoot = await mkdtemp(path.join(os.tmpdir(), 'customer-agent-g1a-e0-input-'));
  await chmod(createdRoot, 0o700);
  // macOS reports /var as a symlink to /private/var. Return the canonical path so
  // the reader can reject caller-controlled symlink aliases without rejecting a
  // package created under the operating system's canonical temporary directory.
  const inputRoot = await realpath(createdRoot);
  try {
    const sharedSourceRef = sharedWorkbook ? 'SRC-SYNTHETIC-SHARED-WORKBOOK' : undefined;
    const content = buildContent(sharedSourceRef);
    const { cases, expectations } = await buildCasesAndExpectations(now);
    const payload = {
      'content.jsonl': jsonLines(content),
      'cases.jsonl': jsonLines(cases),
      'expectations.jsonl': jsonLines(expectations),
    } as const;
    const sourceBindings = SYNTHETIC_G1A_SOURCE_BINDINGS.map(([domain, sourceVersionId, sourceRef]) => ({
      domain,
      source_ref: sharedSourceRef ?? sourceRef,
      source_version_id: sourceVersionId,
      snapshot_sha256: sha256(`synthetic-g1a-e0-source-${domain}`),
      approval_evd: `EVD-SYNTHETIC-G1A-E0-${domain.toUpperCase()}`,
      review_due_at: REVIEW_DUE_AT,
    }));
    const manifest: JsonValue = {
      schema: 'customer-agent/g1a-evaluation-manifest/v2',
      eval_set_id: 'eval_set_synthetic_g1a_e0_v2',
      classification: 'synthetic',
      purpose: 'g1a_search_eval_only',
      release_id: 'rel_synthetic_g1a_e0_v2',
      release_title: '纯合成 G1A-E0 评测发布',
      release_seq: 1,
      content_snapshot_id: 'snapshot_synthetic_g1a_e0_v2',
      content_snapshot_sha256: sha256(payload['content.jsonl']),
      source_binding_hash: sha256(sourceBindings
        .map(({ domain, source_version_id: sourceVersionId }) => `${domain}:${sourceVersionId}`)
        .join('|')),
      created_at: new Date(now.valueOf() - 60_000).toISOString(),
      expires_at: new Date(now.valueOf() + 23 * 60 * 60_000).toISOString(),
      delete_by: new Date(now.valueOf() + 71 * 60 * 60_000).toISOString(),
      dlp_evidence_id: 'EVD-SYNTHETIC-G1A-E0-DLP',
      dlp_evidence_sha256: sha256('synthetic-g1a-e0-dlp-evidence'),
      implementer_subject_hash: sha256('synthetic-g1a-e0-implementer'),
      business_owner_subject_hash: sha256('synthetic-g1a-e0-business-owner'),
      business_owner_role: 'ROLE-CONTENT-LEAD',
      blind_reviewer_subject_hash: sha256('synthetic-g1a-e0-blind-reviewer'),
      blind_reviewer_role: 'ROLE-QA',
      independence_evidence_id: 'EVD-SYNTHETIC-G1A-E0-INDEPENDENCE',
      independence_evidence_sha256: sha256('synthetic-g1a-e0-independence-evidence'),
      source_bindings: sourceBindings,
      comparison_sets: (['dev_synthetic', 'train', 'g1b'] as const).map((set) => {
        const status = set === 'dev_synthetic' ? 'PRESENT' : 'NOT_PRESENT';
        const sampleIds = status === 'PRESENT' ? [`comparison_${set}_sample`] : [];
        const sourceIds = status === 'PRESENT' ? [`comparison_${set}_source`] : [];
        const semanticClusterIds = status === 'PRESENT' ? [`comparison_${set}_cluster`] : [];
        return {
          set,
          status,
          manifest_sha256: g1aComparisonManifestSha256(
            set,
            status,
            sampleIds,
            sourceIds,
            semanticClusterIds,
          ),
          sample_ids: sampleIds,
          source_ids: sourceIds,
          semantic_cluster_ids: semanticClusterIds,
        };
      }),
      files: Object.fromEntries(Object.entries(payload).map(([name, bytes]) => [name, {
        sha256: sha256(bytes),
        bytes: Buffer.byteLength(bytes),
        records: bytes.trimEnd().split('\n').length,
      }])) as JsonValue,
    };
    for (const [name, bytes] of Object.entries(payload)) {
      await writeFile(path.join(inputRoot, name), bytes, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    }
    const manifestText = jsonLine(manifest);
    await writeFile(path.join(inputRoot, 'manifest.json'), manifestText, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    return Object.freeze({
      inputRoot,
      expectedManifestSha256: sha256(manifestText),
      cleanup: () => rm(inputRoot, { recursive: true, force: true }),
    });
  } catch (error: unknown) {
    await rm(inputRoot, { recursive: true, force: true });
    throw error;
  }
}
