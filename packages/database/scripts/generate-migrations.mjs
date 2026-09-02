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

const GENERATOR_SCHEMA = 'customer-agent-database-migrations/v1';
const GENERATED_HEADER = 'GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.';
const EXPECTED_DATABASE_SHA256 = '47b667958e522a28df1c04d7c79a56c930bfe0ac04598321824b55744ac4a801';
const EXPECTED_SOURCE_LINES = 7661;
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

const LEDGER_BOOTSTRAP_SQL = `-- Runner control plane is part of 0001, never an untracked hidden migration.
CREATE SCHEMA customer_agent_meta;
REVOKE ALL ON SCHEMA customer_agent_meta FROM PUBLIC;

CREATE TABLE customer_agent_meta.schema_migrations (
  position              INTEGER PRIMARY KEY CHECK (position > 0),
  migration_id          TEXT NOT NULL UNIQUE CHECK (migration_id ~ '^[0-9]{4}_[a-z0-9_]+$'),
  migration_sha256      TEXT NOT NULL CHECK (migration_sha256 ~ '^[0-9a-f]{64}$'),
  contract_set_id       TEXT NOT NULL,
  source_git_sha        TEXT NOT NULL CHECK (source_git_sha ~ '^[0-9a-f]{40}$'),
  source_schema_sha256  TEXT NOT NULL CHECK (source_schema_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at            TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  execution_ms          INTEGER NOT NULL CHECK (execution_ms >= 0)
);
REVOKE ALL ON TABLE customer_agent_meta.schema_migrations FROM PUBLIC;
COMMENT ON SCHEMA customer_agent_meta IS
  'CS-AI-C11 migration control plane; owner-only immutable catalogue ledger';
COMMENT ON TABLE customer_agent_meta.schema_migrations IS
  'Applied immutable migrations; drift is fail-closed and never auto-repaired';`;

const MIGRATION_SPECS = Object.freeze([
  Object.freeze({ id: '0001_extensions', ranges: Object.freeze([[17, 97]]), anchor: 'DO $install_preflight$', prelude: LEDGER_BOOTSTRAP_SQL }),
  Object.freeze({ id: '0002_identity_and_content', ranges: Object.freeze([[98, 981]]), anchor: 'Identity (minimal' }),
  Object.freeze({ id: '0003_events_and_metrics', ranges: Object.freeze([[982, 1748]]), anchor: 'Events' }),
  Object.freeze({ id: '0004_import_release_announce', ranges: Object.freeze([[1749, 2630]]), anchor: 'Multi-user content' }),
  Object.freeze({ id: '0005_idempotency_rate_limit_outbox', ranges: Object.freeze([[2651, 2771]]), anchor: 'NFR v1.3' }),
  Object.freeze({ id: '0006_definer_functions_and_triggers', ranges: Object.freeze([[2772, 6782]]), anchor: 'trg_release_items_immutable' }),
  Object.freeze({ id: '0007_search_bigram', ranges: Object.freeze([[6783, 7405]]), anchor: 'Runtime gate' }),
  Object.freeze({ id: '0008_runtime_acl', ranges: Object.freeze([[7406, 7657]]), anchor: 'Executable fail-closed ACL' }),
  Object.freeze({ id: '0009_phase1_policy_seed', ranges: Object.freeze([[2631, 2650], [7658, 7660]]), anchor: 'INSERT INTO policy_flags' }),
]);

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function sourceLines(source) {
  if (!source.endsWith('\n')) {
    throw new Error('Database contract must end with one LF');
  }
  if (source.includes('\r')) {
    throw new Error('Database contract must use LF line endings');
  }
  const lines = source.slice(0, -1).split('\n');
  if (lines.length !== EXPECTED_SOURCE_LINES) {
    throw new Error(`Database contract line count drift: ${lines.length}`);
  }
  if (lines[14] !== 'BEGIN;' || lines[15] !== 'SET LOCAL search_path = public, pg_catalog, pg_temp;' || lines[7660] !== 'COMMIT;') {
    throw new Error('Database contract outer transaction anchors drifted');
  }
  return lines;
}

function assertCompleteCoverage() {
  const covered = new Map();
  for (const spec of MIGRATION_SPECS) {
    for (const [startLine, endLine] of spec.ranges) {
      for (let line = startLine; line <= endLine; line += 1) {
        const previous = covered.get(line);
        if (previous) {
          throw new Error(`Database source line ${line} is assigned to both ${previous} and ${spec.id}`);
        }
        covered.set(line, spec.id);
      }
    }
  }
  const missing = [];
  for (let line = 17; line <= 7660; line += 1) {
    if (!covered.has(line)) missing.push(line);
  }
  if (missing.length > 0 || covered.size !== 7644) {
    throw new Error(`Database migration source coverage drift: missing ${missing.slice(0, 8).join(',')}`);
  }
}

