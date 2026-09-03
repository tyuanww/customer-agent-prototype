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
const EXPECTED_DATABASE_SHA256 = 'edf909bf9450b5745a85ced4a75a2e2de3e5b061847562cd3a68c9c7c226da99';
const EXPECTED_SOURCE_LINES = 7684;
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

const UPGRADE_SPEC = Object.freeze({
  position: 11,
  id: '0011_search_no_hit_context_v1_14',
  file: '0011_search_no_hit_context_v1_14.sql',
  source_ranges: Object.freeze([
    Object.freeze({ start_line: 6871, end_line: 6976 }),
    Object.freeze({ start_line: 7523, end_line: 7523 }),
    Object.freeze({ start_line: 7639, end_line: 7639 }),
    Object.freeze({ start_line: 7681, end_line: 7682 }),
  ]),
});

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function sourceLines(source, expectedLines = EXPECTED_SOURCE_LINES) {
  if (!source.endsWith('\n')) {
    throw new Error('Database contract must end with one LF');
  }
  if (source.includes('\r')) {
    throw new Error('Database contract must use LF line endings');
  }
  const lines = source.slice(0, -1).split('\n');
  if (lines.length !== expectedLines) {
    throw new Error(`Database contract line count drift: ${lines.length}`);
  }
  if (lines[14] !== 'BEGIN;' || lines[15] !== 'SET LOCAL search_path = public, pg_catalog, pg_temp;' || lines.at(-1) !== 'COMMIT;') {
    throw new Error('Database contract outer transaction anchors drifted');
  }
  return lines;
}

function linesForRanges(lines, ranges) {
  return ranges
    .map(({ start_line: startLine, end_line: endLine }) => lines.slice(startLine - 1, endLine).join('\n'))
    .join('\n');
}

