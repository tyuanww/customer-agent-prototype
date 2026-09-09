import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withVerifiedContractSetSnapshot } from '../../../scripts/customer-agent-contract-set.mjs';

const GENERATOR_SCHEMA = 'customer-agent-database-migrations/v2';
const GENERATED_HEADER = 'GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.';
const EXPECTED_DATABASE_SHA256 = '419d84fbe827a5803b731250145e97786f6cb76c6d7aa9b3bc21bcac3c90f133';
const BASELINE = Object.freeze({
  contractSetId: 'cs-ai-c11-openapi-1.11.0-schema-1.12-1d62e2c85c3c',
  sourceGitSha: '1d62e2c85c3c77dbb7a2fecc1d24a2002cb0ed38',
  sourceSchemaSha256: '47b667958e522a28df1c04d7c79a56c930bfe0ac04598321824b55744ac4a801',
  migrationCount: 9,
  schemaFile: 'schema-v1.12.sql',
});
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PROJECT_ROOT = path.resolve(PACKAGE_ROOT, '../..');
const MANIFEST_PATH = 'packages/database/migrations/manifest.generated.json';
const CATALOGUE_PATH = 'packages/database/src/generated/migrations.generated.ts';
const OUTPUT_GROUPS = Object.freeze([
  Object.freeze({
    name: 'migrations',
    prefix: 'packages/database/migrations/',
    target: 'packages/database/migrations',
  }),
  Object.freeze({
    name: 'catalogue',
    prefix: 'packages/database/src/generated/',
    target: 'packages/database/src/generated',
  }),
]);

const BASELINE_MIGRATIONS = Object.freeze([
  Object.freeze({ position: 1, id: '0001_extensions', file: '0001_extensions.sql', sha256: '4876b7ef62bb033b4b7b487e06e88a525b9cb8b3e32e82e6516124b7fc8eca62', bytes: 5202, source_ranges: Object.freeze([{ start_line: 17, end_line: 97 }]) }),
  Object.freeze({ position: 2, id: '0002_identity_and_content', file: '0002_identity_and_content.sql', sha256: '62322728f1621c75b2cc0f66ac20e65710a916c714caa84761a93108b71e1b64', bytes: 41126, source_ranges: Object.freeze([{ start_line: 98, end_line: 981 }]) }),
  Object.freeze({ position: 3, id: '0003_events_and_metrics', file: '0003_events_and_metrics.sql', sha256: 'c109b3c7ec79c73cb6e3748808aca9296ed1c96e5d8fc91ab0046c80fd2b50d4', bytes: 31383, source_ranges: Object.freeze([{ start_line: 982, end_line: 1748 }]) }),
  Object.freeze({ position: 4, id: '0004_import_release_announce', file: '0004_import_release_announce.sql', sha256: 'ff68d5969e28a9d4d7eed963906f2fc3783f4c34b5ec1fa347ea87c3bc0b2f6a', bytes: 43438, source_ranges: Object.freeze([{ start_line: 1749, end_line: 2630 }]) }),
  Object.freeze({ position: 5, id: '0005_idempotency_rate_limit_outbox', file: '0005_idempotency_rate_limit_outbox.sql', sha256: '715db39163e2a99d10a88126a4bded14c75f4fb4ba1ec97dcba573265babdf02', bytes: 7101, source_ranges: Object.freeze([{ start_line: 2651, end_line: 2771 }]) }),
  Object.freeze({ position: 6, id: '0006_definer_functions_and_triggers', file: '0006_definer_functions_and_triggers.sql', sha256: 'f5b369165b5e5f0e21801f8fd8eb2c4589ee26ca0761327811f4ed5c5903d4ca', bytes: 176719, source_ranges: Object.freeze([{ start_line: 2772, end_line: 6782 }]) }),
  Object.freeze({ position: 7, id: '0007_search_bigram', file: '0007_search_bigram.sql', sha256: '7cf632ec4123b9031893646b0b67348cf5a89dd3fe89ec544dccecb576513189', bytes: 23262, source_ranges: Object.freeze([{ start_line: 6783, end_line: 7405 }]) }),
  Object.freeze({ position: 8, id: '0008_runtime_acl', file: '0008_runtime_acl.sql', sha256: 'f883a929a8742e0f71a498e70de410124e8c25fd2fdee6a492047201475990f2', bytes: 20450, source_ranges: Object.freeze([{ start_line: 7406, end_line: 7657 }]) }),
  Object.freeze({ position: 9, id: '0009_phase1_policy_seed', file: '0009_phase1_policy_seed.sql', sha256: 'a6ae5649347ad56f78cede6f8c34a69ebe4ceff6ea91be92da2d261999088e7e', bytes: 1712, source_ranges: Object.freeze([{ start_line: 2631, end_line: 2650 }, { start_line: 7658, end_line: 7660 }]) }),
]);

