import { parseContractSchema } from '@customer-agent/contracts';
import type { OrganizationTransport } from '../../src/content-intake/organization/feishu-observer.js';

/**
 * Offline loopback transport for the existing organization observer.
 *
 * Two boundaries were compared. A folds sockets, bearer injection, byte budgets
 * and the published rate limits into the observer. B keeps that wire work here
 * and leaves native-field mapping, double scan, and the five-minute window in
 * the observer, with the restricted writer still the only database owner.
 * B is the candidate: a failed read never becomes a snapshot, and the writer
 * transaction still performs no network I/O.
 *
 * This module does not read the environment, call a token endpoint, follow
 * redirects, retry, or accept any origin except http://127.0.0.1:<port>.
 * Real Feishu assembly stays disabled. Official published limits are enforced
 * by refusing the next call; they are not a queue, a backoff policy, or proof
 * of an upstream atomic snapshot.
 *
 * User GET: https://open.feishu.cn/document/server-docs/contact-v3/user/get
 *   1000/minute and 50/second. Query user_id_type=open_id and
 *   department_id_type=open_department_id. App identity is tenant_access_token.
 * Job-title GET: https://open.feishu.cn/document/contact-v3/job_title/list
 *   10/minute, page_size maximum 50. Those numbers are the published caps
 *   checked on 2026-10-08. No per-request SLA was published for either GET;
 *   requestTimeoutMs is only this experiment's budget and cannot exceed the
 *   observer's existing 180s observation timeout.
 */
const MAX_RESPONSE_BYTES = 1_048_576;
const REQUEST_TIMEOUT_CAP_MS = 180_000;
const JOB_TITLES_PER_MINUTE = 10;
const USERS_PER_MINUTE = 1_000;
const USERS_PER_SECOND = 50;
const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;
const PAGE_SIZE = '50';

export type OrganizationTransportFailure = 'CANCELLED' | 'TIMED_OUT' | 'RESPONSE_TOO_LARGE' | 'RATE_LIMITED'
  | 'AUTH_REJECTED' | 'HTTP_STATUS' | 'TOKEN_UNAVAILABLE' | 'ORIGIN_FORBIDDEN' | 'INVALID_REQUEST' | 'UNAVAILABLE';

export class OrganizationTransportError extends Error {
  readonly code: OrganizationTransportFailure;
  constructor(code: OrganizationTransportFailure) {
    super(code);
    this.name = 'OrganizationTransportError';
    this.code = code;
  }
}

/** Injected app-identity credential; cached only in memory until expiry, never fetched or persisted here. */
export type OrganizationAppToken = { token: string; expiresAtMs: number };
export type OrganizationTokenSupplier = {
  current(signal: AbortSignal): Promise<OrganizationAppToken>;
};
export type OrganizationHttpTransportOptions = {
  origin: string;
  requestTimeoutMs: number;
  /** Quota and token-expiry clock only. It is not the observation-start clock. */
  now?: () => number;
} & ({ tokenSupplier: OrganizationTokenSupplier; session?: never } | { session: OrganizationHttpSession; tokenSupplier?: never });
export type OrganizationHttpSession = {
  current(signal: AbortSignal): Promise<OrganizationHttpCredential>;
  reserve(kind: 'user' | 'jobs'): void;
  assertCurrent(credential: OrganizationHttpCredential): void;
  invalidate(credential?: OrganizationHttpCredential): void;
};
/** Object identity is the private issuance epoch, even when token text repeats. */
export type OrganizationHttpCredential = Readonly<{ token: string }>;

class SlidingWindow {
  private readonly stamps: number[] = [];
  constructor(private readonly limit: number, private readonly spanMs: number) {}
  /** A backward step keeps already counted calls. It does not grant a new window. */
  full(now: number): boolean {
    const floor = now - this.spanMs;
    while (this.stamps.length > 0 && this.stamps[0]! <= floor) this.stamps.shift();
    return this.stamps.length >= this.limit;
  }
  mark(now: number) { this.stamps.push(now); }
}

function loopbackOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new OrganizationTransportError('ORIGIN_FORBIDDEN'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new OrganizationTransportError('ORIGIN_FORBIDDEN');
  }
  return url.origin;
}