function replaceExactly(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label} must occur exactly once in the database contract`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function anchoredBlock(source, startAnchor, endAnchor, label) {
  const start = source.indexOf(startAnchor);
  if (start < 0 || source.indexOf(startAnchor, start + startAnchor.length) >= 0) {
    throw new Error(`${label} start anchor drifted`);
  }
  const end = source.indexOf(endAnchor, start);
  if (end < 0) throw new Error(`${label} end anchor drifted`);
  return source.slice(start, end + endAnchor.length);
}

function finalSchemaComment(source) {
  const anchor = 'COMMENT ON SCHEMA public IS\n';
  const start = source.lastIndexOf(anchor);
  if (start < 0) throw new Error('Schema comment anchor drifted');
  const end = source.indexOf("';", start);
  if (end < 0) throw new Error('Schema comment terminator drifted');
  return source.slice(start, end + 2);
}

function reviewedContractSource(projectRoot, provenance, expectedLines) {
  const sourcePath = path.join(
    projectRoot,
    'contracts/upstream/customer-agent',
    provenance.contractSetId,
    provenance.schemaFile,
  );
  if (!existsSync(sourcePath) || !lstatSync(sourcePath).isFile()) {
    throw new Error(`Immutable reviewed source is missing: ${provenance.schemaFile}`);
  }
  const source = readFileSync(sourcePath, 'utf8');
  if (sha256(source) !== provenance.sourceSchemaSha256) {
    throw new Error(`Immutable reviewed source drifted: ${provenance.schemaFile}`);
  }
  sourceLines(source, expectedLines);
  return source;
}

function assertUpgradeScope(projectRoot, currentSource) {
  const baseline = reviewedContractSource(projectRoot, PRIOR_REVIEWED_UPGRADE, 7669);
  const searchStart = '-- The only app_runtime-readable search boundary.';
  const searchEnd = 'REVOKE ALL ON FUNCTION search_recommendable_scripts(TEXT,TEXT,TEXT) FROM PUBLIC;';
  let expected = replaceExactly(
    baseline,
    baseline.slice(0, baseline.indexOf('\n')),
    currentSource.slice(0, currentSource.indexOf('\n')),
    'Schema version header',
  );
  expected = replaceExactly(
    expected,
    anchoredBlock(baseline, searchStart, searchEnd, 'schema.v1.13 search function'),
    anchoredBlock(currentSource, searchStart, searchEnd, 'schema.v1.14 search function'),
    'Search function upgrade',
  );
  expected = replaceExactly(
    expected,
    finalSchemaComment(baseline),
    finalSchemaComment(currentSource),
    'Schema comment upgrade',
  );
  if (expected !== currentSource) {
    throw new Error('schema.v1.14 contains changes outside the reviewed immutable upgrade scope');
  }
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

function loadPriorReviewedUpgrade(projectRoot) {
  const migrationPath = path.join(
    projectRoot,
    'packages/database/migrations',
    PRIOR_REVIEWED_UPGRADE.file,
  );
  if (!existsSync(migrationPath) || !lstatSync(migrationPath).isFile()) {
    throw new Error(`Immutable reviewed migration is missing: ${PRIOR_REVIEWED_UPGRADE.file}`);
  }
  const sql = readFileSync(migrationPath, 'utf8');
  if (
    Buffer.byteLength(sql) !== PRIOR_REVIEWED_UPGRADE.bytes
    || sha256(sql) !== PRIOR_REVIEWED_UPGRADE.sha256
  ) {
    throw new Error(`Immutable reviewed migration drifted: ${PRIOR_REVIEWED_UPGRADE.file}`);
  }
  for (const anchor of [
    PRIOR_REVIEWED_UPGRADE.contractSetId,
    PRIOR_REVIEWED_UPGRADE.sourceGitSha,
    PRIOR_REVIEWED_UPGRADE.sourceSchemaSha256,
  ]) {
    if (!sql.includes(anchor)) {
      throw new Error(`Reviewed provenance is missing from ${PRIOR_REVIEWED_UPGRADE.file}`);
    }
  }
  const {
    migrationCount: _migrationCount,
    schemaFile: _schemaFile,
    contractSetId,
    sourceGitSha,
    sourceSchemaSha256,
    ...descriptor
  } = PRIOR_REVIEWED_UPGRADE;
  return Object.freeze({
    ...descriptor,
    contract_set_id: contractSetId,
    source_git_sha: sourceGitSha,
    source_schema_sha256: sourceSchemaSha256,
    sql,
  });
}

function renderUpgradeMigration(lines, snapshot) {
  const sourceBody = linesForRanges(lines, UPGRADE_SPEC.source_ranges);
  for (const anchor of [
    'DROP FUNCTION IF EXISTS search_recommendable_scripts(TEXT,TEXT,TEXT);',
    'is_candidate BOOLEAN',
    'candidate.script_id IS NOT NULL',
    'public.content_public_questions(candidate.questions_json)',
    'ALTER FUNCTION public.search_recommendable_scripts(TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;',
    'GRANT EXECUTE ON FUNCTION public.search_recommendable_scripts(TEXT,TEXT,TEXT) TO app_runtime;',
    'CS-AI-C11 schema.v1.14;',
  ]) {
    if (!sourceBody.includes(anchor)) throw new Error(`${UPGRADE_SPEC.id} source anchor drifted: ${anchor}`);
  }
  const ranges = UPGRADE_SPEC.source_ranges
    .map(({ start_line: startLine, end_line: endLine }) => `${startLine}-${endLine}`)
    .join(', ');
  const parts = [
    `-- ${GENERATED_HEADER}`,
    `-- ${UPGRADE_SPEC.id}; source schema.v1.14 lines ${ranges}`,
    `-- contract_set_id=${snapshot.contract_set_id}`,
    `-- source_git_sha=${snapshot.source_git_sha}`,
    `-- source_schema_sha256=${snapshot.manifest.database.sha256}`,
    'SET LOCAL search_path = public, pg_catalog, pg_temp;',
    '',
    sourceBody,
    '',
  ];
  const sql = `${parts.join('\n').replace(/\n+$/, '')}\n`;
  return Object.freeze({
    ...UPGRADE_SPEC,
    sha256: sha256(sql),
    bytes: Buffer.byteLength(sql),
    contract_set_id: snapshot.contract_set_id,
    source_git_sha: snapshot.source_git_sha,
    source_schema_sha256: snapshot.manifest.database.sha256,
    sql,
  });
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
  return `// ${GENERATED_HEADER}\nimport type { ExecutableMigrationCatalogue } from '../types.js';\n\nexport const generatedMigrationCatalogue: ExecutableMigrationCatalogue = Object.freeze({\n  schema: ${JSON.stringify(manifest.schema)},\n  contractSetId: ${JSON.stringify(manifest.contract_set_id)},\n  sourceGitSha: ${JSON.stringify(manifest.source_git_sha)},\n  sourceSchemaSha256: ${JSON.stringify(manifest.source_schema_sha256)},\n  compatibility: Object.freeze({ current: 'N', priorSignedBaseline: Object.freeze({ contractSetId: ${JSON.stringify(BASELINE.contractSetId)}, sourceGitSha: ${JSON.stringify(BASELINE.sourceGitSha)}, sourceSchemaSha256: ${JSON.stringify(BASELINE.sourceSchemaSha256)}, migrationCount: ${BASELINE.migrationCount} }), priorReviewedUpgrades: Object.freeze([{ contractSetId: ${JSON.stringify(PRIOR_REVIEWED_UPGRADE.contractSetId)}, sourceGitSha: ${JSON.stringify(PRIOR_REVIEWED_UPGRADE.sourceGitSha)}, sourceSchemaSha256: ${JSON.stringify(PRIOR_REVIEWED_UPGRADE.sourceSchemaSha256)}, migrationCount: ${PRIOR_REVIEWED_UPGRADE.migrationCount} }]) }),\n  migrations: Object.freeze([\n${migrationEntries}\n  ]),\n});\n`;
}

export function buildDatabaseMigrationOutputs(snapshot, { projectRoot = DEFAULT_PROJECT_ROOT } = {}) {
  if (!snapshot || typeof snapshot.database_source !== 'string') {
    throw new Error('Verified contract snapshot is missing database_source');
  }
  if (snapshot.manifest?.database?.sha256 !== EXPECTED_DATABASE_SHA256 || sha256(snapshot.database_source) !== EXPECTED_DATABASE_SHA256) {
    throw new Error('Database contract SHA-256 drifted; explicitly review and version the migration generator');
  }
  const lines = sourceLines(snapshot.database_source);
  assertUpgradeScope(projectRoot, snapshot.database_source);
  const upgrade = renderUpgradeMigration(lines, snapshot);
  const migrations = Object.freeze([
    ...loadBaselineMigrations(projectRoot),
    loadPriorReviewedUpgrade(projectRoot),
    upgrade,
  ]);
  const upgradeSourceBody = linesForRanges(lines, UPGRADE_SPEC.source_ranges);
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
      prior_reviewed_upgrades: Object.freeze([
        Object.freeze({
          contract_set_id: PRIOR_REVIEWED_UPGRADE.contractSetId,
          source_git_sha: PRIOR_REVIEWED_UPGRADE.sourceGitSha,
          source_schema_sha256: PRIOR_REVIEWED_UPGRADE.sourceSchemaSha256,
          migration_count: PRIOR_REVIEWED_UPGRADE.migrationCount,
        }),
      ]),
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
