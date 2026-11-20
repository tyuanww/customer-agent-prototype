import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ID = 'cs-ai-c11-openapi-1.31.0-schema-1.36-6124b4cc4e29';
const SOURCE_SHA = '6124b4cc4e290b6b94830136ab2c8604fe6ad2c8';
const MANIFEST_SHA256 = '8cee71ae04449fd33bb4edb25095ba984d75d9394c9c6bfc3096e274e9553bd4';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEADER = 'X-Intake-Contract-Set';
const VIEWS = {
  '/v1/sop/candidate-queries': ['W5SopCandidateDiscoverRequest', 'W5SopCandidateDiscoverResponse'],
  '/v1/sop/candidate-selections': ['W5SopCandidateSelectRequest', 'MenokinSopQuerySopReadyResponse'],
};
const DESCRIPTORS = {
  openapi: { file: 'openapi.v1.yaml', version: '1.31.0' },
  database: { file: 'schema-v1.36.sql', version: 'schema.v1.36' },
  storage: { file: 'w5-storage.v1.sql', version: '1' },
  authorization: { file: 'authorization.v1.json' },
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function directoryAt(parent, name) {
  const directory = path.join(parent, name);
  assert.ok(lstatSync(directory).isDirectory(), `Expected a W5 contract directory: ${directory}`);
  return directory;
}

function read(directory, name) {
  const file = path.join(directory, name);
  assert.ok(lstatSync(file).isFile(), `Expected a regular W5 contract member: ${file}`);
  return readFileSync(file);
}

function exactMember(directory, descriptor, expected) {
  const { bytes, sha256, ...identity } = descriptor;
  assert.deepEqual(identity, expected, 'W5 member identity');
  const member = read(directory, expected.file);
  assert.equal(member.length, bytes, `W5 member size: ${expected.file}`);
  assert.equal(hash(member), sha256, `W5 member SHA-256: ${expected.file}`);
  return member;
}

function verifyPredecessor(upstream, predecessor) {
  const lock = JSON.parse(read(upstream, 'sop-resource-disable-corrected-contract-set.lock.json'));
  assert.equal(lock.contract_set_id, predecessor.contractSetId, 'W5 predecessor contract-set ID');
  assert.equal(lock.source_git_sha, predecessor.sourceGitSha, 'W5 predecessor source SHA');
  const directory = directoryAt(upstream, predecessor.contractSetId);
  const manifestBytes = read(directory, 'contract-set.json');
  assert.equal(hash(manifestBytes), lock.manifest_sha256, 'W5 predecessor manifest SHA-256');
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.contract_set_id, predecessor.contractSetId, 'W5 predecessor manifest ID');
  assert.equal(manifest.source_git_sha, predecessor.sourceGitSha, 'W5 predecessor manifest source SHA');
  assert.equal(manifest.openapi.version, predecessor.openapiVersion, 'W5 predecessor OpenAPI version');
  assert.equal(manifest.database.version, predecessor.databaseVersion, 'W5 predecessor database version');

  const descriptors = [manifest.openapi, manifest.database, manifest.resourceDisable.query];
  const members = Object.fromEntries(Object.entries(predecessor.sha256).map(([file, sha256]) => {
    const member = read(directory, file);
    const descriptor = descriptors.find(descriptor => descriptor.file === file);
    assert.equal(descriptor?.sha256, sha256, `W5 predecessor descriptor: ${file}`);
    assert.equal(member.length, descriptor.bytes, `W5 predecessor size: ${file}`);
    assert.equal(hash(member), sha256, `W5 predecessor SHA-256: ${file}`);
    return [file, member];
  }));
  assert.equal(lock.openapi_sha256, predecessor.sha256['openapi.v1.yaml']);
  assert.equal(lock.database_sha256, predecessor.sha256['schema-v1.35.sql']);
  return members;
}

