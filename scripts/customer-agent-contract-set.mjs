import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { READINESS_SCHEMA, READINESS_LOCK, READINESS_SOURCE, READINESS_APPROVAL, READINESS_MEMBERS, verifyReadinessReferences, composeReadiness } from './readiness-contract.mjs';
import { TASK_GRAPH_SCHEMA, TASK_GRAPH_LOCK, TASK_GRAPH_CANDIDATE, TASK_GRAPH_CANDIDATE_ID, TASK_GRAPH_SOURCE, TASK_GRAPH_HISTORY_CANDIDATE, TASK_GRAPH_APPROVAL, TASK_GRAPH_HISTORY, TASK_GRAPH_MEMBERS, TASK_GRAPH_PRODUCER_HASHES, TASK_GRAPH_VERSIONS, assertProducerFingerprints, reviewedTaskGraphAnchor, verifyTaskGraphPredecessor, verifyTaskGraphReferences } from './sop-task-graph-contract.mjs';
import { renderReadinessMigration, renderRepairMigration } from '../packages/database/scripts/migration-artifact.mjs';
import { isDeepStrictEqual } from 'node:util';

const EXPECTED_PACKAGE_NAME = 'customer-agent-demo';
const CONTRACT_SET_SCHEMA = 'customer-agent-contract-set/v1';
const RUNTIME_CONTRACT_SET_SCHEMA = 'customer-agent-contract-set/v2';
const CSV_CONTRACT_SET_SCHEMA = 'customer-agent-contract-set/v3';
const LEGACY_CHECK_CONTRACT_SET_SCHEMA = 'customer-agent-contract-set/v4';
const SOP_CONTRACT_SET_SCHEMA = 'customer-agent-contract-set/v5';
const REPAIR_CONTRACT_SET_SCHEMA = 'customer-agent-contract-set/v6';
const REPAIR_LOCK = 'repair-contract-set.lock.json';
const REPAIR_SOURCE = 'business-docs/01-客服Agent项目/30-开发-进行中/content-intake-repair-successor-v1';
const REPAIR_APPROVAL = 'business-docs/01-客服Agent项目/90-评审/2026-10-12_后继合同批准.json';
const REPAIR_MEMBERS = Object.freeze({ upgrade: 'upgrade.v1.sql', installation: 'installation.v1.json', predecessor: 'predecessor-lock.v1.json', provenance: 'provenance.v1.json', approval: 'approval.v1.json' });
const CONSUMPTION_SCHEMA = 'customer-agent-contract-consumption/v1';
const SOURCE_REPOSITORY = 'ai-赋能立项';
const UPSTREAM_ROOT = 'contracts/upstream/customer-agent';
const LOCK_FILE = 'contract-set.lock.json';
const MANIFEST_FILE = 'contract-set.json';
const INTAKE_STATUS = 'VERIFIED_NOT_ACTIVATED';
const TASK_GRAPH_RECONSTRUCTION_ERROR = 'Task graph trusted source reconstruction proof is required; v9 intake and consumption are disabled';
const TASK_GRAPH_REVIEW_ONLY_ERROR = 'Task graph review-only candidate cannot enter the product contract directory; formal freeze, export and business mapping are required';
const TASK_GRAPH_PROOF_LOCK_SCHEMA = 'customer-agent-sop-reconstruction-proof-lock/v2';
const OPENAPI_SOURCE_PATH = 'business-docs/01-客服Agent项目/20-设计-进行中/openapi.v1.yaml';
const DATABASE_SOURCE_PATH = 'business-docs/01-客服Agent项目/20-设计-进行中/33-schema-v1-草案.sql';
const OWNER_SOURCE_ROOT = 'business-docs/01-客服Agent项目/30-开发-进行中';
// The versioned runtime profile has a closed set of companion artifacts. These
// are immutable contract inputs, not executable hooks or paths supplied by HTTP.
const RUNTIME_MEMBERS = Object.freeze({
  installation: ['content-intake-runtime-candidate/installation.generated.json', 'intake-runtime-installation.v1.json'],
  roles: ['content-intake-runtime-candidate/roles.sql', 'intake-runtime-roles.v1.sql'],
  organization: ['content-intake-runtime-candidate/organization.sql', 'intake-runtime-organization.v1.sql'],
  session: ['content-intake-runtime-candidate/session-lock.sql', 'intake-runtime-session.v1.sql'],
  acl: ['content-intake-runtime-candidate/purpose-acl.sql', 'intake-runtime-acl.v1.sql'],
  directoryAcl: ['content-intake-runtime-candidate/directory-acl.sql', 'intake-runtime-directory-acl.v1.sql'],
  directory: ['content-intake-shop-directory-candidate/storage.delta.sql', 'intake-shop-directory.v1.sql'],
  provenance: ['content-intake-runtime-candidate/provenance.json', 'intake-runtime-provenance.v1.json'],
  protocol: ['content-intake-runtime-candidate/protocol.json', 'intake-runtime-protocol.v1.json'],
});
const CSV_MEMBERS = Object.freeze({
  ...RUNTIME_MEMBERS,
  installation: ['content-intake-csv-candidate/installation.generated.json', 'intake-csv-installation.v1.json'],
  csv: ['content-intake-csv-candidate/storage.delta.sql', 'intake-csv-format.v1.sql'],
  csvProtocol: ['content-intake-csv-candidate/protocol.json', 'intake-csv-protocol.v1.json'],
});
const LEGACY_CHECK_MEMBERS = Object.freeze({
  ...CSV_MEMBERS,
  installation: ['content-intake-runtime-candidate/legacy-check-installation.v1.json', 'intake-legacy-check-installation.v1.json'],
  csvInstallation: CSV_MEMBERS.installation,
  legacyAcl: ['content-intake-runtime-candidate/legacy-check-acl.v1.sql', 'intake-legacy-check-acl.v1.sql'],
});
const LEGACY_CHECK_INCREMENT_PATH = `${OWNER_SOURCE_ROOT}/content-intake-runtime-candidate/legacy-check-contract.md`;
const LEGACY_CHECK_APPROVAL_PATH = 'business-docs/01-客服Agent项目/90-评审/2026-10-09_P2旧内容校验ACL合同批准.md';
const CSV_INCREMENT_PATH = `${OWNER_SOURCE_ROOT}/19-P2CSV资料输入合同候选.md`;
const CSV_APPROVAL_PATH = 'business-docs/01-客服Agent项目/90-评审/2026-10-08_P2CSV输入合同批准.md';
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const CONTRACT_SET_ID_PATTERN = /^cs-ai-c11-openapi-(\d+\.\d+\.\d+)-schema-(\d+\.\d+)-([0-9a-f]{12})$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, expectedKeys, label) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unexpected fields: ${actual.join(', ')}`);
  }
}

function requireString(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function readJson(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parsed;
}

function assertRegularFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
  const stats = lstatSync(filePath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file: ${filePath}`);
  }
  return stats;
}

