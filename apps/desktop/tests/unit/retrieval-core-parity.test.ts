// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cosine, rankDense } from '../../src/shared/dense-retrieve';
import { rankScripts, rankScriptsMulti, termsOf, type RetrievalScript } from '../../src/shared/hybrid-retrieve';
import { analyzeQuery, compactQueryText } from '../../src/shared/query-analyze';
import { admitRetrieval, MIN_RRF_SCORE, queryBigramHits } from '../../src/shared/retrieval-quality';
import snapshot from './retrieval-freeze-snapshot.json';

const corpus: readonly RetrievalScript[] = Object.freeze([
  Object.freeze({
    scriptId: 'ship-express',
    title: '发货快递',
    questionText: '发货快递',
    answerText: '订单付款后四十八小时内发出，物流单号同步到订单页。',
    category: 'presale',
  }),
  Object.freeze({
    scriptId: 'eta',
    title: '到货时效',
    questionText: '到货时效',
    answerText: '一般三到五天送达，偏远地区可能更久。',
    category: 'presale',
  }),
  Object.freeze({
    scriptId: 'address',
    title: '改地址',
    questionText: '改地址',
    answerText: '未发货前可以修改一次收货地址。',
    category: 'presale',
  }),
  Object.freeze({
    scriptId: 'mask',
    title: '面膜适用人群',
    questionText: '面膜适用人群',
    answerText: '敏感肌也能用，建议先在耳后试用。',
    category: 'product',
    questions: ['敏感肌可以用吗', '这款面膜适合什么人'],
  }),
]);

function currentFreeze() {
  const queries = ['什么时候发货啊', '这款面膜敏感肌可以用吗', '我填错地址了能不能改', '四十八小时内发出', '!!!', ''];
  return {
    minRrf: MIN_RRF_SCORE,
    cosine: {
      same: cosine([1, 0], [1, 0]),
      orthogonal: cosine([1, 0], [0, 1]),
      mismatch: cosine([1, 0], [1, 0, 0]),
      empty: cosine([], []),
      zero: cosine([0, 0], [1, 2]),
    },
    dense: rankDense([1, 0, 0], [
      { scriptId: 'addr', contentHash: 'a'.repeat(64), vector: [0, 1, 0] },
      { scriptId: 'ship', contentHash: 'b'.repeat(64), vector: [0.9, 0.1, 0] },
      { scriptId: 'tie-b', contentHash: 'c'.repeat(64), vector: [1, 0, 0] },
      { scriptId: 'tie-a', contentHash: 'd'.repeat(64), vector: [1, 0, 0] },
    ]),
    single: Object.fromEntries(queries.map((query) => [query, rankScripts(query, corpus)])),
    top1: rankScripts('什么时候发货啊', corpus, 1),
    denseOverride: rankScripts('四十八小时内发出', corpus, 3, analyzeQuery('四十八小时内发出'), [
      { scriptId: 'address', rank: 1 },
    ]),
    multi: rankScriptsMulti(['什么时候发货啊', '我填错地址了能不能改'], corpus, 4),
    multiSingle: rankScriptsMulti(['什么时候发货啊'], corpus),
    multiBlank: rankScriptsMulti(['', '  '], corpus),
    duplicates: rankScripts('发货', [
      { scriptId: 'b', title: '发货快递', questionText: '发货', answerText: '后发' },
      { scriptId: 'a', title: '发货快递', questionText: '发货', answerText: '先发' },
    ]),
    emptyCorpus: rankScripts('发货', []),
    admit: {
      keep: admitRetrieval('什么时候发货', [{
        scriptId: 'ship', title: '发货时效', questionText: '几天能到', answerText: '', score: 0.03,
      }]),
      bodyOnly: admitRetrieval('排骨汤还有吗', [{
        scriptId: 'inci', title: '发货时效', questionText: '什么时候发货', answerText: '仓库有排骨汤配料清单一并发出', score: 0.03,
      }]),
      low: admitRetrieval('虚构星球食堂', [{
        scriptId: 'ship', title: '改地址', questionText: '', answerText: '', score: MIN_RRF_SCORE / 2,
      }]),
      floor: admitRetrieval('发货时效', [{
        scriptId: 'ship', title: '发货时效', questionText: '', answerText: '', score: MIN_RRF_SCORE,
      }]),
      hits: queryBigramHits('什么时候发货', '发货时效'),
      stop: queryBigramHits('有没有', '你们有没有评价返现的活动'),
    },
  };
}

describe('retrieval core parity', () => {
  it('matches the frozen Top 3, order, scores, and abstention snapshot', () => {
    expect(currentFreeze()).toEqual(snapshot);
  });

  it('keeps the desktop tokenizer aligned with compactQueryText', () => {
    expect(termsOf('发-货')).toEqual(['发', '发货', '货']);
    expect(compactQueryText('发-货')).toBe('发货');
    expect(termsOf('发-货')).toEqual(termsOf(compactQueryText('发-货')));
  });
});