const PRIOR_REVIEWED_UPGRADE = Object.freeze({
  contractSetId: 'cs-ai-c11-openapi-1.11.0-schema-1.13-dcd50383b458',
  sourceGitSha: 'dcd50383b458775219e1681ad9e767de7cf18517',
  sourceSchemaSha256: 'de8b7d9bdcac4ecad844025a47228ba339dad47d61861d261c492cb16a1aea02',
  migrationCount: 10,
  schemaFile: 'schema-v1.13.sql',
  position: 10,
  id: '0010_search_projection_v1_13',
  file: '0010_search_projection_v1_13.sql',
  sha256: '026497120b6ad6d7d885de47d54335bb8891d8b45e2da010cc85eae6ea7b6818',
  bytes: 4313,
  source_ranges: Object.freeze([
    Object.freeze({ start_line: 6871, end_line: 6961 }),
    Object.freeze({ start_line: 7508, end_line: 7508 }),
    Object.freeze({ start_line: 7624, end_line: 7624 }),
    Object.freeze({ start_line: 7666, end_line: 7667 }),
  ]),
});

const PRIOR_V1_14 = Object.freeze({
  position: 11,
  id: '0011_search_no_hit_context_v1_14',
  file: '0011_search_no_hit_context_v1_14.sql',
  sha256: '8f5337b69b1a10fb85013694699e683c99e14399fa3471bd970eb89ac8591a0f',
  bytes: 4900,
  source_ranges: Object.freeze([
    Object.freeze({ start_line: 6871, end_line: 6976 }),
    Object.freeze({ start_line: 7523, end_line: 7523 }),
    Object.freeze({ start_line: 7639, end_line: 7639 }),
    Object.freeze({ start_line: 7681, end_line: 7682 }),
  ]),
  contractSetId: 'cs-ai-c11-openapi-1.11.0-schema-1.14-1af001b8b0ce',
  sourceGitSha: '1af001b8b0ce95aac0c42f42251a38feb85f3e26',
  sourceSchemaSha256: 'edf909bf9450b5745a85ced4a75a2e2de3e5b061847562cd3a68c9c7c226da99',
  migrationCount: 11,
  schemaFile: 'schema-v1.14.sql',
});
const PRIOR_V1_15 = Object.freeze({
  "position": 12,
  "id": "0012_owner_acceptance_v1_15",
  "file": "0012_owner_acceptance_v1_15.sql",
  "sha256": "3bc06f81ed596049e0539a679e066b7a6c2d1814314c3d2ba9fd4d65f469be18",
  "bytes": 128400,
  "source_ranges": [
    {
      "start_line": 7701,
      "end_line": 8015
    },
    {
      "start_line": 8027,
      "end_line": 8071
    },
    {
      "start_line": 8081,
      "end_line": 8164
    },
    {
      "start_line": 8175,
      "end_line": 8381
    },
    {
      "start_line": 8392,
      "end_line": 9100
    },
    {
      "start_line": 9111,
      "end_line": 10164
    },
    {
      "start_line": 10171,
      "end_line": 10171
    }
  ],
  "contractSetId": "cs-ai-c11-openapi-1.12.0-schema-1.15-2c75d8e76701",
  "sourceGitSha": "2c75d8e7670134e6aa95a4780ff09fe0422a65e8",
  "sourceSchemaSha256": "859c4a4757d87e642e797ad8a26cfb334c49ae7f8f263966099eb89e6750b38b",
  "migrationCount": 12,
  "schemaFile": "schema-v1.15.sql"
});
const PRIOR_V1_16 = Object.freeze({
  "position": 13,
  "id": "0013_backend_identity_content_v1_16",
  "file": "0013_backend_identity_content_v1_16.sql",
  "sha256": "8794d2e32117d8949a7ccd8c38ac91d04852b406be7e30825ff8fb364925eee2",
  "bytes": 40853,
  "source_ranges": [
    {
      "start_line": 10183,
      "end_line": 10334
    },
    {
      "start_line": 10344,
      "end_line": 10713
    },
    {
      "start_line": 10719,
      "end_line": 10719
    }
  ],
  "contractSetId": "cs-ai-c11-openapi-1.13.0-schema-1.16-6f7d18e59f2e",
  "sourceGitSha": "6f7d18e59f2e8b510daa23a3d606163227350a40",
  "sourceSchemaSha256": "0db44d4d44e968b24e90dda8bcd26a077dd33395ff5a31efb38d085254d4c44f",
  "migrationCount": 13,
  "schemaFile": "schema-v1.16.sql"
});
const REVIEWED_UPGRADES = Object.freeze([PRIOR_REVIEWED_UPGRADE, PRIOR_V1_14, PRIOR_V1_15, PRIOR_V1_16]);

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function linesForRanges(lines, ranges) {
  return ranges.map(({ start_line, end_line }) => lines.slice(start_line - 1, end_line).join('\n')).join('\n');
}