function assertDirectory(directory, label) {
  if (!existsSync(directory)) {
    throw new Error(`${label} is missing: ${directory}`);
  }
  const stats = lstatSync(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a non-symlink directory: ${directory}`);
  }
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function sha256Bytes(content) {
  return createHash('sha256').update(content).digest('hex');
}

function validateDescriptor(value, label) {
  assertExactKeys(value, ['version', 'source_path', 'file', 'sha256', 'bytes'], label);
  if (typeof value.version !== 'string' || value.version.length === 0) {
    throw new Error(`${label}.version is invalid`);
  }
  if (
    typeof value.source_path !== 'string'
    || path.posix.isAbsolute(value.source_path)
    || value.source_path.split('/').includes('..')
    || value.source_path.includes(':')
  ) {
    throw new Error(`${label}.source_path is invalid`);
  }
  if (
    typeof value.file !== 'string'
    || value.file.length === 0
    || path.posix.basename(value.file) !== value.file
  ) {
    throw new Error(`${label}.file is invalid`);
  }
  requireString(value.sha256, HASH_PATTERN, `${label}.sha256`);
  if (!Number.isSafeInteger(value.bytes) || value.bytes <= 0) {
    throw new Error(`${label}.bytes is invalid`);
  }
  return value;
}

function validateManifest(rawManifest) {
  const isTaskGraphProfile = rawManifest?.schema === TASK_GRAPH_SCHEMA;
  const readinessProfile = rawManifest?.schema === READINESS_SCHEMA;
  const repairProfile = rawManifest?.schema === REPAIR_CONTRACT_SET_SCHEMA;
  const sopProfile = rawManifest?.schema === SOP_CONTRACT_SET_SCHEMA;
  const legacyCheckProfile = rawManifest?.schema === LEGACY_CHECK_CONTRACT_SET_SCHEMA;
  const csvProfile = legacyCheckProfile || rawManifest?.schema === CSV_CONTRACT_SET_SCHEMA;
  const runtimeProfile = csvProfile || rawManifest?.schema === RUNTIME_CONTRACT_SET_SCHEMA;
  assertExactKeys(
    rawManifest,
    [
      'schema',
      'contract_set_id',
      'source_repository',
      'source_git_sha',
      'architecture_version',
      'implementation_version',
      'openapi',
      'database',
      ...(runtimeProfile ? ['runtime'] : []),
      ...(repairProfile ? ['repair'] : []),
      ...(readinessProfile ? ['readiness'] : []),
      ...(isTaskGraphProfile ? ['sopTaskGraph'] : []),
    ],
    'contract-set manifest',
  );
  if (rawManifest.schema !== CONTRACT_SET_SCHEMA && !runtimeProfile && !sopProfile && !repairProfile && !readinessProfile && !isTaskGraphProfile) {
    throw new Error(`Unsupported contract-set schema: ${String(rawManifest.schema)}`);
  }
  if (rawManifest.source_repository !== SOURCE_REPOSITORY) {
    throw new Error(`Unexpected source repository: ${String(rawManifest.source_repository)}`);
  }
  requireString(rawManifest.source_git_sha, GIT_SHA_PATTERN, 'source_git_sha');
  if (!/^\d+\.\d+$/.test(rawManifest.architecture_version)) {
    throw new Error('architecture_version is invalid');
  }
  if (!/^\d+\.\d+$/.test(rawManifest.implementation_version)) {
    throw new Error('implementation_version is invalid');
  }
  const idMatch = typeof rawManifest.contract_set_id === 'string'
    ? rawManifest.contract_set_id.match(CONTRACT_SET_ID_PATTERN)
    : null;
  if (!idMatch) {
    throw new Error('contract_set_id is invalid');
  }
  if (idMatch[3] !== rawManifest.source_git_sha.slice(0, 12)) {
    throw new Error('contract_set_id does not match source_git_sha');
  }

  const openapi = validateDescriptor(rawManifest.openapi, 'openapi');
  const database = validateDescriptor(rawManifest.database, 'database');
  if (openapi.version !== idMatch[1] || openapi.file !== 'openapi.v1.yaml') {
    throw new Error('OpenAPI descriptor does not match contract_set_id');
  }
  if (database.version !== `schema.v${idMatch[2]}` || database.file !== `schema-v${idMatch[2]}.sql`) {
    throw new Error('Database descriptor does not match contract_set_id');
  }
  // Version and both paths form one reviewed pair; mixed generations fail closed.
  const readinessPair = openapi.version === '1.24.0' && database.version === 'schema.v1.29';
  const taskGraphPair = openapi.version === TASK_GRAPH_VERSIONS.openapi && database.version === TASK_GRAPH_VERSIONS.database;
  if (isTaskGraphProfile && (openapi.version === '1.26.0' || database.version === 'schema.v1.31')) {
    throw new Error('Obsolete task graph v2 is not accepted');
  }
  const repairPair = openapi.version === '1.24.0' && database.version === 'schema.v1.28';
  const sopPair = openapi.version === '1.23.0' && database.version === 'schema.v1.26';
  const legacyCheckPair = openapi.version === '1.22.0' && database.version === 'schema.v1.25';
  const csvPair = openapi.version === '1.22.0' && database.version === 'schema.v1.24';
  const runtimePair = openapi.version === '1.21.0' && database.version === 'schema.v1.23';
  const directPair = openapi.version === '1.20.0' && database.version === 'schema.v1.22';
  const managementPair = openapi.version === '1.19.0' && database.version === 'schema.v1.21';
  const qualityPair = openapi.version === '1.18.0' && database.version === 'schema.v1.21';
  const usagePair = openapi.version === '1.17.0' && database.version === 'schema.v1.21';
  const intakePair = openapi.version === '1.16.0' && database.version === 'schema.v1.20';
  const opsLoopPair = openapi.version === '1.14.0' && database.version === 'schema.v1.18';
  const backendPair = openapi.version === '1.13.0' && ['schema.v1.16', 'schema.v1.17'].includes(database.version);
  const ownerPair = openapi.version === '1.12.0' && database.version === 'schema.v1.15';
  const legacyPair = openapi.version === '1.11.0'
    && ['schema.v1.12', 'schema.v1.13', 'schema.v1.14'].includes(database.version);
  if (taskGraphPair !== isTaskGraphProfile || readinessPair !== readinessProfile || repairPair !== repairProfile || sopPair !== sopProfile || legacyCheckPair !== legacyCheckProfile || (csvPair || legacyCheckPair) !== csvProfile || (runtimePair || csvPair || legacyCheckPair) !== runtimeProfile || (!taskGraphPair && !readinessPair && !repairPair && !sopPair && !legacyCheckPair && !csvPair && !runtimePair && !directPair && !managementPair && !qualityPair && !usagePair && !intakePair && !opsLoopPair && !backendPair && !ownerPair && !legacyPair)) throw new Error('Unsupported contract version pair');
  let openapiPath = OPENAPI_SOURCE_PATH;
  let databasePath = DATABASE_SOURCE_PATH;
  if (taskGraphPair) {
    if (rawManifest.architecture_version !== '1.16' || rawManifest.implementation_version !== '1.22') throw new Error('Task graph architecture or implementation version mismatch');
    openapiPath = `${TASK_GRAPH_SOURCE}/openapi.v1.yaml`;
    databasePath = `${TASK_GRAPH_SOURCE}/${database.file}`;
    assertExactKeys(rawManifest.sopTaskGraph, Object.keys(TASK_GRAPH_MEMBERS), 'task graph artifacts');
    for (const [key, [file, version]] of Object.entries(TASK_GRAPH_MEMBERS)) {
      const descriptor = validateDescriptor(rawManifest.sopTaskGraph[key], `sopTaskGraph.${key}`);
      if (descriptor.version !== version || descriptor.file !== file || descriptor.source_path !== `${TASK_GRAPH_SOURCE}/${file}`) throw new Error(`Task graph descriptor mismatch: ${key}`);
    }
    for (const descriptor of [openapi, database, ...Object.values(rawManifest.sopTaskGraph)]) {
      if (descriptor.bytes > 32 * 1024 * 1024) throw new Error('Task graph member exceeds 32 MiB');
    }
  } else if (readinessPair) {
    openapiPath = `${READINESS_SOURCE}/openapi.v1.yaml`;
    databasePath = `${READINESS_SOURCE}/schema-v1.29.sql`;
    assertExactKeys(rawManifest.readiness, Object.keys(READINESS_MEMBERS), 'readiness artifacts');
    for (const [key,file] of Object.entries(READINESS_MEMBERS)) {
      const descriptor = validateDescriptor(rawManifest.readiness[key], `readiness.${key}`);
      const source = key === 'approval' ? READINESS_APPROVAL : `${READINESS_SOURCE}/${file}`;
      if (descriptor.version !== '1' || descriptor.file !== file || descriptor.source_path !== source) throw new Error(`Readiness descriptor mismatch: ${key}`);
    }
  } else if (repairPair) {
    openapiPath = `${REPAIR_SOURCE}/openapi.v1.yaml`;
    databasePath = `${REPAIR_SOURCE}/schema-v1.28.sql`;
    assertExactKeys(rawManifest.repair, Object.keys(REPAIR_MEMBERS), 'repair artifacts');
    for (const [key, file] of Object.entries(REPAIR_MEMBERS)) {
      const descriptor = validateDescriptor(rawManifest.repair[key], `repair.${key}`);
      const source = key === 'approval' ? REPAIR_APPROVAL : `${REPAIR_SOURCE}/${file}`;
      if (descriptor.version !== '1' || descriptor.file !== file || descriptor.source_path !== source) throw new Error(`Repair descriptor mismatch: ${key}`);
    }
  } else if (sopPair) {
    openapiPath = `${OWNER_SOURCE_ROOT}/openapi.v1.23.yaml`;
    databasePath = `${OWNER_SOURCE_ROOT}/schema.v1.26.sql`;
  } else if (runtimePair || csvPair || legacyCheckPair) {
    openapiPath = `${OWNER_SOURCE_ROOT}/openapi.v${csvProfile ? '1.22' : '1.21'}.yaml`;
    databasePath = `${OWNER_SOURCE_ROOT}/schema.v${legacyCheckPair ? '1.25' : csvPair ? '1.24' : '1.23'}.sql`;
    const members = legacyCheckPair ? LEGACY_CHECK_MEMBERS : csvPair ? CSV_MEMBERS : RUNTIME_MEMBERS;
    assertExactKeys(rawManifest.runtime, Object.keys(members), 'runtime artifacts');
    for (const [key, [sourcePath, file]] of Object.entries(members)) {
      const descriptor = validateDescriptor(rawManifest.runtime[key], `runtime.${key}`);
      if (descriptor.version !== '1' || descriptor.source_path !== `${OWNER_SOURCE_ROOT}/${sourcePath}` || descriptor.file !== file) {
        throw new Error(`runtime.${key} descriptor does not match the runtime profile`);
      }
    }
  } else if (directPair) {
    openapiPath = `${OWNER_SOURCE_ROOT}/openapi.v1.20.yaml`;
    databasePath = `${OWNER_SOURCE_ROOT}/schema.v1.22.sql`;
  } else if (managementPair) {
    openapiPath = `${OWNER_SOURCE_ROOT}/openapi.v1.19.yaml`;
    databasePath = `${OWNER_SOURCE_ROOT}/schema.v1.21.sql`;
  } else if (qualityPair || usagePair) {
    openapiPath = `${OWNER_SOURCE_ROOT}/openapi.v${qualityPair ? '1.18' : '1.17'}.yaml`;
    databasePath = `${OWNER_SOURCE_ROOT}/schema.v1.21.sql`;
  } else if (intakePair) {
    openapiPath = `${OWNER_SOURCE_ROOT}/openapi.v1.16.yaml`;
    databasePath = `${OWNER_SOURCE_ROOT}/schema.v1.20.sql`;
  } else if (opsLoopPair) {
    openapiPath = `${OWNER_SOURCE_ROOT}/openapi.v1.14.yaml`;
    databasePath = `${OWNER_SOURCE_ROOT}/schema.v1.18.sql`;
  } else if (backendPair) {
    openapiPath = `${OWNER_SOURCE_ROOT}/openapi.v1.13.yaml`;
    databasePath = `${OWNER_SOURCE_ROOT}/${database.version}.sql`;
  } else if (ownerPair) {
    openapiPath = `${OWNER_SOURCE_ROOT}/openapi.v1.12.yaml`;
    databasePath = `${OWNER_SOURCE_ROOT}/schema.v1.15.sql`;
  }
  if (openapi.source_path !== openapiPath) {
    throw new Error('OpenAPI source_path is invalid');
  }
  if (database.source_path !== databasePath) {
    throw new Error('Database source_path is invalid');
  }
  return rawManifest;
}

function expectedMembers(manifest) {
  return [MANIFEST_FILE, ...physicalDescriptors(manifest).map(([, descriptor]) => descriptor.file)].sort();
}

function physicalDescriptors(manifest) {
  return manifest.readiness ? Object.entries(manifest.readiness) : contractDescriptors(manifest);
}

function contractDescriptors(manifest) {
  return [['OpenAPI', manifest.openapi], ['Database', manifest.database],
    ...Object.entries(manifest.runtime ?? {}).map(([key, descriptor]) => [`runtime.${key}`, descriptor]),
    ...Object.entries(manifest.repair ?? {}).map(([key, descriptor]) => [`repair.${key}`, descriptor]),
    ...Object.entries(manifest.readiness ?? {}).map(([key, descriptor]) => [`readiness.${key}`, descriptor]),
    ...Object.entries(manifest.sopTaskGraph ?? {}).map(([key, descriptor]) => [`sopTaskGraph.${key}`, descriptor])];
}

/** Verify the installation plan's references as well as the outer file hashes.
 * Installing SQL and checking the live migration ledger belong to the database
 * installer. Intake never executes companion SQL or provisions environment roles. */
function verifyRuntimeReferences(directory, manifest) {
  if (!manifest.runtime) return;
  const installation = readJson(path.join(directory, manifest.runtime.installation.file), 'Runtime installation');
  const provenance = readJson(path.join(directory, manifest.runtime.provenance.file), 'Runtime provenance');
  if (manifest.schema === LEGACY_CHECK_CONTRACT_SET_SCHEMA) {
    verifyLegacyCheckReferences(directory, manifest, installation, provenance);
    return;
  }
  verifyBaseRuntimeReferences(installation, manifest.openapi, manifest.database, manifest.runtime, provenance, manifest.schema === CSV_CONTRACT_SET_SCHEMA);
}

function verifyBaseRuntimeReferences(installation, openapi, database, runtime, provenance, csvProfile) {
  const members = csvProfile ? CSV_MEMBERS : RUNTIME_MEMBERS;
  if (installation.schema !== 'content-intake-installation/v1' || installation.sqlContract !== database.version
    || installation.capabilityLogin !== false || installation.environmentCredentialsIncluded !== false
    || installation.companionAclRequired !== true || installation.referenceMode?.runtimeReady !== false
    || installation.productMode?.atomicCandidateInstall !== true || installation.productMode?.skipMissingDependencies !== false) {
    throw new Error('Runtime installation boundary is invalid');
  }
  const expectedArtifacts = ['openapi', 'database', ...Object.keys(members)].sort();
  if (!Array.isArray(installation.requiredBundleArtifacts)
    || JSON.stringify([...installation.requiredBundleArtifacts].sort()) !== JSON.stringify(expectedArtifacts)) {
    throw new Error('Runtime installation required artifacts mismatch');
  }
  for (const [key, descriptor] of Object.entries({ openapi, database })) {
    if (installation[key]?.path !== descriptor.source_path || installation[key]?.sha256 !== descriptor.sha256) {
      throw new Error(`Runtime installation ${key} reference mismatch`);
    }
  }
  assertExactKeys(installation.sources, Object.keys(members).filter(key => key !== 'installation'), 'Runtime installation sources');
  for (const key of Object.keys(members)) {
    if (key === 'installation') continue;
    const descriptor = runtime[key];
    if (installation.sources[key]?.path !== descriptor.source_path || installation.sources[key]?.sha256 !== descriptor.sha256) {
      throw new Error(`Runtime installation ${key} reference mismatch`);
    }
  }
  const implementation = installation.productMode.implementation;
  if (!isRecord(implementation) || implementation.repository !== 'customer-agent-prototype'
    || !isDeepStrictEqual(implementation, provenance.implementationDependencies)) {
    throw new Error('Runtime implementation dependencies mismatch');
  }
  requireString(implementation.commit, GIT_SHA_PATTERN, 'Runtime implementation commit');
  requireString(implementation.migrationManifest, HASH_PATTERN, 'Runtime migration manifest');
  assertExactKeys(implementation.overlayFiles, [
    '0021_content_intake_v1_20.sql', '0022_intake_legacy_fence.sql', '0023_intake_quality.sql',
    '0024_intake_publication.sql', '0025_intake_usage_v1_21.sql', '0026_intake_discovery_index.sql',
    '0027_intake_rollback.sql', '0028_intake_family.sql', '0029_intake_capacity.sql',
    '0030_intake_role_ceiling.sql', '0031_intake_direct_v1_22.sql', '0032_intake_direct_publication.sql',
  ], 'Runtime implementation overlays');
  for (const hash of Object.values(implementation.overlayFiles)) requireString(hash, HASH_PATTERN, 'Runtime overlay hash');
  const order = ['product-migrations', 'roles', 'organization', 'session', 'directory', 'directoryAcl', 'acl', 'environment-login-bindings'];
  if (csvProfile) {
    order.splice(order.indexOf('acl'), 0, 'csv');
    if (installation.productMode.csvInputImplementationRequired !== true
      || installation.productMode.csvProductionConsumerReady !== false
      || !isDeepStrictEqual(installation.referenceMode.includes, ['roles', 'organization', 'session', 'directory', 'directoryAcl', 'csv'])) {
      throw new Error('CSV implementation boundary is invalid');
    }
  }
  if (JSON.stringify(installation.productMode.order) !== JSON.stringify(order)) throw new Error('Runtime installation order mismatch');
}

// v4 carries the unchanged CSV installation as its prerequisite. Its complete
// safety checks stay in the same validator used for v3; only the outer append
// closes the eight-function grant and the exact predecessor reference.
function verifyLegacyCheckReferences(directory, manifest, installation, provenance) {
  assertExactKeys(installation, ['schema', 'status', 'freezeApproved', 'exportApproved', 'runtimeActivated',
    'openapi', 'database', 'predecessor', 'delta', 'dependencies', 'referenceMode', 'productOrder',
    'atomicAppendOnly', 'grantee', 'grantKind', 'loginRoleGrants', 'tablePrivileges',
    'membershipChanges', 'functionBodyChanges', 'exportCondition'], 'Legacy check installation');
  if (installation.schema !== 'content-intake-legacy-check-installation/v1'
    || installation.status !== 'DRAFT' || installation.freezeApproved !== false || installation.exportApproved !== false
    || installation.runtimeActivated !== false || installation.atomicAppendOnly !== true
    || installation.grantee !== 'intake_runtime_fn_owner' || installation.grantKind !== 'EXECUTE'
    || installation.loginRoleGrants !== false || installation.tablePrivileges !== false
    || installation.membershipChanges !== false || installation.functionBodyChanges !== false
    || typeof installation.exportCondition !== 'string' || installation.exportCondition.length === 0) {
    throw new Error('Legacy check installation boundary is invalid');
  }
  const reference = descriptor => ({ path: descriptor.source_path, sha256: descriptor.sha256 });
  if (!isDeepStrictEqual(installation.openapi, { ...reference(manifest.openapi), unchanged: true })
    || !isDeepStrictEqual(installation.database, reference(manifest.database))
    || !isDeepStrictEqual(installation.delta, reference(manifest.runtime.legacyAcl))) {
    throw new Error('Legacy check installation contract reference mismatch');
  }
  const predecessor = installation.predecessor;
  assertExactKeys(predecessor, ['path', 'sha256', 'installation', 'installationSha256'], 'Legacy check predecessor');
  requireString(predecessor.sha256, HASH_PATTERN, 'Legacy check predecessor hash');
  if (predecessor.path !== `${OWNER_SOURCE_ROOT}/schema.v1.24.sql`
    || predecessor.installation !== manifest.runtime.csvInstallation.source_path
    || predecessor.installationSha256 !== manifest.runtime.csvInstallation.sha256) {
    throw new Error('Legacy check predecessor reference mismatch');
  }
  const dependencyKeys = Object.keys(CSV_MEMBERS).filter(key => key !== 'installation');
  assertExactKeys(installation.dependencies, dependencyKeys, 'Legacy check dependencies');
  for (const key of dependencyKeys) {
    if (!isDeepStrictEqual(installation.dependencies[key], reference(manifest.runtime[key]))) {
      throw new Error(`Legacy check ${key} dependency reference mismatch`);
    }
  }
  if (!isDeepStrictEqual(installation.referenceMode, { completeDdl: manifest.database.source_path,
    includesPredecessorRoles: true, includesProductFunctionBodies: false, runtimeReady: false })
    || !isDeepStrictEqual(installation.productOrder, [
      'verified-v1.24-product-migrations-and-complete-runtime-ACL', 'legacy-check-acl', 'environment-startup',
    ])) throw new Error('Legacy check installation order or reference boundary mismatch');
  const csvInstallation = readJson(path.join(directory, manifest.runtime.csvInstallation.file), 'CSV predecessor installation');
  verifyBaseRuntimeReferences(csvInstallation, manifest.openapi,
    { version: 'schema.v1.24', source_path: predecessor.path, sha256: predecessor.sha256 },
    manifest.runtime, provenance, true);
}

function assertMember(directory, descriptor, label) {
  const filePath = path.join(directory, descriptor.file);
  const stats = assertRegularFile(filePath, label);
  if (stats.size !== descriptor.bytes) {
    throw new Error(`${label} byte size mismatch`);
  }
  if (sha256(filePath) !== descriptor.sha256) {
    throw new Error(`${label} SHA-256 mismatch`);
  }
}

/** Verifies bundle bytes and internal references, not source authority or reconstruction. */
export function verifyContractSetDirectory(directory) {
  const resolvedDirectory = path.resolve(directory);
  assertDirectory(resolvedDirectory, 'Contract-set directory');
  const manifestPath = path.join(resolvedDirectory, MANIFEST_FILE);
  assertRegularFile(manifestPath, 'Contract-set manifest');
  const manifest = validateManifest(readJson(manifestPath, 'Contract-set manifest'));
  const actualMembers = readdirSync(resolvedDirectory).sort();
  const members = expectedMembers(manifest);
  if (
    actualMembers.length !== members.length
    || actualMembers.some((entry, index) => entry !== members[index])
  ) {
    throw new Error(`Contract-set members mismatch: ${actualMembers.join(', ')}`);
  }
  for (const [label, descriptor] of physicalDescriptors(manifest)) assertMember(resolvedDirectory, descriptor, label);
  verifyRuntimeReferences(resolvedDirectory, manifest);
  if (manifest.readiness) verifyReadinessReferences(resolvedDirectory, manifest);
  if (manifest.repair) verifyRepairReferences(resolvedDirectory, manifest);
  if (manifest.sopTaskGraph) verifyTaskGraphReferences(resolvedDirectory, manifest);
  return Object.freeze({ directory: resolvedDirectory, manifest });
}

function taskGraphGitExecutable() {
  const candidates = process.platform === 'win32'
    ? ['C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\bin\\git.exe']
    : ['/usr/bin/git'];
  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) throw new Error('Task graph reconstruction requires a system Git executable');
  return found;
}

function taskGraphEnvironment(gitExecutable) {
  return {
    PATH: process.platform === 'win32' ? `${path.dirname(gitExecutable)};C:\\Windows\\System32` : '/usr/bin:/bin',
    ...(process.platform === 'win32' ? { SystemRoot: 'C:\\Windows' } : {}),
    LANG: 'C',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_ALLOW_PROTOCOL: '',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: os.devNull,
  };
}

function runGit(repositoryRoot, arguments_, encoding = 'buffer', exactObjects = false) {
  if (exactObjects && arguments_[0] === 'show' && arguments_.length !== 2) throw new Error('Exact Git blob read requires one object');
  const gitArguments = exactObjects && arguments_[0] === 'show'
    ? ['cat-file', 'blob', arguments_[1]]
    : arguments_;
  const executable = exactObjects ? taskGraphGitExecutable() : 'git';
  const env = exactObjects ? taskGraphEnvironment(executable) : undefined;
  try {
    return execFileSync(executable, ['-C', repositoryRoot, ...gitArguments], {
      encoding: encoding === 'utf8' ? 'utf8' : null,
      maxBuffer: 33 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(env ? { env } : {}),
    });
  } catch {
    throw new Error(`Source Git verification failed at ${arguments_[0] ?? 'unknown operation'}`);
  }
}

/** Approval belongs to the declared source SHA. Complete history prevents a
 * later commit from deleting approval and impersonating an earlier profile.
 * Historical v1-v3 source SHAs remain valid after newer approvals exist. */
function verifySourceApproval(repositoryRoot, manifest) {
  const source = relative => String(runGit(repositoryRoot, ['show', `${manifest.source_git_sha}:${relative}`], 'utf8'));
  if (manifest.schema === TASK_GRAPH_SCHEMA) {
    assertSourceGitFile(repositoryRoot, manifest.source_git_sha, TASK_GRAPH_APPROVAL);
    const original = runGit(repositoryRoot, ['show', `${manifest.source_git_sha}:${TASK_GRAPH_APPROVAL}`], 'buffer', true);
    const frozen = runGit(repositoryRoot, ['show', `${manifest.source_git_sha}:${manifest.sopTaskGraph.approval.source_path}`], 'buffer', true);
    if (!original.equals(frozen)) throw new Error('Task graph original approval does not match the frozen approval');
    return;
  }
  if (manifest.schema === READINESS_SCHEMA) return; // Full references and approval are verified against this exact Git SHA.
  const readinessHistory = String(runGit(repositoryRoot, ['log', '--full-history', '-1', '--format=%H', manifest.source_git_sha, '--', READINESS_APPROVAL], 'utf8')).trim();
  if (readinessHistory) throw new Error('Approved readiness successor cannot be downgraded');
  if (manifest.schema === REPAIR_CONTRACT_SET_SCHEMA) {
    // Every package member, including the structured approval, was already
    // checked against this exact Git commit by verifySourceRepository.
    const approval = JSON.parse(source(REPAIR_APPROVAL));
    verifyRepairApproval(approval, manifest);
    return;
  }
  const repairHistory = String(runGit(repositoryRoot, ['log', '--full-history', '-1', '--format=%H', manifest.source_git_sha, '--', REPAIR_APPROVAL], 'utf8')).trim();
  if (repairHistory) throw new Error('Approved repair successor cannot be downgraded to a previous profile');
  if (manifest.schema === SOP_CONTRACT_SET_SCHEMA) {
    const approval = source('business-docs/01-客服Agent项目/90-评审/2026-10-10_SOP合同冻结批准.md');
    if (!approval.includes('FROZEN · NOT EXPORTED · NOT INTAKE · SYNTHETIC DEVELOPMENT ONLY')) {
      throw new Error('SOP successor approval must stay frozen and not exported as the main contract set');
    }
    const hashes = approval.match(/[0-9a-f]{64}/g) ?? [];
    if (!hashes.includes(manifest.openapi.sha256) || !hashes.includes(manifest.database.sha256)) {
      throw new Error('SOP successor approval hashes mismatch');
    }
    return;
  }
  const legacyCheck = manifest.schema === LEGACY_CHECK_CONTRACT_SET_SCHEMA;
  const csv = legacyCheck || manifest.schema === CSV_CONTRACT_SET_SCHEMA;
  for (const [enabled, approvalPath, label] of [
    [legacyCheck, LEGACY_CHECK_APPROVAL_PATH, 'Legacy check'], [csv, CSV_APPROVAL_PATH, 'CSV'],
  ]) {
    if (!enabled) {
      const history = String(runGit(repositoryRoot,
        ['log', '--full-history', '-1', '--format=%H', manifest.source_git_sha, '--', approvalPath], 'utf8')).trim();
      if (history) throw new Error(`${label} source history cannot be downgraded to a previous bundle profile`);
    }
  }
  if (!csv) return;
  let csvDatabaseHash = manifest.database.sha256;
  let csvInstallationHash = manifest.runtime.installation.sha256;
  if (legacyCheck) {
    const installation = JSON.parse(source(manifest.runtime.installation.source_path));
    csvDatabaseHash = installation.predecessor.sha256;
    csvInstallationHash = manifest.runtime.csvInstallation.sha256;
    if (sha256Bytes(runGit(repositoryRoot, ['show', `${manifest.source_git_sha}:${installation.predecessor.path}`])) !== csvDatabaseHash) {
      throw new Error('Legacy check predecessor does not match the declared source Git commit');
    }
    const pair = [manifest.openapi.sha256, manifest.database.sha256];
    verifyApprovalAnchors(source(LEGACY_CHECK_INCREMENT_PATH), source(LEGACY_CHECK_APPROVAL_PATH), 'Legacy check', [
      ['increment', '**直接前序机器合同：**', [manifest.openapi.sha256, csvDatabaseHash]],
      ['increment', '**P2 旧内容校验 ACL 机器合同增量：**', pair],
      ['increment', '**实际产物必须精确匹配：**', pair],
      ['approval', '**批准产物：**', pair],
      ['increment', '**旧内容校验安装清单：**', [manifest.runtime.installation.sha256]],
      ['approval', '**批准安装清单：**', [manifest.runtime.installation.sha256]],
      ['increment', '**旧内容校验 ACL 增量：**', [manifest.runtime.legacyAcl.sha256]],
      ['approval', '**批准 ACL 增量：**', [manifest.runtime.legacyAcl.sha256]],
    ]);
  }
  const pair = [manifest.openapi.sha256, csvDatabaseHash];
  verifyApprovalAnchors(source(CSV_INCREMENT_PATH), source(CSV_APPROVAL_PATH), 'CSV', [
    ['increment', '**P2 CSV 机器合同增量：**', pair],
    ['increment', '**实际产物必须精确匹配：**', pair],
    ['approval', '**批准产物：**', pair],
    ['increment', '**CSV 安装清单：**', [csvInstallationHash]],
    ['approval', '**批准安装清单：**', [csvInstallationHash]],
  ]);
}

function verifyApprovalAnchors(increment, approval, label, bindings) {
  if (!/^> 状态：FROZEN · NOT EXPORTED · NOT INTAKE · SYNTHETIC DEVELOPMENT ONLY\r?$/m.test(increment)
    || !/^> 状态：APPROVED · CONTRACT ONLY · SYNTHETIC DEVELOPMENT ONLY\r?$/m.test(approval)) {
    throw new Error(`${label} source contract must be FROZEN and APPROVED`);
  }
  for (const [document, anchor, hashes] of bindings) {
    const text = document === 'increment' ? increment : approval;
    const lines = text.split(/\r?\n/).filter(line => line.includes(anchor));
    if (lines.length !== 1 || !isDeepStrictEqual((lines[0].match(/[0-9a-f]{64}/g) ?? []).sort(), [...hashes].sort())) {
      throw new Error(`${label} source approval hashes mismatch at ${anchor}`);
    }
  }
}

function verifySourceRepository(sourceRepositoryRoot, manifest) {
  if (!sourceRepositoryRoot) {
    throw new Error(
      'Contract intake requires --source-repository-root=<trusted ai-赋能立项 checkout>',
    );
  }
  const resolvedRepositoryRoot = realpathSync(path.resolve(sourceRepositoryRoot));
  assertDirectory(resolvedRepositoryRoot, 'Source repository root');
  const exactObjects = manifest.schema === TASK_GRAPH_SCHEMA;
  const gitTopLevel = String(
    runGit(resolvedRepositoryRoot, ['rev-parse', '--show-toplevel'], 'utf8', exactObjects),
  ).trim();
  if (realpathSync(gitTopLevel) !== resolvedRepositoryRoot) {
    throw new Error('Source repository root must be the Git top-level directory');
  }
  // A shallow boundary can hide a versioned approval that was later deleted.
  // Negative history assertions are only valid against a complete source graph.
  if (String(runGit(resolvedRepositoryRoot, ['rev-parse', '--is-shallow-repository'], 'utf8', exactObjects)).trim() !== 'false') {
    throw new Error('Source repository must have complete Git history; shallow clones are not accepted');
  }
  runGit(resolvedRepositoryRoot, ['cat-file', '-e', `${manifest.source_git_sha}^{commit}`], 'buffer', exactObjects);

  for (const [label, descriptor] of contractDescriptors(manifest)) {
    if (manifest.schema === TASK_GRAPH_SCHEMA) assertSourceGitFile(resolvedRepositoryRoot, manifest.source_git_sha, descriptor.source_path);
    const committedBytes = runGit(
      resolvedRepositoryRoot,
      ['show', `${manifest.source_git_sha}:${descriptor.source_path}`],
      'buffer',
      exactObjects,
    );
    if (
      committedBytes.length !== descriptor.bytes
      || sha256Bytes(committedBytes) !== descriptor.sha256
    ) {
      throw new Error(`${label} contract does not match the declared source Git commit`);
    }
  }
  if (manifest.schema === TASK_GRAPH_SCHEMA) {
    const members = String(runGit(resolvedRepositoryRoot, ['ls-tree', '--name-only', `${manifest.source_git_sha}:${TASK_GRAPH_SOURCE}`], 'utf8', true)).trim().split('\n').sort();
    const expected = [manifest.openapi.file, manifest.database.file, ...Object.values(TASK_GRAPH_MEMBERS).map(([file]) => file)].sort();
    if (!isDeepStrictEqual(members, expected)) throw new Error('Task graph source members mismatch');
    const predecessor = JSON.parse(String(runGit(resolvedRepositoryRoot, ['show', `${manifest.source_git_sha}:${manifest.sopTaskGraph.predecessor.source_path}`], 'utf8', true)));
    runGit(resolvedRepositoryRoot, ['cat-file', '-e', `${predecessor.sourceGitSha}^{commit}`], 'buffer', true);
    try {
      runGit(resolvedRepositoryRoot, ['merge-base', '--is-ancestor', predecessor.sourceGitSha, manifest.source_git_sha], 'buffer', true);
    } catch {
      throw new Error('Task graph predecessor is not an ancestor of the source commit, or ancestry could not be verified');
    }
    for (const reference of Object.values(predecessor.artifacts)) {
      assertSourceGitFile(resolvedRepositoryRoot, predecessor.sourceGitSha, reference.path);
      if (sha256Bytes(runGit(resolvedRepositoryRoot, ['show', `${predecessor.sourceGitSha}:${reference.path}`], 'buffer', true)) !== reference.sha256) throw new Error('Task graph source predecessor hash mismatch');
    }
    for (const [file, descriptor] of [
      ['openapi.candidate.yaml', manifest.openapi],
      ['schema.candidate.sql', manifest.database],
      ['storage.candidate.sql', manifest.sopTaskGraph.storage],
      ['installation.candidate.json', manifest.sopTaskGraph.installation],
      ['manifest.candidate.json', manifest.sopTaskGraph.provenance],
      ['shapes.source.json', manifest.sopTaskGraph.shapes],
      ['rules.source.json', manifest.sopTaskGraph.rules],
      ['storage.source.sql', manifest.sopTaskGraph.storage],
    ]) {
      const sourcePath = `${TASK_GRAPH_CANDIDATE}/${file}`;
      assertSourceGitFile(resolvedRepositoryRoot, manifest.source_git_sha, sourcePath);
      const bytes = runGit(resolvedRepositoryRoot, ['show', `${manifest.source_git_sha}:${sourcePath}`], 'buffer', true);
      if (bytes.length !== descriptor.bytes || sha256Bytes(bytes) !== descriptor.sha256) {
        throw new Error(`Task graph committed candidate differs from frozen member: ${file}`);
      }
    }
    verifySourceApproval(resolvedRepositoryRoot, manifest);
    const provenance = JSON.parse(String(runGit(resolvedRepositoryRoot, ['show', `${manifest.source_git_sha}:${manifest.sopTaskGraph.provenance.source_path}`], 'utf8', true)));
    const historicalSha = provenance.historicalCandidateGitSha;
    if (historicalSha !== TASK_GRAPH_HISTORY) throw new Error('Task graph historical source does not match the designated historical candidate');
    verifyTaskGraphHistoricalInputs(resolvedRepositoryRoot, manifest, historicalSha);
    verifyTaskGraphProducerBlobs(resolvedRepositoryRoot, manifest.source_git_sha, TASK_GRAPH_PRODUCER_HASHES);
  }
  if (manifest.schema !== TASK_GRAPH_SCHEMA) verifySourceApproval(resolvedRepositoryRoot, manifest);
  return resolvedRepositoryRoot;
}

function assertSourceGitFile(repositoryRoot, revision, relativePath) {
  const entry = String(runGit(repositoryRoot, ['ls-tree', revision, '--', relativePath], 'utf8', true)).trim();
  if (!/^(100644|100755) blob [0-9a-f]{40}\t/.test(entry)) throw new Error(`Source Git file is not a regular blob: ${relativePath}`);
}

/** Compares committed blobs; the caller must separately authenticate the fingerprints. */
export function verifyTaskGraphProducerBlobs(repositoryRoot, revision, fingerprints) {
  requireString(revision, GIT_SHA_PATTERN, 'Task graph source SHA');
  assertExactKeys(fingerprints, Object.keys(TASK_GRAPH_PRODUCER_HASHES), 'Task graph producer fingerprints');
  const producers = Object.fromEntries(Object.keys(fingerprints).map(name => {
    requireString(fingerprints[name], HASH_PATTERN, `Task graph producer fingerprint ${name}`);
    const sourcePath = `business-docs/08-工具/${name}`;
    assertSourceGitFile(repositoryRoot, revision, sourcePath);
    return [name, runGit(repositoryRoot, ['show', `${revision}:${sourcePath}`], 'buffer', true)];
  }));
  assertProducerFingerprints(producers, fingerprints);
  return producers;
}

/** Checks inheritance only; the caller must separately authenticate the history and producer. */
export function verifyTaskGraphHistoricalInputs(repositoryRoot, manifest, historicalSha) {
  requireString(historicalSha, GIT_SHA_PATTERN, 'Task graph historical source SHA');
  requireString(manifest?.source_git_sha, GIT_SHA_PATTERN, 'Task graph source SHA');
  runGit(repositoryRoot, ['cat-file', '-e', `${historicalSha}^{commit}`], 'buffer', true);
  try {
    runGit(repositoryRoot, ['merge-base', '--is-ancestor', historicalSha, manifest.source_git_sha], 'buffer', true);
  } catch {
    throw new Error('Task graph historical source is not an ancestor of the source commit, or ancestry could not be verified');
  }
  for (const [sourcePath, descriptor] of [
    [`${TASK_GRAPH_HISTORY_CANDIDATE}/predecessor.source.json`, manifest.sopTaskGraph.predecessor],
    [TASK_GRAPH_APPROVAL, manifest.sopTaskGraph.approval],
  ]) {
    assertSourceGitFile(repositoryRoot, historicalSha, sourcePath);
    const bytes = runGit(repositoryRoot, ['show', `${historicalSha}:${sourcePath}`], 'buffer', true);
    if (bytes.length !== descriptor.bytes || sha256Bytes(bytes) !== descriptor.sha256) {
      throw new Error(`Task graph inherited historical member mismatch: ${sourcePath}`);
    }
  }
  for (const name of ['build_customer_agent_sop_graph_candidate.mjs', 'build_customer_agent_sop_task_graph_candidate.mjs']) {
    const sourcePath = `business-docs/08-工具/${name}`;
    assertSourceGitFile(repositoryRoot, historicalSha, sourcePath);
    assertSourceGitFile(repositoryRoot, manifest.source_git_sha, sourcePath);
    const historical = runGit(repositoryRoot, ['show', `${historicalSha}:${sourcePath}`], 'buffer', true);
    const current = runGit(repositoryRoot, ['show', `${manifest.source_git_sha}:${sourcePath}`], 'buffer', true);
    if (!historical.equals(current)) throw new Error(`Task graph inherited builder differs from history: ${name}`);
  }
}

function readExactGitObject(repositoryRoot, type, objectId) {
  requireString(objectId, GIT_SHA_PATTERN, 'Git object SHA');
  const data = runGit(repositoryRoot, ['cat-file', type, objectId], 'buffer', true);
  const object = Buffer.concat([Buffer.from(`${type} ${data.length}\0`), data]);
  if (createHash('sha1').update(object).digest('hex') !== objectId) throw new Error('Git object bytes do not match their identity');
  return { data, object };
}

function commitParents(data) {
  const header = data.toString('utf8').split('\n\n', 1)[0];
  const parents = [];
  for (const line of header.split('\n')) {
    if (!line.startsWith('parent ')) continue;
    const parent = line.slice(7);
    requireString(parent, GIT_SHA_PATTERN, 'Git parent SHA');
    parents.push(parent);
  }
  return parents;
}

function assertRawGitAncestor(repositoryRoot, ancestor, descendant) {
  const pending = [descendant];
  const seen = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (current === ancestor) return;
    if (seen.has(current)) continue;
    seen.add(current);
    if (seen.size > 10000) throw new Error('Task graph source ancestry exceeds the verification limit');
    pending.push(...commitParents(readExactGitObject(repositoryRoot, 'commit', current).data));
  }
  throw new Error('Task graph source does not have the required raw Git ancestry');
}

function seedGitPath(repositoryRoot, destination, revision, relativePath, cache) {
  const put = (type, objectId) => {
    const key = `${type}:${objectId}`;
    if (cache.has(key)) return cache.get(key);
    const { data, object } = readExactGitObject(repositoryRoot, type, objectId);
    const file = path.join(destination, '.git', 'objects', objectId.slice(0, 2), objectId.slice(2));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, deflateSync(object), { flag: 'wx', mode: 0o600 });
    cache.set(key, data);
    return data;
  };
  const commit = put('commit', revision).toString('utf8');
  const tree = commit.match(/^tree ([0-9a-f]{40})\n/);
  if (!tree) throw new Error('Task graph Git commit has no valid tree');
  let treeId = tree[1];
  const segments = relativePath.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) throw new Error('Invalid fixed Git path');
  for (const [index, segment] of segments.entries()) {
    const data = put('tree', treeId);
    let position = 0;
    let entry;
    while (position < data.length) {
      const space = data.indexOf(0x20, position);
      const end = data.indexOf(0, space + 1);
      if (space < position || end < 0 || end + 21 > data.length) throw new Error('Malformed Git tree');
      const name = data.subarray(space + 1, end);
      const mode = data.toString('ascii', position, space);
      const objectId = data.subarray(end + 1, end + 21).toString('hex');
      position = end + 21;
      if (name.equals(Buffer.from(segment))) { entry = { mode, objectId }; break; }
    }
    if (!entry) throw new Error(`Task graph historical Git path is missing: ${relativePath}`);
    if (index === segments.length - 1) {
      if (!['100644', '100755'].includes(entry.mode)) throw new Error(`Task graph historical Git path is not a regular blob: ${relativePath}`);
      return put('blob', entry.objectId);
    }
    if (!['40000', '040000'].includes(entry.mode)) throw new Error(`Task graph historical Git path is not a tree: ${relativePath}`);
    treeId = entry.objectId;
  }
  throw new Error('Task graph Git path is empty');
}

function committedTaskGraphBlob(repositoryRoot, revision, relativePath) {
  assertSourceGitFile(repositoryRoot, revision, relativePath);
  return runGit(repositoryRoot, ['show', `${revision}:${relativePath}`], 'buffer', true);
}

/**
 * Development-only reconstruction assumes SHA-1 Git objects, trusted system Git/Node,
 * and an audited producer import closure. The temporary Git repository is not an OS sandbox.
 * The result is review material, never an intake authorization.
 */
export function reconstructTaskGraphCandidate({ sourceDirectory, sourceRepositoryRoot } = {}) {
  if (!sourceDirectory) throw new Error('Task graph reconstruction requires a contract-set directory');
  const source = verifyContractSetDirectory(sourceDirectory);
  if (source.manifest.schema !== TASK_GRAPH_SCHEMA) throw new Error('Task graph reconstruction requires v9');
  const repositoryRoot = verifySourceRepository(sourceRepositoryRoot, source.manifest);
  const { manifest } = source;
  const manifestBytes = readFileSync(path.join(source.directory, MANIFEST_FILE));
  if (!isDeepStrictEqual(JSON.parse(manifestBytes), manifest)) throw new Error('Task graph manifest changed during reconstruction');
  const producers = verifyTaskGraphProducerBlobs(repositoryRoot, manifest.source_git_sha, TASK_GRAPH_PRODUCER_HASHES);
  const candidateNames = ['openapi.candidate.yaml', 'schema.candidate.sql', 'storage.candidate.sql', 'installation.candidate.json',
    'manifest.candidate.json', 'shapes.source.json', 'rules.source.json', 'storage.source.sql'];
  const candidate = Object.fromEntries(candidateNames.map(name => [name,
    committedTaskGraphBlob(repositoryRoot, manifest.source_git_sha, `${TASK_GRAPH_CANDIDATE}/${name}`)]));
  const predecessor = JSON.parse(committedTaskGraphBlob(repositoryRoot, TASK_GRAPH_HISTORY, `${TASK_GRAPH_HISTORY_CANDIDATE}/predecessor.source.json`));
  requireString(predecessor.sourceGitSha, GIT_SHA_PATTERN, 'Task graph predecessor SHA');
  assertRawGitAncestor(repositoryRoot, TASK_GRAPH_HISTORY, manifest.source_git_sha);
  assertRawGitAncestor(repositoryRoot, predecessor.sourceGitSha, TASK_GRAPH_HISTORY);
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-sop-rebuild-'));
  try {
    mkdirSync(path.join(temporary, '.git', 'objects'), { recursive: true });
    mkdirSync(path.join(temporary, '.git', 'refs', 'heads'), { recursive: true });
    writeFileSync(path.join(temporary, '.git', 'HEAD'), 'ref: refs/heads/rebuild\n', { mode: 0o600 });
    writeFileSync(path.join(temporary, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n\tbare = false\n', { mode: 0o600 });
    const cache = new Map();
    const historyPaths = [`${TASK_GRAPH_HISTORY_CANDIDATE}/predecessor.source.json`, TASK_GRAPH_APPROVAL,
      'business-docs/08-工具/build_customer_agent_sop_graph_candidate.mjs',
      'business-docs/08-工具/build_customer_agent_sop_task_graph_candidate.mjs'];
    const baselinePaths = [`${READINESS_SOURCE}/openapi.v1.yaml`, `${READINESS_SOURCE}/schema-v1.29.sql`];
    const input = {};
    for (const [revision, paths] of [[TASK_GRAPH_HISTORY, historyPaths], [predecessor.sourceGitSha, baselinePaths]]) {
      for (const relativePath of paths) {
        const bytes = seedGitPath(repositoryRoot, temporary, revision, relativePath, cache);
        input[`${revision}:${relativePath}`] = { sha256: sha256Bytes(bytes), bytes: bytes.length };
      }
    }
    for (const [name, bytes] of Object.entries(producers)) {
      const target = path.join(temporary, 'business-docs/08-工具', name);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
    }
    for (const [name, bytes] of Object.entries(candidate)) {
      const relativePath = `${TASK_GRAPH_CANDIDATE}/${name}`;
      const target = path.join(temporary, relativePath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
      if (name.endsWith('.source.json') || name === 'storage.source.sql') {
        input[`${manifest.source_git_sha}:${relativePath}`] = { sha256: sha256Bytes(bytes), bytes: bytes.length };
      }
    }
    const stagedProducers = Object.fromEntries(Object.keys(producers).map(name => {
      const file = path.join(temporary, 'business-docs/08-工具', name);
      assertPathInsideRoot(temporary, file);
      assertRegularFile(file, 'Staged task graph producer');
      return [name, readFileSync(file)];
    }));
    assertProducerFingerprints(stagedProducers, TASK_GRAPH_PRODUCER_HASHES);
    for (const [name, bytes] of Object.entries(candidate)) {
      const file = path.join(temporary, TASK_GRAPH_CANDIDATE, name);
      assertPathInsideRoot(temporary, file);
      assertRegularFile(file, 'Staged task graph candidate');
      if (!readFileSync(file).equals(bytes)) throw new Error(`Task graph candidate changed before reconstruction: ${name}`);
    }
    const entry = path.join(temporary, 'business-docs/08-工具/build_customer_agent_sop_resume_candidate.mjs');
    try {
      execFileSync(process.execPath, [entry, '--check'], {
        cwd: temporary, env: taskGraphEnvironment(taskGraphGitExecutable()), timeout: 30000,
        maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      throw new Error('Task graph producer reconstruction check failed');
    }
    for (const [name, bytes] of Object.entries(producers)) {
      if (!readFileSync(path.join(temporary, 'business-docs/08-工具', name)).equals(bytes)) throw new Error(`Task graph producer changed during reconstruction: ${name}`);
    }
    for (const [name, bytes] of Object.entries(candidate)) {
      if (!readFileSync(path.join(temporary, TASK_GRAPH_CANDIDATE, name)).equals(bytes)) throw new Error(`Task graph candidate changed during reconstruction: ${name}`);
    }
    const checkedAgain = verifyContractSetDirectory(source.directory);
    if (!isDeepStrictEqual(checkedAgain.manifest, manifest)
      || sha256(path.join(source.directory, MANIFEST_FILE)) !== sha256Bytes(manifestBytes)) {
      throw new Error('Task graph bundle changed during reconstruction');
    }
    const proof = {
      schema: 'customer-agent-sop-reconstruction-candidate/v1',
      source_git_sha: manifest.source_git_sha,
      historical_git_sha: TASK_GRAPH_HISTORY,
      predecessor_git_sha: predecessor.sourceGitSha,
      producers: Object.fromEntries(Object.entries(producers).map(([name, bytes]) => [name, { sha256: sha256Bytes(bytes), bytes: bytes.length }])),
      runtime: { node: process.versions.node, git: String(runGit(repositoryRoot, ['--version'], 'utf8', true)).trim() },
      inputs: Object.fromEntries(Object.entries(input).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)),
      candidate_files: Object.fromEntries(Object.entries(candidate).map(([name, bytes]) => [name, { sha256: sha256Bytes(bytes), bytes: bytes.length }])),
      manifest_sha256: sha256Bytes(manifestBytes),
      outputs: Object.fromEntries(contractDescriptors(manifest).map(([label, descriptor]) => [label, { ...descriptor }])),
      runtime_activated: false,
    };
    return Object.freeze({ status: 'RECONSTRUCTED_NOT_AUTHORIZED', proof: Object.freeze(proof), proof_sha256: sha256Bytes(Buffer.from(JSON.stringify(proof))) });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

/** A reviewed product-code anchor authenticates the proof; the proof never authorizes itself. */
export function verifyTaskGraphReviewAnchor(result) {
  assertExactKeys(result, ['status', 'proof', 'proof_sha256'], 'Task graph reconstruction result');
  if (result.status !== 'RECONSTRUCTED_NOT_AUTHORIZED') throw new Error('Task graph reconstruction result is invalid');
  assertExactKeys(result.proof, ['schema', 'source_git_sha', 'historical_git_sha', 'predecessor_git_sha', 'producers', 'runtime',
    'inputs', 'candidate_files', 'manifest_sha256', 'outputs', 'runtime_activated'], 'Task graph reconstruction proof');
  const proof = result.proof;
  if (proof.schema !== 'customer-agent-sop-reconstruction-candidate/v1' || proof.runtime_activated !== false) {
    throw new Error('Task graph reconstruction proof identity is invalid');
  }
  requireString(proof.source_git_sha, GIT_SHA_PATTERN, 'Task graph proof source SHA');
  requireString(proof.historical_git_sha, GIT_SHA_PATTERN, 'Task graph proof historical SHA');
  requireString(proof.predecessor_git_sha, GIT_SHA_PATTERN, 'Task graph proof predecessor SHA');
  requireString(proof.manifest_sha256, HASH_PATTERN, 'Task graph proof manifest SHA-256');
  requireString(result.proof_sha256, HASH_PATTERN, 'Task graph proof SHA-256');
  const anchor = reviewedTaskGraphAnchor(proof.source_git_sha);
  if (!anchor) throw new Error('Task graph source has no reviewed product-code anchor');
  assertExactKeys(anchor, ['manifest_sha256', 'proof_sha256'], 'Task graph product-code anchor');
  requireString(anchor.manifest_sha256, HASH_PATTERN, 'Task graph anchor manifest SHA-256');
  requireString(anchor.proof_sha256, HASH_PATTERN, 'Task graph anchor proof SHA-256');
  if (proof.manifest_sha256 !== anchor.manifest_sha256) throw new Error('Task graph proof manifest does not match the product-code anchor');
  if (result.proof_sha256 !== sha256Bytes(Buffer.from(JSON.stringify(proof))) || result.proof_sha256 !== anchor.proof_sha256) {
    throw new Error('Task graph proof does not match the product-code anchor');
  }
  return Object.freeze({ source_git_sha: proof.source_git_sha, manifest_sha256: proof.manifest_sha256, proof_sha256: result.proof_sha256 });
}

function assertProjectRoot(projectRoot) {
  const resolvedRoot = realpathSync(path.resolve(projectRoot));
  if (resolvedRoot === path.parse(resolvedRoot).root || resolvedRoot === os.homedir()) {
    throw new Error(`Refusing unsafe product root: ${resolvedRoot}`);
  }
  const packagePath = path.join(resolvedRoot, 'package.json');
  assertRegularFile(packagePath, 'Product package.json');
  const packageJson = readJson(packagePath, 'Product package.json');
  if (packageJson.name !== EXPECTED_PACKAGE_NAME) {
    throw new Error(`Refusing unexpected product package: ${String(packageJson.name)}`);
  }
  return resolvedRoot;
}

function assertPathInsideRoot(projectRoot, targetPath) {
  const relative = path.relative(projectRoot, targetPath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing path outside product root: ${targetPath}`);
  }
  let cursor = projectRoot;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`Refusing symlink in contract intake path: ${cursor}`);
    }
  }
}

