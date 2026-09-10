import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';

/**
 * Resolves the synthetic product profile for a packaged build.
 *
 * The packaged client must be able to run the synthetic query chain without
 * weakening the original protections, so the origins are *not* taken from the
 * environment. They come from a small file inside the app's own userData
 * directory, written by `scripts/synthetic-stack/stack.ts`:
 *
 *   { "mode": "synthetic-local", "apiOrigin": "http://127.0.0.1:43100",
 *     "identityOrigin": "http://127.0.0.1:43101" }
 *
 * Every field is re-validated here, so the file cannot widen the client's reach:
 * the mode must be exact, both origins must be bare `http://127.0.0.1:<port>/`
 * with a non-privileged port, and the file must be a regular file under
 * userData (no symlink, no traversal). There is still no way to point the
 * packaged client at a non-loopback host, at a path or at a URL with
 * credentials — the same restrictions the development profile enforced.
 *
 * A missing or invalid file is a startup error: the packaged client must not
 * fall back to the offline S0 fixture, and it must not consult the environment
 * as a substitute. Unpackaged development without both origins still stays S0.
 */
export const SYNTHETIC_STACK_PROFILE_FILE = 'synthetic-stack.json';
const MODE = 'synthetic-local';
const MAX_BYTES = 4_096;
const PACKAGED_PROFILE_ERROR =
  'Packaged desktop requires a valid synthetic-stack.json under userData';

export type PackagedProductProfile = Readonly<{
  apiOrigin: string;
  identityOrigin: string;
}>;

function loopbackOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  const port = Number(url.port);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
    || !Number.isInteger(port) || port < 1024 || port > 65_535
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return undefined;
  return url.origin;
}

function failPackagedProfile(): never {
  throw new Error(PACKAGED_PROFILE_ERROR);
}

function parsePackagedProductProfile(userDataDirectory: string): PackagedProductProfile | undefined {
  const file = path.join(userDataDirectory, SYNTHETIC_STACK_PROFILE_FILE);
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES) return undefined;
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (record.mode !== MODE) return undefined;
    const apiOrigin = loopbackOrigin(record.apiOrigin);
    const identityOrigin = loopbackOrigin(record.identityOrigin);
    if (apiOrigin === undefined || identityOrigin === undefined || apiOrigin === identityOrigin) return undefined;
    return Object.freeze({ apiOrigin, identityOrigin });
  } catch {
    // Missing, unreadable, or non-JSON files take the same fail-closed path.
    return undefined;
  }
}

/** Read and validate the packaged synthetic profile. Missing or invalid files fail closed. */
export function readPackagedProductProfile(userDataDirectory: string): PackagedProductProfile {
  return parsePackagedProductProfile(userDataDirectory) ?? failPackagedProfile();
}

/**
 * Choose the product origin source. Packaged builds read only the userData
 * file and ignore `environment`; unpackaged builds read loopback env vars.
 */
export function resolveProductProfile(
  packaged: boolean,
  userDataDirectory: string,
  environment: NodeJS.ProcessEnv,
): PackagedProductProfile | undefined {
  if (packaged) return readPackagedProductProfile(userDataDirectory);
  return developmentProductProfile(environment);
}

/**
 * Environment-provided origins are a development affordance only. In a packaged
 * build they are ignored rather than trusted, so an operator cannot repoint an
 * installed client by setting variables.
 *
 * A half-configured pair is a mistake, not a request to run offline: setting
 * only one of the two variables used to abort startup and must keep doing so,
 * otherwise a typo would silently drop the client back to the S0 fixture path.
 */
export function developmentProductProfile(environment: NodeJS.ProcessEnv): PackagedProductProfile | undefined {
  const apiOrigin = environment.CUSTOMER_AGENT_DESKTOP_API_ORIGIN;
  const identityOrigin = environment.CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN;
  if (apiOrigin === undefined && identityOrigin === undefined) return undefined;
  const api = loopbackOrigin(apiOrigin);
  const identity = loopbackOrigin(identityOrigin);
  if (api === undefined || identity === undefined) {
    throw new Error('Synthetic desktop requires both exact loopback origins in development');
  }
  return Object.freeze({ apiOrigin: api, identityOrigin: identity });
}