// The runner owns the migration transaction; the entire predecessor remains immutable.
function backendUpgradeRanges(source, projectRoot) {
  const previousPath = path.join(projectRoot, 'contracts/upstream/customer-agent', PRIOR_V1_16.contractSetId, PRIOR_V1_16.schemaFile);
  if (!existsSync(previousPath) || !lstatSync(previousPath).isFile()) throw new Error('Immutable v1.16 source must be a regular file');
  const previous = readFileSync(previousPath, 'utf8');
  if (sha256(previous) !== PRIOR_V1_16.sourceSchemaSha256) throw new Error('Immutable v1.16 digest drifted');
  const prefix = '-- schema.v1.17 — synthetic backend closure clean-install reference\n' + previous + '\n';
  if (!source.startsWith(prefix)) throw new Error('Closure predecessor differs from immutable v1.16');
  const match = source.slice(prefix.length).match(/^-- BEGIN CLOSURE ([0-9a-f]{64})\n([\s\S]+)-- END CLOSURE\n$/);
  if (!match || sha256(match[2]) !== match[1]) throw new Error('Closure source digest drifted');
  const body = match[2].trimEnd().split('\n');
  const begin = body.indexOf('BEGIN;');
  if (begin < 0 || body.filter(line => line === 'BEGIN;').length !== 1 || body.at(-1) !== 'COMMIT;' || body.filter(line => line === 'COMMIT;').length !== 1) throw new Error('Closure transaction anchors drifted');
  const offset = prefix.split('\n').length + 1;
  return { lines: source.trimEnd().split('\n'), ranges: [{ start_line: offset + begin + 1, end_line: offset + body.length - 2 }] };
}

function loadBaselineMigrations(projectRoot) {
  return Object.freeze(BASELINE_MIGRATIONS.map((descriptor) => {
    const migrationPath = path.join(projectRoot, 'packages/database/migrations', descriptor.file);
    if (!existsSync(migrationPath) || !lstatSync(migrationPath).isFile()) {
      throw new Error(`Immutable baseline migration is missing: ${descriptor.file}`);
    }
    const sql = readFileSync(migrationPath, 'utf8');
    if (Buffer.byteLength(sql) !== descriptor.bytes || sha256(sql) !== descriptor.sha256) {
      throw new Error(`Immutable baseline migration drifted: ${descriptor.file}`);
    }
    for (const anchor of [BASELINE.contractSetId, BASELINE.sourceGitSha, BASELINE.sourceSchemaSha256]) {
      if (!sql.includes(anchor)) throw new Error(`Baseline provenance is missing from ${descriptor.file}`);
    }
    return Object.freeze({
      ...descriptor,
      contract_set_id: BASELINE.contractSetId,
      source_git_sha: BASELINE.sourceGitSha,
      source_schema_sha256: BASELINE.sourceSchemaSha256,
      sql,
    });
  }));
}

