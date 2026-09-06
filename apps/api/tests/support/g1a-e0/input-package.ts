import { validateContractSchema, type components } from '@customer-agent/contracts';
import { ownerReviewInputHash } from './content-identity.js';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

const FILE_NAMES = Object.freeze(['cases.jsonl', 'content.jsonl', 'expectations.jsonl', 'manifest.json'] as const);
const PAYLOAD_NAMES = Object.freeze(['content.jsonl', 'cases.jsonl', 'expectations.jsonl'] as const);
const DOMAINS = Object.freeze(['aftersale', 'campaign', 'presale', 'product'] as const);
const COMPARISON_SETS = Object.freeze(['dev_synthetic', 'train', 'g1b'] as const);
const COMPARISON_STATUSES = Object.freeze(['PRESENT', 'NOT_PRESENT'] as const);
const EVALUATION_MANIFEST_SCHEMA = 'customer-agent/g1a-evaluation-manifest/v2' as const;
const OWNER_MANIFEST_SCHEMA = 'customer-agent/g1a-evaluation-manifest/v3' as const;
const OWNER_FILE = 'owner-acceptance.json';
const OWNER_MAX_BYTES = 2 * 1024 * 1024;
const COMPARISON_MANIFEST_SCHEMA = 'customer-agent/g1a-comparison-manifest/v2' as const;
const SHA256 = /^[0-9a-f]{64}$/;
const OPAQUE_ID = /^[a-z][a-z0-9_-]{7,127}$/;
const EVD_ID = /^EVD-[A-Z0-9-]{6,127}$/;
const ROLE_ID = /^ROLE-[A-Z0-9-]{2,80}$/;
const SOURCE_REF = /^SRC-[A-Z0-9-]{8,127}$/;
const SOURCE_VERSION_ID = /^srcv_[A-Za-z0-9][A-Za-z0-9._-]{7,126}$/;
const QUESTION_ID = /^q_[A-Za-z0-9][A-Za-z0-9_-]{7,126}$/;
const SEMANTIC_FAMILY_ID = /^sf_[A-Za-z0-9][A-Za-z0-9._-]{7,126}$/;
const SOURCE_ASSET_ID = /^sa_[A-Za-z0-9][A-Za-z0-9._-]{7,126}$/;
const TAXONOMY_VERSION = /^itax_[A-Za-z0-9][A-Za-z0-9._-]{7,126}$/;
const INTENT_ID = /^intent_[A-Za-z0-9][A-Za-z0-9._-]{7,126}$/;
const KEY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const OBVIOUS_LEAK_CANARY = /(?:https?|file):\/\/|feishu\.cn|larksuite\.com|(?<![A-Za-z0-9])(?:\+?86[-\s]?)?1[3-9](?:[-\s]?\d){9}(?![A-Za-z0-9])|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?<!\d)[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9X](?!\d)|(?:tenant_access_token|app[_ -]?secret|cli_[a-z0-9]{8,})|(?:订单号|员工号)\s*[:：-]?\s*[A-Za-z0-9-]{6,}/iu;
const MANIFEST_MAX_BYTES = 64 * 1024;
const CONTENT_MAX_BYTES = 32 * 1024 * 1024;
const CASES_MAX_BYTES = 1024 * 1024;
const EXPECTATIONS_MAX_BYTES = 1024 * 1024;
const TOTAL_MAX_BYTES = 35 * 1024 * 1024;
const JSONL_LINE_MAX_BYTES = 1024 * 1024;
const MAX_PACKAGE_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_DELETE_LIFETIME_MS = 72 * 60 * 60 * 1000;
const RISK_CATEGORIES = new Set([
  'refund_compensation', 'price_discount', 'campaign_rules', 'efficacy_safety_claim',
  'account_privacy', 'complaint_escalation', 'legal_commitment',
]);

