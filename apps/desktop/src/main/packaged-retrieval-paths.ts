import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Off-repo stack files. Product-mode clients load these without shell env. */
export function defaultSyntheticStackFile(name: string, home = homedir()): string {
  return join(home, '.customer-agent-synthetic-stack', name);
}

export function originKey(apiOrigin: string): string {
  return createHash('sha256').update(apiOrigin).digest('hex').slice(0, 16);
}

export function originKeyedStackFile(name: string, apiOrigin: string, home = homedir()): string {
  const suffix = name.endsWith('.json') ? '.json' : '';
  const stem = suffix.length > 0 ? name.slice(0, -suffix.length) : name;
  return defaultSyntheticStackFile(`${stem}.${originKey(apiOrigin)}${suffix}`, home);
}

/** Prefer origin-keyed files so two API targets do not share a catalog. */
export function resolveRetrievalStackFile(
  name: string,
  apiOrigin: string | undefined,
  home = homedir(),
): string {
  const fallback = defaultSyntheticStackFile(name, home);
  if (!apiOrigin) return fallback;
  const keyed = originKeyedStackFile(name, apiOrigin, home);
  if (existsSync(keyed)) return keyed;
  if (existsSync(fallback)) return fallback;
  return keyed;
}

/**
 * Product-mode writes must hit the keyed path. Copy a leftover unkeyed file
 * once so the first origin does not keep mutating the shared catalog.
 */
export function seedOriginKeyedStackFile(
  name: string,
  apiOrigin: string,
  home = homedir(),
): string {
  const keyed = originKeyedStackFile(name, apiOrigin, home);
  const unkeyed = defaultSyntheticStackFile(name, home);
  if (!existsSync(keyed) && existsSync(unkeyed)) {
    try {
      mkdirSync(dirname(keyed), { recursive: true });
      copyFileSync(unkeyed, keyed);
    } catch {
      // Best-effort seed. Login persist still writes the keyed path; a copy
      // failure must not abort packaged startup.
    }
  }
  return keyed;
}

export const DEFAULT_RETRIEVAL_INDEX_PATH = defaultSyntheticStackFile('retrieval-index.json');
export const DEFAULT_HYDRATE_INDEX_PATH = defaultSyntheticStackFile('retrieval-hydrate.json');
export const DEFAULT_EMBEDDING_INDEX_PATH = defaultSyntheticStackFile('retrieval-embeddings.json');
export const DEFAULT_RETRIEVAL_PREFERENCE_PATH = defaultSyntheticStackFile('retrieval-preference.json');

/** CLI / desktop write target. Honors CUSTOMER_AGENT_DESKTOP_API_ORIGIN. */
export function defaultStackWritePath(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  const origin = (env.CUSTOMER_AGENT_DESKTOP_API_ORIGIN ?? '').trim();
  if (origin.length > 0) return seedOriginKeyedStackFile(name, origin, home);
  return defaultSyntheticStackFile(name, home);
}

/** Read path: explicit env, else origin-keyed file, else leftover unkeyed. */
export function envOrOriginStackFile(
  envName: string,
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  const explicit = (env[envName] ?? '').trim();
  if (explicit.length > 0) return explicit;
  const origin = (env.CUSTOMER_AGENT_DESKTOP_API_ORIGIN ?? '').trim();
  return resolveRetrievalStackFile(name, origin.length > 0 ? origin : undefined, home);
}

/**
 * Runtime readers: explicit env, else origin-keyed path. Empty when neither
 * is set so unit tests do not load the operator's real home catalog.
 */
export function productStackReadPath(
  envName: string,
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  const explicit = (env[envName] ?? '').trim();
  if (explicit.length > 0) return explicit;
  const origin = (env.CUSTOMER_AGENT_DESKTOP_API_ORIGIN ?? '').trim();
  if (origin.length === 0) return '';
  return originKeyedStackFile(name, origin, home);
}

/**
 * Runtime read: origin-set never falls back to leftover unkeyed files.
 * Origin unset still uses leftover unkeyed for local dashboard / CLI.
 */
export function runtimeStackReadPath(
  envName: string,
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  const isolated = productStackReadPath(envName, name, env, home);
  if (isolated.length > 0) return isolated;
  return envOrOriginStackFile(envName, name, env, home);
}

/**
 * Product-mode startup (packaged or `pnpm dev` with loopback origins) must not
 * depend on a developer shell exporting retrieval paths. Existing off-repo
 * files win. With an API origin, missing files still get origin-keyed default
 * paths so login persist cannot overwrite another target's catalog.
 */
export function applyPackagedRetrievalDefaults(
  env: NodeJS.ProcessEnv,
  paths: {
    hydrate?: string;
    index?: string;
    embeddings?: string;
    preference?: string;
    telemetry?: string;
    apiOrigin?: string;
    home?: string;
  } = {},
): void {
  const origin = (paths.apiOrigin ?? '').trim();
  if (origin.length > 0 && (env.CUSTOMER_AGENT_DESKTOP_API_ORIGIN ?? '').trim().length === 0) {
    env.CUSTOMER_AGENT_DESKTOP_API_ORIGIN = origin;
  }
  const hydrate = paths.hydrate ?? stackPath('retrieval-hydrate.json', paths);
  const index = paths.index ?? stackPath('retrieval-index.json', paths);
  const embeddings = paths.embeddings ?? stackPath('retrieval-embeddings.json', paths);
  const preference = paths.preference ?? stackPath('retrieval-preference.json', paths);
  const telemetry = paths.telemetry ?? stackPath('retrieval-telemetry.json', paths);
  assignRetrievalEnv(env, 'CUSTOMER_AGENT_HYDRATE_INDEX', hydrate, Boolean(paths.apiOrigin));
  assignRetrievalEnv(env, 'CUSTOMER_AGENT_RETRIEVAL_INDEX', index, Boolean(paths.apiOrigin));
  assignRetrievalEnv(env, 'CUSTOMER_AGENT_EMBEDDING_INDEX', embeddings, Boolean(paths.apiOrigin));
  assignRetrievalEnv(env, 'CUSTOMER_AGENT_RETRIEVAL_PREFERENCE', preference, Boolean(paths.apiOrigin));
  assignRetrievalEnv(env, 'CUSTOMER_AGENT_RETRIEVAL_TELEMETRY', telemetry, Boolean(paths.apiOrigin));
}

function stackPath(
  name: string,
  paths: { apiOrigin?: string; home?: string },
): string {
  return paths.apiOrigin
    ? seedOriginKeyedStackFile(name, paths.apiOrigin, paths.home)
    : resolveRetrievalStackFile(name, undefined, paths.home);
}

function assignRetrievalEnv(
  env: NodeJS.ProcessEnv,
  key:
    | 'CUSTOMER_AGENT_HYDRATE_INDEX'
    | 'CUSTOMER_AGENT_RETRIEVAL_INDEX'
    | 'CUSTOMER_AGENT_EMBEDDING_INDEX'
    | 'CUSTOMER_AGENT_RETRIEVAL_PREFERENCE'
    | 'CUSTOMER_AGENT_RETRIEVAL_TELEMETRY',
  path: string,
  isolate: boolean,
): void {
  const current = (env[key] ?? '').trim();
  if (existsSync(path) || (isolate && current.length === 0)) {
    env[key] = path;
  }
}

/** Empty string stays empty so tests can opt out. Unset falls back to an existing stack file. */
export function resolveStackFile(explicit: string | undefined, fallback: string): string | undefined {
  if (explicit !== undefined) {
    const trimmed = explicit.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return existsSync(fallback) ? fallback : undefined;
}
