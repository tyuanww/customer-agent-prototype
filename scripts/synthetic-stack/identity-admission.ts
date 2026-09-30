/**
 * Shared admission and credential rules for the two loopback identity servers.
 *
 * Why this exists: both servers used to decide "is this request local?" from the
 * socket's remote address. Behind a same-host cloudflared ingress that check is
 * tautological — the tunnel connects from 127.0.0.1, so a request carrying a public
 * Host still looks local. Both servers now decide from the Host header instead, and
 * one of them no longer ships a default password.
 *
 * Rules, in order of how much they matter:
 *
 *  1. Admission is by Host. The remote address is kept only as a second signal, never
 *     as the sole one.
 *  2. A missing account file fails the process, it does not seed a default password.
 *     A generated fallback is how the previous version ended up accepting a
 *     hardcoded password for `synthetic_owner` on a public hostname.
 *  3. Credentials are verified with scrypt + timingSafeEqual. No plaintext compare.
 */
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export type PasswordAccount = Readonly<{
  username: string;
  bindingId: string;
  salt: string;
  hash: string;
}>;

/** Loopback hostnames a request may legitimately carry. */
const LOOPBACK_HOSTNAMES = Object.freeze(['127.0.0.1', 'localhost', '[::1]', '::1']);
const ALLOWED_HOSTS_ENV = 'CUSTOMER_AGENT_IDENTITY_ALLOWED_HOSTS';

/**
 * Hostnames the identity servers will answer. Defaults to loopback only; set
 * CUSTOMER_AGENT_IDENTITY_ALLOWED_HOSTS (comma separated) to add one deliberately,
 * e.g. a temporary probe hostname. It must never contain the production hostname.
 */
export function allowedIdentityHostnames(environment: NodeJS.ProcessEnv = process.env): readonly string[] {
  const configured = (environment[ALLOWED_HOSTS_ENV] ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return Object.freeze([...LOOPBACK_HOSTNAMES, ...configured]);
}

/** Strips an optional port and lowercases, so `127.0.0.1:43101` and `[::1]:43101` both parse. */
export function hostnameOf(hostHeader: string | undefined): string | null {
  if (typeof hostHeader !== 'string') return null;
  const value = hostHeader.trim().toLowerCase();
  if (value.length === 0) return null;
  // Bracketed IPv6: [::1]:43101 -> [::1]
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    return close === -1 ? null : value.slice(0, close + 1);
  }
  const colon = value.indexOf(':');
  return colon === -1 ? value : value.slice(0, colon);
}

/**
 * True only when the request's Host names a permitted loopback (or explicitly added)
 * hostname. A request with no Host header is rejected: HTTP/1.1 requires one, and
 * guessing in its absence is exactly the mistake this replaces.
 */
export function isAdmittedHost(
  hostHeader: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const hostname = hostnameOf(hostHeader);
  if (hostname === null) return false;
  return allowedIdentityHostnames(environment).includes(hostname);
}

/**
 * Reads the account file. Throws when it is missing or yields no usable account.
 * Deliberately does NOT fall back to a generated password: that fallback is the
 * vulnerability, and a silent one is worse than a refused start.
 */
export function loadPasswordAccounts(file: string): Map<string, PasswordAccount> {
  if (!existsSync(file)) {
    throw new Error(
      `identity accounts file is missing: ${file}. `
      + 'Create one with `pnpm identity:accounts:init` (generates a random password). '
      + 'This process will not start without it; it will not fall back to a default password.',
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`identity accounts file is not valid JSON: ${file} (${String(error)})`);
  }
  if (!Array.isArray(raw)) {
    throw new Error(`identity accounts file must be a JSON array: ${file}`);
  }
  const accounts = new Map<string, PasswordAccount>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const username = Reflect.get(row, 'username');
    const bindingId = Reflect.get(row, 'bindingId');
    const salt = Reflect.get(row, 'salt');
    const hash = Reflect.get(row, 'hash');
    if (typeof username !== 'string' || typeof bindingId !== 'string'
      || typeof salt !== 'string' || typeof hash !== 'string') continue;
    if (!/^synthetic_[A-Za-z0-9_-]{1,100}$/.test(bindingId)) continue;
    if (!/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{128}$/.test(hash)) continue;
    accounts.set(username, Object.freeze({ username, bindingId, salt, hash }));
  }
  if (accounts.size === 0) {
    throw new Error(`identity accounts file contains no usable account: ${file}`);
  }
  return accounts;
}

/** scrypt + constant-time compare. Never compares the submitted password as text. */
export function passwordMatches(account: PasswordAccount, password: string): boolean {
  const actual = scryptSync(password, account.salt, 64);
  const expected = Buffer.from(account.hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Builds one account row for a given password. Used by the setup command and tests. */
export function buildAccount(username: string, bindingId: string, password: string): PasswordAccount {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return Object.freeze({ username, bindingId, salt, hash });
}
