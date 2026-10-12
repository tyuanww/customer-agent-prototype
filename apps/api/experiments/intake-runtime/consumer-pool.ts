import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IntakePool } from '../../src/content-intake/transaction.js';

// One offline compatibility seam, not a SQL router. All business rules, actor
// WeakMap identity and transaction certainty handling stay in their actual modules.
const TRANSACTION_SHA = '8464bc5dcb0b7cb4d025940b2d6f505fe58bf369bb82f34385963f2ed4a1436e';
const SESSION_SQL = `SELECT s.expires_at
    FROM backend_identity.sessions s JOIN backend_identity.subject_bindings b USING(binding_id)
    WHERE s.token_hash=$1 AND b.user_id=$2 AND b.enabled AND s.revoked_at IS NULL
      AND s.expires_at>clock_timestamp() FOR SHARE OF s,b`;
export function assertConsumerSource(source: string): void {
  if (createHash('sha256').update(source).digest('hex') !== TRANSACTION_SHA || source.split(SESSION_SQL).length !== 2) {
    throw new Error('CONSUMER_TRANSACTION_DRIFT');
  }
}

/** Borrowed pool; never changes credentials, roles, lifecycle, parameters or any
 * other SQL. Source drift rejects before returning an adapter. The consumer owns
 * its rejection class, so built and source modules cannot split error identity. */
export async function createSyntheticConsumerPool(pool: IntakePool, sessionUnavailable: () => Error, schema: 'intake_runtime_probe' | 'intake_runtime' = 'intake_runtime_probe'): Promise<IntakePool> {
  if (!['intake_runtime_probe', 'intake_runtime'].includes(schema)) throw new Error('CONSUMER_LOCK_SCHEMA');
  assertConsumerSource(await readFile(new URL('../../src/content-intake/transaction.ts', import.meta.url), 'utf8'));
  return { connect: async () => {
    const client = await pool.connect();
    return new Proxy(client, { get(target, key) {
      if (key !== 'query') {
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (sql: string, params?: unknown[]) => {
        if (sql !== SESSION_SQL) return target.query(sql, params);
        try { return await target.query(`SELECT ${schema}.lock_product_session($1,$2) AS expires_at`, params); }
        catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ZA003' && error.message === 'SESSION_UNAVAILABLE') {
            throw sessionUnavailable();
          }
          throw error;
        }
      };
    } });
  } };
}

/** Validate the borrowed connection's purpose before the synthetic harness wires
 * it to a service. This identity check is not certification of the whole ACL. */
export async function verifyConsumerPurpose(pool: IntakePool, purpose: 'business' | 'usage' | 'worker' | 'org_writer'): Promise<void> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ valid: boolean }>(`SELECT session_user=$1 AND current_user=$1
      AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolinherit)
      AND NOT pg_has_role(current_user,'intake_runtime_fn_owner','member')
      AND NOT has_column_privilege(current_user,(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='backend_identity' AND c.relname='sessions'),'revoked_at','UPDATE')
      AND NOT has_column_privilege(current_user,(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='backend_identity' AND c.relname='subject_bindings'),'enabled','UPDATE') AS valid
      FROM pg_roles r WHERE r.rolname=current_user`, [`intake_${purpose}`]);
    if (result.rows[0]?.valid !== true) throw new Error('CONSUMER_PURPOSE_MISMATCH');
  } finally { client.release(); }
}
