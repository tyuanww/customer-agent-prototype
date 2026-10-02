/**
 * One PostgreSQL bootstrap target.
 *
 * Hides loopback DSN acceptance, Unix-socket host/port query exceptions, login
 * and target identity, and the per-pool size and timeout bounds. Comparing two
 * pools' logins, targets, or combined budgets is a cross-field rule and stays
 * in runtime-config.ts.
 *
 * Stays in apps/api. The DSN lock is this service's local-database rule, not a
 * generic Postgres configuration package.
 */
import {
  exactEnvironmentValue,
  issue,
  type ApiConfigIssue,
  type ApiRuntimeEnvironment,
} from './issues.js';

export type ApiDatabaseBootstrapConfig = Readonly<{
  connectionString: string;
  poolMax: number;
  connectionTimeoutMs: number;
  readinessTimeoutMs: number;
}>;

export const DEFAULT_DB_POOL_MAX = 18;
export const DEFAULT_POLICY_ADMIN_DB_POOL_MAX = 2;
export const MAX_TOTAL_DB_POOL_CONNECTIONS = 20;

const POSTGRES_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);
const DEFAULT_DB_CONNECTION_TIMEOUT_MS = 2_000;
const DEFAULT_DB_READINESS_TIMEOUT_MS = 2_000;

type DatabaseConfigFields = Readonly<{
  connectionString: string;
  poolMax: string;
  defaultPoolMax: number;
}>;

function parseBoundedPositiveInteger(
  environment: ApiRuntimeEnvironment,
  field: string,
  fallback: number,
  maximum: number,
  issues: ApiConfigIssue[],
): number {
  const value = exactEnvironmentValue(environment, field, issues);
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) {
    issues.push(issue(field, 'invalid'));
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    issues.push(issue(field, 'invalid'));
    return fallback;
  }
  return parsed;
}

function isPostgresConnectionString(value: string): boolean {
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:')
      || parsed.pathname.length <= 1
      || parsed.hash.length > 0
      || !POSTGRES_LOOPBACK_HOSTS.has(parsed.hostname)) {
      return false;
    }

    // node-postgres lets URI query parameters override explicit Pool options.
    // W5 therefore accepts no driver controls in DATABASE_URL. The sole query
    // exception is the Unix-socket host/port pair used by the isolated PG15
    // integration harness; deployment/TLS DSNs remain a later profile concern.
    const keys = [...parsed.searchParams.keys()];
    if (keys.some((key) => key !== 'host' && key !== 'port')) return false;
    const hosts = parsed.searchParams.getAll('host');
    const ports = parsed.searchParams.getAll('port');
    if (hosts.length === 0 && ports.length === 0) return true;
    if (hosts.length !== 1 || ports.length > 1) return false;
    const socketHost = hosts[0];
    if (!socketHost?.startsWith('/') || socketHost.includes('\0')) return false;
    if (ports.length === 0) return true;
    return /^[1-9][0-9]*$/.test(ports[0] ?? '')
      && Number(ports[0]) <= 65_535;
  } catch {
    return false;
  }
}

export function postgresLoginName(value: string): string | undefined {
  try {
    const username = new URL(value).username;
    return username.length > 0 ? decodeURIComponent(username) : undefined;
  } catch {
    return undefined;
  }
}

export function postgresDatabaseTarget(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    const socketHost = parsed.searchParams.get('host');
    const socketPort = parsed.searchParams.get('port');
    return JSON.stringify({
      host: socketHost ?? parsed.hostname,
      port: socketPort ?? (parsed.port || '5432'),
      database: parsed.pathname,
    });
  } catch {
    return undefined;
  }
}

export function parseDatabaseConfig(
  environment: ApiRuntimeEnvironment,
  fields: DatabaseConfigFields,
  issues: ApiConfigIssue[],
): ApiDatabaseBootstrapConfig | undefined {
  const connectionString = exactEnvironmentValue(environment, fields.connectionString, issues);
  if (connectionString === undefined && environment[fields.connectionString] === undefined) {
    issues.push(issue(fields.connectionString, 'missing'));
  } else if (connectionString !== undefined
    && (!isPostgresConnectionString(connectionString) || postgresLoginName(connectionString) === undefined)) {
    issues.push(issue(fields.connectionString, 'invalid'));
  }

  const poolMax = parseBoundedPositiveInteger(
    environment,
    fields.poolMax,
    fields.defaultPoolMax,
    MAX_TOTAL_DB_POOL_CONNECTIONS,
    issues,
  );
  const connectionTimeoutMs = parseBoundedPositiveInteger(
    environment,
    'DB_CONNECTION_TIMEOUT_MS',
    DEFAULT_DB_CONNECTION_TIMEOUT_MS,
    10_000,
    issues,
  );
  const readinessTimeoutMs = parseBoundedPositiveInteger(
    environment,
    'DB_READINESS_TIMEOUT_MS',
    DEFAULT_DB_READINESS_TIMEOUT_MS,
    10_000,
    issues,
  );

  return connectionString === undefined ? undefined : Object.freeze({
    connectionString,
    poolMax,
    connectionTimeoutMs,
    readinessTimeoutMs,
  });
}
