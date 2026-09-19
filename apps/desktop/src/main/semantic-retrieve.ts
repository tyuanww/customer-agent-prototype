import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { parseRetrievalIndex, scriptsOf } from '../shared/retrieval-index.ts';
import { rankScripts, type RankedRetrieval } from '../shared/semantic-retrieve';
import { productStackReadPath } from './packaged-retrieval-paths.ts';

export type SemanticRetriever = Readonly<{
  rank(query: string): readonly RankedRetrieval[];
}>;

const emptyRetriever: SemanticRetriever = Object.freeze({
  rank: () => Object.freeze([]),
});

export function loadSemanticRetriever(
  indexPath?: string,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): SemanticRetriever {
  const resolved = (indexPath ?? productStackReadPath(
    'CUSTOMER_AGENT_RETRIEVAL_INDEX',
    'retrieval-index.json',
    env,
    home,
  )).trim();
  if (resolved.length === 0) return emptyRetriever;
  if (!existsSync(resolved)) return emptyRetriever;
  try {
    const document = parseRetrievalIndex(readFileSync(resolved, 'utf8'));
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
