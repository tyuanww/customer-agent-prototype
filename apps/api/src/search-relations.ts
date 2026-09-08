import { normalizeSearchText } from './search-text.js';

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
  '‘': '’',
  "'": "'",
  '『': '』',
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
  // Unmodeled conditional, quoted and occurrence frames cannot prove a
  // categorical capability, even when their embedded relation looks positive.
  if (/(?:如果|假如|假设|倘若|除非|只要|只有|一旦)|^若|^>/u.test(raw)) return false;
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
        if (prev === '没' || prev === '未' || compactClause.slice(0, index).endsWith('没有')) return true;
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

function bodyStatements(answerText: string) {
  // Commas do not end the scope of a reporting/conditional frame. Check the
  // whole statement unit before extracting its smaller relation clauses.
  return withoutQuotedSpans(answerText).split(/(?<=[。；;.!！?？\n])/u).flatMap((unit) => {
    if (!isSupportedStatement(unit) || /没|未|在[^，,。；;]*时/u.test(unit)) return [];
    return splitClauses(unit).flatMap((clause) => {
      const text = compact(clause);
      const fact = extractFromCompact(text);
      return fact ? [{ fact, subject: relationSubject(text, fact) }] : [];
    });
  });
}

export function extractBodyRelationPolar(answerText: string): readonly RelationPolarFact[] {
  return Object.freeze(bodyStatements(answerText).map(({ fact }) => fact));
}

function relationSubject(text: string, fact: RelationPolarFact): string {
  return text.slice(0, text.indexOf(fact.relation))
    .replace(/(?:没有|没|未|不|是)+$/u, '')
    .replace(/^(?:请问|您好|你好|难道不是)/u, '');
}

function compatibleSubject(query: string, source: string): boolean {
  // An omitted body subject inherits the already gated candidate. Two explicit
  // subjects must match; typo repair must not change a product/model identifier.
  return query === '' || source === '' || query === source
    || query.length >= 2 && source.endsWith(query)
    || source.length >= 2 && query.endsWith(source);
}

/**
 * Compare only the bounded relation/argument pairs stated by the answer body.
 * Occurrence negation (没/未/没有) is not a prohibition or capability fact: it
 * can request clarification, never authorize a candidate. Reduced query text
 * applies only to lexical negation/leftover checks; all other gates use raw input.
 */
export function analyzeRelationQuery(query: string, answerText: string, confirmation: boolean) {
  const queryStatements = splitClauses(query).flatMap((clause) => {
    const text = compact(stripConfirmTail(clause));
    const fact = extractFromCompact(text);
    return fact ? [{ fact, subject: relationSubject(text, fact) }] : [];
  });
  const queryFacts = Object.freeze(queryStatements.map(({ fact }) => fact));
  const sourceStatements = bodyStatements(answerText);
  const sourceFacts = Object.freeze(sourceStatements.map(({ fact }) => fact));
  const matchingPairs = queryStatements.flatMap((query) => sourceStatements
    .filter((source) => query.fact.relation === source.fact.relation
      && query.fact.argument === source.fact.argument
      && compatibleSubject(query.subject, source.subject))
    .map((source) => ({ query: query.fact, source: source.fact })));
  const sameRelArg = matchingPairs.length > 0;
  const polarConflict = matchingPairs.some(({ query: queryFact, source }) => queryFact.polarity !== source.polarity);
  let negationQuery = compact(query);
  let leftoverQuery = compact(query);
  let requiresClarification = false;
  const answered = (fact: RelationPolarFact, subject: string) => {
    const polarities = new Set(sourceStatements.filter(({ fact: source, subject: sourceSubject }) => (
      source.relation === fact.relation && source.argument === fact.argument
      && compatibleSubject(subject, sourceSubject)
    )).map(({ fact: source }) => source.polarity));
    return polarities.size === 1;
  };
  // Remove only explained negative facts, not every 不 in a confirmation.
  if (confirmation) {
    for (const { fact, subject } of queryStatements) {
      if (fact.polarity === 'neg' && answered(fact, subject)) {
        negationQuery = negationQuery.replaceAll(`不${fact.relation}${fact.argument}`, '');
      }
    }
  }
  for (const clause of splitClauses(query)) {
    const text = compact(stripConfirmTail(clause));
    // Nested, quoted and interrogative occurrence claims have no safe reduction.
    if (!isSupportedStatement(clause) || /[“”"「」‘’'『』>]/u.test(clause)) continue;
    if (NESTED_OR_UNSUPPORTED.some((prefix) => text.includes(prefix))) continue;
    for (const { token } of RELATIONS) {
      for (const marker of ['没有', '没', '未']) {
        const phrase = `${marker}${token}`;
        if (!text.includes(phrase)) continue;
        const fact = extractFromCompact(text.replace(phrase, token));
        if (!fact || !answered(fact, relationSubject(text, fact))) continue;
        const occurrence = `${marker}${fact.relation}${fact.argument}`;
        leftoverQuery = leftoverQuery.replace(occurrence, '');
        requiresClarification = true;
      }
    }
  }
  // Titles/questions/annotations cannot supply the affirmative body fact that
  // would justify answering a negative confirmation.
  const unansweredConfirmation = confirmation && queryStatements.some(({ fact, subject }) => (
    fact.polarity === 'neg' && !answered(fact, subject)
  ));
  return Object.freeze({
    queryFacts, sourceFacts, sameRelArg, polarConflict,
    negationQuery, leftoverQuery, requiresClarification, unansweredConfirmation,
  });
}
