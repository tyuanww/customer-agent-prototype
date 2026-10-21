import { createHash } from 'node:crypto';
import type { QueryResult, QueryResultRow } from 'pg';
import { feishuUserId } from './feishu-admit.js';
import { snapshotForOpenId } from './feishu-job-snapshot.js';
import {
  JOB_ROSTER,
  matchJobRoster,
  type RosterPermissionState,
  type parseRosterJobResponse,
} from '@customer-agent/job-roster';

type Queryable = {
  query: <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => Promise<QueryResult<T>>;
};

export const ROSTER_IDENTITY_SCOPE = 'feishu-job-roster';

export type RosterHome = Readonly<{ tenantId: string; appId: string }>;

export function rosterHomeFromEnv(env: Readonly<Record<string, string | undefined>>): RosterHome | null {
  const tenantId = env.ROSTER_TENANT_ID?.trim() ?? '';
  const appId = env.ROSTER_APP_ID?.trim() ?? '';
  if (!tenantId || !appId) return null;
  return { tenantId, appId };
}

export function rosterPrincipalId(openId: string): string {
  return `prin_${createHash('sha256').update(openId).digest('hex').slice(0, 32)}`;
}

const PROJECT_SQL = `SELECT content_intake.project_feishu_roster(
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS status`;

export type RosterProjectionStatus =
  | 'unmatched'
  | 'skipped'
  | 'missing-binding'
  | 'policy-pending'
  | 'registered'
  | 'projected'
  | 'ready'
  | 'pending'
  | 'expired'
  | 'revoked'
  | 'denied';

export const ROSTER_DENIAL_MESSAGE = '没有权限，请找人开通。';

type DatabasePermissionState = 'pending' | 'ready' | 'expired' | 'revoked';

export function rosterPermissionState(status: RosterProjectionStatus): Exclude<RosterPermissionState, 'unknown'> {
  if (status === 'projected' || status === 'ready') return 'ready';
  if (status === 'expired') return 'expired';
  if (status === 'revoked') return 'revoked';
  if (status === 'registered' || status === 'policy-pending' || status === 'pending') return 'pending';
  return 'denied';
}

export type StoredRosterPermission = Readonly<{
  title: string;
  state: Exclude<RosterPermissionState, 'unknown'>;
}>;

const PERMISSION_SQL = `SELECT content_intake.roster_permission_for_user($1) AS state`;

const JOB_ID_SQL = `SELECT facts.job_id
FROM content_intake.principals person
JOIN content_intake.principal_facts facts
  ON facts.principal_id = person.principal_id
 AND facts.facts_version = person.current_facts_version
WHERE person.user_id = $1 AND person.identity_scope = $2`;

function databasePermissionState(value: unknown): DatabasePermissionState | null {
  if (value === 'pending' || value === 'ready' || value === 'expired' || value === 'revoked') return value;
  return null;
}

function snapshotTitleForUser(userId: string): string | null {
  if (!userId.startsWith('usr_')) return null;
  const title = snapshotForOpenId(userId.slice(4))?.title.trim() ?? '';
  return title.length > 0 ? title : null;
}

export type RosterJobResponse = NonNullable<ReturnType<typeof parseRosterJobResponse>>;

export type AuthorizationActions = Readonly<{
  query: boolean;
  import: boolean;
  publish: boolean;
  rollback: boolean;
}>;

export const NO_AUTHORIZATION_ACTIONS: AuthorizationActions = {
  query: false, import: false, publish: false, rollback: false,
};

/** The historical batch chain admits only an owner binding, so advertising import, publish or
 *  rollback to anyone else would offer a button that can only answer 403. `query` stays
 *  grant-based because the candidate path still serves granted seats. */
const ACTION_SQL = `WITH stamp AS (SELECT clock_timestamp() AS at),
person AS (SELECT principal_id, user_id FROM content_intake.principals WHERE user_id = $1 LIMIT 1),
binding AS (SELECT (role = 'owner') AS is_owner FROM backend_identity.subject_bindings
  WHERE user_id = (SELECT user_id FROM person))
SELECT
  COALESCE((SELECT EXISTS (SELECT 1 FROM person, stamp, content_intake.authorization_sources(person.principal_id, 'query', stamp.at))), false) AS query,
  COALESCE((SELECT EXISTS (SELECT 1 FROM binding WHERE is_owner)
    AND EXISTS (SELECT 1 FROM person, stamp, content_intake.authorization_sources(person.principal_id, 'import', stamp.at))), false) AS import,
  COALESCE((SELECT EXISTS (SELECT 1 FROM binding WHERE is_owner)
    AND EXISTS (SELECT 1 FROM person, stamp, content_intake.authorization_sources(person.principal_id, 'publish', stamp.at))), false) AS publish,
  COALESCE((SELECT EXISTS (SELECT 1 FROM binding WHERE is_owner)
    AND EXISTS (SELECT 1 FROM person, stamp, content_intake.authorization_sources(person.principal_id, 'rollback', stamp.at))), false) AS rollback`;

export async function readAuthorizationActions(client: Queryable, userId: string): Promise<AuthorizationActions> {
  const found = await client.query<AuthorizationActions>(ACTION_SQL, [userId]);
  const row = found.rows[0];
  if (!row) return NO_AUTHORIZATION_ACTIONS;
  return { query: row.query, import: row.import, publish: row.publish, rollback: row.rollback };
}