export type G1aDomain = (typeof DOMAINS)[number];
export type G1aComparisonSetName = (typeof COMPARISON_SETS)[number];
export type G1aComparisonStatus = (typeof COMPARISON_STATUSES)[number];
export type G1aStratum = 'positive' | 'safety_negative' | 'robustness';
export type G1aExpectedSearchAction = 'top3' | 'no_hit';
export type G1aDownstreamAction = 'none' | 'clarify' | 'escalate';
export type G1aSourceBinding = Readonly<{
  domain: G1aDomain; source_ref: string; source_version_id: string; snapshot_sha256: string;
  approval_evd: string; review_due_at: string;
}>;
export type G1aQuestion = Readonly<{
  question_id: string; question_version: number; question_text: string; question_hash: string;
  semantic_family_id: string; origin_fingerprint: string; origin_fingerprint_key_version: string;
  source_asset_id: string; source: 'manual' | 'import'; intent_taxonomy_version: string; intent_id: string;
}>;
export type G1aContentItem = Readonly<{
  script_id: string; script_version: number; content_hash: string; answer_text: string; title: string;
  domain: G1aDomain; source_version_id: string; owner_role: string; review_due_at: string;
  questions: readonly G1aQuestion[]; platform_scope: readonly ('qianniu' | 'douyin')[];
  product_scope_type: 'storewide' | 'category' | 'sku'; product_scope_refs: readonly string[];
  intent_taxonomy_version: string; intent_id: string; intent_label: string;
  risk_level: 'low' | 'medium' | 'high'; risk_categories: readonly string[]; has_conflict: boolean;
  review_mode: 'single' | 'dual' | 'owner_acceptance'; primary_reviewer_id_hash: string;
  owner_acceptance_record_sha256?: string;
  primary_reviewer_role: 'ROLE-CONTENT-LEAD'; primary_review_evd: string;
  secondary_reviewer_id_hash: string | null; secondary_reviewer_role: 'ROLE-CS-MANAGER' | null;
  secondary_review_evd: string | null; placeholder_keys: readonly ('order_id' | 'date')[];
  effective_from: string; effective_to: string | null;
}>;
export type G1aCase = Readonly<{
  case_id: string; stratum: G1aStratum; query_text: string; platform: 'qianniu' | 'douyin';
  product_context_type: 'category' | 'sku' | null; product_context_ref: string | null;
  as_of: string; core_intent_id: string; semantic_cluster_id: string; source_asset_ids: readonly string[];
}>;
export type G1aExpectation = Readonly<{
  case_id: string; expected_search_action: G1aExpectedSearchAction; downstream_action: G1aDownstreamAction;
  acceptable_script_ids: readonly string[]; forbidden_script_ids: readonly string[];
}>;
type PayloadName = (typeof PAYLOAD_NAMES)[number];
type FileDescriptor = Readonly<{ sha256: string; bytes: number; records: number }>;
type ComparisonSet = Readonly<{
  set: G1aComparisonSetName; status: G1aComparisonStatus; manifest_sha256: string; sample_ids: readonly string[];
  source_ids: readonly string[]; semantic_cluster_ids: readonly string[];
}>;
export type G1aManifest = Readonly<{
  schema: typeof EVALUATION_MANIFEST_SCHEMA | typeof OWNER_MANIFEST_SCHEMA; eval_set_id: string;
  classification: 'synthetic' | 'approved_redacted'; purpose: 'g1a_search_eval_only';
  release_id: string; release_title: string; release_seq: number; content_snapshot_id: string;
  content_snapshot_sha256: string; source_binding_hash: string; created_at: string; expires_at: string;
  delete_by: string; dlp_evidence_id: string; dlp_evidence_sha256: string;
  implementer_subject_hash: string; business_owner_subject_hash: string; business_owner_role: string;
  blind_reviewer_subject_hash: string; blind_reviewer_role: string; independence_evidence_id: string;
  independence_evidence_sha256: string; source_bindings: readonly G1aSourceBinding[];
  comparison_sets: readonly ComparisonSet[]; files: Readonly<Record<PayloadName, FileDescriptor> & { 'owner-acceptance.json'?: FileDescriptor }>;
}>;
export type G1aOwnerAcceptance = Readonly<{
  record: components['schemas']['OwnerAcceptanceRecord']; raw_record: string;
  record_sha256: string; expected_owner_subject_hash: string;
}>;
export type G1aEvaluationPackage = Readonly<{
  manifest_sha256: string; manifest: G1aManifest; content: readonly G1aContentItem[];
  cases: readonly G1aCase[]; expectations: readonly G1aExpectation[];
  owner_acceptance?: G1aOwnerAcceptance;
}>;
export type ReadG1aPackageOptions = Readonly<{
  repositoryRoot: string; expectedManifestSha256: string; now?: Date;
  expectedOwnerAcceptanceSha256?: string; expectedOwnerSubjectHash?: string;
}>;
export type G1aInputErrorCode =
  | 'G1A_INPUT_ROOT_INVALID' | 'G1A_INPUT_INSIDE_REPOSITORY' | 'G1A_INPUT_MEMBER_SET_INVALID'
  | 'G1A_INPUT_MEMBER_INSECURE' | 'G1A_INPUT_SIZE_INVALID' | 'G1A_INPUT_FORMAT_INVALID'
  | 'G1A_INPUT_MANIFEST_INVALID' | 'G1A_INPUT_HASH_MISMATCH' | 'G1A_INPUT_CONTENT_INVALID'
  | 'G1A_INPUT_CASE_INVALID' | 'G1A_INPUT_EXPECTATION_INVALID' | 'G1A_INPUT_DENOMINATOR_INVALID'
  | 'G1A_INPUT_INDEPENDENCE_INVALID' | 'G1A_INPUT_LEAK_CANARY' | 'G1A_INPUT_OWNER_ACCEPTANCE_INVALID';

