import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildGeneratedArtifacts } from '../packages/contracts/scripts/generate-contracts.mjs';
import { ingestContractSet, verifyContractSetDirectory, verifyIngestedContractSet, verifyIngestedTaskGraph, verifyTaskGraphHistoricalInputs, verifyTaskGraphProducerBlobs, verifyTaskGraphReviewAnchor, withVerifiedContractSetSnapshot } from './customer-agent-contract-set.mjs';
import { TASK_GRAPH_APPROVAL, TASK_GRAPH_CANDIDATE, TASK_GRAPH_HISTORY_CANDIDATE, TASK_GRAPH_LOCK, TASK_GRAPH_MEMBERS, TASK_GRAPH_SOURCE,
  TASK_GRAPH_PRODUCER_HASHES, assertProducerFingerprints, verifyTaskGraphPredecessor, verifyTaskGraphReferences } from './sop-task-graph-contract.mjs';
import { READINESS_SOURCE } from './readiness-contract.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const upstream = 'contracts/upstream/customer-agent';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const id = (api, db, sha) => `cs-ai-c11-openapi-${api}-schema-${db}-${sha.slice(0, 12)}`;
const write = (file, content) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content); };
const descriptor = (source_path, file, version, bytes) => ({ version, source_path, file, sha256: hash(bytes), bytes: Buffer.byteLength(bytes) });
const versions = { openapi: '1.27.0', database: 'schema.v1.32', profile: 'content-intake-sop-task-graph-v3' };
const artifactNames = { openapi: 'openapi.candidate.yaml', database: 'schema.candidate.sql', storage: 'storage.candidate.sql', installation: 'installation.candidate.json' };
const proofRequired = /Task graph trusted source reconstruction proof is required/;
const historicalRequired = /historical source does not match the designated historical candidate/;

const syntheticBuilderOne = "export const marker = 'synthetic-only';\n";
const syntheticBuilderTwo = "import { marker } from './build_customer_agent_sop_graph_candidate.mjs'; export { marker };\n";

function syntheticResumeBuilder(historySha) {
  return `import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marker as one } from './build_customer_agent_sop_graph_candidate.mjs';
import { marker as two } from './build_customer_agent_sop_task_graph_candidate.mjs';
assert.equal(one, 'synthetic-only'); assert.equal(two, one);
assert.deepEqual(process.argv.slice(2), ['--check']);
const root = fileURLToPath(new URL('../../', import.meta.url));
const candidate = ${JSON.stringify(TASK_GRAPH_CANDIDATE)};
const history = ${JSON.stringify(historySha)};
const git = (revision, relative) => execFileSync('git', ['show', revision + ':' + relative], { cwd: root });
const read = name => readFileSync(path.join(root, candidate, name));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\\n';
for (const name of ['build_customer_agent_sop_graph_candidate.mjs', 'build_customer_agent_sop_task_graph_candidate.mjs']) {
  const relative = 'business-docs/08-工具/' + name;
  assert.deepEqual(readFileSync(path.join(root, relative)), git(history, relative));
}
const predecessorBytes = git(history, ${JSON.stringify(`${TASK_GRAPH_HISTORY_CANDIDATE}/predecessor.source.json`)});
const predecessor = JSON.parse(predecessorBytes);
const approvalBytes = git(history, ${JSON.stringify(TASK_GRAPH_APPROVAL)});
const approval = JSON.parse(approvalBytes);
const beforeApi = git(predecessor.sourceGitSha, predecessor.artifacts['openapi.v1.yaml'].path);
const beforeDb = git(predecessor.sourceGitSha, predecessor.artifacts['schema-v1.29.sql'].path);
assert.equal(hash(beforeApi), predecessor.artifacts['openapi.v1.yaml'].sha256);
assert.equal(hash(beforeDb), predecessor.artifacts['schema-v1.29.sql'].sha256);
const shapesBytes = read('shapes.source.json'), rulesBytes = read('rules.source.json'), storage = read('storage.source.sql');
const shapes = JSON.parse(shapesBytes), rules = JSON.parse(rulesBytes);
const versions = ${JSON.stringify(versions)};
const files = {
  openapi: json({ openapi: '3.1.0', info: { title: shapes.syntheticTitle, version: versions.openapi }, paths: {}, components: { schemas: { SyntheticTask: { type: 'string' } } } }),
  database: '-- schema.v1.32 task-graph resume candidate; cumulative reference only.\\n' + beforeDb.toString() + '\\n-- UNIFIED SOP TASK-GRAPH CANDIDATE STORAGE DELTA\\n' + storage.toString(),
  storage: storage.toString(),
};
files.installation = json({ schema: 'customer-agent-sop-task-graph-installation/v1', status: 'CANDIDATE', proposedVersions: versions,
  runnableMigration: false, migrationPosition: null, predecessor, requiredProductWork: rules.installation, runtimeActivated: false, productionConsumerReady: false });
const names = { openapi: 'openapi.candidate.yaml', database: 'schema.candidate.sql', storage: 'storage.candidate.sql', installation: 'installation.candidate.json' };
files.provenance = json({ schema: 'customer-agent-sop-task-graph-review-candidate/v1', status: 'IMPLEMENTATION_APPROVED_CANDIDATE', proposedVersions: versions,
  historicalCandidateGitSha: history, formalVersionAssigned: false, sourceGitSha: null, predecessorGitSha: predecessor.sourceGitSha,
  approvalEvidenceId: approval.evidenceId, runtimeActivated: false, freezeCompleted: false, exportCompleted: false, approvalSha256: hash(approvalBytes),
  sources: { 'predecessor.source.json': hash(predecessorBytes), 'shapes.source.json': hash(shapesBytes), 'rules.source.json': hash(rulesBytes), 'storage.source.sql': hash(storage) },
  artifacts: Object.fromEntries(Object.entries(names).map(([key, name]) => [name, { sha256: hash(files[key]), bytes: Buffer.byteLength(files[key]) }])) });
names.provenance = 'manifest.candidate.json';
for (const [key, name] of Object.entries(names)) assert.deepEqual(read(name), Buffer.from(files[key]));
`;
}

