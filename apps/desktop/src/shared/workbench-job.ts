export type { BoardRights, BoardRole } from '../../../api/src/job-roster';
import { matchJobRoster, normalizeJobTitle, type BoardRole, type BoardRights } from '../../../api/src/job-roster';

export type JobDirectoryEntry = { readonly name: string; readonly enabled: boolean };

export type JobLookup =
  | { readonly status: 'resolved'; readonly title: string; readonly role: BoardRole; readonly rights: BoardRights }
  | { readonly status: 'unresolved'; readonly reason: 'blank' | 'unknown' | 'duplicate' };

export function resolveJobTitle(title: string, directory: readonly JobDirectoryEntry[]): JobLookup {
  const name = normalizeJobTitle(title);
  if (name.length === 0) return { status: 'unresolved', reason: 'blank' };
  const matches = directory.filter((entry) => entry.enabled && normalizeJobTitle(entry.name) === name);
  if (matches.length > 1) return { status: 'unresolved', reason: 'duplicate' };
  const match = matchJobRoster(name);
  if (matches.length !== 1 || match.status !== 'matched') return { status: 'unresolved', reason: 'unknown' };
  return { status: 'resolved', title: match.row.title, role: match.row.role, rights: match.row.rights };
}
