import type { UsageLogFilter, UsageLogReply, UsageLogResult } from './dashboard-usage-log';
import { listUsageLog, type UsageSourceRow } from './usage-log-csv';
import { WORKBENCH_EMPTY } from './workbench-empty';

const USAGE_RESULTS = new Set<UsageLogResult>(['copied', 'viewed', 'miss']);

export type UsageMount =
  | { kind: 'unmounted' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; actorId: string };

export function usageReplyForMount(
  mount: UsageMount,
  readRows: (actorId: string) => readonly UsageSourceRow[],
  filter: Partial<UsageLogFilter> | null | undefined,
): UsageLogReply {
  if (mount.kind === 'unmounted') return listUsageLog(null, filter);
  if (mount.kind === 'signed-out') {
    return { ok: false, code: 'UNAUTHORIZED', message: WORKBENCH_EMPTY.signedOut };
  }
  try {
    return listUsageLog(readRows(mount.actorId), filter);
  } catch {
    return { ok: false, code: 'FAILED', message: WORKBENCH_EMPTY.usageFailed };
  }
}

function textOrNull(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  throw new Error('usage field');
}

/** Rows from GET /v1/events/usage. A body that is not that list throws. */
export function serverUsageRows(value: unknown): UsageSourceRow[] {
  if (typeof value !== 'object' || value === null || !('rows' in value)) throw new Error('usage body');
  const rows = (value as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) throw new Error('usage body');
  return rows.map((row) => {
    if (typeof row !== 'object' || row === null) throw new Error('usage row');
    const item = row as Record<string, unknown>;
    if (typeof item.id !== 'string' || item.id === '' || typeof item.askedAt !== 'string' || typeof item.agent !== 'string') {
      throw new Error('usage row');
    }
    if (typeof item.result !== 'string' || !USAGE_RESULTS.has(item.result as UsageLogResult)) throw new Error('usage row');
    if (typeof item.snapshotStale !== 'boolean') throw new Error('usage row');
    if (item.consented !== undefined && typeof item.consented !== 'boolean') throw new Error('usage row');
    return {
      id: item.id,
      askedAt: item.askedAt,
      agent: item.agent,
      question: textOrNull(item.question),
      scriptTitle: textOrNull(item.scriptTitle),
      result: item.result as UsageLogResult,
      snapshotStale: item.snapshotStale,
      ...(typeof item.consented === 'boolean' ? { consented: item.consented } : {}),
    };
  });
}

function unauthorized(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'UNAUTHORIZED';
}

/** Signed-in product reads the server list. Everyone else keeps the local reader. */
export async function usageReplyFromSources(
  mount: UsageMount,
  readRows: (actorId: string) => readonly UsageSourceRow[],
  readRemote: (() => Promise<readonly UsageSourceRow[]>) | null,
  filter: Partial<UsageLogFilter> | null | undefined,
): Promise<UsageLogReply> {
  if (mount.kind !== 'signed-in' || readRemote === null) return usageReplyForMount(mount, readRows, filter);
  try {
    const rows = await readRemote();
    return usageReplyForMount(mount, () => rows, filter);
  } catch (error) {
    if (unauthorized(error)) return { ok: false, code: 'UNAUTHORIZED', message: WORKBENCH_EMPTY.signedOut };
    return { ok: false, code: 'FAILED', message: WORKBENCH_EMPTY.usageFailed };
  }
}
