import { describe, expect, it, vi } from 'vitest';
import type { QueryResultRow } from 'pg';
import {
  candidateIsExpired,
  noHitClusterKey,
  openIterationSignal,
  openSignalsFromRecordedSearch,
  rankingClusterKey,
  staleClusterKey,
  type IterationSignalClient,
} from '../src/iteration-task-signals.js';

describe('iteration task retrieval signals', () => {
  it('builds stable cluster keys for no-hit, skip-top1, and stale', () => {
    expect(noHitClusterKey({
      platform: 'qianniu',
      productContextType: null,
      productContextRef: null,
    })).toBe('no_hit:none:storewide:qianniu');
    expect(noHitClusterKey({
      platform: 'douyin',
      productContextType: 'sku',
      productContextRef: 'sku-1',
    })).toBe('no_hit:sku:sku-1:douyin');
    expect(rankingClusterKey('script-top')).toBe('top1_skipped:script-top');
    expect(staleClusterKey('script-old')).toBe('stale:script-old');
  });

  it('treats effective_to as an exclusive upper bound', () => {
    const now = Date.parse('2026-09-21T12:00:00.000Z');
    expect(candidateIsExpired(null, now)).toBe(false);
    expect(candidateIsExpired('2026-09-21T12:00:00.000Z', now)).toBe(true);
    expect(candidateIsExpired('2026-09-21T12:00:01.000Z', now)).toBe(false);
    expect(candidateIsExpired('not-a-date', now)).toBe(false);
  });

  it('inserts an open task once per cluster and skips when one is already open', async () => {
    const query = vi.fn(async (sql: string, _values?: readonly unknown[]) => {
      if (sql.includes('SELECT 1 FROM public.iteration_tasks')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });
    expect(await openIterationSignal({ query }, {
      clusterKey: 'no_hit:none:storewide:qianniu',
      signalId: 'no_hit:none:storewide:qianniu',
      cause: 'content_gap',
      queryId: 'q-1',
      suggestedScriptIds: [],
    })).toBe(true);
    expect(query.mock.calls[1]?.[0]).toContain('INSERT INTO public.iteration_tasks');
    expect(query.mock.calls[1]?.[1]).toEqual(expect.arrayContaining([
      'no_hit:none:storewide:qianniu',
      ['q-1'],
      'content_gap',
      [],
    ]));

    const alreadyOpen = vi.fn(async (_sql: string, _values?: readonly unknown[]) => ({
      rows: [] as QueryResultRow[],
      rowCount: 1,
    }));
    expect(await openIterationSignal({ query: alreadyOpen as IterationSignalClient['query'] }, {
      clusterKey: 'stale:script-old',
      signalId: 'stale:script-old',
      cause: 'stale',
      queryId: 'q-2',
      suggestedScriptIds: ['script-old'],
    })).toBe(false);
    expect(alreadyOpen.mock.calls.some((call) => String(call[0]).includes('INSERT'))).toBe(false);
  });

  it('opens stale for displayed expired candidates and content_gap for empty recall', async () => {
    const query = vi.fn(async (sql: string, _values?: readonly unknown[]) => {
      if (sql.includes('SELECT 1 FROM public.iteration_tasks')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    await openSignalsFromRecordedSearch({ query }, {
      queryId: 'q-stale',
      platform: 'qianniu',
      productContextType: null,
      productContextRef: null,
      candidates: [{ script_id: 'script-expired', effective_to: '2020-01-02T00:00:00.000Z' }],
      nowMs: Date.parse('2026-09-21T12:00:00.000Z'),
    });
    expect(query.mock.calls[1]?.[1]).toEqual(expect.arrayContaining([
      'stale:script-expired',
      'stale',
      ['script-expired'],
    ]));

    query.mockClear();
    await openSignalsFromRecordedSearch({ query }, {
      queryId: 'q-empty',
      platform: 'qianniu',
      productContextType: null,
      productContextRef: null,
      candidates: [],
    });
    expect(query.mock.calls[1]?.[1]).toEqual(expect.arrayContaining([
      'no_hit:none:storewide:qianniu',
      'content_gap',
    ]));
  });

  it('does not invent tickets or rewrite answers', async () => {
    const query = vi.fn(async (_sql: string, _values?: readonly unknown[]) => ({ rows: [], rowCount: 0 }));
    await openIterationSignal({ query }, {
      clusterKey: 'top1_skipped:script-a',
      signalId: 'top1_skipped:script-a',
      cause: 'ranking',
      queryId: 'q-3',
      suggestedScriptIds: ['script-a', 'script-b'],
    });
    const sql = JSON.stringify(query.mock.calls);
    expect(sql).not.toContain('/tickets');
    expect(sql).not.toContain('answer_text');
  });
});
