import {
  cpSync,
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
  buildDatabaseMigrationOutputs: (snapshot: unknown, options?: Readonly<{ projectRoot: string }>) => Readonly<{
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
const contractSetId = JSON.parse(readFileSync(path.join(projectRoot, 'contracts/upstream/customer-agent/contract-set.lock.json'), 'utf8')).contract_set_id as string;
const contractRoot = path.join(projectRoot, 'contracts/upstream/customer-agent', contractSetId);
const manifest = JSON.parse(readFileSync(path.join(contractRoot, 'contract-set.json'), 'utf8')) as {
  source_git_sha: string;
  database: Readonly<{ sha256: string; file: string }>;
  runtime: Readonly<Record<string, Readonly<{ sha256: string; file: string }>>>;
};
const databaseSource = readFileSync(path.join(contractRoot, manifest.database.file), 'utf8');
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
    manifest,
    runtime_sources: Object.fromEntries(Object.entries(manifest.runtime).map(([name, descriptor]) =>
      [name, readFileSync(path.join(contractRoot, descriptor.file), 'utf8')])),
  };
}

function frozenSnapshot(id: string): Readonly<Record<string, unknown>> {
  const root = path.join(projectRoot, 'contracts/upstream/customer-agent', id);
  const previous = JSON.parse(readFileSync(path.join(root, 'contract-set.json'), 'utf8')) as typeof manifest;
  return { contract_set_id: id, source_git_sha: previous.source_git_sha, manifest: previous,
    database_source: readFileSync(path.join(root, previous.database.file), 'utf8'),
    runtime_sources: Object.fromEntries(Object.entries(previous.runtime).map(([name, descriptor]) =>
      [name, readFileSync(path.join(root, descriptor.file), 'utf8')])),
  };
}

function runtimeSnapshot(): Readonly<Record<string, unknown>> {
  return frozenSnapshot('cs-ai-c11-openapi-1.21.0-schema-1.23-e35c0c01b551');
}