function fixture(t, approvalKind = 'matching', { rebuild = false } = {}) {
  const temporary = realpathSync(mkdtempSync(path.join(tmpdir(), 'synthetic-task-graph-source-')));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const product = path.join(temporary, 'product');
  const source = path.join(temporary, 'source');
  const bundle = path.join(temporary, 'bundle');
  for (const dir of [product, source, bundle]) mkdirSync(dir);
  write(path.join(product, 'package.json'), json({ name: 'customer-agent-demo' }));
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = message => {
    git(['add', '--all']);
    git(['-c', 'user.name=Synthetic Test', '-c', 'user.email=fixture@example.invalid', 'commit', '--no-verify', '-qm', message]);
    return git(['rev-parse', 'HEAD']);
  };
  git(['init', '-q']);
  const beforeApi = json({ openapi: '3.1.0', info: { title: 'Synthetic predecessor', version: '1.24.0' }, paths: {}, components: { schemas: { Before: { type: 'string' } } } });
  const beforeDb = '-- synthetic predecessor schema\n';
  write(path.join(source, READINESS_SOURCE, 'openapi.v1.yaml'), beforeApi);
  write(path.join(source, READINESS_SOURCE, 'schema-v1.29.sql'), beforeDb);
  const beforeSha = commit('synthetic predecessor');
  const predecessor = { sourceGitSha: beforeSha, contractSetId: id('1.24.0', '1.29', beforeSha), artifacts: {
    'openapi.v1.yaml': { path: `${READINESS_SOURCE}/openapi.v1.yaml`, sha256: hash(beforeApi) },
    'schema-v1.29.sql': { path: `${READINESS_SOURCE}/schema-v1.29.sql`, sha256: hash(beforeDb) } } };
  const approval = { schema: 'customer-agent-sop-graph-implementation-approval/v1', status: 'APPROVED', evidenceId: 'SYNTHETIC-ONLY',
    scope: ['formal-contract-change', 'product-implementation'], runtimeActivated: false };
  const graph = {
    // Deliberately independent of the synthetic inputs: it has not been reconstructed by an authority.
    openapi: json({ openapi: '3.1.0', info: { title: 'Unproven synthetic graph', version: versions.openapi }, paths: {}, components: { schemas: { SyntheticTask: { type: 'string' } } } }),
    storage: '-- synthetic storage\n', predecessor: json(predecessor),
    shapes: json(rebuild ? { schema: 'synthetic-only', syntheticTitle: 'Unproven synthetic graph' } : { schema: 'synthetic-only' }),
    rules: json({ installation: ['synthetic obligation'] }), approval: json(approval),
  };
  write(path.join(source, TASK_GRAPH_HISTORY_CANDIDATE, 'predecessor.source.json'), graph.predecessor);
  write(path.join(source, TASK_GRAPH_HISTORY_CANDIDATE, 'shapes.source.json'), json({ schema: 'synthetic-historical-shapes' }));
  write(path.join(source, TASK_GRAPH_APPROVAL), graph.approval);
  const producerNames = Object.keys(TASK_GRAPH_PRODUCER_HASHES);
  const historyProducers = rebuild ? [syntheticBuilderOne, syntheticBuilderTwo] : producerNames.slice(0, 2).map(name => `synthetic ${name}`);
  for (const [index, name] of producerNames.slice(0, 2).entries()) write(path.join(source, 'business-docs/08-工具', name), historyProducers[index]);
  const historicalSha = commit('synthetic inherited candidate');
  graph.database = `-- schema.v1.32 task-graph resume candidate; cumulative reference only.\n${beforeDb}\n-- UNIFIED SOP TASK-GRAPH CANDIDATE STORAGE DELTA\n${graph.storage}`;
  graph.installation = json({ schema: 'customer-agent-sop-task-graph-installation/v1', status: 'CANDIDATE', proposedVersions: versions,
    runnableMigration: false, migrationPosition: null, predecessor, requiredProductWork: ['synthetic obligation'], runtimeActivated: false, productionConsumerReady: false });
  graph.provenance = json({ schema: 'customer-agent-sop-task-graph-review-candidate/v1', status: 'IMPLEMENTATION_APPROVED_CANDIDATE', proposedVersions: versions,
    historicalCandidateGitSha: historicalSha,
    formalVersionAssigned: false, sourceGitSha: null, predecessorGitSha: beforeSha, approvalEvidenceId: approval.evidenceId, runtimeActivated: false,
    freezeCompleted: false, exportCompleted: false, approvalSha256: hash(graph.approval),
    sources: { 'predecessor.source.json': hash(graph.predecessor), 'shapes.source.json': hash(graph.shapes), 'rules.source.json': hash(graph.rules), 'storage.source.sql': hash(graph.storage) },
    artifacts: Object.fromEntries(Object.entries(artifactNames).map(([key, name]) => [name, { sha256: hash(graph[key]), bytes: Buffer.byteLength(graph[key]) }])) });
  const names = { openapi: ['openapi.v1.yaml', versions.openapi], database: ['schema-v1.32.sql', versions.database], ...TASK_GRAPH_MEMBERS };
  for (const [key, [file]] of Object.entries(names)) {
    write(path.join(source, TASK_GRAPH_SOURCE, file), graph[key]);
    write(path.join(bundle, file), graph[key]);
  }
  for (const [file, key] of Object.entries({ 'openapi.candidate.yaml': 'openapi', 'schema.candidate.sql': 'database',
    'storage.candidate.sql': 'storage', 'installation.candidate.json': 'installation', 'manifest.candidate.json': 'provenance',
    'shapes.source.json': 'shapes',
    'rules.source.json': 'rules', 'storage.source.sql': 'storage' })) {
    write(path.join(source, TASK_GRAPH_CANDIDATE, file), graph[key]);
  }
  const producerContents = [...historyProducers, rebuild ? syntheticResumeBuilder(historicalSha) : `synthetic ${producerNames[2]}`];
  for (const [index, name] of producerNames.entries()) write(path.join(source, 'business-docs/08-工具', name), producerContents[index]);
  const original = path.join(source, TASK_GRAPH_APPROVAL);
  if (approvalKind === 'missing' || approvalKind === 'symlink') rmSync(original);
  if (approvalKind === 'matching') write(original, graph.approval);
  if (approvalKind === 'different') write(original, `${JSON.stringify(approval)}\n`); // Same JSON values, different bytes.
  if (approvalKind === 'symlink') { mkdirSync(path.dirname(original), { recursive: true }); symlinkSync('synthetic-target.json', original); }
  const sha = commit(`synthetic graph with ${approvalKind} original`);
  const descriptors = Object.fromEntries(Object.entries(names).map(([key, [file, version]]) => [key, descriptor(`${TASK_GRAPH_SOURCE}/${file}`, file, version, graph[key])]));
  const { openapi, database, ...sopTaskGraph } = descriptors;
  const manifest = { schema: 'customer-agent-contract-set/v9', contract_set_id: id('1.27.0', '1.32', sha), source_repository: 'ai-赋能立项', source_git_sha: sha,
    architecture_version: '1.16', implementation_version: '1.22', openapi, database, sopTaskGraph };
  write(path.join(bundle, 'contract-set.json'), json(manifest));
  return { temporary, product, source, bundle, graph, manifest, original, beforeSha, historicalSha, beforeApi, beforeDb, git, commit, producerContents,
    run: (sourceDirectory = bundle, sourceRepositoryRoot = source) => ingestContractSet({ projectRoot: product, sourceDirectory, sourceRepositoryRoot }) };
}