function linesForRanges(lines, ranges) {
  return ranges.map(([startLine, endLine]) => lines.slice(startLine - 1, endLine).join('\n')).join('\n');
}

function renderMigration({ spec, position, lines, snapshot }) {
  const sourceBody = linesForRanges(lines, spec.ranges);
  if (!sourceBody.includes(spec.anchor)) {
    throw new Error(`${spec.id} source anchor drifted`);
  }
  const ranges = spec.ranges.map(([startLine, endLine]) => `${startLine}-${endLine}`).join(', ');
  const parts = [
    `-- ${GENERATED_HEADER}`,
    `-- ${spec.id}; source schema.v1.12 lines ${ranges}`,
    `-- contract_set_id=${snapshot.contract_set_id}`,
    `-- source_git_sha=${snapshot.source_git_sha}`,
    `-- source_schema_sha256=${snapshot.manifest.database.sha256}`,
    'SET LOCAL search_path = public, pg_catalog, pg_temp;',
    '',
  ];
  if (spec.prelude) parts.push(spec.prelude, '');
  parts.push(sourceBody, '');
  const sql = `${parts.join('\n').replace(/\n+$/, '')}\n`;
  return Object.freeze({
    position,
    id: spec.id,
    file: `${spec.id}.sql`,
    sha256: sha256(sql),
    bytes: Buffer.byteLength(sql),
    source_ranges: Object.freeze(spec.ranges.map(([startLine, endLine]) => Object.freeze({ start_line: startLine, end_line: endLine }))),
    sql,
  });
}

function renderCatalogue(manifest, migrations) {
  const migrationEntries = migrations.map((migration) => `  Object.freeze({
    position: ${migration.position},
    id: ${JSON.stringify(migration.id)},
    sha256: ${JSON.stringify(migration.sha256)},
    bytes: ${migration.bytes},
    sourceRanges: Object.freeze(${JSON.stringify(migration.source_ranges.map((range) => ({ startLine: range.start_line, endLine: range.end_line })))}),
    sql: ${JSON.stringify(migration.sql)},
  })`).join(',\n');
  return `// ${GENERATED_HEADER}\nimport type { ExecutableMigrationCatalogue } from '../types.js';\n\nexport const generatedMigrationCatalogue: ExecutableMigrationCatalogue = Object.freeze({\n  schema: ${JSON.stringify(manifest.schema)},\n  contractSetId: ${JSON.stringify(manifest.contract_set_id)},\n  sourceGitSha: ${JSON.stringify(manifest.source_git_sha)},\n  sourceSchemaSha256: ${JSON.stringify(manifest.source_schema_sha256)},\n  compatibility: Object.freeze({ current: 'N', priorSignedBaseline: null }),\n  migrations: Object.freeze([\n${migrationEntries}\n  ]),\n});\n`;
}

export function buildDatabaseMigrationOutputs(snapshot) {
  if (!snapshot || typeof snapshot.database_source !== 'string') {
    throw new Error('Verified contract snapshot is missing database_source');
  }
  if (snapshot.manifest?.database?.sha256 !== EXPECTED_DATABASE_SHA256 || sha256(snapshot.database_source) !== EXPECTED_DATABASE_SHA256) {
    throw new Error('Database contract SHA-256 drifted; explicitly review and version the migration generator');
  }
  assertCompleteCoverage();
  const lines = sourceLines(snapshot.database_source);
  const migrations = Object.freeze(MIGRATION_SPECS.map((spec, index) => renderMigration({ spec, position: index + 1, lines, snapshot })));
  const reconstructedSourceBody = migrations
    .flatMap((migration) => migration.source_ranges.flatMap(({ start_line: startLine, end_line: endLine }) =>
      Array.from({ length: endLine - startLine + 1 }, (_, index) => ({
        line: startLine + index,
        text: lines[startLine + index - 1],
      }))))
    .sort((left, right) => left.line - right.line)
    .map(({ text }) => text)
    .join('\n');
  const expectedSourceBody = lines.slice(16, 7660).join('\n');
  if (reconstructedSourceBody !== expectedSourceBody) {
    throw new Error('Database executable source body cannot be reconstructed byte-for-byte from migration ranges');
  }
  const manifest = Object.freeze({
    schema: GENERATOR_SCHEMA,
    contract_set_id: snapshot.contract_set_id,
    source_git_sha: snapshot.source_git_sha,
    source_schema_sha256: snapshot.manifest.database.sha256,
    executable_source_sha256: sha256(expectedSourceBody),
    compatibility: Object.freeze({ current: 'N', prior_signed_baseline: null }),
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
    const built = buildDatabaseMigrationOutputs(snapshot);
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
