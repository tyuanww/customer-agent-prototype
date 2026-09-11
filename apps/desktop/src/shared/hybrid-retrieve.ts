/**
 * Field-weighted BM25 + RRF. Two sparse lists (title/question vs answer) are
 * fused by reciprocal rank; a later dense embedding list can replace the
 * answer list without changing callers.
 *
 * RRF: score = Σ 1 / (k + rank), k = 60. Azure and Elasticsearch both use
 * this fusion so BM25 and vector scores never have to be normalized together.
 */
import { analyzeQuery, compactQueryText, type QuerySlots } from './query-analyze.js';

export type RetrievalScript = Readonly<{
  scriptId: string;
  title: string;
  questionText: string;
  answerText: string;
  category?: string;
  questions?: readonly string[];
}>;

export type RankedRetrieval = RetrievalScript & Readonly<{ score: number }>;

const K1 = 1.2;
const B = 0.75;
const RRF_K = 60;
const DEFAULT_LIMIT = 3;
export const RETRIEVAL_POOL = 24;
const TITLE_BOOST = 3;
const QUESTION_BOOST = 2.5;
const ANSWER_BOOST = 1;

export function termsOf(text: string): readonly string[] {
  const compact = compactQueryText(text);
  const chars = Array.from(compact);
  if (chars.length === 0) return Object.freeze([]);
  const terms: string[] = [];
  for (let index = 0; index < chars.length; index += 1) {
    terms.push(chars[index] ?? '');
    if (index + 1 < chars.length) terms.push(`${chars[index]}${chars[index + 1]}`);
  }
  return Object.freeze(terms.filter((term) => term.length > 0));
}

type FieldIndex = Readonly<{
  length: number;
  tf: ReadonlyMap<string, number>;
}>;

type DocIndex = Readonly<{
  script: RetrievalScript;
  title: FieldIndex;
  question: FieldIndex;
  answer: FieldIndex;
}>;

export type RetrievalIndex = Readonly<{
  size: number;
  docs: readonly DocIndex[];
  dfTitle: ReadonlyMap<string, number>;
  dfQuestion: ReadonlyMap<string, number>;
  dfAnswer: ReadonlyMap<string, number>;
  avgTitle: number;
  avgQuestion: number;
  avgAnswer: number;
}>;

function fieldIndex(text: string): FieldIndex {
  const tf = new Map<string, number>();
  const terms = termsOf(text);
  for (const term of terms) tf.set(term, (tf.get(term) ?? 0) + 1);
  return Object.freeze({ length: Math.max(terms.length, 1), tf });
}

function addDf(df: Map<string, number>, field: FieldIndex): void {
  for (const term of field.tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
}

export function buildRetrievalIndex(scripts: readonly RetrievalScript[]): RetrievalIndex {
  const dfTitle = new Map<string, number>();
  const dfQuestion = new Map<string, number>();
  const dfAnswer = new Map<string, number>();
  const docs = scripts.map((script) => {
    const title = fieldIndex(script.title);
    const question = fieldIndex([script.questionText, ...(script.questions ?? [])].filter((part) => part.length > 0).join(' '));
    const answer = fieldIndex(script.answerText);
    addDf(dfTitle, title);
    addDf(dfQuestion, question);
    addDf(dfAnswer, answer);
    return Object.freeze({ script, title, question, answer });
  });
  const size = Math.max(docs.length, 1);
  const avg = (pick: (doc: DocIndex) => number) => docs.reduce((sum, doc) => sum + pick(doc), 0) / size;
  return Object.freeze({
    size,
    docs: Object.freeze(docs),
    dfTitle,
    dfQuestion,
    dfAnswer,
    avgTitle: avg((doc) => doc.title.length),
    avgQuestion: avg((doc) => doc.question.length),
    avgAnswer: avg((doc) => doc.answer.length),
  });
}

function idf(df: number, size: number): number {
  return Math.log(1 + (size - df + 0.5) / (df + 0.5));
}

function bm25Field(
  queryTerms: readonly string[],
  field: FieldIndex,
  df: ReadonlyMap<string, number>,
  avgLength: number,
  size: number,
  boost: number,
): number {
  let score = 0;
  const seen = new Set<string>();
  for (const term of queryTerms) {
    if (seen.has(term)) continue;
    seen.add(term);
    const freq = field.tf.get(term);
    if (freq === undefined || freq <= 0) continue;
    const tfNorm = (freq * (K1 + 1)) / (freq + K1 * (1 - B + B * (field.length / Math.max(avgLength, 1))));
    score += idf(df.get(term) ?? 0, size) * tfNorm * boost;
  }
  return score;
}

function bm25Score(
  queryTerms: readonly string[],
  doc: DocIndex,
  index: RetrievalIndex,
  parts: Readonly<{ title: boolean; question: boolean; answer: boolean }>,
): number {
  let score = 0;
  if (parts.title) {
    score += bm25Field(queryTerms, doc.title, index.dfTitle, index.avgTitle, index.size, TITLE_BOOST);
  }
  if (parts.question) {
    score += bm25Field(queryTerms, doc.question, index.dfQuestion, index.avgQuestion, index.size, QUESTION_BOOST);
  }
  if (parts.answer) {
    score += bm25Field(queryTerms, doc.answer, index.dfAnswer, index.avgAnswer, index.size, ANSWER_BOOST);
  }
  return score;
}

function rankedList(
  queryTerms: readonly string[],
  index: RetrievalIndex,
  parts: Readonly<{ title: boolean; question: boolean; answer: boolean }>,
): readonly { scriptId: string; rank: number }[] {
  const scored = index.docs
    .map((doc) => ({ scriptId: doc.script.scriptId, score: bm25Score(queryTerms, doc, index, parts) }))
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.scriptId.localeCompare(right.scriptId));
  return Object.freeze(scored.map((row, offset) => ({ scriptId: row.scriptId, rank: offset + 1 })));
}

