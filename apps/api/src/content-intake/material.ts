import { createHash } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { ParseResult } from '@customer-agent/content-intake';
import { canonicalJson, type CanonicalJsonValue } from '../idempotency.js';
import { IntakeRejection } from './transaction.js';
import type { Source } from './authority.js';

type C = components['schemas'];
type Entry = C['IntakeEntry'];
export const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

// The accepted IntakeSnapshot contract limits the WHOLE page to 100 vocabulary
// displays; OpenAPI 1.17 also caps enabled entries at this combined budget.
// Keep visible FILE_LIMIT admission ahead of the generic contract validator.
export const SNAPSHOT_VOCABULARY_LIMIT = 100;
export function snapshotVocabularyKeys(entry: Pick<Entry,'productRefs'|'scenarioRefs'>): Set<string> {
  return new Set([...entry.productRefs,...entry.scenarioRefs].map(ref=>`${ref.id}:${ref.displayVersion}`));
}
export function assertSnapshotPageable(entries: Pick<Entry,'operation'|'productRefs'|'scenarioRefs'>[]): void {
  if (entries.some(e=>e.operation==='upsert' && snapshotVocabularyKeys(e).size>SNAPSHOT_VOCABULARY_LIMIT)) {
    throw new IntakeRejection('FILE_LIMIT','VALIDATION');
  }
}

/** Formal material is JSON only. Reject invalid Unicode rather than hashing text
 * PostgreSQL or another JCS consumer cannot preserve. */
export function canonical(value: CanonicalJsonValue): string {
  const check = (v: CanonicalJsonValue): void => {
    if (typeof v === 'string') {
      for (let i = 0; i < v.length; i++) {
        const c = v.charCodeAt(i);
        if (c === 0 || (c >= 0xdc00 && c <= 0xdfff)) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
        if (c >= 0xd800 && c <= 0xdbff) {
          const next = v.charCodeAt(++i);
          if (!(next >= 0xdc00 && next <= 0xdfff)) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
        }
      }
    } else if (v && typeof v === 'object') {
      for (const [key, item] of Object.entries(v)) { check(key); check(item as CanonicalJsonValue); }
    }
  };
  check(value);
  return canonicalJson(value);
}

/** Scope/vocabulary/base are database facts, never workbook or renderer authority.
 * Missing rows and questions inherit; only an explicit disable changes availability. */
