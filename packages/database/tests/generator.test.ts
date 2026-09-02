import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

type BuiltMigration = Readonly<{
  position: number;
  id: string;
  sha256: string;
  bytes: number;
  source_ranges: readonly Readonly<{ start_line: number; end_line: number }>[];
  sql: string;
}>;

type GeneratorModule = Readonly<{
  buildDatabaseMigrationOutputs: (snapshot: unknown) => Readonly<{
    migrations: readonly BuiltMigration[];
    outputs: ReadonlyMap<string, string>;
  }>;
  publishDatabaseMigrationOutputs: (
    projectRoot: string,
    outputs: ReadonlyMap<string, string>,
    options?: Readonly<{ renameDirectory?: typeof renameSync }>,
  ) => void;
}>;

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(packageRoot, '../..');
const contractSetId = 'cs-ai-c11-openapi-1.11.0-schema-1.12-1d62e2c85c3c';
const contractRoot = path.join(projectRoot, 'contracts/upstream/customer-agent', contractSetId);
const manifest = JSON.parse(readFileSync(path.join(contractRoot, 'contract-set.json'), 'utf8')) as {
  source_git_sha: string;
  database: Readonly<{ sha256: string }>;
};
const databaseSource = readFileSync(path.join(contractRoot, 'schema-v1.12.sql'), 'utf8');
let generator: GeneratorModule;

beforeAll(async () => {
  generator = await import(
    pathToFileURL(path.join(packageRoot, 'scripts/generate-migrations.mjs')).href
  ) as GeneratorModule;
});

function snapshot(source = databaseSource): Readonly<Record<string, unknown>> {
  return {
    contract_set_id: contractSetId,
    source_git_sha: manifest.source_git_sha,
    database_source: source,
    manifest: { database: manifest.database },
  };
}

function publicationFixture(): ReadonlyMap<string, string> {
  return new Map([
    ['packages/database/migrations/0001_test.sql', '-- next migration\n'],
    ['packages/database/migrations/manifest.generated.json', '{"next":true}\n'],
    ['packages/database/src/generated/migrations.generated.ts', 'export const next = true;\n'],
  ]);
}

function prepareExistingPublication(root: string): void {
  const migrations = path.join(root, 'packages/database/migrations');
  const generated = path.join(root, 'packages/database/src/generated');
  mkdirSync(migrations, { recursive: true });
  mkdirSync(generated, { recursive: true });
  writeFileSync(path.join(migrations, '0000_old.sql'), '-- old migration\n');
  writeFileSync(path.join(migrations, 'stale.sql'), '-- stale migration\n');
  writeFileSync(path.join(generated, 'migrations.generated.ts'), 'export const old = true;\n');
}

describe('database migration generator', () => {
  it('deterministically assigns every executable source line exactly once', () => {
    const first = generator.buildDatabaseMigrationOutputs(snapshot());
    const second = generator.buildDatabaseMigrationOutputs(snapshot());

    expect(first.migrations).toHaveLength(9);
    expect(first.migrations.map(({ id }) => id)).toEqual([
      '0001_extensions',
      '0002_identity_and_content',
      '0003_events_and_metrics',
      '0004_import_release_announce',
      '0005_idempotency_rate_limit_outbox',
      '0006_definer_functions_and_triggers',
      '0007_search_bigram',
      '0008_runtime_acl',
      '0009_phase1_policy_seed',
    ]);
    expect([...first.outputs]).toEqual([...second.outputs]);

    const covered = first.migrations.flatMap((migration) => migration.source_ranges.flatMap(
      ({ start_line: startLine, end_line: endLine }) =>
        Array.from({ length: endLine - startLine + 1 }, (_, index) => startLine + index),
    ));
    expect(new Set(covered).size).toBe(7_644);
    expect(Math.min(...covered)).toBe(17);
    expect(Math.max(...covered)).toBe(7_660);
    expect(first.migrations[0]?.sql).toContain('CREATE TABLE customer_agent_meta.schema_migrations');
    expect(first.migrations.every(({ sql }) => !/^COMMIT;$/m.test(sql))).toBe(true);
  });

  it('fails before producing outputs when the frozen database source changes', () => {
    expect(() => generator.buildDatabaseMigrationOutputs(snapshot(`${databaseSource}-- drift\n`))).toThrow(
      /SHA-256 drifted/,
    );
  });

  it('stages the complete output set and removes stale generated members on publish', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'customer-agent-db-generator-'));
    try {
      prepareExistingPublication(root);
      generator.publishDatabaseMigrationOutputs(root, publicationFixture());

      expect(readdirSync(path.join(root, 'packages/database/migrations')).sort()).toEqual([
        '0001_test.sql',
        'manifest.generated.json',
      ]);
      expect(readFileSync(path.join(root, 'packages/database/migrations/0001_test.sql'), 'utf8'))
        .toBe('-- next migration\n');
      expect(readdirSync(path.join(root, 'packages/database/src/generated'))).toEqual([
        'migrations.generated.ts',
      ]);
      expect(readFileSync(path.join(root, 'packages/database/src/generated/migrations.generated.ts'), 'utf8'))
        .toBe('export const next = true;\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('restores both previous output groups when a staged directory swap fails', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'customer-agent-db-generator-'));
    try {
      prepareExistingPublication(root);
      let renameCount = 0;
      const failFourthRename: typeof renameSync = (oldPath, newPath) => {
        renameCount += 1;
        if (renameCount === 4) throw new Error('injected catalogue publication failure');
        renameSync(oldPath, newPath);
      };

      expect(() => generator.publishDatabaseMigrationOutputs(
        root,
        publicationFixture(),
        { renameDirectory: failFourthRename },
      )).toThrow(/injected catalogue publication failure/);

      expect(readdirSync(path.join(root, 'packages/database/migrations')).sort()).toEqual([
        '0000_old.sql',
        'stale.sql',
      ]);
      expect(readFileSync(path.join(root, 'packages/database/src/generated/migrations.generated.ts'), 'utf8'))
        .toBe('export const old = true;\n');
      expect(readdirSync(path.join(root, 'packages/database')).some(
        (entry) => entry.startsWith('.migration-generation-') || entry.includes('.backup'),
      )).toBe(false);
      expect(readdirSync(path.join(root, 'packages/database/src')).some(
        (entry) => entry.includes('.backup'),
      )).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
