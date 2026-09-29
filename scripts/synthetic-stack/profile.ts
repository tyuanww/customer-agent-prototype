/**
 * Single configuration source for the local synthetic stack.
 *
 * Everything the stack starts (isolated PostgreSQL 15 cluster, synthetic
 * identity provider, API, worker, desktop client) derives its ports, origins,
 * database names and paths from this module. Nothing else may invent a second
 * set of values, and nothing here may point at the user's existing PostgreSQL
 * instance or a non-loopback address.
 *
 * The resolved profile is written atomically to `profile.json` under the stack
 * root so the desktop client (development and packaged) can read the same
 * origins without duplicating them.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_STACK_ROOT = path.join(os.homedir(), '.customer-agent-synthetic-stack');

export const STACK_ROOT = process.env.CUSTOMER_AGENT_STACK_ROOT
  ? path.resolve(process.env.CUSTOMER_AGENT_STACK_ROOT)
  : DEFAULT_STACK_ROOT;

/**
 * TCP loopback ports are shared machine-wide, so two stacks need two sets. The
 * offset is derived from the stack root rather than passed in, because a root
 * has to resolve to the same ports before `profile.json` exists and after it is
 * deleted; the default root keeps the ports it has always used.
 *
 * The PostgreSQL cluster needs no offset: it listens on a Unix socket inside the
 * stack root, so two clusters cannot collide even on the same port number.
 */
export function stackPortOffset(stackRoot: string): number {
  if (stackRoot === DEFAULT_STACK_ROOT) return 0;
  let hash = 0;
  for (const byte of Buffer.from(stackRoot, 'utf8')) hash = (hash * 31 + byte) % 1000;
  // The same offset is added to every preferred port, and those ports are one
  // apart, so an offset that is not a multiple of the span interleaves two
  // stacks: offsets 75 and 76 put the first stack's `identity` port and the
  // second stack's `api` port on the same number (43176). Stepping by the span
  // is what makes "a second stack gets its own ports" actually true. The bucket
  // count keeps the highest shifted port (43197) below PG_PORT, so a shifted
  // stack never claims a number the cluster is documented to own.
  const span = Math.max(...Object.values(PREFERRED_PORTS)) - Math.min(...Object.values(PREFERRED_PORTS)) + 1;
  return span * (1 + (hash % 48));
}

export const PROFILE_FILE = path.join(STACK_ROOT, 'profile.json');
export const FEISHU_ENV_FILE = path.join(STACK_ROOT, 'feishu.env');
export const CONTENT_ENV_FILE = path.join(STACK_ROOT, 'content.env');
export const API_ENV_FILE = path.join(STACK_ROOT, 'api.env');

export type FeishuBindingRole = 'agent' | 'coach' | 'owner';
export type FeishuStackBinding = Readonly<{ openId: string; role: FeishuBindingRole }>;
export type FeishuStackConfig = Readonly<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  bindings: readonly FeishuStackBinding[];
}>;

const FEISHU_APP_ID_PATTERN = /^cli_[a-z0-9]{8,32}$/;
const FEISHU_OPEN_ID_PATTERN = /^ou_[A-Za-z0-9]{6,64}$/;
const FEISHU_ROLES = new Set<FeishuBindingRole>(['agent', 'coach', 'owner']);

/**
 * Parse a `key=value` env file. Every loader of a stack-root env file goes
 * through here — `feishu.env`, `content.env`, and `formal-dev-up.mjs` — so a
 * malformed line or a duplicate key fails the same way in each, naming the file
 * it came from. Duplicates are an error rather than last-one-wins: a stack that
 * silently picked one of two review leads would be very hard to explain later.
 */
export function parseEnvFile(contents: string, label: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of contents.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) throw new Error(`${label}: invalid line`);
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (values.has(key)) throw new Error(`${label}: duplicate ${key}`);
    values.set(key, value);
  }
  return values;
}

