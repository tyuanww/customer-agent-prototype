import type { RankedHit } from './bm25.js';

export type VectorRow = Readonly<{
  id: string;
  vector: readonly number[];
}>;

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm <= 0 || rightNorm <= 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function rankByCosine(
  query: readonly number[],
  rows: readonly VectorRow[],
): readonly RankedHit[] {
  const scored = rows
    .map((row) => ({ id: row.id, score: cosineSimilarity(query, row.vector) }))
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  return scored.map((row, offset) => ({ id: row.id, rank: offset + 1, score: row.score }));
}
