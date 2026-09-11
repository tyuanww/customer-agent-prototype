import { existsSync, readFileSync } from 'node:fs';
import { rankScripts, type RankedRetrieval, type RetrievalScript } from '../shared/semantic-retrieve';

export type SemanticRetriever = Readonly<{
  rank(query: string): readonly RankedRetrieval[];
}>;

type IndexFile = Readonly<{
  version: number;
  scripts: readonly RetrievalScript[];
}>;

const emptyRetriever: SemanticRetriever = Object.freeze({
  rank: () => Object.freeze([]),
});

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
    rows.push(Object.freeze({
      scriptId,
      title: title.trim(),
      questionText: typeof questionText === 'string' ? questionText : '',
      answerText: typeof answerText === 'string' ? answerText : '',
    }));
  }
  return Object.freeze(rows);
}

export function loadSemanticRetriever(indexPath = process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX): SemanticRetriever {
  if (!indexPath || indexPath.trim().length === 0) return emptyRetriever;
  if (!existsSync(indexPath)) return emptyRetriever;
  try {
    const scripts = parseIndex(readFileSync(indexPath, 'utf8'));
    if (scripts.length === 0) return emptyRetriever;
    return Object.freeze({
      rank(query: string): readonly RankedRetrieval[] {
        return rankScripts(query, scripts);
      },
    });
  } catch {
    return emptyRetriever;
  }
}
