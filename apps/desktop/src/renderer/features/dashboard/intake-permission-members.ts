import type { IntakePermissionView } from '@shared/content-intake-permissions';

export type PermissionGrant = IntakePermissionView['grants'][number];
export type MemberRow =
  | { kind: 'person'; key: string; label: string; grants: PermissionGrant[] }
  | { kind: 'unresolved'; key: string; label: string; grants: [PermissionGrant] };

/** These keys only group the current view. Commands still use the original grant selection. */
export function permissionMembers(view: IntakePermissionView): MemberRow[] {
  if (!view.source) return [];
  const people = new Map<string, Extract<MemberRow, { kind: 'person' }>>();
  for (const person of view.people) {
    people.set(person.selection, { kind: 'person', key: `person:${person.selection}`, label: person.label, grants: [] });
  }
  const rows: MemberRow[] = [...people.values()];
  for (const grant of view.grants) {
    const selection = grant.personSelection;
    if (!selection?.trim()) {
      // A missing name/selection says nothing about identity or employment.
      rows.push({ kind: 'unresolved', key: `grant:${grant.selection}`, label: grant.person, grants: [grant] });
      continue;
    }
    let member = people.get(selection);
    if (!member) {
      member = { kind: 'person', key: `person:${selection}`, label: grant.person, grants: [] };
      people.set(selection, member);
      rows.push(member);
    }
    member.grants.push(grant);
  }
  return rows;
}

export type PermissionStatus = '已撤销' | '未生效' | '有效' | '已过期' | '时间待确认';

export function permissionStatus(grant: PermissionGrant, now: number): PermissionStatus {
  if (grant.revoked) return '已撤销';
  const starts = Date.parse(grant.startsAt), expires = Date.parse(grant.expiresAt);
  if (!Number.isFinite(starts) || !Number.isFinite(expires) || starts >= expires) return '时间待确认';
  if (expires <= now) return '已过期';
  return starts > now ? '未生效' : '有效';
}

export function memberPermissionSummary(member: MemberRow, now: number) {
  const counts = new Map<PermissionStatus, number>();
  const abilities = new Set<PermissionGrant['action']>();
  for (const grant of member.grants) {
    const status = permissionStatus(grant, now);
    counts.set(status, (counts.get(status) ?? 0) + 1);
    if (status === '有效') abilities.add(grant.action);
  }
  return { abilities: [...abilities], counts: [...counts] };
}

export function shortPermissionReference(reference: string): string {
  return reference.length > 14 ? `${reference.slice(0, 6)}…${reference.slice(-6)}` : reference;
}
