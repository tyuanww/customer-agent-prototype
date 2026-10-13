import { describe, expect, it } from 'vitest';
import {
  emptyQueryActionLedger,
  inaccurateCounts,
  knowledgeValidityReminders,
  listMissRecords,
  planInaccuracyTask,
  recordPublishedQueryAction,
  QUERY_ACTION_LEDGER_SURFACE,
  type QueryActionAttempt,
  type QueryActionLedger,
} from '../../src/shared/query-action-ledger';
import { scriptTextAfterCause } from '../../src/shared/iteration-close-hint';

const NOW = '2026-10-13T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const DAY = 24 * 60 * 60 * 1000;

function at(deltaMs: number): string {
  return new Date(NOW_MS + deltaMs).toISOString();
}

function keep(ledger: QueryActionLedger, input: QueryActionAttempt): QueryActionLedger {
  const saved = recordPublishedQueryAction(ledger, input);
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw new Error('expected a published record');
  return saved.ledger;
}

function inaccurate(ledger: QueryActionLedger, when: string, scriptId = 'script-a'): QueryActionLedger {
  return keep(ledger, {
    question: '运费多久',
    scriptId,
    action: 'inaccurate',
    at: when,
    releaseId: 'rel_9',
    published: true,
  });
}

describe('published query action ledger', () => {
  it('published 复制 record keeps question, script id, action, time, and release id', () => {
    const saved = recordPublishedQueryAction(emptyQueryActionLedger(), {
      question: '运费多少',
      scriptId: 'script-a',
      action: 'copy',
      at: NOW,
      releaseId: 'rel_9',
      published: true,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.record).toEqual({
      question: '运费多少',
      scriptId: 'script-a',
      action: 'copy',
      at: NOW,
      releaseId: 'rel_9',
    });
    expect(saved.ledger).toEqual([saved.record]);
  });

  it('published 无命中 record keeps question, script id, action, time, and release id', () => {
    const saved = recordPublishedQueryAction(emptyQueryActionLedger(), {
      question: '没有这条',
      action: 'miss',
      at: NOW,
      releaseId: 'rel_9',
      published: true,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.record).toEqual({
      question: '没有这条',
      scriptId: null,
      action: 'miss',
      at: NOW,
      releaseId: 'rel_9',
    });
  });

  it('published 不准 record keeps question, script id, action, time, and release id', () => {
    const saved = recordPublishedQueryAction(emptyQueryActionLedger(), {
      question: '运费多久',
      scriptId: 'script-a',
      action: 'inaccurate',
      at: NOW,
      releaseId: 'rel_9',
      published: true,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.record).toEqual({
      question: '运费多久',
      scriptId: 'script-a',
      action: 'inaccurate',
      at: NOW,
      releaseId: 'rel_9',
    });
  });

  it('unpublished draft is rejected', () => {
    const draft = recordPublishedQueryAction(emptyQueryActionLedger(), {
      question: '草稿问题',
      scriptId: 'draft-1',
      action: 'inaccurate',
      at: NOW,
      releaseId: null,
      published: false,
    });
    const unreleased = recordPublishedQueryAction(emptyQueryActionLedger(), {
      question: '草稿问题',
      scriptId: 'draft-1',
      action: 'copy',
      at: NOW,
      releaseId: 'rel_draft',
      published: false,
    });
    expect(draft).toEqual({ ok: false, reason: 'unpublished' });
    expect(unreleased).toEqual({ ok: false, reason: 'unpublished' });
    expect(QUERY_ACTION_LEDGER_SURFACE).toBe('未接入');
  });

  it('2 marks in 24h and 9 in 7d do not open a task', () => {
    let ledger = emptyQueryActionLedger();
    ledger = inaccurate(ledger, at(0));
    ledger = inaccurate(ledger, at(-23 * 60 * 60 * 1000));
    for (let day = 2; day <= 6; day += 1) ledger = inaccurate(ledger, at(-day * DAY));
    ledger = inaccurate(ledger, at(-30 * 60 * 60 * 1000));
    ledger = inaccurate(ledger, at(-36 * 60 * 60 * 1000));
    expect(inaccurateCounts(ledger, 'script-a', NOW)).toEqual({ count24h: 2, count7d: 9 });
    expect(planInaccuracyTask({
      ledger, scriptId: 'script-a', now: NOW, existing: [],
    })).toEqual({ open: false, reason: 'below_threshold' });
  });

  it('3 in 24h opens one task', () => {
    let ledger = emptyQueryActionLedger();
    ledger = inaccurate(ledger, at(0));
    ledger = inaccurate(ledger, at(-60 * 60 * 1000));
    ledger = inaccurate(ledger, at(-2 * 60 * 60 * 1000));
    expect(inaccurateCounts(ledger, 'script-a', NOW).count24h).toBe(3);
    expect(planInaccuracyTask({
      ledger, scriptId: 'script-a', now: NOW, existing: [],
    })).toEqual({ open: true, scriptId: 'script-a' });
  });

  it('10 in 7d opens one task', () => {
    let ledger = emptyQueryActionLedger();
    ledger = inaccurate(ledger, at(0));
    for (let index = 0; index < 9; index += 1) ledger = inaccurate(ledger, at(-(25 + index) * 60 * 60 * 1000));
    expect(inaccurateCounts(ledger, 'script-a', NOW)).toEqual({ count24h: 1, count7d: 10 });
    expect(planInaccuracyTask({
      ledger, scriptId: 'script-a', now: NOW, existing: [],
    })).toEqual({ open: true, scriptId: 'script-a' });
  });

  it('a second open is suppressed', () => {
    let ledger = emptyQueryActionLedger();
    ledger = inaccurate(ledger, at(0));
    ledger = inaccurate(ledger, at(-60 * 60 * 1000));
    ledger = inaccurate(ledger, at(-2 * 60 * 60 * 1000));
    const first = planInaccuracyTask({ ledger, scriptId: 'script-a', now: NOW, existing: [] });
    expect(first).toEqual({ open: true, scriptId: 'script-a' });
    expect(planInaccuracyTask({
      ledger, scriptId: 'script-a', now: NOW, existing: [{ scriptId: 'script-a', status: 'open' }],
    })).toEqual({ open: false, reason: 'already_open' });
    expect(planInaccuracyTask({
      ledger, scriptId: 'script-a', now: NOW, existing: [{ scriptId: 'script-a', status: 'in_progress' }],
    })).toEqual({ open: false, reason: 'already_open' });
  });

  it('无命中 does not increment the 不准 count', () => {
    let ledger = emptyQueryActionLedger();
    for (let index = 0; index < 10; index += 1) {
      ledger = keep(ledger, {
        question: `没有${index}`,
        action: 'miss',
        at: at(-index * 60 * 60 * 1000),
        releaseId: 'rel_9',
        published: true,
      });
    }
    ledger = inaccurate(ledger, at(0));
    ledger = inaccurate(ledger, at(-60 * 60 * 1000));
    expect(inaccurateCounts(ledger, 'script-a', NOW)).toEqual({ count24h: 2, count7d: 2 });
    expect(listMissRecords(ledger)).toHaveLength(10);
    expect(listMissRecords(ledger).every((row) => row.action === 'miss')).toBe(true);
    expect(planInaccuracyTask({
      ledger, scriptId: 'script-a', now: NOW, existing: [],
    }).open).toBe(false);
  });

  it('排序问题 leaves the script text unchanged', () => {
    expect(scriptTextAfterCause('七天无理由，运费由买家承担。', 'ranking')).toBe('七天无理由，运费由买家承担。');
  });

  it('过期仍召回 leaves the script text unchanged', () => {
    expect(scriptTextAfterCause('七天无理由，运费由买家承担。', 'stale')).toBe('七天无理由，运费由买家承担。');
  });

  it('待生效 and 已失效 are reminders and are not 不准 tasks', () => {
    const reminders = knowledgeValidityReminders([
      { id: 'k-due', question: '退货运费什么时候到', statusLabel: '待生效' },
      { id: 'k-old', question: '旧包装说明', statusLabel: '已失效' },
      { id: 'k-live', question: '生效中的运费', statusLabel: '生效中' },
      { id: 'k-off', question: '还没启用', statusLabel: '未生效' },
    ]);
    expect(reminders).toEqual([
      { id: 'k-due', question: '退货运费什么时候到', label: '待生效' },
      { id: 'k-old', question: '旧包装说明', label: '已失效' },
    ]);
    expect(reminders.some((item) => 'taskId' in item || 'status' in item)).toBe(false);
  });
});
