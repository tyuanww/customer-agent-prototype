import path from 'node:path';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { SOP_CORRECTED_MEMBERS } from './sop-unified-corrected-contract.mjs';

export const SOP_RESOURCE_SCHEMA = 'customer-agent-contract-set/v12';
export const SOP_RESOURCE_LOCK = 'sop-resource-disable-contract-set.lock.json';
export const SOP_RESOURCE_CONSUMPTION_SCHEMA = 'customer-agent-sop-resource-disable-consumption/v1';
export const SOP_RESOURCE_CORRECTED_SCHEMA = 'customer-agent-contract-set/v13';
export const SOP_RESOURCE_CORRECTED_LOCK = 'sop-resource-disable-corrected-contract-set.lock.json';
export const SOP_RESOURCE_CORRECTED_CONSUMPTION_SCHEMA = 'customer-agent-sop-resource-disable-corrected-consumption/v1';
export const SOP_RESOURCE_CORRECTED_PROFILE = Object.freeze({
  schema: SOP_RESOURCE_CORRECTED_SCHEMA,
  source: 'business-docs/01-客服Agent项目/30-开发-进行中/content-intake-sop-resource-disable-v1-2',
  input: 'business-docs/01-客服Agent项目/30-开发-进行中/sop-resource-disable-candidate-1.30.1-schema1.35',
  versions: Object.freeze({ openapi: '1.30.1', database: 'schema.v1.35', profile: 'content-intake-sop-resource-disable-v1' }),
  sourceSha: '5fb5c1285056b7a862ef5a03cf25975fb91802b5',
  manifestSha: 'c7a87a580f4c86d2a3c722311120fe061a0a03db02362880c1feff65c77744e1',
  toPattern: '^cs-ai-c11-openapi-1\\.30\\.1-schema-1\\.35-[0-9a-f]{12}$',
});
export const SOP_RESOURCE_SOURCE = 'business-docs/01-客服Agent项目/30-开发-进行中/content-intake-sop-resource-disable-v1';
const INPUT = 'business-docs/01-客服Agent项目/30-开发-进行中/sop-resource-disable-candidate';
const VERSIONS = Object.freeze({ openapi: '1.30.0', database: 'schema.v1.34', profile: 'content-intake-sop-resource-disable-v1' });
const APPROVED_SOURCE_SHA = '0405c5651564958702ddd5484bbf41a0f193515f';
const APPROVED_MANIFEST_SHA = 'e60033b96859cf2c7060f04c2055b5b616c967ecaf32fc6178ca6476b31fc426';
const PREDECESSOR_SHA = '812a2e80584f08675fab8b7401ce8b4cd3ab5bca';
const PREDECESSOR_ID = 'cs-ai-c11-openapi-1.29.1-schema-1.33-812a2e80584f';
const FROM_PATTERN = '^cs-ai-c11-openapi-1\\.29\\.1-schema-1\\.33-[0-9a-f]{12}$';
const TO_PATTERN = '^cs-ai-c11-openapi-1\\.30\\.0-schema-1\\.34-[0-9a-f]{12}$';
const DEFAULT_PROFILE = Object.freeze({
  schema: SOP_RESOURCE_SCHEMA, source: SOP_RESOURCE_SOURCE, input: INPUT, versions: VERSIONS,
  sourceSha: APPROVED_SOURCE_SHA, manifestSha: APPROVED_MANIFEST_SHA, toPattern: TO_PATTERN,
});

function equal(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`SOP resource disable ${label} mismatch`);
}

function at(value, pointer) {
  return pointer.split('/').slice(1).reduce((current, key) => current?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], value);
}

