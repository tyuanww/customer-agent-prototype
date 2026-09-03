import { randomUUID } from 'node:crypto';
import { CONTRACT_PROVENANCE } from '@customer-agent/contracts/provenance';

export const CUSTOMER_AGENT_PROFILES = Object.freeze([
  'demo',
  'formal-dev',
  'test',
  'single-host',
  'multi-instance',
  'production',
] as const);

export type CustomerAgentProfile = (typeof CUSTOMER_AGENT_PROFILES)[number];
export type ApiProfile = Extract<CustomerAgentProfile, 'formal-dev' | 'test'>;
export type AuthMode = 'mock' | 'feishu';
export type ApiShutdownSignal = 'SIGINT' | 'SIGTERM';
export type ApiRuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export type ApiRuntimeConfig = Readonly<{
  profile: ApiProfile;
  authMode: 'mock';
  host: '127.0.0.1';
  port: number;
  buildVersion: string;
  contractSetId: string;
  runtimeActivated: false;
}>;

/** Private bootstrap input. Never expose this object through StartedApi, logs, or HTTP. */
export type ApiDatabaseBootstrapConfig = Readonly<{
  connectionString: string;
  poolMax: number;
  connectionTimeoutMs: number;
  readinessTimeoutMs: number;
}>;

export type ApiConfigIssue = Readonly<{
  field: string;
  reason:
    | 'missing'
    | 'invalid'
    | 'profile_not_service'
    | 'profile_not_available'
    | 'auth_mode_not_available'
    | 'external_bind_not_allowed';
}>;

const PROFILE_SET = new Set<string>(CUSTOMER_AGENT_PROFILES);
const AUTH_MODE_SET = new Set<string>(['mock', 'feishu']);
const BUILD_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const DIAGNOSTIC_ID_PATTERN = /^diag_[0-9a-f]{32}$/;
const LOOPBACK_HOST = '127.0.0.1' as const;
const POSTGRES_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);
const DEFAULT_API_PORT = 3100;
const DEFAULT_DB_POOL_MAX = 20;
const DEFAULT_DB_CONNECTION_TIMEOUT_MS = 2_000;
const DEFAULT_DB_READINESS_TIMEOUT_MS = 2_000;
const STARTUP_ERROR_REASONS = Object.freeze({
  EACCES: 'listen_permission_denied',
  EADDRINUSE: 'listen_address_in_use',
  EADDRNOTAVAIL: 'listen_address_unavailable',
  EMFILE: 'process_file_limit_reached',
  ENFILE: 'system_file_limit_reached',
} as const);

function issue(field: string, reason: ApiConfigIssue['reason']): ApiConfigIssue {
  return Object.freeze({ field, reason });
}

function exactEnvironmentValue(
  environment: ApiRuntimeEnvironment,
  field: string,
  issues: ApiConfigIssue[],
): string | undefined {
  const value = environment[field];
  if (value === undefined) {
    return undefined;
  }
  if (value.length === 0 || value.trim() !== value) {
    issues.push(issue(field, 'invalid'));
    return undefined;
  }
  return value;
}

function parseProfile(
  environment: ApiRuntimeEnvironment,
  issues: ApiConfigIssue[],
): CustomerAgentProfile | undefined {
  const value = exactEnvironmentValue(environment, 'CUSTOMER_AGENT_PROFILE', issues);
  if (value === undefined) {
    if (environment.CUSTOMER_AGENT_PROFILE === undefined) {
      issues.push(issue('CUSTOMER_AGENT_PROFILE', 'missing'));
    }
    return undefined;
  }
  if (!PROFILE_SET.has(value)) {
    issues.push(issue('CUSTOMER_AGENT_PROFILE', 'invalid'));
    return undefined;
  }
  return value as CustomerAgentProfile;
}

function parseAuthMode(
  environment: ApiRuntimeEnvironment,
  issues: ApiConfigIssue[],
): AuthMode | undefined {
  const value = exactEnvironmentValue(environment, 'AUTH_MODE', issues);
  if (value === undefined) {
    if (environment.AUTH_MODE === undefined) {
      issues.push(issue('AUTH_MODE', 'missing'));
    }
    return undefined;
  }
  if (!AUTH_MODE_SET.has(value)) {
    issues.push(issue('AUTH_MODE', 'invalid'));
    return undefined;
  }
  return value as AuthMode;
}

function parsePort(
  environment: ApiRuntimeEnvironment,
  profile: CustomerAgentProfile | undefined,
  issues: ApiConfigIssue[],
): number {
  const value = exactEnvironmentValue(environment, 'CUSTOMER_AGENT_API_PORT', issues);
  if (value === undefined) {
    return profile === 'test' ? 0 : DEFAULT_API_PORT;
  }
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    issues.push(issue('CUSTOMER_AGENT_API_PORT', 'invalid'));
    return DEFAULT_API_PORT;
  }
  const port = Number(value);
  const valid = Number.isSafeInteger(port)
    && port <= 65_535
    && (port >= 1_024 || (profile === 'test' && port === 0));
  if (!valid) {
    issues.push(issue('CUSTOMER_AGENT_API_PORT', 'invalid'));
    return DEFAULT_API_PORT;
  }
  return port;
}

function parseBuildVersion(
  environment: ApiRuntimeEnvironment,
  issues: ApiConfigIssue[],
): string {
  const value = exactEnvironmentValue(environment, 'CUSTOMER_AGENT_BUILD_VERSION', issues);
  if (value === undefined) {
    return 'dev-m0';
  }
  if (!BUILD_VERSION_PATTERN.test(value)) {
    issues.push(issue('CUSTOMER_AGENT_BUILD_VERSION', 'invalid'));
    return 'dev-m0';
  }
  return value;
}

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