function loadPriorReviewedUpgrade(projectRoot, provenance) {
  const migrationPath = path.join(projectRoot, 'packages/database/migrations', provenance.file);
  if (!existsSync(migrationPath) || !lstatSync(migrationPath).isFile()) {
    throw new Error(`Immutable reviewed migration must be a regular file: ${provenance.file}`);
  }
  const sql = readFileSync(migrationPath, 'utf8');
  if (Buffer.byteLength(sql) !== provenance.bytes || sha256(sql) !== provenance.sha256) {
    throw new Error(`Immutable reviewed migration drifted: ${provenance.file}`);
  }
  const { migrationCount: _count, schemaFile: _file, contractSetId, sourceGitSha, sourceSchemaSha256, ...descriptor } = provenance;
  return Object.freeze({ ...descriptor, contract_set_id: contractSetId,
    source_git_sha: sourceGitSha, source_schema_sha256: sourceSchemaSha256, sql });
}

function renderUpgradeMigration(sourceBody, ranges, snapshot) {
  const descriptor = { position: 14, id: '0014_release_deferred_guard_v1_17', file: '0014_release_deferred_guard_v1_17.sql', source_ranges: ranges };
  const sql = [
    `-- ${GENERATED_HEADER}`,
    `-- ${descriptor.id}; source schema.v1.17 lines ${ranges.map((r) => `${r.start_line}-${r.end_line}`).join(', ')}`,
    `-- contract_set_id=${snapshot.contract_set_id}`,
    `-- source_git_sha=${snapshot.source_git_sha}`,
    `-- source_schema_sha256=${snapshot.manifest.database.sha256}`,
    'SET LOCAL search_path = public, pg_catalog, pg_temp;', '', sourceBody, '',
  ].join('\n');
  return Object.freeze({ ...descriptor, sha256: sha256(sql), bytes: Buffer.byteLength(sql),
    contract_set_id: snapshot.contract_set_id, source_git_sha: snapshot.source_git_sha,
    source_schema_sha256: snapshot.manifest.database.sha256, sql });
}

function renderCatalogue(manifest, migrations) {
  const migrationEntries = migrations.map((migration) => `  Object.freeze({
    position: ${migration.position},
    id: ${JSON.stringify(migration.id)},
    sha256: ${JSON.stringify(migration.sha256)},
    bytes: ${migration.bytes},
    contractSetId: ${JSON.stringify(migration.contract_set_id)},
    sourceGitSha: ${JSON.stringify(migration.source_git_sha)},
    sourceSchemaSha256: ${JSON.stringify(migration.source_schema_sha256)},
    sourceRanges: Object.freeze(${JSON.stringify(migration.source_ranges.map((range) => ({ startLine: range.start_line, endLine: range.end_line })))}),
    sql: ${JSON.stringify(migration.sql)},
  })`).join(',\n');
  return `// ${GENERATED_HEADER}\nimport type { ExecutableMigrationCatalogue } from '../types.js';\n\nexport const generatedMigrationCatalogue: ExecutableMigrationCatalogue = Object.freeze({\n  schema: ${JSON.stringify(manifest.schema)},\n  contractSetId: ${JSON.stringify(manifest.contract_set_id)},\n  sourceGitSha: ${JSON.stringify(manifest.source_git_sha)},\n  sourceSchemaSha256: ${JSON.stringify(manifest.source_schema_sha256)},\n  compatibility: Object.freeze({ current: 'N', priorSignedBaseline: Object.freeze({ contractSetId: ${JSON.stringify(BASELINE.contractSetId)}, sourceGitSha: ${JSON.stringify(BASELINE.sourceGitSha)}, sourceSchemaSha256: ${JSON.stringify(BASELINE.sourceSchemaSha256)}, migrationCount: ${BASELINE.migrationCount} }), priorReviewedUpgrades: Object.freeze(${JSON.stringify(REVIEWED_UPGRADES.map((p) => ({ contractSetId: p.contractSetId, sourceGitSha: p.sourceGitSha, sourceSchemaSha256: p.sourceSchemaSha256, migrationCount: p.migrationCount })))}) }),\n  migrations: Object.freeze([\n${migrationEntries}\n  ]),\n});\n`;
}

