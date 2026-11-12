import { Client, Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyAppliedDatabaseMigrations } from '../src/index.js';
import { inspectMigrationCatalogue } from '../src/planner.js';
import type { DatabaseClient } from '../src/types.js';

vi.mock('../src/planner.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/planner.js')>(),
  inspectMigrationCatalogue: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

describe('applied migration proof transaction boundary', () => {
  it('rejects a pool before issuing queries', async () => {
    const pool = new Pool();
    try {
      expect(() => verifyAppliedDatabaseMigrations(pool as unknown as DatabaseClient))
        .toThrowError(expect.objectContaining({ code: 'MIGRATION_CLIENT_INVALID' }));
    } finally { await pool.end(); }
  });

  it('owns a repeatable-read read-only transaction and releases the client after rejection', async () => {
    const client = new Client();
    const query = vi.spyOn(client, 'query').mockResolvedValue(undefined);
    const failure = new Error('invalid ledger');
    vi.mocked(inspectMigrationCatalogue).mockRejectedValue(failure);
    const operation = verifyAppliedDatabaseMigrations(client);
    expect(() => verifyAppliedDatabaseMigrations(client))
      .toThrowError(expect.objectContaining({ code: 'MIGRATION_CLIENT_BUSY' }));
    await expect(operation).rejects.toBe(failure);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'ROLLBACK',
    ]);
    await expect(verifyAppliedDatabaseMigrations(client)).rejects.toBe(failure);
  });

  it('rolls back an unknown BEGIN acknowledgement', async () => {
    const client = new Client();
    const failure = new Error('unknown begin');
    const query = vi.spyOn(client, 'query')
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined);
    await expect(verifyAppliedDatabaseMigrations(client)).rejects.toBe(failure);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'ROLLBACK',
    ]);
  });

  it('retains verification and cleanup errors when rollback fails', async () => {
    const client = new Client();
    const failure = new Error('invalid ledger');
    const cleanupFailure = new Error('unknown rollback');
    vi.mocked(inspectMigrationCatalogue).mockRejectedValue(failure);
    vi.spyOn(client, 'query')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(cleanupFailure);
    await expect(verifyAppliedDatabaseMigrations(client)).rejects.toMatchObject({
      code: 'MIGRATION_ROLLBACK_FAILED', cause: { errors: [failure, cleanupFailure] },
    });
  });
});
