import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  answerContentHash,
  matchingDenseRows,
  parseDenseCatalog,
  rankDense,
  serializeDenseCatalog,
  DENSE_CATALOG_VERSION,
  DENSE_MODEL_EMBO,
  type DenseCatalog,
  type DenseRank,
  type DenseVectorRow,
} from '../shared/dense-retrieve.ts';
import type { RetrievalScript } from '../shared/hybrid-retrieve.ts';
import { assertOffRepoIndexPath, type RetrievalSnapshotItem } from './retrieval-index-store.ts';
import { EMBED_BATCH, minimaxEmbed, type EmbedKind } from './minimax-embed.ts';
import { minimaxConfigured, type MinimaxChatOptions } from './minimax-chat.ts';
import {
  DEFAULT_EMBEDDING_INDEX_PATH,
  productStackReadPath,
  runtimeStackReadPath,
} from './packaged-retrieval-paths.ts';

export const DEFAULT_EMBED_PATH = DEFAULT_EMBEDDING_INDEX_PATH;

export type DenseQueryRanker = Readonly<{
  rank(query: string, scripts: readonly RetrievalScript[], signal?: AbortSignal): Promise<readonly DenseRank[] | null>;
}>;

export type EmbedCatalogResult = Readonly<{
  path: string;
  total: number;
  targeted: number;
  updated: number;
  skipped: number;
  failed: number;
  wrote: boolean;
  dim: number | null;
}>;

function writeAtomic(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, body);
  renameSync(tempPath, path);
}

