import { describe, expect, it } from 'vitest';
import {
  ITERATION_CLOSE_HINT_COPY,
  hasPublishCloseHint,
  relatedScriptIdsForTask,
} from '../../src/shared/iteration-close-hint';

const openTask = {
  signalId: 'inaccuracy:script-a',
  clusterKey: 'script-a',
  suggestedScriptIds: ['script-a'],
  sampleQueryIds: ['q-1'],
  status: 'open' as const,
  suspectedCause: 'mixed' as const,
  createdAt: '2026-09-20T00:00:00.000Z',
};

describe('iteration publish close hint', () => {
  it('reads related script ids from suggested, inaccuracy, and stale/ranking prefixes', () => {
    expect(relatedScriptIdsForTask(openTask)).toEqual(['script-a']);
    expect(relatedScriptIdsForTask({
      ...openTask,
      signalId: 'top1_skipped:script-b',
      clusterKey: 'top1_skipped:script-b',
      suggestedScriptIds: ['script-b', 'script-c'],
    })).toEqual(['script-b', 'script-c']);
    expect(relatedScriptIdsForTask({
      ...openTask,
      signalId: 'stale:script-old',
      clusterKey: 'stale:script-old',
      suggestedScriptIds: [],
    })).toEqual(['script-old']);
  });

  it('hints only when the current catalog is newer than the task and still contains the script', () => {
    const catalog = {
      catalogRefreshedAt: '2026-09-21T00:00:00.000Z',
      entries: [{ scriptId: 'script-a' }],
    };
    expect(hasPublishCloseHint(openTask, catalog)).toBe(true);
    expect(hasPublishCloseHint(openTask, {
      catalogRefreshedAt: '2026-09-19T00:00:00.000Z',
      entries: [{ scriptId: 'script-a' }],
    })).toBe(false);
    expect(hasPublishCloseHint(openTask, {
      catalogRefreshedAt: '2026-09-21T00:00:00.000Z',
      entries: [{ scriptId: 'other' }],
    })).toBe(false);
    expect(hasPublishCloseHint({ ...openTask, status: 'resolved' }, catalog)).toBe(false);
    expect(hasPublishCloseHint(openTask, null)).toBe(false);
  });

  it('hints content_gap without a script id after a newer catalog, and never auto-closes', () => {
    expect(hasPublishCloseHint({
      ...openTask,
      signalId: 'no_hit:none:storewide:qianniu',
      clusterKey: 'no_hit:none:storewide:qianniu',
      suggestedScriptIds: [],
      suspectedCause: 'content_gap',
    }, {
      catalogRefreshedAt: '2026-09-21T00:00:00.000Z',
      entries: [{ scriptId: 'new-script' }],
    })).toBe(true);
    expect(ITERATION_CLOSE_HINT_COPY.footnote).toContain('不自动关单');
  });
});
