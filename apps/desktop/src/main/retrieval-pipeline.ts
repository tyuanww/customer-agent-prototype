import { existsSync, readFileSync } from 'node:fs';
import {
  rankScriptsMulti,
  RETRIEVAL_POOL,
  type RankedRetrieval,
  type RetrievalScript,
} from '../shared/hybrid-retrieve';
import { planQuery } from './minimax-plan';
import { loadMinimaxReranker, type Reranker } from './minimax-rerank';
import { minimaxConfigured, type MinimaxChatOptions } from './minimax-chat';

export type RetrievalPipeline = Readonly<{
  run(query: string, smartEnabled: boolean, signal?: AbortSignal): Promise<readonly RankedRetrieval[]>;
}>;

type IndexFile = Readonly<{
  scripts: readonly RetrievalScript[];
}>;

function parseIndex(raw: string): readonly RetrievalScript[] {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') return Object.freeze([]);
  const scripts = Reflect.get(value as IndexFile, 'scripts');
  if (!Array.isArray(scripts)) return Object.freeze([]);
  const rows: RetrievalScript[] = [];
  for (const item of scripts) {
    if (!item || typeof item !== 'object') continue;
    const scriptId = Reflect.get(item, 'scriptId');
    const title = Reflect.get(item, 'title');
    const questionText = Reflect.get(item, 'questionText');
    const answerText = Reflect.get(item, 'answerText');
    if (typeof scriptId !== 'string' || scriptId.length < 1 || scriptId.length > 128) continue;
    if (typeof title !== 'string' || title.trim().length < 1) continue;
    const questionsRaw = Reflect.get(item, 'questions');
    const questions = Array.isArray(questionsRaw)
      ? questionsRaw.filter((row): row is string => typeof row === 'string' && row.trim().length > 0)
      : [];
    rows.push(Object.freeze({
      scriptId,
      title: title.trim(),
      questionText: typeof questionText === 'string' ? questionText : '',
      answerText: typeof answerText === 'string' ? answerText : '',
      questions: Object.freeze(questions),
    }));
  }
  return Object.freeze(rows);
}

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
    const scripts = parseIndex(readFileSync(indexPath, 'utf8'));
    if (scripts.length === 0) return empty;
    return createRetrievalPipeline(scripts, options);
  } catch {
    return empty;
  }
}


