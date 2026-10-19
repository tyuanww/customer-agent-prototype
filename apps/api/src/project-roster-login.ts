import { createHash } from 'node:crypto';
import type { QueryResult, QueryResultRow } from 'pg';
import { feishuUserId } from './feishu-admit.js';
import { snapshotForOpenId } from './feishu-job-snapshot.js';
import { matchJobRoster, rosterJobId } from './job-roster.js';

type Queryable = {
  query: <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => Promise<QueryResult<T>>;
};

export const ROSTER_IDENTITY_SCOPE = 'feishu-job-roster';
export const LOGIN_UNASSIGNED_DEPARTMENT = 'dept-login-unassigned';

export function rosterPrincipalId(openId: string): string {
  return `prin_${createHash('sha256').update(openId).digest('hex').slice(0, 32)}`;
}

const PROJECT_SQL = `SELECT content_intake.project_feishu_roster(
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS status`;

export type RosterProjectionStatus = 'unmatched' | 'skipped' | 'missing-binding' | 'policy-pending' | 'registered' | 'projected';

export const ROSTER_DENIAL_MESSAGE = '没有权限，请找人开通。';

export function rosterPermissionState(status: RosterProjectionStatus): 'pending' | 'ready' | 'denied' {
  if (status === 'projected') return 'ready';
  if (status === 'registered' || status === 'policy-pending') return 'pending';
  return 'denied';
}

export function rosterPreparation(status: RosterProjectionStatus): {
  state: 'pending' | 'ready' | 'denied';
  reason: RosterProjectionStatus;
  message: string | null;
} {
  const state = rosterPermissionState(status);
  return { state, reason: status, message: state === 'ready' ? null : ROSTER_DENIAL_MESSAGE };
}

export async function projectRosterLogin(client: Queryable, openId: string): Promise<RosterProjectionStatus> {
  const snapshot = snapshotForOpenId(openId);
  if (!snapshot) return 'unmatched';
  const match = matchJobRoster(snapshot.title);
  if (match.status !== 'matched') return 'unmatched';
  const homes = await client.query<{ tenant_id: string; app_id: string }>(
    `SELECT tenant_id, app_id FROM content_intake.principals
     UNION
     SELECT tenant_id, app_id FROM content_intake.policy_versions`);
  if (homes.rows.length !== 1) return 'skipped';
  const home = homes.rows[0]!;
  const projected = await client.query<{ status: string }>(PROJECT_SQL, [
    rosterPrincipalId(openId),
    feishuUserId(openId),
    home.tenant_id,
    home.app_id,
    ROSTER_IDENTITY_SCOPE,
    openId,
    snapshot.departmentIds?.length ? snapshot.departmentIds : [LOGIN_UNASSIGNED_DEPARTMENT],
    rosterJobId(match.row),
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
    [rosterPrincipalId(openId), home.tenant_id, home.app_id],
  );
  return issued.rows[0]?.status === 'projected' ? 'projected' : 'registered';
}
