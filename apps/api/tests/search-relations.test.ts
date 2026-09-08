import { describe, expect, it } from 'vitest';
import { analyzeRelationQuery, extractBodyRelationPolar, extractQueryRelationPolar } from '../src/search-relations.js';

describe('bounded relation evidence', () => {
  it.each(['没', '未', '没有'])('does not turn %s occurrence into a prohibition or a positive fact', (marker) => {
    const query = `合成清洁刷T${marker}浸水`;
    expect(extractQueryRelationPolar(query)).toEqual([]);
    const relation = analyzeRelationQuery(query, '合成清洁刷T不浸水。', false);
    expect(relation.requiresClarification).toBe(true);
    expect(relation.leftoverQuery).toBe('合成清洁刷t');
    expect(relation.polarConflict).toBe(false);
  });

  it('does not reduce unknown objects, nested negation or compound occurrence claims', () => {
    for (const query of ['合成粉扑R没接触玻璃', '合成粉扑R没不接触面板', '合成粉扑R没有接触面板和皮肤']) {
      expect(analyzeRelationQuery(query, '合成粉扑R接触面板。', false).requiresClarification).toBe(false);
    }
  });

  it('waives only answered negative relations and leaves unrelated negation intact', () => {
    const query = '合成粉扑R不接触面板，不浸水吗';
    const result = analyzeRelationQuery(query, '合成粉扑R接触面板。', true);
    expect(result.negationQuery).toContain('不浸水');
    expect(result.negationQuery).not.toContain('不接触面板');
    expect(result.unansweredConfirmation).toBe(true);
    expect(analyzeRelationQuery(query, '合成粉扑R接触面板。', false).negationQuery).toContain('不接触面板');
  });

  it.each(['接触面板吗？', '声称接触面板。', '“接触面板”。', '接触面板；不接触面板。'])(
    'requires unambiguous statement evidence: %s', (body) => {
      const result = analyzeRelationQuery('合成粉扑R不接触面板吗', body, true);
      expect(result.unansweredConfirmation).toBe(true);
      expect(result.negationQuery).toContain('不接触面板');
    },
  );

  it.each([
    '‘合成粉扑R接触面板’。',
    '『合成粉扑R接触面板』。',
    "'合成粉扑R接触面板'。",
    '> 合成粉扑R接触面板',
    '如果合成粉扑R接触面板，请先清洁。',
    '没有让合成粉扑R接触面板。',
    '没让合成粉扑R接触面板。',
    '未使用合成粉扑R接触面板。',
    '有人说，合成粉扑R接触面板。',
    '如果温度正常，合成粉扑R接触面板。',
    '在高温时，合成粉扑R接触面板。',
  ])('does not use an embedded relation as statement evidence: %s', (body) => {
    expect(extractBodyRelationPolar(body)).toEqual([]);
    expect(analyzeRelationQuery('合成粉扑R不接触面板吗', body, true).unansweredConfirmation).toBe(true);
  });

  it('does not assign another explicit product subject’s polarity to the queried product', () => {
    const result = analyzeRelationQuery('合成粉扑R接触面板', '合成粉扑R接触面板；合成粉扑S不接触面板。', false);
    expect(result.sameRelArg).toBe(true);
    expect(result.polarConflict).toBe(false);
    expect(analyzeRelationQuery('合成粉扑R接触面板', '合成粉扑R不接触面板。', false).polarConflict).toBe(true);
  });

  it('resets reporting scope only at an independent statement boundary', () => {
    expect(extractBodyRelationPolar('有人说，接触面板；不接触面板。')).toEqual([
      { relation: '接触', argument: '面板', polarity: 'neg', marker: '不' },
    ]);
  });

  it('keeps an independent statement while excluding a neighboring question', () => {
    expect(extractBodyRelationPolar('接触面板吗？；不接触面板。')).toEqual([
      { relation: '接触', argument: '面板', polarity: 'neg', marker: '不' },
    ]);
  });
});