export class G1aInputError extends Error {
  readonly code: G1aInputErrorCode;
  constructor(code: G1aInputErrorCode) { super(code); this.name = 'G1aInputError'; this.code = code; }
}

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
function fail(code: G1aInputErrorCode): never { throw new G1aInputError(code); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exactKeys(value: unknown, keys: readonly string[], code: G1aInputErrorCode): Record<string, unknown> {
  if (!isRecord(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
  return value;
}
function jcs(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
  const record = value as { readonly [key: string]: JsonValue };
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${jcs(record[key]!)}`).join(',')}}`;
}
function canonicalJson(line: string, code: G1aInputErrorCode): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(line);
    if (!isRecord(value) || jcs(value as JsonValue) !== line) fail(code);
    return value;
  } catch (error: unknown) {
    if (error instanceof G1aInputError) throw error;
    fail(code);
  }
}
function requiredString(value: unknown, code: G1aInputErrorCode, options: Readonly<{ pattern?: RegExp; maxCodePoints?: number }> = {}): string {
  if (typeof value !== 'string' || value.length === 0) fail(code);
  if (options.maxCodePoints !== undefined && Array.from(value).length > options.maxCodePoints) fail(code);
  if (options.pattern && !options.pattern.test(value)) fail(code);
  return value;
}
export function hasObviousG1aLeakCanary(value: string): boolean {
  return OBVIOUS_LEAK_CANARY.test(value);
}
function safeText(value: unknown, code: G1aInputErrorCode, maximum: number): string {
  const text = requiredString(value, code, { maxCodePoints: maximum });
  if (hasObviousG1aLeakCanary(text)) fail('G1A_INPUT_LEAK_CANARY');
  return text;
}
function opaqueIdentifier(value: unknown, code: G1aInputErrorCode): string {
  const identifier = requiredString(value, code, { pattern: OPAQUE_ID });
  if (hasObviousG1aLeakCanary(identifier)) fail('G1A_INPUT_LEAK_CANARY');
  return identifier;
}
function isoInstant(value: unknown, code: G1aInputErrorCode): string {
  const raw = requiredString(value, code, { maxCodePoints: 40 });
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== raw) fail(code);
  return raw;
}
function positiveInteger(value: unknown, code: G1aInputErrorCode, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum) fail(code);
  return value as number;
}
function stringArray(value: unknown, code: G1aInputErrorCode, options: Readonly<{ min?: number; max?: number; pattern?: RegExp }> = {}): readonly string[] {
  if (!Array.isArray(value) || value.length < (options.min ?? 0) || value.length > (options.max ?? 100)) fail(code);
  const result = value.map((entry) => requiredString(
    entry,
    code,
    options.pattern ? { pattern: options.pattern } : {},
  ));
  if (new Set(result).size !== result.length) fail(code);
  return Object.freeze(result);
}
function opaqueIdentifierArray(
  value: unknown,
  code: G1aInputErrorCode,
  options: Readonly<{ min?: number; max?: number }> = {},
): readonly string[] {
  const identifiers = stringArray(value, code, { ...options, pattern: OPAQUE_ID });
  if (identifiers.some(hasObviousG1aLeakCanary)) fail('G1A_INPUT_LEAK_CANARY');
  return identifiers;
}
function sha256(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
export function g1aComparisonManifestSha256(
  set: G1aComparisonSetName,
  status: G1aComparisonStatus,
  sampleIds: readonly string[],
  sourceIds: readonly string[],
  semanticClusterIds: readonly string[],
): string {
  return sha256(jcs({
    schema: COMPARISON_MANIFEST_SCHEMA,
    set,
    status,
    sample_ids: [...sampleIds].sort(),
    source_ids: [...sourceIds].sort(),
    semantic_cluster_ids: [...semanticClusterIds].sort(),
  }));
}
function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function decodeUtf8(bytes: Buffer, code: G1aInputErrorCode): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail('G1A_INPUT_FORMAT_INVALID');
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!text.endsWith('\n') || text.endsWith('\n\n') || text.includes('\r')) fail('G1A_INPUT_FORMAT_INVALID');
    return text;
  } catch (error: unknown) {
    if (error instanceof G1aInputError) throw error;
    fail(code);
  }
}
/** Reads one fixed-name private file; callers own the allowed member set and root validation. */
export async function readSecureMember(root: string, name: string, maximum: number): Promise<Buffer> {
  if (path.basename(name) !== name || name === '.' || name === '..') fail('G1A_INPUT_MEMBER_INSECURE');
  try {
    const member = path.join(root, name);
    const before = await lstat(member, { bigint: true });
    const uid = BigInt(process.getuid!());
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.uid !== uid
      || Number(before.mode & 0o777n) !== 0o600) fail('G1A_INPUT_MEMBER_INSECURE');
    if (before.size <= 0n || before.size > BigInt(maximum)) fail('G1A_INPUT_SIZE_INVALID');
    const handle = await open(member, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || opened.nlink !== 1n || opened.uid !== uid || opened.dev !== before.dev
        || opened.ino !== before.ino || opened.size !== before.size || opened.mtimeNs !== before.mtimeNs
        || opened.ctimeNs !== before.ctimeNs) fail('G1A_INPUT_MEMBER_INSECURE');
      const bytes = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
        || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs
        || bytes.byteLength !== Number(opened.size)) fail('G1A_INPUT_MEMBER_INSECURE');
      return bytes;
    } finally { await handle.close(); }
  } catch (error: unknown) {
    if (error instanceof G1aInputError) throw error;
    fail('G1A_INPUT_MEMBER_INSECURE');
  }
}
function parseJsonLines(bytes: Buffer, code: G1aInputErrorCode): readonly Record<string, unknown>[] {
  const text = decodeUtf8(bytes, code);
  const lines = text.slice(0, -1).split('\n');
  if (lines.length === 0 || lines.some((line) => line.length === 0 || Buffer.byteLength(line) > JSONL_LINE_MAX_BYTES)) fail('G1A_INPUT_FORMAT_INVALID');
  return Object.freeze(lines.map((line) => canonicalJson(line, code)));
}
function parseDescriptor(value: unknown, maximum: number): FileDescriptor {
  const record = exactKeys(value, ['sha256', 'bytes', 'records'], 'G1A_INPUT_MANIFEST_INVALID');
  return Object.freeze({
    sha256: requiredString(record.sha256, 'G1A_INPUT_MANIFEST_INVALID', { pattern: SHA256 }),
    bytes: positiveInteger(record.bytes, 'G1A_INPUT_MANIFEST_INVALID', maximum),
    records: positiveInteger(record.records, 'G1A_INPUT_MANIFEST_INVALID', 100_000),
  });
}
function parseSourceBinding(value: unknown): G1aSourceBinding {
  const record = exactKeys(value, ['domain', 'source_ref', 'source_version_id', 'snapshot_sha256', 'approval_evd', 'review_due_at'], 'G1A_INPUT_MANIFEST_INVALID');
  if (!DOMAINS.includes(record.domain as G1aDomain)) fail('G1A_INPUT_MANIFEST_INVALID');
  return Object.freeze({
    domain: record.domain as G1aDomain,
    source_ref: requiredString(record.source_ref, 'G1A_INPUT_MANIFEST_INVALID', { pattern: SOURCE_REF }),
    source_version_id: requiredString(record.source_version_id, 'G1A_INPUT_MANIFEST_INVALID', { pattern: SOURCE_VERSION_ID }),
    snapshot_sha256: requiredString(record.snapshot_sha256, 'G1A_INPUT_MANIFEST_INVALID', { pattern: SHA256 }),
    approval_evd: requiredString(record.approval_evd, 'G1A_INPUT_MANIFEST_INVALID', { pattern: EVD_ID }),
    review_due_at: isoInstant(record.review_due_at, 'G1A_INPUT_MANIFEST_INVALID'),
  });
}
function parseComparison(value: unknown): ComparisonSet {
  const record = exactKeys(value, ['set', 'status', 'manifest_sha256', 'sample_ids', 'source_ids', 'semantic_cluster_ids'], 'G1A_INPUT_INDEPENDENCE_INVALID');
  if (!COMPARISON_SETS.includes(record.set as ComparisonSet['set'])) fail('G1A_INPUT_INDEPENDENCE_INVALID');
  if (!COMPARISON_STATUSES.includes(record.status as ComparisonSet['status'])) fail('G1A_INPUT_INDEPENDENCE_INVALID');
  const set = record.set as G1aComparisonSetName;
  const status = record.status as G1aComparisonStatus;
  const minimumIdentifiers = status === 'PRESENT' ? 1 : 0;
  const sampleIds = opaqueIdentifierArray(record.sample_ids, 'G1A_INPUT_INDEPENDENCE_INVALID', { min: minimumIdentifiers, max: 100_000 });
  const sourceIds = opaqueIdentifierArray(record.source_ids, 'G1A_INPUT_INDEPENDENCE_INVALID', { min: minimumIdentifiers, max: 100_000 });
  const semanticClusterIds = opaqueIdentifierArray(record.semantic_cluster_ids, 'G1A_INPUT_INDEPENDENCE_INVALID', { min: minimumIdentifiers, max: 100_000 });
  if ((status === 'NOT_PRESENT' && (sampleIds.length !== 0 || sourceIds.length !== 0 || semanticClusterIds.length !== 0))
    || (set === 'dev_synthetic' && status !== 'PRESENT')) fail('G1A_INPUT_INDEPENDENCE_INVALID');
  const manifestSha256 = requiredString(record.manifest_sha256, 'G1A_INPUT_INDEPENDENCE_INVALID', { pattern: SHA256 });
  if (manifestSha256 !== g1aComparisonManifestSha256(set, status, sampleIds, sourceIds, semanticClusterIds)) {
    fail('G1A_INPUT_INDEPENDENCE_INVALID');
  }
  return Object.freeze({
    set,
    status,
    manifest_sha256: manifestSha256,
    sample_ids: sampleIds,
    source_ids: sourceIds,
    semantic_cluster_ids: semanticClusterIds,
  });
}
function sourceBindingHash(bindings: readonly G1aSourceBinding[]): string {
  return sha256(bindings.map(({ domain, source_version_id }) => `${domain}:${source_version_id}`).join('|'));
}
function parseManifest(value: unknown, now: Date): G1aManifest {
  const record = exactKeys(value, [
    'schema', 'eval_set_id', 'classification', 'purpose', 'release_id', 'release_title', 'release_seq',
    'content_snapshot_id', 'content_snapshot_sha256', 'source_binding_hash', 'created_at', 'expires_at',
    'delete_by', 'dlp_evidence_id', 'dlp_evidence_sha256', 'implementer_subject_hash',
    'business_owner_subject_hash', 'business_owner_role', 'blind_reviewer_subject_hash',
    'blind_reviewer_role', 'independence_evidence_id', 'independence_evidence_sha256',
    'source_bindings', 'comparison_sets', 'files',
  ], 'G1A_INPUT_MANIFEST_INVALID');
  if (![EVALUATION_MANIFEST_SCHEMA, OWNER_MANIFEST_SCHEMA].includes(record.schema as typeof EVALUATION_MANIFEST_SCHEMA) || record.purpose !== 'g1a_search_eval_only'
    || (record.classification !== 'synthetic' && record.classification !== 'approved_redacted')) fail('G1A_INPUT_MANIFEST_INVALID');
  const createdAt = isoInstant(record.created_at, 'G1A_INPUT_MANIFEST_INVALID');
  const expiresAt = isoInstant(record.expires_at, 'G1A_INPUT_MANIFEST_INVALID');
  const deleteBy = isoInstant(record.delete_by, 'G1A_INPUT_MANIFEST_INVALID');
  const createdMs = Date.parse(createdAt); const expiresMs = Date.parse(expiresAt); const deleteMs = Date.parse(deleteBy);
  if (createdMs > now.valueOf() || now.valueOf() >= expiresMs || expiresMs <= createdMs
    || expiresMs - createdMs > MAX_PACKAGE_LIFETIME_MS || deleteMs < expiresMs
    || deleteMs - createdMs > MAX_DELETE_LIFETIME_MS) fail('G1A_INPUT_MANIFEST_INVALID');
  const implementer = requiredString(record.implementer_subject_hash, 'G1A_INPUT_INDEPENDENCE_INVALID', { pattern: SHA256 });
  const blindReviewer = requiredString(record.blind_reviewer_subject_hash, 'G1A_INPUT_INDEPENDENCE_INVALID', { pattern: SHA256 });
  if (implementer === blindReviewer) fail('G1A_INPUT_INDEPENDENCE_INVALID');
  if (!Array.isArray(record.source_bindings) || record.source_bindings.length !== 4) fail('G1A_INPUT_MANIFEST_INVALID');
  const bindings = Object.freeze(record.source_bindings.map(parseSourceBinding));
  if (bindings.some((binding, index) => binding.domain !== DOMAINS[index])
    || new Set(bindings.map((binding) => binding.source_version_id)).size !== 4
    || bindings.some((binding) => Date.parse(binding.review_due_at) < expiresMs)) fail('G1A_INPUT_MANIFEST_INVALID');
  if (!Array.isArray(record.comparison_sets) || record.comparison_sets.length !== 3) fail('G1A_INPUT_INDEPENDENCE_INVALID');
  const comparisons = Object.freeze(record.comparison_sets.map(parseComparison));
  if (comparisons.some((comparison, index) => comparison.set !== COMPARISON_SETS[index])) fail('G1A_INPUT_INDEPENDENCE_INVALID');
  const ownerMode = record.schema === OWNER_MANIFEST_SCHEMA;
  const fileRecord = exactKeys(record.files, ownerMode ? [...PAYLOAD_NAMES, OWNER_FILE] : PAYLOAD_NAMES, 'G1A_INPUT_MANIFEST_INVALID');
  const files = Object.freeze({
    'content.jsonl': parseDescriptor(fileRecord['content.jsonl'], CONTENT_MAX_BYTES),
    'cases.jsonl': parseDescriptor(fileRecord['cases.jsonl'], CASES_MAX_BYTES),
    'expectations.jsonl': parseDescriptor(fileRecord['expectations.jsonl'], EXPECTATIONS_MAX_BYTES),
    ...(ownerMode ? { 'owner-acceptance.json': parseDescriptor(fileRecord[OWNER_FILE], OWNER_MAX_BYTES) } : {}),
  });
  const bindingHash = requiredString(record.source_binding_hash, 'G1A_INPUT_MANIFEST_INVALID', { pattern: SHA256 });
  if (sourceBindingHash(bindings) !== bindingHash) fail('G1A_INPUT_HASH_MISMATCH');
  return Object.freeze({
    schema: record.schema as G1aManifest['schema'],
    eval_set_id: opaqueIdentifier(record.eval_set_id, 'G1A_INPUT_MANIFEST_INVALID'),
    classification: record.classification, purpose: 'g1a_search_eval_only',
    release_id: opaqueIdentifier(record.release_id, 'G1A_INPUT_MANIFEST_INVALID'),
    release_title: safeText(record.release_title, 'G1A_INPUT_MANIFEST_INVALID', 200),
    release_seq: positiveInteger(record.release_seq, 'G1A_INPUT_MANIFEST_INVALID'),
    content_snapshot_id: opaqueIdentifier(record.content_snapshot_id, 'G1A_INPUT_MANIFEST_INVALID'),
    content_snapshot_sha256: requiredString(record.content_snapshot_sha256, 'G1A_INPUT_MANIFEST_INVALID', { pattern: SHA256 }),
    source_binding_hash: bindingHash, created_at: createdAt, expires_at: expiresAt, delete_by: deleteBy,
    dlp_evidence_id: requiredString(record.dlp_evidence_id, 'G1A_INPUT_MANIFEST_INVALID', { pattern: EVD_ID }),
    dlp_evidence_sha256: requiredString(record.dlp_evidence_sha256, 'G1A_INPUT_MANIFEST_INVALID', { pattern: SHA256 }),
    implementer_subject_hash: implementer,
    business_owner_subject_hash: requiredString(record.business_owner_subject_hash, 'G1A_INPUT_MANIFEST_INVALID', { pattern: SHA256 }),
    business_owner_role: requiredString(record.business_owner_role, 'G1A_INPUT_MANIFEST_INVALID', { pattern: ROLE_ID }),
    blind_reviewer_subject_hash: blindReviewer,
    blind_reviewer_role: requiredString(record.blind_reviewer_role, 'G1A_INPUT_MANIFEST_INVALID', { pattern: ROLE_ID }),
    independence_evidence_id: requiredString(record.independence_evidence_id, 'G1A_INPUT_MANIFEST_INVALID', { pattern: EVD_ID }),
    independence_evidence_sha256: requiredString(record.independence_evidence_sha256, 'G1A_INPUT_MANIFEST_INVALID', { pattern: SHA256 }),
    source_bindings: bindings, comparison_sets: comparisons, files,
  });
}
function parseQuestion(value: unknown): G1aQuestion {
  const record = exactKeys(value, [
    'question_id', 'question_version', 'question_text', 'question_hash', 'semantic_family_id',
    'origin_fingerprint', 'origin_fingerprint_key_version', 'source_asset_id', 'source',
    'intent_taxonomy_version', 'intent_id',
  ], 'G1A_INPUT_CONTENT_INVALID');
  if (record.source !== 'manual' && record.source !== 'import') fail('G1A_INPUT_CONTENT_INVALID');
  return Object.freeze({
    question_id: requiredString(record.question_id, 'G1A_INPUT_CONTENT_INVALID', { pattern: QUESTION_ID }),
    question_version: positiveInteger(record.question_version, 'G1A_INPUT_CONTENT_INVALID', 999_999_999),
    question_text: safeText(record.question_text, 'G1A_INPUT_CONTENT_INVALID', 500),
    question_hash: requiredString(record.question_hash, 'G1A_INPUT_CONTENT_INVALID', { pattern: SHA256 }),
    semantic_family_id: requiredString(record.semantic_family_id, 'G1A_INPUT_CONTENT_INVALID', { pattern: SEMANTIC_FAMILY_ID }),
    origin_fingerprint: requiredString(record.origin_fingerprint, 'G1A_INPUT_CONTENT_INVALID', { pattern: SHA256 }),
    origin_fingerprint_key_version: requiredString(record.origin_fingerprint_key_version, 'G1A_INPUT_CONTENT_INVALID', { pattern: KEY_VERSION }),
    source_asset_id: requiredString(record.source_asset_id, 'G1A_INPUT_CONTENT_INVALID', { pattern: SOURCE_ASSET_ID }),
    source: record.source,
    intent_taxonomy_version: requiredString(record.intent_taxonomy_version, 'G1A_INPUT_CONTENT_INVALID', { pattern: TAXONOMY_VERSION }),
    intent_id: requiredString(record.intent_id, 'G1A_INPUT_CONTENT_INVALID', { pattern: INTENT_ID }),
  });
}
function parseContent(value: unknown, ownerAllowed = false): G1aContentItem {
  const ownerMode = isRecord(value) && value.review_mode === 'owner_acceptance';
  if (ownerMode && !ownerAllowed) fail('G1A_INPUT_CONTENT_INVALID');
  const record = exactKeys(value, [
    'script_id', 'script_version', 'content_hash', 'answer_text', 'title', 'domain', 'source_version_id',
    'owner_role', 'review_due_at', 'questions', 'platform_scope', 'product_scope_type',
    'product_scope_refs', 'intent_taxonomy_version', 'intent_id', 'intent_label', 'risk_level',
    'risk_categories', 'has_conflict', 'review_mode', 'primary_reviewer_id_hash',
    'primary_reviewer_role', 'primary_review_evd', 'secondary_reviewer_id_hash',
    'secondary_reviewer_role', 'secondary_review_evd', 'placeholder_keys', 'effective_from', 'effective_to',
    ...(ownerMode ? ['owner_acceptance_record_sha256'] : []),
  ], 'G1A_INPUT_CONTENT_INVALID');
  if (!DOMAINS.includes(record.domain as G1aDomain) || !['storewide', 'category', 'sku'].includes(record.product_scope_type as string)
    || !['low', 'medium', 'high'].includes(record.risk_level as string) || !['single', 'dual', 'owner_acceptance'].includes(record.review_mode as string)
    || typeof record.has_conflict !== 'boolean' || !Array.isArray(record.questions)
    || record.questions.length < 1 || record.questions.length > 100) fail('G1A_INPUT_CONTENT_INVALID');
  const questions = Object.freeze(record.questions.map(parseQuestion));
  if (new Set(questions.map((question) => question.question_id)).size !== questions.length
    || new Set(questions.map((question) => `${question.origin_fingerprint_key_version}:${question.origin_fingerprint}`)).size !== questions.length) fail('G1A_INPUT_CONTENT_INVALID');
  const platforms = stringArray(record.platform_scope, 'G1A_INPUT_CONTENT_INVALID', { min: 1, max: 2 });
  if (platforms.some((entry) => entry !== 'qianniu' && entry !== 'douyin')) fail('G1A_INPUT_CONTENT_INVALID');
  const productScopeType = record.product_scope_type as G1aContentItem['product_scope_type'];
  const productScopeRefs = opaqueIdentifierArray(record.product_scope_refs, 'G1A_INPUT_CONTENT_INVALID', { max: 100 });
  if ((productScopeType === 'storewide') !== (productScopeRefs.length === 0)) fail('G1A_INPUT_CONTENT_INVALID');
  const taxonomyVersion = requiredString(record.intent_taxonomy_version, 'G1A_INPUT_CONTENT_INVALID', { pattern: TAXONOMY_VERSION });
  const intentId = requiredString(record.intent_id, 'G1A_INPUT_CONTENT_INVALID', { pattern: INTENT_ID });
  if (questions.some((question) => question.intent_taxonomy_version !== taxonomyVersion || question.intent_id !== intentId)) fail('G1A_INPUT_CONTENT_INVALID');
  const riskCategories = stringArray(record.risk_categories, 'G1A_INPUT_CONTENT_INVALID', { max: 7 });
  if (riskCategories.some((category) => !RISK_CATEGORIES.has(category))) fail('G1A_INPUT_CONTENT_INVALID');
  // Match the frozen database risk contract before any PG runtime is created.
  if ((record.risk_level === 'high') !== (riskCategories.length > 0)) fail('G1A_INPUT_CONTENT_INVALID');
  const primaryHash = requiredString(record.primary_reviewer_id_hash, 'G1A_INPUT_CONTENT_INVALID', { pattern: SHA256 });
  const dualRequired = record.risk_level === 'high' || record.has_conflict === true;
  if ((ownerMode ? record.has_conflict !== false : dualRequired !== (record.review_mode === 'dual'))
    || record.primary_reviewer_role !== 'ROLE-CONTENT-LEAD') fail('G1A_INPUT_CONTENT_INVALID');
  let secondaryHash: string | null = null;
  if (record.review_mode === 'dual') {
    secondaryHash = requiredString(record.secondary_reviewer_id_hash, 'G1A_INPUT_CONTENT_INVALID', { pattern: SHA256 });
    if (secondaryHash === primaryHash || record.secondary_reviewer_role !== 'ROLE-CS-MANAGER'
      || typeof record.secondary_review_evd !== 'string' || !EVD_ID.test(record.secondary_review_evd)) fail('G1A_INPUT_CONTENT_INVALID');
  } else if (record.secondary_reviewer_id_hash !== null || record.secondary_reviewer_role !== null || record.secondary_review_evd !== null) fail('G1A_INPUT_CONTENT_INVALID');
  const placeholders = stringArray(record.placeholder_keys, 'G1A_INPUT_CONTENT_INVALID', { max: 2 });
  if (placeholders.some((key) => key !== 'order_id' && key !== 'date')) fail('G1A_INPUT_CONTENT_INVALID');
  const answer = safeText(record.answer_text, 'G1A_INPUT_CONTENT_INVALID', 20_000);
  if (answer.includes('{订单号}') !== placeholders.includes('order_id') || answer.includes('{日期}') !== placeholders.includes('date')
    || answer.replaceAll('{订单号}', '').replaceAll('{日期}', '').match(/[{}]/u)) fail('G1A_INPUT_CONTENT_INVALID');
  const effectiveFrom = isoInstant(record.effective_from, 'G1A_INPUT_CONTENT_INVALID');
  const effectiveTo = record.effective_to === null ? null : isoInstant(record.effective_to, 'G1A_INPUT_CONTENT_INVALID');
  if (record.domain === 'campaign' && effectiveTo === null) fail('G1A_INPUT_CONTENT_INVALID');
  if (effectiveTo !== null && Date.parse(effectiveFrom) >= Date.parse(effectiveTo)) fail('G1A_INPUT_CONTENT_INVALID');
  return Object.freeze({
    script_id: opaqueIdentifier(record.script_id, 'G1A_INPUT_CONTENT_INVALID'),
    script_version: positiveInteger(record.script_version, 'G1A_INPUT_CONTENT_INVALID'),
    content_hash: requiredString(record.content_hash, 'G1A_INPUT_CONTENT_INVALID', { pattern: SHA256 }),
    answer_text: answer, title: safeText(record.title, 'G1A_INPUT_CONTENT_INVALID', 200), domain: record.domain as G1aDomain,
    source_version_id: requiredString(record.source_version_id, 'G1A_INPUT_CONTENT_INVALID', { pattern: SOURCE_VERSION_ID }),
    owner_role: requiredString(record.owner_role, 'G1A_INPUT_CONTENT_INVALID', { pattern: ROLE_ID }),
    review_due_at: isoInstant(record.review_due_at, 'G1A_INPUT_CONTENT_INVALID'), questions,
    platform_scope: platforms as G1aContentItem['platform_scope'], product_scope_type: productScopeType,
    product_scope_refs: productScopeRefs, intent_taxonomy_version: taxonomyVersion, intent_id: intentId,
    intent_label: safeText(record.intent_label, 'G1A_INPUT_CONTENT_INVALID', 200), risk_level: record.risk_level as G1aContentItem['risk_level'],
    risk_categories: riskCategories, has_conflict: record.has_conflict, review_mode: record.review_mode as G1aContentItem['review_mode'],
    ...(ownerMode ? { owner_acceptance_record_sha256: requiredString(record.owner_acceptance_record_sha256, 'G1A_INPUT_CONTENT_INVALID', { pattern: SHA256 }) } : {}),
    primary_reviewer_id_hash: primaryHash, primary_reviewer_role: 'ROLE-CONTENT-LEAD',
    primary_review_evd: requiredString(record.primary_review_evd, 'G1A_INPUT_CONTENT_INVALID', { pattern: EVD_ID }),
    secondary_reviewer_id_hash: secondaryHash, secondary_reviewer_role: record.secondary_reviewer_role as G1aContentItem['secondary_reviewer_role'],
    secondary_review_evd: record.secondary_review_evd as string | null,
    placeholder_keys: placeholders as G1aContentItem['placeholder_keys'], effective_from: effectiveFrom, effective_to: effectiveTo,
  });
}
function parseCase(value: unknown): G1aCase {
  const record = exactKeys(value, ['case_id', 'stratum', 'query_text', 'platform', 'product_context_type', 'product_context_ref', 'as_of', 'core_intent_id', 'semantic_cluster_id', 'source_asset_ids'], 'G1A_INPUT_CASE_INVALID');
  if (!['positive', 'safety_negative', 'robustness'].includes(record.stratum as string) || !['qianniu', 'douyin'].includes(record.platform as string)) fail('G1A_INPUT_CASE_INVALID');
  const contextType = record.product_context_type; const contextRef = record.product_context_ref;
  if (!((contextType === null && contextRef === null) || ((contextType === 'category' || contextType === 'sku')
    && typeof contextRef === 'string'))) fail('G1A_INPUT_CASE_INVALID');
  const parsedContextRef = contextRef === null ? null : opaqueIdentifier(contextRef, 'G1A_INPUT_CASE_INVALID');
  return Object.freeze({
    case_id: opaqueIdentifier(record.case_id, 'G1A_INPUT_CASE_INVALID'), stratum: record.stratum as G1aStratum,
    query_text: safeText(record.query_text, 'G1A_INPUT_CASE_INVALID', 500), platform: record.platform as G1aCase['platform'],
    product_context_type: contextType as G1aCase['product_context_type'], product_context_ref: parsedContextRef,
    as_of: isoInstant(record.as_of, 'G1A_INPUT_CASE_INVALID'), core_intent_id: requiredString(record.core_intent_id, 'G1A_INPUT_CASE_INVALID', { pattern: INTENT_ID }),
    semantic_cluster_id: opaqueIdentifier(record.semantic_cluster_id, 'G1A_INPUT_CASE_INVALID'),
    source_asset_ids: stringArray(record.source_asset_ids, 'G1A_INPUT_CASE_INVALID', { min: 1, max: 100, pattern: SOURCE_ASSET_ID }),
  });
}
function parseExpectation(value: unknown): G1aExpectation {
  const record = exactKeys(value, ['case_id', 'expected_search_action', 'downstream_action', 'acceptable_script_ids', 'forbidden_script_ids'], 'G1A_INPUT_EXPECTATION_INVALID');
  if (!['top3', 'no_hit'].includes(record.expected_search_action as string) || !['none', 'clarify', 'escalate'].includes(record.downstream_action as string)) fail('G1A_INPUT_EXPECTATION_INVALID');
  const action = record.expected_search_action as G1aExpectedSearchAction;
  const acceptable = opaqueIdentifierArray(record.acceptable_script_ids, 'G1A_INPUT_EXPECTATION_INVALID', { max: 100 });
  const forbidden = opaqueIdentifierArray(record.forbidden_script_ids, 'G1A_INPUT_EXPECTATION_INVALID', { max: 100 });
  if ((action === 'top3') !== (acceptable.length > 0) || acceptable.some((id) => forbidden.includes(id))) fail('G1A_INPUT_EXPECTATION_INVALID');
  return Object.freeze({
    case_id: opaqueIdentifier(record.case_id, 'G1A_INPUT_EXPECTATION_INVALID'), expected_search_action: action,
    downstream_action: record.downstream_action as G1aDownstreamAction, acceptable_script_ids: acceptable, forbidden_script_ids: forbidden,
  });
}
function overlaps(left: readonly string[], right: readonly string[]): boolean {
  const rightValues = new Set(right);
  return left.some((value) => rightValues.has(value));
}

