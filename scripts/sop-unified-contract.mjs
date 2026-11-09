import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const SOP_UNIFIED_SCHEMA = 'customer-agent-contract-set/v10';
export const SOP_UNIFIED_LOCK = 'sop-unified-contract-set.lock.json';
export const SOP_UNIFIED_CONSUMPTION_SCHEMA = 'customer-agent-sop-unified-contract-consumption/v1';
export const SOP_UNIFIED_SOURCE = 'business-docs/01-客服Agent项目/30-开发-进行中/content-intake-sop-unified-v1';
export const SOP_UNIFIED_INPUT = 'business-docs/01-客服Agent项目/30-开发-进行中/sop-unified-candidate';
export const SOP_UNIFIED_SOURCE_FILES = [
  'business-docs/08-工具/build_customer_agent_sop_unified_contract.mjs',
  'business-docs/08-工具/build_customer_agent_sop_query_contract_candidate.mjs',
  'business-docs/08-工具/build_customer_agent_sop_graph_candidate.mjs',
  `${SOP_UNIFIED_INPUT}/source.json`, `${SOP_UNIFIED_INPUT}/authorization.source.json`,
  `${SOP_UNIFIED_INPUT}/query.source.json`, `${SOP_UNIFIED_INPUT}/storage.patch.sql`,
];
export const SOP_UNIFIED_MEMBERS = Object.freeze({
  openapi: ['openapi.v1.yaml', '1.29.0'], database: ['schema-v1.33.sql', 'schema.v1.33'],
  storage: ['storage.v1.sql', '1'], installation: ['installation.v1.json', '1'],
  provenance: ['provenance.v1.json', '1'], predecessor: ['predecessor-lock.v1.json', '1'],
  compatibility: ['compatibility.v1.json', '1'], coverage: ['operation-coverage.v1.json', '1'],
  legacyIntake: ['legacy-openapi.v7.yaml', '7'], legacyQuery: ['legacy-query.openapi.v1.json', '1'],
  query: ['query-transport.v1.json', '1'], authorization: ['authorization.v1.json', '1'],
});
// Independently checked against the accepted 0fb commit, not package-supplied anchors.
export const SOP_UNIFIED_SOURCE_LOCK = {
  "schema": "customer-agent-sop-unified-source/v1",
  "versions": {
    "openapi": "1.29.0",
    "database": "schema.v1.33",
    "profile": "content-intake-sop-unified-v1"
  },
  "sourceGitSha": "0fb1dc76ee2b84fda4a82025c081eea7dd697534",
  "model": {
    "directory": "business-docs/01-客服Agent项目/30-开发-进行中/content-intake-sop-task-graph-compat-v4",
    "members": {
      "compatibility.v4.json": "cbda94cc1817c31897c82d9cfb19516e4ca9c3cd5bbb58ff7104c397506a48aa",
      "installation.v4.json": "3164cc4900a7ca89af940b810a4a12b3ff957328da5cb627437caded3950af3a",
      "legacy-openapi.v7.yaml": "9bc9071cb36ad75c0f0131aeb5648c477e26580579769bf1090a3e2a5f2d38b5",
      "openapi.v1.yaml": "4c7a92d8f357bf79eb27d4e9e8f120a3555c3ebf8583e6b55a19ceac1fcaa805",
      "operation-coverage.v4.json": "41b65c42d2b62e6a0de020428c931fd16e0a1986f82ec77442753c33574c603f",
      "provenance.v4.json": "969630c7901c6ece24a49eb22fffdf0f1462110b463df5de2ced326b31f4d7da",
      "schema-v1.32.sql": "c050492b331fe8e40ae81bd35113c45d93a1cb91f867ed448f79d1b4d14a425a",
      "storage.v4.sql": "9dd191ab78fd1dd53a26aa743d138f5c80d0e22a790d7baf15110d916a303110"
    }
  },
  "legacyQuery": {
    "directory": "business-docs/01-客服Agent项目/30-开发-进行中/content-intake-sop-query-v1",
    "members": {
      "approval.v1.json": "9292d302dc7881acaad21c312cc81df326c2e38541d8edaef52a704effdeb065",
      "installation.v1.json": "5561da9e98147331d57329bb0f6b4c856b31622f4316fdec3d0be8aee33c26d3",
      "openapi.v1.yaml": "9f8b09c7577f17df25a17854d99cbd50f055b8cfcde4810276cf1a8f8fab5cc1",
      "predecessor-lock.v1.json": "1f8c4a8e68458a28764ef622198870c430d5ffdc6299e397182b8b66c796228c",
      "provenance.v1.json": "acc3d10d9672731eda67c36390bc4b5e1ae88cd15fc0971cbc50890f25c14fd8",
      "rules.v1.json": "d73d5073c73e0bf5a8b1093ae35285e53bb37583b59ef65ead86dff37546451f",
      "schema-v1.30.sql": "29af409df12f6ea511261812591d449deb2a1b11f9777af11c8a3a4800c167b8",
      "shapes.v1.json": "e2dde63c43f28f21b2b88eb64a50b8457e8aa763835fe2e14e29e9904e0002ba",
      "storage.v1.sql": "623202dc1248ee9d3be1bbf6f7f6ebf43438c07ff65094bcd7365e4c9c2016fe"
    },
    "fragment": "business-docs/01-客服Agent项目/30-开发-进行中/sop-query-candidate/openapi.fragment.json",
    "leaseStorage": "business-docs/01-客服Agent项目/30-开发-进行中/sop-query-candidate/storage.fragment.sql",
    "fragmentSha256": "ba93b2c29dd9e21829355252427016a649707278102aedbc649017f608f00dc9",
    "leaseStorageSha256": "9ffca2f73ed97118848ccaf4829308578e8ef83b482cdd90dc8fa066bf21fea6"
  },
  "schemaPredecessor": {
    "directory": "business-docs/01-客服Agent项目/30-开发-进行中/content-intake-readiness-successor-v1",
    "sourceGitSha": "75e1889efee91322dab1dfa28aadc53fd718682b",
    "contractSetId": "cs-ai-c11-openapi-1.24.0-schema-1.29-75e1889efee9"
  }
};
const AUTHORIZATION = {
  "schema": "customer-agent-sop-unified-authorization/v1",
  "status": "APPROVED",
  "evidenceId": "EVD-SOP-UNIFIED-TECHNICAL-20261109",
  "decisionDate": "2026-11-09",
  "authority": "Project owner conversation authorizes continuing the full SOP closeout, AI technical recommendations and author self-review.",
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
const VERSIONS = SOP_UNIFIED_SOURCE_LOCK.versions;
const HASH = /^[0-9a-f]{64}$/;
const QUERY_VIEWS = {
  route: '/v1/sop/query', header: 'X-Intake-Contract-Set', required: true,
  legacyContractSetId: 'cs-ai-c11-openapi-1.25.0-schema-1.30-0fb1dc76ee2b',
  legacySchemaFile: 'legacy-query.openapi.v1.json', successorContractSetId: 'deployment-manifest-exact-id',
  successorSchemaFile: 'query-transport.v1.json',
  legacyUnrepresentable: 'blocked with GRAPH_UNRESOLVED; preserve complete knowledge and task semantics in the unified view',
  statuses: ['ready', 'blocked', 'stale', 'no_match'], legacySearchSopBehavior: '503-fail-closed',
};
const REQUIREMENTS = [
  'Append after the product-verified immutable migration prefix. Reject a pre-existing incompatible graph installation before any mutation.',
  'Use the existing candidate, source confirmation, full graph quality, publication and rollback transaction owners.',
  'Bind graph dependencies, entry permission facts and media previews at the exact material and graph digests. Unknown source facts stay blocked.',
  'The query response carries complete tasks, knowledge, requirements and script relationships. Ready permission facts must cover all exact entries once.',
  'Check preview node/resource/release/lease identity and expiry. Required media failure blocks actions and copy.',
  'Verify every declared legacy view, request deadline, revocation, continuation and byte budget through the actual API and Main consumers.',
];
const PATCH = `-- The candidate, original publication and graph must belong to one history.
-- Inheritance and rollback retain the original candidate and publication.
ALTER TABLE content_intake.sop_graph_release_lineage
  ADD CONSTRAINT sop_graph_original_publication_fk
  FOREIGN KEY (candidate_id,candidate_version)
  REFERENCES content_intake.publications(candidate_id,candidate_version)
  DEFERRABLE INITIALLY DEFERRED;

REVOKE ALL ON FUNCTION content_intake.issue_sop_query_lease(TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,BIGINT) FROM app_runtime;
REVOKE ALL ON FUNCTION content_intake.validate_sop_query_lease(TEXT,TEXT,TEXT,UUID,BIGINT) FROM app_runtime;
`;
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function equal(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`SOP unified ${label} mismatch`);
}

