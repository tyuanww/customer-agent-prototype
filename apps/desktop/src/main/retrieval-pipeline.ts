import { existsSync, readFileSync } from 'node:fs';
import {
  rankScriptsMulti,
  RETRIEVAL_POOL,
  type RankedRetrieval,
  type RetrievalScript,
} from '../shared/hybrid-retrieve';
import { parseRetrievalIndex, scriptsOf } from '../shared/retrieval-index.ts';
import { planQuery } from './minimax-plan';
import { loadMinimaxReranker, type Reranker } from './minimax-rerank';
import { minimaxConfigured, type MinimaxChatOptions } from './minimax-chat';

export type RetrievalPipeline = Readonly<{
  run(query: string, smartEnabled: boolean, signal?: AbortSignal): Promise<readonly RankedRetrieval[]>;
}>;

export function createRetrievalPipeline(
  scripts: readonly RetrievalScript[],
  options: MinimaxChatOptions & { rerank?: Reranker | null } = {},
): RetrievalPipeline {
  const rerank = options.rerank ?? loadMinimaxReranker(options);
  return Object.freeze({
    async run(query: string, smartEnabled: boolean, signal?: AbortSignal) {
      const trimmed = query.trim();
      if (trimmed.length === 0 || scripts.length === 0) return Object.freeze([]);
      const useSmart = smartEnabled && minimaxConfigured();
      const queries = useSmart ? (await planQuery(trimmed, { ...options, signal })).queries : [trimmed];
      const pooled = rankScriptsMulti(queries, scripts, RETRIEVAL_POOL);
      if (pooled.length === 0) return Object.freeze([]);
      if (!useSmart || !rerank) return pooled;
      return rerank.rerank(trimmed, pooled, signal);
    },
  });
}

export function loadRetrievalPipeline(
  indexPath = process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX,
  options: MinimaxChatOptions = {},
): RetrievalPipeline {
  const empty: RetrievalPipeline = Object.freeze({
    run: async () => Object.freeze([]),
  });
  if (!indexPath || indexPath.trim().length === 0 || !existsSync(indexPath)) return empty;
  try {
    const document = parseRetrievalIndex(readFileSync(indexPath, 'utf8'));
    const scripts = document ? scriptsOf(document) : [];
    if (scripts.length === 0) return empty;
    return createRetrievalPipeline(scripts, options);
  } catch {
    return empty;
  }
}