export class ApiConfigError extends Error {
  readonly code = 'CONFIG_INVALID';
  readonly issues: readonly ApiConfigIssue[];

  constructor(issues: readonly ApiConfigIssue[]) {
    super('API runtime configuration is invalid');
    this.name = 'ApiConfigError';
    this.issues = Object.freeze([...issues]);
  }
}

export function parseApiRuntimeConfig(
  environment: ApiRuntimeEnvironment,
): ApiRuntimeConfig {
  const issues: ApiConfigIssue[] = [];
  const profile = parseProfile(environment, issues);
  const authMode = parseAuthMode(environment, issues);
  const requestedHost = exactEnvironmentValue(
    environment,
    'CUSTOMER_AGENT_API_HOST',
    issues,
  ) ?? LOOPBACK_HOST;
  const port = parsePort(environment, profile, issues);
  const buildVersion = parseBuildVersion(environment, issues);

  if (profile === 'demo') {
    issues.push(issue('CUSTOMER_AGENT_PROFILE', 'profile_not_service'));
  } else if (profile && profile !== 'formal-dev' && profile !== 'test') {
    issues.push(issue('CUSTOMER_AGENT_PROFILE', 'profile_not_available'));
  }

  if (authMode && authMode !== 'mock') {
    issues.push(issue('AUTH_MODE', 'auth_mode_not_available'));
  }
  if (requestedHost !== LOOPBACK_HOST) {
    issues.push(issue('CUSTOMER_AGENT_API_HOST', 'external_bind_not_allowed'));
  }

  if (issues.length > 0 || (profile !== 'formal-dev' && profile !== 'test') || authMode !== 'mock') {
    throw new ApiConfigError(issues);
  }

  return Object.freeze({
    profile,
    authMode,
    host: LOOPBACK_HOST,
    port,
    buildVersion,
    contractSetId: CONTRACT_PROVENANCE.contract_set_id,
    runtimeActivated: CONTRACT_PROVENANCE.runtime_activated,
  });
}

export function parseApiDatabaseBootstrapConfig(
  environment: ApiRuntimeEnvironment,
): ApiDatabaseBootstrapConfig {
  const issues: ApiConfigIssue[] = [];
  const connectionString = exactEnvironmentValue(environment, 'DATABASE_URL', issues);
  if (connectionString === undefined && environment.DATABASE_URL === undefined) {
    issues.push(issue('DATABASE_URL', 'missing'));
  } else if (connectionString !== undefined && !isPostgresConnectionString(connectionString)) {
    issues.push(issue('DATABASE_URL', 'invalid'));
  }

  const poolMax = parseBoundedPositiveInteger(
    environment,
    'DB_POOL_MAX',
    DEFAULT_DB_POOL_MAX,
    20,
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

  if (issues.length > 0 || connectionString === undefined) {
    throw new ApiConfigError(issues);
  }

  return Object.freeze({
    connectionString,
    poolMax,
    connectionTimeoutMs,
    readinessTimeoutMs,
  });
}

function createDiagnosticId(): string {
  return `diag_${randomUUID().replaceAll('-', '')}`;
}

function normalizedStartupCause(error: unknown): string {
  if (error instanceof ApiConfigError) {
    return error.issues
      .map((entry) => `${entry.field}:${entry.reason}`)
      .join(', ') || 'configuration_rejected';
  }
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return STARTUP_ERROR_REASONS[
      error.code as keyof typeof STARTUP_ERROR_REASONS
    ] ?? 'unclassified_startup_failure';
  }
  return 'unclassified_startup_failure';
}

export function formatApiStartupFailure(
  error: unknown,
  diagnosticId = createDiagnosticId(),
): string {
  const safeDiagnosticId = DIAGNOSTIC_ID_PATTERN.test(diagnosticId)
    ? diagnosticId
    : createDiagnosticId();
  const isConfigFailure = error instanceof ApiConfigError;
  const cause = normalizedStartupCause(error);
  return [
    isConfigFailure
      ? '[CONFIG_INVALID] Application API refused to start'
      : '[STARTUP_FAILED] Application API failed to start',
    isConfigFailure
      ? 'Problem: 当前配置不能安全启动正式服务骨架。'
      : 'Problem: 服务启动未完成，未形成可用监听。',
    `Cause: ${cause}`,
    isConfigFailure
      ? 'Fix: 使用 formal-dev/test + AUTH_MODE=mock，保持 127.0.0.1，并提供有效 DATABASE_URL；部署型 profile 等后续门完成。'
      : 'Fix: 根据稳定 Cause 检查本机监听条件；Diagnostic 仅关联本次失败，不传播原始异常或环境值。',
    'Docs: docs/reference-api-runtime-config.md',
    `Diagnostic: ${safeDiagnosticId}`,
  ].join('\n');
}

export function formatApiShutdownFailure(
  signal: ApiShutdownSignal,
  diagnosticId = createDiagnosticId(),
): string {
  const safeDiagnosticId = DIAGNOSTIC_ID_PATTERN.test(diagnosticId)
    ? diagnosticId
    : createDiagnosticId();
  return [
    '[SHUTDOWN_FAILED] Application API did not close cleanly',
    'Problem: 服务已收到关闭信号，但本机监听清理未正常完成。',
    `Cause: close_failed_after_${signal}`,
    'Fix: 确认本机端口与进程状态后再重启；不要复用可能残留的服务实例。',
    'Docs: docs/reference-api-runtime-config.md',
    `Diagnostic: ${safeDiagnosticId}`,
  ].join('\n');
}