function writeLock(product, manifest, manifestBytes) {
  write(path.join(product, upstream, 'contract-set.lock.json'), json({ schema: 'customer-agent-contract-consumption/v1', contract_set_id: manifest.contract_set_id,
    source_repository: manifest.source_repository, source_git_sha: manifest.source_git_sha, manifest_sha256: hash(manifestBytes),
    openapi_sha256: manifest.openapi.sha256, database_sha256: manifest.database.sha256, intake_status: 'VERIFIED_NOT_ACTIVATED', ddev_authorized: false, runtime_activated: false }));
}

function syntheticBase(f) {
  const openapi = json({ openapi: '3.1.0', info: { title: 'Synthetic base', version: '1.11.0' }, paths: {}, components: { schemas: { Base: { type: 'string' } } } });
  const database = '-- synthetic base\n';
  const manifest = { schema: 'customer-agent-contract-set/v1', contract_set_id: id('1.11.0', '1.12', f.beforeSha), source_repository: 'ai-赋能立项', source_git_sha: f.beforeSha,
    architecture_version: '1.16', implementation_version: '1.22',
    openapi: descriptor('business-docs/01-客服Agent项目/20-设计-进行中/openapi.v1.yaml', 'openapi.v1.yaml', '1.11.0', openapi),
    database: descriptor('business-docs/01-客服Agent项目/20-设计-进行中/33-schema-v1-草案.sql', 'schema-v1.12.sql', 'schema.v1.12', database) };
  const dir = path.join(f.product, upstream, manifest.contract_set_id);
  write(path.join(dir, 'openapi.v1.yaml'), openapi); write(path.join(dir, 'schema-v1.12.sql'), database);
  const bytes = json(manifest); write(path.join(dir, 'contract-set.json'), bytes); writeLock(f.product, manifest, bytes);
  return manifest;
}

async function syntheticRebuildVerifier(f, reviewed = null) {
  const copy = path.join(f.temporary, reviewed ? 'synthetic-verifier-anchored' : 'synthetic-verifier');
  for (const relative of ['scripts/customer-agent-contract-set.mjs', 'scripts/readiness-contract.mjs',
    'packages/database/scripts/migration-artifact.mjs']) {
    write(path.join(copy, relative), readFileSync(path.join(root, relative)));
  }
  let module = readFileSync(path.join(root, 'scripts/sop-task-graph-contract.mjs'), 'utf8');
  const replaceOnce = (before, after) => {
    assert.equal(module.split(before).length, 2, 'synthetic verifier must replace exactly one fixed anchor');
    module = module.replace(before, after);
  };
  replaceOnce('44dc1c30f0c85249c16ff05757f1595e1a453aef', f.historicalSha);
  for (const [index, expected] of Object.values(TASK_GRAPH_PRODUCER_HASHES).entries()) {
    replaceOnce(expected, hash(f.producerContents[index]));
  }
  if (reviewed) {
    const anchors = { [reviewed.proof.source_git_sha]: { manifest_sha256: reviewed.proof.manifest_sha256, proof_sha256: reviewed.proof_sha256 } };
    const anchorPattern = /const TASK_GRAPH_REVIEWED_REBUILDS = Object\.freeze\(\{[\s\S]*?\n\}\);/;
    assert.equal(module.match(anchorPattern)?.length, 1, 'synthetic verifier must replace exactly one fixed anchor');
    module = module.replace(anchorPattern, `const TASK_GRAPH_REVIEWED_REBUILDS = Object.freeze(${JSON.stringify(anchors)});`);
  }
  write(path.join(copy, 'scripts/sop-task-graph-contract.mjs'), module);
  return import(pathToFileURL(path.join(copy, 'scripts/customer-agent-contract-set.mjs')).href);
}

test('matches original approval bytes from the exact synthetic Git commit, then rejects untrusted history', t => {
  const f = fixture(t);
  assert.equal(verifyContractSetDirectory(f.bundle).manifest.contract_set_id, f.manifest.contract_set_id);
  assert.equal(f.git(['show', `${f.manifest.source_git_sha}:${TASK_GRAPH_APPROVAL}`]), f.graph.approval.trim());
  assert.throws(() => f.run(), historicalRequired);
  const args = [path.join(root, 'scripts/customer-agent-contract-set.mjs'), 'ingest', `--project-root=${f.product}`, `--source=${f.bundle}`, `--source-repository-root=${f.source}`];
  assert.throws(() => execFileSync(process.execPath, args, { stdio: 'pipe' }), error => error.status === 1 && historicalRequired.test(error.stderr.toString()));
  assert.equal(existsSync(path.join(f.product, upstream)), false);
});

test('rejects a missing original approval in the declared Git commit', t => {
  const f = fixture(t, 'missing');
  assert.equal(verifyContractSetDirectory(f.bundle).manifest.contract_set_id, f.manifest.contract_set_id);
  assert.throws(() => f.run(), /Source Git file is not a regular blob/);
  assert.equal(existsSync(path.join(f.product, upstream)), false);
});

test('rejects an original approval with identical JSON values but different bytes', t => {
  const f = fixture(t, 'different');
  assert.deepEqual(JSON.parse(readFileSync(f.original)), JSON.parse(f.graph.approval));
  assert.notDeepEqual(readFileSync(f.original), Buffer.from(f.graph.approval));
  assert.throws(() => f.run(), /original approval does not match the frozen approval/);
  assert.equal(existsSync(path.join(f.product, upstream)), false);
});

