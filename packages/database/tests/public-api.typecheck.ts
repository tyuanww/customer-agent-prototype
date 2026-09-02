import type { Pool } from 'pg';
import type { DatabaseClient, DatabaseMigration } from '../src/index.js';

declare const pool: Pool;
declare const migration: DatabaseMigration;

// @ts-expect-error A Pool is not one checked-out PostgreSQL session.
const invalidMigrationClient: DatabaseClient = pool;

// @ts-expect-error Generated SQL is private implementation data, not public plan/status output.
const leakedMigrationSql = migration.sql;

void invalidMigrationClient;
void leakedMigrationSql;
