import { createHash } from 'node:crypto';
import type { QueryResult, QueryResultRow } from 'pg';

type Queryable = {
  query: <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => Promise<QueryResult<T>>;
};

export type KnownPrincipalBind = {
  principalId: string;
  userId: string;
  tenantId: string;
  appId: string;
  identityScope: string;
  personKey: string;
  departmentIds: string[];
  jobId: string;
};

export const PRINCIPAL_BINDING_CONFLICT = 'PRINCIPAL_BINDING_CONFLICT';

/** Trusted, currently unconnected registration helper; writes no grant.
 * Intake tenantId is not the login tenant. Only an enabled subject binding and an
 * identical principal/user/tenant/app/scope/person tuple may refresh the facts.
 * One statement supports both autocommit and a caller-owned transaction; it never
 * begins, commits or retries that transaction. On a database constraint error the
 * caller must roll back before continuing (the original error remains in cause).
 * Observation freshness and disabled-state serialization belong to the future
 * trusted registrar; a five-minute local fact is not proof of a fresh observation. */
export async function bindKnownPrincipal(client: Queryable, input: KnownPrincipalBind): Promise<'bound' | 'missing'> {
  const digest = createHash('sha256').update(JSON.stringify({
    principalId: input.principalId,
    userId: input.userId,
    tenantId: input.tenantId,
    appId: input.appId,
    identityScope: input.identityScope,
    personKey: input.personKey,
    departmentIds: input.departmentIds,
    jobId: input.jobId,
  })).digest('hex');
  const params = [
    input.principalId, input.userId, input.tenantId, input.appId, input.identityScope, input.personKey,
    input.departmentIds, input.jobId, digest,
  ];
  try {
    const result = await client.query<{ known: boolean; bound: boolean }>(`
      WITH known AS (
        SELECT user_id FROM backend_identity.subject_bindings
        WHERE user_id = $2 AND enabled
        LIMIT 1
      ), stamp AS (
        SELECT clock_timestamp() AS checked_at
      ), versioned AS (
        INSERT INTO content_intake.principals AS person (
          principal_id, user_id, tenant_id, app_id, identity_scope, person_key, current_facts_version
        )
        SELECT $1, known.user_id, $3, $4, $5, $6, 1 FROM known
        ON CONFLICT (principal_id) DO UPDATE
        SET current_facts_version = person.current_facts_version + 1
        WHERE person.user_id = EXCLUDED.user_id
          AND person.tenant_id = EXCLUDED.tenant_id AND person.app_id = EXCLUDED.app_id
          AND person.identity_scope = EXCLUDED.identity_scope AND person.person_key = EXCLUDED.person_key
        RETURNING principal_id, current_facts_version
      ), written AS (
        INSERT INTO content_intake.principal_facts (
          principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest
        )
        SELECT versioned.principal_id, versioned.current_facts_version, $7::text[], $8, true, stamp.checked_at,
          stamp.checked_at + interval '5 minutes', $9
        FROM versioned CROSS JOIN stamp
        RETURNING principal_id
      )
      SELECT EXISTS(SELECT 1 FROM known) AS known, EXISTS(SELECT 1 FROM written) AS bound
    `, params);
    const state = result.rows[0];
    if (state?.bound) return 'bound';
    if (state?.known) throw new Error(PRINCIPAL_BINDING_CONFLICT);
    return 'missing';
  } catch (error) {
    if (isIdentityConflict(error)) throw new Error(PRINCIPAL_BINDING_CONFLICT, { cause: error });
    throw error;
  }
}

const identityConstraints = new Set([
  'principals_user_id_key',
  'principals_principal_id_user_id_key',
  'principals_tenant_id_app_id_identity_scope_person_key_key',
]);

function isIdentityConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const failure = error as { code?: string; constraint?: string };
  return failure.code === '23505' && identityConstraints.has(failure.constraint ?? '');
}
