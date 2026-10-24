import { describe, expect, it } from 'vitest';
import {
  outcomeSentence,
  parseInaccuracyOutcomeList,
} from '../../src/shared/inaccuracy-outcome';

const early = {
  scriptId: 'shipping-001',
  resolvedAt: '2026-10-20T00:00:00.000Z',
  ready: false,
  beforeCount: null,
  afterCount: null,
  windowDays: 7,
} as const;

const ready = {
  scriptId: 'shipping-001',
  resolvedAt: '2026-10-01T00:00:00.000Z',
  ready: true,
  beforeCount: 4,
  afterCount: 1,
  windowDays: 7,
} as const;

describe('inaccuracy outcome', () => {
  it('refuses a short after-window that still carries counts', () => {
    expect(parseInaccuracyOutcomeList({
      ok: true,
      items: [{ ...early, beforeCount: 2 }],
    })).toBeNull();
  });

  it('keeps a finished comparison and says both counts', () => {
    const parsed = parseInaccuracyOutcomeList({ ok: true, items: [ready] });
    expect(parsed?.items).toEqual([ready]);
    expect(outcomeSentence(ready)).toBe('处理前 7 天 4 次，处理后 7 天 1 次。');
  });

  it('does not compare before the after-window has elapsed', () => {
    expect(outcomeSentence(early)).toBe('处理后时间还短，先不比较。');
  });
});
