import { normalizeSearchText } from './search-text.js';
import { analyzeRelationQuery, type RelationPolarFact } from './search-relations.js';

export type SearchDisplayDecision = 'show' | 'reject' | 'clarify_or_no_result';

export type JudgableCandidate = Readonly<{
  scriptId: string;
  title: string;
  answerText: string;
  questionTexts: readonly string[];
  searchFallbackText: string;
}>;

export type JudgedSearch = Readonly<{
  decision: SearchDisplayDecision;
  shownScriptIds: readonly string[];
}>;

export type { RelationPolarFact } from './search-relations.js';

export type CandidateInspection = Readonly<{
  scriptId: string;
  relevant: boolean;
  conflict: boolean;
  showBeforeAmbiguity: boolean;
  overlap: number;
  queryFacts: readonly RelationPolarFact[];
  sourceFacts: readonly RelationPolarFact[];
  sameRelArg: boolean;
  polarConflict: boolean;
  leftoverHit: boolean;
  exceptionEligible: boolean;
  waivedLeftover: boolean;
  requiresClarification: boolean;
}>;

export type SearchInspection = Readonly<{
  decision: SearchDisplayDecision;
  shownScriptIds: readonly string[];
  act: 'confirmation' | 'assertion' | 'info_question' | 'quoted' | 'underspecified';
  shownBeforeAmbiguity: readonly string[];
  shownAfterAmbiguity: readonly string[];
  ambiguityEmptied: boolean;
  candidates: readonly CandidateInspection[];
}>;

const FUNCTION_WORDS = Object.freeze([
  '难道不是', '是不是', '对不对', '哪一方', '什么时候', '怎么办',
  '请问', '是否', '对吗', '是吗', '怎样', '如何', '哪些', '哪个', '什么', '多少',
  '怎么', '一下', '已经', '以后', '之后', '还会', '还是', '还能', '需要',
  '应该', '可以', '这款', '这个', '那个', '哪里', '时候', '提交', '申请',
  '影响', '内容', '完成', '归还', '检查', '兼容', '范围', '连接', '哪些',
  '记录', '包装', '这句话', '这一句', '请问', '您好',
  '多久',
  '吗', '呢', '啊', '吧', '嘛', '的', '了', '还', '能', '在', '谁', '并',
  '后', '要', '才', '有', '是', '会', '到', '与', '和', '或', '由', '向', '给',
]);

const BOUNDED_POLITE = /^(你好|您好)(?=请问|怎么|怎样|如何|吗|呢|$)/u;

const CONFIRMATION_TAG = /^(对吗|是吗|是不是|对不对|吗|呢)\??$/u;
const SIDE_QUESTION = /(在哪里|哪里查|哪里看|包装在哪里|记录在哪里|保存在哪里)/u;

const CN_NUM: Readonly<Record<string, number>> = Object.freeze({
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
});

export function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(/[^\p{L}\p{N}]+/gu, '');
}

export function ngrams(compact: string, size: number): readonly string[] {
  const chars = Array.from(compact);
  if (chars.length < size) return Object.freeze([]);
  const grams: string[] = [];
  for (let index = 0; index + size <= chars.length; index += 1) {
    grams.push(chars.slice(index, index + size).join(''));
  }
  return Object.freeze(grams);
}

function stripFunctionWords(compact: string): string {
  let remainder = compact.replace(BOUNDED_POLITE, '');
  const words = [...FUNCTION_WORDS].sort((left, right) => right.length - left.length);
  for (const word of words) remainder = remainder.replaceAll(word, '');
  return remainder;
}

function corpusOf(candidate: JudgableCandidate): string {
  return [candidate.title, candidate.answerText, ...candidate.questionTexts, candidate.searchFallbackText].join('\n');
}

function fieldCompacts(candidate: JudgableCandidate): readonly string[] {
  return Object.freeze([
    compactSearchText(candidate.title),
    ...candidate.questionTexts.map(compactSearchText),
    compactSearchText(candidate.searchFallbackText),
  ].filter((field) => field.length > 0));
}

function matchCorpus(candidate: JudgableCandidate): string {
  return fieldCompacts(candidate).join('|');
}

function compactCorpus(candidate: JudgableCandidate): string {
  return compactSearchText(corpusOf(candidate));
}

function addSegmentGrams(terms: Set<string>, field: string): void {
  for (const segment of field.split(/\s+/u)) {
    const compact = compactSearchText(segment);
    if (compact.length < 2) continue;
    for (const gram of ngrams(compact, 2)) terms.add(gram);
  }
}

function repairVocabulary(candidates: readonly JudgableCandidate[]): ReadonlySet<string> {
  const terms = new Set<string>();
  for (const candidate of candidates) {
    addSegmentGrams(terms, candidate.title);
    for (const question of candidate.questionTexts) addSegmentGrams(terms, question);
  }
  return terms;
}

function hamming1Matches(token: string, vocab: ReadonlySet<string>): readonly string[] {
  if (vocab.has(token)) return Object.freeze([token]);
  const matches: string[] = [];
  for (const term of vocab) {
    if (term.length !== token.length) continue;
    let diffs = 0;
    const tokenChars = Array.from(token);
    const termChars = Array.from(term);
    for (let index = 0; index < tokenChars.length; index += 1) {
      if (tokenChars[index] !== termChars[index]) diffs += 1;
      if (diffs > 1) break;
    }
    if (diffs === 1) matches.push(term);
  }
  return Object.freeze(matches);
}

const PROTECTED_SWAP_CHARS = '前后是否能否可不上下内外加减有无对错开关增减顺逆一二三四五六七八九十两零〇';

function isUnsafeTypoPair(from: string, to: string): boolean {
  if (from.length !== to.length) return false;
  if (/\p{N}/u.test(from) || /\p{N}/u.test(to)) return true;
  const fromChars = Array.from(from);
  const toChars = Array.from(to);
  for (let index = 0; index < fromChars.length; index += 1) {
    if (fromChars[index] === toChars[index]) continue;
    const left = fromChars[index] ?? '';
    const right = toChars[index] ?? '';
    if (PROTECTED_SWAP_CHARS.includes(left) && PROTECTED_SWAP_CHARS.includes(right)) return true;
  }
  return false;
}

function uniqueSafeHamming1(token: string, vocab: ReadonlySet<string>): string | undefined {
  const matches = hamming1Matches(token, vocab).filter((term) => (
    term === token || !isUnsafeTypoPair(token, term)
  ));
  return matches.length === 1 ? matches[0] : undefined;
}

