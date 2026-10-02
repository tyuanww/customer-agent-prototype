/**
 * Session mode token and the two HMAC materials that protect a session.
 *
 * Hides which AUTH_SESSION_MODE tokens are spelled correctly, and how the
 * idempotency key ring and log-hash key are parsed. Requiring product mode
 * before auth database fields, and rejecting a log-hash key that repeats an
 * idempotency key, are cross-field rules owned by runtime-config.ts.
 *
 * Stays in apps/api. The key version grammar and the four-key cap are this
 * service's session contract, not a shared crypto package.
 */
import {
  exactEnvironmentValue,
  issue,
  type ApiConfigIssue,
  type ApiRuntimeEnvironment,
} from './issues.js';

export type ApiHmacKeyRing = Readonly<{
  currentVersion: string;
  keys: Readonly<Record<string, string>>;
}>;

export type SessionModeToken = 'mock' | 'product';

const HMAC_KEY_VERSION_PATTERN = /^hmac-[a-z0-9][a-z0-9._-]{0,31}$/;

export function parseSessionModeToken(
  environment: ApiRuntimeEnvironment,
  issues: ApiConfigIssue[],
): SessionModeToken | undefined {
  const sessionMode = environment.AUTH_SESSION_MODE;
  if (sessionMode !== undefined && sessionMode !== 'mock' && sessionMode !== 'product') {
    issues.push(issue('AUTH_SESSION_MODE', 'invalid'));
    return undefined;
  }
  return sessionMode;
}

function parseHmacVersion(
  environment: ApiRuntimeEnvironment,
  field: string,
  issues: ApiConfigIssue[],
): string | undefined {
  const version = exactEnvironmentValue(environment, field, issues);
  if (version === undefined) {
    if (environment[field] === undefined) issues.push(issue(field, 'missing'));
    return undefined;
  }
  if (!HMAC_KEY_VERSION_PATTERN.test(version)) {
    issues.push(issue(field, 'invalid'));
    return undefined;
  }
  return version;
}

function validHmacKeyMaterial(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim() === value
    && Buffer.byteLength(value, 'utf8') >= 32
    && Buffer.byteLength(value, 'utf8') <= 128;
}

export function parseHmacKeyRing(
  environment: ApiRuntimeEnvironment,
  issues: ApiConfigIssue[],
): ApiHmacKeyRing | undefined {
  const field = 'IDEMPOTENCY_HMAC_KEYS';
  const raw = exactEnvironmentValue(environment, field, issues);
  const currentVersion = parseHmacVersion(
    environment,
    'IDEMPOTENCY_HMAC_CURRENT_VERSION',
    issues,
  );
  if (raw === undefined) {
    if (environment[field] === undefined) issues.push(issue(field, 'missing'));
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    issues.push(issue(field, 'invalid'));
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    issues.push(issue(field, 'invalid'));
    return undefined;
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0 || entries.length > 4
    || entries.some(([version, key]) => !HMAC_KEY_VERSION_PATTERN.test(version)
      || !validHmacKeyMaterial(key))
    || new Set(entries.map(([, key]) => key)).size !== entries.length) {
    issues.push(issue(field, 'invalid'));
    return undefined;
  }
  if (currentVersion === undefined || !Object.hasOwn(parsed, currentVersion)) {
    if (currentVersion !== undefined) issues.push(issue('IDEMPOTENCY_HMAC_CURRENT_VERSION', 'invalid'));
    return undefined;
  }
  return Object.freeze({
    currentVersion,
    keys: Object.freeze(Object.fromEntries(entries) as Record<string, string>),
  });
}

export function parseLogHashConfig(
  environment: ApiRuntimeEnvironment,
  issues: ApiConfigIssue[],
): Readonly<{ version: string; key: string }> | undefined {
  const version = parseHmacVersion(environment, 'LOG_HASH_KEY_VERSION', issues);
  const key = exactEnvironmentValue(environment, 'LOG_HASH_KEY', issues);
  if (key === undefined) {
    if (environment.LOG_HASH_KEY === undefined) issues.push(issue('LOG_HASH_KEY', 'missing'));
    return undefined;
  }
  if (!validHmacKeyMaterial(key)) {
    issues.push(issue('LOG_HASH_KEY', 'invalid'));
    return undefined;
  }
  return version === undefined ? undefined : Object.freeze({ version, key });
}