export function parseFeishuEnvFile(contents: string): FeishuStackConfig {
  const values = parseEnvFile(contents, 'feishu.env');
  if (values.get('AUTH_MODE') !== 'feishu') throw new Error('feishu.env: AUTH_MODE must be feishu');
  const clientId = values.get('FEISHU_APP_ID') ?? '';
  const clientSecret = values.get('FEISHU_APP_SECRET') ?? '';
  const redirectUri = values.get('FEISHU_REDIRECT_URI') ?? '';
  if (!FEISHU_APP_ID_PATTERN.test(clientId)) throw new Error('feishu.env: FEISHU_APP_ID invalid');
  if (clientSecret.length < 16 || clientSecret.length > 128) throw new Error('feishu.env: FEISHU_APP_SECRET invalid');
  try {
    const url = new URL(redirectUri);
    if (url.protocol !== 'https:' || url.pathname !== '/v1/auth/callback' || url.search || url.hash
      || url.username || url.password) throw new Error('bad');
  } catch {
    throw new Error('feishu.env: FEISHU_REDIRECT_URI must be https://…/v1/auth/callback');
  }
  const bindings: FeishuStackBinding[] = [];
  const rawBindings = values.get('FEISHU_BINDINGS') ?? '';
  if (rawBindings.length > 0) {
    for (const part of rawBindings.split(',')) {
      const [openId, role] = part.split(':');
      if (!openId || !role || !FEISHU_OPEN_ID_PATTERN.test(openId)
        || !FEISHU_ROLES.has(role as FeishuBindingRole)) {
        throw new Error('feishu.env: FEISHU_BINDINGS must be ou_…:agent|coach|owner');
      }
      bindings.push(Object.freeze({ openId, role: role as FeishuBindingRole }));
    }
  }
  return Object.freeze({ clientId, clientSecret, redirectUri, bindings: Object.freeze(bindings) });
}

export function loadFeishuStackConfig(file = FEISHU_ENV_FILE): FeishuStackConfig | undefined {
  if (!existsSync(file)) return undefined;
  return parseFeishuEnvFile(readFileSync(file, 'utf8'));
}

/**
 * The content-side values a real deployment has to supply. The synthetic stack
 * hard-codes them; a stack that answers real office machines must not, because
 * a review record filed under `synthetic_coach` looks plausible and fails
 * silently. Absent file means "use the synthetic defaults"; a present but
 * malformed file is an error, never a quiet fallback.
 */
export type ContentStackConfig = Readonly<{
  databaseName?: string;
  intentTaxonomyVersion?: string;
  intentId?: string;
  reviewLeadSubject?: string;
  reviewManagerSubject?: string;
  reviewEvidenceId?: string;
}>;

/**
 * A database name the stack is willing to interpolate into `CREATE DATABASE`
 * and into five DSNs. `CREATE DATABASE` takes no bind parameter, so this pattern
 * is the only thing between the name and the statement. It therefore has to hold
 * wherever the name comes from - including `profile.json`, which is the source
 * every `start` after the first one reads.
 */
const SQL_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/u;

const CONTENT_ENV_KEYS: Readonly<Record<string, keyof ContentStackConfig>> = Object.freeze({
  DATABASE_NAME: 'databaseName',
  CONTENT_INTENT_TAXONOMY_VERSION: 'intentTaxonomyVersion',
  CONTENT_INTENT_ID: 'intentId',
  CONTENT_REVIEW_LEAD_SUBJECT: 'reviewLeadSubject',
  CONTENT_REVIEW_MANAGER_SUBJECT: 'reviewManagerSubject',
  CONTENT_REVIEW_EVIDENCE_ID: 'reviewEvidenceId',
});

export function parseContentEnvFile(contents: string): ContentStackConfig {
  const values = parseEnvFile(contents, 'content.env');
  const unknown = [...values.keys()].filter((key) => !(key in CONTENT_ENV_KEYS)).sort();
  // A misspelled key would otherwise be ignored and the stack would quietly keep
  // the synthetic value the caller was trying to replace.
  if (unknown.length > 0) throw new Error(`content.env: unknown key ${unknown.join(', ')}`);

  type MutableContentStackConfig = { -readonly [K in keyof ContentStackConfig]: ContentStackConfig[K] };
  const config: MutableContentStackConfig = {};
  for (const [key, field] of Object.entries(CONTENT_ENV_KEYS)) {
    const value = values.get(key);
    if (value === undefined) continue;
    if (value.length === 0) throw new Error(`content.env: ${key} must not be empty`);
    config[field] = value;
  }
  if (config.databaseName !== undefined && !SQL_IDENTIFIER_PATTERN.test(config.databaseName)) {
    throw new Error('content.env: DATABASE_NAME must be a lower-case SQL identifier');
  }
  return Object.freeze(config);
}

export function loadContentStackConfig(file = CONTENT_ENV_FILE): ContentStackConfig | undefined {
  if (!existsSync(file)) return undefined;
  return parseContentEnvFile(readFileSync(file, 'utf8'));
}