function requireTimeout(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > REQUEST_TIMEOUT_CAP_MS) {
    throw new OrganizationTransportError('INVALID_REQUEST');
  }
}

function clockReading(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) throw new OrganizationTransportError('UNAVAILABLE');
  return value;
}

function classify(caller: AbortSignal, timeout: AbortSignal, error: unknown): OrganizationTransportError {
  if (caller.aborted) return new OrganizationTransportError('CANCELLED');
  if (timeout.aborted) return new OrganizationTransportError('TIMED_OUT');
  if (error instanceof OrganizationTransportError) return error;
  return new OrganizationTransportError('UNAVAILABLE');
}

function pageToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > 2048
    || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new OrganizationTransportError('INVALID_REQUEST');
  }
  return value;
}

function usableToken(issued: OrganizationAppToken, now: number): string {
  if (!issued || typeof issued !== 'object' || typeof issued.token !== 'string'
    || !Number.isSafeInteger(issued.expiresAtMs) || issued.expiresAtMs <= now) {
    throw new OrganizationTransportError('TOKEN_UNAVAILABLE');
  }
  const token = issued.token;
  if (token.length < 1 || token.length > 4096
    || [...token].some(character => { const code = character.charCodeAt(0); return code < 33 || code > 126; })) {
    throw new OrganizationTransportError('TOKEN_UNAVAILABLE');
  }
  return token;
}

function declaredLength(header: string | null): number | undefined {
  if (header === null) return undefined;
  if (!/^\d{1,10}$/.test(header)) throw new OrganizationTransportError('UNAVAILABLE');
  const value = Number(header);
  if (!Number.isSafeInteger(value)) throw new OrganizationTransportError('UNAVAILABLE');
  return value;
}

/** One explicit owner per running application assembly. Its tenant/app entries
 * survive transport creation/disposal; callers cannot clear quota by rotating a
 * token or replacing an HTTP client. No global environment or token endpoint.
 * Cancellation only detaches that waiter. A shared credential request has its own
 * bounded lifetime; revocation aborts it and rejects all waiters, including a
 * supplier that ignores AbortSignal. This owner does not prove tenant identity. */
