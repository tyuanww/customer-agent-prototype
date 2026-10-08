import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Client } from 'pg';
import { applyMigrationCatalogue } from '../../../../packages/database/src/runner.js';
import { generatedMigrationCatalogue } from '../../../../packages/database/src/generated/migrations.generated.js';

/** Only historical experiment suites may use this immutable pre-runtime baseline.
 * Current consumers always call the public applyDatabaseMigrations entrypoint. */
export async function applyHistoricalIntakeMigrations(client: Client) {
  const manifest = JSON.parse(await readFile(new URL('../../experiments/intake-runtime/acceptance-candidate/manifest.json', import.meta.url), 'utf8')) as { overlayInputs: Record<string, string> };
  const expected = Object.entries(manifest.overlayInputs);
  const migrations = generatedMigrationCatalogue.migrations.slice(0, 32);
  if (expected.length !== 32 || migrations.length !== 32) throw new Error('HISTORICAL_MIGRATION_COUNT');
  for (const [index, migration] of migrations.entries()) {
    const [file, hash] = expected[index]!;
    if (file !== `packages/database/migrations/${migration.id}.sql` || hash !== migration.sha256
      || createHash('sha256').update(migration.sql).digest('hex') !== hash) throw new Error('HISTORICAL_MIGRATION_DRIFT');
  }
  const last = migrations[31]!;
  return applyMigrationCatalogue(client, { ...generatedMigrationCatalogue,
    contractSetId: last.contractSetId, sourceGitSha: last.sourceGitSha, sourceSchemaSha256: last.sourceSchemaSha256,
    compatibility: { ...generatedMigrationCatalogue.compatibility, priorReviewedUpgrades: generatedMigrationCatalogue.compatibility.priorReviewedUpgrades.filter(v => v.migrationCount < 32) }, migrations });
}
