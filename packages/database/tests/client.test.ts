import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '../src/runner.js';
import type { DatabaseClient } from '../src/types.js';

describe('database migration public client boundary', () => {
  it('rejects a Pool before any migration query can escape the required session', async () => {
    const pool = new Pool();
    try {
      expect(() => applyDatabaseMigrations(pool as unknown as DatabaseClient)).toThrowError(
        expect.objectContaining({ code: 'MIGRATION_CLIENT_INVALID' }),
      );
    } finally {
      await pool.end();
    }
  });
});
