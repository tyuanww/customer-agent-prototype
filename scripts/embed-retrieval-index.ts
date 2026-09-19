#!/usr/bin/env node
/**
 * Build off-repo answer embeddings for the BM25 body lane replacement.
 *
 *   pnpm retrieval:embeddings
 *   pnpm retrieval:embeddings -- --dry-run
 *   pnpm retrieval:embeddings -- --limit 16
 *
 * Uses MiniMax embo-01 (type=db). Vectors bind sha256(answerText).
 * Writes only outside the git worktree. Does not start the synthetic stack.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRetrievalIndex, scriptsOf } from '../apps/desktop/src/shared/retrieval-index.ts';
import { embedRetrievalIndex } from '../apps/desktop/src/main/retrieval-embeddings-store.ts';
import { defaultStackWritePath, defaultSyntheticStackFile } from '../apps/desktop/src/main/packaged-retrieval-paths.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultEnv = defaultSyntheticStackFile('minimax.env');

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const cut = trimmed.indexOf('=');
    if (cut <= 0) continue;
    const key = trimmed.slice(0, cut).trim();
    let value = trimmed.slice(cut + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const dryRun = process.argv.includes('--dry-run');
const rebuild = process.argv.includes('--rebuild');
const limitRaw = argValue('--limit');
const limit = limitRaw === undefined ? undefined : Number.parseInt(limitRaw, 10);
if (limitRaw !== undefined && (!Number.isInteger(limit) || (limit ?? 0) < 1)) {
  console.error('usage: --limit must be a positive integer');
  process.exitCode = 1;
} else {
  loadEnvFile(process.env.MINIMAX_ENV_FILE?.trim() || defaultEnv);
  const indexPath = argValue('--index')
    || process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX?.trim()
    || defaultStackWritePath('retrieval-index.json');
  const catalogPath = argValue('--out')
    || process.env.CUSTOMER_AGENT_EMBEDDING_INDEX?.trim()
    || defaultStackWritePath('retrieval-embeddings.json');
  const document = parseRetrievalIndex(readFileSync(indexPath, 'utf8'));
  if (!document) {
    console.error('retrieval index is missing a scripts array');
    process.exitCode = 1;
  } else {
    const result = await embedRetrievalIndex({
      indexScripts: scriptsOf(document),
      catalogPath,
      repoRoot,
      rebuild,
      limit,
      dryRun,
      onBatch(done, targeted, updated) {
        console.error(`embed ${done}/${targeted} updated=${updated}`);
      },
    });
    console.log(JSON.stringify({
      path: result.path,
      total: result.total,
      targeted: result.targeted,
      updated: result.updated,
      skipped: result.skipped,
      failed: result.failed,
      wrote: result.wrote,
      dim: result.dim,
      dryRun,
      rebuild,
    }));
    if (!dryRun && result.targeted > 0 && result.updated === 0) process.exitCode = 1;
  }
}
