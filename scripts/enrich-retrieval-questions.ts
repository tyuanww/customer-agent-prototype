#!/usr/bin/env node
/**
 * Fill off-repo retrieval-index.json questions[] via Doc2Query.
 *
 *   pnpm retrieval:questions
 *   pnpm retrieval:questions -- --dry-run
 *   pnpm retrieval:questions -- --limit 8
 *   pnpm retrieval:questions -- --rebuild
 *
 * Writes only outside the git worktree. MiniMax sees title + shortcut question,
 * never answer text. Does not commit, pack, or start the synthetic stack.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMinimaxQuestionGenerator } from '../apps/desktop/src/main/doc2query-generate.ts';
import { enrichRetrievalIndex } from '../apps/desktop/src/main/retrieval-index-store.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultIndex = join(homedir(), '.customer-agent-synthetic-stack', 'retrieval-index.json');
const defaultEnv = join(homedir(), '.customer-agent-synthetic-stack', 'minimax.env');

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
  const indexPath = argValue('--index') || process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX?.trim() || defaultIndex;
  const result = await enrichRetrievalIndex({
    indexPath,
    repoRoot,
    generate: createMinimaxQuestionGenerator(),
    rebuild,
    limit,
    dryRun,
    onBatch(done, targeted, updated) {
      console.error(`doc2query ${done}/${targeted} updated=${updated}`);
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
    dryRun,
    rebuild,
  }));
  if (!dryRun && result.targeted > 0 && result.updated === 0) process.exitCode = 1;
}