export function buildDatabaseMigrationOutputs(snapshot, { projectRoot = DEFAULT_PROJECT_ROOT } = {}) {
  if (!snapshot || typeof snapshot.database_source !== 'string') {
    throw new Error('Verified contract snapshot is missing database_source');
  }
  if (snapshot.manifest?.database?.sha256 !== EXPECTED_DATABASE_SHA256 || sha256(snapshot.database_source) !== EXPECTED_DATABASE_SHA256) {
    throw new Error('Database contract SHA-256 drifted; explicitly review and version the migration generator');
  }
  const { lines, ranges } = backendUpgradeRanges(snapshot.database_source, projectRoot);
  const upgradeSourceBody = linesForRanges(lines, ranges);
  const upgrade = renderUpgradeMigration(upgradeSourceBody, ranges, snapshot);
  const migrations = Object.freeze([
    ...loadBaselineMigrations(projectRoot),
    ...REVIEWED_UPGRADES.map((p) => loadPriorReviewedUpgrade(projectRoot, p)),
    upgrade,
  ]);
  const manifest = Object.freeze({
    schema: GENERATOR_SCHEMA,
    contract_set_id: snapshot.contract_set_id,
    source_git_sha: snapshot.source_git_sha,
    source_schema_sha256: snapshot.manifest.database.sha256,
    upgrade_source_sha256: sha256(upgradeSourceBody),
    compatibility: Object.freeze({
      current: 'N',
      prior_signed_baseline: Object.freeze({
        contract_set_id: BASELINE.contractSetId,
        source_git_sha: BASELINE.sourceGitSha,
        source_schema_sha256: BASELINE.sourceSchemaSha256,
        migration_count: BASELINE.migrationCount,
      }),
      prior_reviewed_upgrades: Object.freeze(REVIEWED_UPGRADES.map((p) => Object.freeze({
        contract_set_id: p.contractSetId, source_git_sha: p.sourceGitSha,
        source_schema_sha256: p.sourceSchemaSha256, migration_count: p.migrationCount,
      }))),
    }),
    migrations: Object.freeze(migrations.map(({ sql: _sql, ...migration }) => migration)),
  });
  const outputs = new Map();
  for (const migration of migrations) {
    outputs.set(`packages/database/migrations/${migration.file}`, migration.sql);
  }
  outputs.set(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  outputs.set(CATALOGUE_PATH, renderCatalogue(manifest, migrations));
  return Object.freeze({ manifest, migrations, outputs });
}

function outputGroupFor(relativePath) {
  const group = OUTPUT_GROUPS.find(({ prefix }) => relativePath.startsWith(prefix));
  if (!group) {
    throw new Error(`Refusing database generated output outside owned directories: ${relativePath}`);
  }
  const member = relativePath.slice(group.prefix.length);
  if (!member || path.basename(member) !== member) {
    throw new Error(`Refusing nested or invalid database generated output: ${relativePath}`);
  }
  return Object.freeze({ group, member });
}

function expectedMembersByGroup(outputs) {
  const expected = new Map(OUTPUT_GROUPS.map((group) => [group.name, []]));
  for (const relativePath of outputs.keys()) {
    const { group, member } = outputGroupFor(relativePath);
    expected.get(group.name).push(member);
  }
  for (const group of OUTPUT_GROUPS) {
    if (expected.get(group.name).length === 0) {
      throw new Error(`Database generated output group is empty: ${group.name}`);
    }
  }
  return expected;
}

function assertExactDirectoryMembers(directory, expectedMembers, label) {
  if (!existsSync(directory)) {
    throw new Error(`Database generated output group is missing: ${label}`);
  }
  const actual = readdirSync(directory).sort();
  const expected = [...expectedMembers].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Database generated output member drift in ${label}: expected ${expected.join(', ')}, found ${actual.join(', ')}`,
    );
  }
  for (const member of actual) {
    if (!lstatSync(path.join(directory, member)).isFile()) {
      throw new Error(`Database generated output member is not a regular file: ${label}/${member}`);
    }
  }
}

function verifyExactOutputGroups(projectRoot, outputs) {
  const expected = expectedMembersByGroup(outputs);
  for (const group of OUTPUT_GROUPS) {
    assertExactDirectoryMembers(
      path.join(projectRoot, group.target),
      expected.get(group.name),
      group.target,
    );
  }
}

/**
 * Stage every generated byte before replacing either owned output directory.
 * Directory swaps remove stale members, and ordinary I/O failures roll back all
 * groups so callers never observe a knowingly mixed migration/catalogue set.
 * `renameDirectory` is an internal fault-injection seam used by generator tests.
 */
export function publishDatabaseMigrationOutputs(
  projectRoot,
  outputs,
  { renameDirectory = renameSync } = {},
) {
  const databaseRoot = path.join(projectRoot, 'packages/database');
  const expected = expectedMembersByGroup(outputs);
  const stagingRoot = mkdtempSync(path.join(databaseRoot, '.migration-generation-'));
  const publicationId = `${process.pid}-${randomUUID()}`;
  const states = OUTPUT_GROUPS.map((group) => Object.freeze({
    group,
    stage: path.join(stagingRoot, group.name),
    target: path.join(projectRoot, group.target),
    backup: path.join(path.dirname(path.join(projectRoot, group.target)), `.${path.basename(group.target)}.${publicationId}.backup`),
    state: { backedUp: false, published: false },
  }));

  try {
    for (const { stage } of states) {
      mkdirSync(stage, { mode: 0o700 });
    }
    for (const [relativePath, content] of outputs) {
      const { group, member } = outputGroupFor(relativePath);
      const stage = states.find((candidate) => candidate.group.name === group.name)?.stage;
      if (!stage) throw new Error(`Database generated output group is not staged: ${group.name}`);
      writeFileSync(path.join(stage, member), content, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o644,
      });
    }
    for (const { group, stage } of states) {
      assertExactDirectoryMembers(stage, expected.get(group.name), `staged/${group.name}`);
    }

    try {
      for (const publication of states) {
        if (existsSync(publication.target)) {
          renameDirectory(publication.target, publication.backup);
          publication.state.backedUp = true;
        }
        renameDirectory(publication.stage, publication.target);
        publication.state.published = true;
      }
      verifyExactOutputGroups(projectRoot, outputs);
    } catch (publicationError) {
      const rollbackErrors = [];
      for (const publication of [...states].reverse()) {
        try {
          if (publication.state.published && existsSync(publication.target)) {
            rmSync(publication.target, { recursive: true, force: true });
          }
          if (publication.state.backedUp && existsSync(publication.backup)) {
            renameDirectory(publication.backup, publication.target);
          }
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [publicationError, ...rollbackErrors],
          'Database generated output publication failed and rollback was incomplete',
        );
      }
      throw publicationError;
    }

    for (const publication of states) {
      if (publication.state.backedUp) {
        rmSync(publication.backup, { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

export async function generateDatabaseMigrations({ projectRoot = DEFAULT_PROJECT_ROOT, check = false } = {}) {
  const resolvedRoot = path.resolve(projectRoot);
  return withVerifiedContractSetSnapshot({ projectRoot: resolvedRoot }, (snapshot) => {
    const built = buildDatabaseMigrationOutputs(snapshot, { projectRoot: resolvedRoot });
    const relativePaths = [...built.outputs.keys()];
    if (check) {
      verifyExactOutputGroups(resolvedRoot, built.outputs);
      const drift = relativePaths.filter((relativePath) => {
        const target = path.join(resolvedRoot, relativePath);
        return !existsSync(target) || readFileSync(target, 'utf8') !== built.outputs.get(relativePath);
      });
      if (drift.length > 0) {
        throw new Error(`Generated database migrations drifted: ${drift.join(', ')}`);
      }
      return Object.freeze({ status: 'VERIFIED', ...built.manifest });
    }
    publishDatabaseMigrationOutputs(resolvedRoot, built.outputs);
    return Object.freeze({ status: 'GENERATED', ...built.manifest });
  });
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  generateDatabaseMigrations({ check: process.argv.slice(2).includes('--check') })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
