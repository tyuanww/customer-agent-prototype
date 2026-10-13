import { shouldOpenIterationTask } from './inaccuracy-report';

/**
 * Frozen copy and inaccuracy bodies have no question text and no release id.
 * The live query surface therefore stays 未接入. This module only checks the
 * record; it does not add an HTTP route.
 */
export const QUERY_ACTION_LEDGER_SURFACE = '未接入' as const;

export const QUERY_ACTIONS = ['copy', 'miss', 'inaccurate'] as const;
export type QueryActionKind = (typeof QUERY_ACTIONS)[number];

export type QueryActionRecord = Readonly<{
  question: string;
  scriptId: string | null;
  action: QueryActionKind;
  at: string;
  releaseId: string;
}>;

export type QueryActionAttempt = Readonly<{
  question: string;
  scriptId?: string | null;
  action: QueryActionKind;
  at: string;
  releaseId?: string | null;
  published: boolean;
}>;

export type QueryActionLedger = readonly QueryActionRecord[];

export type InaccuracyTaskSlot = Readonly<{
  scriptId: string;
  status: 'open' | 'in_progress' | 'resolved' | 'wont_fix';
}>;

export type KnowledgeValidityReminder = Readonly<{
  id: string;
  question: string;
  label: '待生效' | '已失效';
}>;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export function emptyQueryActionLedger(): QueryActionLedger {
  return Object.freeze([]);
}

export function recordPublishedQueryAction(
  ledger: QueryActionLedger,
  input: QueryActionAttempt,
): { ok: true; ledger: QueryActionLedger; record: QueryActionRecord }
  | { ok: false; reason: 'unpublished' | 'invalid' } {
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  const releaseId = typeof input.releaseId === 'string' ? input.releaseId.trim() : '';
  const scriptId = typeof input.scriptId === 'string' ? input.scriptId.trim() : '';
  if (!input.published || releaseId.length === 0) {
    return Object.freeze({ ok: false, reason: 'unpublished' });
  }
  if (question.length === 0 || !isAction(input.action) || !Number.isFinite(Date.parse(input.at))) {
    return Object.freeze({ ok: false, reason: 'invalid' });
  }
  if (input.action !== 'miss' && scriptId.length === 0) {
    return Object.freeze({ ok: false, reason: 'invalid' });
  }
  const record = Object.freeze({
    question,
    scriptId: scriptId.length > 0 ? scriptId : null,
    action: input.action,
    at: input.at,
    releaseId,
  });
  return Object.freeze({
    ok: true,
    record,
    ledger: Object.freeze([...ledger, record]),
  });
}

export function inaccurateCounts(
  ledger: QueryActionLedger,
  scriptId: string,
  now: string,
): { count24h: number; count7d: number } {
  const at = Date.parse(now);
  if (!Number.isFinite(at)) return { count24h: 0, count7d: 0 };
  let count24h = 0;
  let count7d = 0;
  for (const row of ledger) {
    if (row.action !== 'inaccurate' || row.scriptId !== scriptId) continue;
    const then = Date.parse(row.at);
    if (!Number.isFinite(then) || then > at) continue;
    const age = at - then;
    if (age <= WEEK_MS) count7d += 1;
    if (age <= DAY_MS) count24h += 1;
  }
  return { count24h, count7d };
}

export function planInaccuracyTask(input: {
  ledger: QueryActionLedger;
  scriptId: string;
  now: string;
  existing: readonly InaccuracyTaskSlot[];
}): { open: true; scriptId: string } | { open: false; reason: 'below_threshold' | 'already_open' } {
  const unclosed = input.existing.some((task) => task.scriptId === input.scriptId
    && (task.status === 'open' || task.status === 'in_progress'));
  if (unclosed) return Object.freeze({ open: false, reason: 'already_open' });
  const counts = inaccurateCounts(input.ledger, input.scriptId, input.now);
  if (!shouldOpenIterationTask(counts)) {
    return Object.freeze({ open: false, reason: 'below_threshold' });
  }
  return Object.freeze({ open: true, scriptId: input.scriptId });
}

export function listMissRecords(ledger: QueryActionLedger): readonly QueryActionRecord[] {
  return Object.freeze(ledger.filter((row) => row.action === 'miss'));
}

export function knowledgeValidityReminders(
  items: readonly { id: string; question: string; statusLabel: string }[],
): readonly KnowledgeValidityReminder[] {
  const reminders: KnowledgeValidityReminder[] = [];
  for (const item of items) {
    if (item.statusLabel !== '待生效' && item.statusLabel !== '已失效') continue;
    const question = item.question.trim();
    const id = item.id.trim();
    if (id.length === 0 || question.length === 0) continue;
    reminders.push(Object.freeze({ id, question, label: item.statusLabel }));
  }
  return Object.freeze(reminders);
}

function isAction(value: string): value is QueryActionKind {
  return (QUERY_ACTIONS as readonly string[]).includes(value);
}