function csvSnapshot(): Readonly<Record<string, unknown>> {
  return frozenSnapshot('cs-ai-c11-openapi-1.22.0-schema-1.24-adbc7b1ce251');
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
  it('preserves all thirty-two predecessor migrations and stamps only the runtime addition', () => {
    const prior = generator.buildDatabaseMigrationOutputs(runtimeSnapshot());
    const sourceGitSha = 'a'.repeat(40);
    const next = generator.buildDatabaseMigrationOutputs({ ...runtimeSnapshot(),
      contract_set_id: `cs-ai-c11-openapi-1.21.0-schema-1.23-${sourceGitSha.slice(0, 12)}`, source_git_sha: sourceGitSha });
    expect(next.migrations).toHaveLength(33);
    expect(next.migrations.slice(0,32)).toEqual(prior.migrations.slice(0,32));
    expect(next.migrations[32]?.source_git_sha).toBe(sourceGitSha);
    for (const [file, bytes] of next.outputs) {
      if (file.endsWith('.sql') && !file.endsWith('0033_intake_runtime_v1_23.sql')) expect(bytes).toBe(prior.outputs.get(file));
    }
    const metadata = JSON.parse(next.outputs.get('packages/database/migrations/manifest.generated.json')!);
    expect(metadata.compatibility.prior_reviewed_upgrades.at(-1)).toEqual({
      contract_set_id: 'cs-ai-c11-openapi-1.20.0-schema-1.22-6f318d448929',
      source_git_sha: '6f318d448929d1a87c5dc9e725ea4f90c48a4b97',
      source_schema_sha256: 'c5e4896e8ed1ff587e23a70723bd9d81c056ba65561cd9d94963aa6b5f1ae3ce', migration_count: 32,
    });
    expect(prior.migrations.slice(30,32).map(m => m.sha256)).toEqual([
      '82407ae1c0ce3a3dc975b9b5fe76012b5ab4f19ee5952dafb912a23509c4dcc0',
      '38e72eb66941256861aeb3edddc609cdbbfbc4e1eed56366b370526ad82cbddc',
    ]);
    expect(prior.migrations[32]?.sql.match(/-- companion=([^;]+)/g)).toEqual([
      '-- companion=roles', '-- companion=organization', '-- companion=session',
      '-- companion=directory', '-- companion=directoryAcl', '-- companion=acl',
    ]);
  });

  it('preserves all thirty-three applied SQL blobs and their provenance when adding CSV', () => {
    const prior = generator.buildDatabaseMigrationOutputs(runtimeSnapshot());
    const next = generator.buildDatabaseMigrationOutputs(csvSnapshot());
    expect(next.migrations.slice(0,33)).toEqual(prior.migrations);
    for (const [file, sql] of prior.outputs) if (file.endsWith('.sql')) expect(next.outputs.get(file)).toBe(sql);
    expect(next.migrations[33]?.sql).toContain('CREATE TRIGGER candidate_format');
    expect(next.migrations[33]?.sql).not.toMatch(/CREATE ROLE|^BEGIN;|^COMMIT;/m);
    const metadata = JSON.parse(next.outputs.get('packages/database/migrations/manifest.generated.json')!);
    expect(metadata.compatibility.prior_reviewed_upgrades.at(-1)).toMatchObject({
      contract_set_id: 'cs-ai-c11-openapi-1.21.0-schema-1.23-e35c0c01b551', migration_count: 33,
    });
  });

  it('preserves all thirty-four SQL blobs and their provenance while appending only helper EXECUTE', () => {
    const prior = generator.buildDatabaseMigrationOutputs(csvSnapshot());
    const next = generator.buildDatabaseMigrationOutputs(snapshot());
    expect(next.migrations.slice(0, 34)).toEqual(prior.migrations);
    for (const [file, sql] of prior.outputs) if (file.endsWith('.sql')) expect(next.outputs.get(file)).toBe(sql);
    const last = next.migrations[34]!;
    expect(last.sql).toContain('GRANT EXECUTE ON FUNCTION');
    expect(last.sql).toContain('TO intake_runtime_fn_owner;');
    expect(last.sql).not.toMatch(/CREATE ROLE|CREATE OR REPLACE|ALTER FUNCTION|^BEGIN;|^COMMIT;/m);
    const metadata = JSON.parse(next.outputs.get('packages/database/migrations/manifest.generated.json')!);
    expect(metadata.compatibility.prior_reviewed_upgrades.at(-1)).toEqual({
      contract_set_id: 'cs-ai-c11-openapi-1.22.0-schema-1.24-adbc7b1ce251',
      source_git_sha: 'adbc7b1ce251816fc02957a0042742ae2d053f9a',
      source_schema_sha256: 'c4ceffa961728423b755b00d551b9ab67fbf33ffe1dd87d8e671f6d151f744c5', migration_count: 34,
    });
  });

  it.each(['installation', 'roles', 'organization', 'session', 'directory', 'directoryAcl', 'acl', 'provenance', 'protocol', 'csv', 'csvProtocol', 'csvInstallation', 'legacyAcl'])(
    'rejects missing or changed runtime companion %s before generating outputs', name => {
      const input = snapshot();
      const sources = input.runtime_sources as Record<string, string>;
      const missing = { ...sources }; delete missing[name];
      for (const runtime_sources of [missing, { ...sources, [name]: sources[name] + '\n-- drift' }]) {
        expect(() => generator.buildDatabaseMigrationOutputs({ ...input, runtime_sources })).toThrow(/missing or drifted/);
      }
    },
  );

  it('preserves immutable migrations and appends one atomic legacy CHECK ACL increment', () => {
    const first = generator.buildDatabaseMigrationOutputs(snapshot());
    const second = generator.buildDatabaseMigrationOutputs(snapshot());

    expect(first.migrations).toHaveLength(35);
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
      '0013_backend_identity_content_v1_16',
      '0014_release_deferred_guard_v1_17',
      '0015_ops_loop_v1_18',
      '0016_office_owner_publish',
      '0017_rollback_previous_target',
      '0018_owner_read_views',
      '0019_candidate_client_snapshot', '0020_coach_publish_v1_19', '0021_content_intake_v1_20', '0022_intake_legacy_fence', '0023_intake_quality', '0024_intake_publication', '0025_intake_usage_v1_21', '0026_intake_discovery_index', '0027_intake_rollback', '0028_intake_family', '0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication', '0033_intake_runtime_v1_23', '0034_intake_csv_v1_24', '0035_intake_legacy_check_acl_v1_25',
    ]);
    expect([...first.outputs]).toEqual([...second.outputs]);
    expect(first.migrations.slice(0,24).map(m => m.sha256)).toEqual(["4876b7ef62bb033b4b7b487e06e88a525b9cb8b3e32e82e6516124b7fc8eca62", "62322728f1621c75b2cc0f66ac20e65710a916c714caa84761a93108b71e1b64", "c109b3c7ec79c73cb6e3748808aca9296ed1c96e5d8fc91ab0046c80fd2b50d4", "ff68d5969e28a9d4d7eed963906f2fc3783f4c34b5ec1fa347ea87c3bc0b2f6a", "715db39163e2a99d10a88126a4bded14c75f4fb4ba1ec97dcba573265babdf02", "f5b369165b5e5f0e21801f8fd8eb2c4589ee26ca0761327811f4ed5c5903d4ca", "7cf632ec4123b9031893646b0b67348cf5a89dd3fe89ec544dccecb576513189", "f883a929a8742e0f71a498e70de410124e8c25fd2fdee6a492047201475990f2", "a6ae5649347ad56f78cede6f8c34a69ebe4ceff6ea91be92da2d261999088e7e", "026497120b6ad6d7d885de47d54335bb8891d8b45e2da010cc85eae6ea7b6818", "8f5337b69b1a10fb85013694699e683c99e14399fa3471bd970eb89ac8591a0f", "3bc06f81ed596049e0539a679e066b7a6c2d1814314c3d2ba9fd4d65f469be18", "8794d2e32117d8949a7ccd8c38ac91d04852b406be7e30825ff8fb364925eee2", "ee7615d9ca7b05b01f66646393fbf26f1757a882b027a3fd6be415872a269339", "e7ac1d9c5f487336b63ed4a8abeb66031dbcd3189286fbd2d07b97407685613b", "d574ebd891e3a7db771e6f6a5fb7a85f6e6d3614c7880f2dea4b4bb642d6b447", "eb3ccbf3f04c4005393fc757b8f1e03d55a5078837b2b8eb9dbac72d83116788", "c89d76992850aa562a3d24618bccb39a941a8bc88136342505a9edea5440acba", "e4720feabd0a9b92d8d5cc22fcb6dcce75cf6e8136c0b2d9365d0d7c1cf18cd7", "fd261530461c20aca90c5468997a695d67921fe53ff74b39de2c0a5f6b80d678", "7c19bf3f97fecb5af61c92131c0ce2a5f5f42822d2e104bb4202d96e292c73db", "8df4f9127362aa49c320b87d7afffd910312d54fab7193224e3bece5993a8b03", "c3b37131c28b76b2453e24d5f432e70329c478a7f90d34c95598518124e50136", "9b3b1d0ae32f0fc6e0f333428ac52c2e688c57aad1e610bbb6bb7c94e4d13af2"]);
    expect(first.migrations[24]?.sha256).toBe('f270f787323a65baf3727337dcc34c1ff3f7a0bac0baf79a1894a7f7ae9591f4');
    expect(first.migrations.slice(26,30).map(m => m.sha256)).toEqual(["da90dd3eaa366037fbbe71f4296697fdf3f9f788954119731926e6500df55e98", "8b241e1b5f808c2278b53351a0d3cbee56f4ac23ca16c65736ba45ace859382e", "9d56a3ea4b56d5ec1ccbef5bc331c12f5f788da725a2d09030f2ccbe9e2f00ab", "8843955f79d970bdc5f03469a7bba316c2f1fb8fa070d2b0f61ba9bc1f5144a3"]);
    expect(first.migrations[30]?.sql).toContain('ADD COLUMN publication_policy');
    expect(first.migrations[25]?.sql).toContain('CREATE INDEX grants_recipient_scope_source');
    expect(first.migrations[24]?.contract_set_id).toBe('cs-ai-c11-openapi-1.17.0-schema-1.21-53906e302288');
    expect(first.migrations[25]?.sha256).toBe('c96e289e3ae19d600913b80796f3051eb7c19c5f544e1b8b9e17d5f5f1cd911f');
    expect(first.migrations[24]?.sql).toContain("CREATE TABLE content_intake.entitlement_contexts");
    expect(first.migrations[24]?.sql).not.toMatch(/^BEGIN;$/m);
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
    expect(first.migrations[11]?.contract_set_id).toContain('schema-1.15-');
    expect(first.migrations[11]?.sha256).toBe('3bc06f81ed596049e0539a679e066b7a6c2d1814314c3d2ba9fd4d65f469be18');
    expect(first.migrations[12]?.sha256).toBe('8794d2e32117d8949a7ccd8c38ac91d04852b406be7e30825ff8fb364925eee2');
    expect(first.migrations[13]?.contract_set_id).toContain('schema-1.17-');
    expect(first.migrations[13]?.sha256).toBe('ee7615d9ca7b05b01f66646393fbf26f1757a882b027a3fd6be415872a269339');
    expect(first.migrations[14]?.contract_set_id).toBe('cs-ai-c11-openapi-1.14.0-schema-1.18-260ef224c534');
    expect(first.migrations[20]?.contract_set_id).toBe('cs-ai-c11-openapi-1.16.0-schema-1.20-d029cb0908fa');
    expect(first.migrations[20]?.sql).toContain('CREATE SCHEMA content_intake');
    expect(first.migrations[20]?.sql).not.toMatch(/^BEGIN;$/m);
    expect(first.migrations.slice(0, 19).map(({ sha256 }) => sha256)).toEqual([
      '4876b7ef62bb033b4b7b487e06e88a525b9cb8b3e32e82e6516124b7fc8eca62',
      '62322728f1621c75b2cc0f66ac20e65710a916c714caa84761a93108b71e1b64',
      'c109b3c7ec79c73cb6e3748808aca9296ed1c96e5d8fc91ab0046c80fd2b50d4',
      'ff68d5969e28a9d4d7eed963906f2fc3783f4c34b5ec1fa347ea87c3bc0b2f6a',
      '715db39163e2a99d10a88126a4bded14c75f4fb4ba1ec97dcba573265babdf02',
      'f5b369165b5e5f0e21801f8fd8eb2c4589ee26ca0761327811f4ed5c5903d4ca',
      '7cf632ec4123b9031893646b0b67348cf5a89dd3fe89ec544dccecb576513189',
      'f883a929a8742e0f71a498e70de410124e8c25fd2fdee6a492047201475990f2',
      'a6ae5649347ad56f78cede6f8c34a69ebe4ceff6ea91be92da2d261999088e7e',
      '026497120b6ad6d7d885de47d54335bb8891d8b45e2da010cc85eae6ea7b6818',
      '8f5337b69b1a10fb85013694699e683c99e14399fa3471bd970eb89ac8591a0f',
      '3bc06f81ed596049e0539a679e066b7a6c2d1814314c3d2ba9fd4d65f469be18',
      '8794d2e32117d8949a7ccd8c38ac91d04852b406be7e30825ff8fb364925eee2',
      'ee7615d9ca7b05b01f66646393fbf26f1757a882b027a3fd6be415872a269339',
      'e7ac1d9c5f487336b63ed4a8abeb66031dbcd3189286fbd2d07b97407685613b',
      'd574ebd891e3a7db771e6f6a5fb7a85f6e6d3614c7880f2dea4b4bb642d6b447',
      'eb3ccbf3f04c4005393fc757b8f1e03d55a5078837b2b8eb9dbac72d83116788',
      'c89d76992850aa562a3d24618bccb39a941a8bc88136342505a9edea5440acba',
      'e4720feabd0a9b92d8d5cc22fcb6dcce75cf6e8136c0b2d9365d0d7c1cf18cd7'
    ]);
    expect(first.migrations[14]?.sql).toContain('CREATE SCHEMA ops_loop');
    expect(first.migrations[14]?.sql).toContain('SECURITY DEFINER');
    expect(first.migrations[14]?.sql).not.toMatch(/^BEGIN;$/m);
    expect(first.migrations[12]?.sql).toContain('CS-AI-C11 schema.v1.16;');
    expect(first.migrations[12]?.sql).not.toMatch(/^BEGIN;$/m);
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

  it.each(['0016_office_owner_publish','0022_intake_legacy_fence','0023_intake_quality','0024_intake_publication','0026_intake_discovery_index'])('rejects edits to frozen overlay %s', id => {
    const root = mkdtempSync(path.join(tmpdir(), 'customer-agent-overlay-drift-'));
    try {
      for (const relative of ['contracts/upstream/customer-agent', 'packages/database/migrations', 'packages/database/overlays']) {
        cpSync(path.join(projectRoot, relative), path.join(root, relative), { recursive: true });
      }
      const sourcePath = path.join(root, `packages/database/overlays/${id}.sql`);
      writeFileSync(sourcePath, readFileSync(sourcePath, 'utf8') + '\n-- changed after shipping\n');
      expect(() => generator.buildDatabaseMigrationOutputs(snapshot(), { projectRoot: root }))
        .toThrow(/Frozen (product overlay|intake overlay|usage migration) source drifted/);
    } finally { rmSync(root, { recursive: true, force: true }); }
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
