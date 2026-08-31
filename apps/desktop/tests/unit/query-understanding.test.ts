import { describe, expect, it } from 'vitest';
import {
  matchSearchMetadata,
  understandQuery,
} from '../../src/renderer/features/search/query-understanding';
import type { SearchMetadata } from '../../src/renderer/features/search/types';

const metadata: SearchMetadata = {
  intents: ['usage', 'safety'],
  anchors: [
    {
      kind: 'entity',
      label: '星河洁面',
      canonical: '星河洁面',
      aliases: ['星河洗面奶'],
    },
  ],
};

const topicMetadata: SearchMetadata = {
  intents: ['usage', 'safety', 'aftersales'],
  anchors: [
    {
      kind: 'entity',
      label: '星河洁面',
      canonical: '星河洁面',
      aliases: ['氨基酸洁面'],
    },
    {
      kind: 'topic',
      label: '不适反馈',
      canonical: '过敏',
      aliases: ['清洁'],
    },
  ],
};

describe('query understanding', () => {
  it('detects generic intents without treating them as business evidence', () => {
    const parsed = understandQuery('怎么用');
    expect(parsed.intents).toContain('usage');
    expect(parsed.genericOnly).toBe(true);
    expect(matchSearchMetadata(parsed, metadata).score).toBe(0);
  });

  it('keeps the raw normalized query and recognizes a fixture-scoped alias', () => {
    const parsed = understandQuery('星河洗面奶咋用');
    const match = matchSearchMetadata(parsed, metadata);
    expect(parsed.normalized).toBe('星河洗面奶咋用');
    expect(parsed.genericOnly).toBe(false);
    expect(parsed.intents).toContain('usage');
    expect(match.kind).toBe('alias');
    expect(match.entityMatched).toBe(true);
    expect(match.label).toBe('同义表达 · 星河洁面');
    expect(match.score).toBeGreaterThan(38);
  });

  it('does not mutate or replace the query when detecting multiple intents', () => {
    const parsed = understandQuery('星河洁面敏感肌怎么用');
    expect(parsed.normalized).toBe('星河洁面敏感肌怎么用');
    expect(parsed.intents).toEqual(expect.arrayContaining(['usage', 'safety']));
  });

  it('exposes category context for topic plus intent without scoring the topic alone', () => {
    const categoryMatch = matchSearchMetadata(
      understandQuery('洁面过敏怎么办'),
      topicMetadata,
    );
    expect(categoryMatch.entityMatched).toBe(false);
    expect(categoryMatch.topicContextMatched).toBe(true);
    expect(categoryMatch.score).toBe(0);
    expect(categoryMatch.matchedIntents).toEqual(
      expect.arrayContaining(['safety', 'aftersales']),
    );

    const foreignBrandMatch = matchSearchMetadata(
      understandQuery('外部品牌丁洁面过敏怎么办'),
      topicMetadata,
    );
    expect(foreignBrandMatch.topicContextMatched).toBe(false);

    const topicOnlyMatch = matchSearchMetadata(
      understandQuery('清洁怎么用'),
      topicMetadata,
    );
    expect(topicOnlyMatch.entityMatched).toBe(false);
    expect(topicOnlyMatch.topicContextMatched).toBe(false);
    expect(topicOnlyMatch.score).toBe(0);
  });

  it('distinguishes a fixture-scoped entity from an unscoped category alias', () => {
    const scoped = matchSearchMetadata(
      understandQuery('星河氨基酸洁面怎么用'),
      topicMetadata,
    );
    expect(scoped.entityMatched).toBe(true);
    expect(scoped.entityScopeMatched).toBe(true);

    const unscoped = matchSearchMetadata(
      understandQuery('外部品牌甲氨基酸洁面怎么用'),
      topicMetadata,
    );
    expect(unscoped.entityMatched).toBe(true);
    expect(unscoped.entityScopeMatched).toBe(false);
    expect(unscoped.entityContextClean).toBe(false);

    const categoryOnly = matchSearchMetadata(
      understandQuery('氨基酸洁面怎么用'),
      topicMetadata,
    );
    expect(categoryOnly.entityMatched).toBe(true);
    expect(categoryOnly.entityScopeMatched).toBe(false);
    expect(categoryOnly.entityContextClean).toBe(true);
  });
});
