import { describe, expect, it } from 'vitest';
import {
  buildBm25Index,
  characterUnigramBigramTerms,
  compactAlphanumeric,
  cosineSimilarity,
  countCoveringTerms,
  fuseReciprocalRanks,
  rankBm25,
  rankByCosine,
  rowIsAdmitted,
  takeUniqueByKey,
} from '../src/index.js';

describe('character tokenizer', () => {
  it('folds case and punctuation into unigrams and adjacent bigrams', () => {
    expect(compactAlphanumeric('A-b Ｃ')).toBe('abc');
    expect(characterUnigramBigramTerms('Ab')).toEqual(['a', 'ab', 'b']);
    expect(characterUnigramBigramTerms('发-货')).toEqual(['发', '发货', '货']);
    expect(characterUnigramBigramTerms('!!!')).toEqual([]);
  });
});

describe('BM25', () => {
  it('ranks the overlapping field and applies the injected weight', () => {
    const index = buildBm25Index([
      { id: 'a', fields: [{ name: 'title', text: 'ab' }, { name: 'body', text: 'zz' }] },
      { id: 'b', fields: [{ name: 'title', text: 'cd' }, { name: 'body', text: 'ab' }] },
    ], characterUnigramBigramTerms);
    expect(JSON.parse(JSON.stringify(index))).toEqual(index);
    const titleOnly = rankBm25(characterUnigramBigramTerms('ab'), index, {
      k1: 1.2,
      b: 0.75,
      fieldWeights: [{ field: 'title', weight: 1 }],
    });
    expect(titleOnly.map((row) => row.id)).toEqual(['a']);
    expect(titleOnly[0]?.rank).toBe(1);
    const idf = Math.log(2);
    expect(titleOnly[0]?.score).toBe(idf + idf + idf);
    const weighted = rankBm25(characterUnigramBigramTerms('ab'), index, {
      k1: 1.2,
      b: 0.75,
      fieldWeights: [{ field: 'body', weight: 3 }],
    });
    expect(weighted.map((row) => row.id)).toEqual(['b']);
    const weightedTerm = idf * 3;
    expect(weighted[0]?.score).toBe(weightedTerm + weightedTerm + weightedTerm);
  });

  it('breaks equal scores by id and keeps an empty corpus serializable', () => {
    const index = buildBm25Index([
      { id: 'b', fields: [{ name: 'title', text: 'aa' }] },
      { id: 'a', fields: [{ name: 'title', text: 'aa' }] },
    ], characterUnigramBigramTerms);
    expect(rankBm25(characterUnigramBigramTerms('aa'), index, {
      k1: 1.2,
      b: 0.75,
      fieldWeights: [{ field: 'title', weight: 1 }],
    }).map((row) => row.id)).toEqual(['a', 'b']);
    const empty = buildBm25Index([], characterUnigramBigramTerms);
    expect(empty.size).toBe(1);
    expect(empty.documents).toEqual([]);
    expect(rankBm25(['a'], empty, { k1: 1.2, b: 0.75, fieldWeights: [] })).toEqual([]);
  });
});

describe('reciprocal rank fusion', () => {
  it('sums 1/(k+rank) in list order and sorts ties by id', () => {
    const fused = fuseReciprocalRanks([
      [{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }],
      [{ id: 'b', rank: 1 }, { id: 'a', rank: 2 }],
    ], 60);
    expect(fused.map((row) => row.id)).toEqual(['a', 'b']);
    expect(fused[0]?.score).toBe(1 / 61 + 1 / 62);
    expect(fused[1]?.score).toBe(fused[0]?.score);
  });

  it('adds a repeated id inside one list twice', () => {
    const fused = fuseReciprocalRanks([[
      { id: 'a', rank: 1 },
      { id: 'a', rank: 2 },
    ]], 60);
    expect(fused).toEqual([{ id: 'a', score: 1 / 61 + 1 / 62 }]);
  });
});

describe('unique selection', () => {
  it('drops a repeated dedupe key and stops after the accepted limit', () => {
    const selected = takeUniqueByKey([
      { id: 'a', score: 3 },
      { id: 'b', score: 2 },
      { id: 'c', score: 1 },
    ], [
      { id: 'a', dedupeKey: 'same' },
      { id: 'b', dedupeKey: 'same' },
      { id: 'c', dedupeKey: 'other' },
    ], 2);
    expect(selected).toEqual([
      { id: 'a', score: 3 },
      { id: 'c', score: 1 },
    ]);
  });

  it('uses the last dedupe key when an id is repeated', () => {
    const selected = takeUniqueByKey([
      { id: 'a', score: 1 },
    ], [
      { id: 'a', dedupeKey: 'first' },
      { id: 'a', dedupeKey: 'second' },
    ], 1);
    expect(selected).toEqual([{ id: 'a', score: 1 }]);
    const blocked = takeUniqueByKey([
      { id: 'b', score: 2 },
      { id: 'a', score: 1 },
    ], [
      { id: 'b', dedupeKey: 'second' },
      { id: 'a', dedupeKey: 'first' },
      { id: 'a', dedupeKey: 'second' },
    ], 2);
    expect(blocked.map((row) => row.id)).toEqual(['b']);
  });
});

describe('cosine', () => {
  it('returns 0 for empty, mismatched, or zero vectors and ranks the rest', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1], [1, 0])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
    expect(rankByCosine([1, 0, 0], [
      { id: 'far', vector: [0, 1, 0] },
      { id: 'near', vector: [0.9, 0.1, 0] },
      { id: 'tie-b', vector: [1, 0, 0] },
      { id: 'tie-a', vector: [1, 0, 0] },
    ]).map((row) => row.id)).toEqual(['tie-a', 'tie-b', 'near']);
  });
});

describe('admission floor', () => {
  it('counts distinct covering terms and applies both floors', () => {
    expect(countCoveringTerms(
      ['什么', '什么', '发货', '货'],
      ['发', '发货', '货时'],
      { minimumLength: 2, ignoredTerms: ['什么'] },
    )).toBe(1);
    expect(rowIsAdmitted(0.0125, 1, 0.0125, 1)).toBe(true);
    expect(rowIsAdmitted(0.0125, 0, 0.0125, 1)).toBe(false);
    expect(rowIsAdmitted(0.0125 / 2, 2, 0.0125, 1)).toBe(false);
  });
});
