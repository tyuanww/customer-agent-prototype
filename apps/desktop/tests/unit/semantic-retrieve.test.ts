// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSemanticRetriever } from '../../src/main/semantic-retrieve';
import { rankScripts, rankScriptsMulti, type RetrievalScript } from '../../src/shared/hybrid-retrieve';
import { analyzeQuery, compactQueryText } from '../../src/shared/query-analyze';

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
  }),
]);

describe('hybrid retrieve ranking', () => {
  it('ranks a shipping sentence onto shipping titles, not address', () => {
    const ranked = rankScripts('什么时候发货啊', corpus);
    expect(ranked[0]?.title).toMatch(/发货|时效/);
    expect(ranked[0]?.title).not.toBe('改地址');
  });

  it('ranks a skin-use sentence onto the mask script', () => {
    const ranked = rankScripts('这款面膜敏感肌可以用吗', corpus);
    expect(ranked[0]?.title).toBe('面膜适用人群');
  });

  it('ranks an address-change sentence onto 改地址', () => {
    const ranked = rankScripts('我填错地址了能不能改', corpus);
    expect(ranked[0]?.title).toBe('改地址');
  });
});

describe('query analysis slots', () => {
  it('labels shipping and address without picking a script id', () => {
    expect(analyzeQuery('什么时候发货').domain).toBe('shipping');
    expect(analyzeQuery('我地址填错了').domain).toBe('address');
    expect(analyzeQuery('敏感肌能用吗').domain).toBe('product');
  });

  it('labels aftersale, campaign, unknown, and prefers non-product domains', () => {
    expect(analyzeQuery('要退货退款').domain).toBe('aftersale');
    expect(analyzeQuery('有没有满赠活动').domain).toBe('campaign');
    expect(analyzeQuery('hello').domain).toBe('unknown');
    expect(analyzeQuery('面膜什么时候发货').domain).toBe('shipping');
    expect(analyzeQuery('发-货时效').entities).toContain('发货');
    expect(compactQueryText('发-货')).toBe('发货');
    expect(analyzeQuery('   ').searchText).toBe('');
  });
});

describe('hybrid retrieve edges', () => {
  it('fuses multiple queries, skips empty input, and drops duplicate titles', () => {
    expect(rankScripts('!!!', corpus)).toEqual([]);
    expect(rankScripts('发货', [])).toEqual([]);
    expect(rankScriptsMulti(['', '  '], corpus)).toEqual([]);
    const single = rankScriptsMulti(['什么时候发货啊'], corpus);
    expect(single[0]?.title).toMatch(/发货|时效/);
    const fused = rankScriptsMulti(['什么时候发货啊', '我填错地址了能不能改'], corpus, 4);
    expect(fused.map((row) => row.title)).toEqual(expect.arrayContaining(['改地址']));
    const duplicates: RetrievalScript[] = [
      { scriptId: 'a', title: '发货快递', questionText: '发货', answerText: '先发' },
      { scriptId: 'b', title: '发货快递', questionText: '发货', answerText: '后发' },
    ];
    expect(rankScripts('发货', duplicates)).toHaveLength(1);
  });
});

describe('semantic retriever loader', () => {
  it('loads an empty retriever for missing or invalid index files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-retrieve-'));
    expect(loadSemanticRetriever('').rank('发货')).toEqual([]);
    expect(loadSemanticRetriever(join(dir, 'missing.json')).rank('发货')).toEqual([]);
    const invalid = join(dir, 'invalid.json');
    writeFileSync(invalid, '{not json');
    expect(loadSemanticRetriever(invalid).rank('发货')).toEqual([]);
    const empty = join(dir, 'empty.json');
    writeFileSync(empty, `${JSON.stringify({ scripts: [{ title: 'x' }] })}\n`);
    expect(loadSemanticRetriever(empty).rank('发货')).toEqual([]);
    const ok = join(dir, 'ok.json');
    writeFileSync(ok, `${JSON.stringify({
      version: 1,
      scripts: [{
        scriptId: 'ship-express', title: '发货快递', questionText: '发货快递',
        answerText: '订单付款后四十八小时内发出，物流单号同步到订单页。',
      }],
    })}\n`);
    expect(loadSemanticRetriever(ok).rank('什么时候发货')[0]?.scriptId).toBe('ship-express');
  });
});
