export type BoardRole = 'director' | 'manager' | 'supervisor' | 'lead' | 'engineer' | 'agent';

export type BoardRights = Readonly<{
  publish: boolean;
  grant: boolean;
  uploadSop: boolean;
  search: boolean;
  readCatalog: boolean;
}>;

export type RosterShops = 'content-shops';

export type JobRosterRow = Readonly<{
  title: string;
  role: BoardRole;
  rights: BoardRights;
  shops: RosterShops;
}>;

export type RosterMatch =
  | { readonly status: 'matched'; readonly row: JobRosterRow }
  | { readonly status: 'unmatched'; readonly reason: 'blank' | 'unknown' };

const all = { publish: true, grant: true, uploadSop: true, search: true, readCatalog: true } as const;
const lead = { publish: true, grant: false, uploadSop: true, search: true, readCatalog: true } as const;
const agent = { publish: false, grant: false, uploadSop: false, search: true, readCatalog: true } as const;

/** Shared job-to-permission table. Desktop session checks and login projection both read these rows. */
export const JOB_ROSTER: readonly JobRosterRow[] = [
  { title: '客服总监', role: 'director', rights: all, shops: 'content-shops' },
  { title: '客服经理', role: 'manager', rights: all, shops: 'content-shops' },
  { title: '客服主管', role: 'supervisor', rights: lead, shops: 'content-shops' },
  { title: '客服组长', role: 'lead', rights: lead, shops: 'content-shops' },
  { title: 'AI赋能工程师', role: 'engineer', rights: all, shops: 'content-shops' },
  { title: '普通客服', role: 'agent', rights: agent, shops: 'content-shops' },
  { title: '客服坐席', role: 'agent', rights: agent, shops: 'content-shops' },
];

const byTitle = new Map<string, JobRosterRow>();
for (const row of JOB_ROSTER) {
  if (byTitle.has(row.title)) throw new Error(`duplicate roster title ${row.title}`);
  byTitle.set(row.title, row);
}

export function matchJobRoster(title: string): RosterMatch {
  const name = title.trim();
  if (name.length === 0) return { status: 'unmatched', reason: 'blank' };
  const row = byTitle.get(name);
  if (!row) return { status: 'unmatched', reason: 'unknown' };
  return { status: 'matched', row };
}

/** Database grant actions this row may receive. `grant` stays a desktop issuing gate. */
export function rosterGrantActions(rights: BoardRights): readonly ('query' | 'publish' | 'import')[] {
  const actions: ('query' | 'publish' | 'import')[] = [];
  if (rights.search || rights.readCatalog) actions.push('query');
  if (rights.publish) actions.push('publish');
  if (rights.uploadSop) actions.push('import');
  return actions;
}

export function rosterJobId(role: BoardRole): string {
  return `job-login-${role}`;
}
