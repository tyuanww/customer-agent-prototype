import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DOC2QUERY_BATCH_SIZE, type Doc2QueryGenerator } from './doc2query-generate.ts';
import { normalizeQuestions } from '../shared/doc2query.ts';
import type { RetrievalScript } from '../shared/hybrid-retrieve.ts';
import {
  doc2queryInputs,
  parseRetrievalIndex,
  replaceQuestions,
  serializeRetrievalIndex,
  withQuestions,
  type RetrievalIndexDocument,
  type RetrievalIndexRow,
} from '../shared/retrieval-index.ts';

/** Snapshot row shape owned by hydrate-catalog; kept structural to avoid a runtime import cycle. */
export type RetrievalSnapshotItem = Readonly<{
  script_id: string;
  title: string;
  answer_text: string;
  category?: string;
  questions?: readonly Readonly<{ question_text?: string }>[];
}>;

export type SyncRetrievalIndexResult = Readonly<{
  path: string;
  releaseId: string;
  previousReleaseId: string | null;
  total: number;
  wrote: boolean;
  skipped: boolean;
  reason: 'aligned' | 'empty' | 'wrote' | 'dry-run' | 'invalid' | 'kept-larger';
}>;

export type EnrichRetrievalIndexResult = Readonly<{
  path: string;
  total: number;
  targeted: number;
  updated: number;
  skipped: number;
  failed: number;
  wrote: boolean;
}>;

function realpathExisting(path: string): string {
  const missing: string[] = [];
  let current = resolve(path);
  while (!existsSync(current)) {
    missing.push(basename(current));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const existing = existsSync(current) ? realpathSync(current) : current;
  return missing.reverse().reduce((dir, name) => join(dir, name), existing);
}

export function assertOffRepoIndexPath(indexPath: string, repoRoot: string): string {
  const resolvedRoot = realpathExisting(repoRoot);
  const resolvedIndex = realpathExisting(indexPath);
  const rel = relative(resolvedRoot, resolvedIndex);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Error('retrieval index must stay outside the git worktree');
  }
  return resolvedIndex;
}

function writeAtomic(indexPath: string, body: string): void {
  mkdirSync(dirname(indexPath), { recursive: true });
  const tempPath = `${indexPath}.${process.pid}.tmp`;
  writeFileSync(tempPath, body);
  renameSync(tempPath, indexPath);
}

export function readRetrievalIndexFile(indexPath: string): RetrievalIndexDocument {
  const document = parseRetrievalIndex(readFileSync(indexPath, 'utf8'));
  if (!document) throw new Error('retrieval index is missing a scripts array');
  return document;
}

function questionTexts(item: RetrievalSnapshotItem): readonly string[] {
  const out: string[] = [];
  for (const question of item.questions ?? []) {
    if (typeof question.question_text === 'string' && question.question_text.trim().length > 0) {
      out.push(question.question_text.trim());
    }
  }
  return Object.freeze(out);
}

function rowFromSnapshot(item: RetrievalSnapshotItem, releaseId: string): RetrievalIndexRow | null {
  if (typeof item.script_id !== 'string' || item.script_id.length < 1 || item.script_id.length > 128) return null;
  if (typeof item.title !== 'string' || item.title.trim().length < 1) return null;
  if (typeof item.answer_text !== 'string' || item.answer_text.trim().length < 1) return null;
  const spoken = questionTexts(item);
  const title = item.title.trim();
  const questionText = spoken[0] ?? '';
  const answerText = item.answer_text;
  const category = typeof item.category === 'string' && item.category.trim().length > 0
    ? item.category.trim()
    : undefined;
  const questions = normalizeQuestions(spoken, { title, questionText, answerText });
  const script: RetrievalScript = Object.freeze({
    scriptId: item.script_id,
    title,
    questionText,
    answerText,
    ...(category ? { category } : {}),
    questions,
  });
  return Object.freeze({
    record: Object.freeze({
      scriptId: script.scriptId,
      title: script.title,
      questionText: script.questionText,
      answerText: script.answerText,
      ...(script.category ? { category: script.category } : {}),
      questions: [...questions],
      releaseId,
    }),
    script,
  });
}

function existingIndex(indexPath: string): RetrievalIndexDocument | null {
  if (!existsSync(indexPath)) return null;
  try {
    return parseRetrievalIndex(readFileSync(indexPath, 'utf8'));
  } catch {
    return null;
  }
}

