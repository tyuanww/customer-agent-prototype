import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Off-repo stack files. Product-mode clients load these without shell env. */
export function defaultSyntheticStackFile(name: string, home = homedir()): string {
  return join(home, '.customer-agent-synthetic-stack', name);
}

export const DEFAULT_RETRIEVAL_INDEX_PATH = defaultSyntheticStackFile('retrieval-index.json');
export const DEFAULT_HYDRATE_INDEX_PATH = defaultSyntheticStackFile('retrieval-hydrate.json');

/**
 * Product-mode startup (packaged or `pnpm dev` with loopback origins) must not
 * depend on a developer shell exporting retrieval paths. If the known off-repo
 * files exist, point hydrate / BM25 at them so leftover `/v1/search` is not the
 * main chain.
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

/** Empty string stays empty so tests can opt out. Unset falls back to an existing stack file. */
export function resolveStackFile(explicit: string | undefined, fallback: string): string | undefined {
  if (explicit !== undefined) {
    const trimmed = explicit.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return existsSync(fallback) ? fallback : undefined;
}
