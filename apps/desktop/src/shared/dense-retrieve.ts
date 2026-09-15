/**
 * Dense second-lane ranks for hybrid RRF. Vectors live off-repo and bind to
 * sha256(answerText) plus the embedding model id. Callers fuse these ranks
 * with BM25 title/question; they must not send answer text to chat models.
 */
import { createHash } from 'node:crypto';

export const DENSE_MODEL_EMBO = 'embo-01';
export const DENSE_CATALOG_VERSION = 1;

export type DenseVectorRow = Readonly<{
  scriptId: string;
  contentHash: string;
  vector: readonly number[];
}>;

export type DenseCatalog = Readonly<{
  version: number;
  model: string;
  dim: number;
  rows: readonly DenseVectorRow[];
}>;

export type DenseRank = Readonly<{ scriptId: string; rank: number }>;

export function answerContentHash(answerText: string): string {
  return createHash('sha256').update(answerText, 'utf8').digest('hex');
}

export function cosine(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm <= 0 || rightNorm <= 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function rankDense(
  queryVector: readonly number[],
  rows: readonly DenseVectorRow[],
): readonly DenseRank[] {
  const scored = rows
    .map((row) => ({ scriptId: row.scriptId, score: cosine(queryVector, row.vector) }))
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.scriptId.localeCompare(right.scriptId));
  return Object.freeze(scored.map((row, offset) => Object.freeze({ scriptId: row.scriptId, rank: offset + 1 })));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseDenseCatalog(raw: string): DenseCatalog | null {
  const value: unknown = JSON.parse(raw);
  const record = asRecord(value);
  if (!record) return null;
  const version = Reflect.get(record, 'version');
  const model = Reflect.get(record, 'model');
  const dim = Reflect.get(record, 'dim');
  const rowsRaw = Reflect.get(record, 'rows') ?? Reflect.get(record, 'scripts');
  if (version !== DENSE_CATALOG_VERSION) return null;
  if (typeof model !== 'string' || model.trim().length === 0) return null;
  if (!Number.isInteger(dim) || Number(dim) < 2 || Number(dim) > 4096) return null;
  if (!Array.isArray(rowsRaw)) return null;
  const rows: DenseVectorRow[] = [];
  const seen = new Set<string>();
  for (const item of rowsRaw) {
    const row = asRecord(item);
    if (!row) continue;
    const scriptId = Reflect.get(row, 'scriptId');
    const contentHash = Reflect.get(row, 'contentHash');
    const vectorRaw = Reflect.get(row, 'vector');
    if (typeof scriptId !== 'string' || scriptId.length < 1 || scriptId.length > 128) continue;
    if (typeof contentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(contentHash)) continue;
    if (!Array.isArray(vectorRaw) || vectorRaw.length !== dim) continue;
    if (vectorRaw.some((cell) => typeof cell !== 'number' || !Number.isFinite(cell))) continue;
    if (seen.has(scriptId)) continue;
    seen.add(scriptId);
    rows.push(Object.freeze({
      scriptId,
      contentHash,
      vector: Object.freeze([...vectorRaw] as number[]),
    }));
  }
  if (rows.length === 0) return null;
  return Object.freeze({
    version: DENSE_CATALOG_VERSION,
    model: model.trim(),
    dim: Number(dim),
    rows: Object.freeze(rows),
  });
}

export function serializeDenseCatalog(catalog: DenseCatalog): string {
  return `${JSON.stringify({
    version: catalog.version,
    model: catalog.model,
    dim: catalog.dim,
    rows: catalog.rows.map((row) => ({
      scriptId: row.scriptId,
      contentHash: row.contentHash,
      vector: [...row.vector],
    })),
  })}\n`;
}

export function matchingDenseRows(
  catalog: DenseCatalog,
  scripts: readonly Readonly<{ scriptId: string; answerText: string }>[],
): readonly DenseVectorRow[] {
  const byId = new Map(catalog.rows.map((row) => [row.scriptId, row]));
  const matched: DenseVectorRow[] = [];
  for (const script of scripts) {
    const row = byId.get(script.scriptId);
    if (!row) continue;
    if (row.contentHash !== answerContentHash(script.answerText)) continue;
    if (row.vector.length !== catalog.dim) continue;
    matched.push(row);
  }
  return Object.freeze(matched);
}
