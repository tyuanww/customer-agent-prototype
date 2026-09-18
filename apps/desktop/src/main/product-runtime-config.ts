import { readFileSync, lstatSync, writeFileSync, type Stats } from 'node:fs';
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
 * Every field is re-validated here. `synthetic-local` still only accepts
 * `http://127.0.0.1:<port>`. `product-remote` accepts `https://hostname` with
 * no userinfo, path, or non-443 port. The file must be a regular file under
 * userData (no symlink, no traversal). HTTP public hosts and IP literals stay
 * rejected.
 *
 * A missing or invalid file is a startup error: the packaged client must not
 * treat absence as offline S0, and it must not consult the environment as a
 * substitute. Offline S0 is an explicit `{ "mode": "synthetic-offline" }` file.
 * Packaged builds may copy that exact document from extraResources into
 * userData when userData has no profile yet. That copy is the package opting
 * into offline; it is not "missing file means S0". A package without the
 * bundled document still fail-closes on a missing userData file. Existing
 * synthetic-local files are never overwritten. Unpackaged development without
 * both origins still stays S0.
 */
export const SYNTHETIC_STACK_PROFILE_FILE = 'synthetic-stack.json';
export const BUNDLED_OFFLINE_PROFILE_FILE = 'synthetic-offline.json';
const MODE = 'synthetic-local';
const REMOTE_MODE = 'product-remote';
const OFFLINE_MODE = 'synthetic-offline';
export const SYNTHETIC_OFFLINE_PROFILE_JSON = '{"mode":"synthetic-offline"}';
const MAX_BYTES = 4_096;
const MISSING_PROFILE_ERROR =
  'Packaged desktop requires synthetic-stack.json under userData';
const INVALID_PROFILE_ERROR =
  'Packaged desktop requires a valid synthetic-stack.json under userData';
const UNREADABLE_PROFILE_ERROR =
  'Packaged desktop could not read synthetic-stack.json under userData';

export type PackagedProductProfile = Readonly<{
  apiOrigin: string;
  identityOrigin: string;
}>;

/**
 * Why the packaged profile could not be used. The distinction exists so the
 * startup failure notice can tell an operator to install the stack (file
 * absent) apart from "this file is wrong" (present but rejected) apart from
 * "we could not read it" (present but unreadable — either the directory is not
 * traversable or the file itself is not readable). All three stay the same
 * fail-closed outcome; only the explanation differs.
 */
export type PackagedProfileErrorKind = 'missing' | 'invalid' | 'unreadable';

/** Fail-closed startup error. Carries only a kind — never the file path. */
export class PackagedProfileError extends Error {
  readonly kind: PackagedProfileErrorKind;

  constructor(kind: PackagedProfileErrorKind) {
    super(kind === 'missing'
      ? MISSING_PROFILE_ERROR
      : kind === 'invalid' ? INVALID_PROFILE_ERROR : UNREADABLE_PROFILE_ERROR);
    this.name = 'PackagedProfileError';
    this.kind = kind;
  }
}

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

function isPublicHostname(hostname: string): boolean {
  if (hostname.length < 4 || hostname.length > 253) return false;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
  if (hostname.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return false;
  if (!hostname.includes('.')) return false;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(hostname);
}

function httpsOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return undefined;
  if (url.pathname !== '/' && url.pathname !== '') return undefined;
  if (url.port && url.port !== '443') return undefined;
  if (!isPublicHostname(url.hostname)) return undefined;
  return url.origin;
}

function productOrigin(value: unknown): string | undefined {
  return loopbackOrigin(value) ?? httpsOrigin(value);
}

type PackagedProfileParse =
  | { readonly ok: true; readonly profile: PackagedProductProfile | undefined }
  | { readonly ok: false; readonly kind: PackagedProfileErrorKind };