/**
 * Portable production values: secrets and identity, never locations.
 *
 * `stack.ts` is the production entry point (`formal-dev-up.mjs`, which used to
 * read `api.env` verbatim, is not), and without this file it can only ever run
 * with the synthetic secrets and `AUTH_MODE=mock`. So a real deployment has to
 * hand it the few values the profile cannot invent.
 *
 * Everything the profile *can* derive is refused instead of accepted, because a
 * file copied from another machine carries that machine's paths and the failures
 * are uneven: a wrong socket directory fails loudly at connect, but a stale
 * object store directory, or a DSN whose socket directory happens to exist on
 * both hosts, keeps working and writes where nobody looks. Refusing the derived
 * keys turns that whole class into a start-time error that names the key.
 */
export type ApiStackConfig = Readonly<Record<string, string>>;

const API_ENV_DERIVED_KEYS: readonly string[] = Object.freeze([
  // Resolved from the stack root by `resolveProfile` / `apiEnvironment`.
  'PATH',
  'CUSTOMER_AGENT_API_HOST',
  'CUSTOMER_AGENT_API_PORT',
  'DATABASE_URL',
  'CONTENT_ADMIN_DATABASE_URL',
  'AUTH_DATABASE_URL',
  'CONTENT_REVIEW_DATABASE_URL',
  'CONTENT_WORKER_DATABASE_URL',
  'SYNTHETIC_IDENTITY_PROVIDER_ORIGIN',
  'CONTENT_OBJECT_STORE_DIR',
  // Feishu already has a validated channel in feishu.env, and AUTH_MODE is
  // derived from whether that file is present. A second source could disagree.
  'AUTH_MODE',
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_REDIRECT_URI',
  'FEISHU_BINDINGS',
  // macOS-specific trust store; another host must use its own.
  'NODE_EXTRA_CA_CERTS',
]);

const PROFILE_NAME_PATTERN = /^[a-z][a-z0-9-]{1,31}$/u;

export function parseApiEnvFile(contents: string): ApiStackConfig {
  const values = parseEnvFile(contents, 'api.env');
  const derived = [...values.keys()].filter((key) => API_ENV_DERIVED_KEYS.includes(key)).sort();
  if (derived.length > 0) {
    throw new Error(
      `api.env: ${derived.join(', ')} is derived from the stack root; remove it so this stack resolves its own`,
    );
  }
  for (const [key, value] of values) {
    if (value.length === 0) throw new Error(`api.env: ${key} must not be empty`);
  }
  const profileName = values.get('CUSTOMER_AGENT_PROFILE');
  if (profileName !== undefined && !PROFILE_NAME_PATTERN.test(profileName)) {
    throw new Error('api.env: CUSTOMER_AGENT_PROFILE must be a lower-case profile name');
  }
  return Object.freeze(Object.fromEntries(values));
}

export function loadApiStackConfig(file = API_ENV_FILE): ApiStackConfig | undefined {
  if (!existsSync(file)) return undefined;
  return parseApiEnvFile(readFileSync(file, 'utf8'));
}

/**
 * Both files are merged into one override map, so a key set in both would be
 * decided by merge order alone and the losing value would look applied. Make the
 * overlap an error instead, the same way a duplicate line inside one file is.
 */
export function mergeStackOverrides(
  content: Readonly<Record<string, string>>,
  api: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const both = Object.keys(api).filter((key) => key in content).sort();
  if (both.length > 0) throw new Error(`api.env and content.env both set ${both.join(', ')}`);
  return { ...content, ...api };
}

/**
 * Whether `start` may import the demo catalog.
 *
 * `--no-seed` describes what this stack *is* - one that serves a real catalog -
 * not what a single invocation should do, so the stack root gets a vote too:
 * naming your own database in `content.env` is what declaring a real deployment
 * looks like, and the import publishes the synthetic scripts as the live
 * catalog when it runs against a database that has nothing published yet.
 *
 * The flag alone was not enough. The systemd unit passes it, but a person
 * repairing the stack types `restart` - the natural verb - and would re-enter
 * the seed path with no sign that anything was different.
 */
export function shouldSeedSyntheticCatalog(
  argv: readonly string[],
  declaredDatabaseName: string | undefined,
): boolean {
  return !argv.includes('--no-seed') && declaredDatabaseName === undefined;
}

export const PID_DIRECTORY = path.join(STACK_ROOT, 'pids');
export const LOG_DIRECTORY = path.join(STACK_ROOT, 'logs');
export const DATA_DIRECTORY = path.join(STACK_ROOT, 'data');
export const OBJECT_STORE_DIRECTORY = path.join(STACK_ROOT, 'objects');
export const PG_DATA_DIRECTORY = path.join(DATA_DIRECTORY, 'pg15');
export const PG_SOCKET_DIRECTORY = path.join(DATA_DIRECTORY, 'pg15-socket');

