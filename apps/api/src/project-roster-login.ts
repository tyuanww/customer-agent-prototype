import { createHash } from 'node:crypto';
import type { QueryResult, QueryResultRow } from 'pg';
import { bindKnownPrincipal, PRINCIPAL_BINDING_CONFLICT } from './content-intake/bind-known-principal.js';
import { feishuUserId } from './feishu-admit.js';
import { matchJobRoster } from './job-roster.js';

type Queryable = {
  query: <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => Promise<QueryResult<T>>;
};

export const ROSTER_IDENTITY_SCOPE = 'feishu-job-roster';
export const LOGIN_UNASSIGNED_DEPARTMENT = 'dept-login-unassigned';
export const LOGIN_UNASSIGNED_JOB = 'job-login-unassigned';

export function rosterPrincipalId(openId: string): string {
  return `prin_${createHash('sha256').update(openId).digest('hex').slice(0, 32)}`;
}

const GRANT_SQL = `INSERT INTO content_intake.grants(
  grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
  starts_at, expires_at, reason, steward_id, parent_grant_id)
SELECT left('grant_' || encode(sha256(convert_to($1 || g.scope_id, 'UTF8')), 'hex'), 40),
  'business', g.issuer_id, $1, g.tenant_id, g.app_id, g.scope_id, NULL, 'query',
  clock_timestamp(), g.expires_at, '职位名单投影。', g.steward_id, g.grant_id
FROM content_intake.grants g
WHERE g.tenant_id = $2 AND g.app_id = $3 AND g.action = 'query' AND g.revoked_at IS NULL
  AND g.expires_at > clock_timestamp() AND g.issuer_id <> $1
  AND EXISTS (SELECT 1 FROM content_intake.sources s WHERE s.scope_id = g.scope_id AND s.tenant_id = g.tenant_id AND s.app_id = g.app_id)
  AND NOT EXISTS (
    SELECT 1 FROM content_intake.grants existing
    WHERE existing.recipient_id = $1 AND existing.scope_id = g.scope_id AND existing.action = 'query'
      AND existing.revoked_at IS NULL AND existing.expires_at > clock_timestamp())`;

export async function projectRosterLogin(client: Queryable, openId: string, title: string): Promise<'unmatched' | 'skipped' | 'missing-binding' | 'projected'> {
  const match = matchJobRoster(title);
  if (match.status !== 'matched') return 'unmatched';
  const homes = await client.query<{ tenant_id: string; app_id: string }>(
    'SELECT DISTINCT tenant_id, app_id FROM content_intake.principals');
  if (homes.rows.length !== 1) return 'skipped';
  const home = homes.rows[0]!;
  try {
    const bound = await bindKnownPrincipal(client, {
      principalId: rosterPrincipalId(openId),
      userId: feishuUserId(openId),
      tenantId: home.tenant_id,
      appId: home.app_id,
      identityScope: ROSTER_IDENTITY_SCOPE,
      personKey: openId,
      departmentIds: [LOGIN_UNASSIGNED_DEPARTMENT],
      jobId: LOGIN_UNASSIGNED_JOB,
    });
    if (bound !== 'bound') return 'missing-binding';
  } catch (error) {
    if (error instanceof Error && error.message === PRINCIPAL_BINDING_CONFLICT) return 'skipped';
    throw error;
  }
  if (match.row.actions.search && match.row.shops === 'content-shops') {
    await client.query(GRANT_SQL, [rosterPrincipalId(openId), home.tenant_id, home.app_id]);
  }
  return 'projected';
}