function verifyOpenApi(openapi, predecessor, predecessorId) {
  assert.equal(openapi.info.version, DESCRIPTORS.openapi.version);
  assert.deepEqual(openapi['x-w5-companion-contract'], {
    predecessorContractSetId: predecessorId,
    candidateRoutes: Object.keys(VIEWS),
    underlyingProofContractSetId: predecessorId,
  });
  for (const [route, [input, output]] of Object.entries(VIEWS)) {
    const { post } = openapi.paths[route];
    const requestHeader = post.parameters.find(parameter => parameter.name === HEADER);
    const response = post.responses['200'];
    const responseHeader = response.headers[HEADER];
    const pattern = String.raw`^cs-ai-c11-openapi-1\.31\.0-schema-1\.36-[0-9a-f]{12}$`;
    assert.equal(requestHeader.in, 'header');
    assert.equal(requestHeader.required, true);
    assert.equal(requestHeader.schema.pattern, pattern);
    assert.equal(responseHeader.required, true);
    assert.equal(responseHeader.schema.pattern, pattern);
    assert.ok(new RegExp(pattern, 'u').test(ID));
    assert.equal(post.requestBody.content['application/json'].schema.$ref, `#/components/schemas/${input}`);
    assert.equal(response.content['application/json'].schema.$ref, `#/components/schemas/${output}`);
  }

  const schemas = Object.fromEntries(Object.entries(openapi.components.schemas)
    .filter(([name]) => name.startsWith('W5SopCandidate')));
  const original = structuredClone(openapi);
  delete original['x-w5-companion-contract'];
  original.info.version = predecessor.info.version;
  for (const route of Object.keys(VIEWS)) delete original.paths[route];
  for (const name of Object.keys(schemas)) delete original.components.schemas[name];
  assert.deepEqual(original, predecessor, 'W5 changed the predecessor OpenAPI');
  // The frozen operation description requires uniqueness by reference, in addition
  // to the response schema's existing full-object uniqueness.
  schemas.W5SopCandidateDiscoverResponse.oneOf[0].properties.candidates['x-unique-by'] = 'candidate_ref';
  return { openapi: openapi.openapi, info: openapi.info, paths: {}, components: { schemas } };
}

/** Verifies the immutable export against its independent manifest pin and local v12 bytes. */
export function verifySopCandidateContractSet({ projectRoot = PROJECT_ROOT, expectedContractSetId } = {}) {
  if (expectedContractSetId !== undefined) assert.equal(expectedContractSetId, ID, 'W5 contract-set ID');
  const contracts = directoryAt(projectRoot, 'contracts');
  const upstream = directoryAt(directoryAt(contracts, 'upstream'), 'customer-agent');
  const directory = directoryAt(upstream, ID);
  const manifestBytes = read(directory, 'contract-set.json');
  assert.equal(hash(manifestBytes), MANIFEST_SHA256, 'W5 manifest SHA-256');
  const manifest = JSON.parse(manifestBytes);
  const { openapi, database, storage, authorization, predecessor, ...identity } = manifest;
  assert.deepEqual(identity, {
    schema: 'customer-agent-w5-contract-set/v1', status: 'SYNTHETIC_EXPORT',
    contract_set_id: ID, source_repository: 'ai-赋能立项', source_git_sha: SOURCE_SHA,
    ddev_authorized: false, runtime_activated: false,
  });
  assert.deepEqual(readdirSync(directory).sort(), ['contract-set.json', ...Object.values(DESCRIPTORS).map(entry => entry.file)].sort(),
    'W5 contract member set');
  const members = Object.fromEntries(Object.entries({ openapi, database, storage, authorization })
    .map(([key, descriptor]) => [key, exactMember(directory, descriptor, DESCRIPTORS[key])]));
  assert.deepEqual(JSON.parse(members.authorization), {
    schema: 'customer-agent-w5-export-authorization/v1', status: 'APPROVED', scope: 'synthetic-contract-export',
    predecessor_contract_set_id: predecessor.contractSetId,
    versions: { openapi: openapi.version, database: database.version },
    sha256: { openapi: openapi.sha256, database: database.sha256, storage: storage.sha256 },
  });
  const previous = verifyPredecessor(upstream, predecessor);
  assert.ok(members.database.equals(Buffer.concat([
    Buffer.from('-- schema.v1.36 cumulative reference. Apply w5-storage.v1.sql after the verified predecessor.\n'),
    previous['schema-v1.35.sql'], Buffer.from('\n'), members.storage,
  ])), 'W5 database does not preserve exact predecessor bytes and storage delta');
  const schemaView = verifyOpenApi(JSON.parse(members.openapi), JSON.parse(previous['openapi.v1.yaml']), predecessor.contractSetId);
  return {
    summary: { status: 'VERIFIED', contract_set_id: ID, source_git_sha: SOURCE_SHA,
      manifest_sha256: MANIFEST_SHA256, ddev_authorized: false, runtime_activated: false },
    manifest, manifestBytes, schemaView, storageSql: members.storage.toString('utf8'),
  };
}