function acquireIntakeLock(projectRoot, upstreamRoot) {
  const lockDirectory = path.join(upstreamRoot, '.contract-intake.lock');
  assertPathInsideRoot(projectRoot, lockDirectory);
  try {
    mkdirSync(lockDirectory);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      throw new Error('Another contract-set operation is already in progress');
    }
    throw error;
  }
  return () => rmdirSync(lockDirectory);
}

const REPAIR_ARTIFACT_KEYS = Object.freeze({
  'openapi.candidate.json': 'openapi', 'schema.candidate.sql': 'database',
  'upgrade.candidate.sql': 'upgrade', 'installation.candidate.json': 'installation',
  'predecessor-lock.json': 'predecessor', 'manifest.json': 'provenance',
});
const REPAIR_VERSIONS = Object.freeze({ openapi: '1.24.0', schema: '1.28', migration: '0040', exportProfile: 'content-intake-repair-successor-v1' });

function verifyRepairApproval(approval, manifest) {
  if (approval.schema !== 'customer-agent-repair-successor-approval/v1' || approval.status !== 'APPROVED'
    || !isDeepStrictEqual(approval.versions, REPAIR_VERSIONS)
    || ['freezeApproved', 'exportApproved', 'intakeApproved', 'syntheticOnly'].some(k => approval[k] !== true)
    || ['runtimeActivated', 'productionConsumerReady'].some(k => approval[k] !== false)) {
    throw new Error('Repair successor requires exact version approval without runtime activation');
  }
  assertExactKeys(approval.artifacts, Object.keys(REPAIR_ARTIFACT_KEYS), 'approved repair artifacts');
  for (const [name, key] of Object.entries(REPAIR_ARTIFACT_KEYS)) {
    const descriptor = manifest[key] ?? manifest.repair[key];
    if (approval.artifacts[name] !== descriptor.sha256) throw new Error(`Repair approval hash mismatch: ${name}`);
  }
}

