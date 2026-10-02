/**
 * Reciprocal rank fusion. k is injected. Scores are summed in list order so
 * repeated ranks stay bit-identical to a single left-to-right accumulation.
 */
export type RankRef = Readonly<{
  id: string;
  rank: number;
}>;

export type FusedScore = Readonly<{
  id: string;
  score: number;
}>;

export type DedupeRef = Readonly<{
  id: string;
  dedupeKey: string;
}>;

export function fuseReciprocalRanks(
  lists: readonly (readonly RankRef[])[],
  k: number,
): readonly FusedScore[] {
  const fused = new Map<string, number>();
  for (const list of lists) {
    for (const row of list) {
      fused.set(row.id, (fused.get(row.id) ?? 0) + 1 / (k + row.rank));
    }
  }
  return [...fused.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([id, score]) => ({ id, score }));
}

/**
 * Walks an already ordered score list. The limit check happens after a row is
 * accepted, which is the same loop the previous desktop ranker used.
 * Duplicate ids in `documents` keep the last dedupe key.
 */
export function takeUniqueByKey(
  ordered: readonly FusedScore[],
  documents: readonly DedupeRef[],
  limit: number,
): readonly FusedScore[] {
  const keys = new Map(documents.map((document) => [document.id, document.dedupeKey]));
  const seen = new Set<string>();
  const unique: FusedScore[] = [];
  for (const row of ordered) {
    const key = keys.get(row.id);
    if (key === undefined || seen.has(key)) continue;
    seen.add(key);
    unique.push({ id: row.id, score: row.score });
    if (unique.length >= limit) break;
  }
  return unique;
}
