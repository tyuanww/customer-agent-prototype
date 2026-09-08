import { normalizeSearchText } from '../../src/search-text.js';

export type RelationPolarFact = Readonly<{
  polarity: 'pos' | 'neg';
  relation: string;
  argument: string;
  marker: '不' | null;
}>;

const RELATIONS = Object.freeze([
  { token: '用于', transitive: true },
  { token: '接触', transitive: true },
  { token: '外接', transitive: true },
  { token: '浸水', transitive: false },
].sort((left, right) => right.token.length - left.token.length));

const NESTED_OR_UNSUPPORTED = Object.freeze([
  '不是不', '并非不', '没不', '未不', '不不',
  '不是', '并非', '不要',
]);

const DOC_SUFFIX = Object.freeze(['说明', '流程', '步骤', '条件']);
const CONFIRM_TAIL = /(?:对吗|是吗|是不是|对不对|吗|呢)+$/u;
const CLAUSE_SPLIT = /[，。；;,、.．]+/u;
const INTERROGATIVE = /(?:是否|是不是|对不对|怎么|怎样|如何|[吗呢?？])/u;
// Verb-like speech frames. Negative lookahead keeps 说明/问题 from looking like 说/问.
const SPEECH_INTRO = /(?:说(?!明|法)|问(?!题)|告诉|提到|声称|宣称|表示)(?:道|着|了|过)?/u;
const QUOTE_CLOSER: Readonly<Record<string, string>> = Object.freeze({
  '“': '”',
  '"': '"',
  '「': '」',
});

function compact(value: string): string {
  return normalizeSearchText(value).replace(/[^\p{L}\p{N}]+/gu, '');
}

function splitClauses(text: string): readonly string[] {
  // Split on original clause marks. normalizeSearchText folds 。 to . which is
  // not in the S2 splitter; doing this after compact would glue 陈述 and 疑问.
  return Object.freeze(
    text
      .split(CLAUSE_SPLIT)
      .map((clause) => clause.trim())
      .filter((clause) => clause.length > 0),
  );
}

function stripConfirmTail(clause: string): string {
  return clause.replace(/[?？]/gu, '').trim().replace(CONFIRM_TAIL, '').trim();
}

function withoutQuotedSpans(text: string): string {
  let result = '';
  let index = 0;
  while (index < text.length) {
    const closer = QUOTE_CLOSER[text[index]!];
    if (closer === undefined) {
      result += text[index];
      index += 1;
      continue;
    }
    const closeAt = text.indexOf(closer, index + 1);
    result += '。';
    if (closeAt < 0) return result;
    index = closeAt + closer.length;
  }
  return result;
}

function isSupportedStatement(clause: string): boolean {
  const raw = clause.trim();
  if (raw.length === 0) return false;
  if (INTERROGATIVE.test(raw)) return false;
  if (SPEECH_INTRO.test(raw)) return false;
  return true;
}

function clauseBlocked(compactClause: string): boolean {
  if (NESTED_OR_UNSUPPORTED.some((prefix) => compactClause.includes(prefix))) return true;
  for (const { token } of RELATIONS) {
    let from = 0;
    while (from < compactClause.length) {
      const index = compactClause.indexOf(token, from);
      if (index < 0) break;
      if (index > 0) {
        const prev = compactClause.slice(index - 1, index);
        if (prev === '没' || prev === '未') return true;
      }
      from = index + token.length;
    }
  }
  return false;
}

function nextRelationIndex(compactClause: string, start: number): number {
  let found = compactClause.length;
  for (const { token } of RELATIONS) {
    const index = compactClause.indexOf(token, start);
    if (index >= 0 && index < found) found = index;
  }
  return found;
}

function extractFromCompact(compactClause: string): RelationPolarFact | undefined {
  if (compactClause.length === 0 || clauseBlocked(compactClause)) return undefined;
  let hit: { index: number; token: string; transitive: boolean } | undefined;
  for (let index = 0; index < compactClause.length; index += 1) {
    for (const { token, transitive } of RELATIONS) {
      if (!compactClause.startsWith(token, index)) continue;
      hit = { index, token, transitive };
      break;
    }
    if (hit !== undefined) break;
  }
  if (hit === undefined) return undefined;
  let polarity: 'pos' | 'neg' = 'pos';
  let marker: '不' | null = null;
  if (hit.index > 0 && compactClause.slice(hit.index - 1, hit.index) === '不') {
    polarity = 'neg';
    marker = '不';
  }
  const argumentStart = hit.index + hit.token.length;
  const stop = nextRelationIndex(compactClause, argumentStart);
  const argument = compactClause.slice(argumentStart, stop);
  if (DOC_SUFFIX.includes(argument)) return undefined;
  if (hit.transitive) {
    if (argument.length < 2) return undefined;
  } else if (argument.length > 0) {
    return undefined;
  }
  return Object.freeze({ polarity, relation: hit.token, argument, marker });
}

export function extractQueryRelationPolar(query: string): readonly RelationPolarFact[] {
  const facts: RelationPolarFact[] = [];
  for (const clause of splitClauses(query)) {
    const fact = extractFromCompact(compact(stripConfirmTail(clause)));
    if (fact !== undefined) facts.push(fact);
  }
  return Object.freeze(facts);
}

export function extractBodyRelationPolar(answerText: string): readonly RelationPolarFact[] {
  const facts: RelationPolarFact[] = [];
  const unquoted = withoutQuotedSpans(answerText);
  for (const clause of splitClauses(unquoted)) {
    if (!isSupportedStatement(clause)) continue;
    const fact = extractFromCompact(compact(clause));
    if (fact !== undefined) facts.push(fact);
  }
  return Object.freeze(facts);
}

export function sameRelationArgument(
  queryFacts: readonly RelationPolarFact[],
  sourceFacts: readonly RelationPolarFact[],
): boolean {
  return queryFacts.some((query) => sourceFacts.some((source) => (
    query.relation === source.relation && query.argument === source.argument
  )));
}

export function relationPolarConflict(
  queryFacts: readonly RelationPolarFact[],
  sourceFacts: readonly RelationPolarFact[],
): boolean {
  return queryFacts.some((query) => sourceFacts.some((source) => (
    query.relation === source.relation
    && query.argument === source.argument
    && query.polarity !== source.polarity
  )));
}
