import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { CONTRACT_PROVENANCE } from '@customer-agent/contracts/provenance';
import {
  DEFAULT_DB_POOL_MAX,
  DEFAULT_POLICY_ADMIN_DB_POOL_MAX,
  MAX_TOTAL_DB_POOL_CONNECTIONS,
  parseDatabaseConfig,
  postgresDatabaseTarget,
  postgresLoginName,
  type ApiDatabaseBootstrapConfig,
} from './runtime-config/database.js';
import {
  CUSTOMER_AGENT_PROFILES,
  parseAuthMode,
  parseBuildVersion,
  parseFeishuProviderConfig,
  parseLoopbackIdentityOrigin,
  parseProfile,
  type ApiProfile,
  type AuthMode,
  type CustomerAgentProfile,
  type FeishuProviderBootstrap,
} from './runtime-config/identity.js';
import {
  exactEnvironmentValue,
  issue,
  type ApiConfigIssue,
  type ApiRuntimeEnvironment,
} from './runtime-config/issues.js';
import {
  DEFAULT_API_PORT,
  LOOPBACK_HOST,
  listenStartupCause,
  parseListenPortToken,
  parseRequestedHost,
} from './runtime-config/network.js';
import {
  parseHmacKeyRing,
  parseLogHashConfig,
  parseSessionModeToken,
  type ApiHmacKeyRing,
} from './runtime-config/session.js';

export {
  CUSTOMER_AGENT_PROFILES,
  type ApiProfile,
  type AuthMode,
  type CustomerAgentProfile,
  type FeishuProviderBootstrap,
};
export type { ApiConfigIssue, ApiRuntimeEnvironment };
export type { ApiDatabaseBootstrapConfig, ApiHmacKeyRing };

export type ApiShutdownSignal = 'SIGINT' | 'SIGTERM';

export type ApiRuntimeConfig = Readonly<{
  profile: ApiProfile;
  authMode: AuthMode;
  sessionMode?: 'product';
  host: '127.0.0.1';
  port: number;
  buildVersion: string;
  contractSetId: string;
  runtimeActivated: false;
}>;

export type ProductIdentityBootstrap = Readonly<{
  database: ApiDatabaseBootstrapConfig;
} & (
  | { kind: 'synthetic'; providerOrigin: string }
  | { kind: 'feishu'; feishu: FeishuProviderBootstrap; providerOrigin?: string }
)>;

/** Private, process-local capability configuration. It must never cross the composition root. */
export type ApiPrivateBootstrapConfig = Readonly<{
  productIdentity?: ProductIdentityBootstrap;
  runtimeDatabase: ApiDatabaseBootstrapConfig;
  policyAdminDatabase: ApiDatabaseBootstrapConfig;
  idempotencyHmac: ApiHmacKeyRing;
  logHash: Readonly<{ version: string; key: string }>;
  objectStoreDir?: string;
  contentReview?: Readonly<{ database: ApiDatabaseBootstrapConfig }>;
  contentWorker?: Readonly<{ database: ApiDatabaseBootstrapConfig }>;
}>;

const DIAGNOSTIC_ID_PATTERN = /^diag_[0-9a-f]{32}$/;

/**
 * Cross-field configuration owner.
 *
 * Network, database, identity, and session modules parse their own fields.
 * Only this file may reject a combination: profile against port and auth mode,
 * session mode against identity databases, and pool logins, targets, and budgets
 * against each other.
 */