function envelopeReleaseId(document: RetrievalIndexDocument | null): string | null {
  const value = document ? Reflect.get(document.envelope, 'releaseId') : null;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function preserveSpokenQuestions(
  next: RetrievalIndexDocument,
  previous: RetrievalIndexDocument | null,
): RetrievalIndexDocument {
  if (!previous) return next;
  const byId = new Map<string, RetrievalScript>();
  for (const row of previous.rows) {
    if (row.script) byId.set(row.script.scriptId, row.script);
  }
  return Object.freeze({
    envelope: next.envelope,
    rows: Object.freeze(next.rows.map((row) => {
      if (!row.script) return row;
      const existing = byId.get(row.script.scriptId);
      if (!existing?.questions || existing.questions.length === 0) return row;
      const questions = normalizeQuestions(
        [...existing.questions, ...row.script.questions ?? []],
        row.script,
      );
      const script: RetrievalScript = Object.freeze({ ...row.script, questions });
      return Object.freeze({
        record: Object.freeze({ ...row.record, questions: [...questions] }),
        script,
      });
    })),
  });
}

/**
 * Write BM25 `retrieval-index.json` from an announce snapshot. Empty / invalid
 * snapshots do not wipe. A smaller seed does not replace a larger local index.
 * Existing Doc2Query `questions[]` on matching script ids are kept.
 */
export function syncRetrievalIndexFromSnapshot(options: Readonly<{
  path: string;
  repoRoot: string;
  releaseId: string;
  items: readonly RetrievalSnapshotItem[];
  dryRun?: boolean;
  rebuild?: boolean;
}>): SyncRetrievalIndexResult {
  const indexPath = assertOffRepoIndexPath(options.path, options.repoRoot);
  const previous = existingIndex(indexPath);
  const previousReleaseId = envelopeReleaseId(previous);
  const previousTotal = previous?.rows.filter((row) => row.script).length ?? 0;
  if (options.items.length === 0) {
    return Object.freeze({
      path: indexPath,
      releaseId: options.releaseId,
      previousReleaseId,
      total: 0,
      wrote: false,
      skipped: true,
      reason: 'empty',
    });
  }
  const parsed = options.items.flatMap((item) => {
    const row = rowFromSnapshot(item, options.releaseId);
    return row ? [row] : [];
  });
  if (parsed.length === 0) {
    return Object.freeze({
      path: indexPath,
      releaseId: options.releaseId,
      previousReleaseId,
      total: 0,
      wrote: false,
      skipped: true,
      reason: 'invalid',
    });
  }
  if (!options.rebuild && previous && previousTotal > parsed.length) {
    return Object.freeze({
      path: indexPath,
      releaseId: previousReleaseId ?? options.releaseId,
      previousReleaseId,
      total: previousTotal,
      wrote: false,
      skipped: true,
      reason: 'kept-larger',
    });
  }
  const document = preserveSpokenQuestions(Object.freeze({
    envelope: Object.freeze({
      version: 1,
      source: 'announce-snapshot',
      releaseId: options.releaseId,
    }),
    rows: Object.freeze(parsed),
  }), options.rebuild ? null : previous);
  const body = serializeRetrievalIndex(document);
  const aligned = !options.rebuild && previous !== null && serializeRetrievalIndex(previous) === body;
  if (aligned || options.dryRun) {
    return Object.freeze({
      path: indexPath,
      releaseId: options.releaseId,
      previousReleaseId,
      total: parsed.length,
      wrote: false,
      skipped: aligned,
      reason: aligned ? 'aligned' : 'dry-run',
    });
  }
  writeAtomic(indexPath, body);
  return Object.freeze({
    path: indexPath,
    releaseId: options.releaseId,
    previousReleaseId,
    total: parsed.length,
    wrote: true,
    skipped: false,
    reason: 'wrote',
  });
}

export async function enrichRetrievalIndex(options: Readonly<{
  indexPath: string;
  repoRoot: string;
  generate: Doc2QueryGenerator;
  rebuild?: boolean;
  limit?: number;
  dryRun?: boolean;
  onBatch?: (done: number, targeted: number, updated: number) => void;
}>): Promise<EnrichRetrievalIndexResult> {
  const indexPath = assertOffRepoIndexPath(options.indexPath, options.repoRoot);
  if (!existsSync(indexPath)) throw new Error('retrieval index file is missing');
  let document = readRetrievalIndexFile(indexPath);
  const total = document.rows.length;
  const targets = doc2queryInputs(document, { rebuild: options.rebuild, limit: options.limit });
  const skipped = total - targets.length;
  if (targets.length === 0 || options.dryRun) {
    return Object.freeze({
      path: indexPath,
      total,
      targeted: targets.length,
      updated: 0,
      skipped,
      failed: 0,
      wrote: false,
    });
  }
  let updated = 0;
  let failed = 0;
  for (let offset = 0; offset < targets.length; offset += DOC2QUERY_BATCH_SIZE) {
    const batch = targets.slice(offset, offset + DOC2QUERY_BATCH_SIZE);
    const generated = await options.generate(batch);
    const applied = new Map<string, readonly string[]>();
    for (const item of batch) {
      const questions = generated.get(item.scriptId) ?? [];
      if (questions.length === 0) {
        failed += 1;
        continue;
      }
      applied.set(item.scriptId, questions);
      updated += 1;
    }
    if (applied.size > 0) {
      document = options.rebuild ? replaceQuestions(document, applied) : withQuestions(document, applied);
      writeAtomic(indexPath, serializeRetrievalIndex(document));
    }
    options.onBatch?.(Math.min(offset + batch.length, targets.length), targets.length, updated);
  }
  return Object.freeze({
    path: indexPath,
    total,
    targeted: targets.length,
    updated,
    skipped,
    failed,
    wrote: updated > 0,
  });
}