function assertPairwiseDisjoint(groups: readonly Readonly<{ samples: readonly string[]; sources: readonly string[]; clusters: readonly string[] }>[]): void {
  for (let left = 0; left < groups.length; left += 1) for (let right = left + 1; right < groups.length; right += 1) {
    const a = groups[left]!; const b = groups[right]!;
    if (overlaps(a.samples, b.samples) || overlaps(a.sources, b.sources) || overlaps(a.clusters, b.clusters)) {
      fail('G1A_INPUT_INDEPENDENCE_INVALID');
    }
  }
}
function validateJoinedPackage(manifest: G1aManifest, content: readonly G1aContentItem[], cases: readonly G1aCase[], expectations: readonly G1aExpectation[]): void {
  if (content.length === 0 || new Set(content.map((item) => item.script_id)).size !== content.length) fail('G1A_INPUT_CONTENT_INVALID');
  const questionIds = content.flatMap((item) => item.questions.map((question) => question.question_id));
  const originIds = content.flatMap((item) => item.questions.map((question) => `${question.origin_fingerprint_key_version}:${question.origin_fingerprint}:${question.question_version}`));
  if (new Set(questionIds).size !== questionIds.length || new Set(originIds).size !== originIds.length) fail('G1A_INPUT_CONTENT_INVALID');
  const assets = new Map<string, string>();
  for (const item of content) {
    const binding = manifest.source_bindings.find((candidate) => candidate.domain === item.domain);
    if (!binding || binding.source_version_id !== item.source_version_id || Date.parse(item.review_due_at) < Date.parse(manifest.expires_at)) fail('G1A_INPUT_CONTENT_INVALID');
    const start = Date.parse(manifest.created_at); const end = Date.parse(manifest.expires_at) - 1;
    const active = (at: number) => Date.parse(item.effective_from) <= at && (item.effective_to === null || at < Date.parse(item.effective_to));
    if (active(start) !== active(end)) fail('G1A_INPUT_CONTENT_INVALID');
    for (const question of item.questions) {
      const identity = `${question.source}:${question.origin_fingerprint_key_version}:${question.origin_fingerprint}`;
      const existing = assets.get(question.source_asset_id);
      if (existing !== undefined && existing !== identity) fail('G1A_INPUT_CONTENT_INVALID');
      assets.set(question.source_asset_id, identity);
    }
  }
  if (cases.length !== 50 || expectations.length !== 50 || cases.filter((item) => item.stratum === 'positive').length !== 20
    || cases.filter((item) => item.stratum === 'safety_negative').length !== 12 || cases.filter((item) => item.stratum === 'robustness').length !== 18
    || new Set(cases.map((item) => item.as_of)).size !== 1) fail('G1A_INPUT_DENOMINATOR_INVALID');
  const caseIds = cases.map((item) => item.case_id);
  if (new Set(caseIds).size !== 50 || expectations.some((item, index) => item.case_id !== caseIds[index])) fail('G1A_INPUT_EXPECTATION_INVALID');
  const scripts = new Set(content.map((item) => item.script_id));
  for (const [index, expectation] of expectations.entries()) {
    if ([...expectation.acceptable_script_ids, ...expectation.forbidden_script_ids].some((id) => !scripts.has(id))) fail('G1A_INPUT_EXPECTATION_INVALID');
    if (cases[index]?.stratum === 'positive' && expectation.expected_search_action !== 'top3') fail('G1A_INPUT_DENOMINATOR_INVALID');
    if (cases[index]?.stratum === 'safety_negative' && (expectation.expected_search_action !== 'no_hit' || expectation.downstream_action === 'none')) fail('G1A_INPUT_DENOMINATOR_INVALID');
  }
  assertPairwiseDisjoint([
    {
      samples: caseIds,
      sources: [...new Set(cases.flatMap((item) => item.source_asset_ids))],
      clusters: [...new Set(cases.map((item) => item.semantic_cluster_id))],
    },
    ...manifest.comparison_sets.map((set) => ({ samples: set.sample_ids, sources: set.source_ids, clusters: set.semantic_cluster_ids })),
  ]);
}