function mergedOpenapi(baseline, query) {
  const api = structuredClone(baseline);
  const names = new Map(['schemas', 'responses'].flatMap(group =>
    Object.keys(query.components[group]).map(name => [`#/components/${group}/${name}`, `#/components/${group}/MenokinSopQuery${name}`])));
  const rewrite = value => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)]));
    return names.get(value) ?? value;
  };
  if (api.paths['/v1/sop/query']) throw new Error('SOP unified predecessor already has query route');
  for (const group of ['schemas', 'responses']) {
    for (const [name, value] of Object.entries(query.components[group])) {
      const target = `MenokinSopQuery${name}`;
      if (api.components[group][target]) throw new Error('SOP unified query component collision');
      api.components[group][target] = rewrite(value);
    }
  }
  for (const [name, scheme] of Object.entries(query.components.securitySchemes ?? {})) {
    if (!api.components.securitySchemes[name]) api.components.securitySchemes[name] = structuredClone(scheme);
  }
  api.paths['/v1/sop/query'] = rewrite(query.paths['/v1/sop/query']);
  api.info.description += '\nIndependent Menokin SOP positive query transport is included in this contract set; /v1/search remains SOP fail-closed.';
  api.info['x-business-contract-set-id'] = 'menokin-sop-query-v1';
  api.info.version = VERSIONS.openapi;
  api.info.description += '\nUnified task graph implementation contract with full original-query compatibility. Runtime activation and business mapping remain separately evidenced.';
  api['x-sop-query-views'] = QUERY_VIEWS;
  api['x-contract-set-negotiation'].status = 'IMPLEMENTATION_APPROVED_CANDIDATE';
  api['x-sop-graph-contract'].publication.originalPublicationRequired = true;
  return api;
}

