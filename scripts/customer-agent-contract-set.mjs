import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
import { renderReadinessMigration, renderRepairMigration, renderSopUnifiedMigration, renderSopLifecycleMigration, SOP_LIFECYCLE_SOURCE, renderSopQueryMigration, SOP_QUERY_SOURCE, renderSopContinuationMigration, SOP_CONTINUATION_SOURCE, renderSopResourceMigration, SOP_RESOURCE_SOURCE } from '../packages/database/scripts/migration-artifact.mjs';
import { isDeepStrictEqual } from 'node:util';
import { createSopUnifiedProfile, SOP_UNIFIED_SCHEMA, SOP_UNIFIED_LOCK, SOP_UNIFIED_CONSUMPTION_SCHEMA } from './sop-unified-contract.mjs';
import { createSopResourceDisableProfile, SOP_RESOURCE_SCHEMA, SOP_RESOURCE_LOCK, SOP_RESOURCE_CONSUMPTION_SCHEMA } from './sop-resource-disable-contract.mjs';
import { createCorrectedSopUnifiedProfile, SOP_CORRECTED_SCHEMA, SOP_CORRECTED_LOCK, SOP_CORRECTED_CONSUMPTION_SCHEMA } from './sop-unified-corrected-contract.mjs';

const EXPECTED_PACKAGE_NAME = 'customer-agent-demo';
const CONTRACT_SET_SCHEMA = 'customer-agent-contract-set/v1';
const RUNTIME_CONTRACT_SET_SCHEMA = 'customer-agent-contract-set/v2';
const CSV_CONTRACT_SET_SCHEMA = 'customer-agent-contract-set/v3';
const LEGACY_CHECK_CONTRACT_SET_SCHEMA = 'customer-agent-contract-set/v4';
const SOP_CONTRACT_SET_SCHEMA = 'customer-agent-contract-set/v5';
const REPAIR_CONTRACT_SET_SCHEMA = 'customer-agent-contract-set/v6';
const SOP_QUERY_CONTRACT_SET_SCHEMA = 'customer-agent-contract-set/v8';
const SOP_QUERY_LOCK = 'sop-query-contract-set.lock.json';
const SOP_QUERY_CONSUMPTION_SCHEMA = 'customer-agent-sop-query-contract-consumption/v1';
const SOP_QUERY_PREDECESSOR_SOURCE_SHA = '75e1889efee91322dab1dfa28aadc53fd718682b';
const SOP_QUERY_PREDECESSOR_ID = 'cs-ai-c11-openapi-1.24.0-schema-1.29-75e1889efee9';
const SOP_QUERY_APPROVAL_DATE = '2026-11-08';
const SOP_QUERY_APPROVAL_EVIDENCE = 'EVD-SOP-QUERY-EXPORT-20261108';
const SOP_QUERY_DESIGN_INPUTS = Object.freeze({
  '2026-10-23-upstream-intake-sop-media.md': '1383a79b6ff8754f9d27f8e413547bb6708737e479232e11dd55793372d52de5',
  '2026-10-29-sop-contract.proposal.schema.yaml': '86449c1f8029709117436e74c734b84e038375ab657b1c4411cdfc4f2742dec2',
});
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
const OPENAPI_SOURCE_PATH = 'business-docs/01-客服Agent项目/20-设计-进行中/openapi.v1.yaml';
const DATABASE_SOURCE_PATH = 'business-docs/01-客服Agent项目/20-设计-进行中/33-schema-v1-草案.sql';
const OWNER_SOURCE_ROOT = 'business-docs/01-客服Agent项目/30-开发-进行中';
const SOP_QUERY_MEMBERS = Object.freeze({
  storage: ['content-intake-sop-query-v1/storage.v1.sql', 'storage.v1.sql'],
  installation: ['content-intake-sop-query-v1/installation.v1.json', 'installation.v1.json'],
  provenance: ['content-intake-sop-query-v1/provenance.v1.json', 'provenance.v1.json'],
  predecessor: ['content-intake-sop-query-v1/predecessor-lock.v1.json', 'predecessor-lock.v1.json'],
  shapes: ['content-intake-sop-query-v1/shapes.v1.json', 'shapes.v1.json'],
  rules: ['content-intake-sop-query-v1/rules.v1.json', 'rules.v1.json'],
  approval: ['content-intake-sop-query-v1/approval.v1.json', 'approval.v1.json'],
});
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
const sopUnified = createSopUnifiedProfile({ assertExactKeys, validateDescriptor, readJson, sha256Bytes, runGit });
const sopCorrected = createCorrectedSopUnifiedProfile({ assertExactKeys, validateDescriptor, readJson, sha256Bytes, runGit });
const sopResourceDisable = createSopResourceDisableProfile({ assertExactKeys, validateDescriptor, readJson, sha256Bytes, runGit });
const SOP_QUERY_PROFILES = new Map([
  [SOP_RESOURCE_SCHEMA, { name: 'sopResourceDisable', lock: SOP_RESOURCE_LOCK, schema: SOP_RESOURCE_CONSUMPTION_SCHEMA, verifyPredecessor: verifySopResourcePredecessor }],
  [SOP_QUERY_CONTRACT_SET_SCHEMA, { name: 'sopGraph', lock: SOP_QUERY_LOCK, schema: SOP_QUERY_CONSUMPTION_SCHEMA, verifyPredecessor: verifySopQueryPredecessor }],
  [SOP_UNIFIED_SCHEMA, { name: 'sopUnified', lock: SOP_UNIFIED_LOCK, schema: SOP_UNIFIED_CONSUMPTION_SCHEMA, verifyPredecessor: verifySopUnifiedPredecessor }],
  [SOP_CORRECTED_SCHEMA, { name: 'sopUnifiedCorrected', lock: SOP_CORRECTED_LOCK, schema: SOP_CORRECTED_CONSUMPTION_SCHEMA, verifyPredecessor: verifyCorrectedSopPredecessor }],
]);

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
  if (rawManifest?.schema === SOP_RESOURCE_SCHEMA) return sopResourceDisable.validateManifest(rawManifest);
  if (rawManifest?.schema === SOP_CORRECTED_SCHEMA) return sopCorrected.validateManifest(rawManifest);
  if (rawManifest?.schema === SOP_UNIFIED_SCHEMA) return sopUnified.validateManifest(rawManifest);
  const readinessProfile = rawManifest?.schema === READINESS_SCHEMA;
  const repairProfile = rawManifest?.schema === REPAIR_CONTRACT_SET_SCHEMA;
  const sopProfile = rawManifest?.schema === SOP_CONTRACT_SET_SCHEMA;
  const sopQueryProfile = rawManifest?.schema === SOP_QUERY_CONTRACT_SET_SCHEMA;
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
      ...(sopQueryProfile ? ['sopGraph'] : []),
    ],
    'contract-set manifest',
  );
  if (rawManifest.schema !== CONTRACT_SET_SCHEMA && !runtimeProfile && !sopProfile && !sopQueryProfile && !repairProfile && !readinessProfile) {
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
  const repairPair = openapi.version === '1.24.0' && database.version === 'schema.v1.28';
  const sopPair = openapi.version === '1.23.0' && database.version === 'schema.v1.26';
  const sopQueryPair = openapi.version === '1.25.0' && database.version === 'schema.v1.30';
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
  if (readinessPair !== readinessProfile || repairPair !== repairProfile || sopPair !== sopProfile || sopQueryPair !== sopQueryProfile || legacyCheckPair !== legacyCheckProfile || (csvPair || legacyCheckPair) !== csvProfile || (runtimePair || csvPair || legacyCheckPair) !== runtimeProfile || (!readinessPair && !repairPair && !sopPair && !sopQueryPair && !legacyCheckPair && !csvPair && !runtimePair && !directPair && !managementPair && !qualityPair && !usagePair && !intakePair && !opsLoopPair && !backendPair && !ownerPair && !legacyPair)) throw new Error('Unsupported contract version pair');
  let openapiPath = OPENAPI_SOURCE_PATH;
  let databasePath = DATABASE_SOURCE_PATH;
  if (readinessPair) {
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
  } else if (sopQueryPair) {
    openapiPath = `${OWNER_SOURCE_ROOT}/content-intake-sop-query-v1/openapi.v1.yaml`;
    databasePath = `${OWNER_SOURCE_ROOT}/content-intake-sop-query-v1/schema-v1.30.sql`;
    assertExactKeys(rawManifest.sopGraph, Object.keys(SOP_QUERY_MEMBERS), 'SOP query artifacts');
    for (const [key, [sourcePath, file]] of Object.entries(SOP_QUERY_MEMBERS)) {
      const descriptor = validateDescriptor(rawManifest.sopGraph[key], `sopGraph.${key}`);
      if (descriptor.version !== '1' || descriptor.source_path !== `${OWNER_SOURCE_ROOT}/${sourcePath}` || descriptor.file !== file) {
        throw new Error(`sopGraph.${key} descriptor does not match the SOP query profile`);
      }
    }
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
    ...Object.entries(manifest.sopGraph ?? {}).map(([key, descriptor]) => [`sopGraph.${key}`, descriptor]),
    ...Object.entries(manifest.resourceDisable ?? {}).map(([key, descriptor]) => [`resourceDisable.${key}`, descriptor]),
    ...Object.entries(manifest.legacyV11?.members ?? {}).map(([key, descriptor]) => [`legacyV11.${key}`, descriptor]),
    ...Object.entries(manifest.sopUnified ?? {}).map(([key, descriptor]) => [`sopUnified.${key}`, descriptor]),
    ...Object.entries(manifest.readiness ?? {}).map(([key, descriptor]) => [`readiness.${key}`, descriptor])];
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

function verifySopQueryApproval(approval) {
  assertExactKeys(approval, [
    'schema', 'status', 'decisionDate', 'evidenceId', 'scope', 'designInputs',
    'gitCommitApproved', 'pushApproved', 'deploymentApproved', 'runtimeActivated',
    'businessMappingApproved', 'freezeCompleted', 'exportCompleted',
  ], 'SOP query approval');
  if (approval.schema !== 'customer-agent-sop-graph-implementation-approval/v1'
    || approval.status !== 'APPROVED'
    || approval.decisionDate !== SOP_QUERY_APPROVAL_DATE
    || approval.evidenceId !== SOP_QUERY_APPROVAL_EVIDENCE
    || typeof approval.evidenceId !== 'string' || approval.evidenceId.length === 0
    || !Array.isArray(approval.scope)
    || !isDeepStrictEqual([...approval.scope].sort(), ['formal-contract-change', 'product-implementation'])
    || approval.gitCommitApproved !== true
    || approval.pushApproved !== false
    || approval.deploymentApproved !== false
    || approval.runtimeActivated !== false
    || approval.businessMappingApproved !== false
    || approval.freezeCompleted !== true
    || approval.exportCompleted !== true) {
    throw new Error('SOP query approval boundary is invalid');
  }
  assertExactKeys(approval.designInputs, [
    '2026-10-23-upstream-intake-sop-media.md',
    '2026-10-29-sop-contract.proposal.schema.yaml',
  ], 'SOP query approval design inputs');
  if (!isDeepStrictEqual(approval.designInputs, SOP_QUERY_DESIGN_INPUTS)) {
    throw new Error('SOP query approval design inputs mismatch');
  }
}

function verifySopQueryReferences(directory, manifest) {
  if (manifest.schema !== SOP_QUERY_CONTRACT_SET_SCHEMA) return;
  const read = key => readJson(path.join(directory, manifest.sopGraph[key].file), `SOP query ${key}`);
  const installation = read('installation');
  assertExactKeys(installation, [
    'schema', 'status', 'versions', 'runnableMigration', 'migrationPosition',
    'predecessor', 'requiredProductWork', 'runtimeActivated', 'productionConsumerReady',
    'queryTransport',
  ], 'SOP query installation');
  if (installation.schema !== 'customer-agent-sop-graph-installation/v1'
    || installation.status !== 'CANDIDATE'
    || !isDeepStrictEqual(installation.versions, { openapi: '1.25.0', database: 'schema.v1.30', profile: 'content-intake-sop-query-v1' })
    || installation.runnableMigration !== false
    || installation.migrationPosition !== null
    || installation.runtimeActivated !== false
    || installation.productionConsumerReady !== false
    || !Array.isArray(installation.requiredProductWork)
    || installation.requiredProductWork.length === 0
    || installation.requiredProductWork.some(item => typeof item !== 'string' || item.length === 0)
    || !isRecord(installation.queryTransport)
    || installation.queryTransport.businessAlias !== 'menokin-sop-query-v1'
    || installation.queryTransport.route !== '/v1/sop/query'
    || !isDeepStrictEqual(installation.queryTransport.statuses, ['ready', 'blocked', 'stale', 'no_match'])
    || installation.queryTransport.legacySearchSopBehavior !== '503-fail-closed'
    || installation.queryTransport.runtimeActivated !== false) {
    throw new Error('SOP query installation boundary is invalid');
  }
  assertExactKeys(installation.predecessor, ['sourceGitSha', 'contractSetId', 'artifacts'], 'SOP query installation predecessor');
  assertExactKeys(installation.queryTransport, [
    'businessAlias', 'route', 'statuses', 'legacySearchSopBehavior', 'runtimeActivated',
  ], 'SOP query queryTransport');

  const provenance = read('provenance');
  assertExactKeys(provenance, [
    'schema', 'status', 'proposedVersions', 'formalVersionAssigned', 'sourceGitSha',
    'predecessorGitSha', 'designApproved', 'productImplementationApproved',
    'freezeCompleted', 'exportCompleted', 'runtimeActivated', 'businessMappingApproved',
    'businessAlias', 'graphCandidateManifestSha256', 'querySources', 'artifacts',
    'exportBlockers',
  ], 'SOP query provenance');
  if (provenance.schema !== 'customer-agent-sop-query-contract-candidate/v1'
    || provenance.status !== 'EXPORTED_CANDIDATE'
    || !isDeepStrictEqual(provenance.proposedVersions, { openapi: '1.25.0', database: 'schema.v1.30', profile: 'content-intake-sop-query-v1' })
    || provenance.formalVersionAssigned !== true
    || provenance.sourceGitSha !== null
    || provenance.predecessorGitSha !== SOP_QUERY_PREDECESSOR_SOURCE_SHA
    || provenance.designApproved !== true
    || provenance.productImplementationApproved !== true
    || provenance.freezeCompleted !== true
    || provenance.exportCompleted !== true
    || provenance.runtimeActivated !== false
    || provenance.businessMappingApproved !== false
    || provenance.businessAlias !== 'menokin-sop-query-v1') {
    throw new Error('SOP query provenance boundary is invalid');
  }
  requireString(provenance.graphCandidateManifestSha256, HASH_PATTERN, 'SOP query graph candidate manifest hash');
  assertExactKeys(provenance.querySources, ['openapi', 'storage'], 'SOP query provenance sources');
  if (provenance.querySources.openapi !== 'business-docs/01-客服Agent项目/30-开发-进行中/sop-query-candidate/openapi.fragment.json'
    || provenance.querySources.storage !== 'business-docs/01-客服Agent项目/30-开发-进行中/sop-query-candidate/storage.fragment.sql'
    || !Array.isArray(provenance.exportBlockers)
    || provenance.exportBlockers.length !== 2
    || provenance.exportBlockers.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new Error('SOP query provenance source or blocker boundary is invalid');
  }
  assertExactKeys(provenance.artifacts, ['openapi.candidate.yaml', 'schema.candidate.sql', 'storage.candidate.sql'], 'SOP query provenance artifacts');
  const provenanceArtifacts = {
    'openapi.candidate.yaml': manifest.openapi,
    'schema.candidate.sql': manifest.database,
    'storage.candidate.sql': manifest.sopGraph.storage,
  };
  for (const [key, descriptor] of Object.entries(provenanceArtifacts)) {
    assertExactKeys(provenance.artifacts[key], ['sha256', 'bytes'], `SOP query provenance ${key}`);
    if (provenance.artifacts[key].sha256 !== descriptor.sha256 || provenance.artifacts[key].bytes !== descriptor.bytes) {
      throw new Error(`SOP query provenance artifact mismatch: ${key}`);
    }
  }

  const predecessor = read('predecessor');
  assertExactKeys(predecessor, ['sourceGitSha', 'contractSetId', 'artifacts'], 'SOP query predecessor');
  requireString(predecessor.sourceGitSha, GIT_SHA_PATTERN, 'SOP query predecessor sourceGitSha');
  requireString(predecessor.contractSetId, CONTRACT_SET_ID_PATTERN, 'SOP query predecessor contractSetId');
  assertExactKeys(predecessor.artifacts, ['openapi.v1.yaml', 'schema-v1.29.sql'], 'SOP query predecessor artifacts');
  for (const [key, artifact] of Object.entries(predecessor.artifacts)) {
    assertExactKeys(artifact, ['path', 'sha256'], `SOP query predecessor ${key}`);
    requireString(artifact.sha256, HASH_PATTERN, `SOP query predecessor ${key}.sha256`);
  }

  verifySopQueryApproval(read('approval'));
  const openapi = readFileSync(path.join(directory, manifest.openapi.file), 'utf8');
  const storage = readFileSync(path.join(directory, manifest.sopGraph.storage.file), 'utf8');
  if (!openapi.includes('/v1/sop/query') || !openapi.includes('/v1/search') || !openapi.includes('503 fail-closed')) {
    throw new Error('SOP query OpenAPI transport boundary is invalid');
  }
  if (!storage.includes('sop_query_leases')) throw new Error('SOP query lease storage is missing');
}

function verifySopQueryPredecessor(projectRoot, directory, manifest) {
  const predecessor = readJson(
    path.join(directory, manifest.sopGraph.predecessor.file),
    'SOP query predecessor',
  );
  const readinessLockPath = path.join(projectRoot, UPSTREAM_ROOT, READINESS_LOCK);
  assertPathInsideRoot(projectRoot, readinessLockPath);
  assertRegularFile(readinessLockPath, 'Readiness predecessor lock');
  const readinessLock = validateConsumptionLock(readJson(readinessLockPath, 'Readiness predecessor lock'));
  const readinessDirectory = path.join(projectRoot, UPSTREAM_ROOT, readinessLock.contract_set_id);
  assertPathInsideRoot(projectRoot, readinessDirectory);
  const readiness = verifyContractSetDirectory(readinessDirectory);
  if (readiness.manifest.schema !== READINESS_SCHEMA) {
    throw new Error('SOP query predecessor requires a v7 readiness bundle');
  }
  assertLockMatchesContractSet(readinessLock, readiness);
  if (predecessor.sourceGitSha !== SOP_QUERY_PREDECESSOR_SOURCE_SHA
    || predecessor.contractSetId !== SOP_QUERY_PREDECESSOR_ID
    || predecessor.sourceGitSha !== readiness.manifest.source_git_sha
    || predecessor.contractSetId !== readiness.manifest.contract_set_id
    || predecessor.artifacts['openapi.v1.yaml'].sha256 !== readiness.manifest.openapi.sha256
    || predecessor.artifacts['schema-v1.29.sql'].sha256 !== readiness.manifest.database.sha256
    || predecessor.artifacts['openapi.v1.yaml'].path !== readiness.manifest.openapi.source_path
    || predecessor.artifacts['schema-v1.29.sql'].path !== readiness.manifest.database.source_path) {
    throw new Error('SOP query predecessor does not match the verified v7 readiness bundle');
  }
  const installation = readJson(path.join(directory, manifest.sopGraph.installation.file), 'SOP query installation');
  if (!isDeepStrictEqual(installation.predecessor, predecessor)) {
    throw new Error('SOP query installation predecessor does not match predecessor lock');
  }
}

function verifySopUnifiedPredecessor(projectRoot) {
  const lockPath = path.join(projectRoot, UPSTREAM_ROOT, SOP_QUERY_LOCK);
  assertPathInsideRoot(projectRoot, lockPath);
  assertRegularFile(lockPath, 'SOP unified predecessor lock');
  const lock = validateSopQueryConsumptionLock(readJson(lockPath, 'SOP unified predecessor lock'));
  const directory = path.join(projectRoot, UPSTREAM_ROOT, lock.contract_set_id);
  assertPathInsideRoot(projectRoot, directory);
  const predecessor = verifyContractSetDirectory(directory);
  assertSopQueryLockMatchesContractSet(lock, predecessor);
  sopUnified.verifyPredecessor(predecessor.manifest);
  verifySopQueryPredecessor(projectRoot, directory, predecessor.manifest);
}

function verifySopResourcePredecessor(projectRoot, directory, manifest) {
  const previous = verifyIngestedCorrectedSopUnifiedContractSet({ projectRoot });
  sopResourceDisable.verifyPredecessor(directory, manifest, previous.path);
}

function verifyCorrectedSopPredecessor(projectRoot, directory, manifest) {
  const previous = verifyIngestedSopUnifiedContractSet({ projectRoot });
  const verified = verifyContractSetDirectory(previous.path);
  sopCorrected.verifyPredecessor(verified.manifest);
  sopCorrected.verifyReconstruction(directory, manifest, previous.path);
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
  verifySopQueryReferences(resolvedDirectory, manifest);
  if (manifest.schema === SOP_UNIFIED_SCHEMA) sopUnified.verifyReferences(resolvedDirectory, manifest);
  if (manifest.schema === SOP_RESOURCE_SCHEMA) sopResourceDisable.verifyReferences(resolvedDirectory, manifest);
  if (manifest.schema === SOP_CORRECTED_SCHEMA) sopCorrected.verifyReferences(resolvedDirectory, manifest);
  if (manifest.readiness) verifyReadinessReferences(resolvedDirectory, manifest);
  if (manifest.repair) verifyRepairReferences(resolvedDirectory, manifest);
  return Object.freeze({ directory: resolvedDirectory, manifest });
}

function runGit(repositoryRoot, arguments_, encoding = 'buffer') {
  try {
    return execFileSync('git', ['-C', repositoryRoot, ...arguments_], {
      encoding: encoding === 'utf8' ? 'utf8' : null,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
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
  if (manifest.schema === SOP_RESOURCE_SCHEMA) {
    sopResourceDisable.verifySource(repositoryRoot, manifest);
    return;
  }
  if (manifest.schema === SOP_CORRECTED_SCHEMA) {
    sopCorrected.verifySource(repositoryRoot, manifest);
    return;
  }
  if (manifest.schema === SOP_UNIFIED_SCHEMA) {
    sopUnified.verifySource(repositoryRoot, manifest);
    return;
  }
  if (manifest.schema === READINESS_SCHEMA) return; // Full references and approval are verified against this exact Git SHA.
  if (manifest.schema === SOP_QUERY_CONTRACT_SET_SCHEMA) {
    verifySopQueryApproval(JSON.parse(source(manifest.sopGraph.approval.source_path)));
    return;
  }
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
  const gitTopLevel = String(
    runGit(resolvedRepositoryRoot, ['rev-parse', '--show-toplevel'], 'utf8'),
  ).trim();
  if (realpathSync(gitTopLevel) !== resolvedRepositoryRoot) {
    throw new Error('Source repository root must be the Git top-level directory');
  }
  // A shallow boundary can hide a versioned approval that was later deleted.
  // Negative history assertions are only valid against a complete source graph.
  if (String(runGit(resolvedRepositoryRoot, ['rev-parse', '--is-shallow-repository'], 'utf8')).trim() !== 'false') {
    throw new Error('Source repository must have complete Git history; shallow clones are not accepted');
  }
  runGit(resolvedRepositoryRoot, ['cat-file', '-e', `${manifest.source_git_sha}^{commit}`]);

  for (const [label, descriptor] of contractDescriptors(manifest)) {
    const sourceTreeEntry = String(runGit(
      resolvedRepositoryRoot,
      ['ls-tree', manifest.source_git_sha, '--', descriptor.source_path],
      'utf8',
    )).trim();
    if (!/^100(?:644|755) blob [0-9a-f]{40}\t/.test(sourceTreeEntry)) {
      throw new Error(`${label} source Git object is not a regular blob`);
    }
    const committedBytes = runGit(
      resolvedRepositoryRoot,
      ['show', `${manifest.source_git_sha}:${descriptor.source_path}`],
    );
    if (
      committedBytes.length !== descriptor.bytes
      || sha256Bytes(committedBytes) !== descriptor.sha256
    ) {
      throw new Error(`${label} contract does not match the declared source Git commit`);
    }
  }
  verifySourceApproval(resolvedRepositoryRoot, manifest);
  return resolvedRepositoryRoot;
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
    if (lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) {
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

function verifySopUnifiedMigrationTail(projectRoot, actual) {
  if (actual.migrations.length === 88 && !actual.compatibility?.sop_resource_overlay
    || actual.compatibility?.sop_resource_overlay && actual.migrations.length !== 88) {
    throw new Error('SOP resource lifecycle requires its exact 88-migration tail');
  }
  if (actual.compatibility?.sop_continuation_overlay && ![87, 88].includes(actual.migrations.length)) {
    throw new Error('SOP continuation implementation requires its exact 87-migration tail');
  }
  if (actual.compatibility?.sop_query_overlay && ![86, 87, 88].includes(actual.migrations.length)) {
    throw new Error('SOP query implementation requires its exact 86-migration tail');
  }
  if (actual.compatibility?.sop_lifecycle_overlay && ![85, 86, 87, 88].includes(actual.migrations.length)) {
    throw new Error('SOP lifecycle implementation requires its exact 85-migration tail');
  }
  const lockPath = path.join(projectRoot, UPSTREAM_ROOT, SOP_CORRECTED_LOCK);
  assertPathInsideRoot(projectRoot, lockPath);
  assertRegularFile(lockPath, 'SOP corrected unified lock');
  const profile = SOP_QUERY_PROFILES.get(SOP_CORRECTED_SCHEMA);
  const lock = validateSopQueryConsumptionLock(readJson(lockPath, 'SOP corrected unified lock'), profile);
  const directory = path.join(projectRoot, UPSTREAM_ROOT, lock.contract_set_id);
  assertPathInsideRoot(projectRoot, directory);
  // The high-level unified verifier re-enters predecessor verification.
  const verified = verifyContractSetDirectory(directory);
  if (verified.manifest.schema !== SOP_CORRECTED_SCHEMA) throw new Error('SOP corrected unified lock requires a v11 bundle');
  assertSopQueryLockMatchesContractSet(lock, verified);
  const manifest = verified.manifest;
  const migrationRoot = path.join(projectRoot, 'packages/database/migrations');
  const prefix = actual.migrations.slice(0, 83);
  if (sha256Bytes(Buffer.from(JSON.stringify(prefix))) !== '21bbce897e23f9f3e5fcdc8a0d52d1dadd42af7f22433b425f1c7c7eed676fae') {
    throw new Error('SOP unified requires the immutable 83-migration predecessor');
  }
  for (const migration of prefix) {
    const file = path.join(migrationRoot, migration.file);
    assertPathInsideRoot(projectRoot, file);
    assertRegularFile(file, 'SOP unified predecessor migration');
    if (sha256(file) !== migration.sha256 || lstatSync(file).size !== migration.bytes) {
      throw new Error(`SOP unified predecessor bytes drift: ${migration.file}`);
    }
  }
  const { sql, ...expected } = renderSopUnifiedMigration({ manifest,
    storage_source: readFileSync(path.join(directory, manifest.sopUnified.storage.file), 'utf8') });
  if (!isDeepStrictEqual(actual.migrations[83], expected)) throw new Error('SOP unified migration metadata drift');
  if (!isDeepStrictEqual(actual.compatibility?.sop_unified_successor, {
    contract_set_id: manifest.contract_set_id, source_git_sha: manifest.source_git_sha,
    source_schema_sha256: manifest.database.sha256, storage_sha256: manifest.sopUnified.storage.sha256,
    migration_sha256: expected.sha256,
  })) throw new Error('SOP unified successor metadata drift');
  const file = path.join(migrationRoot, expected.file);
  assertPathInsideRoot(projectRoot, file);
  assertRegularFile(file, 'SOP unified migration');
  if (readFileSync(file, 'utf8') !== sql) throw new Error('SOP unified migration bytes drift');
  if (actual.migrations.length >= 85) {
    const sourcePath = path.join(projectRoot, SOP_LIFECYCLE_SOURCE.file);
    assertPathInsideRoot(projectRoot, sourcePath);
    assertRegularFile(sourcePath, 'SOP lifecycle implementation source');
    const { sql: lifecycleSql, ...lifecycle } = renderSopLifecycleMigration({ manifest }, readFileSync(sourcePath, 'utf8'));
    if (!isDeepStrictEqual(actual.migrations[84], lifecycle)
      || !isDeepStrictEqual(actual.compatibility?.sop_lifecycle_overlay, {
        contract_set_id: manifest.contract_set_id, source_git_sha: manifest.source_git_sha,
        source_schema_sha256: manifest.database.sha256, source_sha256: SOP_LIFECYCLE_SOURCE.sha256, migration_sha256: lifecycle.sha256,
      })) throw new Error('SOP lifecycle implementation metadata drift');
    const lifecyclePath = path.join(migrationRoot, lifecycle.file);
    assertPathInsideRoot(projectRoot, lifecyclePath);
    assertRegularFile(lifecyclePath, 'SOP lifecycle implementation migration');
    if (readFileSync(lifecyclePath, 'utf8') !== lifecycleSql) throw new Error('SOP lifecycle implementation bytes drift');
  }

  if (actual.migrations.length >= 86) {
    const sourcePath = path.join(projectRoot, SOP_QUERY_SOURCE.file);
    assertPathInsideRoot(projectRoot, sourcePath);
    assertRegularFile(sourcePath, 'SOP query implementation source');
    const { sql: querySql, ...query } = renderSopQueryMigration({ manifest }, readFileSync(sourcePath, 'utf8'));
    if (!isDeepStrictEqual(actual.migrations[85], query)
      || !isDeepStrictEqual(actual.compatibility?.sop_query_overlay, {
        contract_set_id: manifest.contract_set_id, source_git_sha: manifest.source_git_sha,
        source_schema_sha256: manifest.database.sha256, source_sha256: SOP_QUERY_SOURCE.sha256, migration_sha256: query.sha256,
      })) throw new Error('SOP query implementation metadata drift');
    const queryPath = path.join(migrationRoot, query.file);
    assertPathInsideRoot(projectRoot, queryPath);
    assertRegularFile(queryPath, 'SOP query implementation migration');
    if (readFileSync(queryPath, 'utf8') !== querySql) throw new Error('SOP query implementation migration bytes drift');
  }

  if (actual.migrations.length >= 87) {
    if (sha256Bytes(Buffer.from(JSON.stringify(actual.migrations.slice(0, 86)))) !== '1e1e9619dbcb88214c006c0fb429639a0b10abab9c10003624877d582f643ddd') {
      throw new Error('SOP continuation requires the immutable 86-migration predecessor');
    }
    const sourcePath = path.join(projectRoot, SOP_CONTINUATION_SOURCE.file);
    assertPathInsideRoot(projectRoot, sourcePath);
    assertRegularFile(sourcePath, 'SOP continuation implementation source');
    const { sql: continuationSql, ...continuation } = renderSopContinuationMigration({ manifest }, readFileSync(sourcePath, 'utf8'));
    if (!isDeepStrictEqual(actual.migrations[86], continuation)
      || !isDeepStrictEqual(actual.compatibility?.sop_continuation_overlay, {
        contract_set_id: manifest.contract_set_id, source_git_sha: manifest.source_git_sha,
        source_schema_sha256: manifest.database.sha256, source_sha256: SOP_CONTINUATION_SOURCE.sha256, migration_sha256: continuation.sha256,
      })) throw new Error('SOP continuation implementation metadata drift');
    const continuationPath = path.join(migrationRoot, continuation.file);
    assertPathInsideRoot(projectRoot, continuationPath);
    assertRegularFile(continuationPath, 'SOP continuation implementation migration');
    if (readFileSync(continuationPath, 'utf8') !== continuationSql) throw new Error('SOP continuation implementation migration bytes drift');
  }

  if (actual.migrations.length === 88) {
    if (sha256Bytes(Buffer.from(JSON.stringify(actual.migrations.slice(0, 87)))) !== '3d48f9989552918848421d2e2650d8da0bea80515cc728cdb790afcae4a1e8ae') {
      throw new Error('SOP resource lifecycle requires the immutable 87-migration predecessor');
    }
    const resourceLockPath = path.join(projectRoot, UPSTREAM_ROOT, SOP_RESOURCE_LOCK);
    assertPathInsideRoot(projectRoot, resourceLockPath);
    assertRegularFile(resourceLockPath, 'SOP resource contract lock');
    const resourceProfile = SOP_QUERY_PROFILES.get(SOP_RESOURCE_SCHEMA);
    const resourceLock = validateSopQueryConsumptionLock(readJson(resourceLockPath, 'SOP resource contract lock'), resourceProfile);
    const resourceDirectory = path.join(projectRoot, UPSTREAM_ROOT, resourceLock.contract_set_id);
    assertPathInsideRoot(projectRoot, resourceDirectory);
    const resourceSet = verifyContractSetDirectory(resourceDirectory);
    assertSopQueryLockMatchesContractSet(resourceLock, resourceSet);
    const sourcePath = path.join(projectRoot, SOP_RESOURCE_SOURCE.file);
    assertPathInsideRoot(projectRoot, sourcePath);
    assertRegularFile(sourcePath, 'SOP resource lifecycle implementation source');
    const { sql: resourceSql, ...resource } = renderSopResourceMigration({ manifest: resourceSet.manifest,
      storage_source: readFileSync(path.join(resourceDirectory, resourceSet.manifest.resourceDisable.storage.file), 'utf8') },
    readFileSync(sourcePath, 'utf8'));
    if (!isDeepStrictEqual(actual.migrations[87], resource)
      || !isDeepStrictEqual(actual.compatibility?.sop_resource_overlay, {
        contract_set_id: resource.contract_set_id, source_git_sha: resource.source_git_sha,
        source_schema_sha256: resource.source_schema_sha256, source_sha256: SOP_RESOURCE_SOURCE.sha256, migration_sha256: resource.sha256,
      })) throw new Error('SOP resource lifecycle implementation metadata drift');
    const resourcePath = path.join(migrationRoot, resource.file);
    assertPathInsideRoot(projectRoot, resourcePath);
    assertRegularFile(resourcePath, 'SOP resource lifecycle implementation migration');
    if (readFileSync(resourcePath, 'utf8') !== resourceSql) throw new Error('SOP resource lifecycle implementation migration bytes drift');
  }

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
  if (![39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88].includes(actual.migrations?.length)) throw new Error('Repair requires 39 predecessor migrations');
  if (actual.migrations.length >= 84) verifySopUnifiedMigrationTail(projectRoot, actual);
  if (actual.migrations.length >= 83 && actual.migrations[82]?.id !== '0083_sop_pipeline_projection') throw new Error('Unrecognized SOP pipeline projection');
  if (actual.migrations.length >= 82 && actual.migrations[81]?.id !== '0082_access_evaluator') throw new Error('Unrecognized ACL access evaluator');
  if (actual.migrations.length >= 81 && actual.migrations[80]?.id !== '0081_require_import_batch_principal') throw new Error('Unrecognized required import tenant binding');
  if (actual.migrations.length >= 80 && actual.migrations[79]?.id !== '0080_bind_import_batch_tenant') throw new Error('Unrecognized import tenant projection');
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
  if (![40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88].includes(actual.migrations?.length)) throw new Error('Readiness requires 40 predecessor migrations');
  if (actual.migrations.length >= 84) verifySopUnifiedMigrationTail(projectRoot, actual);
  if (actual.migrations.length >= 83 && actual.migrations[82]?.id !== '0083_sop_pipeline_projection') throw new Error('Unrecognized SOP pipeline projection');
  if (actual.migrations.length >= 82 && actual.migrations[81]?.id !== '0082_access_evaluator') throw new Error('Unrecognized ACL access evaluator');
  if (actual.migrations.length >= 81 && actual.migrations[80]?.id !== '0081_require_import_batch_principal') throw new Error('Unrecognized required import tenant binding');
  if (actual.migrations.length >= 80 && actual.migrations[79]?.id !== '0080_bind_import_batch_tenant') throw new Error('Unrecognized import tenant projection');
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

function sopQueryConsumptionLock(verifiedContractSet) {
  const base = consumptionLock(verifiedContractSet);
  const profile = SOP_QUERY_PROFILES.get(verifiedContractSet.manifest.schema);
  return {
    ...base,
    schema: profile.schema,
    profile: profile.name,
  };
}

function validateSopQueryConsumptionLock(rawLock, profile = SOP_QUERY_PROFILES.get(SOP_QUERY_CONTRACT_SET_SCHEMA)) {
  assertExactKeys(rawLock, [
    'schema', 'profile', 'contract_set_id', 'source_repository', 'source_git_sha',
    'manifest_sha256', 'openapi_sha256', 'database_sha256', 'intake_status',
    'ddev_authorized', 'runtime_activated',
  ], 'SOP query candidate lock');
  if (rawLock.schema !== profile.schema || rawLock.profile !== profile.name) {
    throw new Error('SOP query candidate lock identity is invalid');
  }
  const baseLock = Object.fromEntries(Object.entries(rawLock).filter(([key]) => key !== 'profile'));
  validateConsumptionLock({ ...baseLock, schema: CONSUMPTION_SCHEMA });
  return rawLock;
}

function assertSopQueryLockMatchesContractSet(lock, verifiedContractSet) {
  const expected = sopQueryConsumptionLock(verifiedContractSet);
  for (const [key, value] of Object.entries(expected)) {
    if (lock[key] !== value) throw new Error(`SOP query candidate lock mismatch at ${key}`);
  }
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
  if (SOP_QUERY_PROFILES.has(verified.manifest.schema)) throw new Error('SOP unified requires its independent candidate lock');
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

function verifyIngestedSopCandidate({ projectRoot, expectedContractSetId } = {}, schema) {
  const resolvedRoot = assertProjectRoot(projectRoot ?? defaultProjectRoot());
  const upstreamRoot = path.join(resolvedRoot, UPSTREAM_ROOT);
  const profile = SOP_QUERY_PROFILES.get(schema);
  const lockPath = path.join(upstreamRoot, profile.lock);
  assertPathInsideRoot(resolvedRoot, lockPath);
  assertRegularFile(lockPath, 'SOP unified candidate lock');
  const lock = validateSopQueryConsumptionLock(readJson(lockPath, 'SOP unified candidate lock'), profile);
  if (expectedContractSetId && lock.contract_set_id !== expectedContractSetId) throw new Error('Unexpected SOP unified contract set');
  const directory = path.join(upstreamRoot, lock.contract_set_id);
  assertPathInsideRoot(resolvedRoot, directory);
  const verified = verifyContractSetDirectory(directory);
  if (verified.manifest.schema !== schema) throw new Error(`SOP unified lock requires a ${schema.split('/')[1]} bundle`);
  assertSopQueryLockMatchesContractSet(lock, verified);
  profile.verifyPredecessor(resolvedRoot, directory, verified.manifest);
  return Object.freeze({ status: 'VERIFIED', ...lock, path: directory, lock_path: lockPath,
    generateMigrations: false, generateContracts: false });
}

export function verifyIngestedSopUnifiedContractSet(options) {
  return verifyIngestedSopCandidate(options, SOP_UNIFIED_SCHEMA);
}

export function verifyIngestedSopResourceDisableContractSet(options) {
  return verifyIngestedSopCandidate(options, SOP_RESOURCE_SCHEMA);
}

export function verifyIngestedCorrectedSopUnifiedContractSet(options) {
  return verifyIngestedSopCandidate(options, SOP_CORRECTED_SCHEMA);
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
  const resolvedRoot = assertProjectRoot(projectRoot ?? defaultProjectRoot());
  const upstreamRoot = path.join(resolvedRoot, UPSTREAM_ROOT);
  const destination = path.join(upstreamRoot, source.manifest.contract_set_id);
  const isReadiness = source.manifest.schema === READINESS_SCHEMA;
  const isRepair = source.manifest.schema === REPAIR_CONTRACT_SET_SCHEMA;
  const queryProfile = SOP_QUERY_PROFILES.get(source.manifest.schema);
  const isSopQuery = Boolean(queryProfile);
  const lockPath = path.join(upstreamRoot, isReadiness ? READINESS_LOCK : isRepair ? REPAIR_LOCK : isSopQuery ? queryProfile.lock : LOCK_FILE);
  assertPathInsideRoot(resolvedRoot, upstreamRoot);
  assertPathInsideRoot(resolvedRoot, destination);
  assertPathInsideRoot(resolvedRoot, lockPath);
  mkdirSync(upstreamRoot, { recursive: true });
  assertPathInsideRoot(resolvedRoot, destination);
  const releaseIntakeLock = acquireIntakeLock(resolvedRoot, upstreamRoot);

  try {
    const readinessLockPath = path.join(upstreamRoot, READINESS_LOCK);
    if (existsSync(readinessLockPath)) {
      const existing = verifyReadinessIngested(resolvedRoot, verifyRepairIngested(resolvedRoot));
      if ((!isReadiness && !isSopQuery) || (isReadiness && existing.contract_set_id !== source.manifest.contract_set_id)) {
        throw new Error('Refuse readiness lock downgrade or replacement');
      }
    }
    const repairLockPath = path.join(upstreamRoot, REPAIR_LOCK);
    if (existsSync(repairLockPath)) {
      const existingRepair = verifyRepairIngested(resolvedRoot);
      if (!isSopQuery && !isReadiness && (!isRepair || existingRepair.contract_set_id !== source.manifest.contract_set_id)) {
        throw new Error('Refuse repair lock downgrade or replacement');
      }
    }
    if (isReadiness) verifyReadinessPredecessor(resolvedRoot, source.directory, source.manifest, verifyRepairIngested(resolvedRoot));
    if (isRepair) verifyRepairPredecessor(resolvedRoot, source.directory);
    if (isSopQuery) queryProfile.verifyPredecessor(resolvedRoot, source.directory, source.manifest);
    const current = existsSync(path.join(upstreamRoot, LOCK_FILE))
      ? verifyIngestedContractSet({ projectRoot: resolvedRoot })
      : null;

    if (isSopQuery && existsSync(lockPath)) {
      assertRegularFile(lockPath, 'SOP query candidate lock');
      const lock = validateSopQueryConsumptionLock(readJson(lockPath, 'SOP query candidate lock'), queryProfile);
      assertSopQueryLockMatchesContractSet(lock, source);
      if (!existsSync(destination)) throw new Error('Refuse orphaned SOP query candidate lock without its destination');
    }
    if (isSopQuery && existsSync(destination) && !existsSync(lockPath)) {
      throw new Error('Refuse SOP query candidate destination without its lock');
    }

    if (existsSync(destination)) {
      const existing = verifyContractSetDirectory(destination);
      if (!manifestsMatch(existing.manifest, source.manifest)) {
        throw new Error('Existing contract-set manifest differs from the verified source');
      }
      if (!isSopQuery && source.manifest.schema !== SOP_CONTRACT_SET_SCHEMA && (!current || current.contract_set_id !== source.manifest.contract_set_id)) {
        writeJsonAtomically(lockPath, consumptionLock(existing));
      }
      if (isReadiness) return Object.freeze({ ...repairMetadata(verifyReadinessIngested(resolvedRoot, verifyRepairIngested(resolvedRoot))), status: 'REUSED', generateMigrations: true, generateContracts: true });
      if (isRepair) return Object.freeze({ ...repairMetadata(verifyRepairIngested(resolvedRoot)), status: 'REUSED', generateMigrations: true, generateContracts: true });
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
      if (isSopQuery) {
        const existingLock = validateSopQueryConsumptionLock(readJson(lockPath, 'SOP query candidate lock'), queryProfile);
        assertSopQueryLockMatchesContractSet(existingLock, existing);
        return Object.freeze({
          status: 'REUSED',
          profile: queryProfile.name,
          contract_set_id: existing.manifest.contract_set_id,
          source_git_sha: existing.manifest.source_git_sha,
          path: destination,
          lock_path: lockPath,
          preserved_lock: current?.contract_set_id ?? null,
          intake_status: INTAKE_STATUS,
          ddev_authorized: false,
          runtime_activated: false,
          generateMigrations: false,
          generateContracts: false,
        });
      }
      const verified = verifyIngestedContractSet({
        projectRoot: resolvedRoot,
        expectedContractSetId: source.manifest.contract_set_id,
      });
      return Object.freeze({ ...verified, status: 'REUSED' });
    }

    const stagingDirectory = mkdtempSync(path.join(upstreamRoot, '.contract-intake-'));
    let destinationInstalled = false;
    let candidateLockInstalled = false;
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
      const nextLock = consumptionLock(staged);
      const nextSopQueryLock = isSopQuery ? sopQueryConsumptionLock(staged) : null;
      renameSync(stagingDirectory, destination);
      destinationInstalled = true;
      if (isSopQuery) writeJsonAtomically(lockPath, nextSopQueryLock);
      else if (source.manifest.schema !== SOP_CONTRACT_SET_SCHEMA) writeJsonAtomically(lockPath, nextLock);
      if (isSopQuery) candidateLockInstalled = true;
    } catch (error) {
      if (existsSync(stagingDirectory)) {
        rmSync(stagingDirectory, { recursive: true, force: true });
      }
      if (isSopQuery && destinationInstalled && !candidateLockInstalled) {
        rmSync(destination, { recursive: true, force: true });
      }
      throw error;
    }

    if (isReadiness) return Object.freeze({ ...repairMetadata(verifyReadinessIngested(resolvedRoot, verifyRepairIngested(resolvedRoot))), status: 'CREATED', generateMigrations: true, generateContracts: true });
    if (isRepair) return Object.freeze({ ...repairMetadata(verifyRepairIngested(resolvedRoot)), status: 'CREATED', generateMigrations: true, generateContracts: true });
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
    if (isSopQuery) {
      const successor = verifyContractSetDirectory(destination);
      return Object.freeze({
        status: 'CREATED',
        profile: queryProfile.name,
        contract_set_id: successor.manifest.contract_set_id,
        source_git_sha: successor.manifest.source_git_sha,
        path: destination,
        lock_path: lockPath,
        preserved_lock: current?.contract_set_id ?? null,
        intake_status: INTAKE_STATUS,
        ddev_authorized: false,
        runtime_activated: false,
        generateMigrations: false,
        generateContracts: false,
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
  if (command !== 'ingest' && command !== 'verify') {
    throw new Error(`Unknown contract-set command: ${command}`);
  }
  const options = {};
  for (const argument of argv.slice(1)) {
    if (argument === '--') {
      continue;
    }
    const match = argument.match(/^--(source|source-repository-root|project-root|id|profile)=(.+)$/);
    if (!match) {
      throw new Error(`Unknown contract-set option: ${argument}`);
    }
    options[match[1]] = match[2];
  }
  if (options.profile && (command !== 'verify' || !['sopUnified', 'sopUnifiedCorrected', 'sopResourceDisable'].includes(options.profile))) throw new Error('Unsupported contract-set profile');
  return { command, options };
}

function runCli() {
  const { command, options } = parseCliArguments(process.argv.slice(2));
  const verifiers = { sopResourceDisable: verifyIngestedSopResourceDisableContractSet, sopUnified: verifyIngestedSopUnifiedContractSet, sopUnifiedCorrected: verifyIngestedCorrectedSopUnifiedContractSet };
  const result = command === 'ingest'
    ? ingestContractSetAndGenerate({
        projectRoot: options['project-root'],
        sourceDirectory: options.source,
        sourceRepositoryRoot: options['source-repository-root'],
      })
    : (verifiers[options.profile] ?? verifyIngestedContractSet)({
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
