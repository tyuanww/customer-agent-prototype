import path from 'node:path';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

export const SOP_CORRECTED_SCHEMA = 'customer-agent-contract-set/v11';
export const SOP_CORRECTED_LOCK = 'sop-unified-corrected-contract-set.lock.json';
export const SOP_CORRECTED_CONSUMPTION_SCHEMA = 'customer-agent-sop-unified-corrected-consumption/v1';
export const SOP_CORRECTED_SOURCE = 'business-docs/01-客服Agent项目/30-开发-进行中/content-intake-sop-unified-v1-1';
export const SOP_CORRECTED_INPUT = 'business-docs/01-客服Agent项目/30-开发-进行中/sop-unified-negotiation-candidate';
export const SOP_CORRECTED_SOURCE_FILES = [
  'business-docs/08-工具/build_customer_agent_sop_unified_negotiation_contract.mjs',
  `${SOP_CORRECTED_INPUT}/source.json`, `${SOP_CORRECTED_INPUT}/authorization.source.json`,
];
export const SOP_CORRECTED_MEMBERS = Object.freeze({
  openapi: ['openapi.v1.yaml', '1.29.1'], database: ['schema-v1.33.sql', 'schema.v1.33'],
  storage: ['storage.v1.sql', '1'], installation: ['installation.v1.json', '1'],
  provenance: ['provenance.v1.json', '1'], predecessor: ['predecessor-lock.v1.json', '1'],
  compatibility: ['compatibility.v1.json', '1'], coverage: ['operation-coverage.v1.json', '1'],
  legacyIntake: ['legacy-openapi.v7.yaml', '7'], legacyQuery: ['legacy-query.openapi.v1.json', '1'],
  query: ['query-transport.v1.json', '1'], authorization: ['authorization.v1.json', '1'],
  negotiation: ['negotiation-proof.v1.json', '1'],
});
export const SOP_CORRECTED_SOURCE_LOCK = {
  "schema": "customer-agent-sop-unified-correction-source/v1",
  "versions": {
    "openapi": "1.29.1",
    "database": "schema.v1.33",
    "profile": "content-intake-sop-unified-v1-1"
  },
  "predecessor": {
    "sourceGitSha": "33fc543523b95b47c1236ef7bbfccd3f772c9d0d",
    "contractSetId": "cs-ai-c11-openapi-1.29.0-schema-1.33-33fc543523b9",
    "directory": "business-docs/01-客服Agent项目/30-开发-进行中/content-intake-sop-unified-v1",
    "members": {
      "authorization.v1.json": "76eb719877b99da0d36a829e5919b82ebc37da784df01406bc0df2e238b4ec2b",
      "compatibility.v1.json": "01e796f4f6e52b98550a60ec81fe5fec614dfdcff840e07aebf86164419dc372",
      "installation.v1.json": "ad9b685ca0655044cfed9457784fd1cdcfa469e020764f7033479c87e6bcd3d0",
      "legacy-openapi.v7.yaml": "9bc9071cb36ad75c0f0131aeb5648c477e26580579769bf1090a3e2a5f2d38b5",
      "legacy-query.openapi.v1.json": "ba93b2c29dd9e21829355252427016a649707278102aedbc649017f608f00dc9",
      "openapi.v1.yaml": "6ab61ac566f0fe73168f435849f091862ef8745a3949ba46448ebadde57fb79a",
      "operation-coverage.v1.json": "a8c96f9b6ca8a60a3d1635b85d0543606a1e3e187e41a05cf0437d92a16f9033",
      "predecessor-lock.v1.json": "7d38d01aec36f2547b520060833e5022ad5582a6499271083a235465c1835568",
      "provenance.v1.json": "0ea8a329ea49899e6ff4f72a2703cffb8de9acfca51f3e308f6fbd5bc90628b2",
      "query-transport.v1.json": "89f4ba148557acb4a12bd30ddc7bed43acbb834d14ed3e84b57a58f66d3da6f7",
      "schema-v1.33.sql": "2ed15384fd2e1d0a4993dfebc40e68980b4ef8f4f1effe172b656f3c3c63cd12",
      "storage.v1.sql": "f2dfd7c6d7053d188089f7a171cb108ae2fa613bb5e7f30447acd0e1c4163510"
    }
  },
  "acceptedProductPredecessor": {
    "sourceGitSha": "0fb1dc76ee2b84fda4a82025c081eea7dd697534",
    "contractSetId": "cs-ai-c11-openapi-1.25.0-schema-1.30-0fb1dc76ee2b"
  }
};
export const SOP_CORRECTED_AUTHORIZATION = {
  "schema": "customer-agent-sop-unified-correction-authorization/v1",
  "status": "APPROVED",
  "evidenceId": "EVD-SOP-UNIFIED-NEGOTIATION-20261109",
  "decisionDate": "2026-11-09",
  "authority": "Project owner conversation continues engineering, local commit and local export authorization for the negotiation correction. The current worker implements and freezes only; the parent owns the exact source commit and export.",
  "scope": [
    "formal-contract-change",
    "product-implementation",
    "local-commit",
    "local-export"
  ],
  "model": "unified-taskgraph-v4-with-query-transport",
  "businessMappingApproved": false,
  "runtimeActivated": false,
  "realDataApproved": false,
  "deploymentApproved": false
};

