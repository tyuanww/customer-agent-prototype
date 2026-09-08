import { compactSearchText } from '../../src/search-decision.js';
import type { DemandVerdict, SyntheticSource } from './types.ts';

/**
 * Speech-act / polite wrappers. Not an operation list and not product names.
 * Confirmation particles belong here so "对象吗" does not leave a fake remainder.
 */
const WRAPPERS = Object.freeze([
  '可以换一种说法说明', '我想仔细了解', '请帮我查询', '请问一下',
  '换一种说法', '仔细了解', '适用条件', '处理方式', '请说明', '怎么办',
  '请帮我', '想了解', '麻烦', '查询', '关于', '请问', '您好', '你好',
  '对不对', '是不是', '对吗', '是吗',
  '一下', '怎么', '怎样', '如何', '哪些', '哪个', '什么', '谢谢',
  '呢', '吗', '啊', '吧', '嘛', '的', '了',
].sort((a, b) => b.length - a.length));

function stripWrappers(compact: string): string {
  let remainder = compact;
  let changed = true;
  while (changed) {
    changed = false;
    for (const word of WRAPPERS) {
      if (word.length === 0) continue;
      const next = remainder.replaceAll(word, '');
      if (next !== remainder) {
        remainder = next;
        changed = true;
      }
    }
  }
  return remainder;
}

function stripCopula(compact: string): string {
  if (compact.startsWith('不是')) return compact.slice(2);
  if (compact.startsWith('是')) return compact.slice(1);
  return compact;
}

function hamming1(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diffs = 0;
  const leftChars = Array.from(left);
  const rightChars = Array.from(right);
  for (let index = 0; index < leftChars.length; index += 1) {
    if (leftChars[index] !== rightChars[index]) diffs += 1;
    if (diffs > 1) return false;
  }
  return diffs === 1;
}

function namesOf(source: SyntheticSource): readonly { raw: string; compact: string }[] {
  const raw = [...source.annotation.subjects, ...source.annotation.aliases];
  const unique = new Map<string, string>();
  for (const name of raw) {
    const compact = compactSearchText(name);
    if (compact.length === 0) continue;
    if (!unique.has(compact) || (unique.get(compact)?.length ?? 0) < name.length) {
      unique.set(compact, name);
    }
  }
  return Object.freeze(
    [...unique.entries()]
      .map(([compact, rawName]) => ({ raw: rawName, compact }))
      .sort((left, right) => right.compact.length - left.compact.length),
  );
}

function locateSubject(
  queryCompact: string,
  source: SyntheticSource,
): { raw: string; compact: string } | undefined {
  const names = namesOf(source);
  for (const name of names) {
    if (queryCompact.includes(name.compact)) return name;
  }
  const uniqueHits: { raw: string; compact: string }[] = [];
  for (const name of names) {
    const length = name.compact.length;
    if (length < 2) continue;
    const queryChars = Array.from(queryCompact);
    for (let start = 0; start + length <= queryChars.length; start += 1) {
      const span = queryChars.slice(start, start + length).join('');
      if (hamming1(span, name.compact)) {
        uniqueHits.push(name);
        break;
      }
    }
  }
  return uniqueHits.length === 1 ? uniqueHits[0] : undefined;
}

function remainderAfterSubject(queryCompact: string, subjectCompact: string): string {
  const index = queryCompact.indexOf(subjectCompact);
  if (index >= 0) {
    return `${queryCompact.slice(0, index)}${queryCompact.slice(index + subjectCompact.length)}`;
  }
  const length = subjectCompact.length;
  const queryChars = Array.from(queryCompact);
  for (let start = 0; start + length <= queryChars.length; start += 1) {
    const span = queryChars.slice(start, start + length).join('');
    if (hamming1(span, subjectCompact)) {
      return queryChars.slice(0, start).join('') + queryChars.slice(start + length).join('');
    }
  }
  return queryCompact;
}

function matchedNeeds(remainder: string, needs: readonly string[]): readonly string[] {
  const found: string[] = [];
  const sorted = [...needs]
    .map((need) => ({ raw: need, compact: compactSearchText(need) }))
    .filter((need) => need.compact.length > 0)
    .sort((left, right) => right.compact.length - left.compact.length);
  let cursor = remainder;
  for (const need of sorted) {
    if (cursor.includes(need.compact)) {
      found.push(need.raw);
      cursor = cursor.replace(need.compact, '');
    }
  }
  return Object.freeze(found);
}

