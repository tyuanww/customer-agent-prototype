import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Off-repo stack files. Packaged clients load these without shell env. */
export function defaultSyntheticStackFile(name: string, home = homedir()): string {
  return join(home, '.customer-agent-synthetic-stack', name);
}

export const DEFAULT_RETRIEVAL_INDEX_PATH = defaultSyntheticStackFile('retrieval-index.json');
export const DEFAULT_HYDRATE_INDEX_PATH = defaultSyntheticStackFile('retrieval-hydrate.json');

/**
 * Packaged startup ignores origin env and also must not depend on a developer
 * shell exporting retrieval paths. If the known off-repo files exist, point
 * hydrate / BM25 at them so leftover `/v1/search` is not the packaged main chain.
 */
export function applyPackagedRetrievalDefaults(
  env: NodeJS.ProcessEnv,
  paths: { hydrate: string; index: string } = {
    hydrate: DEFAULT_HYDRATE_INDEX_PATH,
    index: DEFAULT_RETRIEVAL_INDEX_PATH,
  },
): void {
  if (existsSync(paths.hydrate)) env.CUSTOMER_AGENT_HYDRATE_INDEX = paths.hydrate;
  if (existsSync(paths.index)) env.CUSTOMER_AGENT_RETRIEVAL_INDEX = paths.index;
}
