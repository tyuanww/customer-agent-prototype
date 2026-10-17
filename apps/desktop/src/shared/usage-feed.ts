import type { UsageLogFilter, UsageLogReply } from './dashboard-usage-log';
import { listUsageLog, type UsageSourceRow } from './usage-log-csv';
import { WORKBENCH_EMPTY } from './workbench-empty';

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