test('rejects a Git symlink as the original approval', t => {
  const f = fixture(t, 'symlink');
  assert.match(f.git(['ls-tree', f.manifest.source_git_sha, '--', TASK_GRAPH_APPROVAL]), /^120000 blob /);
  assert.throws(() => f.run(), /Source Git file is not a regular blob/);
  assert.equal(existsSync(path.join(f.product, upstream)), false);
});

test('checks the declared commit, not a different later approval or the working tree', t => {
  const f = fixture(t);
  writeFileSync(f.original, '{"synthetic":"different"}\n');
  const later = f.commit('synthetic later change');
  assert.notEqual(later, f.manifest.source_git_sha);
  assert.throws(() => f.run(), historicalRequired);
  assert.equal(existsSync(path.join(f.product, upstream)), false);
});

test('rejects candidate inputs that differ from the committed frozen members', t => {
  const f = fixture(t);
  write(path.join(f.source, TASK_GRAPH_CANDIDATE, 'shapes.source.json'), '{"changed":true}\n');
  const sha = f.commit('synthetic source changed after freezing');
  const manifest = { ...f.manifest, source_git_sha: sha, contract_set_id: id('1.27.0', '1.32', sha) };
  writeFileSync(path.join(f.bundle, 'contract-set.json'), json(manifest));
  assert.throws(() => f.run(), /committed candidate differs from frozen member: shapes.source.json/);
  assert.equal(existsSync(path.join(f.product, upstream)), false);
});

test('rejects a source commit disconnected from the declared predecessor', t => {
  const f = fixture(t);
  f.git(['checkout', '--orphan', 'synthetic-unrelated']);
  const sha = f.commit('synthetic unrelated source');
  const manifest = { ...f.manifest, source_git_sha: sha, contract_set_id: id('1.27.0', '1.32', sha) };
  writeFileSync(path.join(f.bundle, 'contract-set.json'), json(manifest));
  assert.throws(() => f.run(), /predecessor is not an ancestor/);
  assert.equal(existsSync(path.join(f.product, upstream)), false);
});

test('Git replacement refs cannot substitute different source bytes for the declared commit', t => {
  const f = fixture(t);
  const sourceFile = path.join(f.source, TASK_GRAPH_CANDIDATE, 'shapes.source.json');
  writeFileSync(sourceFile, '{"changed":true}\n');
  const bad = f.commit('synthetic changed candidate');
  writeFileSync(sourceFile, f.graph.shapes);
  const good = f.commit('synthetic restored candidate');
  f.git(['replace', bad, good]);
  assert.equal(f.git(['show', `${bad}:${TASK_GRAPH_CANDIDATE}/shapes.source.json`]), f.graph.shapes.trim());
  const manifest = { ...f.manifest, source_git_sha: bad, contract_set_id: id('1.27.0', '1.32', bad) };
  writeFileSync(path.join(f.bundle, 'contract-set.json'), json(manifest));
  assert.throws(() => f.run(), /committed candidate differs from frozen member: shapes.source.json/);
  assert.equal(existsSync(path.join(f.product, upstream)), false);
});

