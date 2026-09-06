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
  contract_set_id: string;
  source_git_sha: string;
  source_schema_sha256: string;
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
const contractSetId = 'cs-ai-c11-openapi-1.12.0-schema-1.15-2c75d8e76701';
const contractRoot = path.join(projectRoot, 'contracts/upstream/customer-agent', contractSetId);
const manifest = JSON.parse(readFileSync(path.join(contractRoot, 'contract-set.json'), 'utf8')) as {
  source_git_sha: string;
  database: Readonly<{ sha256: string }>;
};
const databaseSource = readFileSync(path.join(contractRoot, 'schema-v1.15.sql'), 'utf8');
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
  it('preserves all eleven immutable migrations and appends atomic owner acceptance', () => {
    const first = generator.buildDatabaseMigrationOutputs(snapshot());
    const second = generator.buildDatabaseMigrationOutputs(snapshot());

    expect(first.migrations).toHaveLength(12);
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
      '0010_search_projection_v1_13',
      '0011_search_no_hit_context_v1_14',
      '0012_owner_acceptance_v1_15',
    ]);
    expect([...first.outputs]).toEqual([...second.outputs]);
    expect(first.migrations.slice(0, 9).map(({ sha256 }) => sha256)).toEqual([
      '4876b7ef62bb033b4b7b487e06e88a525b9cb8b3e32e82e6516124b7fc8eca62',
      '62322728f1621c75b2cc0f66ac20e65710a916c714caa84761a93108b71e1b64',
      'c109b3c7ec79c73cb6e3748808aca9296ed1c96e5d8fc91ab0046c80fd2b50d4',
      'ff68d5969e28a9d4d7eed963906f2fc3783f4c34b5ec1fa347ea87c3bc0b2f6a',
      '715db39163e2a99d10a88126a4bded14c75f4fb4ba1ec97dcba573265babdf02',
      'f5b369165b5e5f0e21801f8fd8eb2c4589ee26ca0761327811f4ed5c5903d4ca',
      '7cf632ec4123b9031893646b0b67348cf5a89dd3fe89ec544dccecb576513189',
      'f883a929a8742e0f71a498e70de410124e8c25fd2fdee6a492047201475990f2',
      'a6ae5649347ad56f78cede6f8c34a69ebe4ceff6ea91be92da2d261999088e7e',
    ]);
    expect(first.migrations[0]?.contract_set_id).toContain('schema-1.12-');
    expect(first.migrations[9]?.contract_set_id).toContain('schema-1.13-');
    expect(first.migrations[10]?.contract_set_id).toContain('schema-1.14-');
    expect(first.migrations[11]?.contract_set_id).toBe(contractSetId);
    expect(first.migrations[10]?.sha256).toBe('8f5337b69b1a10fb85013694699e683c99e14399fa3471bd970eb89ac8591a0f');
    expect(first.migrations[11]?.sql).toContain('CREATE ROLE app_owner_acceptance_registrar');
    expect(first.migrations[11]?.sql).toContain('CS-AI-C11 schema.v1.15;');
    expect(first.migrations[11]?.sql).not.toMatch(/^BEGIN;$/m);
    expect(first.migrations[0]?.sql).toContain('CREATE TABLE customer_agent_meta.schema_migrations');
    expect(first.migrations[9]?.sha256).toBe(
      '026497120b6ad6d7d885de47d54335bb8891d8b45e2da010cc85eae6ea7b6818',
    );
    expect(first.migrations[10]?.sql).toContain('is_candidate BOOLEAN');
    expect(first.migrations[10]?.sql).toContain('candidate.script_id IS NOT NULL');
    expect(first.migrations[10]?.sql).toContain('GRANT EXECUTE ON FUNCTION public.search_recommendable_scripts');
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