export const FROM_PATTERN = '^cs-ai-c11-openapi-1\\.28\\.0-schema-1\\.32-[0-9a-f]{12}$';
export const TO_PATTERN = '^cs-ai-c11-openapi-1\\.29\\.1-schema-1\\.33-[0-9a-f]{12}$';
const HEADER = 'X-Intake-Contract-Set';
const PREDECESSOR = SOP_CORRECTED_SOURCE_LOCK.predecessor;
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const proofMetadata = {
  schema: 'customer-agent-sop-negotiation-proof/v1', predecessorSourceGitSha: PREDECESSOR.sourceGitSha,
  header: HEADER, fromPattern: FROM_PATTERN, toPattern: TO_PATTERN,
};

function equal(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`SOP corrected ${label} mismatch`);
}

function patternLocations(value, pattern, pointer = '', found = []) {
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    const location = `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    if (child === pattern) {
      if (key !== 'pattern') throw new Error('SOP corrected pattern occurs outside a schema pattern');
      found.push({ pointer: location, before: FROM_PATTERN, after: TO_PATTERN });
    } else patternLocations(child, pattern, location, found);
  }
  return found;
}

function checkNegotiation(api, proof, contractSetId) {
  const changed = patternLocations(api, TO_PATTERN);
  equal(changed.length, 548, 'negotiation header count');
  equal(patternLocations(api, FROM_PATTERN), [], 'obsolete negotiation patterns');
  equal(proof, { ...proofMetadata, changedHeaders: changed }, 'negotiation proof');
  const matcher = new RegExp(TO_PATTERN);
  if (!matcher.test(contractSetId)) throw new Error('SOP corrected actual manifest ID is rejected by its negotiation schemas');
  for (const invalid of [PREDECESSOR.contractSetId, 'cs-ai-c11-openapi-1.28.0-schema-1.32-0123456789ab',
    'menokin-sop-query-v1', contractSetId.slice(0, -12), `${contractSetId}-extra`]) {
    if (matcher.test(invalid)) throw new Error('SOP corrected invalid contract view is accepted');
  }
  equal(api['x-contract-set-negotiation']?.successorContractSetId, 'deployment-manifest-exact-id', 'successor manifest binding');
}

function rebuild(previous, sourceBytes, authorizationBytes) {
  const parse = name => JSON.parse(previous.get(name));
  const source = JSON.parse(sourceBytes);
  const api = parse('openapi.v1.yaml');
  const changedHeaders = patternLocations(api, FROM_PATTERN);
  equal(changedHeaders.length, 548, 'predecessor header count');
  for (const { pointer } of changedHeaders) {
    const keys = pointer.slice(1).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'));
    const key = keys.pop();
    const parent = keys.reduce((value, segment) => value[segment], api);
    parent[key] = TO_PATTERN;
  }
  equal(api.info.version, '1.29.0', 'predecessor OpenAPI version');
  api.info.version = source.versions.openapi;
  equal(api['x-contract-set-negotiation'].successorContractSetId, null, 'predecessor successor binding');
  api['x-contract-set-negotiation'].successorContractSetId = 'deployment-manifest-exact-id';
  const query = parse('query-transport.v1.json');
  equal(query.info.version, '1.29.0', 'predecessor query version');
  query.info.version = source.versions.openapi;
  const installation = parse('installation.v1.json');
  installation.schema = 'customer-agent-sop-unified-installation/v2';
  installation.versions = source.versions;
  installation.correction = { predecessorContractSetId: PREDECESSOR.contractSetId,
    predecessorSourceGitSha: PREDECESSOR.sourceGitSha, header: HEADER, pattern: TO_PATTERN };
  installation.requirements.push(
    'The complete actual manifest contract_set_id must pass every negotiation schema. Older versions, prefixes and business aliases do not select the corrected view.',
    'A format-valid unknown suffix is not runtime authorization. Require exact equality with the deployed manifest ID before selecting the successor view.',
    'modelInstallation, modelCompatibility and modelCoverage retain historical model/source v4 metadata. Current versions are owned by top-level versions and the corrected intake negotiation.',
  );
  const compatibility = parse('compatibility.v1.json');
  const coverage = parse('operation-coverage.v1.json');
  const files = new Map([
    ['openapi.v1.yaml', json(api)], ['schema-v1.33.sql', previous.get('schema-v1.33.sql')],
    ['storage.v1.sql', previous.get('storage.v1.sql')], ['installation.v1.json', json(installation)],
    ['predecessor-lock.v1.json', sourceBytes],
    ['compatibility.v1.json', json({ schema: 'customer-agent-sop-unified-compatibility/v2',
      modelCompatibility: compatibility.intake, intake: api['x-contract-set-negotiation'], query: compatibility.query })],
    ['operation-coverage.v1.json', json({ modelCoverage: coverage.intake, query: coverage.query,
      negotiation: { header: HEADER, pattern: TO_PATTERN, changedHeaders: changedHeaders.length } })],
    ['legacy-openapi.v7.yaml', previous.get('legacy-openapi.v7.yaml')],
    ['legacy-query.openapi.v1.json', previous.get('legacy-query.openapi.v1.json')],
    ['query-transport.v1.json', json(query)], ['authorization.v1.json', authorizationBytes],
    ['negotiation-proof.v1.json', json({ ...proofMetadata, changedHeaders })],
  ]);
  return files;
}

/** The host owns Git/filesystem and atomic installation. This profile owns the
 * correction recipe over independently pinned immutable 1.29.0 artifacts. */
export function createCorrectedSopUnifiedProfile({ assertExactKeys, validateDescriptor, readJson, sha256Bytes, runGit }) {
  const descriptors = manifest => ({ openapi: manifest.openapi, database: manifest.database, ...manifest.sopUnified });
  const read = (directory, manifest, key) => readJson(path.join(directory, descriptors(manifest)[key].file), `SOP corrected ${key}`);

  function validateManifest(manifest) {
    assertExactKeys(manifest, ['schema', 'contract_set_id', 'source_repository', 'source_git_sha',
      'architecture_version', 'implementation_version', 'openapi', 'database', 'sopUnified'], 'SOP corrected manifest');
    equal(manifest.schema, SOP_CORRECTED_SCHEMA, 'manifest schema');
    if (manifest.source_repository !== 'ai-赋能立项' || typeof manifest.source_git_sha !== 'string'
      || !/^[0-9a-f]{40}$/.test(manifest.source_git_sha)
      || manifest.contract_set_id !== `cs-ai-c11-openapi-1.29.1-schema-1.33-${manifest.source_git_sha.slice(0, 12)}`
      || manifest.architecture_version !== '1.16' || manifest.implementation_version !== '1.22') {
      throw new Error('SOP corrected manifest identity is invalid');
    }
    assertExactKeys(manifest.sopUnified, Object.keys(SOP_CORRECTED_MEMBERS).filter(key => !['openapi', 'database'].includes(key)), 'SOP corrected artifacts');
    for (const [key, descriptor] of Object.entries(descriptors(manifest))) {
      validateDescriptor(descriptor, `SOP corrected ${key}`);
      const [file, version] = SOP_CORRECTED_MEMBERS[key];
      equal({ version: descriptor.version, file: descriptor.file, source_path: descriptor.source_path },
        { version, file, source_path: `${SOP_CORRECTED_SOURCE}/${file}` }, `${key} descriptor`);
    }
    return manifest;
  }

  function verifyReferences(directory, manifest) {
    equal(read(directory, manifest, 'predecessor'), SOP_CORRECTED_SOURCE_LOCK, 'fixed predecessor');
    equal(read(directory, manifest, 'authorization'), SOP_CORRECTED_AUTHORIZATION, 'authorization');
    const api = read(directory, manifest, 'openapi');
    equal(api.info?.version, SOP_CORRECTED_SOURCE_LOCK.versions.openapi, 'OpenAPI version');
    checkNegotiation(api, read(directory, manifest, 'negotiation'), manifest.contract_set_id);
    for (const key of ['database', 'storage', 'legacyIntake', 'legacyQuery']) {
      const descriptor = descriptors(manifest)[key];
      equal(descriptor.sha256, PREDECESSOR.members[descriptor.file], `${key} immutable predecessor bytes`);
    }
    const provenance = read(directory, manifest, 'provenance');
    assertExactKeys(provenance, ['schema', 'status', 'versions', 'formalVersionAssigned', 'sourceGitSha',
      'authorizationEvidenceId', 'sources', 'artifacts', 'runtimeActivated', 'businessMappingApproved'], 'SOP corrected provenance');
    equal({ ...provenance, sources: null, artifacts: null }, {
      schema: 'customer-agent-sop-unified-correction-candidate/v1', status: 'IMPLEMENTATION_APPROVED_CANDIDATE',
      versions: SOP_CORRECTED_SOURCE_LOCK.versions, formalVersionAssigned: true, sourceGitSha: null,
      authorizationEvidenceId: SOP_CORRECTED_AUTHORIZATION.evidenceId, sources: null, artifacts: null,
      runtimeActivated: false, businessMappingApproved: false,
    }, 'provenance boundary');
    assertExactKeys(provenance.sources, SOP_CORRECTED_SOURCE_FILES, 'SOP corrected sources');
    for (const digest of Object.values(provenance.sources)) {
      if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) throw new Error('SOP corrected source hash is invalid');
    }
    equal(provenance.sources[`${SOP_CORRECTED_INPUT}/source.json`], manifest.sopUnified.predecessor.sha256, 'source declaration hash');
    equal(provenance.sources[`${SOP_CORRECTED_INPUT}/authorization.source.json`], manifest.sopUnified.authorization.sha256, 'authorization source hash');
    equal(provenance.artifacts, Object.fromEntries(Object.entries(descriptors(manifest)).filter(([key]) => key !== 'provenance')
      .map(([, d]) => [d.file, { sha256: d.sha256, bytes: d.bytes }])), 'artifact provenance');
    const installation = read(directory, manifest, 'installation');
    equal(installation.schema, 'customer-agent-sop-unified-installation/v2', 'installation schema');
    equal(installation.versions, SOP_CORRECTED_SOURCE_LOCK.versions, 'installation versions');
    equal(installation.correction, { predecessorContractSetId: PREDECESSOR.contractSetId,
      predecessorSourceGitSha: PREDECESSOR.sourceGitSha, header: HEADER, pattern: TO_PATTERN }, 'correction lineage');
    equal({ migrationPosition: installation.migrationPosition, runnableMigration: installation.runnableMigration,
      runtimeActivated: installation.runtimeActivated, productionConsumerReady: installation.productionConsumerReady },
    { migrationPosition: null, runnableMigration: false, runtimeActivated: false, productionConsumerReady: false }, 'installation boundary');
  }

  function verifySource(repositoryRoot, manifest) {
    const committed = relative => {
      const entry = String(runGit(repositoryRoot, ['ls-tree', manifest.source_git_sha, '--', relative], 'utf8')).trim();
      if (!/^100(?:644|755) blob [0-9a-f]{40}\t/.test(entry)) throw new Error(`SOP corrected source must be a regular Git blob: ${relative}`);
      return runGit(repositoryRoot, ['show', `${manifest.source_git_sha}:${relative}`]);
    };
    const artifact = key => committed(descriptors(manifest)[key].source_path);
    const provenance = JSON.parse(artifact('provenance'));
    for (const file of SOP_CORRECTED_SOURCE_FILES) equal(sha256Bytes(committed(file)), provenance.sources[file], `source provenance ${file}`);
    const sourceBytes = committed(`${SOP_CORRECTED_INPUT}/source.json`);
    const authorizationBytes = committed(`${SOP_CORRECTED_INPUT}/authorization.source.json`);
    equal(JSON.parse(sourceBytes), SOP_CORRECTED_SOURCE_LOCK, 'committed source declaration');
    equal(JSON.parse(authorizationBytes), SOP_CORRECTED_AUTHORIZATION, 'committed authorization');
    const previous = new Map(Object.entries(PREDECESSOR.members).map(([file, digest]) => {
      const bytes = committed(`${PREDECESSOR.directory}/${file}`);
      equal(sha256Bytes(bytes), digest, `predecessor source ${file}`);
      return [file, bytes];
    }));
    const originalMembers = String(runGit(repositoryRoot, ['ls-tree', '--name-only', `${manifest.source_git_sha}:${PREDECESSOR.directory}`], 'utf8')).trim().split('\n').sort();
    equal(originalMembers, [...previous.keys()].sort(), 'predecessor source member set');
    const rebuilt = rebuild(previous, sourceBytes, authorizationBytes);
    rebuilt.set('provenance.v1.json', json({ schema: 'customer-agent-sop-unified-correction-candidate/v1',
      status: 'IMPLEMENTATION_APPROVED_CANDIDATE', versions: SOP_CORRECTED_SOURCE_LOCK.versions,
      formalVersionAssigned: true, sourceGitSha: null, authorizationEvidenceId: SOP_CORRECTED_AUTHORIZATION.evidenceId,
      sources: provenance.sources, artifacts: Object.fromEntries([...rebuilt].map(([file, bytes]) => [file, { sha256: sha256Bytes(bytes), bytes: bytes.length }])),
      runtimeActivated: false, businessMappingApproved: false }));
    for (const [key, descriptor] of Object.entries(descriptors(manifest))) equal(artifact(key), rebuilt.get(descriptor.file), `rebuilt artifact ${key}`);
    const frozen = String(runGit(repositoryRoot, ['ls-tree', '--name-only', `${manifest.source_git_sha}:${SOP_CORRECTED_SOURCE}`], 'utf8')).trim().split('\n').sort();
    equal(frozen, Object.values(descriptors(manifest)).map(d => d.file).sort(), 'frozen source member set');
  }

  function verifyReconstruction(directory, manifest, predecessorDirectory) {
    const previous = new Map(Object.entries(PREDECESSOR.members).map(([file, digest]) => {
      const bytes = readFileSync(path.join(predecessorDirectory, file));
      equal(sha256Bytes(bytes), digest, `product predecessor ${file}`);
      return [file, bytes];
    }));
    const sourceBytes = readFileSync(path.join(directory, manifest.sopUnified.predecessor.file));
    const authorizationBytes = readFileSync(path.join(directory, manifest.sopUnified.authorization.file));
    const rebuilt = rebuild(previous, sourceBytes, authorizationBytes);
    for (const [file, expected] of rebuilt) {
      equal(readFileSync(path.join(directory, file)), expected, `product reconstruction ${file}`);
    }
  }

  function verifyPredecessor(manifest) {
    equal(manifest.schema, 'customer-agent-contract-set/v10', 'product predecessor schema');
    equal(manifest.source_git_sha, PREDECESSOR.sourceGitSha, 'product predecessor SHA');
    equal(manifest.contract_set_id, PREDECESSOR.contractSetId, 'product predecessor identity');
    equal(Object.fromEntries([manifest.openapi, manifest.database, ...Object.values(manifest.sopUnified)]
      .map(d => [d.file, d.sha256])), PREDECESSOR.members, 'product predecessor hashes');
  }
  return { validateManifest, verifyReferences, verifySource, verifyPredecessor, verifyReconstruction };
}
