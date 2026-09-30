import { AsyncLocalStorage } from 'node:async_hooks';
import { hmacSafeValue } from './idempotency.js';

/**
 * Per-request structured access log.
 *
 * Two constraints shape this:
 *
 *  1. The actor is authenticated INSIDE each route handler, into a local variable.
 *     There is no request decoration. An onResponse hook therefore cannot read it
 *     without touching all 34 call sites. AsyncLocalStorage closes that gap: the
 *     handler runs inside the store opened in onRequest, so the one shared auth
 *     helper can record the actor and the hook sees it.
 *
 *  2. Raw user ids must not reach the log. The repo already hashes subjects with
 *     LOG_HASH_KEY via hmacSafeValue, and that key is required to be identical across
 *     machines because existing log hashes were computed with it. Reuse it, so these
 *     lines join the same chain; do not introduce a second hash scheme.
 *
 * The key rides in the store rather than as a parameter, so recording an actor costs
 * no signature change at the 34 authenticateRequestHeaders call sites.
 */
export type ApiAccessLogRecord = Readonly<{
  requestId: string;
  userId: string;
  path: string;
  method: string;
  statusCode: number;
  durationMs: number;
}>;

export type ApiAccessLogSink = (line: string) => void;

type RequestContext = {
  requestId: string;
  actorHash: string | null;
  logHash: Readonly<{ version: string; key: string }>;
};

const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `work` inside a fresh request context. Callers must invoke this from an
 * onRequest hook (not around the handler only) so the store is still active when
 * onResponse runs.
 */
export function runWithRequestContext<T>(
  requestId: string,
  logHash: Readonly<{ version: string; key: string }>,
  work: () => T,
): T {
  return requestContext.run({ requestId, actorHash: null, logHash }, work);
}

/** Records the authenticated actor for the in-flight request. No-op outside a tracked request. */
export function recordRequestActor(userId: string): void {
  const store = requestContext.getStore();
  if (store === undefined || store.actorHash !== null) return;
  // First successful authentication wins; a route that authenticates twice must not
  // overwrite the identity the response is about to be reported against.
  store.actorHash = hmacSafeValue(`actor:${userId}`, store.logHash.version, store.logHash.key);
}

export function currentRequestId(): string | null {
  return requestContext.getStore()?.requestId ?? null;
}

export function currentRequestActorHash(): string | null {
  return requestContext.getStore()?.actorHash ?? null;
}

/** One JSON object per line; stable key order so the output diffs cleanly. */
export function formatApiAccessLog(record: ApiAccessLogRecord): string {
  return JSON.stringify({
    level: 'info',
    requestId: record.requestId,
    userId: record.userId,
    path: record.path,
    method: record.method,
    statusCode: record.statusCode,
    durationMs: record.durationMs,
  });
}

export const reportApiAccessLog: ApiAccessLogSink = (line) => {
  console.info(line);
};