function polarityCore(compact: string): string {
  let value = compact;
  while (value.startsWith('不') || value.startsWith('没') || value.startsWith('未')) {
    value = value.slice(1);
  }
  return value;
}

export function isConfirmationQuery(query: string): boolean {
  const trimmed = query.trim().replace(/[?？]/gu, '');
  return /(对吗|是吗|是不是|对不对|吗)$/u.test(trimmed);
}

function factUnitCores(source: SyntheticSource): readonly string[] {
  const cores = new Set<string>();
  for (const constraint of source.annotation.constraints) {
    const core = polarityCore(compactSearchText(constraint));
    if (core.length > 0) cores.add(core);
  }
  const subjects = [...source.annotation.subjects, ...source.annotation.aliases]
    .map(compactSearchText)
    .filter((name) => name.length > 0)
    .sort((left, right) => right.length - left.length);
  for (const question of source.questions) {
    let compact = compactSearchText(question);
    for (const subject of subjects) compact = compact.replaceAll(subject, '');
    const core = polarityCore(stripWrappers(compact));
    if (core.length > 0) cores.add(core);
  }
  return Object.freeze([...cores]);
}

function confirmationFactInSource(remainder: string, source: SyntheticSource): boolean {
  const fact = polarityCore(stripCopula(remainder));
  if (fact.length === 0) return false;
  return factUnitCores(source).includes(fact);
}

export function judgeDemand(query: string, source: SyntheticSource): DemandVerdict {
  const queryCompact = compactSearchText(query);
  const titleCompact = compactSearchText(source.title);
  if (source.annotation.status === 'missing') {
    return Object.freeze({
      sourceId: source.id, kind: 'unknown', reason: 'missing_annotation', matchedNeeds: Object.freeze([]),
    });
  }
  if (source.annotation.status === 'conflict') {
    return Object.freeze({
      sourceId: source.id, kind: 'unknown', reason: 'conflict_annotation', matchedNeeds: Object.freeze([]),
    });
  }
  if (queryCompact.length === 0) {
    return Object.freeze({
      sourceId: source.id, kind: 'unknown', reason: 'empty_query', matchedNeeds: Object.freeze([]),
    });
  }

  const queryCore = stripWrappers(queryCompact);
  const queryIsTitle = queryCore === titleCompact || queryCompact === titleCompact;
  if (queryIsTitle) {
    return Object.freeze({
      sourceId: source.id,
      kind: 'answered',
      reason: 'exact_title',
      remainder: '',
      matchedNeeds: Object.freeze([]),
    });
  }

  const located = locateSubject(queryCompact, source);
  if (located === undefined) {
    return Object.freeze({
      sourceId: source.id, kind: 'unknown', reason: 'no_subject', matchedNeeds: Object.freeze([]),
    });
  }

  const remainder = stripWrappers(remainderAfterSubject(queryCompact, located.compact));
  const needs = matchedNeeds(remainder, source.annotation.answerable_needs);
  const queryIsNeed = source.annotation.answerable_needs
    .map(compactSearchText)
    .includes(queryCore);

  if (remainder.length === 0) {
    if (source.annotation.overview_showable || queryIsNeed) {
      return Object.freeze({
        sourceId: source.id,
        kind: 'answered',
        reason: queryIsNeed ? 'topic_need' : 'overview',
        subject: located.raw,
        remainder,
        matchedNeeds: queryIsNeed ? Object.freeze([queryCore]) : Object.freeze([]),
      });
    }
    return Object.freeze({
      sourceId: source.id,
      kind: 'subject_only',
      reason: 'subject_without_need',
      subject: located.raw,
      remainder,
      matchedNeeds: Object.freeze([]),
    });
  }

  if (needs.length > 0) {
    return Object.freeze({
      sourceId: source.id,
      kind: 'answered',
      reason: 'need_matched',
      subject: located.raw,
      remainder,
      matchedNeeds: needs,
    });
  }

  if (isConfirmationQuery(query) && confirmationFactInSource(remainder, source)) {
    return Object.freeze({
      sourceId: source.id,
      kind: 'answered',
      reason: 'confirmation_fact',
      subject: located.raw,
      remainder,
      matchedNeeds: Object.freeze([]),
    });
  }

  return Object.freeze({
    sourceId: source.id,
    kind: 'unknown',
    reason: 'unanswered_remainder',
    subject: located.raw,
    remainder,
    matchedNeeds: Object.freeze([]),
  });
}
