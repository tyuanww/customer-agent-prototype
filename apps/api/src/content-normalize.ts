import { inflateRawSync } from 'node:zlib';
import { createHash as createSha } from 'node:crypto';

export const XLSX_MAX_ZIP_ENTRIES = 128;
export const XLSX_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const CONTENT_PARSE_TIMEOUT_MS = 60_000;
export const CONTENT_MAX_DATA_ROWS = 5_000;

export type NormalizedImportRow = Readonly<{
  staging_id: string;
  script_id: string;
  operation: 'upsert';
  category: 'presale' | 'campaign' | 'aftersale' | 'product';
  title: string;
  answer_text: string;
  content_hash: string;
  source_version_id: string;
  owner_role: string;
  review_due_at: string;
  platform_scope: readonly string[];
  product_scope_type: string;
  product_scope_refs: readonly string[];
  effective_from: string;
  effective_to: string | null;
  intent_taxonomy_version: string;
  intent_id: string;
  risk_level: 'low' | 'medium' | 'high';
  risk_categories: readonly string[];
  has_conflict: boolean;
  placeholder_keys: readonly string[];
  questions_json: readonly Readonly<Record<string, unknown>>[];
  questions_grams_text: string;
  title_grams_text: string;
  answer_grams_text: string;
  search_fallback_text: string;
  quality_status: 'clean';
  quality_issue_codes: readonly string[];
}>;

const DOMAINS = new Set(['presale', 'campaign', 'aftersale', 'product']);
const REQUIRED = [
  'script_id', 'category', 'title', 'answer_text', 'source_version_id', 'source_ref', 'question_text',
] as const;

function sha256(value: string): string {
  return createSha('sha256').update(value).digest('hex');
}

export function contentGrams(text: string): string {
  const chars = [...text.replace(/\s+/g, '')];
  if (chars.length === 0) return 'na';
  if (chars.length === 1) return chars[0] ?? 'na';
  const grams: string[] = [];
  for (let index = 0; index < chars.length - 1; index += 1) {
    grams.push(`${chars[index]}${chars[index + 1]}`);
  }
  return grams.join(' ');
}

function assertParseBudget(startedAt: number): void {
  if (Date.now() - startedAt > CONTENT_PARSE_TIMEOUT_MS) throw new Error('VALIDATION_FAILED');
}

function parseCsv(text: string, startedAt: number): readonly Record<string, string>[] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    if ((index & 0xfff) === 0) assertParseBudget(startedAt);
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { current.push(field); field = ''; continue; }
    if (char === '\n') {
      if (field.endsWith('\r')) field = field.slice(0, -1);
      current.push(field);
      rows.push(current);
      current = [];
      field = '';
      continue;
    }
    field += char;
  }
  if (field.length > 0 || current.length > 0) {
    current.push(field);
    rows.push(current);
  }
  const header = rows[0];
  if (!header || header.length < 2) throw new Error('UNSUPPORTED_FORMAT');
  const names = header.map((name) => name.trim());
  return rows.slice(1).filter((row) => row.some((cell) => cell.trim().length > 0)).map((row) => {
    const record: Record<string, string> = {};
    names.forEach((name, index) => { record[name] = row[index] ?? ''; });
    return record;
  });
}

function readZipLocalFiles(buffer: Buffer, startedAt: number): readonly { name: string; data: Buffer }[] {
  const files: { name: string; data: Buffer }[] = [];
  let offset = 0;
  let uncompressed = 0;
  while (offset + 30 <= buffer.length && files.length <= XLSX_MAX_ZIP_ENTRIES) {
    assertParseBudget(startedAt);
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compressed = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    if (name.includes('..') || name.startsWith('/') || name.includes('\\')) throw new Error('UNSUPPORTED_FORMAT');
    const dataStart = offset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + compressed;
    if (dataEnd > buffer.length || (method !== 0 && method !== 8)) throw new Error('UNSUPPORTED_FORMAT');
    const remaining = XLSX_MAX_UNCOMPRESSED_BYTES - uncompressed;
    if (remaining < 1 || files.length >= XLSX_MAX_ZIP_ENTRIES) throw new Error('CONTENT_TOO_LARGE');
    let payload: Buffer;
    try {
      payload = method === 0
        ? buffer.subarray(dataStart, dataEnd)
        : inflateRawSync(buffer.subarray(dataStart, dataEnd), { maxOutputLength: remaining });
    } catch (error) {
      throw new Error(error instanceof RangeError ? 'CONTENT_TOO_LARGE' : 'UNSUPPORTED_FORMAT');
    }
    if (payload.length > remaining) throw new Error('CONTENT_TOO_LARGE');
    uncompressed += payload.length;
    files.push({ name, data: payload });
    offset = dataEnd;
  }
  if (files.length === 0) throw new Error('UNSUPPORTED_FORMAT');
  return files;
}