export const DATABASE_NAME = 'customer_agent_synthetic';

/** Login roles, one per capability pool. Names must stay distinct per contract. */
export const DATABASE_ROLES = Object.freeze({
  runtime: 'stack_runtime',
  admin: 'stack_content_admin',
  auth: 'stack_backend_auth',
  review: 'stack_backend_review',
  worker: 'stack_backend_worker',
});

/**
 * Loopback ports. These are preferences, not reservations: `start` checks each
 * one and fails closed with a locatable reason instead of silently binding
 * something else, because the desktop client reads the resolved origin from
 * `profile.json` and a silent move would desynchronise the two sides.
 */
export const PREFERRED_PORTS = Object.freeze({
  api: 43100,
  identity: 43101,
});

export const PG_PORT = 43199;

/** Synthetic session identities seeded into `backend_identity.subject_bindings`. */
export const SYNTHETIC_IDENTITIES = Object.freeze([
  Object.freeze({ bindingId: 'synthetic_agent', userId: 'usr_synthetic_agent', role: 'agent', label: '客服坐席（合成）' }),
  Object.freeze({ bindingId: 'synthetic_coach', userId: 'usr_synthetic_coach', role: 'coach', label: '话术师 / 一审（合成）' }),
  Object.freeze({ bindingId: 'synthetic_quality', userId: 'usr_synthetic_quality', role: 'coach', label: '质检复核（合成）' }),
  Object.freeze({ bindingId: 'synthetic_owner', userId: 'usr_synthetic_owner', role: 'owner', label: '运营负责人 / 二审（合成）' }),
]);

/** Non-secret local HMAC material. These never leave this machine. */
export const LOCAL_SECRETS = Object.freeze({
  idempotencyKey: 'synthetic-stack-idempotency-material-000000000001',
  logHashKey: 'synthetic-stack-log-hash-material-00000000000002',
});

export type StackProfile = Readonly<{
  version: 1;
  createdAt: string;
  stackRoot: string;
  apiOrigin: string;
  identityOrigin: string;
  apiPort: number;
  identityPort: number;
  databaseName: string;
  pgPort: number;
  pgSocketDirectory: string;
  objectStoreDirectory: string;
  clientId: string;
}>;

/**
 * Where the packaged desktop client looks for its synthetic profile. Must match
 * Electron `app.getPath('userData')` after `app.setName`:
 * macOS `~/Library/Application Support/<name>`, Windows `%APPDATA%/<name>`,
 * Linux `$XDG_CONFIG_HOME/<name>` or `~/.config/<name>`. Resolved when called
 * so test env and `XDG_CONFIG_HOME` are not frozen at import. The stack writes
 * the file; the client re-validates every field before using it and fail-closes
 * if the file is missing or not a valid profile.
 *
 * `CUSTOMER_AGENT_DESKTOP_USERDATA` overrides the location for tests and for a
 * client launched with `--user-data-dir`.
 */
export const DESKTOP_APP_NAME = '客服话术浮窗 Demo';

export type DesktopUserDataLocator = Readonly<{
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}>;

export function defaultDesktopUserDataDirectory(options: DesktopUserDataLocator = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const override = (env.CUSTOMER_AGENT_DESKTOP_USERDATA ?? '').trim();
  if (override.length > 0) {
    return path.resolve(override);
  }
  if (platform === 'win32') {
    const roaming = (env.APPDATA ?? '').trim() || path.join(home, 'AppData', 'Roaming');
    return path.join(roaming, DESKTOP_APP_NAME);
  }
  if (platform === 'linux') {
    const xdg = (env.XDG_CONFIG_HOME ?? '').trim();
    const configHome = xdg.length > 0 ? path.resolve(xdg) : path.join(home, '.config');
    return path.join(configHome, DESKTOP_APP_NAME);
  }
  return path.join(home, 'Library', 'Application Support', DESKTOP_APP_NAME);
}

export function desktopPackagedProfilePath(options: DesktopUserDataLocator = {}): string {
  return path.join(defaultDesktopUserDataDirectory(options), 'synthetic-stack.json');
}

/**
 * Publish the resolved origins for the packaged client. Only the two loopback
 * origins and an exact mode marker are written — no token, DSN or secret.
 */