function verifyRepairReferences(directory, manifest) {
  const read = key => readJson(path.join(directory, manifest.repair[key].file), `Repair ${key}`);
  verifyRepairApproval(read('approval'), manifest);
  const provenance = read('provenance');
  const installation = read('installation');
  const predecessor = read('predecessor');
  if (!isDeepStrictEqual(provenance.proposedVersions, REPAIR_VERSIONS)
    || !isDeepStrictEqual(installation.proposal, REPAIR_VERSIONS)
    || installation.predecessor?.migrationCount !== 39 || installation.predecessor?.newDatabaseBootstrap !== false
    || installation.owner !== 'intake_runtime_fn_owner') throw new Error('Repair installation boundary mismatch');
  for (const name of ['openapi.candidate.json', 'schema.candidate.sql', 'upgrade.candidate.sql', 'installation.candidate.json']) {
    const key = REPAIR_ARTIFACT_KEYS[name]; const descriptor = manifest[key] ?? manifest.repair[key];
    if (provenance.artifacts?.[name]?.sha256 !== descriptor.sha256 || provenance.artifacts[name].bytes !== descriptor.bytes) {
      throw new Error(`Repair provenance mismatch: ${name}`);
    }
  }
  requireString(predecessor.manifestSha256, HASH_PATTERN, 'predecessor manifest hash');
  if (!Array.isArray(predecessor.migrations) || predecessor.migrations.length !== 39) throw new Error('Repair requires exactly 39 predecessors');
  const names = new Set();
  predecessor.migrations.forEach((m, i) => {
    if (m.position !== i + 1 || !/^\d{4}_[a-z0-9_]+$/.test(m.id) || m.file !== `${m.id}.sql`
      || names.has(m.file) || !Number.isSafeInteger(m.bytes) || m.bytes < 1) throw new Error('Invalid repair predecessor entry');
    names.add(m.file); requireString(m.sha256, HASH_PATTERN, 'predecessor hash');
  });
}