export function createOrganizationHttpSessionOwner(options: {
  supplier(scope: { tenantId: string; appId: string }): OrganizationTokenSupplier;
  tokenTimeoutMs: number; now?: () => number;
}) {
  requireTimeout(options.tokenTimeoutMs);
  const now = options.now ?? Date.now;
  const entries = new Map<string, OrganizationHttpSession>();
  let closed = false;
  return {
    close() {
      closed = true;
      for (const entry of entries.values()) entry.invalidate();
    },
    session(raw: { tenantId: string; appId: string }): OrganizationHttpSession {
      if (closed) throw new OrganizationTransportError('TOKEN_UNAVAILABLE');
      const scope = { tenantId: parseContractSchema('IntakeId', raw.tenantId), appId: parseContractSchema('IntakeId', raw.appId) };
      const key = JSON.stringify(scope);
      const existing = entries.get(key);
      if (existing) return existing;
      const supplier = options.supplier(scope);
      const jobs = new SlidingWindow(JOB_TITLES_PER_MINUTE, MINUTE_MS);
      const seconds = new SlidingWindow(USERS_PER_SECOND, SECOND_MS);
      const minutes = new SlidingWindow(USERS_PER_MINUTE, MINUTE_MS);
      let cached: { lease: OrganizationHttpCredential; expiresAtMs: number } | undefined;
      let generation = 0;
      let pending: { controller: AbortController; promise: Promise<OrganizationHttpCredential> } | undefined;
      const session: OrganizationHttpSession = {
        async current(signal) {
          if (signal.aborted) throw new OrganizationTransportError('CANCELLED');
          if (closed) throw new OrganizationTransportError('TOKEN_UNAVAILABLE');
          if (cached && cached.expiresAtMs > clockReading(now)) return cached.lease;
          if (!pending) {
            // Expiry starts a new issuance. A late rejection of the old lease
            // must not cancel the replacement supplier while it is pending.
            cached = undefined;
            const controller = new AbortController(), version = generation;
            const timer = setTimeout(() => controller.abort(), options.tokenTimeoutMs);
            const promise = new Promise<OrganizationHttpCredential>((resolve, reject) => {
              const abort = () => reject(new OrganizationTransportError('TOKEN_UNAVAILABLE'));
              controller.signal.addEventListener('abort', abort, { once: true });
              Promise.resolve().then(() => {
                if (closed || controller.signal.aborted || generation !== version) throw new OrganizationTransportError('TOKEN_UNAVAILABLE');
                return supplier.current(controller.signal);
              }).then(issued => {
                if (controller.signal.aborted || generation !== version) throw new OrganizationTransportError('TOKEN_UNAVAILABLE');
                const token = usableToken(issued, clockReading(now));
                const lease = Object.freeze({ token });
                cached = { lease, expiresAtMs: issued.expiresAtMs };
                resolve(lease);
              }).catch(() => reject(new OrganizationTransportError('TOKEN_UNAVAILABLE'))).finally(() => {
                controller.signal.removeEventListener('abort', abort);
              });
            }).finally(() => {
              clearTimeout(timer);
              if (pending?.controller === controller) pending = undefined;
            });
            pending = { controller, promise };
          }
          const shared = pending.promise;
          return new Promise<OrganizationHttpCredential>((resolve, reject) => {
            const abort = () => reject(new OrganizationTransportError('CANCELLED'));
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
            shared.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
          });
        },
        reserve(kind) {
          if (closed) throw new OrganizationTransportError('TOKEN_UNAVAILABLE');
          const at = clockReading(now), windows = kind === 'jobs' ? [jobs] : [seconds, minutes];
          if (windows.some(window => window.full(at))) throw new OrganizationTransportError('RATE_LIMITED');
          for (const window of windows) window.mark(at);
        },
        assertCurrent(credential) {
          if (closed || !cached || cached.lease !== credential || cached.expiresAtMs <= clockReading(now)) throw new OrganizationTransportError('TOKEN_UNAVAILABLE');
        },
        invalidate(credential) {
          // A late 401 belongs to its original issuance, never a newer lease.
          if (credential && cached?.lease !== credential) return;
          generation += 1; cached = undefined;
          pending?.controller.abort(); pending = undefined;
        },
      };
      entries.set(key, session);
      return session;
    },
  };
}

async function discard(response: Response) {
  await response.body?.cancel().catch(() => undefined);
}