function verifyQuery(query, legacy, assertExactKeys) {
  const schemas = query.components?.schemas;
  const ready = schemas?.SopReadyResult;
  const permission = schemas?.SopEntryPermission;
  const ref = name => ({ $ref: `#/components/schemas/${name}` });
  equal(ready, {
    type: 'object', additionalProperties: false, required: ['flow', 'graph_digest', 'entries', 'media', 'permissions'],
    properties: {
      graph_digest: ref('IntakeSopHash'),
      flow: ref('IntakeSopFlowDefinition'),
      entries: { type: 'array', maxItems: 4096, items: {
        type: 'object', additionalProperties: false, required: ['sourceId', 'entry'],
        properties: { sourceId: ref('IntakeSopId'), entry: ref('IntakePublishedEntry') },
      } },
      media: { type: 'array', maxItems: 500, items: {
        type: 'object', additionalProperties: false, required: ['binding', 'preview_handle', 'expires_at'],
        properties: { binding: ref('IntakeSopMedia'), preview_handle: { type: 'string', minLength: 1, maxLength: 256 },
          expires_at: { type: 'string', format: 'date-time' } },
      } },
      permissions: { type: 'array', maxItems: 4096, items: ref('SopEntryPermission') },
    },
  }, 'complete query result');
  equal(permission, {
    type: 'object', additionalProperties: false, required: ['entry', 'risk_level', 'copy_allowed', 'source_ref'],
    properties: { entry: ref('IntakeSopEntryRef'), risk_level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      copy_allowed: { type: 'boolean' }, source_ref: { type: 'string', minLength: 1, maxLength: 1024 } },
  }, 'entry permission facts');
  equal(schemas.SopEmptyResult, {
    type: 'object', additionalProperties: false, required: ['flow', 'entries', 'media', 'permissions'],
    properties: { flow: { type: 'null' }, entries: { type: 'array', maxItems: 0 },
      media: { type: 'array', maxItems: 0 }, permissions: { type: 'array', maxItems: 0 } },
  }, 'empty query result');
  const expected = structuredClone(legacy);
  expected.info.version = VERSIONS.openapi;
  expected.paths['/v1/sop/query'].post.description += ' The unified view returns the complete task graph, exact FAQ dependencies, media bindings and entry-level permission facts. Unclassified risk, unresolved source facts or missing required preview bindings yield blocked. Ready permissions cover the exact graph dependencies once. Legacy query view remains bound to its original exact contract ID.';
  expected.paths['/v1/sop/query'].post['x-max-response-bytes'] = 1048576;
  for (const name of ['SopNode', 'SopBranch', 'SopMessage', 'SopMediaRef']) delete expected.components.schemas[name];
  Object.assign(expected.components.schemas, { SopReadyResult: ready, SopEmptyResult: schemas.SopEmptyResult, SopEntryPermission: permission });
  assertExactKeys(query.paths, ['/v1/sop/query'], 'SOP unified query routes');
  equal(query, expected, 'query source transport');
}

