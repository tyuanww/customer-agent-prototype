export type BoardRole = 'director' | 'manager' | 'supervisor' | 'lead' | 'engineer' | 'agent';

export type BoardRights = {
  readonly publish: boolean;
  readonly grant: boolean;
  readonly uploadSop: boolean;
  readonly search: boolean;
  readonly readCatalog: boolean;
};

export type JobDirectoryEntry = { readonly name: string; readonly enabled: boolean };

export type JobLookup =
  | { readonly status: 'resolved'; readonly title: string; readonly role: BoardRole; readonly rights: BoardRights }
  | { readonly status: 'unresolved'; readonly reason: 'blank' | 'unknown' | 'duplicate' };

const TITLE_ROLE: Readonly<Record<string, BoardRole>> = {
  客服总监: 'director',
  客服经理: 'manager',
  客服主管: 'supervisor',
  客服组长: 'lead',
  AI赋能工程师: 'engineer',
  普通客服: 'agent',
  客服坐席: 'agent',
};

const RIGHTS: Readonly<Record<BoardRole, BoardRights>> = {
  director: { publish: true, grant: true, uploadSop: true, search: true, readCatalog: true },
  manager: { publish: true, grant: true, uploadSop: true, search: true, readCatalog: true },
  supervisor: { publish: true, grant: false, uploadSop: true, search: true, readCatalog: true },
  lead: { publish: true, grant: false, uploadSop: true, search: true, readCatalog: true },
  engineer: { publish: true, grant: true, uploadSop: true, search: true, readCatalog: true },
  agent: { publish: false, grant: false, uploadSop: false, search: true, readCatalog: true },
};

export function resolveJobTitle(title: string, directory: readonly JobDirectoryEntry[]): JobLookup {
  const name = title.trim();
  if (name.length === 0) return { status: 'unresolved', reason: 'blank' };
  const matches = directory.filter((entry) => entry.enabled && entry.name === name);
  if (matches.length > 1) return { status: 'unresolved', reason: 'duplicate' };
  const role = Object.hasOwn(TITLE_ROLE, name) ? TITLE_ROLE[name] : undefined;
  if (matches.length !== 1 || role === undefined) return { status: 'unresolved', reason: 'unknown' };
  return { status: 'resolved', title: name, role, rights: RIGHTS[role] };
}
