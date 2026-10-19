import { createHash } from 'node:crypto';
import type { QueryResult, QueryResultRow } from 'pg';
import { feishuUserId } from './feishu-admit.js';
import { snapshotForOpenId } from './feishu-job-snapshot.js';
import { matchJobRoster, rosterGrantActions, rosterJobId } from './job-roster.js';

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

export async function projectRosterLogin(client: Queryable, openId: string): Promise<'unmatched' | 'skipped' | 'missing-binding' | 'registered' | 'projected'> {
  const snapshot = snapshotForOpenId(openId);
  if (!snapshot) return 'unmatched';
  const match = matchJobRoster(snapshot.title);
  if (match.status !== 'matched') return 'unmatched';
  const homes = await client.query<{ tenant_id: string; app_id: string }>(
    'SELECT DISTINCT tenant_id, app_id FROM content_intake.principals');
  if (homes.rows.length !== 1) return 'skipped';
  const home = homes.rows[0]!;
  const projected = await client.query<{ status: string }>(PROJECT_SQL, [
    rosterPrincipalId(openId),
    feishuUserId(openId),
    home.tenant_id,
    home.app_id,
    ROSTER_IDENTITY_SCOPE,
    openId,
    [LOGIN_UNASSIGNED_DEPARTMENT],
    rosterJobId(match.row.role),
    match.row.role,
    match.row.shops === 'content-shops' ? rosterGrantActions(match.row.rights) : [],
  ]);
  const status = projected.rows[0]?.status;
  if (status === 'projected' || status === 'registered') return status;
  if (status === 'missing') return 'missing-binding';
  return 'skipped';
}
