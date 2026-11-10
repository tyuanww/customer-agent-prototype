import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Client } from 'pg';
import { verifyMigrationPrefix } from '../../dist/testkit/index.js';

/** Never called by the product runner. Requires the disposable PG15 harness identity and socket. */
export async function installSopQueryCandidate(client: Client): Promise<void> {
  const identity = await client.query<{ db: string; user_name: string; address: string | null; major: number }>(
    `SELECT current_database() AS db,current_user AS user_name,inet_server_addr()::text AS address,
      current_setting('server_version_num')::integer/10000 AS major`);
  const current = identity.rows[0]!;
  if (process.env.CUSTOMER_AGENT_SOP_QUERY_CANDIDATE !== '1'
    || !/^dev_m0_sop_query_[0-9a-f]{8}$/.test(current.db) || current.user_name !== 'gate_owner'
    || current.address !== null || current.major !== 15) throw new Error('SOP candidate is restricted to disposable PG15 tests');
  await verifyMigrationPrefix(client, 83);
  const manifest = JSON.parse(readFileSync(new URL('./manifest.generated.json', import.meta.url), 'utf8')) as {
    predecessor: { id: string; sha256: string }; sha256: string;
  };
  const rows = await client.query<{ migration_id: string; migration_sha256: string }>(
    'SELECT migration_id,migration_sha256 FROM customer_agent_meta.schema_migrations ORDER BY position');
  if (rows.rowCount !== 83 || rows.rows.at(-1)?.migration_id !== manifest.predecessor.id
    || rows.rows.at(-1)?.migration_sha256 !== manifest.predecessor.sha256) throw new Error('SOP candidate predecessor mismatch');
  const sql = readFileSync(new URL('./candidate.generated.sql', import.meta.url), 'utf8');
  if (createHash('sha256').update(sql).digest('hex') !== manifest.sha256) throw new Error('SOP candidate digest mismatch');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
