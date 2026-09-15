/**
 * Local retrieval abstention. Does not call leftover judgeSearch and does not
 * use a folk cosine cutoff (0.7).
 *
 * Evidence:
 * - RRF k=60 (Azure / Elasticsearch fusion); a one-lane rank-20 score is 1/80.
 * - Coverage is query bigrams against title + questions, never answer body
 *   (body overlap is how ingredient lists beat "毛孔清洁"-style queries).
 * - Microsoft / RAG abstention practice: refuse when retrieval evidence is
 *   weak rather than always returning Top 3.
 */
import { termsOf, type RankedRetrieval } from './hybrid-retrieve.ts';

const RRF_K = 60;
export const MIN_RRF_SCORE = 1 / (RRF_K + 20);
export const MIN_QUERY_BIGRAM_HITS = 1;
const STOP_BIGRAMS = new Set([
  '什么', '怎么', '可以', '一下', '这个', '那个', '有没', '没有', '是不', '不是',
  '还是', '还有', '一个', '我们', '你们', '亲爱', '的话', '是否', '哪种',
]);

function documentAskText(row: RankedRetrieval): string {
  return `${row.title}\n${row.questionText}\n${(row.questions ?? []).join('\n')}`;
}

export function queryBigramHits(query: string, document: string): number {
  const doc = new Set(termsOf(document).filter((term) => term.length >= 2));
  const seen = new Set<string>();
  let hits = 0;
  for (const term of termsOf(query)) {
    if (term.length < 2 || STOP_BIGRAMS.has(term) || seen.has(term)) continue;
    seen.add(term);
    if (doc.has(term)) hits += 1;
  }
  return hits;
}

export function admitRetrieval(
  query: string,
  ranked: readonly RankedRetrieval[],
): readonly RankedRetrieval[] {
  const kept = ranked.filter((row) => (
    row.score >= MIN_RRF_SCORE
    && queryBigramHits(query, documentAskText(row)) >= MIN_QUERY_BIGRAM_HITS
  ));
  return Object.freeze(kept);
}