async function readBounded(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) throw new OrganizationTransportError('UNAVAILABLE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw new OrganizationTransportError('CANCELLED');
    for (;;) {
      const chunk = await reader.read();
      if (signal.aborted) throw new OrganizationTransportError('CANCELLED');
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new OrganizationTransportError('RESPONSE_TOO_LARGE');
      }
      chunks.push(chunk.value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createOrganizationHttpTransport(options: OrganizationHttpTransportOptions): OrganizationTransport {
  const origin = loopbackOrigin(options.origin);
  requireTimeout(options.requestTimeoutMs);
  const now = options.now ?? Date.now;
  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new OrganizationTransportError('UNAVAILABLE');
  const jobsPerMinute = new SlidingWindow(JOB_TITLES_PER_MINUTE, MINUTE_MS);
  const usersPerMinute = new SlidingWindow(USERS_PER_MINUTE, MINUTE_MS);
  const usersPerSecond = new SlidingWindow(USERS_PER_SECOND, SECOND_MS);
  let cached: OrganizationAppToken | undefined;

  function reserve(kind: 'user' | 'jobs', at: number) {
    const windows = kind === 'jobs' ? [jobsPerMinute] : [usersPerSecond, usersPerMinute];
    if (windows.some(window => window.full(at))) throw new OrganizationTransportError('RATE_LIMITED');
    for (const window of windows) window.mark(at);
  }

  async function credential(combined: AbortSignal, caller: AbortSignal, timeout: AbortSignal): Promise<OrganizationHttpCredential> {
    if (options.session) return options.session.current(combined);
    const at = clockReading(now);
    if (cached && cached.expiresAtMs > at) return { token: cached.token };
    let issued: OrganizationAppToken;
    try {
      issued = await new Promise<OrganizationAppToken>((resolve, reject) => {
        if (combined.aborted) {
          reject(new OrganizationTransportError(caller.aborted ? 'CANCELLED' : 'TIMED_OUT'));
          return;
        }
        const onAbort = () => reject(new OrganizationTransportError(caller.aborted ? 'CANCELLED' : 'TIMED_OUT'));
        combined.addEventListener('abort', onAbort, { once: true });
        Promise.resolve().then(() => options.tokenSupplier!.current(combined)).then(resolve, reject).finally(() => {
          combined.removeEventListener('abort', onAbort);
        });
      });
    } catch (error) {
      if (caller.aborted) throw new OrganizationTransportError('CANCELLED');
      if (timeout.aborted) throw new OrganizationTransportError('TIMED_OUT');
      if (error instanceof OrganizationTransportError) throw error;
      throw new OrganizationTransportError('TOKEN_UNAVAILABLE');
    }
    if (caller.aborted) throw new OrganizationTransportError('CANCELLED');
    if (timeout.aborted) throw new OrganizationTransportError('TIMED_OUT');
    const token = usableToken(issued, clockReading(now));
    cached = { token, expiresAtMs: issued.expiresAtMs };
    return { token };
  }

  async function once(path: string, query: URLSearchParams, caller: AbortSignal, kind: 'user' | 'jobs'): Promise<string> {
    if (caller.aborted) throw new OrganizationTransportError('CANCELLED');
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), options.requestTimeoutMs);
    timer.unref?.();
    const combined = AbortSignal.any([caller, timeoutController.signal]);
    try {
      const lease = await credential(combined, caller, timeoutController.signal);
      const token = lease.token;
      if (options.session) options.session.reserve(kind);
      else reserve(kind, clockReading(now));
      const url = new URL(path, origin);
      url.search = query.toString();
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'GET', redirect: 'error', signal: combined,
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        });
      } catch (error) {
        throw classify(caller, timeoutController.signal, error);
      }
      if (caller.aborted) { await discard(response); throw new OrganizationTransportError('CANCELLED'); }
      if (timeoutController.signal.aborted) { await discard(response); throw new OrganizationTransportError('TIMED_OUT'); }
      if (response.status === 429) { await discard(response); throw new OrganizationTransportError('RATE_LIMITED'); }
      if (response.status === 401 || response.status === 403) {
        options.session?.invalidate(lease);
        await discard(response); throw new OrganizationTransportError('AUTH_REJECTED');
      }
      if (response.status !== 200) { await discard(response); throw new OrganizationTransportError('HTTP_STATUS'); }
      const length = declaredLength(response.headers.get('content-length'));
      if (length !== undefined && length > MAX_RESPONSE_BYTES) {
        await discard(response); throw new OrganizationTransportError('RESPONSE_TOO_LARGE');
      }
      try {
        const body = await readBounded(response, combined);
        options.session?.assertCurrent(lease);
        return body;
      } catch (error) {
        throw classify(caller, timeoutController.signal, error);
      }
    } finally {
      clearTimeout(timer);
      // Header validation can fail before readBounded owns the response body.
      // Every exit must release this request without relying on observer cleanup.
      timeoutController.abort();
    }
  }

  return {
    user(openId, signal) {
      let id: string;
      try { id = parseContractSchema('IntakeId', openId); } catch { throw new OrganizationTransportError('INVALID_REQUEST'); }
      const query = new URLSearchParams();
      query.set('user_id_type', 'open_id');
      query.set('department_id_type', 'open_department_id');
      return once(`/open-apis/contact/v3/users/${encodeURIComponent(id)}`, query, signal, 'user');
    },
    jobTitles(token, signal) {
      const query = new URLSearchParams();
      query.set('page_size', PAGE_SIZE);
      const cursor = pageToken(token);
      if (cursor !== undefined) query.set('page_token', cursor);
      return once('/open-apis/contact/v3/job_titles', query, signal, 'jobs');
    },
  };
}