function parsePackagedProductProfile(userDataDirectory: string): PackagedProfileParse {
  const file = path.join(userDataDirectory, SYNTHETIC_STACK_PROFILE_FILE);
  let stats: Stats;
  try {
    stats = lstatSync(file);
  } catch (error: unknown) {
    // Only ENOENT means "there is no file to install". Everything else — most
    // importantly EACCES/EPERM on a locked-down profile directory — means we
    // could not look, and telling the operator to install the stack would send
    // them after the wrong problem. Both stay fail-closed.
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return { ok: false, kind: code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
  // A non-regular file (symlink, directory) or an implausible size is a
  // rejected file, not a missing one, so it keeps the "invalid" explanation.
  if (!stats.isFile() || stats.size === 0 || stats.size > MAX_BYTES) return { ok: false, kind: 'invalid' };
  let contents: string;
  try {
    contents = readFileSync(file, 'utf8');
  } catch (error: unknown) {
    // The entry was there a moment ago but could not be read. Only ENOENT means
    // the file is genuinely absent (it disappeared between the two calls);
    // anything else — EACCES/EPERM/EBUSY — is an access problem the operator
    // can fix and then retry. Reporting it as a rejected file would send them
    // after a validation that never ran, and would withhold the retry that the
    // unreadable explanation offers.
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return { ok: false, kind: code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    // Non-JSON content: present and readable but rejected, same fail-closed path.
    return { ok: false, kind: 'invalid' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, kind: 'invalid' };
  const record = parsed as Record<string, unknown>;
  if (record.mode === OFFLINE_MODE) {
    const keys = Object.keys(record);
    if (keys.length !== 1 || keys[0] !== 'mode') return { ok: false, kind: 'invalid' };
    return { ok: true, profile: undefined };
  }
  if (record.mode === REMOTE_MODE) {
    const apiOrigin = httpsOrigin(record.apiOrigin);
    const identityOrigin = httpsOrigin(record.identityOrigin);
    if (apiOrigin === undefined || identityOrigin === undefined || apiOrigin === identityOrigin) {
      return { ok: false, kind: 'invalid' };
    }
    return { ok: true, profile: Object.freeze({ apiOrigin, identityOrigin }) };
  }
  if (record.mode !== MODE) return { ok: false, kind: 'invalid' };
  const apiOrigin = loopbackOrigin(record.apiOrigin);
  const identityOrigin = loopbackOrigin(record.identityOrigin);
  if (apiOrigin === undefined || identityOrigin === undefined || apiOrigin === identityOrigin) {
    return { ok: false, kind: 'invalid' };
  }
  return { ok: true, profile: Object.freeze({ apiOrigin, identityOrigin }) };
}

/** Read and validate the packaged synthetic profile. Missing or invalid files fail closed. Explicit offline mode returns undefined (S0), it is not a missing file. */
export function readPackagedProductProfile(userDataDirectory: string): PackagedProductProfile | undefined {
  const result = parsePackagedProductProfile(userDataDirectory);
  if (!result.ok) throw new PackagedProfileError(result.kind);
  return result.profile;
}

export function bundledOfflineProfilePath(resourcesPath: string): string {
  return path.join(resourcesPath, BUNDLED_OFFLINE_PROFILE_FILE);
}

export function isExactOfflineProfileContents(contents: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const record = parsed as Record<string, unknown>;
  return Object.keys(record).length === 1 && record.mode === OFFLINE_MODE;
}

export type OfflineSeedResult = 'seeded' | 'present' | 'skipped';

/**
 * Copy the bundled offline document into userData only when no profile exists.
 * Never overwrites synthetic-local or an invalid file the operator already has.
 */
export function seedPackagedOfflineProfile(options: {
  userDataDirectory: string;
  bundledOfflinePath: string | undefined;
}): OfflineSeedResult {
  const destination = path.join(options.userDataDirectory, SYNTHETIC_STACK_PROFILE_FILE);
  try {
    lstatSync(destination);
    return 'present';
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code !== 'ENOENT') return 'skipped';
  }
  if (!options.bundledOfflinePath) return 'skipped';
  let bundled: string;
  try {
    bundled = readFileSync(options.bundledOfflinePath, 'utf8');
  } catch {
    return 'skipped';
  }
  if (!isExactOfflineProfileContents(bundled)) return 'skipped';
  try {
    writeFileSync(destination, SYNTHETIC_OFFLINE_PROFILE_JSON, { flag: 'wx' });
    return 'seeded';
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return code === 'EEXIST' ? 'present' : 'skipped';
  }
}

/**
 * Choose the product origin source. Packaged builds read only the userData
 * file and ignore `environment`; unpackaged builds read loopback env vars.
 */
export function resolveProductProfile(
  packaged: boolean,
  userDataDirectory: string,
  environment: NodeJS.ProcessEnv,
  bundledOfflinePath?: string,
): PackagedProductProfile | undefined {
  if (packaged) {
    seedPackagedOfflineProfile({ userDataDirectory, bundledOfflinePath });
    return readPackagedProductProfile(userDataDirectory);
  }
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
  const api = productOrigin(apiOrigin);
  const identity = productOrigin(identityOrigin);
  if (api === undefined || identity === undefined || api === identity) {
    throw new Error('Synthetic desktop requires both exact loopback or https origins in development');
  }
  return Object.freeze({ apiOrigin: api, identityOrigin: identity });
}
