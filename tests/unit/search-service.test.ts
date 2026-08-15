import { describe, expect, it } from 'vitest';
import { MAX_QUERY_CHARS } from '../../src/shared/contracts';
import { SYNTHETIC_SCRIPTS } from '../../src/renderer/data/synthetic-scripts';
import {
  MAX_RESULTS,
  searchScripts,
} from '../../src/renderer/features/search/search-service';
import type { ScriptFixture } from '../../src/renderer/features/search/types';

const DEMO_NOW = new Date('2026-08-13T12:00:00');

function fixture(
  partial: Partial<ScriptFixture> & Pick<ScriptFixture, 'scriptId' | 'questionVariants' | 'answerText'>,
): ScriptFixture {
  return {
    domain: '产品',
    platform: '测试',
    scopeLabel: '单元测试合成',
    riskLevel: 'low',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    search: {
      intents: ['usage'],
      anchors: [{
        kind: 'entity',
        label: '单元测试合成实体',
        canonical: '单元测试合成实体',
        aliases: [],
      }],
    },
    ...partial,
  };
}

describe('searchScripts', () => {
  it('returns stable ranking for the same input and at most 3 results', () => {
    const query = '澄芽氨基酸洁面怎么用';
    const first = searchScripts(query, SYNTHETIC_SCRIPTS, DEMO_NOW);
    expect(first.status).toBe('hit');
    if (first.status !== 'hit') {
      return;
    }
    expect(first.results).toHaveLength(3);
    expect(first.results.length).toBe(MAX_RESULTS);
    expect(first.results.map((item) => item.scriptId)).toEqual([
      'syn-prod-001',
      'syn-prod-001-care',
      'syn-prod-001-quick',
    ]);
    expect(first.results.map((item) => item.rank)).toEqual(
      first.results.map((_, index) => index + 1),
    );

    for (let run = 0; run < 20; run += 1) {
      const next = searchScripts(query, SYNTHETIC_SCRIPTS, DEMO_NOW);
      expect(next).toEqual(first);
      if (next.status === 'hit') {
        expect(next.results.map((item) => ({ id: item.scriptId, score: item.score }))).toEqual(
          first.results.map((item) => ({ id: item.scriptId, score: item.score })),
        );
      }
    }
  });

  it('returns no-hit when the query stays below the match threshold', () => {
    const outcome = searchScripts(
      '今天中午虚构星球食堂有没有排骨汤',
      SYNTHETIC_SCRIPTS,
      DEMO_NOW,
    );
    expect(outcome).toEqual({ status: 'no-hit' });
  });

  it('understands fixture-scoped aliases and exposes a non-numeric match reason', () => {
    const outcome = searchScripts('澄芽洗面奶咋使', SYNTHETIC_SCRIPTS, DEMO_NOW);
    expect(outcome.status).toBe('hit');
    if (outcome.status !== 'hit') {
      return;
    }
    expect(outcome.results).toHaveLength(3);
    expect(outcome.results[0]?.scriptId).toBe('syn-prod-001');
    expect(outcome.results.every((item) => item.matchKind === 'alias')).toBe(true);
    expect(outcome.results[0]?.matchLabel).toContain('同义表达');
    expect(outcome.results[0]?.matchLabel).not.toMatch(/\d/);
  });

  it('does not let a generic intent phrase manufacture a result without an entity anchor', () => {
    for (const query of [
      '怎么用',
      '怎么办',
      '能用吗',
      '有优惠吗',
      '可以退货吗',
      '杯怎么用',
      '清洁怎么用',
    ]) {
      expect(searchScripts(query, SYNTHETIC_SCRIPTS, DEMO_NOW)).toEqual({ status: 'no-hit' });
    }
  });

  it.each([
    ['面膜过敏怎么办', 'syn-after-002'],
    ['防晒闷痘怎么办', 'syn-after-001'],
    ['洁面拆封后能不能退', 'syn-after-003'],
  ])('recalls a synthetic script from strong category and issue evidence: %s', (query, scriptId) => {
    const outcome = searchScripts(query, SYNTHETIC_SCRIPTS, DEMO_NOW);
    expect(outcome.status).toBe('hit');
    if (outcome.status === 'hit') {
      expect(outcome.results[0]?.scriptId).toBe(scriptId);
      expect(outcome.results[0]?.matchKind).toBe('similar');
    }
  });

  it.each([
    '外部品牌甲氨基酸洁面怎么用',
    '外部品牌乙舒缓精华敏感肌能用吗',
    '外部品牌丙修护面膜过敏怎么办',
    '外部品牌丁面膜过敏怎么办',
    '雾屿氨基酸洁面怎么用',
    '澄芽舒缓精华敏感肌能用吗',
    '月白修护面膜过敏怎么办',
  ])('does not cross-match an unknown brand through a broad category alias: %s', (query) => {
    expect(searchScripts(query, SYNTHETIC_SCRIPTS, DEMO_NOW)).toEqual({ status: 'no-hit' });
  });

  it('still accepts an unbranded broad category alias when no conflicting brand is present', () => {
    const outcome = searchScripts('氨基酸洁面怎么用', SYNTHETIC_SCRIPTS, DEMO_NOW);
    expect(outcome.status).toBe('hit');
    if (outcome.status === 'hit') {
      expect(outcome.results[0]?.scriptId).toBe('syn-prod-001');
    }
  });

  it('routes an unbranded repair-mask complaint to aftersales instead of a broad presales alias', () => {
    const outcome = searchScripts('修护面膜过敏怎么办', SYNTHETIC_SCRIPTS, DEMO_NOW);
    expect(outcome.status).toBe('hit');
    if (outcome.status === 'hit') {
      expect(outcome.results[0]?.scriptId).toBe('syn-after-002');
    }
  });

  it('fails closed on malformed runtime fixtures before rendering can consume them', () => {
    const base = fixture({
      scriptId: 'malformed-runtime',
      questionVariants: ['非法数据精确问法'],
      answerText: 'VALID_SYNTHETIC_ANSWER',
    });
    const malformed = [
      { ...base, answerText: '' },
      { ...base, riskLevel: 'critical' },
      { ...base, search: undefined },
    ] as unknown as readonly ScriptFixture[];
    expect(searchScripts('非法数据精确问法', malformed, DEMO_NOW)).toEqual({
      status: 'no-hit',
    });
  });

  it('prefers an exact variant hit over a weak token or bigram hit', () => {
    const scripts = [
      fixture({
        scriptId: 'weak-token',
        questionVariants: ['仓库作业与发货政策说明'],
        answerText: 'WEAK_TOKEN_ANSWER',
      }),
      fixture({
        scriptId: 'exact-hit',
        questionVariants: ['订单延迟发货怎么办'],
        answerText: 'EXACT_HIT_ANSWER',
      }),
    ];

    const outcome = searchScripts('订单延迟发货怎么办', scripts, DEMO_NOW);
    expect(outcome.status).toBe('hit');
    if (outcome.status !== 'hit') {
      return;
    }
    expect(outcome.results[0]?.scriptId).toBe('exact-hit');
    expect(outcome.results[0]?.score).toBe(100);
    expect(outcome.results[0]?.score).toBeGreaterThan(outcome.results[1]?.score ?? 0);
  });

  it('returns the original fixture answerText without rewriting', () => {
    const cleanser = SYNTHETIC_SCRIPTS.find((item) => item.scriptId === 'syn-prod-001');
    expect(cleanser).toBeDefined();
    const outcome = searchScripts('澄芽氨基酸洁面怎么用', SYNTHETIC_SCRIPTS, DEMO_NOW);
    expect(outcome.status).toBe('hit');
    if (outcome.status !== 'hit' || !cleanser) {
      return;
    }
    const matched = outcome.results.find((item) => item.scriptId === 'syn-prod-001');
    expect(matched?.answerText).toBe(cleanser.answerText);
    expect(matched?.answerText).toContain('澄芽氨基酸洁面乳');
  });

  it('never recalls a script only because the answer body contains the query', () => {
    const scripts = [
      fixture({
        scriptId: 'answer-only',
        questionVariants: ['完全无关的合成问法'],
        answerText: '客户问订单延迟发货怎么办时，也不应从答案正文反向命中。',
      }),
    ];
    expect(searchScripts('订单延迟发货怎么办', scripts, DEMO_NOW)).toEqual({ status: 'no-hit' });
  });

  it('deduplicates ids and identical answer bodies before slicing the Top 3', () => {
    const scripts = [
      fixture({
        scriptId: 'syn-dedupe-a',
        questionVariants: ['合成重复问法'],
        answerText: 'SAME_SYNTHETIC_ANSWER',
      }),
      fixture({
        scriptId: 'syn-dedupe-b',
        questionVariants: ['合成重复问法'],
        answerText: 'SAME_SYNTHETIC_ANSWER',
      }),
      fixture({
        scriptId: 'syn-dedupe-c',
        questionVariants: ['合成重复问法'],
        answerText: 'DISTINCT_SYNTHETIC_ANSWER',
      }),
    ];
    const outcome = searchScripts('合成重复问法', scripts, DEMO_NOW);
    expect(outcome.status).toBe('hit');
    if (outcome.status === 'hit') {
      expect(outcome.results.map((item) => item.scriptId)).toEqual([
        'syn-dedupe-a',
        'syn-dedupe-c',
      ]);
    }
  });

  it('keeps deterministic ordering even when fixture input order is reversed', () => {
    const query = '澄芽氨基酸洁面怎么用';
    const forward = searchScripts(query, SYNTHETIC_SCRIPTS, DEMO_NOW);
    const reversed = searchScripts(query, [...SYNTHETIC_SCRIPTS].reverse(), DEMO_NOW);
    expect(reversed).toEqual(forward);
  });

  it('rejects every conflicting duplicate id instead of choosing by input order', () => {
    const first = fixture({
      scriptId: 'conflicting-id',
      questionVariants: ['冲突编号精确问法'],
      answerText: 'ANSWER_A',
    });
    const second = { ...first, answerText: 'ANSWER_B' };
    expect(searchScripts('冲突编号精确问法', [first, second], DEMO_NOW)).toEqual({
      status: 'no-hit',
    });
    expect(searchScripts('冲突编号精确问法', [second, first], DEMO_NOW)).toEqual({
      status: 'no-hit',
    });
  });

  it('deep-freezes nested synthetic query metadata', () => {
    const first = SYNTHETIC_SCRIPTS[0];
    expect(Object.isFrozen(SYNTHETIC_SCRIPTS)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.questionVariants)).toBe(true);
    expect(Object.isFrozen(first?.search)).toBe(true);
    expect(Object.isFrozen(first?.search.anchors)).toBe(true);
    expect(Object.isFrozen(first?.search.anchors[0]?.aliases)).toBe(true);
  });

  it('keeps the synthetic fixture search contract explicit and internally unique', () => {
    const ids = SYNTHETIC_SCRIPTS.map((item) => item.scriptId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of SYNTHETIC_SCRIPTS) {
      expect(item.scriptId).toMatch(/^syn-/);
      expect(item.questionVariants.length).toBeGreaterThan(0);
      expect(item.search.intents.length).toBeGreaterThan(0);
      expect(item.search.anchors.length).toBeGreaterThan(0);
      expect(item.search.anchors.some((anchor) => anchor.kind === 'entity')).toBe(true);
      expect(item.answerText).toMatch(/合成|Demo/);
      expect(JSON.stringify(item)).not.toContain('达肤妍');
    }
  });

  it('keeps the main campaign fixture effective after 2026-09-01 while the expired fixture stays filtered', () => {
    const afterCampaignCutoff = new Date('2026-09-01T00:00:00');
    const campaign = SYNTHETIC_SCRIPTS.find((item) => item.scriptId === 'syn-camp-001');
    const expired = SYNTHETIC_SCRIPTS.find((item) => item.scriptId === 'syn-camp-002');
    expect(campaign?.effectiveTo).toBe('2099-12-31');
    expect(expired?.effectiveTo).toBe('2026-06-30');

    const hit = searchScripts('白露季满赠怎么参加', SYNTHETIC_SCRIPTS, afterCampaignCutoff);
    expect(hit.status).toBe('hit');
    if (hit.status === 'hit') {
      expect(hit.results.some((item) => item.scriptId === 'syn-camp-001')).toBe(true);
      expect(hit.results.map((item) => item.scriptId)).not.toContain('syn-camp-002');
    }

    expect(searchScripts('青禾会员日积分怎么兑', SYNTHETIC_SCRIPTS, afterCampaignCutoff)).toEqual({
      status: 'no-hit',
    });
  });

  it('never returns expired or not-yet-effective scripts even on an exact variant match', () => {
    const expired = SYNTHETIC_SCRIPTS.find((item) => item.scriptId === 'syn-camp-002');
    expect(expired).toBeDefined();
    const outcome = searchScripts('青禾会员日积分怎么兑', SYNTHETIC_SCRIPTS, DEMO_NOW);
    expect(outcome.status).toBe('no-hit');
    if (outcome.status === 'hit') {
      expect(outcome.results.map((item) => item.scriptId)).not.toContain('syn-camp-002');
    }

    const scripts = [
      fixture({
        scriptId: 'expired-exact',
        questionVariants: ['过期活动精确问法'],
        answerText: 'SHOULD_NOT_RETURN_EXPIRED',
        effectiveFrom: '2026-06-01',
        effectiveTo: '2026-06-30',
      }),
      fixture({
        scriptId: 'upcoming-exact',
        questionVariants: ['过期活动精确问法'],
        answerText: 'SHOULD_NOT_RETURN_UPCOMING',
        effectiveFrom: '2026-10-01',
        effectiveTo: '2026-10-31',
      }),
    ];
    expect(searchScripts('过期活动精确问法', scripts, DEMO_NOW)).toEqual({ status: 'no-hit' });
  });

  it('fail-closes on 2001 characters without running ranking', () => {
    const exploding = new Proxy(SYNTHETIC_SCRIPTS, {
      get(target, prop, receiver) {
        if (prop === 'map' || prop === 'length' || prop === Symbol.iterator || prop === 'filter') {
          throw new Error('search algorithm should not run for oversized queries');
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const tooLong = '测'.repeat(MAX_QUERY_CHARS + 1);
    expect(tooLong.length).toBe(2001);
    expect(searchScripts(tooLong, exploding, DEMO_NOW)).toEqual({
      status: 'invalid',
      reason: 'too-long',
    });
  });

  it('does not reject an exact 2000-character query for length', () => {
    const exact = '测'.repeat(MAX_QUERY_CHARS);
    expect(exact.length).toBe(2000);
    const outcome = searchScripts(exact, SYNTHETIC_SCRIPTS, DEMO_NOW);
    expect(outcome.status).not.toBe('invalid');
  });
});