test('source Git checks ignore inherited repository and Git configuration overrides', t => {
  const f = fixture(t);
  const overrides = { GIT_DIR: path.join(f.temporary, 'not-a-repository'), GIT_CONFIG_COUNT: 'invalid' };
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, overrides);
    assert.throws(() => f.run(), historicalRequired);
    assert.equal(existsSync(path.join(f.product, upstream)), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('rejects missing source or unknown source commit before the reconstruction gate', t => {
  const f = fixture(t);
  assert.throws(() => f.run(f.bundle, null), /source-repository-root/);
  const manifest = { ...f.manifest, source_git_sha: 'f'.repeat(40), contract_set_id: id('1.27.0', '1.32', 'f'.repeat(40)) };
  writeFileSync(path.join(f.bundle, 'contract-set.json'), json(manifest));
  assert.throws(() => f.run(), /Source Git verification failed/);
  assert.equal(existsSync(path.join(f.product, upstream)), false);
});

test('pure envelope checks still reject missing, changed, extra and version-mismatched members', t => {
  const f = fixture(t);
  const variant = name => { const dir = path.join(f.temporary, name); cpSync(f.bundle, dir, { recursive: true }); return dir; };
  const missing = variant('missing'); rmSync(path.join(missing, 'rules.v3.json')); assert.throws(() => verifyContractSetDirectory(missing), /members mismatch/);
  const changed = variant('changed'); writeFileSync(path.join(changed, 'storage.v3.sql'), '-- changed\n'); assert.throws(() => verifyContractSetDirectory(changed), /byte size mismatch|SHA-256 mismatch/);
  const extra = variant('extra'); writeFileSync(path.join(extra, 'extra.json'), '{}'); assert.throws(() => verifyContractSetDirectory(extra), /members mismatch/);
  const version = variant('version'); const manifest = structuredClone(f.manifest); manifest.sopTaskGraph.storage.version = '1';
  writeFileSync(path.join(version, 'contract-set.json'), json(manifest)); assert.throws(() => verifyContractSetDirectory(version), /descriptor mismatch/);
});

test('pure predecessor check compares a synthetic v7 snapshot without claiming v9 acceptance', t => {
  const f = fixture(t);
  const sources = verifyTaskGraphReferences(f.bundle, f.manifest);
  const readiness = { contract_set_id: id('1.24.0', '1.29', f.beforeSha), source_git_sha: f.beforeSha,
    manifest: { openapi: { source_path: `${READINESS_SOURCE}/openapi.v1.yaml`, sha256: hash(f.beforeApi) },
      database: { source_path: `${READINESS_SOURCE}/schema-v1.29.sql`, sha256: hash(f.beforeDb) } }, openapi_source: f.beforeApi, database_source: f.beforeDb };
  verifyTaskGraphPredecessor(f.manifest, sources, readiness);
  assert.throws(() => verifyTaskGraphPredecessor(f.manifest, sources, { ...readiness, database_source: `${f.beforeDb}changed` }), /predecessor bytes drift/);
  assert.throws(() => verifyTaskGraphPredecessor(f.manifest, sources, { ...readiness, source_git_sha: '0'.repeat(40) }), /predecessor source mismatch/);
});

test('a malformed pending v9 marker cannot block the primary contract', async t => {
  const f = fixture(t); const base = syntheticBase(f);
  assert.equal(verifyIngestedContractSet({ projectRoot: f.product }).contract_set_id, base.contract_set_id);
  assert.equal((await buildGeneratedArtifacts({ projectRoot: f.product })).contract_set_id, base.contract_set_id);
  write(path.join(f.product, upstream, TASK_GRAPH_LOCK), '{}\n');
  assert.equal(verifyIngestedContractSet({ projectRoot: f.product }).contract_set_id, base.contract_set_id);
  await withVerifiedContractSetSnapshot({ projectRoot: f.product }, snapshot => assert.equal(snapshot.manifest.schema, 'customer-agent-contract-set/v1'));
  assert.equal((await buildGeneratedArtifacts({ projectRoot: f.product })).contract_set_id, base.contract_set_id);
  assert.throws(() => verifyIngestedTaskGraph({ projectRoot: f.product }), proofRequired);
  assert.equal(existsSync(path.join(f.product, upstream, '.contract-intake.lock')), false);
});

test('a v9 bundle cannot bypass the gate through the primary lock', async t => {
  const f = fixture(t); const dir = path.join(f.product, upstream, f.manifest.contract_set_id);
  cpSync(f.bundle, dir, { recursive: true });
  writeLock(f.product, f.manifest, readFileSync(path.join(dir, 'contract-set.json')));
  assert.throws(() => verifyIngestedContractSet({ projectRoot: f.product }), proofRequired);
  await assert.rejects(withVerifiedContractSetSnapshot({ projectRoot: f.product }, () => assert.fail('must not expose a v9 snapshot')), proofRequired);
});

test('a dangling v9 lock symlink cannot evade the gate', t => {
  const f = fixture(t); syntheticBase(f);
  symlinkSync('missing-lock.json', path.join(f.product, upstream, TASK_GRAPH_LOCK));
  assert.equal(verifyIngestedContractSet({ projectRoot: f.product }).status, 'VERIFIED');
  assert.throws(() => verifyIngestedTaskGraph({ projectRoot: f.product }), proofRequired);
});

test('a self-declared proof binding source, inputs and output cannot authorize v9 consumption', async t => {
  const f = fixture(t);
  syntheticBase(f);
  const manifestBytes = readFileSync(path.join(f.bundle, 'contract-set.json'));
  const claimedProof = {
    source_git_sha: f.manifest.source_git_sha,
    manifest_sha256: hash(manifestBytes),
    producer_sha256: hash('synthetic producer'),
    input_sha256: hash(f.graph.shapes),
    outputs: { openapi_sha256: f.manifest.openapi.sha256, database_sha256: f.manifest.database.sha256 },
  };
  write(path.join(f.product, upstream, TASK_GRAPH_LOCK), json(claimedProof));
  assert.equal(verifyIngestedContractSet({ projectRoot: f.product }).status, 'VERIFIED');
  assert.throws(() => verifyIngestedTaskGraph({ projectRoot: f.product }), proofRequired);
  await withVerifiedContractSetSnapshot({ projectRoot: f.product }, snapshot => assert.equal(snapshot.manifest.schema, 'customer-agent-contract-set/v1'));
});

test('obsolete v2 and mixed v2/v3 versions cannot be checked, ingested or consumed', async t => {
  const f = fixture(t);
  let obsolete;
  for (const [api, db] of [['1.26.0', '1.31'], ['1.26.0', '1.32'], ['1.27.0', '1.31']]) {
    const dir = path.join(f.temporary, `obsolete-${api}-${db}`);
    cpSync(f.bundle, dir, { recursive: true });
    const manifest = structuredClone(f.manifest);
    manifest.openapi.version = api;
    manifest.database.version = `schema.v${db}`;
    manifest.database.file = `schema-v${db}.sql`;
    manifest.contract_set_id = id(api, db, manifest.source_git_sha);
    write(path.join(dir, 'contract-set.json'), json(manifest));
    assert.throws(() => verifyContractSetDirectory(dir), /Obsolete task graph v2 is not accepted/);
    assert.throws(() => f.run(dir), /Obsolete task graph v2 is not accepted/);
    assert.throws(() => verifyTaskGraphReferences(dir, manifest), /Unsupported task graph/);
    assert.throws(() => verifyTaskGraphPredecessor(manifest, {}, null), /Unsupported task graph/);
    if (api === '1.26.0' && db === '1.31') obsolete = { dir, manifest };
  }
  assert.equal(existsSync(path.join(f.product, upstream)), false);
  const destination = path.join(f.product, upstream, obsolete.manifest.contract_set_id);
  cpSync(obsolete.dir, destination, { recursive: true });
  writeLock(f.product, obsolete.manifest, readFileSync(path.join(destination, 'contract-set.json')));
  assert.throws(() => verifyIngestedContractSet({ projectRoot: f.product }), /Obsolete task graph v2 is not accepted/);
  await assert.rejects(withVerifiedContractSetSnapshot({ projectRoot: f.product }, () => assert.fail('v2 must not be consumed')),
    /Obsolete task graph v2 is not accepted/);
});

function reviseResume(f, mutate, changedShapes) {
  const provenance = JSON.parse(f.graph.provenance);
  if (changedShapes !== undefined) {
    f.graph.shapes = changedShapes;
    provenance.sources['shapes.source.json'] = hash(changedShapes);
    const file = TASK_GRAPH_MEMBERS.shapes[0];
    write(path.join(f.source, TASK_GRAPH_SOURCE, file), changedShapes);
    write(path.join(f.bundle, file), changedShapes);
    f.manifest.sopTaskGraph.shapes = descriptor(`${TASK_GRAPH_SOURCE}/${file}`, file, '3', changedShapes);
  }
  mutate(provenance);
  f.graph.provenance = json(provenance);
  const file = TASK_GRAPH_MEMBERS.provenance[0];
  write(path.join(f.source, TASK_GRAPH_SOURCE, file), f.graph.provenance);
  write(path.join(f.source, TASK_GRAPH_CANDIDATE, 'manifest.candidate.json'), f.graph.provenance);
  write(path.join(f.bundle, file), f.graph.provenance);
  f.manifest.sopTaskGraph.provenance = descriptor(`${TASK_GRAPH_SOURCE}/${file}`, file, '3', f.graph.provenance);
  const sha = f.commit('synthetic revised successor');
  f.manifest.source_git_sha = sha;
  f.manifest.contract_set_id = id('1.27.0', '1.32', sha);
  write(path.join(f.bundle, 'contract-set.json'), json(f.manifest));
}

test('v3 envelope and inherited synthetic Git inputs can be checked, but do not prove reconstruction', async t => {
  const f = fixture(t);
  assert.equal(verifyContractSetDirectory(f.bundle).manifest.contract_set_id, f.manifest.contract_set_id);
  assert.notEqual(f.git(['show', `${f.historicalSha}:${TASK_GRAPH_HISTORY_CANDIDATE}/shapes.source.json`]), f.graph.shapes.trim());
  verifyTaskGraphHistoricalInputs(f.source, f.manifest, f.historicalSha);
  assert.throws(() => f.run(), /historical source does not match the designated historical candidate/);
  assert.equal(existsSync(path.join(f.product, upstream)), false);

  const dir = path.join(f.product, upstream, f.manifest.contract_set_id);
  cpSync(f.bundle, dir, { recursive: true });
  writeLock(f.product, f.manifest, readFileSync(path.join(dir, 'contract-set.json')));
  assert.throws(() => verifyIngestedContractSet({ projectRoot: f.product }), proofRequired);
  await assert.rejects(withVerifiedContractSetSnapshot({ projectRoot: f.product }, () => assert.fail('unproved v3 must not be consumed')), proofRequired);
});

test('v3 shapes must match the current candidate even when the frozen hashes agree', t => {
  const f = fixture(t);
  reviseResume(f, () => {}, json({ schema: 'synthetic-tampered-shapes' }));
  assert.equal(verifyContractSetDirectory(f.bundle).manifest.contract_set_id, f.manifest.contract_set_id);
  assert.throws(() => f.run(), /committed candidate differs from frozen member: shapes.source.json/);
  assert.equal(existsSync(path.join(f.product, upstream)), false);
});

test('v3 shapes remain opaque to envelope and source checks', t => {
  const f = fixture(t);
  const shapes = json({ $defs: { ContinuationClose: { type: 'object' },
    ContinuationRenew: { properties: { contextGeneration: { type: 'integer' } } } }, futureField: ['synthetic'] });
  reviseResume(f, () => {}, shapes);
  write(path.join(f.source, TASK_GRAPH_CANDIDATE, 'shapes.source.json'), shapes);
  const sha = f.commit('synthetic current shapes');
  f.manifest.source_git_sha = sha;
  f.manifest.contract_set_id = id('1.27.0', '1.32', sha);
  write(path.join(f.bundle, 'contract-set.json'), json(f.manifest));
  assert.equal(verifyTaskGraphReferences(f.bundle, verifyContractSetDirectory(f.bundle).manifest).shapes, shapes);
  verifyTaskGraphHistoricalInputs(f.source, f.manifest, f.historicalSha);
  assert.throws(() => f.run(), historicalRequired);
});

test('v3 requires the declared historical commit to be in the source ancestry', t => {
  const f = fixture(t);
  const originalSha = f.manifest.source_git_sha;
  f.git(['checkout', '-qb', 'synthetic-other-history', f.beforeSha]);
  f.git(['checkout', originalSha, '--', '.']);
  const sha = f.commit('synthetic source without historical ancestor');
  f.manifest.source_git_sha = sha;
  f.manifest.contract_set_id = id('1.27.0', '1.32', sha);
  write(path.join(f.bundle, 'contract-set.json'), json(f.manifest));
  assert.throws(() => verifyTaskGraphHistoricalInputs(f.source, f.manifest, f.historicalSha), /historical source is not an ancestor/);
  assert.equal(existsSync(path.join(f.product, upstream)), false);
});

test('v3 historical predecessor bytes must match the frozen predecessor', t => {
  const f = fixture(t);
  write(path.join(f.source, TASK_GRAPH_HISTORY_CANDIDATE, 'predecessor.source.json'), json({ synthetic: 'changed' }));
  const changedSha = f.commit('synthetic changed historical predecessor');
  f.manifest.source_git_sha = changedSha;
  assert.throws(() => verifyTaskGraphHistoricalInputs(f.source, f.manifest, changedSha), /inherited historical member mismatch: .*predecessor.source.json/);
});

test('v3 rejects a changed inherited builder before the proof gate', t => {
  const f = fixture(t);
  write(path.join(f.source, 'business-docs/08-工具/build_customer_agent_sop_task_graph_candidate.mjs'), 'changed synthetic builder');
  const sha = f.commit('synthetic changed inherited builder');
  f.manifest.source_git_sha = sha;
  f.manifest.contract_set_id = id('1.27.0', '1.32', sha);
  write(path.join(f.bundle, 'contract-set.json'), json(f.manifest));
  assert.throws(() => verifyTaskGraphHistoricalInputs(f.source, f.manifest, f.historicalSha), /inherited builder differs from history/);
});

test('producer fingerprints bind the complete set of exact bytes', () => {
  const files = Object.fromEntries(Object.keys(TASK_GRAPH_PRODUCER_HASHES)
    .map((name, index) => [name, Buffer.from(`synthetic producer ${index}\n`)]));
  const fingerprints = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, hash(bytes)]));
  assert.equal(Object.keys(files).length, 3);
  assert.doesNotThrow(() => assertProducerFingerprints(files, fingerprints));
  const first = Object.keys(files)[0];
  assert.throws(() => assertProducerFingerprints({ ...files, [first]: Buffer.from('changed') }, fingerprints), /producer fingerprint mismatch/);
  const missing = { ...files }; delete missing[first];
  assert.throws(() => assertProducerFingerprints(missing, fingerprints), /producer set mismatch/);
  assert.throws(() => assertProducerFingerprints({ ...files, extra: Buffer.from('extra') }, fingerprints), /producer set mismatch/);
  assert.throws(() => assertProducerFingerprints({ ...files, [first]: 'not bytes' }, fingerprints), /producer bytes missing/);
});