// This is an upgrade over the exact installed generator closure, never a bootstrap.
function verifyRepairPredecessor(projectRoot, directory) {
  verifyIngestedContractSet({ projectRoot });
  const predecessor = readJson(path.join(directory, REPAIR_MEMBERS.predecessor), 'Repair predecessor');
  const migrationRoot = path.join(projectRoot, 'packages/database/migrations');
  const manifestPath = path.join(migrationRoot, 'manifest.generated.json');
  assertPathInsideRoot(projectRoot, manifestPath); assertRegularFile(manifestPath, 'Migration manifest');
  const actual = readJson(manifestPath, 'Migration manifest');
  // The accepted catalogue lengths grow by one per appended overlay; 0065 only rewrites
  // constraint definitions and appends no contract increment.
  if (![39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79].includes(actual.migrations?.length)) throw new Error('Repair requires 39 predecessor migrations');
  if (actual.migrations.length >= 79 && actual.migrations[78]?.id !== '0079_directory_identity_activity') throw new Error('Unrecognized directory identity activity projection');
  if (actual.migrations.length >= 78 && actual.migrations[77]?.id !== '0078_seat_manual_grants') throw new Error('Unrecognized seat manual grants');
  if (actual.migrations.length === 39 && sha256(manifestPath) !== predecessor.manifestSha256) throw new Error('Repair predecessor manifest drift');
  if (actual.migrations.length >= 41 && !existsSync(path.join(projectRoot, UPSTREAM_ROOT, READINESS_LOCK))) throw new Error('Readiness lock required for 41 migrations');
  if (actual.migrations.length >= 42 && actual.migrations[41]?.id !== '0042_intake_occupied_domain_publish') throw new Error('Unrecognized occupied-domain publication');
  if (actual.migrations.length >= 43 && (actual.migrations[41]?.sha256 !== 'c692968890cef90c1f72651901a326a8e816347992c7795d58f56cbcc31d6f37' || actual.migrations[42]?.id !== '0043_intake_publish_default_tenant')) throw new Error('Frozen occupied-domain migration 0042 drifted');
  if (actual.migrations.length >= 44 && actual.migrations[43]?.id !== '0044_intake_role_defaults') throw new Error('Unrecognized intake role defaults');
  if (actual.migrations.length >= 45 && actual.migrations[44]?.id !== '0045_feishu_agent_admit') throw new Error('Unrecognized Feishu agent admission');
  if (actual.migrations.length >= 46 && actual.migrations[45]?.id !== '0046_project_feishu_roster') throw new Error('Unrecognized roster projection');
  if (actual.migrations.length >= 47 && actual.migrations[46]?.id !== '0047_roster_query_signer') throw new Error('Unrecognized query signer');
  if (actual.migrations.length >= 48 && actual.migrations[47]?.id !== '0048_roster_store_set') throw new Error('Unrecognized roster store set');
  if (actual.migrations.length >= 49 && actual.migrations[48]?.id !== '0049_roster_lifecycle') throw new Error('Unrecognized roster lifecycle');
  if (actual.migrations.length >= 40) {
    const lockPath = path.join(projectRoot, UPSTREAM_ROOT, REPAIR_LOCK);
    assertPathInsideRoot(projectRoot, lockPath); assertRegularFile(lockPath, 'Repair lock');
    const lock = validateConsumptionLock(readJson(lockPath, 'Repair lock'));
    const manifest = readJson(path.join(directory, MANIFEST_FILE), 'Repair manifest');
    if (lock.contract_set_id !== manifest.contract_set_id
      || actual.migrations[39].id !== '0040_intake_repair_successor_v1_28'
      || actual.compatibility?.repair_successor?.contract_set_id !== lock.contract_set_id) throw new Error('Unrecognized repair successor');
    const expected = renderRepairMigration({ contract_set_id: manifest.contract_set_id, source_git_sha: manifest.source_git_sha,
      manifest, repair_sources: { upgrade: readFileSync(path.join(directory, manifest.repair.upgrade.file), 'utf8') } });
    for (const key of ['position', 'id', 'file', 'sha256', 'bytes', 'contract_set_id', 'source_git_sha', 'source_schema_sha256']) {
      if (actual.migrations[39][key] !== expected[key]) throw new Error(`Repair migration metadata drift: ${key}`);
    }
    const file = path.join(migrationRoot, expected.file);
    assertPathInsideRoot(projectRoot, file); assertRegularFile(file, 'Repair migration');
    if (readFileSync(file, 'utf8') !== expected.sql) throw new Error('Repair migration bytes differ from approved upgrade');

  }
  for (const expected of predecessor.migrations) {
    const found = actual.migrations[expected.position - 1];
    for (const key of ['position', 'id', 'file', 'sha256', 'bytes']) {
      if (found[key] !== expected[key]) throw new Error(`Repair predecessor metadata drift: ${expected.file}`);
    }
    const file = path.join(migrationRoot, expected.file);
    assertPathInsideRoot(projectRoot, file); assertRegularFile(file, 'Predecessor migration');
    if (sha256(file) !== expected.sha256 || lstatSync(file).size !== expected.bytes) throw new Error(`Repair predecessor bytes drift: ${expected.file}`);
  }
}