function patterns(value, pattern, pointer = '', found = []) {
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    const location = `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    if (key === 'pattern' && child === pattern) found.push(location);
    else patterns(child, pattern, location, found);
  }
  return found;
}

/** The host owns Git, files, shared locking and installation. This profile only
 * verifies the closed resource snapshot and its immutable v11 lineage as data. */
export function createSopResourceDisableProfile({ assertExactKeys, validateDescriptor, readJson, sha256Bytes, runGit }, profile = DEFAULT_PROFILE) {
  const { schema: SOP_RESOURCE_SCHEMA, source: SOP_RESOURCE_SOURCE, input: INPUT, versions: VERSIONS,
    sourceSha: APPROVED_SOURCE_SHA, manifestSha: APPROVED_MANIFEST_SHA, toPattern: TO_PATTERN } = profile;
  const MEMBERS = Object.freeze({
    ...SOP_CORRECTED_MEMBERS,
    openapi: ['openapi.v1.yaml', VERSIONS.openapi], database: [`${VERSIONS.database.replace('schema.', 'schema-')}.sql`, VERSIONS.database],
    handoff: ['consumer-handoff.v1.json', '1'], exportSchema: ['export.schema.json', '1'],
  });
  const INTEGRATION = Object.freeze({ expectedPredecessorPosition: 87, plannedPosition: 88, sourceDelta: 'storage.source.sql', runnableProductMigration: false });
  const SOURCE_FILES = [
    ...['authorization.source.json', 'export.schema.json', 'source.json', 'storage.source.sql', 'v11-manifest.source.json'].map(file => `${INPUT}/${file}`),
    ...['README.md', 'confirmation.md', 'shapes.source.json', 'source.json', 'storage.source.sql'].map(file => `business-docs/01-客服Agent项目/30-开发-进行中/sop-resource-disable-draft/${file}`),
    ...['build_customer_agent_backend_contract.mjs', 'build_customer_agent_csv_contract.mjs', 'build_customer_agent_owner_contract.mjs',
      'build_customer_agent_runtime_closure.mjs', 'build_customer_agent_sop_resource_disable_contract.mjs',
      'build_customer_agent_sop_resource_disable_draft.mjs', 'build_customer_agent_sop_unified_negotiation_contract.mjs',
      'export_customer_agent_contract_set.mjs', 'sop_query_continuation_contract.mjs'].map(file => `business-docs/08-工具/${file}`),
    'sites/tests/sop-resource-disable-draft.test.mjs',
  ];
  const descriptors = manifest => ({ openapi: manifest.openapi, database: manifest.database, ...manifest.resourceDisable });
  const read = (directory, manifest, key) => readJson(path.join(directory, descriptors(manifest)[key].file), `SOP resource disable ${key}`);

  function validateManifest(manifest) {
    assertExactKeys(manifest, ['schema', 'contract_set_id', 'source_repository', 'source_git_sha',
      'architecture_version', 'implementation_version', 'openapi', 'database', 'resourceDisable', 'legacyV11'], 'SOP resource disable manifest');
    equal(manifest.schema, SOP_RESOURCE_SCHEMA, 'schema');
    if (manifest.source_repository !== 'ai-赋能立项' || typeof manifest.source_git_sha !== 'string'
      || !/^[0-9a-f]{40}$/.test(manifest.source_git_sha)
      || manifest.source_git_sha !== APPROVED_SOURCE_SHA
      || manifest.contract_set_id !== `cs-ai-c11-openapi-${VERSIONS.openapi}-${VERSIONS.database.replace('schema.v', 'schema-')}-${manifest.source_git_sha.slice(0, 12)}`
      || manifest.architecture_version !== '1.16' || manifest.implementation_version !== '1.22') {
      throw new Error('SOP resource disable manifest identity is invalid');
    }
    assertExactKeys(manifest.resourceDisable, Object.keys(MEMBERS).filter(key => !['openapi', 'database'].includes(key)), 'SOP resource disable artifacts');
    for (const [key, descriptor] of Object.entries(descriptors(manifest))) {
      checkDescriptor(descriptor, ...MEMBERS[key]);
    }
    assertExactKeys(manifest.legacyV11, ['sourceGitSha', 'contractSetId', 'members'], 'SOP resource disable legacyV11');
    equal(manifest.legacyV11.sourceGitSha, PREDECESSOR_SHA, 'legacy SHA');
    equal(manifest.legacyV11.contractSetId, PREDECESSOR_ID, 'legacy ID');
    const legacyVersions = Object.fromEntries(Object.values(SOP_CORRECTED_MEMBERS));
    legacyVersions['contract-set.json'] = '11';
    assertExactKeys(manifest.legacyV11.members, Object.keys(legacyVersions), 'SOP resource disable legacy members');
    for (const [file, version] of Object.entries(legacyVersions)) {
      checkDescriptor(manifest.legacyV11.members[file], `v11-${file}`, version);
    }
    return manifest;
  }

  function checkDescriptor(descriptor, file, version) {
    validateDescriptor(descriptor, `SOP resource disable ${file}`);
    equal({ file: descriptor.file, version: descriptor.version, source_path: descriptor.source_path },
      { file, version, source_path: `${SOP_RESOURCE_SOURCE}/${file}` }, `${file} descriptor`);
    if (descriptor.bytes > 33554432) throw new Error('SOP resource disable artifact exceeds export bound');
  }

  function verifyLegacy(directory, manifest, predecessorDirectory = directory) {
    equal(manifest.legacyV11.members['contract-set.json'].sha256, 'b2cec936b26d5e3b7990f84d25efc10f6556dde49b6e010e353e380c21f60a52', 'pinned v11 manifest');
    const embedded = readJson(path.join(directory, 'v11-contract-set.json'), 'SOP resource disable embedded v11 manifest');
    equal(embedded.schema, 'customer-agent-contract-set/v11', 'embedded v11 schema');
    equal(embedded.source_git_sha, PREDECESSOR_SHA, 'embedded v11 SHA');
    equal(embedded.contract_set_id, PREDECESSOR_ID, 'embedded v11 ID');
    const originals = { 'contract-set.json': null, ...Object.fromEntries([embedded.openapi, embedded.database, ...Object.values(embedded.sopUnified)].map(d => [d.file, d])) };
    assertExactKeys(originals, Object.keys(manifest.legacyV11.members), 'SOP resource disable embedded member set');
    for (const [file, descriptor] of Object.entries(manifest.legacyV11.members)) {
      const embeddedBytes = readFileSync(path.join(directory, descriptor.file));
      if (originals[file]) equal({ sha256: descriptor.sha256, bytes: descriptor.bytes, version: descriptor.version },
        { sha256: originals[file].sha256, bytes: originals[file].bytes, version: originals[file].version }, `legacy descriptor ${file}`);
      if (predecessorDirectory !== directory) equal(embeddedBytes, readFileSync(path.join(predecessorDirectory, file)), `immutable product v11 ${file}`);
    }
    for (const key of ['legacyIntake', 'legacyQuery']) equal(readFileSync(path.join(directory, descriptors(manifest)[key].file)),
      readFileSync(path.join(directory, `v11-${descriptors(manifest)[key].file}`)), `unchanged ${key}`);
  }

  function verifyReferences(directory, manifest) {
    verifyLegacy(directory, manifest);
    const predecessor = read(directory, manifest, 'predecessor');
    equal(predecessor.versions, VERSIONS, 'source versions');
    equal(predecessor.predecessor.sourceGitSha, PREDECESSOR_SHA, 'source predecessor SHA');
    equal(predecessor.predecessor.contractSetId, PREDECESSOR_ID, 'source predecessor ID');
    equal(predecessor.productMigration, INTEGRATION, 'source integration boundary');
    equal(predecessor.sourceGitSha, null, 'unassigned source metadata SHA');
    equal(predecessor.contractSetId, null, 'unassigned source metadata ID');
    equal(predecessor.predecessor.manifestSha256, manifest.legacyV11.members['contract-set.json'].sha256, 'predecessor manifest hash');
    equal(predecessor.predecessor.members, Object.fromEntries(Object.entries(manifest.legacyV11.members)
      .filter(([file]) => file !== 'contract-set.json').map(([file, d]) => [file, d.sha256])), 'predecessor member hashes');

    const provenance = read(directory, manifest, 'provenance');
    equal(provenance.versions, VERSIONS, 'provenance versions');
    equal(provenance.sourceGitSha, null, 'unassigned provenance SHA');
    equal(provenance.contractSetId, null, 'unassigned provenance ID');
    assertExactKeys(provenance.sources, SOURCE_FILES, 'SOP resource disable source closure');
    for (const hash of Object.values(provenance.sources)) {
      if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) throw new Error('SOP resource disable invalid source hash');
    }
    const all = [...Object.values(descriptors(manifest)), ...Object.values(manifest.legacyV11.members)];
    equal(provenance.artifacts, Object.fromEntries(all.filter(d => d.file !== 'provenance.v1.json')
      .map(d => [d.file, { sha256: d.sha256, bytes: d.bytes }])), 'artifact provenance');
    for (const [input, key] of [['authorization.source.json', 'authorization'], ['export.schema.json', 'exportSchema'], ['source.json', 'predecessor'], ['storage.source.sql', 'storage']]) {
      equal(provenance.sources[`${INPUT}/${input}`], descriptors(manifest)[key].sha256, `${input} identity`);
    }
    equal(provenance.sources[`${INPUT}/v11-manifest.source.json`], manifest.legacyV11.members['contract-set.json'].sha256, 'v11 manifest source identity');

    const authorization = read(directory, manifest, 'authorization');
    equal(authorization.status, 'APPROVED', 'authorization status');
    equal(authorization.parentSelection.versions, VERSIONS, 'approved versions');
    equal(authorization.parentSelection.semanticAuthority.sourceGitSha, PREDECESSOR_SHA, 'semantic authority');
    equal(authorization.scope, ['formal-contract-change', 'product-implementation', 'local-commit', 'local-export'], 'authorization scope');
    for (const record of [provenance, authorization]) {
      for (const flag of ['businessMappingApproved', 'runtimeActivated', 'realDataApproved', 'deploymentApproved']) equal(record[flag], false, flag);
    }
    const installation = read(directory, manifest, 'installation');
    equal(installation.versions, VERSIONS, 'installation versions');
    equal(installation.fullSchema, { file: manifest.database.file, sha256: manifest.database.sha256, mode: 'cumulative-reference', predecessorByteExact: true }, 'cumulative reference');
    equal(installation.delta, { file: manifest.resourceDisable.storage.file, sha256: manifest.resourceDisable.storage.sha256, mode: 'apply-once-after-verified-product-prefix', includesPredecessorStorage: false }, 'isolated delta');
    equal(installation.productIntegration, INTEGRATION, 'integration boundary');
    equal(installation.migrationPosition, null, 'unregistered migration');
    for (const flag of ['runnableMigration', 'runtimeActivated', 'productionConsumerReady']) equal(installation[flag], false, flag);
    const handoff = read(directory, manifest, 'handoff');
    equal(handoff.schema, 'customer-agent-resource-disable-consumer-handoff/v1', 'handoff schema');
    equal(handoff.versions, VERSIONS, 'handoff versions');
    equal(handoff.integrationTarget, INTEGRATION, 'handoff integration');
    equal(handoff.runtimeActivated, false, 'handoff activation');
    equal(handoff.sourceGitSha, null, 'handoff source SHA');
    equal(handoff.contractSetId, null, 'handoff source ID');
    equal(handoff.continuationLifecycle, installation.continuationLifecycle, 'continuation lifecycle');

    const api = read(directory, manifest, 'openapi');
    const query = read(directory, manifest, 'query');
    const oldApi = readJson(path.join(directory, 'v11-openapi.v1.yaml'), 'SOP resource disable v11 OpenAPI');
    const oldQuery = readJson(path.join(directory, 'v11-query-transport.v1.json'), 'SOP resource disable v11 query');
    equal(api.info.version, VERSIONS.openapi, 'OpenAPI version');
    equal(query.info.version, VERSIONS.openapi, 'query version');
    equal(Object.keys(api.components.schemas).length, 306, 'full component count');
    verifyNegotiation(api, query, oldApi, oldQuery, read(directory, manifest, 'negotiation'));
    const composedQuery = JSON.parse(JSON.stringify(query, (key, value) => {
      if (key !== '$ref' || typeof value !== 'string') return value;
      const match = /^#\/components\/([^/]+)\/([^/]+)$/.exec(value);
      if (!match || !Object.hasOwn(query.components[match[1]] ?? {}, match[2])) return value;
      return `#/components/${match[1]}/MenokinSopQuery${match[2]}`;
    }));
    equal(api.paths['/v1/sop/query'], composedQuery.paths['/v1/sop/query'], 'query route');
    equal(query.components.schemas.SopQueryRequest.properties.entitlement_id, api.components.schemas.IntakeId, 'query entitlement shape');
    composedQuery.components.schemas.SopQueryRequest.properties.entitlement_id = { $ref: '#/components/schemas/IntakeId' };
    for (const [name, schema] of Object.entries(composedQuery.components.schemas)) equal(api.components.schemas[`MenokinSopQuery${name}`], schema, `query schema ${name}`);
    for (const name of ['IntakeSopContinuationRenew', 'IntakeSopContinuationClose', 'MenokinSopQuerySopReadyResponse']) equal(api.components.schemas[name], oldApi.components.schemas[name], `unchanged ${name}`);
    equal(handoff.schemas, Object.fromEntries(Object.entries(api.components.schemas)
      .filter(([name]) => name.startsWith('IntakeResourceDisable'))
      .map(([name, schema]) => [name, { required: schema.required ?? [], properties: schema.properties ?? {}, oneOf: schema.oneOf ?? [] }])), 'handoff field projections');
    const exportSchema = read(directory, manifest, 'exportSchema');
    verifyExportSchema(exportSchema, manifest);
    // Offline verification must also reject coordinated descriptor and lock rewrites.
    equal(sha256Bytes(readFileSync(path.join(directory, 'contract-set.json'))), APPROVED_MANIFEST_SHA, 'frozen manifest');
  }

  function verifyExportSchema(schema, manifest) {
    const descriptorSchema = descriptor => ({
      type: 'object', additionalProperties: false,
      required: ['version', 'file', 'source_path', 'sha256', 'bytes'],
      properties: {
        version: { const: descriptor.version }, file: { const: descriptor.file }, source_path: { const: descriptor.source_path },
        sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        bytes: { type: 'integer', minimum: 1, maximum: 33554432 },
      },
    });
    const membersSchema = descriptors => ({
      type: 'object', additionalProperties: false, required: Object.keys(descriptors),
      properties: Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptorSchema(descriptor)])),
    });
    equal(schema, {
      $schema: 'https://json-schema.org/draft/2020-12/schema', $id: `urn:customer-agent:contract-set:${SOP_RESOURCE_SCHEMA.split('/')[1]}`,
      type: 'object', additionalProperties: false,
      required: ['schema', 'contract_set_id', 'source_repository', 'source_git_sha', 'architecture_version', 'implementation_version', 'openapi', 'database', 'resourceDisable', 'legacyV11'],
      properties: {
        schema: { const: SOP_RESOURCE_SCHEMA }, contract_set_id: { type: 'string', pattern: TO_PATTERN },
        source_repository: { const: 'ai-赋能立项' }, source_git_sha: { type: 'string', pattern: '^[0-9a-f]{40}$' },
        architecture_version: { const: '1.16' }, implementation_version: { const: '1.22' },
        openapi: descriptorSchema(manifest.openapi), database: descriptorSchema(manifest.database),
        resourceDisable: membersSchema(manifest.resourceDisable),
        legacyV11: {
          type: 'object', additionalProperties: false, required: ['sourceGitSha', 'contractSetId', 'members'],
          properties: {
            sourceGitSha: { const: PREDECESSOR_SHA }, contractSetId: { const: PREDECESSOR_ID },
            members: membersSchema(manifest.legacyV11.members),
          },
        },
      },
    }, 'closed export schema');
  }

  function verifyNegotiation(api, query, oldApi, oldQuery, proof) {
    equal(proof.schema, 'customer-agent-sop-resource-disable-proof/v1', 'negotiation schema');
    equal(proof.predecessorSourceGitSha, PREDECESSOR_SHA, 'negotiation source');
    equal(proof.header, 'X-Intake-Contract-Set', 'negotiation header');
    equal(proof.fromPattern, FROM_PATTERN, 'negotiation from');
    equal(proof.toPattern, TO_PATTERN, 'negotiation to');
    const previous = patterns(oldApi, FROM_PATTERN);
    equal(previous.length, 548, 'previous header count');
    equal(proof.changedHeaders, previous.map(pointer => ({ pointer, before: FROM_PATTERN, after: TO_PATTERN })), '548 header proof');
    equal(patterns(api, FROM_PATTERN), [], 'obsolete headers');
    equal(patterns(api, TO_PATTERN).sort(), [
      ...previous, ...proof.queryContinuationHeaders.fullApi.map(entry => entry.pointer),
      '/x-contract-set-negotiation/pattern',
      '/x-sop-query-continuation-contract/storage/openingProofReferenceSchema/properties/selectedContractSetId/pattern',
    ].sort(), 'full API negotiation locations');
    for (const pointer of previous) equal(at(api, pointer), TO_PATTERN, `header ${pointer}`);
    for (const [key, current, original] of [['fullApi', api, oldApi], ['transport', query, oldQuery]]) {
      const entries = proof.queryContinuationHeaders[key];
      equal(entries.length, 2, `${key} query header count`);
      equal(entries.map(entry => entry.pointer).sort(), patterns({ paths: query.paths }, TO_PATTERN).sort(), `${key} query header locations`);
      for (const entry of entries) {
        equal(entry.after, TO_PATTERN, 'query header pattern');
        equal(at(original, entry.pointer.slice(0, -'/pattern'.length)), entry.before, 'original query header');
        equal(at(current, entry.pointer), TO_PATTERN, 'strict query header');
      }
    }
    const changes = {};
    for (const [name, schema] of Object.entries(api.components.schemas)) {
      if (!isDeepStrictEqual(schema, oldApi.components.schemas[name])) changes[name] = {
        before: oldApi.components.schemas[name] ? sha256Bytes(`${JSON.stringify(oldApi.components.schemas[name], null, 2)}\n`) : null,
        after: sha256Bytes(`${JSON.stringify(schema, null, 2)}\n`),
      };
    }
    equal(proof.schemaChanges, changes, 'schema change proof');
    for (const name of proof.stableFlowTypes) equal(api.components.schemas[name], oldApi.components.schemas[name], `stable ${name}`);
  }

  function verifySource(repositoryRoot, manifest) {
    const committed = relative => {
      const entry = String(runGit(repositoryRoot, ['ls-tree', manifest.source_git_sha, '--', relative], 'utf8')).trim();
      if (!/^100(?:644|755) blob [0-9a-f]{40}\t/.test(entry)) throw new Error(`SOP resource disable source must be a regular Git blob: ${relative}`);
      return runGit(repositoryRoot, ['show', `${manifest.source_git_sha}:${relative}`]);
    };
    const provenance = JSON.parse(committed(manifest.resourceDisable.provenance.source_path));
    for (const file of SOURCE_FILES) equal(sha256Bytes(committed(file)), provenance.sources[file], `committed source ${file}`);
    const frozen = String(runGit(repositoryRoot, ['ls-tree', '--name-only', `${manifest.source_git_sha}:${SOP_RESOURCE_SOURCE}`], 'utf8')).trim().split('\n').sort();
    equal(frozen, [...Object.values(descriptors(manifest)), ...Object.values(manifest.legacyV11.members)].map(d => d.file).sort(), 'frozen source member closure');
  }

  function verifyPredecessor(directory, manifest, predecessorDirectory) {
    verifyLegacy(directory, manifest, predecessorDirectory);
  }
  return { validateManifest, verifyReferences, verifySource, verifyPredecessor };
}
