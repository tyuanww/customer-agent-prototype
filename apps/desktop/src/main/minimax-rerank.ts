/**
 * MiniMax reranks BM25+RRF candidates. It must return existing script ids only
 * and never generate answer text. Missing key or timeout falls back to BM25 order.
 */
import type { RankedRetrieval } from '../shared/hybrid-retrieve';
import { minimaxChatContent, minimaxConfigured, type MinimaxChatOptions } from './minimax-chat';

export type Reranker = Readonly<{
  rerank(query: string, ranked: readonly RankedRetrieval[], signal?: AbortSignal): Promise<readonly RankedRetrieval[]>;
}>;

export type MinimaxRerankerOptions = MinimaxChatOptions;

const TOP_N = 8;

export function parseRerankIds(raw: string, allowed: readonly string[]): string[] {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    const ids = parsed && typeof parsed === 'object' ? Reflect.get(parsed, 'ids') : undefined;
    if (!Array.isArray(ids)) return [];
    const allow = new Set(allowed);
    const out: string[] = [];
    for (const id of ids) {
      if (typeof id !== 'string' || !allow.has(id) || out.includes(id)) continue;
      out.push(id);
    }
    return out;
  } catch {
    return [];
  }
}

function mergeOrder(preferred: readonly string[], ranked: readonly RankedRetrieval[]): RankedRetrieval[] {
  const byId = new Map(ranked.map((row) => [row.scriptId, row]));
  const out: RankedRetrieval[] = [];
  for (const id of preferred) {
    const row = byId.get(id);
    if (!row) continue;
    out.push(row);
    byId.delete(id);
  }
  for (const row of ranked) if (byId.has(row.scriptId)) out.push(row);
  return out;
}

export function loadMinimaxReranker(options: MinimaxRerankerOptions = {}): Reranker | null {
  if (!minimaxConfigured()) return null;
  return Object.freeze({
    async rerank(query: string, ranked: readonly RankedRetrieval[], signal?: AbortSignal) {
      if (ranked.length <= 1) return ranked;
      const slice = ranked.slice(0, TOP_N);
      const allowed = slice.map((row) => row.scriptId);
      const content = await minimaxChatContent(
        [
          {
            role: 'system',
            content: '你是护肤品电商客服话术检索重排器。只根据顾客问句给已有候选排序。必须只输出 JSON：{"ids":["scriptId"...]}。禁止改写或生成话术正文。',
          },
          {
            role: 'user',
            content: `顾客问句：${query}\n候选：\n${slice.map((row, index) => `${index + 1}. ${row.scriptId} | ${row.title}`).join('\n')}`,
          },
        ],
        { ...options, maxTokens: 200, timeoutMs: options.timeoutMs ?? 2500, signal },
      );
      if (!content) return ranked;
      const ids = parseRerankIds(content, allowed);
      if (ids.length === 0) return ranked;
      return Object.freeze(mergeOrder(ids, ranked));
    },
  });
}
