import { Client } from 'pg';
import { DatabaseMigrationError } from './errors.js';
import type { DatabaseClient } from './types.js';

const activeMigrationClients = new WeakSet<Client>();

function assertDatabaseClient(value: unknown): asserts value is DatabaseClient {
  if (!(value instanceof Client)) {
    throw new DatabaseMigrationError(
      'MIGRATION_CLIENT_INVALID',
      'Database migration operations require one connected pg.Client or checked-out PoolClient session',
    );
  }
}

/** Keep every public operation on one real session and reject re-entrant use of that session. */
export function withExclusiveDatabaseClient<Result>(
  client: DatabaseClient,
  operation: (client: DatabaseClient) => Promise<Result>,
): Promise<Result> {
  assertDatabaseClient(client);
  if (activeMigrationClients.has(client)) {
    throw new DatabaseMigrationError(
      'MIGRATION_CLIENT_BUSY',
      'Database migration session already has an active control-plane operation',
    );
  }
  activeMigrationClients.add(client);
  try {
    return operation(client).finally(() => activeMigrationClients.delete(client));
  } catch (error) {
    activeMigrationClients.delete(client);
    throw error;
  }
}