function repairMetadata(snapshot) {
  const { contract_set_id, source_git_sha, path: directory, lock_path } = snapshot;
  return { contract_set_id, source_git_sha, path: directory, lock_path, intake_status: INTAKE_STATUS, ddev_authorized: false, runtime_activated: false };
}

// Called while the shared intake lock is held, so both generations remain coherent.
function verifyRepairIngested(projectRoot) {
  const lockPath = path.join(projectRoot, UPSTREAM_ROOT, REPAIR_LOCK);
  if (!existsSync(lockPath)) return null;
  assertPathInsideRoot(projectRoot, lockPath); assertRegularFile(lockPath, 'Repair lock');
  const lock = validateConsumptionLock(readJson(lockPath, 'Repair lock'));
  const directory = path.join(projectRoot, UPSTREAM_ROOT, lock.contract_set_id);
  assertPathInsideRoot(projectRoot, directory);
  const verified = verifyContractSetDirectory(directory);
  if (verified.manifest.schema !== REPAIR_CONTRACT_SET_SCHEMA) throw new Error('Repair lock requires v6 bundle');
  assertLockMatchesContractSet(lock, verified);
  verifyRepairPredecessor(projectRoot, directory);
  const manifest = verified.manifest;
  return Object.freeze({ ...repairMetadata({ ...lock, path: directory, lock_path: lockPath }),
    lock: Object.freeze(lock), manifest: Object.freeze(manifest),
    openapi_source: readFileSync(path.join(directory, manifest.openapi.file), 'utf8'),
    database_source: readFileSync(path.join(directory, manifest.database.file), 'utf8'),
    repair_sources: Object.freeze(Object.fromEntries(Object.entries(manifest.repair)
      .map(([key, descriptor]) => [key, readFileSync(path.join(directory, descriptor.file), 'utf8')]))),
  });
}

function verifyReadinessPredecessor(projectRoot, directory, manifest, repair) {
  const sources = verifyReadinessReferences(directory, manifest);
  const composed = composeReadiness(manifest, sources, repair);
  const predecessor = JSON.parse(sources.predecessor);
  const migrationRoot = path.join(projectRoot, 'packages/database/migrations');
  const manifestPath = path.join(migrationRoot, 'manifest.generated.json');
  assertPathInsideRoot(projectRoot, manifestPath); assertRegularFile(manifestPath, 'Migration manifest');
  const actual = readJson(manifestPath, 'Migration manifest');
  if (![40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79].includes(actual.migrations?.length)) throw new Error('Readiness requires 40 predecessor migrations');
  if (actual.migrations.length >= 79 && actual.migrations[78]?.id !== '0079_directory_identity_activity') throw new Error('Unrecognized directory identity activity projection');
  if (actual.migrations.length >= 78 && actual.migrations[77]?.id !== '0078_seat_manual_grants') throw new Error('Unrecognized seat manual grants');
  if (actual.migrations.length === 40 && sha256(manifestPath) !== predecessor.manifestSha256) throw new Error('Readiness predecessor manifest drift');
  for (const expected of predecessor.migrations) {
    const found = actual.migrations[expected.position - 1];
    for (const key of ['position','id','file','sha256','bytes']) if (found[key] !== expected[key]) throw new Error(`Readiness predecessor metadata drift: ${expected.file}`);
    const file=path.join(migrationRoot,expected.file);
    assertPathInsideRoot(projectRoot,file); assertRegularFile(file,'Readiness predecessor migration');
    if (sha256(file)!==expected.sha256 || lstatSync(file).size!==expected.bytes) throw new Error(`Readiness predecessor bytes drift: ${expected.file}`);
  }
  // Position 41 stays the readiness migration after every later product overlay.
  // A length cap here would accept a rewritten 0041 once the catalogue grew past it.
  if (actual.migrations.length >= 41) {
    const lockPath=path.join(projectRoot,UPSTREAM_ROOT,READINESS_LOCK);
    assertPathInsideRoot(projectRoot,lockPath); assertRegularFile(lockPath,'Readiness lock');
    const lock=validateConsumptionLock(readJson(lockPath,'Readiness lock'));
    if (lock.contract_set_id!==manifest.contract_set_id || actual.compatibility?.readiness_successor?.contract_set_id!==lock.contract_set_id) throw new Error('Unrecognized readiness successor');
    const expected=renderReadinessMigration({contract_set_id:manifest.contract_set_id,source_git_sha:manifest.source_git_sha,manifest,readiness_sources:sources});
    for(const key of ['position','id','file','sha256','bytes','contract_set_id','source_git_sha','source_schema_sha256']) if(actual.migrations[40][key]!==expected[key]) throw new Error(`Readiness migration metadata drift: ${key}`);
    const file=path.join(migrationRoot,expected.file); assertPathInsideRoot(projectRoot,file); assertRegularFile(file,'Readiness migration');
    if(readFileSync(file,'utf8')!==expected.sql) throw new Error('Readiness migration bytes drift');
    if (actual.migrations.length >= 42 && actual.migrations[41]?.id !== '0042_intake_occupied_domain_publish') throw new Error('Unrecognized occupied-domain publication');
    if (actual.migrations.length >= 43 && (actual.migrations[41]?.sha256 !== 'c692968890cef90c1f72651901a326a8e816347992c7795d58f56cbcc31d6f37' || actual.migrations[42]?.id !== '0043_intake_publish_default_tenant')) throw new Error('Frozen occupied-domain migration 0042 drifted');
    if (actual.migrations.length >= 44 && actual.migrations[43]?.id !== '0044_intake_role_defaults') throw new Error('Unrecognized intake role defaults');
    if (actual.migrations.length >= 45 && actual.migrations[44]?.id !== '0045_feishu_agent_admit') throw new Error('Unrecognized Feishu agent admission');
    if (actual.migrations.length >= 46 && actual.migrations[45]?.id !== '0046_project_feishu_roster') throw new Error('Unrecognized roster projection');
  if (actual.migrations.length >= 47 && actual.migrations[46]?.id !== '0047_roster_query_signer') throw new Error('Unrecognized query signer');
  if (actual.migrations.length >= 48 && actual.migrations[47]?.id !== '0048_roster_store_set') throw new Error('Unrecognized roster store set');
  if (actual.migrations.length >= 49 && actual.migrations[48]?.id !== '0049_roster_lifecycle') throw new Error('Unrecognized roster lifecycle');
  }
  return {readiness_sources:sources,...composed};
}