export function composeRosterJob(
  snapshot: { readonly title: string; readonly directory: readonly { readonly name: string; readonly enabled: boolean }[]; readonly permissionState?: RosterPermissionState } | null,
  stored: StoredRosterPermission | null,
  databaseBacked: boolean,
  actions: AuthorizationActions = NO_AUTHORIZATION_ACTIONS,
): RosterJobResponse | null {
  if (!stored && !snapshot) return null;
  const title = stored?.title ?? snapshot!.title;
  if (title.length < 1 || title.length > 64) return null;
  const permissionState: RosterPermissionState = stored
    ? stored.state
    : databaseBacked
      ? 'denied'
      : snapshot?.permissionState ?? 'unknown';
  return {
    title,
    directory: (snapshot?.directory ?? [{ name: title, enabled: true }]).map((row) => ({
      name: row.name,
      enabled: row.enabled,
    })),
    permission_state: permissionState,
    message: permissionState === 'ready' || permissionState === 'unknown' ? null : ROSTER_DENIAL_MESSAGE,
    actions,
  };
}

async function rosterPermissionForUser(client: Queryable, userId: string): Promise<DatabasePermissionState | null> {
  const found = await client.query<{ state: string | null }>(PERMISSION_SQL, [userId]);
  return databasePermissionState(found.rows[0]?.state);
}

export async function readStoredRosterPermission(
  client: Queryable,
  userId: string,
): Promise<StoredRosterPermission | null> {
  const state = await rosterPermissionForUser(client, userId);
  if (!state) return null;
  const facts = await client.query<{ job_id: string }>(JOB_ID_SQL, [userId, ROSTER_IDENTITY_SCOPE]);
  const jobId = facts.rows[0]?.job_id;
  const rosterTitle = jobId === undefined ? undefined : JOB_ROSTER.find((item) => item.jobId === jobId)?.title;
  if (rosterTitle) return { title: rosterTitle, state };
  const snapshotTitle = snapshotTitleForUser(userId);
  if (!snapshotTitle) return null;
  return { title: snapshotTitle, state: 'denied' };
}

export function rosterPreparation(status: RosterProjectionStatus): {
  state: Exclude<RosterPermissionState, 'unknown'>;
  reason: RosterProjectionStatus;
  message: string | null;
} {
  const state = rosterPermissionState(status);
  return { state, reason: status, message: state === 'ready' ? null : ROSTER_DENIAL_MESSAGE };
}

function selectedHome(
  rows: readonly { tenant_id: string; app_id: string }[],
  trustedHome: RosterHome | null,
): RosterHome | null {
  if (rows.length > 1) return null;
  if (rows.length === 1) {
    const row = rows[0]!;
    if (trustedHome && (row.tenant_id !== trustedHome.tenantId || row.app_id !== trustedHome.appId)) return null;
    return { tenantId: row.tenant_id, appId: row.app_id };
  }
  return trustedHome;
}

export async function projectRosterLogin(
  client: Queryable,
  openId: string,
  trustedHome: RosterHome | null = null,
): Promise<RosterProjectionStatus> {
  const snapshot = snapshotForOpenId(openId);
  if (!snapshot) return 'unmatched';
  const match = matchJobRoster(snapshot.title);
  if (match.status !== 'matched') return 'unmatched';
  const homes = await client.query<{ tenant_id: string; app_id: string }>(
    `SELECT tenant_id, app_id FROM content_intake.principals
     UNION
     SELECT tenant_id, app_id FROM content_intake.policy_versions`);
  const home = selectedHome(homes.rows, trustedHome);
  if (!home) return 'skipped';
  if (!snapshot.departmentIds?.length || snapshot.departed === true) {
    await client.query(
      'SELECT content_intake.withdraw_roster_query($1,$2,$3) AS status',
      [rosterPrincipalId(openId), home.tenantId, home.appId],
    );
    const state = await rosterPermissionForUser(client, feishuUserId(openId));
    if (state) return state;
    if (snapshot.departed === true) return 'unmatched';
    return 'denied';
  }
  const projected = await client.query<{ status: string }>(PROJECT_SQL, [
    rosterPrincipalId(openId),
    feishuUserId(openId),
    home.tenantId,
    home.appId,
    ROSTER_IDENTITY_SCOPE,
    openId,
    snapshot.departmentIds,
    match.row.jobId,
    match.row.role,
    // Login may prepare the automatic query path only. publish/import remain
    // explicit grants and are never derived from the desktop rights table.
    ['query'],
  ]);
  const status = projected.rows[0]?.status;
  if (status === 'policy-pending') return 'policy-pending';
  if (status === 'missing') return 'missing-binding';
  if (status !== 'registered') return 'skipped';
  const issued = await client.query<{ status: string }>(
    'SELECT content_intake.issue_roster_query($1,$2,$3) AS status',
    [rosterPrincipalId(openId), home.tenantId, home.appId],
  );
  const issuedStatus = issued.rows[0]?.status;
  if (issuedStatus === 'projected' || issuedStatus === 'expired' || issuedStatus === 'revoked') return issuedStatus;
  return 'registered';
}
