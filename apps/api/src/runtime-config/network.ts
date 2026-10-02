/**
 * Listen address grammar and startup errno names.
 *
 * Hides the loopback default, the port token shape, the 1–65535 range, and the
 * stable Cause strings for listen failures. It does not decide which profiles
 * may bind port 0, and it does not reject a non-loopback host. Those are
 * cross-field rules owned by runtime-config.ts.
 *
 * Stays in apps/api. The host lock and errno map are this process's listen
 * policy, not a generic network library.
 */
import {
  exactEnvironmentValue,
  issue,
  type ApiConfigIssue,
  type ApiRuntimeEnvironment,
} from './issues.js';

export const LOOPBACK_HOST = '127.0.0.1' as const;
export const DEFAULT_API_PORT = 3100;

const PORT_TOKEN = /^(?:0|[1-9][0-9]*)$/;
const STARTUP_ERROR_REASONS = Object.freeze({
  EACCES: 'listen_permission_denied',
  EADDRINUSE: 'listen_address_in_use',
  EADDRNOTAVAIL: 'listen_address_unavailable',
  EMFILE: 'process_file_limit_reached',
  ENFILE: 'system_file_limit_reached',
} as const);

export type ListenPortToken =
  | Readonly<{ kind: 'absent' }>
  | Readonly<{ kind: 'rejected' }>
  | Readonly<{ kind: 'numeric'; port: number }>;

/** Missing and padded values become absent. The caller already has the invalid issue for padding. */
export function parseRequestedHost(
  environment: ApiRuntimeEnvironment,
  issues: ApiConfigIssue[],
): string {
  return exactEnvironmentValue(environment, 'CUSTOMER_AGENT_API_HOST', issues) ?? LOOPBACK_HOST;
}

/**
 * A numeric token is 0..65535 without leading zeros. Privileged ports and the
 * test-only ephemeral port stay with the cross-field owner.
 */
export function parseListenPortToken(
  environment: ApiRuntimeEnvironment,
  issues: ApiConfigIssue[],
): ListenPortToken {
  const value = exactEnvironmentValue(environment, 'CUSTOMER_AGENT_API_PORT', issues);
  if (value === undefined) return Object.freeze({ kind: 'absent' });
  if (!PORT_TOKEN.test(value)) {
    issues.push(issue('CUSTOMER_AGENT_API_PORT', 'invalid'));
    return Object.freeze({ kind: 'rejected' });
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    issues.push(issue('CUSTOMER_AGENT_API_PORT', 'invalid'));
    return Object.freeze({ kind: 'rejected' });
  }
  return Object.freeze({ kind: 'numeric', port });
}

export function listenStartupCause(code: string): string | undefined {
  return STARTUP_ERROR_REASONS[code as keyof typeof STARTUP_ERROR_REASONS];
}
