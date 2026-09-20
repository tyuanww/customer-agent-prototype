import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INACCURACY_REPORT_KEY_SEPARATOR,
  INACCURACY_TASK_THRESHOLD_24H,
  INACCURACY_TASK_THRESHOLD_7D,
  aggregateInaccuracyCounts,
  inaccuracyReportKey,
  shouldAcceptInaccuracyReport,
  shouldOpenIterationTask,
} from '../../src/shared/inaccuracy-report';

const sourcePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/shared/inaccuracy-report.ts',
);

describe('inaccuracy report key and accept', () => {
  it('joins sessionKey and scriptId with a NUL separator', () => {
    expect(INACCURACY_REPORT_KEY_SEPARATOR).toBe('\0');
    expect(inaccuracyReportKey({ sessionKey: 'q-1', scriptId: 'script-a' })).toBe('q-1\0script-a');
  });

  it('accepts the first click for a query session + script and rejects a repeat', () => {
    const seenKeys = new Set<string>();
    const first = { sessionKey: 'q-1', scriptId: 'script-a', seenKeys };
    expect(shouldAcceptInaccuracyReport(first)).toBe(true);

    seenKeys.add(inaccuracyReportKey(first));
    expect(shouldAcceptInaccuracyReport({ ...first, seenKeys })).toBe(false);
  });

  it('records the same script again only in a different query session', () => {
    const seenKeys = new Set([inaccuracyReportKey({ sessionKey: 'q-1', scriptId: 'script-a' })]);
    expect(shouldAcceptInaccuracyReport({
      sessionKey: 'q-2',
      scriptId: 'script-a',
      seenKeys,
    })).toBe(true);
    expect(shouldAcceptInaccuracyReport({
      sessionKey: 'q-1',
      scriptId: 'script-b',
      seenKeys,
    })).toBe(true);
  });

  it('rejects empty or NUL-bearing sessionKey and scriptId', () => {
    const seenKeys = new Set<string>();
    expect(shouldAcceptInaccuracyReport({ sessionKey: '', scriptId: 'script-a', seenKeys })).toBe(false);
    expect(shouldAcceptInaccuracyReport({ sessionKey: 'q-1', scriptId: '', seenKeys })).toBe(false);
    expect(shouldAcceptInaccuracyReport({
      sessionKey: 'q-1\0extra',
      scriptId: 'script-a',
      seenKeys,
    })).toBe(false);
    expect(shouldAcceptInaccuracyReport({
      sessionKey: 'q-1',
      scriptId: 'script\0a',
      seenKeys,
    })).toBe(false);
  });
});

describe('inaccuracy count aggregation', () => {
  it('counts unique session+script pairs per scriptId in first-seen order', () => {
    expect(aggregateInaccuracyCounts([
      { sessionKey: 'q-1', scriptId: 'script-a' },
      { sessionKey: 'q-1', scriptId: 'script-a' },
      { sessionKey: 'q-2', scriptId: 'script-a' },
      { sessionKey: 'q-3', scriptId: 'script-b' },
      { sessionKey: '', scriptId: 'script-c' },
      { sessionKey: 'q-4', scriptId: 'script-b' },
    ])).toEqual([
      { scriptId: 'script-a', count: 2 },
      { scriptId: 'script-b', count: 2 },
    ]);
  });
});

describe('iteration task open threshold', () => {
  it('opens at 24h ≥ 3 or 7d ≥ 10 and not below', () => {
    expect(INACCURACY_TASK_THRESHOLD_24H).toBe(3);
    expect(INACCURACY_TASK_THRESHOLD_7D).toBe(10);
    expect(shouldOpenIterationTask({ count24h: 2, count7d: 9 })).toBe(false);
    expect(shouldOpenIterationTask({ count24h: 3, count7d: 0 })).toBe(true);
    expect(shouldOpenIterationTask({ count24h: 0, count7d: 10 })).toBe(true);
    expect(shouldOpenIterationTask({ count24h: 3, count7d: 10 })).toBe(true);
  });

  it('does not open on non-integer or negative counts', () => {
    expect(shouldOpenIterationTask({ count24h: 2.9, count7d: 10.1 })).toBe(false);
    expect(shouldOpenIterationTask({ count24h: -1, count7d: 10 })).toBe(false);
    expect(shouldOpenIterationTask({ count24h: Number.NaN, count7d: 10 })).toBe(false);
    expect(shouldOpenIterationTask({ count24h: Number.POSITIVE_INFINITY, count7d: 0 })).toBe(false);
  });

  it('only answers whether a task should open; it does not rewrite or close', () => {
    expect(shouldOpenIterationTask({ count24h: 3, count7d: 10 })).toBe(true);
    const source = readFileSync(sourcePath, 'utf8');
    expect(source).not.toContain('/tickets');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('auto-rewrite');
    expect(source).not.toContain('auto-close');
  });
});