function rrf(lists: readonly (readonly { scriptId: string; rank: number }[])[]): Map<string, number> {
  const fused = new Map<string, number>();
  for (const list of lists) {
    for (const row of list) {
      fused.set(row.scriptId, (fused.get(row.scriptId) ?? 0) + 1 / (RRF_K + row.rank));
    }
  }
  return fused;
}

function expandQuery(query: string, slots: QuerySlots): string {
  if (slots.entities.length === 0) return query;
  return `${query} ${slots.entities.join(' ')}`;
}

export function rankScripts(
  query: string,
  scripts: readonly RetrievalScript[],
  limit = DEFAULT_LIMIT,
  slots: QuerySlots = analyzeQuery(query),
): readonly RankedRetrieval[] {
  if (scripts.length === 0) return Object.freeze([]);
  const index = buildRetrievalIndex(scripts);
  const queryTerms = termsOf(expandQuery(query, slots));
  if (queryTerms.length === 0) return Object.freeze([]);
  const head = rankedList(queryTerms, index, { title: true, question: true, answer: false });
  const body = rankedList(queryTerms, index, { title: false, question: false, answer: true });
  const fused = rrf([head, body]);
  const byId = new Map(index.docs.map((doc) => [doc.script.scriptId, doc.script]));
  const ordered = [...fused.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const unique: RankedRetrieval[] = [];
  const titles = new Set<string>();
  for (const [scriptId, score] of ordered) {
    const script = byId.get(scriptId);
    if (!script || titles.has(script.title)) continue;
    titles.add(script.title);
    unique.push(Object.freeze({ ...script, score }));
    if (unique.length >= limit) break;
  }
  return Object.freeze(unique);
}

export function rankScriptsMulti(
  queries: readonly string[],
  scripts: readonly RetrievalScript[],
  limit = RETRIEVAL_POOL,
): readonly RankedRetrieval[] {
  const uniqueQueries = [...new Set(queries.map((item) => item.trim()).filter((item) => item.length > 0))];
  if (uniqueQueries.length === 0) return Object.freeze([]);
  if (uniqueQueries.length === 1) return rankScripts(uniqueQueries[0] ?? '', scripts, limit);
  const rankedLists = uniqueQueries.map((query) => rankScripts(query, scripts, limit));
  const lists = rankedLists.map((list) => list.map((row, index) => ({
    scriptId: row.scriptId,
    rank: index + 1,
  })));
  const fused = rrf(lists);
  const byId = new Map<string, RankedRetrieval>();
  for (const list of rankedLists) {
    for (const row of list) if (!byId.has(row.scriptId)) byId.set(row.scriptId, row);
  }
  const ordered = [...fused.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const unique: RankedRetrieval[] = [];
  const titles = new Set<string>();
  for (const [scriptId, score] of ordered) {
    const script = byId.get(scriptId);
    if (!script || titles.has(script.title)) continue;
    titles.add(script.title);
    unique.push(Object.freeze({ ...script, score }));
    if (unique.length >= limit) break;
  }
  return Object.freeze(unique);
}
