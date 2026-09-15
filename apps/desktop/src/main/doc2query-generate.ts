import {
  normalizeQuestions,
  type Doc2QueryInput,
} from '../shared/doc2query.ts';
import { minimaxChatContent, minimaxConfigured, type MinimaxChatOptions } from './minimax-chat.ts';

export const DOC2QUERY_BATCH_SIZE = 8;

export type Doc2QueryGenerator = (
  batch: readonly Doc2QueryInput[],
) => Promise<ReadonlyMap<string, readonly string[]>>;

function extractJson(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function parseGeneratedQuestions(
  raw: string,
  batch: readonly Doc2QueryInput[],
): ReadonlyMap<string, readonly string[]> {
  const parsed = extractJson(raw);
  const byId = new Map(batch.map((item) => [item.scriptId, item]));
  const out = new Map<string, readonly string[]>();
  if (!parsed || typeof parsed !== 'object') return out;
  const items = Reflect.get(parsed, 'items');
  if (!Array.isArray(items)) return out;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const idRaw = Reflect.get(item, 'id') ?? Reflect.get(item, 'scriptId');
    if (typeof idRaw !== 'string' || !byId.has(idRaw) || out.has(idRaw)) continue;
    const script = byId.get(idRaw);
    if (!script) continue;
    const questions = normalizeQuestions(Reflect.get(item, 'questions'), script);
    if (questions.length === 0) continue;
    out.set(idRaw, questions);
  }
  return out;
}

function batchPrompt(batch: readonly Doc2QueryInput[]): string {
  return batch.map((item, offset) => (
    `${offset + 1}. id=${item.scriptId} | 标题=${item.title} | 问法=${item.questionText || '（无）'}`
  )).join('\n');
}

export function createMinimaxQuestionGenerator(
  options: MinimaxChatOptions = {},
): Doc2QueryGenerator {
  return async (batch) => {
    const empty = new Map<string, readonly string[]>();
    if (batch.length === 0 || !minimaxConfigured()) return empty;
    const content = await minimaxChatContent(
      [
        {
          role: 'system',
          content: '你是护肤品电商客服检索的问句入库器。只输出 JSON：{"items":[{"id":"scriptId","questions":["顾客口语问句"]}]}。每条 3 到 6 个顾客会说的问法，给 BM25 用。禁止写话术正文、政策数字或解释。不要把标题原样放进 questions。',
        },
        { role: 'user', content: `为下列话术生成顾客问法。只使用 id、标题和快捷问法：\n${batchPrompt(batch)}` },
      ],
      { ...options, maxTokens: options.maxTokens ?? 700, timeoutMs: options.timeoutMs ?? 20_000 },
    );
    if (!content) return empty;
    return parseGeneratedQuestions(content, batch);
  };
}
