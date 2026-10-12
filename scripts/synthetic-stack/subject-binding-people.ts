import { createHash } from 'node:crypto';
import type { SeatPeople, SeatPerson } from './seat-accounts.ts';

export type Sql = {
  query(text: string, values?: unknown[]): Promise<{ rowCount: number | null; rows: readonly Record<string, unknown>[] }>;
};

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

async function protect<T>(sql: Sql, command: () => Promise<T>, failed: T): Promise<T> {
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
        const result = await sql.query(
          `INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
           VALUES ($1,'synthetic','synthetic-tenant',$2,$3,$4,true,'agent')`,
          [person.bindingId, person.displayName, person.userId, hash(person.bindingId)],
        );
        if (result.rowCount !== 1) return FAILED;
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
           WHERE provider='synthetic' AND tenant='synthetic-tenant' AND role='agent'
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
