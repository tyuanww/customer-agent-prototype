import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DOC2QUERY_BATCH_SIZE, type Doc2QueryGenerator } from './doc2query-generate.ts';
import {
  doc2queryInputs,
  parseRetrievalIndex,
  replaceQuestions,
  serializeRetrievalIndex,
  withQuestions,
  type RetrievalIndexDocument,
} from '../shared/retrieval-index.ts';

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
