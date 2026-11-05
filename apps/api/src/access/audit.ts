import { createHash } from 'node:crypto';
import type { DenyReason } from './evaluator.js';

export type AccessDenialAuditEntry = Readonly<{
  actorHash: string;
  route: string;
  accessRevision: number;
  reason: DenyReason;
}>;

export type AccessDenialAudit = Readonly<{
  record: (input: Readonly<{
    actorUserId: string;
    route: string;
    accessRevision: number;
    reason: DenyReason;
  }>) => void;
  size: () => number;
}>;

export function createBoundedDenialAudit(options: Readonly<{
  maxEntries: number;
  windowMs: number;
  now?: () => number;
  write: (entry: AccessDenialAuditEntry) => void;
}>): AccessDenialAudit {
  if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries < 1) {
    throw new Error('ACCESS_DENIAL_AUDIT_SIZE_INVALID');
  }
  if (!Number.isFinite(options.windowMs) || options.windowMs < 1) {
    throw new Error('ACCESS_DENIAL_AUDIT_WINDOW_INVALID');
  }
  const now = options.now ?? Date.now;
  const seen = new Map<string, number>();

  function trim(at: number): void {
    for (const [key, expiresAt] of seen) {
      if (expiresAt <= at) seen.delete(key);
    }
    while (seen.size >= options.maxEntries) {
      const oldest = seen.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
  }

  return Object.freeze({
    record(input) {
      const actorHash = createHash('sha256').update(input.actorUserId).digest('hex');
      const key = `${actorHash}\0${input.route}\0${input.accessRevision}\0${input.reason}`;
      const at = now();
      const prior = seen.get(key);
      if (prior !== undefined && prior > at) return;
      if (prior !== undefined) seen.delete(key);
      trim(at);
      seen.set(key, at + options.windowMs);
      try {
        options.write(Object.freeze({
          actorHash,
          route: input.route,
          accessRevision: input.accessRevision,
          reason: input.reason,
        }));
      } catch {
        // Audit is observational. A broken sink cannot turn a deny into an allow.
      }
    },
    size: () => seen.size,
  });
}
