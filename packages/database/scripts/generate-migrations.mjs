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
import { GENERATED_HEADER, renderUpgradeMigration, renderRepairMigration, renderReadinessMigration } from './migration-artifact.mjs';
import { withVerifiedContractSetSnapshot } from '../../../scripts/customer-agent-contract-set.mjs';

const GENERATOR_SCHEMA = 'customer-agent-database-migrations/v2';

const EXPECTED_DATABASE_SHA256 = 'c5e4896e8ed1ff587e23a70723bd9d81c056ba65561cd9d94963aa6b5f1ae3ce';
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
const PRIOR_V1_17 = Object.freeze({
  position: 14,
  id: '0014_release_deferred_guard_v1_17',
  file: '0014_release_deferred_guard_v1_17.sql',
  sha256: 'ee7615d9ca7b05b01f66646393fbf26f1757a882b027a3fd6be415872a269339',
  bytes: 912,
  source_ranges: Object.freeze([Object.freeze({ start_line: 10726, end_line: 10730 })]),
  contractSetId: 'cs-ai-c11-openapi-1.13.0-schema-1.17-0904a0aa11f2',
  sourceGitSha: '0904a0aa11f2dc29ae7700871a943c41295cd329',
  sourceSchemaSha256: '419d84fbe827a5803b731250145e97786f6cb76c6d7aa9b3bc21bcac3c90f133',
  migrationCount: 14,
  schemaFile: 'schema-v1.17.sql',
});
const PRIOR_V1_18 = Object.freeze({
  "position": 15,
  "id": "0015_ops_loop_v1_18",
  "file": "0015_ops_loop_v1_18.sql",
  "source_ranges": [
    {
      "start_line": 10739,
      "end_line": 11309
    }
  ],
  "sha256": "e7ac1d9c5f487336b63ed4a8abeb66031dbcd3189286fbd2d07b97407685613b",
  "bytes": 22449,
  "contractSetId": "cs-ai-c11-openapi-1.14.0-schema-1.18-260ef224c534",
  "sourceGitSha": "260ef224c5340a4d26e857bd02119044dd813f9a",
  "sourceSchemaSha256": "5713f80e9abfd72592ad49955efb83cd8498ce9cd6c7be52b96c57bcde836caa",
  "migrationCount": 19,
  "schemaFile": "schema-v1.18.sql"
});
const REVIEWED_UPGRADES = Object.freeze([PRIOR_REVIEWED_UPGRADE, PRIOR_V1_14, PRIOR_V1_15, PRIOR_V1_16, PRIOR_V1_17, PRIOR_V1_18]);

const PRIOR_INTAKE = Object.freeze({
  "contractSetId": "cs-ai-c11-openapi-1.16.0-schema-1.20-d029cb0908fa",
  "sourceGitSha": "d029cb0908faf9a0d1c1ffc1c8a5fcf39784d713",
  "sourceSchemaSha256": "1418537f66274657f8221896387933b4a00a15c23253993541c3bb0ca8964d41",
  "migrationCount": 24,
  "schemaFile": "schema-v1.20.sql"
});
// A wire-only intake must not rewrite already applied SQL provenance/checksums.
const PRIOR_USAGE = Object.freeze({
  contractSetId: 'cs-ai-c11-openapi-1.17.0-schema-1.21-53906e302288',
  sourceGitSha: '53906e302288fe0fb70e58b24a40088ecbbd3ef6',
  sourceSchemaSha256: '5f958e4f7dcde7e11f9a6d38d8339b96654517209a493776acbfc7c3f5202013',
  migrationCount: 26,
});
const PRIOR_QUALITY = Object.freeze({
  contractSetId: 'cs-ai-c11-openapi-1.18.0-schema-1.21-18297cf802b1',
  sourceGitSha: '18297cf802b195d8ff4e9f625143e50bff169418',
  sourceSchemaSha256: '5f958e4f7dcde7e11f9a6d38d8339b96654517209a493776acbfc7c3f5202013',
  migrationCount: 26,
});
const PRIOR_MANAGEMENT = Object.freeze({
  contractSetId: 'cs-ai-c11-openapi-1.19.0-schema-1.21-240ae98a47d8',
  sourceGitSha: '240ae98a47d8b9432559c298f60af6fdc9ba8c4e',
  sourceSchemaSha256: '5f958e4f7dcde7e11f9a6d38d8339b96654517209a493776acbfc7c3f5202013',
  migrationCount: 30,
});
const COMPATIBLE_UPGRADES = Object.freeze([...REVIEWED_UPGRADES, PRIOR_INTAKE, PRIOR_USAGE, PRIOR_QUALITY, PRIOR_MANAGEMENT]);
const FROZEN_INTAKE_OVERLAYS = Object.freeze([
  {
    "position": 22,
    "id": "0022_intake_legacy_fence",
    "file": "0022_intake_legacy_fence.sql",
    "sha256": "8df4f9127362aa49c320b87d7afffd910312d54fab7193224e3bece5993a8b03",
    "bytes": 12524,
    "source_ranges": []
  },
  {
    "position": 23,
    "id": "0023_intake_quality",
    "file": "0023_intake_quality.sql",
    "sha256": "c3b37131c28b76b2453e24d5f432e70329c478a7f90d34c95598518124e50136",
    "bytes": 8475,
    "source_ranges": []
  },
  {
    "position": 24,
    "id": "0024_intake_publication",
    "file": "0024_intake_publication.sql",
    "sha256": "9b3b1d0ae32f0fc6e0f333428ac52c2e688c57aad1e610bbb6bb7c94e4d13af2",
    "bytes": 13591,
    "source_ranges": []
  }
]);

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function linesForRanges(lines, ranges) {
  return ranges.map(({ start_line, end_line }) => lines.slice(start_line - 1, end_line).join('\n')).join('\n');
}