function resolveListenPort(
  environment: ApiRuntimeEnvironment,
  profile: CustomerAgentProfile | undefined,
  issues: ApiConfigIssue[],
): number {
  const token = parseListenPortToken(environment, issues);
  if (token.kind === 'absent') return profile === 'test' ? 0 : DEFAULT_API_PORT;
  if (token.kind === 'rejected') return DEFAULT_API_PORT;
  const allowed = token.port >= 1_024 || (profile === 'test' && token.port === 0);
  if (!allowed) {
    issues.push(issue('CUSTOMER_AGENT_API_PORT', 'invalid'));
    return DEFAULT_API_PORT;
  }
  return token.port;
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
  const sessionMode = parseSessionModeToken(environment, issues);
  if (sessionMode !== 'product' && (environment.AUTH_DATABASE_URL !== undefined || environment.SYNTHETIC_IDENTITY_PROVIDER_ORIGIN !== undefined)) {
    issues.push(issue('AUTH_SESSION_MODE', 'invalid'));
  }
  const requestedHost = parseRequestedHost(environment, issues);
  const port = resolveListenPort(environment, profile, issues);
  const buildVersion = parseBuildVersion(environment, issues);

  const runnable = profile === 'formal-dev' || profile === 'test' || profile === 'production';
  if (profile === 'demo') {
    issues.push(issue('CUSTOMER_AGENT_PROFILE', 'profile_not_service'));
  } else if (profile && !runnable) {
    issues.push(issue('CUSTOMER_AGENT_PROFILE', 'profile_not_available'));
  }

  if (authMode === 'feishu') {
    const feishuIssues: ApiConfigIssue[] = [];
    const feishu = parseFeishuProviderConfig(environment, feishuIssues);
    if (feishuIssues.length > 0) issues.push(...feishuIssues);
    else if (!feishu) issues.push(issue('AUTH_MODE', 'auth_mode_not_available'));
  } else if (authMode && authMode !== 'mock') {
    issues.push(issue('AUTH_MODE', 'auth_mode_not_available'));
  }
  if (requestedHost !== LOOPBACK_HOST) {
    issues.push(issue('CUSTOMER_AGENT_API_HOST', 'external_bind_not_allowed'));
  }

  if (issues.length > 0 || (profile !== 'formal-dev' && profile !== 'test' && profile !== 'production')
    || (authMode !== 'mock' && authMode !== 'feishu')) {
    throw new ApiConfigError(issues);
  }

  return Object.freeze({
    profile,
    authMode,
    ...(sessionMode === 'product' ? { sessionMode } : {}),
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
  const config = parseDatabaseConfig(environment, {
    connectionString: 'DATABASE_URL',
    poolMax: 'DB_POOL_MAX',
    defaultPoolMax: DEFAULT_DB_POOL_MAX,
  }, issues);
  if (issues.length > 0 || config === undefined) {
    throw new ApiConfigError(issues);
  }
  return config;
}

export function parseApiPrivateBootstrapConfig(
  environment: ApiRuntimeEnvironment,
): ApiPrivateBootstrapConfig {
  const issues: ApiConfigIssue[] = [];
  const wantsReview = environment.CONTENT_REVIEW_DATABASE_URL !== undefined;
  const wantsWorker = environment.CONTENT_WORKER_DATABASE_URL !== undefined;
  const runtimeDefault = environment.AUTH_SESSION_MODE === 'product'
    ? (wantsReview ? 12 : 16)
    : DEFAULT_DB_POOL_MAX;
  const runtimeDatabase = parseDatabaseConfig(environment, {
    connectionString: 'DATABASE_URL',
    poolMax: 'DB_POOL_MAX',
    defaultPoolMax: runtimeDefault,
  }, issues);
  const policyAdminDatabase = parseDatabaseConfig(environment, {
    connectionString: 'CONTENT_ADMIN_DATABASE_URL',
    poolMax: 'CONTENT_ADMIN_DB_POOL_MAX',
    defaultPoolMax: DEFAULT_POLICY_ADMIN_DB_POOL_MAX,
  }, issues);
  let productIdentity: ApiPrivateBootstrapConfig['productIdentity'];
  if (environment.AUTH_SESSION_MODE === 'product') {
    const database = parseDatabaseConfig(environment, {
      connectionString: 'AUTH_DATABASE_URL', poolMax: 'AUTH_DB_POOL_MAX', defaultPoolMax: 2,
    }, issues);
    if (environment.AUTH_MODE === 'feishu') {
      const feishuIssues: ApiConfigIssue[] = [];
      const feishu = parseFeishuProviderConfig(environment, feishuIssues);
      if (feishuIssues.length > 0) issues.push(...feishuIssues);
      else if (!feishu) issues.push(issue('AUTH_MODE', 'auth_mode_not_available'));
      let providerOrigin: string | undefined;
      if (environment.SYNTHETIC_IDENTITY_PROVIDER_ORIGIN !== undefined) {
        providerOrigin = parseLoopbackIdentityOrigin(environment.SYNTHETIC_IDENTITY_PROVIDER_ORIGIN);
        if (!providerOrigin) issues.push(issue('SYNTHETIC_IDENTITY_PROVIDER_ORIGIN', 'invalid'));
      }
      if (database && feishu && feishuIssues.length === 0
        && (environment.SYNTHETIC_IDENTITY_PROVIDER_ORIGIN === undefined || providerOrigin)) {
        productIdentity = Object.freeze(providerOrigin
          ? { kind: 'feishu' as const, database, feishu, providerOrigin }
          : { kind: 'feishu' as const, database, feishu });
      }
    } else {
      const providerOrigin = parseLoopbackIdentityOrigin(environment.SYNTHETIC_IDENTITY_PROVIDER_ORIGIN);
      if (!providerOrigin) issues.push(issue('SYNTHETIC_IDENTITY_PROVIDER_ORIGIN', 'invalid'));
      if (database && providerOrigin) {
        productIdentity = Object.freeze({ kind: 'synthetic', database, providerOrigin });
      }
    }
  }
  const idempotencyHmac = parseHmacKeyRing(environment, issues);
  const logHash = parseLogHashConfig(environment, issues);
  let objectStoreDir: string | undefined;
  const objectStoreValue = exactEnvironmentValue(environment, 'CONTENT_OBJECT_STORE_DIR', issues);
  if (objectStoreValue !== undefined) {
    if (!path.isAbsolute(objectStoreValue) || objectStoreValue.includes('\0')) {
      issues.push(issue('CONTENT_OBJECT_STORE_DIR', 'invalid'));
    } else {
      objectStoreDir = path.resolve(objectStoreValue);
    }
  }

  if (runtimeDatabase && policyAdminDatabase) {
    const runtimeLogin = postgresLoginName(runtimeDatabase.connectionString);
    const adminLogin = postgresLoginName(policyAdminDatabase.connectionString);
    if (runtimeDatabase.connectionString === policyAdminDatabase.connectionString
      || runtimeLogin === adminLogin
      || postgresDatabaseTarget(runtimeDatabase.connectionString)
        !== postgresDatabaseTarget(policyAdminDatabase.connectionString)) {
      issues.push(issue('CONTENT_ADMIN_DATABASE_URL', 'invalid'));
    }
    if (runtimeDatabase.poolMax + policyAdminDatabase.poolMax > MAX_TOTAL_DB_POOL_CONNECTIONS) {
      issues.push(issue('CONTENT_ADMIN_DB_POOL_MAX', 'invalid'));
    }
  }
  if (productIdentity && runtimeDatabase && policyAdminDatabase) {
    const auth = productIdentity.database;
    if ([runtimeDatabase, policyAdminDatabase].some(other =>
      postgresLoginName(auth.connectionString) === postgresLoginName(other.connectionString)
      || postgresDatabaseTarget(auth.connectionString) !== postgresDatabaseTarget(other.connectionString))) {
      issues.push(issue('AUTH_DATABASE_URL', 'invalid'));
    }
    if (auth.poolMax + runtimeDatabase.poolMax + policyAdminDatabase.poolMax > MAX_TOTAL_DB_POOL_CONNECTIONS) {
      issues.push(issue('AUTH_DB_POOL_MAX', 'invalid'));
    }
  }
  let contentReview: ApiPrivateBootstrapConfig['contentReview'];
  if (wantsReview) {
    if (environment.AUTH_SESSION_MODE !== 'product') {
      issues.push(issue('CONTENT_REVIEW_DATABASE_URL', 'invalid'));
    }
    const database = parseDatabaseConfig(environment, {
      connectionString: 'CONTENT_REVIEW_DATABASE_URL',
      poolMax: 'CONTENT_REVIEW_DB_POOL_MAX',
      defaultPoolMax: 2,
    }, issues);
    if (database && runtimeDatabase && policyAdminDatabase) {
      const reviewLogin = postgresLoginName(database.connectionString);
      const usedLogins = [
        postgresLoginName(runtimeDatabase.connectionString),
        postgresLoginName(policyAdminDatabase.connectionString),
        productIdentity ? postgresLoginName(productIdentity.database.connectionString) : undefined,
      ];
      if (usedLogins.includes(reviewLogin)
        || postgresDatabaseTarget(database.connectionString)
          !== postgresDatabaseTarget(runtimeDatabase.connectionString)) {
        issues.push(issue('CONTENT_REVIEW_DATABASE_URL', 'invalid'));
      }
      const used = runtimeDatabase.poolMax + policyAdminDatabase.poolMax
        + (productIdentity?.database.poolMax ?? 0) + database.poolMax;
      if (used > MAX_TOTAL_DB_POOL_CONNECTIONS - 2) {
        issues.push(issue('CONTENT_REVIEW_DB_POOL_MAX', 'invalid'));
      }
      contentReview = Object.freeze({ database });
    }
  }
  let contentWorker: ApiPrivateBootstrapConfig['contentWorker'];
  if (wantsWorker) {
    const database = parseDatabaseConfig(environment, {
      connectionString: 'CONTENT_WORKER_DATABASE_URL',
      poolMax: 'CONTENT_WORKER_DB_POOL_MAX',
      defaultPoolMax: 2,
    }, issues);
    if (database && runtimeDatabase && policyAdminDatabase) {
      const workerLogin = postgresLoginName(database.connectionString);
      const usedLogins = [
        postgresLoginName(runtimeDatabase.connectionString),
        postgresLoginName(policyAdminDatabase.connectionString),
        productIdentity ? postgresLoginName(productIdentity.database.connectionString) : undefined,
        contentReview ? postgresLoginName(contentReview.database.connectionString) : undefined,
      ];
      if (usedLogins.includes(workerLogin)
        || postgresDatabaseTarget(database.connectionString)
          !== postgresDatabaseTarget(runtimeDatabase.connectionString)) {
        issues.push(issue('CONTENT_WORKER_DATABASE_URL', 'invalid'));
      }
      contentWorker = Object.freeze({ database });
    }
  }
  if (idempotencyHmac && logHash
    && Object.values(idempotencyHmac.keys).includes(logHash.key)) {
    issues.push(issue('LOG_HASH_KEY', 'invalid'));
  }

  if (issues.length > 0 || !runtimeDatabase || !policyAdminDatabase
    || !idempotencyHmac || !logHash) {
    throw new ApiConfigError(issues);
  }
  return Object.freeze({ runtimeDatabase, policyAdminDatabase, idempotencyHmac, logHash,
    ...(productIdentity ? { productIdentity } : {}),
    ...(objectStoreDir ? { objectStoreDir } : {}),
    ...(contentReview ? { contentReview } : {}),
    ...(contentWorker ? { contentWorker } : {}),
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
    return listenStartupCause(error.code) ?? 'unclassified_startup_failure';
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
      ? 'Fix: 使用 production/formal-dev/test，AUTH_MODE 用 feishu 或 mock，保持 127.0.0.1，并提供有效 DATABASE_URL。single-host 与 multi-instance 仍未开放。'
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