const FUNCTION_CHAR_BLOCKLIST = '的了吗呢啊吧嘛不也可在是有和与或由向给后要才到';

function isFunctionCharToken(token: string): boolean {
  return Array.from(token).some((char) => FUNCTION_CHAR_BLOCKLIST.includes(char));
}

export function repairUnambiguousTypos(
  compactQuery: string,
  vocab: ReadonlySet<string>,
): string {
  const chars = Array.from(compactQuery);
  const covered = chars.map(() => false);
  for (let index = 0; index + 1 < chars.length; index += 1) {
    const gram = `${chars[index]}${chars[index + 1]}`;
    if (!vocab.has(gram)) continue;
    covered[index] = true;
    covered[index + 1] = true;
  }
  for (let index = 0; index + 1 < chars.length; index += 1) {
    if (covered[index] || covered[index + 1]) continue;
    const token = `${chars[index]}${chars[index + 1]}`;
    if (isFunctionCharToken(token)) continue;
    const chosen = uniqueSafeHamming1(token, vocab);
    if (chosen === undefined || chosen === token) continue;
    const chosenChars = Array.from(chosen);
    const first = chosenChars[0];
    const second = chosenChars[1];
    if (first === undefined || second === undefined) continue;
    chars[index] = first;
    chars[index + 1] = second;
    covered[index] = true;
    covered[index + 1] = true;
  }
  return chars.join('');
}