export function loadDenseCatalog(
  path = runtimeStackReadPath('CUSTOMER_AGENT_EMBEDDING_INDEX', 'retrieval-embeddings.json'),
): DenseCatalog | null {
  if (!path || path.trim().length === 0 || !existsSync(path)) return null;
  try {
    return parseDenseCatalog(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function createDenseQueryRanker(
  catalog: DenseCatalog | null,
  options: MinimaxChatOptions = {},
): DenseQueryRanker | null {
  if (!catalog) return null;
  return Object.freeze({
    async rank(query, scripts, signal) {
      const matched = matchingDenseRows(catalog, scripts);
      if (matched.length === 0) return null;
      const vectors = await minimaxEmbed([query], 'query', { ...options, signal, timeoutMs: options.timeoutMs ?? 2500 });
      const queryVector = vectors?.[0];
      if (!queryVector || queryVector.length !== catalog.dim) return null;
      const ranks = rankDense(queryVector, matched);
      return ranks.length > 0 ? ranks : null;
    },
  });
}

function desktopRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
}

/** Re-reads the off-repo catalog so a background embed is visible on the next query. */
export function liveDenseQueryRanker(options: MinimaxChatOptions = {}): DenseQueryRanker {
  return Object.freeze({
    async rank(query, scripts, signal) {
      const path = (process.env.CUSTOMER_AGENT_EMBEDDING_INDEX ?? '').trim()
        || productStackReadPath('CUSTOMER_AGENT_EMBEDDING_INDEX', 'retrieval-embeddings.json');
      if (path.length === 0) return null;
      const ranker = createDenseQueryRanker(loadDenseCatalog(path), options);
      if (!ranker) return null;
      return ranker.rank(query, scripts, signal);
    },
  });
}

function scriptsFromSnapshot(items: readonly RetrievalSnapshotItem[]): RetrievalScript[] {
  const scripts: RetrievalScript[] = [];
  for (const item of items) {
    if (typeof item.script_id !== 'string' || item.script_id.length < 1) continue;
    if (typeof item.title !== 'string' || item.title.trim().length < 1) continue;
    if (typeof item.answer_text !== 'string' || item.answer_text.trim().length < 1) continue;
    const questionText = typeof item.questions?.[0]?.question_text === 'string'
      ? item.questions[0].question_text.trim()
      : '';
    scripts.push(Object.freeze({
      scriptId: item.script_id,
      title: item.title.trim(),
      questionText,
      answerText: item.answer_text,
      ...(typeof item.category === 'string' && item.category.trim().length > 0
        ? { category: item.category.trim() }
        : {}),
    }));
  }
  return scripts;
}

/**
 * Embed snapshot answers whose content hash is missing or stale. Login must
 * not await this; MiniMax failure keeps the BM25 answer lane.
 */
export async function deliverRetrievalEmbeddingsFromEnv(
  items: readonly RetrievalSnapshotItem[],
  options: Readonly<{
    embed?: (texts: readonly string[], kind: EmbedKind) => Promise<readonly (readonly number[])[] | null>;
    repoRoot?: string;
  }> = {},
): Promise<EmbedCatalogResult | null> {
  if (!options.embed && !minimaxConfigured()) return null;
  const catalogPath = (process.env.CUSTOMER_AGENT_EMBEDDING_INDEX ?? '').trim()
    || productStackReadPath('CUSTOMER_AGENT_EMBEDDING_INDEX', 'retrieval-embeddings.json')
    || DEFAULT_EMBED_PATH;
  const scripts = scriptsFromSnapshot(items);
  if (scripts.length === 0) return null;
  try {
    return await embedRetrievalIndex({
      indexScripts: scripts,
      catalogPath,
      repoRoot: options.repoRoot ?? desktopRepoRoot(),
      ...(options.embed ? { embed: options.embed } : {}),
    });
  } catch {
    return null;
  }
}

export function scheduleRetrievalEmbeddingsFromEnv(items: readonly RetrievalSnapshotItem[]): void {
  void deliverRetrievalEmbeddingsFromEnv(items);
}

export async function embedRetrievalIndex(options: Readonly<{
  indexScripts: readonly RetrievalScript[];
  catalogPath: string;
  repoRoot: string;
  embed?: (texts: readonly string[], kind: EmbedKind) => Promise<readonly (readonly number[])[] | null>;
  rebuild?: boolean;
  limit?: number;
  dryRun?: boolean;
  onBatch?: (done: number, targeted: number, updated: number) => void;
}>): Promise<EmbedCatalogResult> {
  const catalogPath = assertOffRepoIndexPath(options.catalogPath, options.repoRoot);
  const embed = options.embed ?? ((texts: readonly string[], kind: EmbedKind) => minimaxEmbed(texts, kind, { timeoutMs: 20_000 }));
  const existing = existsSync(catalogPath) ? loadDenseCatalog(catalogPath) : null;
  const previous = new Map((existing?.rows ?? []).map((row) => [row.scriptId, row]));
  const targets: RetrievalScript[] = [];
  for (const script of options.indexScripts) {
    if (script.answerText.trim().length === 0) continue;
    const hash = answerContentHash(script.answerText);
    const prior = previous.get(script.scriptId);
    if (!options.rebuild && prior && prior.contentHash === hash) continue;
    targets.push(script);
    if (options.limit !== undefined && targets.length >= options.limit) break;
  }
  const skipped = options.indexScripts.length - targets.length;
  if (targets.length === 0 || options.dryRun) {
    return Object.freeze({
      path: catalogPath,
      total: options.indexScripts.length,
      targeted: targets.length,
      updated: 0,
      skipped,
      failed: 0,
      wrote: false,
      dim: existing?.dim ?? null,
    });
  }
  const rows = new Map<string, DenseVectorRow>(previous);
  let updated = 0;
  let failed = 0;
  let dim = existing?.dim ?? null;
  for (let offset = 0; offset < targets.length; offset += EMBED_BATCH) {
    const batch = targets.slice(offset, offset + EMBED_BATCH);
    const vectors = await embed(batch.map((script) => script.answerText), 'db');
    if (!vectors || vectors.length !== batch.length) {
      failed += batch.length;
      options.onBatch?.(Math.min(offset + batch.length, targets.length), targets.length, updated);
      continue;
    }
    if (dim !== null && vectors.some((vector) => vector.length !== dim)) {
      failed += batch.length;
      options.onBatch?.(Math.min(offset + batch.length, targets.length), targets.length, updated);
      continue;
    }
    dim = vectors[0]?.length ?? dim;
    for (let i = 0; i < batch.length; i += 1) {
      const script = batch[i];
      const vector = vectors[i];
      if (!script || !vector) {
        failed += 1;
        continue;
      }
      rows.set(script.scriptId, Object.freeze({
        scriptId: script.scriptId,
        contentHash: answerContentHash(script.answerText),
        vector,
      }));
      updated += 1;
    }
    if (dim !== null && updated > 0) {
      const catalog: DenseCatalog = Object.freeze({
        version: DENSE_CATALOG_VERSION,
        model: existing?.model ?? DENSE_MODEL_EMBO,
        dim,
        rows: Object.freeze([...rows.values()]),
      });
      writeAtomic(catalogPath, serializeDenseCatalog(catalog));
    }
    options.onBatch?.(Math.min(offset + batch.length, targets.length), targets.length, updated);
  }
  return Object.freeze({
    path: catalogPath,
    total: options.indexScripts.length,
    targeted: targets.length,
    updated,
    skipped,
    failed,
    wrote: updated > 0,
    dim,
  });
}
