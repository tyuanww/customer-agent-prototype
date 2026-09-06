import { createHash } from 'node:crypto';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function jcs(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
  const record = value as { readonly [key: string]: JsonValue };
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${jcs(record[key]!)}`).join(',')}}`;
}

export function jsonLine(value: JsonValue): string {
  return `${jcs(value)}\n`;
}

export function jsonLines(values: readonly JsonValue[]): string {
  return values.map((value) => jcs(value)).join('\n') + '\n';
}

function postgresTimestamp(value: string): string {
  return new Date(value).toISOString().replace(/\.(\d{3})Z$/, '.$1000Z');
}

export function questionHash(question: Readonly<Record<string, JsonValue>>): string {
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

export function governanceSnapshot(
  item: Readonly<Record<string, JsonValue>>,
  sourceRef: string,
): { readonly [key: string]: JsonValue } {
  const snapshot = {
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
      .sort((left, right) => String(left.question_id) < String(right.question_id) ? -1 : String(left.question_id) > String(right.question_id) ? 1 : 0),
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
  return snapshot;
}


/** Versioned identities over normalized actual content, never over record-supplied digests. */
export function governanceHash(item: Readonly<Record<string, JsonValue>>, sourceRef: string): string {
  const snapshot = governanceSnapshot(item, sourceRef);
  return sha256(jcs(item.review_mode === 'owner_acceptance' ? {
    hash_version: 'customer-agent/owner-acceptance-content/v1',
    script_version: item.script_version!,
    owner_acceptance_record_sha256: item.owner_acceptance_record_sha256!,
    content: snapshot,
  } : snapshot));
}

export function ownerReviewInputHash(item: Readonly<Record<string, JsonValue>>, sourceRef: string): string {
  const snapshot = { ...governanceSnapshot(item, sourceRef) };
  for (const key of ['review_mode', 'primary_reviewer_id', 'primary_reviewer_role', 'primary_review_evd',
    'secondary_reviewer_id', 'secondary_reviewer_role', 'secondary_review_evd']) delete snapshot[key];
  return sha256(jcs({ ...snapshot, projection_version: 'customer-agent/owner-acceptance-input/v1',
    script_version: item.script_version! }));
}