function splitClauses(query: string): readonly string[] {
  return normalizeSearchText(query)
    .split(/[，。；;,]+|(?<!\d)\.|\.(?!\d)/u)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

type SpeechAct = 'confirmation' | 'assertion' | 'info_question' | 'quoted' | 'underspecified';

function clauseAct(clause: string): SpeechAct {
  const normalized = normalizeSearchText(clause);
  const compact = compactSearchText(normalized);
  if (/^["“].+[”"](这句话|这一句)?$/u.test(normalized) || /(这句话|这一句)$/u.test(normalized)) {
    return 'quoted';
  }
  if (CONFIRMATION_TAG.test(normalized.replace(/[?？]/gu, ''))) return 'confirmation';
  if (
    /难道不是.+吗/u.test(normalized)
    || /是否/u.test(normalized)
    || /对吗/u.test(normalized)
    || /吗\??$/u.test(normalized)
    || /么\??$/u.test(normalized) && /(?:能|可以|还|需要|会)/u.test(normalized)
  ) {
    return 'confirmation';
  }
  if (/[?？]$/u.test(normalized) || /哪|什么时候|哪些|怎样|怎么|如何|谁|多少|多久/u.test(normalized)) {
    return 'info_question';
  }
  if (stripFunctionWords(compact).length < 2) return 'underspecified';
  return 'assertion';
}

type QueryIntent = Readonly<{
  act: SpeechAct;
  clauses: readonly string[];
  hasConflictingAssertionShape: boolean;
}>;

function interpretQuery(query: string): QueryIntent {
  const compact = compactSearchText(query);
  const normalized = normalizeSearchText(query);
  if (stripFunctionWords(compact).length < 2) {
    if (/[%_\\]/u.test(normalized)) {
      return Object.freeze({
        act: 'info_question',
        clauses: Object.freeze([query]),
        hasConflictingAssertionShape: false,
      });
    }
    return Object.freeze({ act: 'underspecified', clauses: Object.freeze([query]), hasConflictingAssertionShape: false });
  }
  const clauses = splitClauses(query);
  if (clauses.length === 1 && clauseAct(clauses[0] ?? '') === 'quoted') {
    return Object.freeze({ act: 'quoted', clauses, hasConflictingAssertionShape: false });
  }
  const acts = clauses.map(clauseAct);
  const last = clauses[clauses.length - 1] ?? '';
  const lastAct = acts[acts.length - 1];
  const head = clauses.slice(0, -1);
  const headActs = acts.slice(0, -1);
  if (clauses.length > 1 && lastAct === 'confirmation' && CONFIRMATION_TAG.test(normalizeSearchText(last).replace(/[?？]/gu, ''))) {
    return Object.freeze({
      act: 'confirmation',
      clauses: Object.freeze(head.length > 0 ? head : clauses),
      hasConflictingAssertionShape: false,
    });
  }
  const assertionClauses = clauses.filter((_, index) => acts[index] === 'assertion');
  const hasSideQuestion = clauses.some((clause, index) => (
    acts[index] === 'info_question' && SIDE_QUESTION.test(clause)
  ));
  if (assertionClauses.length > 0 && (hasSideQuestion || headActs.includes('assertion') || acts.includes('confirmation'))) {
    return Object.freeze({
      act: 'assertion',
      clauses: Object.freeze(assertionClauses),
      hasConflictingAssertionShape: true,
    });
  }
  if (acts.includes('confirmation')) {
    return Object.freeze({ act: 'confirmation', clauses, hasConflictingAssertionShape: false });
  }
  if (acts.every((act) => act === 'info_question')) {
    return Object.freeze({ act: 'info_question', clauses, hasConflictingAssertionShape: false });
  }
  if (acts.includes('assertion') && !acts.includes('confirmation')) {
    return Object.freeze({ act: 'assertion', clauses, hasConflictingAssertionShape: false });
  }
  return Object.freeze({ act: 'info_question', clauses, hasConflictingAssertionShape: false });
}

function parseNumberToken(raw: string): number | null {
  if (/^\d+$/u.test(raw)) return Number(raw);
  if (raw === '十') return 10;
  const chars = Array.from(raw);
  if (chars.length === 1) return CN_NUM[chars[0] ?? ''] ?? null;
  if (chars[0] === '十') return 10 + (CN_NUM[chars[1] ?? ''] ?? 0);
  if (chars[1] === '十' && chars.length === 2) return (CN_NUM[chars[0] ?? ''] ?? 0) * 10;
  if (chars[1] === '十' && chars.length === 3) {
    return (CN_NUM[chars[0] ?? ''] ?? 0) * 10 + (CN_NUM[chars[2] ?? ''] ?? 0);
  }
  return null;
}

type DirectedFact = Readonly<{ from: string; to: string; verb: string }>;
type QuantityFact = Readonly<{ buy: number; give: number }>;
type PolarFact = Readonly<{ polarity: 'pos' | 'neg'; predicate: string }>;
type TimeFact = Readonly<{ window: 'before_start' | 'after_start'; allowed: boolean }>;
type DurationFact = Readonly<{ amount: number; unit: 's' }>;

function stripClauseNoise(text: string): string {
  return normalizeSearchText(text)
    .replace(/^(是|难道不是|不是)/u, '')
    .replace(/[?？吗呢啊吧嘛]/gu, '')
    .trim();
}

const ROLE_SUFFIX_SHORT = '台客店';
const ROLE_SUFFIX_LONG = '方人者家员商';
const ROLE_FORBIDDEN_START = '向给后并的了与和';

function extractRoles(haystack: string): ReadonlyArray<Readonly<{ value: string; start: number; end: number }>> {
  const chars = Array.from(haystack);
  const roles: Array<Readonly<{ value: string; start: number; end: number }>> = [];
  for (let index = 0; index < chars.length; index += 1) {
    const suffix = chars[index];
    if (suffix === undefined) continue;
    const preferShort = ROLE_SUFFIX_SHORT.includes(suffix);
    const preferLong = ROLE_SUFFIX_LONG.includes(suffix);
    if (!preferShort && !preferLong) continue;
    const two = index >= 1 ? `${chars[index - 1] ?? ''}${suffix}` : '';
    const three = index >= 2 ? `${chars[index - 2] ?? ''}${chars[index - 1] ?? ''}${suffix}` : '';
    const take = (value: string, start: number): void => {
      if (value.length < 2 || ROLE_FORBIDDEN_START.includes(value[0] ?? '')) return;
      roles.push(Object.freeze({ value, start, end: index + 1 }));
    };
    if (preferShort) {
      if (two.length === 2) take(two, index - 1);
      else if (three.length === 3) take(three, index - 2);
    } else if (three.length === 3) {
      take(three, index - 2);
    } else if (two.length === 2) {
      take(two, index - 1);
    }
  }
  return Object.freeze(roles);
}

function extractDirected(text: string): readonly DirectedFact[] {
  const facts: DirectedFact[] = [];
  const haystack = compactSearchText(stripClauseNoise(text));
  const roles = extractRoles(haystack);
  const transferPattern = /(?:向|给)([\p{L}\p{N}]{1,2}[方人店者家员商台客])/gu;
  for (const match of haystack.matchAll(transferPattern)) {
    const to = match[1];
    if (to === undefined || match.index === undefined) continue;
    const from = [...roles].reverse().find((role) => role.end <= match.index);
    if (from === undefined) continue;
    const verbStart = match.index + match[0].length;
    const verb = haystack.slice(verbStart, verbStart + 8);
    if (verb.length < 2) continue;
    facts.push(Object.freeze({ from: from.value, to, verb }));
  }
  return Object.freeze(facts);
}

function extractQuantities(text: string): readonly QuantityFact[] {
  const facts: QuantityFact[] = [];
  const compact = compactSearchText(text);
  const pattern = /(?:买|购买)([一二三四五六七八九十两\d]+)[块件个盒卷].*?(?:赠送|送)([一二三四五六七八九十两\d]+)/gu;
  for (const match of compact.matchAll(pattern)) {
    const buy = parseNumberToken(match[1] ?? '');
    const give = parseNumberToken(match[2] ?? '');
    if (buy === null || give === null) continue;
    facts.push(Object.freeze({ buy, give }));
  }
  return Object.freeze(facts);
}

function normalizePredicate(value: string): string {
  return compactSearchText(value).replace(/(连接|接口|申请|吗|呢)$/u, '');
}

function extractPolar(text: string): readonly PolarFact[] {
  const facts: PolarFact[] = [];
  const compact = compactSearchText(stripClauseNoise(text));
  const push = (polarity: 'pos' | 'neg', predicate: string | undefined): void => {
    if (predicate === undefined) return;
    const normalized = normalizePredicate(predicate);
    if (normalized.length < 2) return;
    facts.push(Object.freeze({ polarity, predicate: normalized }));
  };
  for (const match of compact.matchAll(/不支持([\p{L}\p{N}]{2,20})/gu)) push('neg', match[1]);
  for (const match of compact.matchAll(/支持([\p{L}\p{N}]{2,20})/gu)) {
    const index = match.index ?? 0;
    if (compact.slice(Math.max(0, index - 1), index) === '不') continue;
    push('pos', match[1]);
  }
  for (const match of compact.matchAll(/不会(?:删除|清除)([\p{L}\p{N}和]{2,30})/gu)) {
    for (const part of (match[1] ?? '').split('和')) push('pos', part);
  }
  for (const match of compact.matchAll(/([\p{L}\p{N}]{2,12})会被(?:删除|清除)/gu)) push('neg', match[1]);
  for (const match of compact.matchAll(/(?:会)?(?:删除|清除)([\p{L}\p{N}和]{2,30})/gu)) {
    const index = match.index ?? 0;
    if (compact.slice(Math.max(0, index - 2), index).includes('不')) continue;
    for (const part of (match[1] ?? '').split('和')) push('neg', part);
  }
  for (const match of compact.matchAll(/免费([\p{L}\p{N}]{2,12})/gu)) push('pos', match[1]);
  for (const match of compact.matchAll(/(?:须)?付费([\p{L}\p{N}]{2,12})/gu)) push('neg', match[1]);
  for (const match of compact.matchAll(/([\p{L}\p{N}]{2,12})还会保留/gu)) push('pos', match[1]);
  for (const match of compact.matchAll(/保留([\p{L}\p{N}]{2,20})/gu)) push('pos', match[1]);
  for (const match of compact.matchAll(/([\p{L}\p{N}]{2,12})保留/gu)) {
    if (compact.includes(`${match[1] ?? ''}还会保留`)) continue;
    if (compact.includes(`保留${match[1] ?? ''}`)) continue;
    push('pos', match[1]);
  }
  for (const match of compact.matchAll(/不接受([\p{L}\p{N}]{2,20})/gu)) push('neg', match[1]);
  for (const match of compact.matchAll(/可以申请([\p{L}\p{N}]{2,20})/gu)) push('pos', match[1]);
  if (/不退货/u.test(compact)) facts.push(Object.freeze({ polarity: 'neg' as const, predicate: '退货' }));
  else if (/退货/u.test(compact) && /可以退货/u.test(compact)) {
    facts.push(Object.freeze({ polarity: 'pos' as const, predicate: '退货' }));
  }
  for (const match of compact.matchAll(/不要([\p{L}\p{N}]{2,8})/gu)) push('neg', match[1]);
  return Object.freeze(facts);
}

function extractTime(text: string): readonly TimeFact[] {
  const compact = compactSearchText(stripClauseNoise(text));
  const facts: TimeFact[] = [];
  if (/(?:开始|入场|核销|到期)前/u.test(compact) && /可以|申请/u.test(compact)) {
    facts.push(Object.freeze({ window: 'before_start' as const, allowed: true }));
  }
  if (
    /(?:已经)?(?:开始|入场|核销|到期)后/u.test(compact)
    || /(?:开始|入场|到期)之后/u.test(compact)
    || /核销入场后/u.test(compact)
  ) {
    const denied = /不接受|不能|不[能可]/u.test(compact);
    const allowed = /可以|还能/u.test(compact) && !denied;
    if (denied) facts.push(Object.freeze({ window: 'after_start' as const, allowed: false }));
    else if (allowed) facts.push(Object.freeze({ window: 'after_start' as const, allowed: true }));
  }
  return Object.freeze(facts);
}

function extractDurations(text: string): readonly DurationFact[] {
  const facts: DurationFact[] = [];
  const compact = compactSearchText(text);
  for (const match of compact.matchAll(/([一二三四五六七八九十两\d]+)秒/gu)) {
    const amount = parseNumberToken(match[1] ?? '');
    if (amount === null) continue;
    facts.push(Object.freeze({ amount, unit: 's' as const }));
  }
  return Object.freeze(facts);
}

function extractOperations(text: string): readonly string[] {
  const compact = compactSearchText(text);
  const found: string[] = [];
  const pattern = /(更换[\p{L}\p{N}]{2,12}|恢复出厂设置|开具发票|申请发票|退回押金|申请取消|电源适配器)/gu;
  for (const match of compact.matchAll(pattern)) {
    if (match[1] !== undefined) found.push(match[1]);
  }
  return Object.freeze(found);
}

function predicatesOverlap(left: string, right: string): boolean {
  return left.length >= 2 && right.length >= 2 && (left.includes(right) || right.includes(left));
}

function directedConflict(queryFacts: readonly DirectedFact[], sourceFacts: readonly DirectedFact[]): boolean {
  for (const query of queryFacts) {
    for (const source of sourceFacts) {
      if (!predicatesOverlap(query.verb, source.verb)) continue;
      if (query.from === source.to && query.to === source.from) return true;
    }
  }
  return false;
}

function directedAligned(queryFacts: readonly DirectedFact[], sourceFacts: readonly DirectedFact[]): boolean {
  for (const query of queryFacts) {
    for (const source of sourceFacts) {
      if (!predicatesOverlap(query.verb, source.verb)) continue;
      if (query.from === source.from && query.to === source.to) return true;
    }
  }
  return false;
}

function quantityConflict(queryFacts: readonly QuantityFact[], sourceFacts: readonly QuantityFact[]): boolean {
  if (queryFacts.length === 0 || sourceFacts.length === 0) return false;
  return queryFacts.some((query) => sourceFacts.some((source) => (
    query.buy !== source.buy || query.give !== source.give
  )));
}

function polarConflict(queryFacts: readonly PolarFact[], sourceFacts: readonly PolarFact[]): boolean {
  for (const query of queryFacts) {
    for (const source of sourceFacts) {
      if (!predicatesOverlap(query.predicate, source.predicate)) continue;
      if (query.polarity !== source.polarity) return true;
    }
  }
  return false;
}

function timeConflict(queryFacts: readonly TimeFact[], sourceFacts: readonly TimeFact[]): boolean {
  for (const query of queryFacts) {
    for (const source of sourceFacts) {
      if (query.window === source.window && query.allowed !== source.allowed) return true;
    }
  }
  return false;
}

function durationConflict(queryFacts: readonly DurationFact[], sourceFacts: readonly DurationFact[]): boolean {
  if (queryFacts.length === 0 || sourceFacts.length === 0) return false;
  return queryFacts.some((query) => sourceFacts.some((source) => (
    query.unit === source.unit && query.amount !== source.amount
  )));
}

function operationMismatch(queryOps: readonly string[], sourceOps: readonly string[], sourceCompact: string): boolean {
  if (queryOps.length === 0) return false;
  return queryOps.some((operation) => {
    if (sourceCompact.includes(operation)) return false;
    return !sourceOps.some((sourceOp) => predicatesOverlap(operation, sourceOp));
  });
}

function askedObjectMissing(query: string, sourceCompact: string): boolean {
  const compact = compactSearchText(stripClauseNoise(query));
  const match = compact.match(/会(?:不会)?(?:清除|删除|改变)([\p{L}\p{N}]{2,20})/u);
  const object = match?.[1];
  if (object === undefined) return false;
  const cleaned = object.replace(/上的|中的|里的/u, '');
  if (stripFunctionWords(cleaned).length < 2) return false;
  return !sourceCompact.includes(cleaned) && !sourceCompact.includes(stripFunctionWords(cleaned));
}

function productSubjectMismatch(query: string, candidate: JudgableCandidate): boolean {
  const operation = '恢复出厂设置';
  const queryCompact = compactSearchText(query);
  const sourceCompact = compactSearchText(`${candidate.title}${candidate.answerText}`);
  const queryIndex = queryCompact.indexOf(operation);
  const sourceIndex = sourceCompact.indexOf(operation);
  if (queryIndex < 2 || sourceIndex < 2) return false;
  const querySubject = queryCompact.slice(Math.max(0, queryIndex - 4), queryIndex);
  const sourceSubject = sourceCompact.slice(Math.max(0, sourceIndex - 4), sourceIndex);
  if (querySubject.length < 2 || sourceSubject.length < 2) return false;
  return querySubject !== sourceSubject && !sourceSubject.includes(querySubject) && !querySubject.includes(sourceSubject);
}

function contentBigrams(compact: string): readonly string[] {
  return ngrams(stripFunctionWords(compact) || compact, 2);
}

function overlapScore(queryCompact: string, sourceCompact: string): number {
  const queryGrams = [...new Set(contentBigrams(queryCompact))];
  if (queryGrams.length < 2) return 0;
  const sourceGrams = new Set(ngrams(sourceCompact, 2));
  let hits = 0;
  for (const gram of queryGrams) if (sourceGrams.has(gram) || sourceCompact.includes(gram)) hits += 1;
  return hits / queryGrams.length;
}

function contentTermsPresent(queryCompact: string, sourceCompact: string): boolean {
  const stripped = stripFunctionWords(queryCompact);
  if (stripped.length < 4) return false;
  const chars = Array.from(stripped);
  const terms: string[] = [];
  for (let index = 0; index + 2 <= chars.length; index += 2) {
    terms.push(chars.slice(index, index + 2).join(''));
  }
  if (chars.length % 2 === 1 && chars.length >= 3) {
    terms.push(chars.slice(-2).join(''));
  }
  return terms.length > 0 && terms.every((term) => sourceCompact.includes(term));
}

function isPhraseMatch(queryCompact: string, queryNormalized: string, candidate: JudgableCandidate): boolean {
  const rawFields = [candidate.title, ...candidate.questionTexts, candidate.answerText, candidate.searchFallbackText];
  if (queryCompact.length === 0 && queryNormalized.length > 0) {
    return rawFields.some((field) => field.includes(queryNormalized));
  }
  if (queryCompact.length < 4) return false;
  const fields = rawFields.map(compactSearchText);
  return fields.some((field) => field.includes(queryCompact) || queryCompact.includes(field) && field.length >= 4);
}

function isExactQuestion(queryNormalized: string, candidate: JudgableCandidate): boolean {
  return candidate.questionTexts.some((question) => normalizeSearchText(question) === queryNormalized);
}

function isExactTitle(queryNormalized: string, candidate: JudgableCandidate): boolean {
  return normalizeSearchText(candidate.title) === queryNormalized;
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

function singleInfix(left: string, right: string): boolean {
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (long.length !== short.length + 1) return false;
  const longChars = Array.from(long);
  const shortText = short;
  for (let index = 0; index < longChars.length; index += 1) {
    if ([...longChars.slice(0, index), ...longChars.slice(index + 1)].join('') === shortText) return true;
  }
  return false;
}

type CandidateVerdict = Readonly<{
  scriptId: string;
  show: boolean;
  relevant: boolean;
  exactQuestion: boolean;
  exactTitle: boolean;
  originalExact: boolean;
  repairedCompact: string;
  phraseQuestion: boolean;
  phraseTitle: boolean;
  overlap: number;
  conflict: boolean;
  analysis: ConflictAnalysis;
}>;

function factsOf(text: string): Readonly<{
  directed: readonly DirectedFact[];
  quantity: readonly QuantityFact[];
  polar: readonly PolarFact[];
  time: readonly TimeFact[];
  duration: readonly DurationFact[];
  operations: readonly string[];
}> {
  return Object.freeze({
    directed: extractDirected(text),
    quantity: extractQuantities(text),
    polar: extractPolar(text),
    time: extractTime(text),
    duration: extractDurations(text),
    operations: extractOperations(text),
  });
}

const QUERY_CONDITION_MARKERS = Object.freeze([
  '前', '全', '必须', '无条件', '绝对', '保证', '以外', '之外', '竞品', '其他',
]);

function extraQueryCondition(queryCompact: string, sourceCompact: string): boolean {
  const timeWindowPresent = /(?:开始|入场|核销|到期)前|(?:开始|入场|核销|到期)后|已经开始/u.test(queryCompact);
  return QUERY_CONDITION_MARKERS.some((marker) => {
    if (timeWindowPresent && marker === '前') return false;
    return queryCompact.includes(marker) && !sourceCompact.includes(marker);
  });
}

function differentIntentOverride(queryText: string): boolean {
  const normalized = normalizeSearchText(queryText);
  return /^不要|^不是问/u.test(normalized) && /我要/u.test(normalized);
}

function unseparatedPoliteProduct(queryCompact: string, sourceCompact: string): boolean {
  for (const polite of ['你好', '您好']) {
    if (!queryCompact.startsWith(polite)) continue;
    const rest = queryCompact.slice(polite.length);
    if (rest.length >= 4 && (sourceCompact.includes(rest) || rest.includes(sourceCompact) && sourceCompact.length >= 4)) {
      return true;
    }
  }
  return false;
}

function sourceHasUniqueTypoPhrase(needle: string, sourceCompact: string): boolean {
  const needleChars = Array.from(needle);
  const sourceChars = Array.from(sourceCompact);
  if (needleChars.length < 2 || sourceChars.length < needleChars.length) return false;
  for (let index = 0; index + needleChars.length <= sourceChars.length; index += 1) {
    const slice = sourceChars.slice(index, index + needleChars.length).join('');
    if (slice === needle) return true;
    if (hamming1(slice, needle) && !isUnsafeTypoPair(slice, needle)) return true;
  }
  return false;
}

function negationMismatch(queryCompact: string, sourceCompact: string): boolean {
  const matches = queryCompact.matchAll(/不([\p{L}]{2,6})/gu);
  for (const match of matches) {
    const negated = match[1];
    if (negated === undefined) continue;
    if (/^(是|会|能|要|该)/u.test(negated)) continue;
    const original = `不${negated}`;
    if (sourceHasUniqueTypoPhrase(original, sourceCompact)) continue;
    return true;
  }
  return false;
}

function sourceBanIgnored(queryCompact: string, sourceCompact: string): boolean {
  const marker = '不要';
  let from = 0;
  while (from < sourceCompact.length) {
    const index = sourceCompact.indexOf(marker, from);
    if (index < 0) break;
    const rest = sourceCompact.slice(index + marker.length);
    for (let length = Math.min(12, rest.length); length >= 2; length -= 1) {
      const predicate = rest.slice(0, length);
      if (!queryCompact.includes(predicate)) continue;
      if (queryCompact.includes(`不要${predicate}`) || queryCompact.includes(`不${predicate}`)) continue;
      return true;
    }
    from = index + marker.length;
  }
  return false;
}

function distinctiveGrams(candidates: readonly JudgableCandidate[]): ReadonlySet<string> {
  const documentFrequency = new Map<string, number>();
  for (const candidate of candidates) {
    const unique = new Set(fieldCompacts(candidate).flatMap((field) => [...ngrams(field, 2)]));
    for (const gram of unique) {
      documentFrequency.set(gram, (documentFrequency.get(gram) ?? 0) + 1);
    }
  }
  const limit = Math.max(1, Math.floor(candidates.length * 0.3));
  const distinctive = new Set<string>();
  for (const [gram, count] of documentFrequency) {
    if (count <= limit) distinctive.add(gram);
  }
  return distinctive;
}

function isWeakGram(gram: string): boolean {
  return FUNCTION_WORDS.some((word) => word.includes(gram) || gram.includes(word))
    || gram === '合成'
    || gram === '说明'
    || gram === '流程'
    || gram === '如何'
    || gram === '什么'
    || gram === '条件';
}

function leftoverFields(candidate: JudgableCandidate): readonly string[] {
  return Object.freeze([
    compactSearchText(candidate.title),
    compactSearchText(candidate.answerText),
    ...candidate.questionTexts.map(compactSearchText),
    ...candidate.searchFallbackText.split(/\s+/u).map(compactSearchText),
  ].filter((field) => field.length > 0));
}

function leftoverUnsupported(queryCompact: string, candidate: JudgableCandidate): boolean {
  const chars = Array.from(queryCompact);
  if (chars.length === 0) return false;
  const explained = chars.map(() => false);
  const fields = leftoverFields(candidate);
  const titleQuestionGrams = new Set<string>();
  for (const field of [compactSearchText(candidate.title), ...candidate.questionTexts.map(compactSearchText)]) {
    for (const gram of ngrams(field, 2)) titleQuestionGrams.add(gram);
  }
  const allGrams = new Set<string>();
  for (const field of fields) {
    for (const gram of ngrams(field, 2)) allGrams.add(gram);
  }
  const nearbyChars = new Set(Array.from(compactSearchText(
    `${candidate.title}${candidate.answerText}${candidate.questionTexts.join('')}`,
  )));
  const markRange = (start: number, length: number): void => {
    for (let offset = 0; offset < length; offset += 1) {
      const index = start + offset;
      if (index < explained.length) explained[index] = true;
    }
  };
  for (const word of [...FUNCTION_WORDS, '也', '还', '又', '谢谢', '麻烦', '请帮我', '帮我', '查询',
    '怎么办', '请说明', '仔细了解', '换一种说法', '适用条件', '处理方式', '我想仔细了解',
    '可以换一种说法说明', '关于']) {
    const needle = Array.from(word);
    if (needle.length === 0) continue;
    for (let index = 0; index + needle.length <= chars.length; index += 1) {
      if (chars.slice(index, index + needle.length).join('') === word) markRange(index, needle.length);
    }
  }
  for (let index = 0; index + 1 < chars.length; index += 1) {
    const gram = `${chars[index]}${chars[index + 1]}`;
    if (isWeakGram(gram)) markRange(index, 2);
  }
  for (let index = 0; index + 1 < chars.length; index += 1) {
    const gram = `${chars[index]}${chars[index + 1]}`;
    if (allGrams.has(gram) || uniqueSafeHamming1(gram, titleQuestionGrams) !== undefined) markRange(index, 2);
  }
  let cursor = 0;
  while (cursor < chars.length) {
    if (explained[cursor] === true) {
      cursor += 1;
      continue;
    }
    let end = cursor;
    while (end < chars.length && explained[end] !== true) end += 1;
    const cleaned = chars.slice(cursor, end).join('').replace(/[^\p{L}\p{N}]+/gu, '');
    if (cleaned.length > 1 || (cleaned.length === 1 && !nearbyChars.has(cleaned))) return true;
    cursor = end;
  }
  return false;
}

function missingPackagingVariant(queryCompact: string, sourceCompact: string): boolean {
  for (const gram of ngrams(queryCompact, 3)) {
    if (!gram.endsWith('装') && !gram.endsWith('芯')) continue;
    if (isWeakGram(gram)) continue;
    if (!sourceCompact.includes(gram)) return true;
  }
  return false;
}

function siblingVariantMismatch(
  queryCompact: string,
  candidate: JudgableCandidate,
  pool: readonly JudgableCandidate[],
): boolean {
  const self = matchCorpus(candidate);
  for (const other of pool) {
    if (other.scriptId === candidate.scriptId) continue;
    const fields = [other.title, ...other.questionTexts].map(compactSearchText);
    for (const field of fields) {
      for (const size of [3, 2]) {
        for (const gram of ngrams(field, size)) {
          if (isWeakGram(gram)) continue;
          if (queryCompact.includes(gram) && !self.includes(gram)) return true;
        }
      }
    }
  }
  return false;
}

function substitutedObjectToken(queryCompact: string, sourceTitle: string): boolean {
  const queryChars = Array.from(queryCompact);
  const sourceChars = Array.from(sourceTitle);
  for (const objectLength of [3, 2]) {
    if (sourceChars.length < objectLength) continue;
    const object = sourceChars.slice(0, objectLength).join('');
    const tail = sourceChars.slice(objectLength).join('');
    for (let start = 0; start + objectLength <= queryChars.length; start += 1) {
      const span = queryChars.slice(start, start + objectLength).join('');
      if (span === object) continue;
      if (!hamming1(span, object) || isUnsafeTypoPair(span, object)) continue;
      const after = queryChars.slice(start + objectLength).join('');
      if (objectLength >= 3) {
        if (tail.length === 0) return true;
        if (after.startsWith(tail)) return true;
        if (after.length >= 2 && tail.startsWith(after)) return true;
        continue;
      }
      if (tail.length < 2) continue;
      if (after.startsWith(tail)) return true;
    }
  }
  return false;
}

function sharedNounPrefixMismatch(queryCompact: string, sourceTitle: string): boolean {
  for (const nounLen of [4, 3]) {
    for (let index = 0; index + nounLen <= sourceTitle.length; index += 1) {
      const noun = sourceTitle.slice(index, index + nounLen);
      const queryIndex = queryCompact.indexOf(noun);
      if (queryIndex < 2 || index < 2) continue;
      const queryPrefix = queryCompact.slice(Math.max(0, queryIndex - 3), queryIndex);
      const sourcePrefix = sourceTitle.slice(Math.max(0, index - 3), index);
      if (queryPrefix.length < 2 || sourcePrefix.length < 2) continue;
      const queryTail = queryPrefix.slice(-3);
      const sourceTail = sourcePrefix.slice(-3);
      const queryPair = queryTail.slice(-2);
      const sourcePair = sourceTail.slice(-2);
      if (queryTail === sourceTail || queryPair === sourcePair || hamming1(queryPair, sourcePair)) continue;
      if (isWeakGram(queryTail) || isWeakGram(sourceTail) || isWeakGram(queryPair) || isWeakGram(sourcePair)) continue;
      return true;
    }
  }
  return false;
}

type ConflictAnalysis = Readonly<{
  conflict: boolean;
  leftoverHit: boolean;
  polarConflict: boolean;
  sameRelArg: boolean;
  queryFacts: readonly RelationPolarFact[];
  sourceFacts: readonly RelationPolarFact[];
  exceptionEligible: boolean;
  waivedLeftover: boolean;
  requiresClarification: boolean;
}>;

function analyzeConflict(
  intent: QueryIntent,
  queryText: string,
  candidate: JudgableCandidate,
  pool: readonly JudgableCandidate[],
  repairedCompact: string,
): ConflictAnalysis {
  const sourceText = corpusOf(candidate);
  const sourceCompact = compactCorpus(candidate);
  const queryCompact = compactSearchText(queryText);
  const queryFacts = factsOf(queryText);
  const sourceFacts = factsOf(sourceText);
  const relation = analyzeRelationQuery(queryText, candidate.answerText, intent.act === 'confirmation');
  const queryRel = relation.queryFacts;
  const sourceRel = relation.sourceFacts;
  const sameRelArg = relation.sameRelArg;
  const relationPolar = relation.polarConflict;
  const inverted = directedConflict(queryFacts.directed, sourceFacts.directed)
    && !directedAligned(queryFacts.directed, sourceFacts.directed);
  const qty = quantityConflict(queryFacts.quantity, sourceFacts.quantity);
  const polar = polarConflict(queryFacts.polar, sourceFacts.polar) || relationPolar;
  const time = timeConflict(queryFacts.time, sourceFacts.time);
  const duration = durationConflict(queryFacts.duration, sourceFacts.duration);
  const ops = operationMismatch(queryFacts.operations, sourceFacts.operations, sourceCompact);
  const missing = askedObjectMissing(queryText, sourceCompact);
  const product = productSubjectMismatch(queryText, candidate);
  const extraCondition = extraQueryCondition(queryCompact, sourceCompact);
  const override = differentIntentOverride(queryText);
  const politeProduct = unseparatedPoliteProduct(queryCompact, matchCorpus(candidate));
  const negated = negationMismatch(relation.negationQuery, sourceCompact)
    || relation.unansweredConfirmation;
  const sibling = siblingVariantMismatch(queryCompact, candidate, pool);
  const prefix = sharedNounPrefixMismatch(queryCompact, compactSearchText(candidate.title));
  const packaging = missingPackagingVariant(queryCompact, matchCorpus(candidate));
  const leftoverQuery = repairedCompact.length >= 4 ? repairedCompact : queryCompact;
  const leftoverHit = leftoverUnsupported(queryCompact, candidate)
    || leftoverUnsupported(leftoverQuery, candidate);
  const effectiveLeftover = relation.requiresClarification
    ? leftoverUnsupported(relation.leftoverQuery, candidate)
    : leftoverHit;
  const leftover = effectiveLeftover && !(
    intent.act === 'confirmation'
    && (inverted || qty || polar || time || duration)
  );
  const swappedObject = substitutedObjectToken(queryCompact, compactSearchText(candidate.title));
  const ignoredBan = intent.act === 'assertion' && sourceBanIgnored(queryCompact, sourceCompact);
  const early = ops || missing || product || override || extraCondition || politeProduct || negated || sibling || prefix || packaging || leftover || swappedObject || ignoredBan;
  const assertionPolar = (intent.act === 'assertion' || intent.hasConflictingAssertionShape)
    && (inverted || qty || polar || time || duration);
  const exceptionEligible = intent.act === 'confirmation' && relationPolar;
  return Object.freeze({
    conflict: Boolean(early || assertionPolar),
    leftoverHit,
    polarConflict: relationPolar,
    sameRelArg,
    queryFacts: queryRel,
    sourceFacts: sourceRel,
    exceptionEligible,
    waivedLeftover: leftoverHit && exceptionEligible,
    requiresClarification: relation.requiresClarification,
  });
}


function sharedContentCount(
  queryCompact: string,
  sourceCompact: string,
  distinctive: ReadonlySet<string>,
): number {
  const unique = new Set(contentBigrams(queryCompact));
  let hits = 0;
  for (const gram of unique) {
    if (!distinctive.has(gram)) continue;
    if (sourceCompact.includes(gram)) hits += 1;
  }
  return hits;
}

function isRelevant(
  queryCompact: string,
  queryNormalized: string,
  candidate: JudgableCandidate,
  distinctive: ReadonlySet<string>,
): boolean {
  const sourceCompact = matchCorpus(candidate);
  if (isExactQuestion(queryNormalized, candidate) || isExactTitle(queryNormalized, candidate)) return true;
  if (isPhraseMatch(queryCompact, queryNormalized, candidate)) return true;
  if (contentTermsPresent(queryCompact, sourceCompact)) return true;
  if (sharedContentCount(queryCompact, sourceCompact, distinctive) >= 2) return true;
  return overlapScore(queryCompact, sourceCompact) >= 0.45;
}

function rankTuple(verdict: CandidateVerdict): readonly number[] {
  return Object.freeze([
    verdict.exactQuestion ? 1 : 0,
    verdict.exactTitle ? 1 : 0,
    verdict.phraseQuestion ? 1 : 0,
    verdict.phraseTitle ? 1 : 0,
    verdict.overlap,
  ]);
}

function compareVerdicts(left: CandidateVerdict, right: CandidateVerdict): number {
  const leftRank = rankTuple(left);
  const rightRank = rankTuple(right);
  for (let index = 0; index < leftRank.length; index += 1) {
    const diff = (rightRank[index] ?? 0) - (leftRank[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return left.scriptId.localeCompare(right.scriptId);
}

function dropAmbiguousVariants(
  shown: readonly CandidateVerdict[],
  queryNormalized: string,
  queryCompact: string,
  candidates: readonly JudgableCandidate[],
): readonly CandidateVerdict[] {
  const byId = new Map(candidates.map((candidate) => [candidate.scriptId, candidate]));
  const dropped = new Set<string>();
  for (let i = 0; i < shown.length; i += 1) {
    for (let j = i + 1; j < shown.length; j += 1) {
      const left = shown[i];
      const right = shown[j];
      if (left === undefined || right === undefined) continue;
      const leftTitle = compactSearchText(byId.get(left.scriptId)?.title ?? '');
      const rightTitle = compactSearchText(byId.get(right.scriptId)?.title ?? '');
      if (!(hamming1(leftTitle, rightTitle) || singleInfix(leftTitle, rightTitle))) continue;
      const leftExact = left.originalExact || queryCompact === leftTitle;
      const rightExact = right.originalExact || queryCompact === rightTitle;
      if (leftExact || rightExact) continue;
      if (
        left.repairedCompact.length >= 4
        && left.repairedCompact === right.repairedCompact
        && left.repairedCompact !== queryCompact
      ) continue;
      if (queryNormalized.length > 0 && (leftTitle.includes(queryCompact) || rightTitle.includes(queryCompact))) {
        continue;
      }
      dropped.add(left.scriptId);
      dropped.add(right.scriptId);
    }
  }
  return Object.freeze(shown.filter((verdict) => !dropped.has(verdict.scriptId)));
}

function emptyInspection(
  decision: SearchDisplayDecision,
  act: SearchInspection['act'],
): SearchInspection {
  return Object.freeze({
    decision,
    shownScriptIds: Object.freeze([]),
    act,
    shownBeforeAmbiguity: Object.freeze([]),
    shownAfterAmbiguity: Object.freeze([]),
    ambiguityEmptied: false,
    candidates: Object.freeze([]),
  });
}

/**
 * Internal pure decision trace for synthetic diagnostics; never part of HTTP.
 * The same analysis owns production decisions and the lab comparison.
 * Source arrays retain rank order; clarification never carries shown IDs.
 */
export function inspectSearch(
  rawQuery: string,
  candidates: readonly JudgableCandidate[],
): SearchInspection {
  const normalized = normalizeSearchText(rawQuery);
  const intent = interpretQuery(rawQuery);
  if (intent.act === 'underspecified' || intent.act === 'quoted') {
    return emptyInspection('clarify_or_no_result', intent.act);
  }
  if (candidates.length === 0) {
    return emptyInspection('reject', intent.act);
  }

  const originalCompact = compactSearchText(rawQuery);
  if (originalCompact.length > 0 && originalCompact.length < 3) {
    const exact = candidates.some((candidate) => (
      isExactQuestion(normalized, candidate) || isExactTitle(normalized, candidate)
    ));
    if (!exact) {
      return emptyInspection('clarify_or_no_result', intent.act);
    }
  }
  const queryForFacts = intent.clauses.join('，');
  const distinctive = distinctiveGrams(candidates);

  const verdicts: CandidateVerdict[] = candidates.map((candidate) => {
    const titleCompact = compactSearchText(candidate.title);
    const repairedCompact = substitutedObjectToken(originalCompact, titleCompact)
      ? originalCompact
      : repairUnambiguousTypos(originalCompact, repairVocabulary([candidate]));
    const repairedNormalized = repairedCompact.length > 0 ? repairedCompact : normalized;
    const overlap = overlapScore(repairedCompact, matchCorpus(candidate));
    const exactQuestion = isExactQuestion(normalized, candidate) || isExactQuestion(repairedNormalized, candidate);
    const exactTitle = isExactTitle(normalized, candidate) || isExactTitle(repairedNormalized, candidate);
    const originalExact = isExactQuestion(normalized, candidate) || isExactTitle(normalized, candidate);
    const phraseQuestion = candidate.questionTexts.some((question) => (
      compactSearchText(question).includes(repairedCompact)
    ));
    const phraseTitle = compactSearchText(candidate.title).includes(repairedCompact);
    const relevant = isRelevant(repairedCompact, normalized, candidate, distinctive)
      || isRelevant(repairedCompact, repairedNormalized, candidate, distinctive);
    const analysis = analyzeConflict(intent, queryForFacts, candidate, candidates, repairedCompact);
    const conflict = analysis.conflict;
    return Object.freeze({
      scriptId: candidate.scriptId,
      show: relevant && !conflict && !analysis.requiresClarification,
      relevant,
      exactQuestion,
      exactTitle,
      originalExact,
      repairedCompact,
      phraseQuestion,
      phraseTitle,
      overlap,
      conflict,
      analysis,
    });
  });

  const shownBefore = verdicts.filter((verdict) => verdict.show).sort(compareVerdicts);
  const shownAfter = dropAmbiguousVariants(
    shownBefore,
    normalized,
    originalCompact,
    candidates,
  );
  const decision: SearchDisplayDecision = shownAfter.length > 0
    ? 'show'
    : verdicts.some((row) => row.relevant && !row.conflict && row.analysis.requiresClarification)
      ? 'clarify_or_no_result'
      : 'reject';
  return Object.freeze({
    decision,
    shownScriptIds: Object.freeze(shownAfter.map((verdict) => verdict.scriptId)),
    act: intent.act,
    shownBeforeAmbiguity: Object.freeze(shownBefore.map((verdict) => verdict.scriptId)),
    shownAfterAmbiguity: Object.freeze(shownAfter.map((verdict) => verdict.scriptId)),
    ambiguityEmptied: shownBefore.length > 0 && shownAfter.length === 0,
    candidates: Object.freeze(verdicts.map((verdict) => Object.freeze({
      scriptId: verdict.scriptId,
      relevant: verdict.relevant,
      conflict: verdict.conflict,
      showBeforeAmbiguity: verdict.show,
      overlap: verdict.overlap,
      queryFacts: verdict.analysis.queryFacts,
      sourceFacts: verdict.analysis.sourceFacts,
      sameRelArg: verdict.analysis.sameRelArg,
      polarConflict: verdict.analysis.polarConflict,
      leftoverHit: verdict.analysis.leftoverHit,
      exceptionEligible: verdict.analysis.exceptionEligible,
      waivedLeftover: verdict.analysis.waivedLeftover,
      requiresClarification: verdict.analysis.requiresClarification,
    }))),
  });
}

export function judgeSearch(
  rawQuery: string,
  candidates: readonly JudgableCandidate[],
): JudgedSearch {
  const inspected = inspectSearch(rawQuery, candidates);
  return Object.freeze({
    decision: inspected.decision,
    shownScriptIds: inspected.shownScriptIds,
  });
}
