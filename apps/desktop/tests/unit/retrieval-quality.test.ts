import { describe, expect, it } from 'vitest';
import { admitRetrieval, MIN_RRF_SCORE, queryBigramHits } from '../../src/shared/retrieval-quality';
import type { RankedRetrieval } from '../../src/shared/hybrid-retrieve';

function row(partial: Partial<RankedRetrieval> & Pick<RankedRetrieval, 'scriptId' | 'title'>): RankedRetrieval {
  return {
    questionText: '',
    answerText: '',
    score: 0.03,
    ...partial,
  };
}

describe('retrieval quality abstention', () => {
  it('keeps a shipping title that shares query bigrams', () => {
    const kept = admitRetrieval('什么时候发货', [row({
      scriptId: 'ship', title: '发货时效', questionText: '几天能到', score: 0.03,
    })]);
    expect(kept.map((item) => item.scriptId)).toEqual(['ship']);
    expect(queryBigramHits('什么时候发货', '发货时效')).toBeGreaterThanOrEqual(1);
  });

  it('drops scripts whose title/questions share no query bigram even if the body matches', () => {
    const kept = admitRetrieval('排骨汤还有吗', [row({
      scriptId: 'inci',
      title: '发货时效',
      questionText: '什么时候发货',
      answerText: '仓库有排骨汤配料清单一并发出',
      score: 0.03,
    })]);
    expect(kept).toEqual([]);
  });

  it('drops a lexical miss with only an RRF tail score', () => {
    const kept = admitRetrieval('虚构星球食堂', [row({
      scriptId: 'ship', title: '改地址', score: MIN_RRF_SCORE / 2,
    })]);
    expect(kept).toEqual([]);
  });

  it('ignores 有没有-style function bigrams so review-cashback does not match a cafeteria query', () => {
    const kept = admitRetrieval('虚构星球食堂中午有没有排骨汤', [row({
      scriptId: 'review',
      title: '无评价返现',
      questionText: '无评价返现',
      questions: ['你们有没有评价返现的活动', '是不是没有评价返现'],
      score: 0.03,
    })]);
    expect(kept).toEqual([]);
  });

  it('keeps a title that actually names the queried phrase', () => {
    const kept = admitRetrieval('毛孔清洁', [row({
      scriptId: 'pore', title: '30秒泡泡洁面（绿色毛孔清洁款）', score: 0.03,
    })]);
    expect(kept.map((item) => item.scriptId)).toEqual(['pore']);
  });
});
