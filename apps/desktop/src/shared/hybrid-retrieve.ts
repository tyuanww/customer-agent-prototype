/**
 * Desktop adapter for field-weighted BM25 + RRF.
 *
 * The formulas live in `@customer-agent/retrieval-core`. This file owns the
 * script fields, weights, RRF k, pool size, and query-slot expansion. Dense
 * ranks stay optional: a missing or failed embedding keeps the answer BM25 lane.
 *
 * RRF: score = Σ 1 / (k + rank), k = 60.
 */
import {
  buildBm25Index,
  characterUnigramBigramTerms,
  fuseReciprocalRanks,
  rankBm25,
  takeUniqueByKey,
  type Bm25Index,
  type FusedScore,
  type RankRef,
} from '@customer-agent/retrieval-core';
import { analyzeQuery, type QuerySlots } from './query-analyze.js';

export type RetrievalScript = Readonly<{
  scriptId: string;
  title: string;
  questionText: string;
  answerText: string;
  category?: string;
  questions?: readonly string[];
}>;

export type RankedRetrieval = RetrievalScript & Readonly<{ score: number }>;

export type RetrievalRank = Readonly<{ scriptId: string; rank: number }>;

const K1 = 1.2;
const B = 0.75;
const RRF_K = 60;
const DEFAULT_LIMIT = 3;
export const RETRIEVAL_POOL = 24;
const HEAD_WEIGHTS = Object.freeze([
  Object.freeze({ field: 'title', weight: 3 }),
  Object.freeze({ field: 'question', weight: 2.5 }),
]);
const ANSWER_WEIGHTS = Object.freeze([
  Object.freeze({ field: 'answer', weight: 1 }),
]);
const BM25 = Object.freeze({ k1: K1, b: B });

export function termsOf(text: string): readonly string[] {
  return Object.freeze([...characterUnigramBigramTerms(text)]);
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

function questionField(script: RetrievalScript): string {
  return [script.questionText, ...(script.questions ?? [])].filter((part) => part.length > 0).join(' ');
}

function toDocuments(scripts: readonly RetrievalScript[]) {
  return scripts.map((script) => ({
    id: script.scriptId,
    fields: [
      { name: 'title', text: script.title },
      { name: 'question', text: questionField(script) },
      { name: 'answer', text: script.answerText },
    ],
  }));
}

function termMap(terms: readonly { term: string; count: number }[]): ReadonlyMap<string, number> {
  return new Map(terms.map((row) => [row.term, row.count]));
}

function fieldStats(index: Bm25Index, name: string): { df: ReadonlyMap<string, number>; avg: number } {
  const frequency = index.documentFrequency.find((row) => row.field === name);
  const average = index.averageLength.find((row) => row.field === name);
  return {
    df: termMap(frequency?.terms ?? []),
    avg: average?.length ?? 0,
  };
}

export function buildRetrievalIndex(scripts: readonly RetrievalScript[]): RetrievalIndex {
  const index = buildBm25Index(toDocuments(scripts), characterUnigramBigramTerms);
  const title = fieldStats(index, 'title');
  const question = fieldStats(index, 'question');
  const answer = fieldStats(index, 'answer');
  const docs = scripts.map((script, offset) => {
    const indexed = index.documents[offset];
    if (!indexed || indexed.id !== script.scriptId) {
      throw new Error(`retrieval index drifted at ${script.scriptId}`);
    }
    const field = (name: string): FieldIndex => {
      const found = indexed.fields.find((item) => item.name === name);
      return Object.freeze({
        length: found?.length ?? 1,
        tf: termMap(found?.terms ?? []),
      });
    };
    return Object.freeze({
      script,
      title: field('title'),
      question: field('question'),
      answer: field('answer'),
    });
  });
  return Object.freeze({
    size: index.size,
    docs: Object.freeze(docs),
    dfTitle: title.df,
    dfQuestion: question.df,
    dfAnswer: answer.df,
    avgTitle: title.avg,
    avgQuestion: question.avg,
    avgAnswer: answer.avg,
  });
}

function expandQuery(query: string, slots: QuerySlots): string {
  if (slots.entities.length === 0) return query;
  return `${query} ${slots.entities.join(' ')}`;
}

function rankLane(
  queryTerms: readonly string[],
  index: Bm25Index,
  fieldWeights: readonly { field: string; weight: number }[],
): readonly RankRef[] {
  return rankBm25(queryTerms, index, { ...BM25, fieldWeights }).map((row) => ({
    id: row.id,
    rank: row.rank,
  }));
}

function materialize(
  ordered: readonly FusedScore[],
  scripts: readonly RetrievalScript[],
  limit: number,
): readonly RankedRetrieval[] {
  const keys = scripts.map((script) => ({ id: script.scriptId, dedupeKey: script.title }));
  const byId = new Map(scripts.map((script) => [script.scriptId, script]));
  const selected = takeUniqueByKey(ordered, keys, limit);
  const unique: RankedRetrieval[] = [];
  for (const row of selected) {
    const script = byId.get(row.id);
    if (!script) continue;
    unique.push(Object.freeze({ ...script, score: row.score }));
  }
  return Object.freeze(unique);
}

export function rankScripts(
  query: string,
  scripts: readonly RetrievalScript[],
  limit = DEFAULT_LIMIT,
  slots: QuerySlots = analyzeQuery(query),
  dense: readonly RetrievalRank[] | null = null,
): readonly RankedRetrieval[] {
  if (scripts.length === 0) return Object.freeze([]);
  const index = buildBm25Index(toDocuments(scripts), characterUnigramBigramTerms);
  const queryTerms = termsOf(expandQuery(query, slots));
  if (queryTerms.length === 0) return Object.freeze([]);
  const head = rankLane(queryTerms, index, HEAD_WEIGHTS);
  const body = dense && dense.length > 0
    ? dense.map((row) => ({ id: row.scriptId, rank: row.rank }))
    : rankLane(queryTerms, index, ANSWER_WEIGHTS);
  return materialize(fuseReciprocalRanks([head, body], RRF_K), scripts, limit);
}

export function rankScriptsMulti(
  queries: readonly string[],
  scripts: readonly RetrievalScript[],
  limit = RETRIEVAL_POOL,
  dense: readonly RetrievalRank[] | null = null,
): readonly RankedRetrieval[] {
  const uniqueQueries = [...new Set(queries.map((item) => item.trim()).filter((item) => item.length > 0))];
  if (uniqueQueries.length === 0) return Object.freeze([]);
  const first = uniqueQueries[0];
  if (uniqueQueries.length === 1 && first !== undefined) {
    return rankScripts(first, scripts, limit, analyzeQuery(first), dense);
  }
  const rankedLists = uniqueQueries.map((query) => rankScripts(query, scripts, limit, analyzeQuery(query), dense));
  const lists = rankedLists.map((list) => list.map((row, index) => ({
    id: row.scriptId,
    rank: index + 1,
  })));
  const byId = new Map<string, RankedRetrieval>();
  for (const list of rankedLists) {
    for (const row of list) if (!byId.has(row.scriptId)) byId.set(row.scriptId, row);
  }
  const selected = takeUniqueByKey(
    fuseReciprocalRanks(lists, RRF_K),
    [...byId.values()].map((row) => ({ id: row.scriptId, dedupeKey: row.title })),
    limit,
  );
  const unique: RankedRetrieval[] = [];
  for (const row of selected) {
    const script = byId.get(row.id);
    if (!script) continue;
    unique.push(Object.freeze({ ...script, score: row.score }));
  }
  return Object.freeze(unique);
}
