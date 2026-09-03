import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDatabaseMigrations,
  DatabaseMigrationError,
  inspectDatabaseMigrations,
  planDatabaseMigrations,
  verifyDatabaseMigrations,
} from '@customer-agent/database';
import * as databasePackage from '@customer-agent/database';

test('compiled database package exposes the immutable migration control surface', () => {
  assert.equal('databaseMigrationCatalogue' in databasePackage, false);
  assert.equal(typeof inspectDatabaseMigrations, 'function');
  assert.equal(typeof planDatabaseMigrations, 'function');
  assert.equal(typeof applyDatabaseMigrations, 'function');
  assert.equal(typeof verifyDatabaseMigrations, 'function');
  assert.equal(new DatabaseMigrationError('MIGRATION_VERIFY_FAILED', 'probe').code, 'MIGRATION_VERIFY_FAILED');
});
