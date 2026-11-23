import { readFileSync, realpathSync } from 'node:fs';
import type { Client } from 'pg';
import { verifyDatabaseMigrations } from '../../dist/index.js';
import type { Pg15Harness } from '../../dist/testkit/index.js';
import { verifySopCandidateContractSet } from '../../../../scripts/sop-candidate-contract.mjs';

type HarnessIdentity = {
  db: string;
  data: string;
  role: string;
  socket_only: boolean;
  tcp_addresses: string;
  pg_major: number;
};

/** Installs into the caller's started, disposable PG15 harness after verifying the complete product catalogue. */
export async function installSopCandidateSyntheticStorage(
  client: Client, harness: Pick<Pg15Harness, 'owner' | 'data'>,
): Promise<void> {
  const { rows: [identity] } = await client.query<HarnessIdentity>(`
    SELECT current_database() AS db, current_setting('data_directory') AS data,
      current_user AS role, inet_server_addr() IS NULL AS socket_only,
      current_setting('listen_addresses') AS tcp_addresses,
      current_setting('server_version_num')::integer / 10000 AS pg_major
  `);
  if (!identity || !/^dev_m0_[a-z0-9_]+_[0-9a-f]{8}$/.test(identity.db)
    || identity.role !== harness.owner || identity.pg_major !== 15 || !identity.socket_only
    || identity.tcp_addresses !== '' || realpathSync(identity.data) !== realpathSync(harness.data)) {
    throw new Error('W5 candidate storage requires the caller’s disposable PostgreSQL 15 harness');
  }

  const { storageSql } = verifySopCandidateContractSet();
  const entrypoints = readFileSync(new URL('./entrypoints.sql', import.meta.url), 'utf8');
  await client.query('BEGIN');
  try {
    await verifyDatabaseMigrations(client);
    await client.query(storageSql);
    await client.query(entrypoints);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
