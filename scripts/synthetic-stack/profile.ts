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

export const STACK_ROOT = process.env.CUSTOMER_AGENT_STACK_ROOT
  ? path.resolve(process.env.CUSTOMER_AGENT_STACK_ROOT)
  : path.join(os.homedir(), '.customer-agent-synthetic-stack');

export const PROFILE_FILE = path.join(STACK_ROOT, 'profile.json');
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
 * Where the packaged desktop client looks for its synthetic profile. Electron's
 * `app.getPath('userData')` on macOS is `~/Library/Application Support/<name>`,
 * and the name is fixed by `app.setName` in the main process. The stack writes
 * the file; the client re-validates every field before using it and fail-closes
 * if the file is missing or not an exact pair of loopback origins.
 *
 * `CUSTOMER_AGENT_DESKTOP_USERDATA` overrides the location for tests and for a
 * client launched with `--user-data-dir`.
 */
export const DESKTOP_PACKAGED_PROFILE_PATH = path.join(
  process.env.CUSTOMER_AGENT_DESKTOP_USERDATA
    ? path.resolve(process.env.CUSTOMER_AGENT_DESKTOP_USERDATA)
    : path.join(os.homedir(), 'Library', 'Application Support', '客服话术浮窗 Demo'),
  'synthetic-stack.json',
);

/**
 * Publish the resolved origins for the packaged client. Only the two loopback
 * origins and an exact mode marker are written — no token, DSN or secret.
 */
export function writeDesktopPackagedProfile(profile: StackProfile): string {
  mkdirSync(path.dirname(DESKTOP_PACKAGED_PROFILE_PATH), { recursive: true });
  const temporary = `${DESKTOP_PACKAGED_PROFILE_PATH}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({
    mode: 'synthetic-local',
    apiOrigin: profile.apiOrigin,
    identityOrigin: profile.identityOrigin,
  }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, DESKTOP_PACKAGED_PROFILE_PATH);
  return DESKTOP_PACKAGED_PROFILE_PATH;
}

export function ensureStackDirectories(): void {
  for (const directory of [
    STACK_ROOT, PID_DIRECTORY, LOG_DIRECTORY, DATA_DIRECTORY,
    OBJECT_STORE_DIRECTORY, PG_SOCKET_DIRECTORY,
  ]) mkdirSync(directory, { recursive: true, mode: 0o700 });
}

export function readProfile(): StackProfile | undefined {
  if (!existsSync(PROFILE_FILE)) return undefined;
  try {
    const value: unknown = JSON.parse(readFileSync(PROFILE_FILE, 'utf8'));
    if (!value || typeof value !== 'object') return undefined;
    const profile = value as StackProfile;
    // The recorded root must match where the file was actually read from: a
    // profile left by a different stack root (for example an isolated test run)
    // would otherwise make the stack adopt unrelated paths and pids.
    if (profile.version !== 1 || typeof profile.apiOrigin !== 'string'
      || typeof profile.identityOrigin !== 'string'
      || profile.stackRoot !== STACK_ROOT) return undefined;
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
export function apiEnvironment(profile: StackProfile, overrides: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  const socket = new URLSearchParams({ host: profile.pgSocketDirectory, port: String(profile.pgPort) });
  const connection = (role: string) => `postgresql://${role}@localhost/${profile.databaseName}?${socket.toString()}`;
  return {
    PATH: process.env.PATH,
    CUSTOMER_AGENT_PROFILE: 'formal-dev',
    AUTH_MODE: 'mock',
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
    ...overrides,
  };
}

export function pgEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, PGCONNECT_TIMEOUT: '5' };
  for (const key of [
    'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD',
    'PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS',
  ]) delete environment[key];
  return environment;
}
