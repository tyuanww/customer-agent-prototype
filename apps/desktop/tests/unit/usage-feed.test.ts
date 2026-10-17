import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { usageReplyForMount } from '../../src/shared/usage-feed';
import { WORKBENCH_EMPTY } from '../../src/shared/workbench-empty';
import { createUsageJournal, rowsForActor, type UsageNote } from '../../src/main/usage-journal';

const filter = { result: '' as const, query: '', cursor: null };

const notes: UsageNote[] = [
  {
    id: '1', askedAt: '2026-10-13T01:00:00.000Z', actorId: 'usr_self', agent: '魏炜',
    question: '退货多久', scriptTitle: '退货时效', result: 'viewed', snapshotStale: false, consented: true,
  },
  {
    id: '2', askedAt: '2026-10-13T02:00:00.000Z', actorId: 'usr_other', agent: '别人',
    question: '别人的问题', scriptTitle: '别人的话术', result: 'copied', snapshotStale: false, consented: true,
  },
];

it('keeps unmounted, signed-out, failed, and ready on different branches', () => {
  expect(usageReplyForMount({ kind: 'unmounted' }, () => [], filter)).toEqual({
    ok: false, code: 'UNAVAILABLE', message: WORKBENCH_EMPTY.usageUnmounted,
  });
  expect(usageReplyForMount({ kind: 'signed-out' }, () => {
    throw new Error('should not read');
  }, filter)).toEqual({
    ok: false, code: 'UNAUTHORIZED', message: WORKBENCH_EMPTY.signedOut,
  });
  expect(usageReplyForMount({ kind: 'signed-in', actorId: 'usr_self' }, () => {
    throw new Error('disk');
  }, filter)).toEqual({
    ok: false, code: 'FAILED', message: WORKBENCH_EMPTY.usageFailed,
  });
  const ready = usageReplyForMount({ kind: 'signed-in', actorId: 'usr_self' }, () => [], filter);
  expect(ready).toMatchObject({ ok: true, rows: [] });
  const filled = usageReplyForMount(
    { kind: 'signed-in', actorId: 'usr_self' },
    (actorId) => rowsForActor(notes, actorId),
    filter,
  );
  expect(filled.ok && filled.rows.map((row) => row.question)).toEqual(['退货多久']);
});

it('stores one seat and hides the other seat on the same machine', () => {
  const dir = mkdtempSync(join(tmpdir(), 'usage-journal-'));
  const journal = createUsageJournal(join(dir, 'usage-journal.json'));
  for (const note of notes) journal.note(note);
  expect(journal.read('usr_self').map((row) => row.scriptTitle)).toEqual(['退货时效']);
  expect(journal.read('usr_other').map((row) => row.question)).toEqual(['别人的问题']);
  journal.markCopied('1');
  expect(journal.read('usr_self')[0]?.result).toBe('copied');
  expect(journal.read('usr_self').some((row) => row.question === '别人的问题')).toBe(false);
});

it('treats a broken journal as a thrown read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'usage-journal-bad-'));
  const path = join(dir, 'usage-journal.json');
  writeFileSync(path, '{');
  const journal = createUsageJournal(path);
  expect(() => journal.read('usr_self')).toThrow();
  const reply = usageReplyForMount({ kind: 'signed-in', actorId: 'usr_self' }, (actorId) => journal.read(actorId), filter);
  expect(reply).toEqual({ ok: false, code: 'FAILED', message: WORKBENCH_EMPTY.usageFailed });
});
