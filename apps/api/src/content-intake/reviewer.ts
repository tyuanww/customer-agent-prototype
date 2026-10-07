import type { components } from '@customer-agent/contracts';
import type { HumanDecision } from './approval-adapter.js';
import type { Source } from './authority.js';
import { IntakeRejection, type IntakeTransaction } from './transaction.js';

/** Critical human decisions require a proven different person, including aliases.
 * Used by both native-approval verification and internal quality checks. */
export async function requireIndependentReviewer(client: IntakeTransaction,
  material: { risk: Pick<components['schemas']['IntakeMaterial']['risk'], 'level'>; contributors: string[] }, person: { identity_scope: string; person_key: string }): Promise<void> {
  if (material.risk.level === 'critical') {
    const contributors = await client.query<{ identity_scope: string; person_key: string }>(
      'SELECT identity_scope,person_key FROM content_intake.principals WHERE principal_id=ANY($1::text[])', [material.contributors]);
    // Different, unlinked identity namespaces do not prove a different person.
    if (contributors.rows.length !== material.contributors.length || contributors.rows.some(c =>
      c.identity_scope !== person.identity_scope || c.person_key === person.person_key)) throw new IntakeRejection('HUMAN_REVIEW_REQUIRED');
  }
}

/** Proves eligibility at the human decision time from append-only history.
 * Current publish eligibility is checked separately; a later grant or role change
 * cannot retroactively qualify an earlier PASS, nor erase valid historical proof.
 * Positive role/grant authority must predate the committed review-package checkpoint:
 * history timestamps alone cannot prove when an authorization transaction committed. */
export async function historicalReviewer(client: IntakeTransaction, src: Source,
  material: { risk: Pick<components['schemas']['IntakeMaterial']['risk'], 'level'>; contributors: string[] }, human: HumanDecision, checkedAt: string, authorityCheckpoint: string,
): Promise<{ id: string; factsVersion: number }> {
  if (Date.parse(human.decidedAt) > Date.parse(checkedAt)) throw new IntakeRejection('HUMAN_REVIEW_REQUIRED');
  const people = await client.query<{ principal_id: string; identity_scope: string; person_key: string }>(
    `SELECT principal_id,identity_scope,person_key FROM content_intake.principals
      WHERE tenant_id=$1 AND app_id=$2 AND identity_scope=$3 AND person_key=$4`,
    [src.scope.tenantId, src.scope.appId, human.identityScope, human.personKey]);
  const person = people.rows[0];
  if (!person) throw new IntakeRejection('HUMAN_REVIEW_REQUIRED');
  await requireIndependentReviewer(client, material, person);
  // Provider decisions have millisecond precision, while history has microseconds.
  // A qualification transition inside that same millisecond is ambiguous: fail
  // closed instead of selecting the earlier, potentially more privileged state.
  const result = await client.query<{ facts_version: string }>(`WITH facts AS (
      SELECT * FROM content_intake.principal_facts WHERE principal_id=$1 AND checked_at<=$2
        ORDER BY facts_version DESC LIMIT 1
    ), latest_roles AS (
      SELECT DISTINCT ON (coalesce(after_record,before_record)->>'department_id',coalesce(after_record,before_record)->>'job_id') after_record,recorded_at
      FROM content_intake.role_rule_history
      WHERE coalesce(after_record,before_record)->>'tenant_id'=$3 AND coalesce(after_record,before_record)->>'app_id'=$4
        AND recorded_at<=$2 ORDER BY coalesce(after_record,before_record)->>'department_id',
        coalesce(after_record,before_record)->>'job_id',recorded_at DESC,event_id DESC
    ), roles AS (
      SELECT r.after_record->>'role' AS role,r.recorded_at FROM latest_roles r CROSS JOIN facts f
      WHERE r.after_record->>'department_id'=ANY(f.department_ids) AND r.after_record->>'job_id'=f.job_id
    ), latest_grants AS (
      SELECT DISTINCT ON (grant_id) grant_id,record FROM content_intake.grant_history WHERE recorded_at<=$2 ORDER BY grant_id,version DESC
    ) SELECT f.facts_version FROM facts f WHERE f.enabled AND $2::timestamptz+interval '1 millisecond'<=f.valid_until
      AND $2::timestamptz>=$7::timestamptz
      AND NOT EXISTS (SELECT 1 FROM content_intake.principal_facts next WHERE next.principal_id=$1
        AND next.facts_version>f.facts_version AND next.checked_at>$2 AND next.checked_at<$2::timestamptz+interval '1 millisecond')
      AND NOT EXISTS (SELECT 1 FROM content_intake.role_rule_history h
        WHERE coalesce(h.after_record,h.before_record)->>'tenant_id'=$3 AND coalesce(h.after_record,h.before_record)->>'app_id'=$4
          AND coalesce(h.after_record,h.before_record)->>'job_id'=f.job_id
          AND coalesce(h.after_record,h.before_record)->>'department_id'=ANY(f.department_ids)
          AND h.recorded_at>$2 AND h.recorded_at<$2::timestamptz+interval '1 millisecond')
      AND NOT EXISTS (SELECT 1 FROM content_intake.grant_history h WHERE h.record->>'recipient_id'=$1
        AND h.record->>'action'='review' AND h.recorded_at>$2 AND h.recorded_at<$2::timestamptz+interval '1 millisecond')
      AND (SELECT count(DISTINCT role)=1 AND min(role)<>'agent' AND bool_and(recorded_at<=$7::timestamptz) FROM roles)
      AND EXISTS (SELECT 1 FROM latest_grants g JOIN content_intake.grant_history birth ON birth.grant_id=g.grant_id AND birth.version=1
        WHERE birth.recorded_at<=$7::timestamptz AND g.record->>'recipient_id'=$1
        AND g.record->>'tenant_id'=$3 AND g.record->>'app_id'=$4 AND g.record->>'scope_id'=$5
        AND (g.record->>'source_id' IS NULL OR g.record->>'source_id'=$6)
        AND g.record->>'kind'='business' AND g.record->>'action'='review'
        AND (g.record->>'starts_at')::timestamptz<=$2 AND $2::timestamptz+interval '1 millisecond'<=(g.record->>'expires_at')::timestamptz
        AND (g.record->>'revoked_at' IS NULL OR $2::timestamptz+interval '1 millisecond'<=(g.record->>'revoked_at')::timestamptz))`,
  [person.principal_id, human.decidedAt, src.scope.tenantId, src.scope.appId, src.scopeId, src.scope.sourceId,authorityCheckpoint]);
  if (!result.rows[0]) throw new IntakeRejection('HUMAN_REVIEW_REQUIRED');
  return { id: person.principal_id, factsVersion: Number(result.rows[0].facts_version) };
}
