/**
 * Process identity fields: profile name, auth mode, Feishu provider, loopback
 * identity origin, and build version.
 *
 * Hides the accepted token shapes. Whether a profile may run, whether Feishu
 * mode is complete enough to start, and whether a product session may use the
 * origin are cross-field rules owned by runtime-config.ts.
 *
 * Stays in apps/api. Profile names, Feishu app-id shape, and the callback path
 * are this product's identity contract.
 */
import {
  exactEnvironmentValue,
  issue,
  type ApiConfigIssue,
  type ApiRuntimeEnvironment,
} from './issues.js';

export const CUSTOMER_AGENT_PROFILES = Object.freeze([
  'demo',
  'formal-dev',
  'test',
  'single-host',
  'multi-instance',
  'production',
] as const);

export type CustomerAgentProfile = (typeof CUSTOMER_AGENT_PROFILES)[number];
export type ApiProfile = Extract<CustomerAgentProfile, 'formal-dev' | 'test' | 'production'>;
export type AuthMode = 'mock' | 'feishu';

export type FeishuProviderBootstrap = Readonly<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}>;

const PROFILE_SET = new Set<string>(CUSTOMER_AGENT_PROFILES);
const AUTH_MODE_SET = new Set<string>(['mock', 'feishu']);
const FEISHU_APP_ID_PATTERN = /^cli_[a-z0-9]{8,32}$/;
const FEISHU_APP_SECRET_PATTERN = /^[\x21-\x7E]{16,128}$/;
const BUILD_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

function validFeishuRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0 && !url.username && !url.password
      && url.pathname === '/v1/auth/callback' && url.search === '' && url.hash === '';
  } catch {
    return false;
  }
}

export function parseProfile(
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

export function parseAuthMode(
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

export function parseLoopbackIdentityOrigin(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
      || Number(url.port) < 1024 || url.username || url.password || url.pathname !== '/'
      || url.search || url.hash) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function parseFeishuProviderConfig(
  environment: ApiRuntimeEnvironment,
  issues: ApiConfigIssue[],
): FeishuProviderBootstrap | undefined {
  if (environment.FEISHU_APP_ID === undefined
    || environment.FEISHU_APP_SECRET === undefined
    || environment.FEISHU_REDIRECT_URI === undefined) return undefined;
  const clientId = exactEnvironmentValue(environment, 'FEISHU_APP_ID', issues);
  const clientSecret = exactEnvironmentValue(environment, 'FEISHU_APP_SECRET', issues);
  const redirectUri = exactEnvironmentValue(environment, 'FEISHU_REDIRECT_URI', issues);
  let ok = true;
  if (clientId !== undefined && !FEISHU_APP_ID_PATTERN.test(clientId)) {
    issues.push(issue('FEISHU_APP_ID', 'invalid'));
    ok = false;
  }
  if (clientSecret !== undefined && !FEISHU_APP_SECRET_PATTERN.test(clientSecret)) {
    issues.push(issue('FEISHU_APP_SECRET', 'invalid'));
    ok = false;
  }
  if (redirectUri !== undefined && !validFeishuRedirectUri(redirectUri)) {
    issues.push(issue('FEISHU_REDIRECT_URI', 'invalid'));
    ok = false;
  }
  if (!ok || clientId === undefined || clientSecret === undefined || redirectUri === undefined) return undefined;
  return Object.freeze({ clientId, clientSecret, redirectUri });
}

export function parseBuildVersion(
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