// Only append the two bounded increments. The complete v1.18 input and all
// previously shipped migrations keep their original bytes and provenance.
function intakeUpgradeSlices(source, projectRoot) {
  const previousPath = path.join(projectRoot, 'contracts/upstream/customer-agent', PRIOR_V1_18.contractSetId, PRIOR_V1_18.schemaFile);
  if (!existsSync(previousPath) || !lstatSync(previousPath).isFile()) throw new Error('Immutable v1.18 source must be a regular file');
  const previous = readFileSync(previousPath, 'utf8');
  if (sha256(previous) !== PRIOR_V1_18.sourceSchemaSha256) throw new Error('Immutable v1.18 digest drifted');
  const prefix = '-- schema.v1.20 — content-intake additive storage contract candidate\n'
    + '-- schema.v1.19 — coach product/campaign publish clean-install reference\n' + previous + '\n';
  if (!source.startsWith(prefix)) throw new Error('Content-intake predecessor differs from immutable v1.18');
  const rest = source.slice(prefix.length);
  const match = rest.match(/^-- BEGIN COACH PUBLISH ([0-9a-f]{64})\n([\s\S]+)-- END COACH PUBLISH\n\n-- BEGIN CONTENT INTAKE ([0-9a-f]{64})\n([\s\S]+)-- END CONTENT INTAKE\n$/);
  if (!match || sha256(match[2]) !== match[1] || sha256(match[4]) !== match[3]) throw new Error('Content-intake increment digest drifted');
  const lines = source.trimEnd().split('\n');
  return [
    { position: 20, id: '0020_coach_publish_v1_19', version: 'schema.v1.19', body: match[2], wrapped: false },
    { position: 21, id: '0021_content_intake_v1_20', version: 'schema.v1.20', body: match[4], wrapped: true },
  ].map(({ body, wrapped, ...descriptor }) => {
    const bodyLines = body.trimEnd().split('\n');
    const offset = source.slice(0, source.indexOf(body, prefix.length)).split('\n').length;
    const begin = bodyLines.indexOf('BEGIN;');
    if (wrapped && (begin < 0 || bodyLines.filter(line => line === 'BEGIN;').length !== 1 || bodyLines.at(-1) !== 'COMMIT;' || bodyLines.filter(line => line === 'COMMIT;').length !== 1)) throw new Error('Content-intake transaction anchors drifted');
    if (!wrapped && bodyLines.some(line => line === 'BEGIN;' || line === 'COMMIT;')) throw new Error('Unexpected coach transaction anchor');
    const ranges = [{ start_line: offset + (wrapped ? begin + 1 : 0), end_line: offset + bodyLines.length - (wrapped ? 2 : 1) }];
    return { ...descriptor, ranges, sourceBody: linesForRanges(lines, ranges) };
  });
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

// The four existing product overlays were shipped against v1.18. Re-stamping
// their headers with a newer contract would break installed ledger checksums.
const FROZEN_PRODUCT_OVERLAYS = Object.freeze([
  {
    "position": 16,
    "id": "0016_office_owner_publish",
    "file": "0016_office_owner_publish.sql",
    "sha256": "d574ebd891e3a7db771e6f6a5fb7a85f6e6d3614c7880f2dea4b4bb642d6b447",
    "bytes": 21181,
    "source_ranges": []
  },
  {
    "position": 17,
    "id": "0017_rollback_previous_target",
    "file": "0017_rollback_previous_target.sql",
    "sha256": "eb3ccbf3f04c4005393fc757b8f1e03d55a5078837b2b8eb9dbac72d83116788",
    "bytes": 3969,
    "source_ranges": []
  },
  {
    "position": 18,
    "id": "0018_owner_read_views",
    "file": "0018_owner_read_views.sql",
    "sha256": "c89d76992850aa562a3d24618bccb39a941a8bc88136342505a9edea5440acba",
    "bytes": 7394,
    "source_ranges": []
  },
  {
    "position": 19,
    "id": "0019_candidate_client_snapshot",
    "file": "0019_candidate_client_snapshot.sql",
    "sha256": "e4720feabd0a9b92d8d5cc22fcb6dcce75cf6e8136c0b2d9365d0d7c1cf18cd7",
    "bytes": 5158,
    "source_ranges": []
  }
]);


function loadFrozenProductOverlay(projectRoot, descriptor) {
  const migration = loadPriorReviewedUpgrade(projectRoot, { ...PRIOR_V1_18, ...descriptor });
  const sourcePath = path.join(projectRoot, 'packages/database/overlays', descriptor.file);
  if (!existsSync(sourcePath) || !lstatSync(sourcePath).isFile()) throw new Error(`Product overlay source is missing: ${descriptor.file}`);
  const expected = [
    `-- ${GENERATED_HEADER}`,
    `-- ${descriptor.id}; product overlay (not a frozen contract snapshot slice)`,
    `-- contract_set_id=${PRIOR_V1_18.contractSetId}`,
    `-- source_git_sha=${PRIOR_V1_18.sourceGitSha}`,
    `-- source_schema_sha256=${PRIOR_V1_18.sourceSchemaSha256}`,
    readFileSync(sourcePath, 'utf8').trimEnd(), '',
  ].join('\n');
  if (migration.sql !== expected) throw new Error(`Frozen product overlay source drifted: ${descriptor.file}; append a new migration instead`);
  return migration;
}

function findSopSuccessor(projectRoot) {
  const upstream = path.join(projectRoot, 'contracts/upstream/customer-agent');
  if (!existsSync(upstream)) return null;
  const found = readdirSync(upstream).flatMap((name) => {
    const manifestPath = path.join(upstream, name, 'contract-set.json');
    if (!existsSync(manifestPath)) return [];
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return manifest.schema === 'customer-agent-contract-set/v5' ? [{ dir: path.join(upstream, name), manifest }] : [];
  });
  if (found.length > 1) throw new Error('More than one SOP successor contract set is present');
  return found[0] ?? null;
}

function renderSopMigration(successor) {
  const database = readFileSync(path.join(successor.dir, successor.manifest.database.file), 'utf8');
  if (sha256(database) !== successor.manifest.database.sha256) throw new Error('SOP successor schema drifted');
  const start = database.indexOf('-- BEGIN SOP MEDIA CONTRACT');
  const end = database.indexOf('-- END SOP MEDIA CONTRACT');
  if (start < 0 || end < start) throw new Error('SOP successor increment is missing');
  const sourceBody = database.slice(start, end).trimEnd().split('\n').filter(line => line !== 'BEGIN;' && line !== 'COMMIT;').join('\n');
  if (/CREATE ROLE|\bGRANT\b/i.test(sourceBody)) throw new Error('SOP successor increment grants or creates a role');
  if (!sourceBody.includes('OWNER TO intake_runtime_fn_owner')) throw new Error('SOP successor tables lack the existing owner');
  return renderUpgradeMigration({
    position: 36,
    id: '0036_intake_sop_v1_26',
    version: 'schema.v1.26 SOP additive successor',
    ranges: [],
    sourceBody,
  }, {
    contract_set_id: successor.manifest.contract_set_id,
    source_git_sha: successor.manifest.source_git_sha,
    manifest: successor.manifest,
  });
}

// New product overlays are appended after the frozen contract increments. Their
// provenance stays tied to this intake; old overlay headers are never restamped.
function renderIntakeOverlay(projectRoot, snapshot, position, id) {
  const sql = [
    `-- ${GENERATED_HEADER}`,
    `-- ${id}; product overlay (not a frozen contract snapshot slice)`,
    `-- contract_set_id=${snapshot.contract_set_id}`,
    `-- source_git_sha=${snapshot.source_git_sha}`,
    `-- source_schema_sha256=${snapshot.manifest.database.sha256}`,
    readFileSync(path.join(projectRoot, 'packages/database/overlays', `${id}.sql`), 'utf8').trimEnd(), '',
  ].join('\n');
  return Object.freeze({ position, id, file: `${id}.sql`, source_ranges: [],
    sha256: sha256(sql), bytes: Buffer.byteLength(sql),
    contract_set_id: snapshot.contract_set_id, source_git_sha: snapshot.source_git_sha,
    source_schema_sha256: snapshot.manifest.database.sha256, sql });
}

function additiveSuccessorLiteral(manifest) {
  const successor = manifest.compatibility?.additive_successor;
  if (!successor) return 'null';
  return `Object.freeze(${JSON.stringify({
    contractSetId: successor.contract_set_id,
    sourceGitSha: successor.source_git_sha,
    sourceSchemaSha256: successor.source_schema_sha256,
  })})`;
}

function renderCatalogue(manifest, migrations, compatibleUpgrades) {
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
  return `// ${GENERATED_HEADER}\nimport type { ExecutableMigrationCatalogue } from '../types.js';\n\nexport const generatedMigrationCatalogue: ExecutableMigrationCatalogue = Object.freeze({\n  schema: ${JSON.stringify(manifest.schema)},\n  contractSetId: ${JSON.stringify(manifest.contract_set_id)},\n  sourceGitSha: ${JSON.stringify(manifest.source_git_sha)},\n  sourceSchemaSha256: ${JSON.stringify(manifest.source_schema_sha256)},\n  compatibility: Object.freeze({ current: 'N', priorSignedBaseline: Object.freeze({ contractSetId: ${JSON.stringify(BASELINE.contractSetId)}, sourceGitSha: ${JSON.stringify(BASELINE.sourceGitSha)}, sourceSchemaSha256: ${JSON.stringify(BASELINE.sourceSchemaSha256)}, migrationCount: ${BASELINE.migrationCount} }), priorReviewedUpgrades: Object.freeze(${JSON.stringify(compatibleUpgrades.map((p) => ({ contractSetId: p.contractSetId, sourceGitSha: p.sourceGitSha, sourceSchemaSha256: p.sourceSchemaSha256, migrationCount: p.migrationCount })))}), additiveSuccessor: ${additiveSuccessorLiteral(manifest)}${manifest.compatibility.repair_successor ? `, repairSuccessor: Object.freeze(${JSON.stringify({ contractSetId: manifest.compatibility.repair_successor.contract_set_id, sourceGitSha: manifest.compatibility.repair_successor.source_git_sha, sourceSchemaSha256: manifest.compatibility.repair_successor.source_schema_sha256, migrationSha256: manifest.compatibility.repair_successor.migration_sha256 })})` : ''}${manifest.compatibility.readiness_successor ? `, readinessSuccessor: Object.freeze(${JSON.stringify({ contractSetId: manifest.compatibility.readiness_successor.contract_set_id, sourceGitSha: manifest.compatibility.readiness_successor.source_git_sha, sourceSchemaSha256: manifest.compatibility.readiness_successor.source_schema_sha256, migrationSha256: manifest.compatibility.readiness_successor.migration_sha256 })})` : ''} }),\n  migrations: Object.freeze([\n${migrationEntries}\n  ]),\n});\n`;
}

function buildDirectMigrationOutputs(snapshot, { projectRoot = DEFAULT_PROJECT_ROOT } = {}) {
  if (!snapshot || typeof snapshot.database_source !== 'string') {
    throw new Error('Verified contract snapshot is missing database_source');
  }
  if (snapshot.manifest?.database?.sha256 !== EXPECTED_DATABASE_SHA256 || sha256(snapshot.database_source) !== EXPECTED_DATABASE_SHA256) {
    throw new Error('Database contract SHA-256 drifted; explicitly review and version the migration generator');
  }
  const usageSource = readFileSync(path.join(projectRoot, 'contracts/upstream/customer-agent',
    PRIOR_MANAGEMENT.contractSetId, 'schema-v1.21.sql'), 'utf8');
  if (sha256(usageSource) !== PRIOR_MANAGEMENT.sourceSchemaSha256) throw new Error('Immutable management predecessor digest drifted');
  const directPrefix = '-- schema.v1.22 — DRAFT confirmed direct publication\n' + usageSource + '\n';
  if (!snapshot.database_source.startsWith(directPrefix)) throw new Error('Direct predecessor differs from immutable v1.21');
  const directMatch = snapshot.database_source.slice(directPrefix.length).match(/^-- BEGIN INTAKE DIRECT ([0-9a-f]{64})\n([\s\S]+)-- END INTAKE DIRECT\n$/);
  if (!directMatch || sha256(directMatch[2]) !== directMatch[1]) throw new Error('Direct increment digest drifted');
  const directStart = directPrefix.split('\n').length + 1;
  const directRanges = [{ start_line: directStart, end_line: directStart + directMatch[2].trimEnd().split('\n').length - 1 }];
  const directMigration = renderUpgradeMigration({ position: 31, id: '0031_intake_direct_v1_22',
    version: 'schema.v1.22', ranges: directRanges, sourceBody: directMatch[2].trimEnd() }, snapshot);
  const previousPath = path.join(projectRoot, 'contracts/upstream/customer-agent', PRIOR_INTAKE.contractSetId, PRIOR_INTAKE.schemaFile);
  const previous = readFileSync(previousPath, 'utf8');
  if (sha256(previous) !== PRIOR_INTAKE.sourceSchemaSha256) throw new Error('Immutable intake predecessor digest drifted');
  const prefix = '-- schema.v1.21 — DRAFT usage-context additive storage contract\n' + previous + '\n';
  if (!usageSource.startsWith(prefix)) throw new Error('Usage predecessor differs from immutable v1.20');
  const match = usageSource.slice(prefix.length).match(/^-- BEGIN INTAKE USAGE ([0-9a-f]{64})\n([\s\S]+)-- END INTAKE USAGE\n$/);
  if (!match || sha256(match[2]) !== match[1]) throw new Error('Usage increment digest drifted');
  const bodyLines = match[2].trimEnd().split('\n');
  const begin = bodyLines.indexOf('BEGIN;');
  if (begin < 0 || bodyLines.filter(line => line === 'BEGIN;').length !== 1
    || bodyLines.at(-1) !== 'COMMIT;' || bodyLines.filter(line => line === 'COMMIT;').length !== 1) throw new Error('Usage transaction anchors drifted');
  const offset = prefix.split('\n').length + 1;
  const ranges = [{ start_line: offset + begin + 1, end_line: offset + bodyLines.length - 2 }];
  const upgradeSourceBody = linesForRanges(usageSource.trimEnd().split('\n'), ranges);
  const priorSnapshot = { contract_set_id: PRIOR_INTAKE.contractSetId, source_git_sha: PRIOR_INTAKE.sourceGitSha,
    manifest: { database: { sha256: PRIOR_INTAKE.sourceSchemaSha256 } } };
  const usageSnapshot = { contract_set_id: PRIOR_USAGE.contractSetId, source_git_sha: PRIOR_USAGE.sourceGitSha,
    manifest: { database: { sha256: PRIOR_USAGE.sourceSchemaSha256 } } };
  const usageMigrations = [
    renderUpgradeMigration({position: 25, id: '0025_intake_usage_v1_21', version: 'schema.v1.21', ranges, sourceBody: upgradeSourceBody}, usageSnapshot),
    renderIntakeOverlay(projectRoot, usageSnapshot, 26, '0026_intake_discovery_index'),
  ];
  const usageHashes = ['f270f787323a65baf3727337dcc34c1ff3f7a0bac0baf79a1894a7f7ae9591f4', 'c96e289e3ae19d600913b80796f3051eb7c19c5f544e1b8b9e17d5f5f1cd911f'];
  if (usageMigrations.some((m, i) => m.sha256 !== usageHashes[i])) throw new Error('Frozen usage migration source drifted');
  const rollbackSnapshot = { contract_set_id: 'cs-ai-c11-openapi-1.19.0-schema-1.21-240ae98a47d8',
    source_git_sha: '240ae98a47d8b9432559c298f60af6fdc9ba8c4e',
    manifest: { database: { sha256: PRIOR_USAGE.sourceSchemaSha256 } } };
  const rollbackMigration = renderIntakeOverlay(projectRoot, rollbackSnapshot, 27, '0027_intake_rollback');
  if (rollbackMigration.sha256 !== 'da90dd3eaa366037fbbe71f4296697fdf3f9f788954119731926e6500df55e98') throw new Error('Frozen rollback migration source drifted');
  const familyMigration = renderIntakeOverlay(projectRoot, rollbackSnapshot, 28, '0028_intake_family');
  if (familyMigration.sha256 !== '8b241e1b5f808c2278b53351a0d3cbee56f4ac23ca16c65736ba45ace859382e') throw new Error('Frozen family migration source drifted');
  const capacityMigration = renderIntakeOverlay(projectRoot, rollbackSnapshot, 29, '0029_intake_capacity');
  if (capacityMigration.sha256 !== '9d56a3ea4b56d5ec1ccbef5bc331c12f5f788da725a2d09030f2ccbe9e2f00ab') throw new Error('Frozen capacity migration source drifted');
  const roleMigration = renderIntakeOverlay(projectRoot, rollbackSnapshot, 30, '0030_intake_role_ceiling');
  if (roleMigration.sha256 !== '8843955f79d970bdc5f03469a7bba316c2f1fb8fa070d2b0f61ba9bc1f5144a3') throw new Error('Frozen role migration source drifted');
  const migrations = Object.freeze([
    ...loadBaselineMigrations(projectRoot),
    ...REVIEWED_UPGRADES.map(p => loadPriorReviewedUpgrade(projectRoot, p)),
    ...FROZEN_PRODUCT_OVERLAYS.map(descriptor => loadFrozenProductOverlay(projectRoot, descriptor)),
    ...intakeUpgradeSlices(previous, projectRoot).map(slice => renderUpgradeMigration(slice, priorSnapshot)),
    ...FROZEN_INTAKE_OVERLAYS.map(descriptor => {
      const frozen = loadPriorReviewedUpgrade(projectRoot, { ...PRIOR_INTAKE, ...descriptor });
      if (renderIntakeOverlay(projectRoot, priorSnapshot, descriptor.position, descriptor.id).sql !== frozen.sql) {
        throw new Error(`Frozen intake overlay source drifted: ${descriptor.file}`);
      }
      return frozen;
    }),
    ...usageMigrations,
    rollbackMigration,
    familyMigration,
    capacityMigration,
    roleMigration,
    directMigration,
    renderIntakeOverlay(projectRoot, snapshot, 32, '0032_intake_direct_publication'),
  ]);
  // A predecessor must precede this snapshot; the current contract is never its own upgrade.
  const currentIndex = COMPATIBLE_UPGRADES.findIndex(p => p.contractSetId === snapshot.contract_set_id);
  const compatibleUpgrades = currentIndex < 0 ? COMPATIBLE_UPGRADES : COMPATIBLE_UPGRADES.slice(0, currentIndex);
  const manifest = Object.freeze({
    schema: GENERATOR_SCHEMA,
    contract_set_id: snapshot.contract_set_id,
    source_git_sha: snapshot.source_git_sha,
    source_schema_sha256: snapshot.manifest.database.sha256,
    upgrade_source_sha256: sha256(directMatch[2].trimEnd()),
    compatibility: Object.freeze({
      current: 'N',
      prior_signed_baseline: Object.freeze({
        contract_set_id: BASELINE.contractSetId,
        source_git_sha: BASELINE.sourceGitSha,
        source_schema_sha256: BASELINE.sourceSchemaSha256,
        migration_count: BASELINE.migrationCount,
      }),
      prior_reviewed_upgrades: Object.freeze(compatibleUpgrades.map((p) => Object.freeze({
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
  outputs.set(CATALOGUE_PATH, renderCatalogue(manifest, migrations, compatibleUpgrades));
  return Object.freeze({ manifest, migrations, outputs });
}

// The approved runtime bundle is installed after the existing product function
// bodies. Rebuilding the full reference schema would replace those bodies and
// invalidate installed ledger checksums, so this one migration owns the entire
// companion installation transaction; environment LOGIN bindings stay outside.
const RUNTIME_DATABASE_SHA256 = '4c2969459265262fabfe38ae425ab8c1275c46274d03ae09ec39b75ae9cc978e';
const RUNTIME_INSTALLATION_SHA256 = '1683c487d6dc84e84b44d9f2a80ca9ab9cfb941144ace8d3b2cf7f520bb58486';
const PRIOR_DIRECT = Object.freeze({
  contractSetId: 'cs-ai-c11-openapi-1.20.0-schema-1.22-6f318d448929',
  sourceGitSha: '6f318d448929d1a87c5dc9e725ea4f90c48a4b97',
  sourceSchemaSha256: EXPECTED_DATABASE_SHA256,
  migrationCount: 32,
});

function buildRuntimeMigrationOutputs(snapshot, { projectRoot = DEFAULT_PROJECT_ROOT } = {}) {
  if (snapshot?.manifest?.database?.sha256 === EXPECTED_DATABASE_SHA256) {
    return buildDirectMigrationOutputs(snapshot, { projectRoot });
  }
  if (typeof snapshot?.database_source !== 'string'
    || snapshot.manifest?.database?.sha256 !== RUNTIME_DATABASE_SHA256
    || sha256(snapshot.database_source) !== RUNTIME_DATABASE_SHA256) {
    throw new Error('Database contract SHA-256 drifted; explicitly review and version the migration generator');
  }
  const sources = snapshot.runtime_sources;
  if (typeof sources?.installation !== 'string' || sha256(sources.installation) !== RUNTIME_INSTALLATION_SHA256) {
    throw new Error('Runtime installation manifest is missing or drifted');
  }
  const installation = JSON.parse(sources.installation);
  for (const [name, descriptor] of Object.entries(installation.sources)) {
    if (typeof sources[name] !== 'string' || sha256(sources[name]) !== descriptor.sha256) {
      throw new Error(`Runtime companion is missing or drifted: ${name}`);
    }
  }
  const prior = buildDirectMigrationOutputs({
    contract_set_id: PRIOR_DIRECT.contractSetId, source_git_sha: PRIOR_DIRECT.sourceGitSha,
    manifest: { database: { sha256: EXPECTED_DATABASE_SHA256 } },
    database_source: readFileSync(path.join(projectRoot, 'contracts/upstream/customer-agent',
      PRIOR_DIRECT.contractSetId, 'schema-v1.22.sql'), 'utf8'),
  }, { projectRoot });
  const dependency = installation.productMode.implementation;
  if (sha256(prior.outputs.get(MANIFEST_PATH)) !== dependency.migrationManifest
    || Object.entries(dependency.overlayFiles).some(([file, digest]) =>
      sha256(prior.outputs.get(`packages/database/migrations/${file}`)) !== digest)) {
    throw new Error('Approved runtime product migration dependency drifted');
  }
  const companionOrder = installation.productMode.order.slice(1, -1);
  const sourceBody = [
    `-- installation_sha256=${RUNTIME_INSTALLATION_SHA256}`,
    ...companionOrder.map(name => `-- companion=${name}; sha256=${installation.sources[name].sha256}\n${sources[name].trimEnd()}`),
  ].join('\n\n');
  const runtime = renderUpgradeMigration({ position: 33, id: '0033_intake_runtime_v1_23',
    version: 'schema.v1.23 runtime companions (atomic product installation)', ranges: [], sourceBody }, snapshot);
  const migrations = Object.freeze([...prior.migrations, runtime]);
  const compatibleUpgrades = [...COMPATIBLE_UPGRADES, PRIOR_DIRECT];
  const manifest = Object.freeze({
    ...prior.manifest,
    contract_set_id: snapshot.contract_set_id, source_git_sha: snapshot.source_git_sha,
    source_schema_sha256: RUNTIME_DATABASE_SHA256,
    upgrade_source_sha256: sha256(sourceBody),
    compatibility: Object.freeze({ ...prior.manifest.compatibility,
      prior_reviewed_upgrades: Object.freeze(compatibleUpgrades.map(p => Object.freeze({
        contract_set_id: p.contractSetId, source_git_sha: p.sourceGitSha,
        source_schema_sha256: p.sourceSchemaSha256, migration_count: p.migrationCount,
      }))),
    }),
    migrations: Object.freeze(migrations.map(({ sql: _sql, ...migration }) => migration)),
  });
  const outputs = new Map(prior.outputs);
  outputs.set(`packages/database/migrations/${runtime.file}`, runtime.sql);
  outputs.set(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  outputs.set(CATALOGUE_PATH, renderCatalogue(manifest, migrations, compatibleUpgrades));
  return Object.freeze({ manifest, migrations, outputs });
}

const CSV_DATABASE_SHA256 = 'c4ceffa961728423b755b00d551b9ab67fbf33ffe1dd87d8e671f6d151f744c5';
const CSV_INSTALLATION_SHA256 = 'e7bee22391c96c498d96e20e868cbf90429405ac3793eeb02bbc93e817939a28';
const PRIOR_RUNTIME = Object.freeze({
  contractSetId: 'cs-ai-c11-openapi-1.21.0-schema-1.23-e35c0c01b551',
  sourceGitSha: 'e35c0c01b5510ffcff75f2b19ba441ad53a9b504',
  sourceSchemaSha256: RUNTIME_DATABASE_SHA256,
  migrationCount: 33,
});

function buildCsvMigrationOutputs(snapshot, { projectRoot = DEFAULT_PROJECT_ROOT } = {}) {
  if (snapshot?.manifest?.database?.sha256 !== CSV_DATABASE_SHA256) {
    return buildRuntimeMigrationOutputs(snapshot, { projectRoot });
  }
  if (typeof snapshot.database_source !== 'string' || sha256(snapshot.database_source) !== CSV_DATABASE_SHA256) {
    throw new Error('Database contract SHA-256 drifted; explicitly review and version the migration generator');
  }
  const sources = snapshot.runtime_sources;
  if (typeof sources?.installation !== 'string' || sha256(sources.installation) !== CSV_INSTALLATION_SHA256) {
    throw new Error('CSV installation manifest is missing or drifted');
  }
  const installation = JSON.parse(sources.installation);
  for (const [name, descriptor] of Object.entries(installation.sources)) {
    if (typeof sources[name] !== 'string' || sha256(sources[name]) !== descriptor.sha256) {
      throw new Error(`CSV companion is missing or drifted: ${name}`);
    }
  }
  const priorRoot = path.join(projectRoot, 'contracts/upstream/customer-agent', PRIOR_RUNTIME.contractSetId);
  const priorManifest = JSON.parse(readFileSync(path.join(priorRoot, 'contract-set.json'), 'utf8'));
  const priorSource = readFileSync(path.join(priorRoot, 'schema-v1.23.sql'), 'utf8');
  const prior = buildRuntimeMigrationOutputs({
    contract_set_id: PRIOR_RUNTIME.contractSetId, source_git_sha: PRIOR_RUNTIME.sourceGitSha,
    manifest: priorManifest, database_source: priorSource,
    runtime_sources: Object.fromEntries(Object.entries(priorManifest.runtime).map(([name, descriptor]) =>
      [name, readFileSync(path.join(priorRoot, descriptor.file), 'utf8')])),
  }, { projectRoot });
  const expectedSource = '-- schema.v1.24 — DRAFT CSV format; frozen predecessor follows unchanged\n'
    + priorSource + `\n-- BEGIN INTAKE CSV ${installation.sources.csv.sha256}\n`
    + sources.csv + '-- END INTAKE CSV\n';
  if (snapshot.database_source !== expectedSource) throw new Error('CSV predecessor or increment differs from immutable v1.23');
  // 0033 already installed the approved capabilities. Replaying its CREATE ROLE
  // or ACL installation would mutate applied history; only the new format guard
  // is appended, atomically with its ledger row and before environment startup.
  const csv = renderUpgradeMigration({ position: 34, id: '0034_intake_csv_v1_24',
    version: 'schema.v1.24 CSV input format', ranges: [], sourceBody: sources.csv.trimEnd() }, snapshot);
  const migrations = Object.freeze([...prior.migrations, csv]);
  const compatibleUpgrades = [...COMPATIBLE_UPGRADES, PRIOR_DIRECT, PRIOR_RUNTIME];
  const manifest = Object.freeze({
    ...prior.manifest,
    contract_set_id: snapshot.contract_set_id, source_git_sha: snapshot.source_git_sha,
    source_schema_sha256: CSV_DATABASE_SHA256, upgrade_source_sha256: sha256(sources.csv.trimEnd()),
    compatibility: Object.freeze({ ...prior.manifest.compatibility,
      prior_reviewed_upgrades: Object.freeze(compatibleUpgrades.map(p => Object.freeze({
        contract_set_id: p.contractSetId, source_git_sha: p.sourceGitSha,
        source_schema_sha256: p.sourceSchemaSha256, migration_count: p.migrationCount,
      }))),
    }),
    migrations: Object.freeze(migrations.map(({ sql: _sql, ...migration }) => migration)),
  });
  const outputs = new Map(prior.outputs);
  outputs.set(`packages/database/migrations/${csv.file}`, csv.sql);
  outputs.set(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  outputs.set(CATALOGUE_PATH, renderCatalogue(manifest, migrations, compatibleUpgrades));
  return Object.freeze({ manifest, migrations, outputs });
}


const LEGACY_CHECK_DATABASE_SHA256 = '0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998';
const LEGACY_CHECK_INSTALLATION_SHA256 = 'fbc601f305013b54e5273e3c4b97faf009f348c3db6a6b4c9f397cfd87707418';
const PRIOR_CSV = Object.freeze({
  contractSetId: 'cs-ai-c11-openapi-1.22.0-schema-1.24-adbc7b1ce251',
  sourceGitSha: 'adbc7b1ce251816fc02957a0042742ae2d053f9a',
  sourceSchemaSha256: CSV_DATABASE_SHA256,
  migrationCount: 34,
});

export function buildDatabaseMigrationOutputs(snapshot, { projectRoot = DEFAULT_PROJECT_ROOT } = {}) {
  if (snapshot?.manifest?.database?.sha256 !== LEGACY_CHECK_DATABASE_SHA256) {
    return buildCsvMigrationOutputs(snapshot, { projectRoot });
  }
  if (typeof snapshot.database_source !== 'string' || sha256(snapshot.database_source) !== LEGACY_CHECK_DATABASE_SHA256) {
    throw new Error('Database contract SHA-256 drifted; explicitly review and version the migration generator');
  }
  const sources = snapshot.runtime_sources;
  if (typeof sources?.installation !== 'string' || sha256(sources.installation) !== LEGACY_CHECK_INSTALLATION_SHA256) {
    throw new Error('Legacy CHECK installation manifest is missing or drifted');
  }
  const installation = JSON.parse(sources.installation);
  for (const [name, descriptor] of Object.entries({ ...installation.dependencies,
    csvInstallation: { sha256: installation.predecessor.installationSha256 }, legacyAcl: installation.delta })) {
    if (typeof sources[name] !== 'string' || sha256(sources[name]) !== descriptor.sha256) {
      throw new Error(`Legacy CHECK companion is missing or drifted: ${name}`);
    }
  }
  const priorRoot = path.join(projectRoot, 'contracts/upstream/customer-agent', PRIOR_CSV.contractSetId);
  const priorManifest = JSON.parse(readFileSync(path.join(priorRoot, 'contract-set.json'), 'utf8'));
  const priorSource = readFileSync(path.join(priorRoot, priorManifest.database.file), 'utf8');
  const prior = buildCsvMigrationOutputs({
    contract_set_id: PRIOR_CSV.contractSetId, source_git_sha: PRIOR_CSV.sourceGitSha,
    manifest: priorManifest, database_source: priorSource,
    runtime_sources: Object.fromEntries(Object.entries(priorManifest.runtime).map(([name, descriptor]) =>
      [name, readFileSync(path.join(priorRoot, descriptor.file), 'utf8')])),
  }, { projectRoot });
  const expectedSource = '-- schema.v1.25 — DRAFT legacy CHECK execution closure; immutable v1.24 follows\n'
    + priorSource + `\n-- BEGIN INTAKE LEGACY CHECK ACL ${installation.delta.sha256}\n`
    + sources.legacyAcl + '-- END INTAKE LEGACY CHECK ACL\n';
  if (snapshot.database_source !== expectedSource) throw new Error('Legacy CHECK predecessor or increment differs from immutable v1.24');
  // Earlier migrations already own the table constraints, role boundary and
  // function bodies. Append only their approved helper EXECUTE closure; never
  // reinstall historical ACL or give the LOGIN roles an extra capability.
  const legacyAcl = renderUpgradeMigration({ position: 35, id: '0035_intake_legacy_check_acl_v1_25',
    version: 'schema.v1.25 legacy CHECK execution closure', ranges: [], sourceBody: sources.legacyAcl.trimEnd() }, snapshot);
  const successor = findSopSuccessor(projectRoot);
  const sopMigration = successor ? renderSopMigration(successor) : null;
  // 0037-0039 are Menokin deltas carried on the ingested OpenAPI 1.23 / schema 1.26
  // successor. schema.v1.27 is the approved overlay and is not a separate ingested
  // contract set, so these migrations keep that successor sha instead of inventing one.
  const successorSnapshot = successor ? {
    contract_set_id: successor.manifest.contract_set_id,
    source_git_sha: successor.manifest.source_git_sha,
    manifest: successor.manifest,
  } : null;
  const registrationBody = readFileSync(path.join(projectRoot, 'packages/database/seeds/menokin-source-registration.sql'), 'utf8')
    .split('\n').filter(line => line !== 'BEGIN;' && line !== 'COMMIT;').join('\n').trim();
  const registrationMigration = successorSnapshot ? renderUpgradeMigration({
    position: 37,
    id: '0037_menokin_source_registration',
    version: 'Menokin text source registration; no workbook import',
    ranges: [],
    sourceBody: registrationBody,
  }, successorSnapshot) : null;
  const sopDomainBody = readFileSync(path.join(projectRoot, 'packages/database/seeds/menokin-sop-v1-27.sql'), 'utf8').trim();
  const sopDomainMigration = successorSnapshot ? renderUpgradeMigration({
    position: 38,
    id: '0038_menokin_sop_domain_v1_27',
    version: 'Approved schema.v1.27 sop domain and unused-row delete',
    ranges: [],
    sourceBody: sopDomainBody,
  }, successorSnapshot) : null;
  const sopStageBody = readFileSync(path.join(projectRoot, 'packages/database/seeds/menokin-sop-stage.sql'), 'utf8').trim();
  const sopStageMigration = successorSnapshot ? renderUpgradeMigration({
    position: 39,
    id: '0039_menokin_sop_stage_media',
    version: 'Stage SOP image metadata without storing bytes',
    ranges: [],
    sourceBody: sopStageBody,
  }, successorSnapshot) : null;
  const repair = snapshot.repair;
  const repairMigration = repair ? renderRepairMigration(repair) : null;
  const readiness = snapshot.readiness;
  const readinessMigration = readiness ? renderReadinessMigration(readiness) : null;
  const migrations = Object.freeze([...prior.migrations, legacyAcl, ...(sopMigration ? [sopMigration] : []), ...(registrationMigration ? [registrationMigration] : []), ...(sopDomainMigration ? [sopDomainMigration] : []), ...(sopStageMigration ? [sopStageMigration] : []), ...(repairMigration ? [repairMigration] : []), ...(readinessMigration ? [readinessMigration] : [])]);
  if (repair) {
    const expected = JSON.parse(repair.repair_sources.predecessor).migrations;
    if (expected.length !== 39 || migrations.length !== (readiness ? 41 : 40)) throw new Error('Repair generator requires the complete predecessor closure');
    if (expected.some((m, i) => m.position !== i + 1)) throw new Error('Repair predecessor positions must be 1 through 39');
    for (const m of expected) for (const key of ['position', 'id', 'file', 'sha256', 'bytes']) {
      if (migrations[m.position - 1][key] !== m[key]) throw new Error(`Generated repair predecessor drift: ${m.file}`);
    }
  }
  if (readiness) {
    const expected = JSON.parse(readiness.readiness_sources.predecessor).migrations;
    if (!repair || expected.length !== 40 || migrations.length !== 41 || expected.some((m,i)=>m.position!==i+1)) throw new Error('Readiness generator requires exact forty-migration predecessor');
    for (const m of expected) for (const key of ['position','id','file','sha256','bytes']) {
      if (migrations[m.position-1][key] !== m[key]) throw new Error(`Generated readiness predecessor drift: ${m.file}`);
    }
  }
  // Appended only after the frozen 41-migration closure. 0032 itself is not rewritten.
  // 0042 bytes are the migration already applied on the Mac ledger. Re-rendering
  // the restored overlay must reproduce that checksum; the tenant adoption is 0043.
  const FROZEN_OCCUPIED_SHA256 = 'c692968890cef90c1f72651901a326a8e816347992c7795d58f56cbcc31d6f37';
  const productOverlays = [
    [42, '0042_intake_occupied_domain_publish'],
    [43, '0043_intake_publish_default_tenant'],
    [44, '0044_intake_role_defaults'],
    [45, '0045_feishu_agent_admit'],
    [46, '0046_project_feishu_roster'],
    [47, '0047_roster_query_signer'],
    [48, '0048_roster_store_set'],
    [49, '0049_roster_lifecycle'],
    [50, '0050_authorization_sources'],
    [51, '0051_publish_source_set'],
    [52, '0052_import_source_set'],
    [53, '0053_search_source_set'],
    [54, '0054_legacy_batch_owner_only'],
    [55, '0055_grant_steward_required'],
    [56, '0056_cancel_import_owner_only'],
    [57, '0057_role_ceiling'],
    [58, '0058_grant_steward_no_restore'],
    [59, '0059_query_grant_restamp'],
    [60, '0060_grant_issuer_authority'],
    [61, '0061_sop_entry_code_identity'],
    [62, '0062_store_set_authority_retention'],
    [63, '0063_store_set_keep_members_boundary'],
    [64, '0064_roster_query_requires_reader'],
    [65, '0065_legacy_orphan_fk_not_valid'],
    [66, '0066_policy_version_restamp'],
    [67, '0067_inaccuracy_outcome'],
    [68, '0068_seat_lifecycle'],
    [69, '0069_feishu_login_link'],
    [70, '0070_analytics_question_v1'],
  ];
  const productTail = readiness ? productOverlays.map(([position, id]) => renderIntakeOverlay(projectRoot, snapshot, position, id)) : [];
  const occupiedMigration = productTail[0] ?? null;
  if (occupiedMigration && occupiedMigration.sha256 !== FROZEN_OCCUPIED_SHA256) {
    throw new Error('Frozen occupied-domain migration 0042 drifted');
  }
  const publishedMigrations = Object.freeze([...migrations, ...productTail]);
  const compatibleUpgrades = [...COMPATIBLE_UPGRADES, PRIOR_DIRECT, PRIOR_RUNTIME, PRIOR_CSV];
  const manifest = Object.freeze({
    ...prior.manifest,
    contract_set_id: snapshot.contract_set_id, source_git_sha: snapshot.source_git_sha,
    source_schema_sha256: LEGACY_CHECK_DATABASE_SHA256, upgrade_source_sha256: sha256(sources.legacyAcl.trimEnd()),
    compatibility: Object.freeze({ ...prior.manifest.compatibility,
      prior_reviewed_upgrades: Object.freeze(compatibleUpgrades.map(p => Object.freeze({
        contract_set_id: p.contractSetId, source_git_sha: p.sourceGitSha,
        source_schema_sha256: p.sourceSchemaSha256, migration_count: p.migrationCount,
      }))),
      ...(repair ? { repair_successor: Object.freeze({ contract_set_id: repair.contract_set_id,
        source_git_sha: repair.source_git_sha, source_schema_sha256: repair.manifest.database.sha256,
        upgrade_sha256: repair.manifest.repair.upgrade.sha256, migration_sha256: repairMigration.sha256 }) } : {}),
      ...(readiness ? { readiness_successor: Object.freeze({ contract_set_id: readiness.contract_set_id, source_git_sha: readiness.source_git_sha, source_schema_sha256: readiness.manifest.database.sha256, migration_sha256: readinessMigration.sha256 }) } : {}),
      additive_successor: sopMigration ? Object.freeze({
        contract_set_id: successor.manifest.contract_set_id,
        source_git_sha: successor.manifest.source_git_sha,
        source_schema_sha256: successor.manifest.database.sha256,
      }) : null,
    }),
    migrations: Object.freeze(publishedMigrations.map(({ sql: _sql, ...migration }) => migration)),
  });
  const outputs = new Map(prior.outputs);
  outputs.set(`packages/database/migrations/${legacyAcl.file}`, legacyAcl.sql);
  if (sopMigration) outputs.set(`packages/database/migrations/${sopMigration.file}`, sopMigration.sql);
  if (registrationMigration) outputs.set(`packages/database/migrations/${registrationMigration.file}`, registrationMigration.sql);
  if (sopDomainMigration) outputs.set(`packages/database/migrations/${sopDomainMigration.file}`, sopDomainMigration.sql);
  if (readinessMigration) outputs.set(`packages/database/migrations/${readinessMigration.file}`, readinessMigration.sql);
  for (const overlay of productTail) outputs.set(`packages/database/migrations/${overlay.file}`, overlay.sql);
  if (repairMigration) outputs.set(`packages/database/migrations/${repairMigration.file}`, repairMigration.sql);
  if (sopStageMigration) outputs.set(`packages/database/migrations/${sopStageMigration.file}`, sopStageMigration.sql);
  outputs.set(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  outputs.set(CATALOGUE_PATH, renderCatalogue(manifest, publishedMigrations, compatibleUpgrades));
  return Object.freeze({ manifest, migrations: publishedMigrations, outputs });
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
