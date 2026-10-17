import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { UsageLogResult } from '../shared/dashboard-usage-log';
import type { UsageSourceRow } from '../shared/usage-log-csv';

const MAX_NOTES = 2000;

export type UsageNote = {
  id: string;
  askedAt: string;
  actorId: string;
  agent: string;
  question: string | null;
  scriptTitle: string | null;
  result: UsageLogResult;
  snapshotStale: boolean;
  consented: boolean;
};

export type UsageJournal = {
  note(note: UsageNote): void;
  markCopied(queryId: string): void;
  read(actorId: string): UsageSourceRow[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseNote(value: unknown): UsageNote | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = row.id;
  const askedAt = row.askedAt;
  const actorId = row.actorId;
  const agent = row.agent;
  const question = row.question;
  const scriptTitle = row.scriptTitle;
  const result = row.result;
  if (typeof id !== 'string' || id.length < 1) return null;
  if (typeof askedAt !== 'string' || askedAt.length < 1) return null;
  if (typeof actorId !== 'string' || actorId.length < 1) return null;
  if (typeof agent !== 'string' || agent.length < 1) return null;
  if (question !== null && typeof question !== 'string') return null;
  if (scriptTitle !== null && typeof scriptTitle !== 'string') return null;
  if (result !== 'copied' && result !== 'viewed' && result !== 'miss') return null;
  if (typeof row.snapshotStale !== 'boolean' || typeof row.consented !== 'boolean') return null;
  return {
    id,
    askedAt,
    actorId,
    agent,
    question,
    scriptTitle,
    result,
    snapshotStale: row.snapshotStale,
    consented: row.consented,
  };
}

export function rowsForActor(notes: readonly UsageNote[], actorId: string): UsageSourceRow[] {
  return notes.filter((note) => note.actorId === actorId).map((note) => ({
    id: note.id,
    askedAt: note.askedAt,
    agent: note.agent,
    question: note.question,
    scriptTitle: note.scriptTitle,
    result: note.result,
    snapshotStale: note.snapshotStale,
    consented: note.consented,
  }));
}

function writeAtomic(path: string, notes: readonly UsageNote[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const kept = notes.length <= MAX_NOTES ? notes : notes.slice(notes.length - MAX_NOTES);
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify({ version: 1, notes: kept })}\n`);
  renameSync(tempPath, path);
}

export function createUsageJournal(filePath: string): UsageJournal {
  const readNotes = (): UsageNote[] => {
    if (!existsSync(filePath)) return [];
    const value: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    const record = asRecord(value);
    const notes = record ? record.notes : null;
    if (!Array.isArray(notes)) throw new Error('USAGE_JOURNAL_SHAPE');
    return notes.flatMap((item) => {
      const note = parseNote(item);
      return note ? [note] : [];
    });
  };
  return {
    note(note) {
      const notes = readNotes().filter((row) => row.id !== note.id);
      notes.push(note);
      writeAtomic(filePath, notes);
    },
    markCopied(queryId) {
      writeAtomic(filePath, readNotes().map((row) => (
        row.id === queryId ? { ...row, result: 'copied' as const } : row
      )));
    },
    read(actorId) {
      return rowsForActor(readNotes(), actorId);
    },
  };
}