function xlsxToCsv(buffer: Buffer, startedAt: number): string {
  const files = readZipLocalFiles(buffer, startedAt);
  const csv = files.find((file) => file.name.endsWith('.csv'));
  if (csv) return csv.data.toString('utf8');
  throw new Error('UNSUPPORTED_FORMAT');
}

function jcs(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => jcs(item)).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort((left, right) => (
      left < right ? -1 : left > right ? 1 : 0
    ));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${jcs((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Match public.content_utc_timestamp_text: fixed-width UTC microseconds. */
export function utcTimestampText(value: Date): string {
  return value.toISOString().replace(/\.(\d{3})Z$/, '.$1' + '000Z');
}

export function governanceHash(input: Readonly<{
  script_id: string;
  category: string;
  title: string;
  answer_text: string;
  source_ref: string;
  source_version_id: string;
  owner_role: string;
  review_due_at: string;
  platform_scope: readonly string[];
  product_scope_type: string;
  product_scope_refs: readonly string[];
  effective_from: string;
  effective_to: string | null;
  intent_taxonomy_version: string;
  intent_id: string;
  risk_level: string;
  risk_categories: readonly string[];
  has_conflict: boolean;
  review_mode: string;
  primary_reviewer_id: string | null;
  primary_reviewer_role: string | null;
  primary_review_evd: string | null;
  secondary_reviewer_id: string | null;
  secondary_reviewer_role: string | null;
  secondary_review_evd: string | null;
  placeholder_keys: readonly string[];
  questions: unknown;
}>): string {
  const questions = Array.isArray(input.questions)
    ? [...input.questions].sort((left, right) => {
      const leftId = String((left as { question_id?: unknown }).question_id ?? '');
      const rightId = String((right as { question_id?: unknown }).question_id ?? '');
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    })
    : input.questions;
  return sha256(jcs({
    answer_text: input.answer_text,
    category: input.category,
    effective_from: input.effective_from,
    effective_to: input.effective_to,
    has_conflict: input.has_conflict,
    intent_id: input.intent_id,
    intent_taxonomy_version: input.intent_taxonomy_version,
    owner_role: input.owner_role,
    placeholder_keys: [...input.placeholder_keys].sort(),
    platform_scope: [...input.platform_scope].sort(),
    primary_reviewer_id: input.primary_reviewer_id,
    primary_reviewer_role: input.primary_reviewer_role,
    primary_review_evd: input.primary_review_evd,
    product_scope_refs: [...input.product_scope_refs].sort(),
    product_scope_type: input.product_scope_type,
    questions,
    review_due_at: input.review_due_at,
    review_mode: input.review_mode,
    risk_categories: [...input.risk_categories].sort(),
    risk_level: input.risk_level,
    script_id: input.script_id,
    secondary_reviewer_id: input.secondary_reviewer_id,
    secondary_reviewer_role: input.secondary_reviewer_role,
    secondary_review_evd: input.secondary_review_evd,
    source_ref: input.source_ref,
    source_version_id: input.source_version_id,
    title: input.title,
  }));
}

function questionHash(record: Readonly<Record<string, unknown>>): string {
  const snapshot: Record<string, unknown> = {
    intent_id: record.intent_id,
    intent_taxonomy_version: record.intent_taxonomy_version,
    origin_fingerprint: record.origin_fingerprint,
    origin_fingerprint_key_version: record.origin_fingerprint_key_version,
    question_id: record.question_id,
    question_text: record.question_text,
    question_version: record.question_version,
    semantic_family_id: record.semantic_family_id,
    source: record.source,
    source_asset_id: record.source_asset_id,
  };
  for (const key of Object.keys(snapshot)) {
    if (snapshot[key] === null || snapshot[key] === undefined) delete snapshot[key];
  }
  return sha256(jcs(snapshot));
}

export function sampleScriptIds(
  rows: readonly NormalizedImportRow[],
  seed: string,
  target: number,
): readonly string[] {
  const ordinary = rows
    .filter((row) => row.risk_level !== 'high' && row.has_conflict === false)
    .map((row) => ({
      id: row.script_id,
      rank: sha256(`${seed}:${row.script_id}:${row.content_hash}`),
    }))
    .sort((left, right) => left.rank.localeCompare(right.rank) || left.id.localeCompare(right.id));
  const sampled = ordinary.slice(0, Math.max(0, target)).map((row) => row.id);
  const mandatory = rows
    .filter((row) => row.risk_level === 'high' || row.has_conflict)
    .map((row) => row.script_id);
  return [...new Set([...sampled, ...mandatory])].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function selectionManifestHash(
  rows: readonly NormalizedImportRow[],
  seed: string,
  initialTarget: number,
  expandedTarget: number,
): string {
  const initial = sampleScriptIds(rows, seed, initialTarget);
  const expanded = sampleScriptIds(rows, seed, expandedTarget);
  return sha256(`[${JSON.stringify(initial)}, ${JSON.stringify(expanded)}]`);
}

export function parkedRowPayload(row: NormalizedImportRow): Record<string, unknown> {
  return {
    staging_id: row.staging_id,
    script_id: row.script_id,
    operation: row.operation,
    category: row.category,
    title: row.title,
    answer_text: row.answer_text,
    content_hash: row.content_hash,
    source_version_id: row.source_version_id,
    owner_role: row.owner_role,
    review_due_at: row.review_due_at,
    platform_scope: [...row.platform_scope],
    product_scope_type: row.product_scope_type,
    product_scope_refs: [...row.product_scope_refs],
    effective_from: row.effective_from,
    effective_to: row.effective_to,
    intent_taxonomy_version: row.intent_taxonomy_version,
    intent_id: row.intent_id,
    risk_level: row.risk_level,
    risk_categories: [...row.risk_categories],
    has_conflict: row.has_conflict,
    placeholder_keys: [...row.placeholder_keys],
    questions_json: row.questions_json.map((question) => ({ ...question })),
    questions_grams_text: row.questions_grams_text,
    title_grams_text: row.title_grams_text,
    answer_grams_text: row.answer_grams_text,
    search_fallback_text: row.search_fallback_text,
    quality_status: row.quality_status,
    quality_issue_codes: [...row.quality_issue_codes],
  };
}

export function parseImportFile(
  payload: Buffer,
  sourceType: 'csv' | 'excel',
  defaults: Readonly<{
    intentTaxonomyVersion: string;
    intentId: string;
    review?: Readonly<{
      leadHash: string;
      managerHash: string;
      evidence: string;
    }>;
  }>,
): readonly NormalizedImportRow[] {
  const startedAt = Date.now();
  const text = sourceType === 'excel' ? xlsxToCsv(payload, startedAt) : payload.toString('utf8');
  if (text.includes('\u0000')) throw new Error('UNSUPPORTED_FORMAT');
  const records = parseCsv(text, startedAt);
  if (records.length < 1) throw new Error('UNSUPPORTED_FORMAT');
  if (records.length > CONTENT_MAX_DATA_ROWS) throw new Error('ROW_LIMIT_EXCEEDED');
  const rows = records.map((record, index) => {
    assertParseBudget(startedAt);
    for (const key of REQUIRED) {
      if (!record[key] || record[key].trim() === '') throw new Error('CONTENT_CONTRACT_INVALID');
    }
    const category = (record.category ?? '').trim();
    if (!DOMAINS.has(category)) throw new Error('CONTENT_CONTRACT_INVALID');
    const scriptId = (record.script_id ?? '').trim();
    const title = (record.title ?? '').trim();
    const answer = (record.answer_text ?? '').trim();
    const questionText = (record.question_text ?? '').trim();
    const sourceVersionId = (record.source_version_id ?? '').trim();
    const sourceRef = (record.source_ref ?? '').trim();
    const riskLevel = (record.risk_level?.trim() || 'low') as NormalizedImportRow['risk_level'];
    if (!['low', 'medium', 'high'].includes(riskLevel)) throw new Error('CONTENT_CONTRACT_INVALID');
    const hasConflict = record.has_conflict === 'true';
    const now = new Date();
    const due = utcTimestampText(new Date(now.getTime() + 365 * 24 * 3600 * 1000));
    const from = utcTimestampText(new Date(now.getTime() - 24 * 3600 * 1000));
    const dual = riskLevel === 'high' || hasConflict;
    const questionBase = {
      question_id: `q_${scriptId}`,
      question_version: 1,
      question_text: questionText,
      semantic_family_id: `sf_${scriptId}`,
      origin_fingerprint: sha256(`origin:${scriptId}`),
      origin_fingerprint_key_version: 'hmac-synthetic-v1',
      source_asset_id: `sa_${scriptId}`,
      source: 'manual',
      intent_taxonomy_version: defaults.intentTaxonomyVersion,
      intent_id: defaults.intentId,
    };
    const question = { ...questionBase, question_hash: questionHash(questionBase) };
    const contentHash = governanceHash({
      script_id: scriptId,
      category,
      title,
      answer_text: answer,
      source_ref: sourceRef,
      source_version_id: sourceVersionId,
      owner_role: 'ROLE-CONTENT-LEAD',
      review_due_at: due,
      platform_scope: ['qianniu'],
      product_scope_type: 'storewide',
      product_scope_refs: [],
      effective_from: from,
      effective_to: null,
      intent_taxonomy_version: defaults.intentTaxonomyVersion,
      intent_id: defaults.intentId,
      risk_level: riskLevel,
      risk_categories: riskLevel === 'high' ? ['legal_commitment'] : [],
      has_conflict: hasConflict,
      review_mode: dual ? 'dual' : 'single',
      primary_reviewer_id: defaults.review?.leadHash ?? null,
      primary_reviewer_role: defaults.review ? 'ROLE-CONTENT-LEAD' : null,
      primary_review_evd: defaults.review?.evidence ?? null,
      secondary_reviewer_id: dual ? defaults.review?.managerHash ?? null : null,
      secondary_reviewer_role: dual ? (defaults.review ? 'ROLE-CS-MANAGER' : null) : null,
      secondary_review_evd: dual ? defaults.review?.evidence ?? null : null,
      placeholder_keys: [],
      questions: [question],
    });
    return Object.freeze({
      staging_id: `stg_${String(index + 1).padStart(4, '0')}_${scriptId}`.slice(0, 128),
      script_id: scriptId,
      operation: 'upsert' as const,
      category: category as NormalizedImportRow['category'],
      title,
      answer_text: answer,
      content_hash: contentHash,
      source_version_id: sourceVersionId,
      owner_role: 'ROLE-CONTENT-LEAD',
      review_due_at: due,
      platform_scope: Object.freeze(['qianniu']),
      product_scope_type: 'storewide',
      product_scope_refs: Object.freeze([] as string[]),
      effective_from: from,
      effective_to: null,
      intent_taxonomy_version: defaults.intentTaxonomyVersion,
      intent_id: defaults.intentId,
      risk_level: riskLevel,
      risk_categories: Object.freeze(riskLevel === 'high' ? ['legal_commitment'] : []),
      has_conflict: hasConflict,
      placeholder_keys: Object.freeze([] as string[]),
      questions_json: Object.freeze([question]),
      questions_grams_text: contentGrams(questionText),
      title_grams_text: contentGrams(title),
      answer_grams_text: contentGrams(answer),
      search_fallback_text: `${questionText} ${title}`.slice(0, 20000),
      quality_status: 'clean' as const,
      quality_issue_codes: Object.freeze([] as string[]),
    });
  });
  const ids = new Set(rows.map((row) => row.script_id));
  if (ids.size !== rows.length) throw new Error('CONTENT_CONTRACT_INVALID');
  return rows;
}

export function qualityTargets(ordinaryCount: number): Readonly<{ initial: number; expanded: number }> {
  if (ordinaryCount <= 500) return Object.freeze({ initial: ordinaryCount, expanded: ordinaryCount });
  return Object.freeze({
    initial: Math.min(300, Math.max(100, Math.ceil(ordinaryCount * 0.10))),
    expanded: Math.ceil(ordinaryCount * 0.30),
  });
}