/** The host owns filesystem/Git safety and atomic installation. This profile
 * owns the closed unified contract and reconstruction from independently pinned inputs. */
export function createSopUnifiedProfile({ assertExactKeys, validateDescriptor, readJson, sha256Bytes, runGit }) {
  const descriptors = manifest => ({ openapi: manifest.openapi, database: manifest.database, ...manifest.sopUnified });
  const read = (directory, manifest, key) => readJson(path.join(directory, descriptors(manifest)[key].file), `SOP unified ${key}`);

  function validateManifest(manifest) {
    assertExactKeys(manifest, ['schema', 'contract_set_id', 'source_repository', 'source_git_sha',
      'architecture_version', 'implementation_version', 'openapi', 'database', 'sopUnified'], 'SOP unified manifest');
    equal(manifest.schema, SOP_UNIFIED_SCHEMA, 'manifest schema');
    if (manifest.source_repository !== 'ai-赋能立项' || typeof manifest.source_git_sha !== 'string' || !/^[0-9a-f]{40}$/.test(manifest.source_git_sha)
      || manifest.contract_set_id !== `cs-ai-c11-openapi-1.29.0-schema-1.33-${manifest.source_git_sha.slice(0, 12)}`
      || manifest.architecture_version !== '1.16' || manifest.implementation_version !== '1.22') {
      throw new Error('SOP unified manifest identity is invalid');
    }
    assertExactKeys(manifest.sopUnified, Object.keys(SOP_UNIFIED_MEMBERS).filter(key => !['openapi', 'database'].includes(key)), 'SOP unified artifacts');
    for (const [key, descriptor] of Object.entries(descriptors(manifest))) {
      validateDescriptor(descriptor, `SOP unified ${key}`);
      const [file, version] = SOP_UNIFIED_MEMBERS[key];
      equal({ version: descriptor.version, file: descriptor.file, source_path: descriptor.source_path },
        { version, file, source_path: `${SOP_UNIFIED_SOURCE}/${file}` }, `${key} descriptor`);
    }
    return manifest;
  }

  function verifyReferences(directory, manifest) {
    equal(read(directory, manifest, 'predecessor'), SOP_UNIFIED_SOURCE_LOCK, 'fixed predecessor source');
    equal(read(directory, manifest, 'authorization'), AUTHORIZATION, 'authorization');
    const installation = read(directory, manifest, 'installation');
    assertExactKeys(installation, ['schema', 'status', 'versions', 'predecessor', 'modelInstallation', 'queryTransport',
      'migrationPosition', 'runnableMigration', 'runtimeActivated', 'productionConsumerReady', 'requirements'], 'SOP unified installation');
    equal({ ...installation, modelInstallation: null }, {
      schema: 'customer-agent-sop-unified-installation/v1', status: 'IMPLEMENTATION_APPROVED_CANDIDATE',
      versions: VERSIONS, predecessor: SOP_UNIFIED_SOURCE_LOCK.schemaPredecessor, modelInstallation: null,
      queryTransport: QUERY_VIEWS, migrationPosition: null, runnableMigration: false,
      runtimeActivated: false, productionConsumerReady: false, requirements: REQUIREMENTS,
    }, 'installation boundary');
    const provenance = read(directory, manifest, 'provenance');
    assertExactKeys(provenance, ['schema', 'status', 'versions', 'formalVersionAssigned', 'sourceGitSha',
      'authorizationEvidenceId', 'sources', 'artifacts', 'runtimeActivated', 'businessMappingApproved'], 'SOP unified provenance');
    equal({ ...provenance, sources: null, artifacts: null }, {
      schema: 'customer-agent-sop-unified-candidate/v1', status: 'IMPLEMENTATION_APPROVED_CANDIDATE', versions: VERSIONS,
      formalVersionAssigned: true, sourceGitSha: null, authorizationEvidenceId: AUTHORIZATION.evidenceId,
      sources: null, artifacts: null, runtimeActivated: false, businessMappingApproved: false,
    }, 'provenance boundary');
    assertExactKeys(provenance.sources, SOP_UNIFIED_SOURCE_FILES, 'SOP unified provenance sources');
    for (const digest of Object.values(provenance.sources)) if (typeof digest !== 'string' || !HASH.test(digest)) throw new Error('SOP unified source hash is invalid');
    const artifacts = Object.entries(descriptors(manifest)).filter(([key]) => key !== 'provenance').map(([, descriptor]) => descriptor);
    equal(provenance.artifacts, Object.fromEntries(artifacts.map(d => [d.file, { sha256: d.sha256, bytes: d.bytes }])), 'provenance artifacts');
    for (const [input, key] of [['source.json', 'predecessor'], ['authorization.source.json', 'authorization'], ['query.source.json', 'query']]) {
      equal(provenance.sources[`${SOP_UNIFIED_INPUT}/${input}`], manifest.sopUnified[key].sha256, `${key} source hash`);
    }
    equal(provenance.sources[`${SOP_UNIFIED_INPUT}/storage.patch.sql`], sha256Bytes(Buffer.from(PATCH)), 'storage patch hash');
    equal(manifest.sopUnified.legacyIntake.sha256, SOP_UNIFIED_SOURCE_LOCK.model.members['legacy-openapi.v7.yaml'], 'legacy intake bytes');
    equal(manifest.sopUnified.legacyQuery.sha256, SOP_UNIFIED_SOURCE_LOCK.legacyQuery.fragmentSha256, 'legacy query bytes');
    const query = read(directory, manifest, 'query');
    verifyQuery(query, read(directory, manifest, 'legacyQuery'), assertExactKeys);
    const api = read(directory, manifest, 'openapi');
    equal(api.info?.version, VERSIONS.openapi, 'OpenAPI version');
    equal(api['x-sop-query-views'], QUERY_VIEWS, 'query views');
    equal(api['x-contract-set-negotiation']?.status, 'IMPLEMENTATION_APPROVED_CANDIDATE', 'negotiation status');
    equal(api['x-sop-graph-contract']?.publication.originalPublicationRequired, true, 'original publication requirement');
    for (const key of ['compatibility', 'coverage']) {
      const value = read(directory, manifest, key);
      assertExactKeys(value, key === 'compatibility' ? ['schema', 'intake', 'query'] : ['intake', 'query'], `SOP unified ${key}`);
      if (key === 'compatibility') equal(value.schema, 'customer-agent-sop-unified-compatibility/v1', 'compatibility schema');
      equal(value.query, QUERY_VIEWS, `${key} query views`);
    }
  }

  function verifySource(repositoryRoot, manifest) {
    const committed = relative => {
      const entry = String(runGit(repositoryRoot, ['ls-tree', manifest.source_git_sha, '--', relative], 'utf8')).trim();
      if (!/^100(?:644|755) blob [0-9a-f]{40}\t/.test(entry)) throw new Error(`SOP unified source must be a regular Git blob: ${relative}`);
      return runGit(repositoryRoot, ['show', `${manifest.source_git_sha}:${relative}`]);
    };
    const artifact = key => committed(descriptors(manifest)[key].source_path);
    const parsed = key => JSON.parse(artifact(key));
    const provenance = parsed('provenance');
    for (const relative of SOP_UNIFIED_SOURCE_FILES) equal(sha256Bytes(committed(relative)), provenance.sources[relative], `source provenance ${relative}`);
    equal(JSON.parse(committed(`${SOP_UNIFIED_INPUT}/source.json`)), SOP_UNIFIED_SOURCE_LOCK, 'source declaration');
    equal(committed(`${SOP_UNIFIED_INPUT}/source.json`), artifact('predecessor'), 'committed source lock');
    equal(committed(`${SOP_UNIFIED_INPUT}/authorization.source.json`), artifact('authorization'), 'committed authorization');
    const queryBytes = committed(`${SOP_UNIFIED_INPUT}/query.source.json`);
    equal(queryBytes, artifact('query'), 'committed query source');
    const patch = committed(`${SOP_UNIFIED_INPUT}/storage.patch.sql`);
    equal(patch, Buffer.from(PATCH), 'committed storage patch');
    const locked = group => Object.fromEntries(Object.entries(SOP_UNIFIED_SOURCE_LOCK[group].members).map(([file, digest]) => {
      const bytes = committed(`${SOP_UNIFIED_SOURCE_LOCK[group].directory}/${file}`);
      equal(sha256Bytes(bytes), digest, `source predecessor ${group}/${file}`);
      return [file, bytes];
    }));
    const model = locked('model');
    locked('legacyQuery');
    const legacy = committed(SOP_UNIFIED_SOURCE_LOCK.legacyQuery.fragment);
    const lease = committed(SOP_UNIFIED_SOURCE_LOCK.legacyQuery.leaseStorage);
    equal(sha256Bytes(legacy), SOP_UNIFIED_SOURCE_LOCK.legacyQuery.fragmentSha256, 'source legacy fragment');
    equal(sha256Bytes(lease), SOP_UNIFIED_SOURCE_LOCK.legacyQuery.leaseStorageSha256, 'source legacy lease');
    equal(artifact('legacyQuery'), legacy, 'legacy query sidecar');
    equal(artifact('legacyIntake'), model['legacy-openapi.v7.yaml'], 'legacy intake sidecar');
    const api = mergedOpenapi(JSON.parse(model['openapi.v1.yaml']), JSON.parse(queryBytes));
    equal(artifact('openapi'), json(api), 'rebuilt v4 and query OpenAPI');
    const leaseSql = lease.toString().replace(/^BEGIN;[ \t]*\r?\n/m, '').replace(/\s*COMMIT;\s*$/, '').replaceAll("'15 minutes'", "'5 minutes'");
    equal(artifact('storage'), Buffer.concat([model['storage.v4.sql'], Buffer.from(leaseSql), patch]), 'storage composition');
    equal(artifact('database'), Buffer.concat([
      Buffer.from('-- schema.v1.33 unified SOP reference. Cumulative, not a runnable product migration.\n'),
      model['schema-v1.32.sql'], Buffer.from(leaseSql), patch,
    ]), 'DDL composition');
    equal(parsed('installation').modelInstallation, JSON.parse(model['installation.v4.json']), 'v4 installation');
    equal(parsed('compatibility').intake, JSON.parse(model['compatibility.v4.json']), 'v4 compatibility');
    equal(parsed('coverage').intake, JSON.parse(model['operation-coverage.v4.json']), 'v4 operation coverage');
    const frozenFiles = String(runGit(repositoryRoot, ['ls-tree', '--name-only', `${manifest.source_git_sha}:${SOP_UNIFIED_SOURCE}`], 'utf8')).trim().split('\n').sort();
    equal(frozenFiles, Object.values(descriptors(manifest)).map(d => d.file).sort(), 'committed frozen members');
  }

  function verifyPredecessor(manifest) {
    equal(manifest.schema, 'customer-agent-contract-set/v8', 'product predecessor schema');
    equal(manifest.source_git_sha, SOP_UNIFIED_SOURCE_LOCK.sourceGitSha, 'product predecessor SHA');
    equal(manifest.contract_set_id, QUERY_VIEWS.legacyContractSetId, 'product predecessor identity');
    equal(Object.fromEntries([manifest.openapi, manifest.database, ...Object.values(manifest.sopGraph)]
      .map(d => [d.file, d.sha256])), SOP_UNIFIED_SOURCE_LOCK.legacyQuery.members, 'product predecessor hashes');
  }

  return { validateManifest, verifyReferences, verifySource, verifyPredecessor };
}
