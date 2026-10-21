import { createHash } from 'node:crypto';
import { bindKnownPrincipal } from '../../apps/api/src/content-intake/bind-known-principal.ts';
import type { SeatPeople, SeatPerson } from './seat-accounts.ts';

export type Sql = {
  query(text: string, values?: unknown[]): Promise<{ rowCount: number | null; rows: readonly Record<string, unknown>[] }>;
};

/** The seat lives in the same intake home the stack's test identities use. A seat gets a
 *  principal and a role rule so a grant can take effect; it gets no grant, because the
 *  scope and source a seat may reach is the operator's decision, not the create form's. */
const INTAKE_TENANT = 'tenant-menokin';
const INTAKE_APP = 'app-customer-agent';
const DEPARTMENT = 'dept-menokin';

/** Job and session role per post. 客服主管 needs the supervisor band to receive the actions
 *  its post names; 客服 stays at the query-only band. */
const POST_BINDING = Object.freeze({
  客服: { jobId: 'job-seat', role: 'agent', sessionRole: 'agent' },
  客服主管: { jobId: 'job-seat-supervisor', role: 'supervisor', sessionRole: 'coach' },
} as const);

const FAILED = { ok: false, error: 'person-write-failed' } as const;
const MISSING = { ok: false, error: 'missing-person' } as const;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

async function openSavepoint(sql: Sql): Promise<'open' | 'direct' | 'closed'> {
  try {
    await sql.query('SAVEPOINT seat_person');
    return 'open';
  } catch (error) {
    return postgresCode(error) === '25P01' ? 'direct' : 'closed';
  }
}

async function undoSavepoint(sql: Sql): Promise<void> {
  try {
    await sql.query('ROLLBACK TO SAVEPOINT seat_person');
    await sql.query('RELEASE SAVEPOINT seat_person');
  } catch {
    return;
  }
}

async function protect<T, F>(sql: Sql, command: () => Promise<T>, failed: F): Promise<T | F> {
  const marker = await openSavepoint(sql);
  if (marker === 'closed') return failed;
  try {
    const value = await command();
    if (marker === 'open') await sql.query('RELEASE SAVEPOINT seat_person');
    return value;
  } catch {
    if (marker === 'open') await undoSavepoint(sql);
    return failed;
  }
}

export function createSubjectBindingPeople(sql: Sql): SeatPeople {
  return {
    insert(person: SeatPerson) {
      return protect(sql, async () => {
        const binding = POST_BINDING[person.post];
        const result = await sql.query(
          `INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
           VALUES ($1,'synthetic','synthetic-tenant',$2,$3,$4,true,$5)`,
          [person.bindingId, person.displayName, person.userId, hash(person.bindingId), binding.sessionRole],
        );
        if (result.rowCount !== 1) return FAILED;
        // Without a principal and a role rule no grant can ever authorize this seat:
        // authorization_deadline joins role_rules, so a binding alone is a dead account.
        // `bindKnownPrincipal` reads only `rows`, so this adapter is the whole surface the
        // seat writer has to satisfy.
        const bound = await bindKnownPrincipal({
          query: <T extends Record<string, unknown>>(text: string, params?: unknown[]) =>
            sql.query(text, params).then((result) => ({ rows: result.rows as readonly T[] })),
        }, {
          principalId: person.bindingId, userId: person.userId,
          tenantId: INTAKE_TENANT, appId: INTAKE_APP,
          identityScope: 'confirmed-synthetic', personKey: person.bindingId,
          departmentIds: [DEPARTMENT], jobId: binding.jobId,
        });
        if (bound !== 'bound') return FAILED;
        await sql.query(
          `INSERT INTO content_intake.role_rules(tenant_id,app_id,department_id,job_id,policy_version,role)
           VALUES ($1,$2,$3,$4,1,$5) ON CONFLICT DO NOTHING`,
          [INTAKE_TENANT, INTAKE_APP, DEPARTMENT, binding.jobId, binding.role],
        );
        return { ok: true as const };
      }, FAILED);
    },
    remove(bindingId) {
      return protect(sql, async () => {
        const result = await sql.query(
          `DELETE FROM backend_identity.subject_bindings
           WHERE binding_id=$1 AND provider='synthetic' AND tenant='synthetic-tenant'`,
          [bindingId],
        );
        if (result.rowCount !== 1) return FAILED;
        return { ok: true as const };
      }, FAILED);
    },
    disable(bindingId) {
      return protect(sql, async () => {
        const result = await sql.query(
          `UPDATE backend_identity.subject_bindings SET enabled=false
           WHERE binding_id=$1 AND provider='synthetic' AND tenant='synthetic-tenant'`,
          [bindingId],
        );
        if (result.rowCount !== 1) return MISSING;
        return { ok: true as const };
      }, FAILED);
    },
    find(bindingId) {
      return protect(sql, async () => {
        const result = await sql.query(
          `SELECT binding_id FROM backend_identity.subject_bindings WHERE binding_id=$1`,
          [bindingId],
        );
        if (result.rows.length !== 1) return MISSING;
        return { ok: true as const };
      }, FAILED);
    },
    list() {
      return protect(sql, async () => {
        const result = await sql.query(
          `SELECT binding_id, subject, enabled
           FROM backend_identity.subject_bindings
           WHERE provider='synthetic' AND tenant='synthetic-tenant'
             AND role IN ('agent','coach')
           ORDER BY binding_id`,
        );
        const people: { displayName: string; bindingId: string; enabled: boolean }[] = [];
        for (const row of result.rows) {
          const bindingId = row.binding_id;
          const displayName = row.subject;
          const enabled = row.enabled;
          if (typeof bindingId !== 'string' || typeof displayName !== 'string' || typeof enabled !== 'boolean') continue;
          people.push({ displayName, bindingId, enabled });
        }
        return { ok: true as const, people };
      }, FAILED);
    },
  };
}