test('producer verification uses regular blobs from the exact synthetic commit', t => {
  const f = fixture(t);
  const names = Object.keys(TASK_GRAPH_PRODUCER_HASHES);
  const fingerprints = Object.fromEntries(names.map(name => [name, hash(f.git(['show', `${f.manifest.source_git_sha}:business-docs/08-工具/${name}`]))]));
  verifyTaskGraphProducerBlobs(f.source, f.manifest.source_git_sha, fingerprints);

  const current = path.join(f.source, 'business-docs/08-工具/build_customer_agent_sop_resume_candidate.mjs');
  writeFileSync(current, 'changed synthetic producer');
  verifyTaskGraphProducerBlobs(f.source, f.manifest.source_git_sha, fingerprints);
  const changed = f.commit('synthetic changed producer');
  assert.throws(() => verifyTaskGraphProducerBlobs(f.source, changed, fingerprints), /producer fingerprint mismatch/);

  rmSync(current);
  symlinkSync('other-producer.mjs', current);
  const symlink = f.commit('synthetic producer symlink');
  assert.throws(() => verifyTaskGraphProducerBlobs(f.source, symlink, fingerprints), /Source Git file is not a regular blob/);
});

test('isolated reconstruction binds synthetic committed inputs and every output without authorizing intake', async t => {
  const f = fixture(t, 'matching', { rebuild: true });
  const verifier = await syntheticRebuildVerifier(f);
  const options = { sourceDirectory: f.bundle, sourceRepositoryRoot: f.source };
  const result = verifier.reconstructTaskGraphCandidate(options);
  assert.equal(result.status, 'RECONSTRUCTED_NOT_AUTHORIZED');
  assert.equal(result.proof.source_git_sha, f.manifest.source_git_sha);
  assert.equal(result.proof.historical_git_sha, f.historicalSha);
  assert.equal(result.proof.predecessor_git_sha, f.beforeSha);
  assert.equal(result.proof.runtime_activated, false);
  assert.equal(result.proof.manifest_sha256, hash(readFileSync(path.join(f.bundle, 'contract-set.json'))));
  assert.equal(result.proof_sha256, hash(JSON.stringify(result.proof)));
  assert.equal(Object.keys(result.proof.producers).length, 3);
  assert.equal(Object.keys(result.proof.inputs).length, 9);
  assert.equal(Object.keys(result.proof.candidate_files).length, 8);
  assert.equal(Object.keys(result.proof.outputs).length, 9);
  assert.equal(result.proof.candidate_files['openapi.candidate.yaml'].sha256, f.manifest.openapi.sha256);
  assert.deepEqual(result.proof.outputs.OpenAPI, f.manifest.openapi);
  assert.deepEqual(result.proof.outputs.Database, f.manifest.database);
  for (const [key, descriptor] of Object.entries(f.manifest.sopTaskGraph)) {
    assert.deepEqual(result.proof.outputs[`sopTaskGraph.${key}`], descriptor);
  }
  assert.equal(existsSync(path.join(f.product, upstream)), false);
  assert.throws(() => verifier.verifyTaskGraphReviewAnchor(result), /no reviewed product-code anchor/);
  assert.throws(() => verifyTaskGraphReviewAnchor(result), /no reviewed product-code anchor/);
  const cli = path.join(f.temporary, 'synthetic-verifier/scripts/customer-agent-contract-set.mjs');
  const cliResult = JSON.parse(execFileSync(process.execPath, [cli, 'reconstruct', `--source=${f.bundle}`,
    `--source-repository-root=${f.source}`], { encoding: 'utf8' }));
  assert.deepEqual(cliResult, result);
  assert.throws(() => execFileSync(process.execPath, [cli, 'reconstruct', `--source=${f.bundle}`,
    `--source-repository-root=${f.source}`, '--id=unused'], { stdio: 'pipe' }), /Command failed/);

  const overrides = { GIT_DIR: path.join(f.temporary, 'not-a-repository'), GIT_CONFIG_COUNT: 'invalid', NODE_OPTIONS: '--not-a-node-option' };
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, overrides);
    assert.deepEqual(verifier.reconstructTaskGraphCandidate(options), result);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('only an independent product-code anchor accepts a synthetic proof, and coordinated forgery fails', async t => {
  const f = fixture(t, 'matching', { rebuild: true });
  const verifier = await syntheticRebuildVerifier(f);
  const result = verifier.reconstructTaskGraphCandidate({ sourceDirectory: f.bundle, sourceRepositoryRoot: f.source });
  const anchored = await syntheticRebuildVerifier(f, result);
  assert.deepEqual(anchored.verifyTaskGraphReviewAnchor(result), {
    source_git_sha: f.manifest.source_git_sha, manifest_sha256: result.proof.manifest_sha256, proof_sha256: result.proof_sha256,
  });

  const forged = structuredClone(result);
  forged.proof.outputs.OpenAPI.sha256 = 'f'.repeat(64);
  forged.proof_sha256 = hash(JSON.stringify(forged.proof));
  assert.throws(() => anchored.verifyTaskGraphReviewAnchor(forged), /proof does not match the product-code anchor/);

  forged.proof.manifest_sha256 = hash('altered synthetic manifest');
  forged.proof_sha256 = hash(JSON.stringify(forged.proof));
  assert.throws(() => anchored.verifyTaskGraphReviewAnchor(forged), /manifest does not match the product-code anchor/);
  forged.proof.source_git_sha = 'f'.repeat(40);
  forged.proof_sha256 = hash(JSON.stringify(forged.proof));
  assert.throws(() => anchored.verifyTaskGraphReviewAnchor(forged), /no reviewed product-code anchor/);
});

test('a reviewed reconstruction proof still refuses a review-only v9 candidate', async t => {
  const f = fixture(t, 'matching', { rebuild: true });
  const base = syntheticBase(f);
  const verifier = await syntheticRebuildVerifier(f);
  const result = verifier.reconstructTaskGraphCandidate({ sourceDirectory: f.bundle, sourceRepositoryRoot: f.source });
  const anchored = await syntheticRebuildVerifier(f, result);
  assert.throws(() => anchored.ingestContractSet({ projectRoot: f.product, sourceDirectory: f.bundle, sourceRepositoryRoot: f.source }), /review-only/);
  assert.equal(existsSync(path.join(f.product, upstream, TASK_GRAPH_LOCK)), false);
  assert.equal(existsSync(path.join(f.product, upstream, f.manifest.contract_set_id)), false);
  assert.equal(anchored.verifyIngestedContractSet({ projectRoot: f.product }).contract_set_id, base.contract_set_id);
  await anchored.withVerifiedContractSetSnapshot({ projectRoot: f.product }, snapshot => {
    assert.equal(snapshot.manifest.schema, 'customer-agent-contract-set/v1');
  });
});

test('isolated reconstruction rejects tampering of every frozen descriptor', async t => {
  const f = fixture(t, 'matching', { rebuild: true });
  const verifier = await syntheticRebuildVerifier(f);
  const descriptors = [f.manifest.openapi, f.manifest.database, ...Object.values(f.manifest.sopTaskGraph)];
  for (const [index, descriptor] of descriptors.entries()) {
    const variant = path.join(f.temporary, `altered-output-${index}`);
    cpSync(f.bundle, variant, { recursive: true });
    const file = path.join(variant, descriptor.file);
    const bytes = readFileSync(file);
    bytes[0] ^= 1;
    writeFileSync(file, bytes);
    assert.throws(() => verifier.reconstructTaskGraphCandidate({ sourceDirectory: variant, sourceRepositoryRoot: f.source }),
      /SHA-256 mismatch/);
  }
});

test('isolated reconstruction refuses an unreviewed producer before running it', async t => {
  const f = fixture(t, 'matching', { rebuild: true });
  const verifier = await syntheticRebuildVerifier(f);
  const file = path.join(f.source, 'business-docs/08-工具/build_customer_agent_sop_resume_candidate.mjs');
  const marker = path.join(f.temporary, 'unreviewed-producer-ran');
  writeFileSync(file, `${f.producerContents[2]}\n(await import('node:fs')).writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  const sha = f.commit('synthetic unreviewed producer');
  f.manifest.source_git_sha = sha;
  f.manifest.contract_set_id = id('1.27.0', '1.32', sha);
  write(path.join(f.bundle, 'contract-set.json'), json(f.manifest));
  assert.throws(() => verifier.reconstructTaskGraphCandidate({ sourceDirectory: f.bundle, sourceRepositoryRoot: f.source }),
    /producer fingerprint mismatch/);
  assert.equal(existsSync(marker), false);
  assert.equal(existsSync(path.join(f.product, upstream)), false);
});

test('isolated reconstruction ignores source Git replacement refs', async t => {
  const f = fixture(t, 'matching', { rebuild: true });
  const verifier = await syntheticRebuildVerifier(f);
  const file = path.join(f.source, TASK_GRAPH_CANDIDATE, 'rules.source.json');
  writeFileSync(file, json({ installation: ['changed'] }));
  const bad = f.commit('synthetic changed rules');
  writeFileSync(file, f.graph.rules);
  const good = f.commit('synthetic restored rules');
  f.git(['replace', bad, good]);
  assert.equal(f.git(['show', `${bad}:${TASK_GRAPH_CANDIDATE}/rules.source.json`]), f.graph.rules.trim());
  f.manifest.source_git_sha = bad;
  f.manifest.contract_set_id = id('1.27.0', '1.32', bad);
  write(path.join(f.bundle, 'contract-set.json'), json(f.manifest));
  assert.throws(() => verifier.reconstructTaskGraphCandidate({ sourceDirectory: f.bundle, sourceRepositoryRoot: f.source }),
    /committed candidate differs from frozen member: rules.source.json/);
});

test('isolated reconstruction rejects a self-consistent frozen shape that does not rebuild the outputs', async t => {
  const f = fixture(t, 'matching', { rebuild: true });
  const verifier = await syntheticRebuildVerifier(f);
  const shapes = json({ schema: 'synthetic-only', syntheticTitle: 'changed synthetic title' });
  reviseResume(f, () => {}, shapes);
  write(path.join(f.source, TASK_GRAPH_CANDIDATE, 'shapes.source.json'), shapes);
  const sha = f.commit('synthetic shape and candidate agree');
  f.manifest.source_git_sha = sha;
  f.manifest.contract_set_id = id('1.27.0', '1.32', sha);
  write(path.join(f.bundle, 'contract-set.json'), json(f.manifest));
  assert.equal(verifyContractSetDirectory(f.bundle).manifest.contract_set_id, f.manifest.contract_set_id);
  assert.throws(() => verifier.reconstructTaskGraphCandidate({ sourceDirectory: f.bundle, sourceRepositoryRoot: f.source }),
    /producer reconstruction check failed/);
  assert.equal(existsSync(path.join(f.product, upstream)), false);
});

test('v3 source prechecks do not execute a producer supplied by the bundle', t => {
  const f = fixture(t);
  const marker = path.join(f.temporary, 'producer-ran');
  write(path.join(f.source, 'business-docs/08-工具/build_customer_agent_sop_resume_candidate.mjs'),
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  const sha = f.commit('synthetic untrusted producer');
  f.manifest.source_git_sha = sha;
  f.manifest.contract_set_id = id('1.27.0', '1.32', sha);
  write(path.join(f.bundle, 'contract-set.json'), json(f.manifest));
  assert.throws(() => f.run(), /historical source does not match the designated historical candidate/);
  assert.equal(existsSync(marker), false);
});

test('v3 rejects mixed version paths and extra provenance source claims', t => {
  const f = fixture(t);
  const badPath = structuredClone(f.manifest);
  badPath.sopTaskGraph.shapes.source_path = `${TASK_GRAPH_SOURCE}/shapes.v2.json`;
  write(path.join(f.bundle, 'contract-set.json'), json(badPath));
  assert.throws(() => verifyContractSetDirectory(f.bundle), /descriptor mismatch/);

  reviseResume(f, provenance => { provenance.sources['producer-claimed-proof'] = 'a'.repeat(64); });
  assert.throws(() => verifyContractSetDirectory(f.bundle), /provenance sources mismatch/);
});

test('v3 predecessor comparison uses its own cumulative schema header', t => {
  const f = fixture(t);
  const sources = verifyTaskGraphReferences(f.bundle, f.manifest);
  const readiness = { contract_set_id: id('1.24.0', '1.29', f.beforeSha), source_git_sha: f.beforeSha,
    manifest: { openapi: { source_path: `${READINESS_SOURCE}/openapi.v1.yaml`, sha256: hash(f.beforeApi) },
      database: { source_path: `${READINESS_SOURCE}/schema-v1.29.sql`, sha256: hash(f.beforeDb) } }, openapi_source: f.beforeApi, database_source: f.beforeDb };
  verifyTaskGraphPredecessor(f.manifest, sources, readiness);
  assert.throws(() => verifyTaskGraphPredecessor(f.manifest, sources, { ...readiness, database_source: `${f.beforeDb}changed` }), /predecessor bytes drift/);
});