export function materialFromParse(input: {
  parsed: ParseResult; source: Source; object: C['IntakeObject']; contributors: string[];
  previous: Entry[]; terms: { id: string; kind: 'product' | 'scenario'; displayVersion: number }[];
  baseReleaseId: string | null; now: number; recentDisables: number;
}): C['IntakeMaterial'] {
  const { parsed, source, previous, now } = input;
  if (!parsed.ok || parsed.issues.length) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  const before = new Map(previous.map(e => [e.businessEntryId, e]));
  const entries = new Map(before);
  const questionOwners = new Map(previous.flatMap(e => e.questions.map(q => [q.id, e.businessEntryId] as const)));
  const differences: C['IntakeDifference'][] = [];
  let critical = false;
  let disables = 0;
  const refs = (value: string, kind: 'product' | 'scenario'): C['IntakeTermRef'][] => {
    if (!value) return [];
    const ids = value.split(',').map(s => s.trim());
    if (new Set(ids).size !== ids.length) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
    return ids.sort().map(id => {
      const term = input.terms.find(t => t.id === id && t.kind === kind);
      if (!term) throw new IntakeRejection('SOURCE_MISMATCH', 'VALIDATION');
      return { id, displayVersion: term.displayVersion };
    });
  };
  for (const row of parsed.rows) {
    const old = before.get(row.id);
    if (!old && row.state === '停用') throw new IntakeRejection('MATERIAL_CHANGED', 'VALIDATION');
    const questions = new Map(old?.questions.map(q => [q.id, q]) ?? []);
    for (const q of parsed.questions.filter(q => q.entryId === row.id)) {
      if (questionOwners.has(q.id) && questionOwners.get(q.id) !== row.id) throw new IntakeRejection('MATERIAL_CHANGED', 'VALIDATION');
      const prior = questions.get(q.id);
      const active = q.state === '启用';
      const version = prior ? prior.version + Number(prior.text !== q.text || prior.active !== active) : 1;
      questions.set(q.id, { id: q.id, version, text: q.text, active });
    }
    const values = row.values;
    // Family override needs a cross-source overlap proof at publication. Until that
    // slice exists, explicit family input is rejected, never guessed from a title.
    if (values[10]) throw new IntakeRejection('SOURCE_MISMATCH', 'VALIDATION');
    const operation = row.state === '停用' ? 'disable' : 'upsert';
    const productRefs = refs(values[3]!, 'product'), scenarioRefs = refs(values[4]!, 'scenario');
    assertSnapshotPageable([{operation,productRefs,scenarioRefs}]);
    const next: Entry = parseContractSchema('IntakeEntry', {
      businessEntryId: row.id, scriptVersion: old?.scriptVersion ?? 1,
      operation, title: row.title, answerText: row.body,
      questions: [...questions.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      productRefs, scenarioRefs,
      effectiveFrom: values[8] ? new Date(values[8]).toISOString() : old?.effectiveFrom ?? new Date(now).toISOString(),
      effectiveTo: values[9] ? new Date(values[9]).toISOString() : null,
      applicabilityNote: values[6], familySourceId: null, familyBusinessEntryId: null,
      brandNonOverridable: values[14] === 'true', category: values[5], internalNote: values[11],
      riskNote: values[12], attachmentNote: values[13],
    });
    if (source.scope.shopId !== null && next.brandNonOverridable) throw new IntakeRejection('SCOPE_DENIED', 'VALIDATION');
    if (next.effectiveTo !== null && Date.parse(next.effectiveTo) <= Date.parse(next.effectiveFrom)) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
    const changed = !old || canonical(old) !== canonical(next);
    if (changed) {
      // Questions carry their own versions; changing only questions keeps the answer version.
      const scriptPart = (e: Entry) => ({ ...e, questions: [] });
      if (old && canonical(scriptPart(old)) !== canonical(scriptPart(next))) next.scriptVersion++;
      if (old?.operation === 'upsert' && next.operation === 'disable') disables++;
      // A declared risk note only escalates. Removing an old note/keyword is
      // itself a critical change, so the author cannot turn it into self-review.
      if (old?.riskNote.trim() || next.riskNote.trim()
        || [old?.title ?? '', old?.answerText ?? '', next.title, next.answerText].some(t => /过敏|赔付/u.test(t))) critical = true;
      differences.push({ businessEntryId: row.id,
        change: !old ? 'add' : next.operation === 'disable' ? 'disable' : old.operation === 'disable' ? 'reenable' : 'modify',
        previousVersion: old?.scriptVersion ?? null, nextVersion: next.scriptVersion,
        beforeDigest: old ? digest(canonical(old)) : null, afterDigest: digest(canonical(next)) });
    }
    entries.set(row.id, next);
  }
  if (disables + input.recentDisables >= 2) critical = true;
  const material = parseContractSchema('IntakeMaterial', {
    canonicalEncodingVersion: 'candidate-p1.1', scope: source.scope, sourceVersion: source.version,
    sourceClaim: { versionKind: 'unknown', versionValue: null, acquisition: 'controlled-synthetic-export', fileSha256: input.object.sha256 },
    templateVersion: source.templateVersion, ruleVersion: source.ruleVersion, mappingVersion: source.mappingVersion,
    selectedSheets: ['来源', 'FAQ', '相似问法'], object: input.object,
    entries: [...entries.values()].sort((a, b) => a.businessEntryId < b.businessEntryId ? -1 : a.businessEntryId > b.businessEntryId ? 1 : 0),
    differences: differences.sort((a, b) => a.businessEntryId < b.businessEntryId ? -1 : a.businessEntryId > b.businessEntryId ? 1 : 0),
    contributors: [...input.contributors].sort(), baseReleaseId: input.baseReleaseId, media: [],
    risk: { policyVersion: 'risk-p1.1', level: critical ? 'critical' : 'routine', reasons: critical ? ['CRITICAL_CHANGE'] : [],
      explicitDisableCount: disables, sameSourceDisabledLast24Hours: input.recentDisables, evaluatedAt: new Date(now).toISOString() },
  });
  assertSnapshotPageable(material.entries);
  canonical(material);
  return material;
}