export function writeDesktopPackagedProfile(profile: StackProfile): string {
  const packagedPath = desktopPackagedProfilePath();
  mkdirSync(path.dirname(packagedPath), { recursive: true });
  const temporary = `${packagedPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({
    mode: 'synthetic-local',
    apiOrigin: profile.apiOrigin,
    identityOrigin: profile.identityOrigin,
  }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, packagedPath);
  return packagedPath;
}

export function ensureStackDirectories(): void {
  for (const directory of [
    STACK_ROOT, PID_DIRECTORY, LOG_DIRECTORY, DATA_DIRECTORY,
    OBJECT_STORE_DIRECTORY, PG_SOCKET_DIRECTORY,
  ]) mkdirSync(directory, { recursive: true, mode: 0o700 });
}

export function readProfile(file = PROFILE_FILE): StackProfile | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object') return undefined;
    const profile = value as StackProfile;
    // The recorded root must match where the file was actually read from: a
    // profile left by a different stack root (for example an isolated test run)
    // would otherwise make the stack adopt unrelated paths and pids.
    if (profile.version !== 1 || typeof profile.apiOrigin !== 'string'
      || typeof profile.identityOrigin !== 'string'
      || profile.stackRoot !== STACK_ROOT) return undefined;
    // The database name is validated here for the same reason it is validated
    // when it comes from content.env, and this is the path that matters: only
    // the first `start` builds a profile, and every one after it reuses this
    // file. It reaches `CREATE DATABASE` by interpolation and the five DSNs by
    // concatenation, so a name that is missing or malformed has to fail here
    // rather than create a database called `undefined` and report ready.
    if (typeof profile.databaseName !== 'string' || !SQL_IDENTIFIER_PATTERN.test(profile.databaseName)) {
      return undefined;
    }
    return profile;
  } catch {
    return undefined;
  }
}

export function writeProfile(profile: StackProfile): void {
  ensureStackDirectories();
  const temporary = `${PROFILE_FILE}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, PROFILE_FILE);
}

/** Environment for the API and worker processes. Secrets stay process-local. */
export function apiEnvironment(
  profile: StackProfile,
  overrides: Readonly<Record<string, string>> = {},
  feishu: FeishuStackConfig | undefined = undefined,
): NodeJS.ProcessEnv {
  const socket = new URLSearchParams({ host: profile.pgSocketDirectory, port: String(profile.pgPort) });
  const connection = (role: string) => `postgresql://${role}@localhost/${profile.databaseName}?${socket.toString()}`;
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    CUSTOMER_AGENT_PROFILE: 'formal-dev',
    AUTH_MODE: feishu ? 'feishu' : 'mock',
    AUTH_SESSION_MODE: 'product',
    CUSTOMER_AGENT_API_HOST: '127.0.0.1',
    CUSTOMER_AGENT_API_PORT: String(profile.apiPort),
    CUSTOMER_AGENT_BUILD_VERSION: 'synthetic-macos-stack',
    DATABASE_URL: connection(DATABASE_ROLES.runtime),
    CONTENT_ADMIN_DATABASE_URL: connection(DATABASE_ROLES.admin),
    AUTH_DATABASE_URL: connection(DATABASE_ROLES.auth),
    CONTENT_REVIEW_DATABASE_URL: connection(DATABASE_ROLES.review),
    CONTENT_WORKER_DATABASE_URL: connection(DATABASE_ROLES.worker),
    SYNTHETIC_IDENTITY_PROVIDER_ORIGIN: profile.identityOrigin,
    CONTENT_OBJECT_STORE_DIR: profile.objectStoreDirectory,
    IDEMPOTENCY_HMAC_KEYS: JSON.stringify({ 'hmac-idempotency-v1': LOCAL_SECRETS.idempotencyKey }),
    IDEMPOTENCY_HMAC_CURRENT_VERSION: 'hmac-idempotency-v1',
    LOG_HASH_KEY: LOCAL_SECRETS.logHashKey,
    LOG_HASH_KEY_VERSION: 'hmac-log-v1',
    DB_CONNECTION_TIMEOUT_MS: '2000',
    DB_READINESS_TIMEOUT_MS: '3000',
    // Homebrew Node 24 does not trust Feishu's DigiCert chain unless we point at the macOS CA bundle.
    ...(existsSync('/etc/ssl/cert.pem') ? { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS ?? '/etc/ssl/cert.pem' } : {}),
  };
  if (feishu) {
    environment.FEISHU_APP_ID = feishu.clientId;
    environment.FEISHU_APP_SECRET = feishu.clientSecret;
    environment.FEISHU_REDIRECT_URI = feishu.redirectUri;
  }
  return { ...environment, ...overrides };
}

export function pgEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, PGCONNECT_TIMEOUT: '5' };
  for (const key of [
    'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD',
    'PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS',
  ]) delete environment[key];
  return environment;
}
