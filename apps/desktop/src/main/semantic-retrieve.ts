import { existsSync, readFileSync } from 'node:fs';
import { parseRetrievalIndex, scriptsOf } from '../shared/retrieval-index.ts';
import { rankScripts, type RankedRetrieval } from '../shared/semantic-retrieve';

export type SemanticRetriever = Readonly<{
  rank(query: string): readonly RankedRetrieval[];
}>;

const emptyRetriever: SemanticRetriever = Object.freeze({
  rank: () => Object.freeze([]),
});

export function loadSemanticRetriever(indexPath = process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX): SemanticRetriever {
  if (!indexPath || indexPath.trim().length === 0) return emptyRetriever;
  if (!existsSync(indexPath)) return emptyRetriever;
  try {
    const document = parseRetrievalIndex(readFileSync(indexPath, 'utf8'));
    const scripts = document ? scriptsOf(document) : [];
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
