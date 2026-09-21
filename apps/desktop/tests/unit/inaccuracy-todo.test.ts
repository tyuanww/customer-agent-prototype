import { describe, expect, it } from 'vitest';
import {
  INACCURACY_SIGNAL_PREFIX,
  INACCURACY_TODO_COPY,
  aggregateInaccuracyTodoCounts,
  inaccuracyScriptIdFromTask,
} from '../../src/shared/inaccuracy-todo';

const base = {
  clusterKey: 'script-a',
  suggestedScriptIds: ['script-a'],
  sampleQueryIds: ['q-1'],
  status: 'open' as const,
};

describe('inaccuracy todo projection', () => {
  it('reads scriptId from the inaccuracy signal prefix', () => {
    expect(inaccuracyScriptIdFromTask({
      ...base,
      signalId: `${INACCURACY_SIGNAL_PREFIX}script-a`,
    })).toBe('script-a');
    expect(inaccuracyScriptIdFromTask({
      ...base,
      signalId: 'sig-no-hit-shipping',
    })).toBeNull();
  });

  it('falls back to suggested script then cluster when the prefix is empty', () => {
    expect(inaccuracyScriptIdFromTask({
      signalId: INACCURACY_SIGNAL_PREFIX,
      clusterKey: 'cluster-a',
      suggestedScriptIds: ['script-b'],
      sampleQueryIds: [],
      status: 'open',
    })).toBe('script-b');
    expect(inaccuracyScriptIdFromTask({
      signalId: INACCURACY_SIGNAL_PREFIX,
      clusterKey: 'cluster-a',
      suggestedScriptIds: [],
      sampleQueryIds: [],
      status: 'open',
    })).toBe('cluster-a');
  });

  it('aggregates unique sample queries per script and counts open tasks', () => {
    expect(aggregateInaccuracyTodoCounts([
      {
        signalId: 'inaccuracy:script-a',
        clusterKey: 'script-a',
        suggestedScriptIds: ['script-a'],
        sampleQueryIds: ['q-1', 'q-1', 'q-2'],
        status: 'open',
      },
      {
        signalId: 'inaccuracy:script-a',
        clusterKey: 'script-a',
        suggestedScriptIds: ['script-a'],
        sampleQueryIds: ['q-2', 'q-3'],
        status: 'in_progress',
      },
      {
        signalId: 'inaccuracy:script-b',
        clusterKey: 'script-b',
        suggestedScriptIds: ['script-b'],
        sampleQueryIds: ['q-9'],
        status: 'resolved',
      },
      {
        signalId: 'sig-no-hit',
        clusterKey: 'no_hit:x',
        suggestedScriptIds: ['script-c'],
        sampleQueryIds: ['q-8'],
        status: 'open',
      },
    ])).toEqual([
      { scriptId: 'script-a', sampleCount: 3, openTaskCount: 2 },
      { scriptId: 'script-b', sampleCount: 1, openTaskCount: 0 },
    ]);
  });

  it('keeps live copy from inventing 24h/7d window numbers', () => {
    expect(INACCURACY_TODO_COPY.heading).toBe('按稿不准次数');
    expect(INACCURACY_TODO_COPY.empty).toContain('开单阈值');
    expect(INACCURACY_TODO_COPY.footnoteLive).toContain('样本查询数');
    expect(INACCURACY_TODO_COPY.footnoteLive).not.toContain('尚未接入');
  });
});