function parseOwnerAcceptance(
  raw: string, manifest: G1aManifest, content: readonly G1aContentItem[], options: ReadG1aPackageOptions,
): G1aOwnerAcceptance {
  const code = 'G1A_INPUT_OWNER_ACCEPTANCE_INVALID';
  if (!options.expectedOwnerAcceptanceSha256 || !SHA256.test(options.expectedOwnerAcceptanceSha256)
    || !options.expectedOwnerSubjectHash || !SHA256.test(options.expectedOwnerSubjectHash)
    || sha256(raw) !== options.expectedOwnerAcceptanceSha256) fail(code);
  const value = canonicalJson(raw.slice(0, -1), code);
  if (!validateContractSchema('OwnerAcceptanceRecord', value).ok) fail(code);
  const record = value as components['schemas']['OwnerAcceptanceRecord'];
  if (record.owner_subject_hash !== options.expectedOwnerSubjectHash
    || record.owner_subject_hash !== manifest.business_owner_subject_hash
    || Date.parse(isoInstant(record.accepted_at, code)) > Date.parse(manifest.created_at)
    || Date.parse(isoInstant(record.expires_at, code)) < Date.parse(manifest.expires_at)) fail(code);
  const ownerItems = content.filter((item) => item.review_mode === 'owner_acceptance');
  if (ownerItems.length === 0 || ownerItems.some((item) => item.owner_acceptance_record_sha256 !== options.expectedOwnerAcceptanceSha256
    || item.primary_reviewer_id_hash !== record.owner_subject_hash
    || item.primary_review_evd !== record.approval_evidence_id)) fail(code);
  const observed = {
    source_bindings: manifest.source_bindings.map(({ domain, source_version_id, snapshot_sha256, review_due_at }) => (
      { domain, source_version_id, snapshot_sha256, review_due_at }
    )),
    items: [...ownerItems].sort((a, b) => a.script_id < b.script_id ? -1 : a.script_id > b.script_id ? 1 : 0).map((item) => {
      const binding = manifest.source_bindings.find((b) => b.domain === item.domain)!;
      return { script_id: item.script_id, script_version: item.script_version, domain: item.domain,
        source_version_id: item.source_version_id, review_input_sha256: ownerReviewInputHash(item, binding.source_ref),
        risk_level: item.risk_level, risk_categories: [...item.risk_categories].sort(), has_conflict: item.has_conflict };
    }),
  };
  if (jcs(record.scope) !== jcs(observed)) fail(code);
  return Object.freeze({ record, raw_record: raw, record_sha256: options.expectedOwnerAcceptanceSha256,
    expected_owner_subject_hash: options.expectedOwnerSubjectHash });
}

