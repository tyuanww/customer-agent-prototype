/**
 * E3 offline dense lane. The always-on cases check the fusion and the vector
 * file parser. The measurement runs only when CUSTOMER_AGENT_DENSE_EVAL=1 and
 * CUSTOMER_AGENT_DENSE_EVAL_FILE points at a local vector file.
 *
 * The vector file is produced by scripts/embed-eval-corpus.py. That script
 * must not call MiniMax. This test does not import the production pipeline.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { rankByCosine } from '@customer-agent/retrieval-core';
import corpusDocument from '../fixtures/retrieval-eval/corpus.json';
import casesDocument from '../fixtures/retrieval-eval/cases.json';
import { rankScripts, rankScriptsMulti, RETRIEVAL_POOL, type RetrievalRank, type RetrievalScript } from '../../src/shared/hybrid-retrieve';
import { admitRetrieval } from '../../src/shared/retrieval-quality';

const MEASURE = process.env.CUSTOMER_AGENT_DENSE_EVAL === '1';
const VECTOR_FILE = process.env.CUSTOMER_AGENT_DENSE_EVAL_FILE ?? '/tmp/ca-dense-eval.json';
const DEV_SHARE = 2;

type CorpusScript = RetrievalScript & { readonly category: string; readonly platform: string };
type EvalCase = Readonly<{ id: string; query: string; expected: string | null; category: string; platform: string; split: 'dev' | 'test' }>;
type VectorRow = Readonly<{ id: string; vector: readonly number[] }>;
type DenseFile = Readonly<{
  model: string;
  rerankModel: string | null;
  rerankError: string | null;
  device: string;
  dim: number;
  host: string;
  peakBytes: number;
  acceleratorPeakBytes: number | null;
  scripts: readonly VectorRow[];
  queries: readonly VectorRow[];
  rerank: ReadonlyMap<string, readonly string[]>;
}>;
type Tally = { positives: number; top3: number; reciprocalRank: number; negatives: number; abstained: number };

const corpus = (corpusDocument as { scripts: CorpusScript[] }).scripts;
const cases = (casesDocument as { positives: Record<string, string[]>; negatives: string[] });
const byId = new Map(corpus.map((script) => [script.scriptId, script]));

function splitOf(scriptId: string): 'dev' | 'test' {
  const digest = createHash('sha256').update(scriptId).digest();
  return (digest[0]! % 5) < DEV_SHARE ? 'dev' : 'test';
}

function buildCases(): EvalCase[] {
  const built: EvalCase[] = [];
  for (const [scriptId, queries] of Object.entries(cases.positives)) {
    const script = byId.get(scriptId);
    if (!script) throw new Error(`cases.json names an unknown script: ${scriptId}`);
    for (const [offset, query] of queries.entries()) {
      built.push({
        id: `${scriptId}#${String(offset + 1)}`,
        query,
        expected: scriptId,
        category: script.category,
        platform: script.platform,
        split: splitOf(scriptId),
      });
    }
  }
  for (const [offset, query] of cases.negatives.entries()) {
    built.push({
      id: `negative#${String(offset + 1)}`,
      query,
      expected: null,
      category: 'negative',
      platform: 'any',
      split: offset % 5 < DEV_SHARE ? 'dev' : 'test',
    });
  }
  return built;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function paidModel(model: string): boolean {
  const lowered = model.toLowerCase();
  return lowered.includes('minimax') || lowered.includes('embo');
}

function readVectors(value: unknown, key: string): VectorRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: VectorRow[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) return null;
    const id = record[key];
    const vector = record.vector;
    if (typeof id !== 'string' || id.length < 1) return null;
    if (!Array.isArray(vector) || vector.some((cell) => typeof cell !== 'number' || !Number.isFinite(cell))) return null;
    rows.push({ id, vector });
  }
  return rows;
}

export function parseDenseEvalFile(raw: string): DenseFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (!record) return null;
  const model = record.model;
  const device = record.device;
  const dim = record.dim;
  const host = record.host;
  const peakBytes = record.peakBytes;
  if (typeof model !== 'string' || paidModel(model)) return null;
  if (typeof device !== 'string' || typeof host !== 'string') return null;
  if (!Number.isInteger(dim) || Number(dim) < 2) return null;
  if (!Number.isInteger(peakBytes) || Number(peakBytes) < 0) return null;
  const rerankModel = record.rerankModel;
  if (rerankModel !== null && (typeof rerankModel !== 'string' || paidModel(rerankModel))) return null;
  const rerankError = record.rerankError;
  if (rerankError !== null && typeof rerankError !== 'string') return null;
  const accelerator = record.acceleratorPeakBytes;
  if (accelerator !== null && (!Number.isInteger(accelerator) || Number(accelerator) < 0)) return null;
  const scripts = readVectors(record.scripts, 'scriptId');
  const queries = readVectors(record.queries, 'id');
  if (!scripts || !queries) return null;
  if (scripts.some((row) => row.vector.length !== dim) || queries.some((row) => row.vector.length !== dim)) return null;
  const rerank = new Map<string, readonly string[]>();
  const rerankRaw = record.rerank;
  if (!Array.isArray(rerankRaw)) return null;
  for (const item of rerankRaw) {
    const row = asRecord(item);
    if (!row || typeof row.id !== 'string' || !Array.isArray(row.orderedIds)) return null;
    if (row.orderedIds.some((id) => typeof id !== 'string')) return null;
    rerank.set(row.id, row.orderedIds as string[]);
  }
  return {
    model,
    rerankModel,
    rerankError,
    device,
    dim: Number(dim),
    host,
    peakBytes: Number(peakBytes),
    acceleratorPeakBytes: accelerator === null ? null : Number(accelerator),
    scripts,
    queries,
    rerank,
  };
}

function reorder<T extends RetrievalScript>(ranked: readonly T[], orderedIds: readonly string[] | undefined): T[] {
  if (!orderedIds || orderedIds.length === 0) return ranked;
  const byScript = new Map(ranked.map((row) => [row.scriptId, row]));
  const next = [];
  for (const id of orderedIds) {
    const row = byScript.get(id);
    if (!row) continue;
    next.push(row);
    byScript.delete(id);
  }
  for (const row of ranked) if (byScript.has(row.scriptId)) next.push(row);
  return next;
}

function emptyTally(): Tally {
  return { positives: 0, top3: 0, reciprocalRank: 0, negatives: 0, abstained: 0 };
}

function evaluate(selected: readonly EvalCase[], vectors: DenseFile, useRerank: boolean): Tally {
  const scriptVectors = vectors.scripts.map((row) => ({ id: row.id, vector: row.vector }));
  const queries = new Map(vectors.queries.map((row) => [row.id, row.vector]));
  const tally = emptyTally();
  for (const item of selected) {
    const queryVector = queries.get(item.id);
    if (!queryVector) throw new Error(`missing query vector ${item.id}`);
    const dense: RetrievalRank[] = rankByCosine(queryVector, scriptVectors).map((row) => ({
      scriptId: row.id,
      rank: row.rank,
    }));
    let ranked = rankScriptsMulti([item.query], corpus, RETRIEVAL_POOL, dense);
    if (useRerank) ranked = reorder(ranked, vectors.rerank.get(item.id));
    const admitted = admitRetrieval(item.query, ranked);
    if (item.expected === null) {
      tally.negatives += 1;
      if (admitted.length === 0) tally.abstained += 1;
    } else {
      tally.positives += 1;
      const position = admitted.slice(0, 3).findIndex((row) => row.scriptId === item.expected);
      if (position >= 0) {
        tally.top3 += 1;
        tally.reciprocalRank += 1 / (position + 1);
      }
    }
  }
  return tally;
}

function percent(numerator: number, denominator: number): string {
  return denominator === 0 ? 'n/a' : `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function line(label: string, tally: Tally): string {
  const mrr = tally.positives === 0 ? 'n/a' : (tally.reciprocalRank / tally.positives).toFixed(3);
  return `${label} positives=${String(tally.positives)} top3=${percent(tally.top3, tally.positives)} mrr=${mrr} negatives=${String(tally.negatives)} abstain=${percent(tally.abstained, tally.negatives)}`;
}

describe('dense answer lane', () => {
  it('replaces the answer BM25 lane when dense ranks are present', () => {
    const scripts: RetrievalScript[] = [
      { scriptId: 'a', title: '甲甲', questionText: '甲甲问题', answerText: '特别的句子' },
      { scriptId: 'b', title: '乙乙', questionText: '乙乙问题', answerText: '另一句话' },
    ];
    const without = rankScripts('特别的句子', scripts, 2);
    const withDense = rankScripts('特别的句子', scripts, 2, undefined, [
      { scriptId: 'b', rank: 1 },
      { scriptId: 'a', rank: 2 },
    ]);
    expect(without[0]?.scriptId).toBe('a');
    expect(withDense[0]?.scriptId).toBe('b');
  });

  it('rejects a paid model and a vector of the wrong length', () => {
    expect(parseDenseEvalFile(JSON.stringify({
      model: 'embo-01', device: 'cpu', dim: 2, host: 'test', peakBytes: 0,
      rerankModel: null, rerankError: null, acceleratorPeakBytes: null,
      scripts: [{ scriptId: 'a', vector: [1, 0] }],
      queries: [{ id: 'a#1', vector: [1, 0] }],
      rerank: [],
    }))).toBeNull();
    expect(parseDenseEvalFile(JSON.stringify({
      model: 'Qwen/Qwen3-Embedding-0.6B', device: 'cpu', dim: 2, host: 'test', peakBytes: 0,
      rerankModel: null, rerankError: null, acceleratorPeakBytes: null,
      scripts: [{ scriptId: 'a', vector: [1] }],
      queries: [],
      rerank: [],
    }))).toBeNull();
  });

  it('keeps the embed script off the MiniMax client', () => {
    const source = readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../../scripts/embed-eval-corpus.py'), 'utf8');
    expect(source).toContain('refusing paid embedding model');
    expect(source).not.toContain('embedRetrievalIndex');
    expect(source).not.toContain('embo-01');
  });
});

describe.skipIf(!MEASURE)('local embedding measurement', () => {
  it('scores held-out cases from the local vector file', () => {
    const vectors = parseDenseEvalFile(readFileSync(VECTOR_FILE, 'utf8'));
    expect(vectors).not.toBeNull();
    if (!vectors) return;
    const all = buildCases();
    const heldOut = all.filter((item) => item.split === 'test');
    const dev = all.filter((item) => item.split === 'dev');
    const denseHeld = evaluate(heldOut, vectors, false);
    const denseDev = evaluate(dev, vectors, false);
    console.log(`model=${vectors.model} device=${vectors.device} host=${vectors.host} dim=${String(vectors.dim)}`);
    console.log(`peakBytes=${String(vectors.peakBytes)} acceleratorPeakBytes=${String(vectors.acceleratorPeakBytes)}`);
    console.log(line('held-out dense', denseHeld));
    console.log(line('dev dense', denseDev));
    expect(denseHeld.positives).toBeGreaterThanOrEqual(150);
    expect(denseHeld.negatives).toBeGreaterThanOrEqual(25);
    if (vectors.rerank.size > 0) {
      console.log(`rerank=${vectors.rerankModel ?? 'none'}`);
      console.log(line('held-out rerank', evaluate(heldOut, vectors, true)));
      console.log(line('dev rerank', evaluate(dev, vectors, true)));
    } else if (vectors.rerankError) {
      console.log(`rerank skipped: ${vectors.rerankError}`);
    }
  }, 120_000);
});
