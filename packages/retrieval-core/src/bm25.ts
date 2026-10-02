/**
 * BM25 over caller-named fields. k1, b, and per-field weights are arguments.
 * The index is JSON-serializable: term statistics only, no functions or maps.
 */
import type { TextTokenizer } from './tokenize.js';

export type TermCount = Readonly<{
  term: string;
  count: number;
}>;

export type Bm25FieldInput = Readonly<{
  name: string;
  text: string;
}>;

export type Bm25DocumentInput = Readonly<{
  id: string;
  fields: readonly Bm25FieldInput[];
}>;

export type IndexedField = Readonly<{
  name: string;
  length: number;
  terms: readonly TermCount[];
}>;

export type IndexedDocument = Readonly<{
  id: string;
  fields: readonly IndexedField[];
}>;

export type FieldTermStats = Readonly<{
  field: string;
  terms: readonly TermCount[];
}>;

export type FieldAverageLength = Readonly<{
  field: string;
  length: number;
}>;

export type Bm25Index = Readonly<{
  size: number;
  documents: readonly IndexedDocument[];
  documentFrequency: readonly FieldTermStats[];
  averageLength: readonly FieldAverageLength[];
}>;

export type FieldWeight = Readonly<{
  field: string;
  weight: number;
}>;

export type Bm25Parameters = Readonly<{
  k1: number;
  b: number;
  fieldWeights: readonly FieldWeight[];
}>;

export type RankedHit = Readonly<{
  id: string;
  rank: number;
  score: number;
}>;

function termCounts(text: string, tokenize: TextTokenizer): { length: number; terms: TermCount[] } {
  const counts = new Map<string, number>();
  const tokens = tokenize(text);
  for (const term of tokens) counts.set(term, (counts.get(term) ?? 0) + 1);
  return {
    length: Math.max(tokens.length, 1),
    terms: [...counts.entries()].map(([term, count]) => ({ term, count })),
  };
}

function fieldNamesOf(documents: readonly Bm25DocumentInput[]): readonly string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const document of documents) {
    for (const field of document.fields) {
      if (seen.has(field.name)) continue;
      seen.add(field.name);
      names.push(field.name);
    }
  }
  return names;
}

function documentFrequency(documents: readonly IndexedDocument[], field: string): TermCount[] {
  const counts = new Map<string, number>();
  for (const document of documents) {
    const indexed = document.fields.find((item) => item.name === field);
    if (!indexed) continue;
    for (const term of indexed.terms) {
      if (term.count <= 0) continue;
      counts.set(term.term, (counts.get(term.term) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([term, count]) => ({ term, count }));
}

function averageLength(documents: readonly IndexedDocument[], field: string, size: number): number {
  let sum = 0;
  for (const document of documents) {
    const indexed = document.fields.find((item) => item.name === field);
    if (!indexed) continue;
    sum += indexed.length;
  }
  return sum / size;
}

export function buildBm25Index(
  documents: readonly Bm25DocumentInput[],
  tokenize: TextTokenizer,
): Bm25Index {
  const indexedDocuments = documents.map((document) => ({
    id: document.id,
    fields: document.fields.map((field) => {
      const indexed = termCounts(field.text, tokenize);
      return { name: field.name, length: indexed.length, terms: indexed.terms };
    }),
  }));
  const size = Math.max(indexedDocuments.length, 1);
  const names = fieldNamesOf(documents);
  return {
    size,
    documents: indexedDocuments,
    documentFrequency: names.map((field) => ({
      field,
      terms: documentFrequency(indexedDocuments, field),
    })),
    averageLength: names.map((field) => ({
      field,
      length: averageLength(indexedDocuments, field, size),
    })),
  };
}

function asCountMap(terms: readonly TermCount[]): Map<string, number> {
  return new Map(terms.map((row) => [row.term, row.count]));
}

function idf(df: number, size: number): number {
  return Math.log(1 + (size - df + 0.5) / (df + 0.5));
}

function scoreField(
  queryTerms: readonly string[],
  field: IndexedField,
  df: ReadonlyMap<string, number>,
  avgLength: number,
  size: number,
  weight: number,
  parameters: Bm25Parameters,
): number {
  let score = 0;
  const seen = new Set<string>();
  const tf = asCountMap(field.terms);
  for (const term of queryTerms) {
    if (seen.has(term)) continue;
    seen.add(term);
    const freq = tf.get(term);
    if (freq === undefined || freq <= 0) continue;
    const tfNorm = (freq * (parameters.k1 + 1))
      / (freq + parameters.k1 * (1 - parameters.b + parameters.b * (field.length / Math.max(avgLength, 1))));
    score += idf(df.get(term) ?? 0, size) * tfNorm * weight;
  }
  return score;
}

export function rankBm25(
  queryTerms: readonly string[],
  index: Bm25Index,
  parameters: Bm25Parameters,
): readonly RankedHit[] {
  const weights = new Map(parameters.fieldWeights.map((row) => [row.field, row.weight]));
  const dfByField = new Map(index.documentFrequency.map((row) => [row.field, asCountMap(row.terms)]));
  const avgByField = new Map(index.averageLength.map((row) => [row.field, row.length]));
  const scored = index.documents
    .map((document) => {
      let score = 0;
      for (const field of document.fields) {
        const weight = weights.get(field.name);
        if (weight === undefined) continue;
        score += scoreField(
          queryTerms,
          field,
          dfByField.get(field.name) ?? new Map(),
          avgByField.get(field.name) ?? 0,
          index.size,
          weight,
          parameters,
        );
      }
      return { id: document.id, score };
    })
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  return scored.map((row, offset) => ({ id: row.id, rank: offset + 1, score: row.score }));
}
