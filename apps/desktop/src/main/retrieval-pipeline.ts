import { existsSync, readFileSync } from 'node:fs';
import {
  rankScriptsMulti,
  RETRIEVAL_POOL,
  type RankedRetrieval,
  type RetrievalScript,
} from '../shared/hybrid-retrieve';
import { parseRetrievalIndex, scriptsOf } from '../shared/retrieval-index.ts';
import { planQuery, type PlannedIntent } from './minimax-plan';
import { loadMinimaxReranker, type Reranker } from './minimax-rerank';
import { minimaxConfigured, type MinimaxChatOptions } from './minimax-chat';
import { createDenseQueryRanker, loadDenseCatalog, type DenseQueryRanker } from './retrieval-embeddings-store.ts';

export type RetrievalRun = Readonly<{
  ranked: readonly RankedRetrieval[];
  intent: PlannedIntent;
}>;

export type RetrievalPipeline = Readonly<{
  run(query: string, smartEnabled: boolean, signal?: AbortSignal): Promise<RetrievalRun>;
}>;

export function createRetrievalPipeline(
  scripts: readonly RetrievalScript[],
  options: MinimaxChatOptions & { rerank?: Reranker | null; dense?: DenseQueryRanker | null } = {},
): RetrievalPipeline {
  const rerank = options.rerank ?? loadMinimaxReranker(options);
  const dense = options.dense ?? null;
  return Object.freeze({
    async run(query: string, smartEnabled: boolean, signal?: AbortSignal) {
      const trimmed = query.trim();
      if (trimmed.length === 0 || scripts.length === 0) {
        return Object.freeze({ ranked: Object.freeze([]), intent: 'other' as const });
      }
      const useSmart = smartEnabled && minimaxConfigured();
      const plan = useSmart ? await planQuery(trimmed, { ...options, signal }) : null;
      const intent = plan?.intent ?? 'other';
      const queries = plan?.queries ?? [trimmed];
      const denseRanks = dense ? await dense.rank(trimmed, scripts, signal) : null;
      const pooled = rankScriptsMulti(queries, scripts, RETRIEVAL_POOL, denseRanks);
      if (pooled.length === 0) return Object.freeze({ ranked: Object.freeze([]), intent });
      if (!useSmart || !rerank) return Object.freeze({ ranked: pooled, intent });
      return Object.freeze({ ranked: await rerank.rerank(trimmed, pooled, signal), intent });
    },
  });
}

export function loadRetrievalPipeline(
  indexPath = process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX,
  options: MinimaxChatOptions & { rerank?: Reranker | null; dense?: DenseQueryRanker | null } = {},
): RetrievalPipeline {
  const empty: RetrievalPipeline = Object.freeze({
    run: async () => Object.freeze({ ranked: Object.freeze([]), intent: 'other' as const }),
  });
  if (!indexPath || indexPath.trim().length === 0 || !existsSync(indexPath)) return empty;
  try {
    const document = parseRetrievalIndex(readFileSync(indexPath, 'utf8'));
    const scripts = document ? scriptsOf(document) : [];
    if (scripts.length === 0) return empty;
    return createRetrievalPipeline(scripts, {
      ...options,
      dense: options.dense ?? createDenseQueryRanker(loadDenseCatalog(), options),
    });
  } catch {
    return empty;
  }
}


