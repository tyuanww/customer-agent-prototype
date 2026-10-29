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
  /** Stable policy key. The display title is an input, never the identity key. */
  jobId: string;
  title: string;
  role: BoardRole;
  rights: BoardRights;
  shops: RosterShops;
}>;

export type JobAlias = Readonly<{
  title: string;
  jobId: string;
  validFrom: string;
  validUntil: string;
}>;

/** Finite alias window. Empty until an operator records a real title. No fuzzy match. */
export const JOB_ALIASES: readonly JobAlias[] = [];

export type RosterMatch =
  | { readonly status: 'matched'; readonly row: JobRosterRow }
  | { readonly status: 'unmatched'; readonly reason: 'blank' | 'unknown' | 'expired' | 'ambiguous' };

const all = { publish: true, grant: true, uploadSop: true, search: true, readCatalog: true } as const;
const lead = { publish: true, grant: false, uploadSop: true, search: true, readCatalog: true } as const;
const agent = { publish: false, grant: false, uploadSop: false, search: true, readCatalog: true } as const;

/** Desktop buttons and login registration both read these rows. Login still issues query only. */
export const JOB_ROSTER: readonly JobRosterRow[] = [
  { jobId: 'job-customer-service-director', title: '客服总监', role: 'director', rights: all, shops: 'content-shops' },
  { jobId: 'job-customer-service-manager', title: '客服经理', role: 'manager', rights: all, shops: 'content-shops' },
  { jobId: 'job-customer-service-supervisor', title: '客服主管', role: 'supervisor', rights: lead, shops: 'content-shops' },
  { jobId: 'job-customer-service-lead', title: '客服组长', role: 'lead', rights: lead, shops: 'content-shops' },
  { jobId: 'job-ai-enablement-engineer', title: 'AI赋能工程师', role: 'engineer', rights: all, shops: 'content-shops' },
  { jobId: 'job-customer-service-agent', title: '普通客服', role: 'agent', rights: agent, shops: 'content-shops' },
  { jobId: 'job-customer-service-seat', title: '客服坐席', role: 'agent', rights: agent, shops: 'content-shops' },
];

const byTitle = new Map<string, JobRosterRow>();
for (const row of JOB_ROSTER) {
  const key = normalizeJobTitle(row.title);
  if (byTitle.has(key)) throw new Error(`duplicate roster title ${row.title}`);
  byTitle.set(key, row);
}

/** Finite tolerance for provider formatting noise; no fuzzy or substring matching. */
export function normalizeJobTitle(title: string): string {
  return title.normalize('NFKC').replace(/\p{White_Space}+/gu, ' ').trim();
}

export function matchJobRoster(
  title: string,
  now: Date = new Date(),
  aliases: readonly JobAlias[] = JOB_ALIASES,
): RosterMatch {
  const name = normalizeJobTitle(title);
  if (name.length === 0) return { status: 'unmatched', reason: 'blank' };
  const canonical = byTitle.get(name);
  if (canonical) return { status: 'matched', row: canonical };
  const instant = now.getTime();
  const named = aliases.filter((alias) => normalizeJobTitle(alias.title) === name);
  const live = named.filter((alias) => {
    const from = Date.parse(alias.validFrom);
    const until = Date.parse(alias.validUntil);
    return Number.isFinite(from) && Number.isFinite(until) && from <= instant && instant < until;
  });
  const jobIds = new Set(live.map((alias) => alias.jobId));
  if (jobIds.size > 1) return { status: 'unmatched', reason: 'ambiguous' };
  if (jobIds.size === 1) {
    const row = JOB_ROSTER.find((item) => item.jobId === live[0]?.jobId);
    return row ? { status: 'matched', row } : { status: 'unmatched', reason: 'unknown' };
  }
  if (named.length > 0) return { status: 'unmatched', reason: 'expired' };
  return { status: 'unmatched', reason: 'unknown' };
}

export type RosterPermissionState = 'unknown' | 'pending' | 'ready' | 'denied' | 'expired' | 'revoked';

function exactKeys(value: object, keys: readonly string[]): value is Record<string, unknown> {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function readPermissionState(value: unknown): RosterPermissionState | null {
  switch (value) {
    case 'unknown':
    case 'pending':
    case 'ready':
    case 'denied':
    case 'expired':
    case 'revoked':
      return value;
    default:
      return null;
  }
}

export const ROSTER_DENIAL_MESSAGE = '没有权限，请找人开通。';
/** An expired facts window needs a refresh, not a person to open access. */
export const FACTS_EXPIRED_MESSAGE = '资料资格过期了，请稍后重试。';
/** `pending` does not distinguish missing grants from unavailable published content. */
export const ROSTER_PENDING_MESSAGE = '查询权限或资料尚未就绪，请联系管理员核对。';

/** The one owner of which sentence a state carries. Pending does not prove a specific cause. */
export function rosterMessageFor(state: RosterPermissionState): string | null {
  if (state === 'ready' || state === 'unknown') return null;
  if (state === 'expired') return FACTS_EXPIRED_MESSAGE;
  if (state === 'pending') return ROSTER_PENDING_MESSAGE;
  return ROSTER_DENIAL_MESSAGE;
}
export function parseRosterJobResponse(value: unknown): {
  title: string;
  directory: readonly { name: string; enabled: boolean }[];
  permission_state: RosterPermissionState;
  message: string | null;
  actions: { query: boolean; import: boolean; publish: boolean; rollback: boolean };
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!exactKeys(value, ['title', 'directory', 'permission_state', 'message', 'actions'])) return null;
  const title = value.title;
  if (typeof title !== 'string' || title.length < 1 || title.length > 64) return null;
  if (!Array.isArray(value.directory)) return null;
  const directory: { name: string; enabled: boolean }[] = [];
  for (const row of value.directory) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    if (!exactKeys(row, ['name', 'enabled'])) return null;
    if (typeof row.name !== 'string' || typeof row.enabled !== 'boolean') return null;
    directory.push({ name: row.name, enabled: row.enabled });
  }
  const permission_state = readPermissionState(value.permission_state);
  if (!permission_state) return null;
  const message = value.message;
  // Exactly the sentence this state owns. An unknown string still fails closed.
  const expectedMessage = rosterMessageFor(permission_state);
  if (message !== expectedMessage) return null;
  const actions = value.actions;
  if (!actions || typeof actions !== 'object' || Array.isArray(actions)) return null;
  if (!exactKeys(actions, ['query', 'import', 'publish', 'rollback'])) return null;
  const flags = actions as Record<string, unknown>;
  if (![flags.query, flags.import, flags.publish, flags.rollback].every((flag) => typeof flag === 'boolean')) return null;
  return {
    title,
    directory,
    permission_state,
    message: expectedMessage,
    actions: {
      query: flags.query as boolean,
      import: flags.import as boolean,
      publish: flags.publish as boolean,
      rollback: flags.rollback as boolean,
    },
  };
}
