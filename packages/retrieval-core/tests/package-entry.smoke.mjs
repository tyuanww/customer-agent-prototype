import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBm25Index,
  characterUnigramBigramTerms,
  cosineSimilarity,
  fuseReciprocalRanks,
  rankBm25,
} from '@customer-agent/retrieval-core';

test('compiled retrieval-core entry ranks a serializable corpus', () => {
  assert.deepEqual(characterUnigramBigramTerms('ab'), ['a', 'ab', 'b']);
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  const fused = fuseReciprocalRanks([
    [{ id: 'a', rank: 1 }],
    [{ id: 'a', rank: 1 }],
  ], 60);
  assert.equal(fused[0]?.id, 'a');
  assert.equal(fused[0]?.score, 2 / 61);
  const index = buildBm25Index([
    { id: 'a', fields: [{ name: 'title', text: 'ab' }] },
    { id: 'b', fields: [{ name: 'title', text: 'cd' }] },
  ], characterUnigramBigramTerms);
  const ranked = rankBm25(characterUnigramBigramTerms('ab'), index, {
    k1: 1.2,
    b: 0.75,
    fieldWeights: [{ field: 'title', weight: 1 }],
  });
  assert.equal(ranked[0]?.id, 'a');
  assert.equal(ranked.some((row) => row.id === 'b'), false);
  assert.equal(JSON.parse(JSON.stringify(index)).size, index.size);
});