// The existing shared intake lock protects the predecessor, compact package and
// consumption lock throughout reconstruction and generated-output consumption.
function verifyReadinessIngested(projectRoot, repair) {
  const lockPath=path.join(projectRoot,UPSTREAM_ROOT,READINESS_LOCK);
  if(!existsSync(lockPath)) return null;
  assertPathInsideRoot(projectRoot,lockPath); assertRegularFile(lockPath,'Readiness lock');
  const lock=validateConsumptionLock(readJson(lockPath,'Readiness lock'));
  const directory=path.join(projectRoot,UPSTREAM_ROOT,lock.contract_set_id); assertPathInsideRoot(projectRoot,directory);
  const verified=verifyContractSetDirectory(directory);
  if(verified.manifest.schema!==READINESS_SCHEMA) throw new Error('Readiness lock requires v7 bundle');
  assertLockMatchesContractSet(lock,verified);
  const sources=verifyReadinessPredecessor(projectRoot,directory,verified.manifest,repair);
  return Object.freeze({...repairMetadata({...lock,path:directory,lock_path:lockPath}),lock:Object.freeze(lock),manifest:Object.freeze(verified.manifest),...sources});
}

function assertNoUnprovedTaskGraph(projectRoot) {
  const lockPath = path.join(projectRoot, UPSTREAM_ROOT, TASK_GRAPH_LOCK);
  try {
    lstatSync(lockPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  try {
    if (!lstatSync(lockPath).isFile() || lstatSync(lockPath).isSymbolicLink()) throw new Error('proof lock is not a regular file');
    const proof = readJson(lockPath, 'Task graph reconstruction proof lock');
    assertExactKeys(proof, [
      'schema', 'contract_set_id', 'source_repository', 'source_git_sha', 'manifest_sha256',
      'openapi_sha256', 'database_sha256', 'intake_status', 'ddev_authorized',
      'candidate_id', 'candidate_manifest_sha256', 'profile', 'runtime_activated', 'proof_sha256',
    ], 'Task graph reconstruction proof lock');
    if (proof.schema !== TASK_GRAPH_PROOF_LOCK_SCHEMA || proof.runtime_activated !== false) throw new Error('proof lock identity is invalid');
    requireString(proof.contract_set_id, CONTRACT_SET_ID_PATTERN, 'Task graph proof lock contract_set_id');
    if (proof.source_repository !== SOURCE_REPOSITORY || proof.intake_status !== INTAKE_STATUS || proof.ddev_authorized !== false) {
      throw new Error('proof lock authority is invalid');
    }
    requireString(proof.source_git_sha, GIT_SHA_PATTERN, 'Task graph proof lock source_git_sha');
    requireString(proof.manifest_sha256, HASH_PATTERN, 'Task graph proof lock manifest_sha256');
    requireString(proof.openapi_sha256, HASH_PATTERN, 'Task graph proof lock openapi_sha256');
    requireString(proof.database_sha256, HASH_PATTERN, 'Task graph proof lock database_sha256');
    if (proof.candidate_id !== TASK_GRAPH_CANDIDATE_ID || proof.profile !== TASK_GRAPH_VERSIONS.profile) {
      throw new Error('proof lock candidate identity is invalid');
    }
    requireString(proof.candidate_manifest_sha256, HASH_PATTERN, 'Task graph proof lock candidate_manifest_sha256');
    requireString(proof.proof_sha256, HASH_PATTERN, 'Task graph proof lock proof_sha256');
    const anchor = reviewedTaskGraphAnchor(proof.source_git_sha);
    if (!anchor || anchor.manifest_sha256 !== proof.manifest_sha256 || anchor.proof_sha256 !== proof.proof_sha256) {
      throw new Error('proof lock is not bound to a reviewed product-code anchor');
    }
    return proof;
  } catch {
    throw new Error(TASK_GRAPH_RECONSTRUCTION_ERROR);
  }
}

function taskGraphProofLock(result) {
  const manifest = result.verifiedContractSet.manifest;
  return {
    schema: TASK_GRAPH_PROOF_LOCK_SCHEMA,
    contract_set_id: manifest.contract_set_id,
    source_repository: manifest.source_repository,
    source_git_sha: result.proof.source_git_sha,
    manifest_sha256: result.proof.manifest_sha256,
    openapi_sha256: manifest.openapi.sha256,
    database_sha256: manifest.database.sha256,
    intake_status: INTAKE_STATUS,
    ddev_authorized: false,
    candidate_id: TASK_GRAPH_CANDIDATE_ID,
    candidate_manifest_sha256: result.proof.candidate_files?.['manifest.candidate.json']?.sha256 ?? '',
    profile: TASK_GRAPH_VERSIONS.profile,
    proof_sha256: result.proof_sha256,
    runtime_activated: false,
  };
}

export function verifyIngestedTaskGraph({ projectRoot, expectedContractSetId } = {}) {
  const resolvedRoot = assertProjectRoot(projectRoot ?? defaultProjectRoot());
  const proof = assertNoUnprovedTaskGraph(resolvedRoot);
  if (expectedContractSetId && proof.contract_set_id !== expectedContractSetId) {
    throw new Error(`Expected task graph contract ${expectedContractSetId}, found ${proof.contract_set_id}`);
  }
  const directory = path.join(resolvedRoot, UPSTREAM_ROOT, proof.contract_set_id);
  assertPathInsideRoot(resolvedRoot, directory);
  const verified = verifyContractSetDirectory(directory);
  if (verified.manifest.schema !== TASK_GRAPH_SCHEMA) throw new Error('Task graph proof lock requires v9 bundle');
  assertTaskGraphProofMatchesContract(resolvedRoot, verified);
  if (proof.openapi_sha256 !== verified.manifest.openapi.sha256 || proof.database_sha256 !== verified.manifest.database.sha256) {
    throw new Error(TASK_GRAPH_RECONSTRUCTION_ERROR);
  }
  return Object.freeze({
    status: 'VERIFIED_PENDING',
    contract_set_id: proof.contract_set_id,
    source_git_sha: proof.source_git_sha,
    path: directory,
    lock_path: path.join(resolvedRoot, UPSTREAM_ROOT, TASK_GRAPH_LOCK),
    intake_status: proof.intake_status,
    ddev_authorized: false,
    runtime_activated: false,
  });
}

function assertTaskGraphProofMatchesContract(projectRoot, verifiedContractSet) {
  if (verifiedContractSet.manifest.schema !== TASK_GRAPH_SCHEMA) return;
  const proof = assertNoUnprovedTaskGraph(projectRoot);
  const manifestPath = path.join(verifiedContractSet.directory, MANIFEST_FILE);
  if (!proof || proof.source_git_sha !== verifiedContractSet.manifest.source_git_sha
    || proof.manifest_sha256 !== sha256(manifestPath)
    || proof.candidate_manifest_sha256 !== sha256(path.join(verifiedContractSet.directory, verifiedContractSet.manifest.sopTaskGraph.provenance.file))) {
    throw new Error(TASK_GRAPH_RECONSTRUCTION_ERROR);
  }
}

function assertTaskGraphExportedCandidate(directory, manifest) {
  const provenance = JSON.parse(readFileSync(path.join(directory, manifest.sopTaskGraph.provenance.file), 'utf8'));
  if (provenance.formalVersionAssigned !== true || provenance.businessMappingApproved !== true
    || provenance.freezeCompleted !== true || provenance.exportCompleted !== true
    || provenance.sourceGitSha !== manifest.source_git_sha) {
    throw new Error(TASK_GRAPH_REVIEW_ONLY_ERROR);
  }
}

function consumptionLock(verifiedContractSet) {
  const { directory, manifest } = verifiedContractSet;
  return {
    schema: CONSUMPTION_SCHEMA,
    contract_set_id: manifest.contract_set_id,
    source_repository: manifest.source_repository,
    source_git_sha: manifest.source_git_sha,
    manifest_sha256: sha256(path.join(directory, MANIFEST_FILE)),
    openapi_sha256: manifest.openapi.sha256,
    database_sha256: manifest.database.sha256,
    intake_status: INTAKE_STATUS,
    ddev_authorized: false,
    runtime_activated: false,
  };
}

function validateConsumptionLock(rawLock) {
  assertExactKeys(
    rawLock,
    [
      'schema',
      'contract_set_id',
      'source_repository',
      'source_git_sha',
      'manifest_sha256',
      'openapi_sha256',
      'database_sha256',
      'intake_status',
      'ddev_authorized',
      'runtime_activated',
    ],
    'contract-set lock',
  );
  if (rawLock.schema !== CONSUMPTION_SCHEMA || rawLock.source_repository !== SOURCE_REPOSITORY) {
    throw new Error('Contract-set lock identity is invalid');
  }
  requireString(rawLock.contract_set_id, CONTRACT_SET_ID_PATTERN, 'lock contract_set_id');
  requireString(rawLock.source_git_sha, GIT_SHA_PATTERN, 'lock source_git_sha');
  requireString(rawLock.manifest_sha256, HASH_PATTERN, 'lock manifest_sha256');
  requireString(rawLock.openapi_sha256, HASH_PATTERN, 'lock openapi_sha256');
  requireString(rawLock.database_sha256, HASH_PATTERN, 'lock database_sha256');
  if (
    rawLock.intake_status !== INTAKE_STATUS
    || rawLock.ddev_authorized !== false
    || rawLock.runtime_activated !== false
  ) {
    throw new Error('Contract-set lock must remain verified but not activated');
  }
  return rawLock;
}

function assertLockMatchesContractSet(lock, verifiedContractSet) {
  const expected = consumptionLock(verifiedContractSet);
  for (const [key, value] of Object.entries(expected)) {
    if (lock[key] !== value) {
      throw new Error(`Contract-set lock mismatch at ${key}`);
    }
  }
}

function writeJsonAtomically(filePath, value) {
  const parent = path.dirname(filePath);
  const temporaryDirectory = mkdtempSync(path.join(parent, '.lock-write-'));
  const temporaryFile = path.join(temporaryDirectory, path.basename(filePath));
  try {
    writeFileSync(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o644,
    });
    renameSync(temporaryFile, filePath);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export function verifyIngestedContractSet({ projectRoot, expectedContractSetId } = {}) {
  const resolvedRoot = assertProjectRoot(projectRoot ?? defaultProjectRoot());
  const upstreamRoot = path.join(resolvedRoot, UPSTREAM_ROOT);
  const lockPath = path.join(upstreamRoot, LOCK_FILE);
  assertPathInsideRoot(resolvedRoot, lockPath);
  assertRegularFile(lockPath, 'Contract-set lock');
  const lock = validateConsumptionLock(readJson(lockPath, 'Contract-set lock'));
  if (expectedContractSetId && lock.contract_set_id !== expectedContractSetId) {
    throw new Error(`Expected contract set ${expectedContractSetId}, found ${lock.contract_set_id}`);
  }
  const destination = path.join(upstreamRoot, lock.contract_set_id);
  assertPathInsideRoot(resolvedRoot, destination);
  const verified = verifyContractSetDirectory(destination);
  assertTaskGraphProofMatchesContract(resolvedRoot, verified);
  assertLockMatchesContractSet(lock, verified);
  return Object.freeze({
    status: 'VERIFIED',
    contract_set_id: lock.contract_set_id,
    source_git_sha: lock.source_git_sha,
    path: destination,
    lock_path: lockPath,
    intake_status: lock.intake_status,
    ddev_authorized: false,
    runtime_activated: false,
  });
}

/**
 * Runs a consumer against one coherent, verified contract-set snapshot.
 *
 * The shared intake lock stays held until the (possibly async) consumer
 * finishes, so a lock rollover cannot mix source bytes with another
 * snapshot's provenance or replace the active input while generated outputs
 * are being written.
 */
export async function withVerifiedContractSetSnapshot(
  { projectRoot, expectedContractSetId } = {},
  consumer,
) {
  if (typeof consumer !== 'function') {
    throw new Error('Contract-set snapshot consumer must be a function');
  }

  const resolvedRoot = assertProjectRoot(projectRoot ?? defaultProjectRoot());
  const upstreamRoot = path.join(resolvedRoot, UPSTREAM_ROOT);
  assertDirectory(upstreamRoot, 'Contract-set upstream directory');
  const releaseIntakeLock = acquireIntakeLock(resolvedRoot, upstreamRoot);

  try {
    const verified = verifyIngestedContractSet({
      projectRoot: resolvedRoot,
      expectedContractSetId,
    });
    const lock = validateConsumptionLock(readJson(verified.lock_path, 'Contract-set lock'));
    const manifestPath = path.join(verified.path, MANIFEST_FILE);
    const manifest = validateManifest(readJson(manifestPath, 'Contract-set manifest'));
    const openapiPath = path.join(verified.path, manifest.openapi.file);
    const databasePath = path.join(verified.path, manifest.database.file);
    assertRegularFile(openapiPath, 'OpenAPI contract');
    assertRegularFile(databasePath, 'Database contract');

    const repair = verifyRepairIngested(resolvedRoot);
    const readiness = verifyReadinessIngested(resolvedRoot, repair);
    const snapshot = Object.freeze({
      ...(repair ? { repair } : {}),
      ...(readiness ? { readiness } : {}),
      ...verified,
      lock: Object.freeze({ ...lock }),
      manifest: Object.freeze({
        ...manifest,
        openapi: Object.freeze({ ...manifest.openapi }),
        database: Object.freeze({ ...manifest.database }),
        ...(manifest.runtime ? { runtime: Object.freeze(Object.fromEntries(Object.entries(manifest.runtime)
          .map(([key, descriptor]) => [key, Object.freeze({ ...descriptor })]))) } : {}),
      }),
      openapi_source: readFileSync(openapiPath, 'utf8'),
      database_source: readFileSync(databasePath, 'utf8'),
      ...(manifest.runtime ? { runtime_sources: Object.freeze(Object.fromEntries(Object.entries(manifest.runtime)
        .map(([key, descriptor]) => [key, readFileSync(path.join(verified.path, descriptor.file), 'utf8')]))) } : {}),
    });
    return await consumer(snapshot);
  } finally {
    releaseIntakeLock();
  }
}

function manifestsMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function ingestContractSet({ projectRoot, sourceDirectory, sourceRepositoryRoot }) {
  if (!sourceDirectory) {
    throw new Error('Contract intake requires --source=<verified contract-set directory>');
  }
  const source = verifyContractSetDirectory(sourceDirectory);
  verifySourceRepository(sourceRepositoryRoot, source.manifest);
  const reconstruction = source.manifest.schema === TASK_GRAPH_SCHEMA
    ? reconstructTaskGraphCandidate({ sourceDirectory, sourceRepositoryRoot })
    : null;
  if (reconstruction) verifyTaskGraphReviewAnchor(reconstruction);
  if (source.manifest.schema === TASK_GRAPH_SCHEMA) assertTaskGraphExportedCandidate(source.directory, source.manifest);
  const resolvedRoot = assertProjectRoot(projectRoot ?? defaultProjectRoot());
  assertNoUnprovedTaskGraph(resolvedRoot);
  const upstreamRoot = path.join(resolvedRoot, UPSTREAM_ROOT);
  const destination = path.join(upstreamRoot, source.manifest.contract_set_id);
  const isReadiness = source.manifest.schema === READINESS_SCHEMA;
  const isRepair = source.manifest.schema === REPAIR_CONTRACT_SET_SCHEMA;
  const isTaskGraph = source.manifest.schema === TASK_GRAPH_SCHEMA;
  const lockPath = path.join(upstreamRoot, isTaskGraph ? TASK_GRAPH_LOCK : isReadiness ? READINESS_LOCK : isRepair ? REPAIR_LOCK : LOCK_FILE);
  assertPathInsideRoot(resolvedRoot, upstreamRoot);
  assertPathInsideRoot(resolvedRoot, destination);
  assertPathInsideRoot(resolvedRoot, lockPath);
  mkdirSync(upstreamRoot, { recursive: true });
  assertPathInsideRoot(resolvedRoot, destination);
  const releaseIntakeLock = acquireIntakeLock(resolvedRoot, upstreamRoot);

  try {
    assertNoUnprovedTaskGraph(resolvedRoot);
    const readinessLockPath = path.join(upstreamRoot, READINESS_LOCK);
    if (existsSync(readinessLockPath)) {
      const existing = verifyReadinessIngested(resolvedRoot, verifyRepairIngested(resolvedRoot));
      if (isReadiness && existing.contract_set_id !== source.manifest.contract_set_id) throw new Error('Refuse readiness lock downgrade or replacement');
      if (!isReadiness && !isTaskGraph) throw new Error('Refuse readiness lock downgrade or replacement');
      if (isTaskGraph) verifyTaskGraphPredecessor(source.manifest, verifyTaskGraphReferences(source.directory, source.manifest), existing);
    }
    const repairLockPath = path.join(upstreamRoot, REPAIR_LOCK);
    if (existsSync(repairLockPath)) {
      const existingRepair = verifyRepairIngested(resolvedRoot);
      if (!isReadiness && !isRepair && !isTaskGraph) throw new Error('Refuse repair lock downgrade or replacement');
      if (isRepair && existingRepair.contract_set_id !== source.manifest.contract_set_id) throw new Error('Refuse repair lock downgrade or replacement');
    }
    if (isReadiness) verifyReadinessPredecessor(resolvedRoot, source.directory, source.manifest, verifyRepairIngested(resolvedRoot));
    if (isRepair) verifyRepairPredecessor(resolvedRoot, source.directory);
    const current = existsSync(path.join(upstreamRoot, LOCK_FILE))
      ? verifyIngestedContractSet({ projectRoot: resolvedRoot })
      : null;

    if (existsSync(destination)) {
      const existing = verifyContractSetDirectory(destination);
      if (!manifestsMatch(existing.manifest, source.manifest)) {
        throw new Error('Existing contract-set manifest differs from the verified source');
      }
      if (isTaskGraph) {
        writeJsonAtomically(lockPath, taskGraphProofLock({ ...reconstruction, verifiedContractSet: existing }));
      } else if (source.manifest.schema !== SOP_CONTRACT_SET_SCHEMA && (!current || current.contract_set_id !== source.manifest.contract_set_id)) {
        writeJsonAtomically(lockPath, consumptionLock(existing));
      }
      if (isReadiness) return Object.freeze({ ...repairMetadata(verifyReadinessIngested(resolvedRoot, verifyRepairIngested(resolvedRoot))), status: 'REUSED', generateMigrations: true, generateContracts: true });
      if (isRepair) return Object.freeze({ ...repairMetadata(verifyRepairIngested(resolvedRoot)), status: 'REUSED', generateMigrations: true, generateContracts: true });
      if (isTaskGraph) return Object.freeze({ ...verifyIngestedTaskGraph({ projectRoot: resolvedRoot, expectedContractSetId: source.manifest.contract_set_id }), status: 'REUSED', generateMigrations: false, generateContracts: false });
      if (source.manifest.schema === SOP_CONTRACT_SET_SCHEMA) {
        const kept = verifyIngestedContractSet({ projectRoot: resolvedRoot });
        return Object.freeze({
          status: 'REUSED',
          contract_set_id: existing.manifest.contract_set_id,
          preserved_lock: kept.contract_set_id,
          path: destination,
          generateMigrations: true,
        });
      }
      const verified = verifyIngestedContractSet({
        projectRoot: resolvedRoot,
        expectedContractSetId: source.manifest.contract_set_id,
      });
      return Object.freeze({ ...verified, status: 'REUSED' });
    }

    const stagingDirectory = mkdtempSync(path.join(upstreamRoot, '.contract-intake-'));
    try {
      for (const member of expectedMembers(source.manifest)) {
        copyFileSync(
          path.join(source.directory, member),
          path.join(stagingDirectory, member),
          constants.COPYFILE_EXCL,
        );
      }
      const staged = verifyContractSetDirectory(stagingDirectory);
      // Internal hashes can remain self-consistent after a source-directory
      // replacement. Bind the copied bytes to the manifest checked against Git.
      if (!manifestsMatch(staged.manifest, source.manifest)) {
        throw new Error('Staged contract-set manifest differs from the verified source');
      }
      const nextLock = source.manifest.schema !== SOP_CONTRACT_SET_SCHEMA && !isTaskGraph
        ? consumptionLock(staged)
        : null;
      renameSync(stagingDirectory, destination);
      if (isTaskGraph) writeJsonAtomically(lockPath, taskGraphProofLock({ ...reconstruction, verifiedContractSet: staged }));
      else if (nextLock) writeJsonAtomically(lockPath, nextLock);
    } catch (error) {
      if (existsSync(stagingDirectory)) {
        rmSync(stagingDirectory, { recursive: true, force: true });
      }
      throw error;
    }

    if (isReadiness) return Object.freeze({ ...repairMetadata(verifyReadinessIngested(resolvedRoot, verifyRepairIngested(resolvedRoot))), status: 'CREATED', generateMigrations: true, generateContracts: true });
    if (isRepair) return Object.freeze({ ...repairMetadata(verifyRepairIngested(resolvedRoot)), status: 'CREATED', generateMigrations: true, generateContracts: true });
    if (isTaskGraph) return Object.freeze({ ...verifyIngestedTaskGraph({ projectRoot: resolvedRoot, expectedContractSetId: source.manifest.contract_set_id }), status: 'CREATED', generateMigrations: false, generateContracts: false });
    if (source.manifest.schema === SOP_CONTRACT_SET_SCHEMA) {
      const kept = verifyIngestedContractSet({ projectRoot: resolvedRoot });
      const successor = verifyContractSetDirectory(destination);
      return Object.freeze({
        status: 'CREATED',
        contract_set_id: successor.manifest.contract_set_id,
        preserved_lock: kept.contract_set_id,
        path: destination,
        generateMigrations: true,
      });
    }
    const verified = verifyIngestedContractSet({
      projectRoot: resolvedRoot,
      expectedContractSetId: source.manifest.contract_set_id,
    });
    return Object.freeze({ ...verified, status: 'CREATED' });
  } finally {
    releaseIntakeLock();
  }
}

function ingestContractSetAndGenerate(options) {
  const result = ingestContractSet(options);
  if (result.generateMigrations) {
    execFileSync(process.execPath, [path.join(options.projectRoot ?? defaultProjectRoot(), 'packages/database/scripts/generate-migrations.mjs')], {
      cwd: options.projectRoot ?? defaultProjectRoot(),
      stdio: 'inherit',
    });
  }
  if (result.generateContracts) {
    execFileSync(process.execPath, [path.join(options.projectRoot ?? defaultProjectRoot(), 'packages/contracts/scripts/generate-contracts.mjs')], {
      cwd: options.projectRoot ?? defaultProjectRoot(), stdio: 'inherit',
    });
  }
  return result;
}

function defaultProjectRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function parseCliArguments(argv) {
  const command = argv[0] ?? 'verify';
  if (command !== 'ingest' && command !== 'verify' && command !== 'reconstruct') {
    throw new Error(`Unknown contract-set command: ${command}`);
  }
  const options = {};
  for (const argument of argv.slice(1)) {
    if (argument === '--') {
      continue;
    }
    const match = argument.match(/^--(source|source-repository-root|project-root|id)=(.+)$/);
    if (!match) {
      throw new Error(`Unknown contract-set option: ${argument}`);
    }
    options[match[1]] = match[2];
  }
  if (command === 'reconstruct' && (options.id || options['project-root'])) {
    throw new Error('Task graph reconstruction accepts only source and source-repository-root');
  }
  return { command, options };
}

function runCli() {
  const { command, options } = parseCliArguments(process.argv.slice(2));
  const result = command === 'reconstruct'
    ? reconstructTaskGraphCandidate({ sourceDirectory: options.source, sourceRepositoryRoot: options['source-repository-root'] })
    : command === 'ingest' ? ingestContractSetAndGenerate({
        projectRoot: options['project-root'],
        sourceDirectory: options.source,
        sourceRepositoryRoot: options['source-repository-root'],
      })
    : verifyIngestedContractSet({
        projectRoot: options['project-root'],
        expectedContractSetId: options.id,
      });
  console.log(JSON.stringify(result, null, 2));
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  try {
    runCli();
  } catch (error) {
    console.error(
      `CONTRACT_SET_INTAKE_FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
