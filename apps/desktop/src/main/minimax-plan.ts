import { minimaxChatContent, type MinimaxChatOptions } from './minimax-chat';

const INTENTS = ['shipping', 'address', 'product', 'aftersale', 'campaign', 'other'] as const;
export type PlannedIntent = (typeof INTENTS)[number];

export type QueryPlan = Readonly<{
  intent: PlannedIntent;
  queries: readonly string[];
}>;

export function parseQueryPlan(raw: string, original: string): QueryPlan {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const fallback: QueryPlan = Object.freeze({ intent: 'other', queries: Object.freeze([original]) });
  if (start < 0 || end <= start) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object') return fallback;
    const intentRaw = Reflect.get(parsed, 'intent');
    const intent = typeof intentRaw === 'string' && (INTENTS as readonly string[]).includes(intentRaw)
      ? intentRaw as PlannedIntent
      : 'other';
    const queriesRaw = Reflect.get(parsed, 'queries');
    const queries: string[] = [];
    const seen = new Set<string>();
    const originalQuery = original.trim();
    if (originalQuery.length > 0) {
      seen.add(originalQuery);
      queries.push(originalQuery);
    }
    const push = (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length < 2 || trimmed.length > 80 || seen.has(trimmed)) return;
      seen.add(trimmed);
      queries.push(trimmed);
    };
    if (Array.isArray(queriesRaw)) {
      for (const item of queriesRaw) {
        if (typeof item === 'string') push(item);
        if (queries.length >= 3) break;
      }
    }
    return Object.freeze({ intent, queries: Object.freeze(queries.length > 0 ? queries : [original]) });
  } catch {
    return fallback;
  }
}

export async function planQuery(
  query: string,
  options: MinimaxChatOptions = {},
): Promise<QueryPlan> {
  const content = await minimaxChatContent(
    [
      {
        role: 'system',
        content: '你是护肤品电商客服检索查询规划器。只输出 JSON：{"intent":"shipping|address|product|aftersale|campaign|other","queries":["检索式"...]}。queries 1到3条，给 BM25 用，写成顾客问法或标题用语。禁止写话术正文。',
      },
      { role: 'user', content: `顾客问句：${query}` },
    ],
    { ...options, maxTokens: 120, timeoutMs: options.timeoutMs ?? 1800 },
  );
  if (!content) return Object.freeze({ intent: 'other', queries: Object.freeze([query]) });
  return parseQueryPlan(content, query);
}