export async function readG1aEvaluationPackage(inputRoot: string, options: ReadG1aPackageOptions): Promise<G1aEvaluationPackage> {
  if (process.platform === 'win32' || !path.isAbsolute(inputRoot) || inputRoot.split(path.sep).includes('..')
    || !path.isAbsolute(options.repositoryRoot) || !SHA256.test(options.expectedManifestSha256)) fail('G1A_INPUT_ROOT_INVALID');
  const resolvedRoot = path.resolve(inputRoot); const repositoryRoot = path.resolve(options.repositoryRoot);
  let rootBefore;
  try {
    rootBefore = await lstat(resolvedRoot, { bigint: true });
    if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink() || rootBefore.uid !== BigInt(process.getuid!())
      || Number(rootBefore.mode & 0o777n) !== 0o700 || await realpath(resolvedRoot) !== resolvedRoot) fail('G1A_INPUT_ROOT_INVALID');
  } catch (error: unknown) {
    if (error instanceof G1aInputError) throw error;
    fail('G1A_INPUT_ROOT_INVALID');
  }
  if (isInside(repositoryRoot, resolvedRoot) || isInside(resolvedRoot, repositoryRoot)) fail('G1A_INPUT_INSIDE_REPOSITORY');
  const members = (await readdir(resolvedRoot)).sort();
  if (!members.includes('manifest.json')) fail('G1A_INPUT_MEMBER_SET_INVALID');
  const manifestBytes = await readSecureMember(resolvedRoot, 'manifest.json', MANIFEST_MAX_BYTES);
  if (sha256(manifestBytes) !== options.expectedManifestSha256) fail('G1A_INPUT_HASH_MISMATCH');
  const manifestText = decodeUtf8(manifestBytes, 'G1A_INPUT_MANIFEST_INVALID');
  if (manifestText.slice(0, -1).includes('\n')) fail('G1A_INPUT_FORMAT_INVALID');
  const manifest = parseManifest(canonicalJson(manifestText.slice(0, -1), 'G1A_INPUT_MANIFEST_INVALID'), options.now ?? new Date());
  const ownerMode = manifest.schema === OWNER_MANIFEST_SCHEMA;
  const expectedMembers = ownerMode ? [...FILE_NAMES, OWNER_FILE].sort() : FILE_NAMES;
  if (members.length !== expectedMembers.length || members.some((name, index) => name !== expectedMembers[index])) fail('G1A_INPUT_MEMBER_SET_INVALID');
  if (!ownerMode && (options.expectedOwnerAcceptanceSha256 !== undefined || options.expectedOwnerSubjectHash !== undefined)) fail('G1A_INPUT_OWNER_ACCEPTANCE_INVALID');
  const payload = new Map<PayloadName, Buffer>(); let total = manifestBytes.byteLength;
  for (const name of PAYLOAD_NAMES) {
    const maximum = name === 'content.jsonl' ? CONTENT_MAX_BYTES : name === 'cases.jsonl' ? CASES_MAX_BYTES : EXPECTATIONS_MAX_BYTES;
    const bytes = await readSecureMember(resolvedRoot, name, maximum); total += bytes.byteLength;
    if (total > TOTAL_MAX_BYTES) fail('G1A_INPUT_SIZE_INVALID');
    const descriptor = manifest.files[name];
    if (descriptor.bytes !== bytes.byteLength || descriptor.sha256 !== sha256(bytes)) fail('G1A_INPUT_HASH_MISMATCH');
    payload.set(name, bytes);
  }
  if (manifest.content_snapshot_sha256 !== manifest.files['content.jsonl'].sha256) fail('G1A_INPUT_HASH_MISMATCH');
  const content = Object.freeze(parseJsonLines(payload.get('content.jsonl')!, 'G1A_INPUT_CONTENT_INVALID').map((item) => parseContent(item, ownerMode)));
  const cases = Object.freeze(parseJsonLines(payload.get('cases.jsonl')!, 'G1A_INPUT_CASE_INVALID').map(parseCase));
  const expectations = Object.freeze(parseJsonLines(payload.get('expectations.jsonl')!, 'G1A_INPUT_EXPECTATION_INVALID').map(parseExpectation));
  if (manifest.files['content.jsonl'].records !== content.length || manifest.files['cases.jsonl'].records !== cases.length
    || manifest.files['expectations.jsonl'].records !== expectations.length) fail('G1A_INPUT_HASH_MISMATCH');
  validateJoinedPackage(manifest, content, cases, expectations);
  let ownerAcceptance: G1aOwnerAcceptance | undefined;
  if (ownerMode) {
    const bytes = await readSecureMember(resolvedRoot, OWNER_FILE, OWNER_MAX_BYTES);
    const descriptor = manifest.files[OWNER_FILE]!;
    if (total + bytes.byteLength > TOTAL_MAX_BYTES + OWNER_MAX_BYTES) fail('G1A_INPUT_SIZE_INVALID');
    if (descriptor.records !== 1 || descriptor.bytes !== bytes.byteLength || descriptor.sha256 !== sha256(bytes)) fail('G1A_INPUT_HASH_MISMATCH');
    ownerAcceptance = parseOwnerAcceptance(decodeUtf8(bytes, 'G1A_INPUT_OWNER_ACCEPTANCE_INVALID'), manifest, content, options);
  }
  const rootAfter = await lstat(resolvedRoot, { bigint: true });
  if (rootAfter.dev !== rootBefore.dev || rootAfter.ino !== rootBefore.ino || rootAfter.mtimeNs !== rootBefore.mtimeNs
    || rootAfter.ctimeNs !== rootBefore.ctimeNs) fail('G1A_INPUT_MEMBER_INSECURE');
  return Object.freeze({ manifest_sha256: sha256(manifestBytes), manifest, content, cases, expectations,
    ...(ownerAcceptance ? { owner_acceptance: ownerAcceptance } : {}) });
}
