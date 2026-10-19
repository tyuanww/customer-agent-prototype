export type RosterShops = 'content-shops';

export type RosterActions = Readonly<{
  publish: boolean;
  grant: boolean;
  uploadSop: boolean;
  search: boolean;
  readCatalog: boolean;
}>;

export type JobRosterRow = Readonly<{
  title: string;
  actions: RosterActions;
  shops: RosterShops;
}>;

export type RosterMatch =
  | { readonly status: 'matched'; readonly row: JobRosterRow }
  | { readonly status: 'unmatched'; readonly reason: 'blank' | 'unknown' };

const all = { publish: true, grant: true, uploadSop: true, search: true, readCatalog: true } as const;
const lead = { publish: true, grant: false, uploadSop: true, search: true, readCatalog: true } as const;
const agent = { publish: false, grant: false, uploadSop: false, search: true, readCatalog: true } as const;

/** The only job-to-permission table. Shop scope is the shops that already have content. */
export const JOB_ROSTER: readonly JobRosterRow[] = [
  { title: '客服总监', actions: all, shops: 'content-shops' },
  { title: '客服经理', actions: all, shops: 'content-shops' },
  { title: '客服主管', actions: lead, shops: 'content-shops' },
  { title: '客服组长', actions: lead, shops: 'content-shops' },
  { title: 'AI赋能工程师', actions: all, shops: 'content-shops' },
  { title: '普通客服', actions: agent, shops: 'content-shops' },
  { title: '客服坐席', actions: agent, shops: 'content-shops' },
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
