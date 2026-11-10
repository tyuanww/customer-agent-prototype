import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ingestContractSet, verifyContractSetDirectory, verifyIngestedContractSet, verifyIngestedCorrectedSopUnifiedContractSet } from './customer-agent-contract-set.mjs';
import { SOP_CORRECTED_SOURCE, SOP_CORRECTED_INPUT, SOP_CORRECTED_MEMBERS, SOP_CORRECTED_SOURCE_FILES,
  SOP_CORRECTED_SOURCE_LOCK, SOP_CORRECTED_AUTHORIZATION, SOP_CORRECTED_LOCK, FROM_PATTERN, TO_PATTERN } from './sop-unified-corrected-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstream = 'contracts/upstream/customer-agent';
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const hash = value => createHash('sha256').update(value).digest('hex');
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const prior = SOP_CORRECTED_SOURCE_LOCK.predecessor;
const parse = (files, name) => JSON.parse(files.get(name));
const update = (files, name, change) => {
  const value = parse(files, name);
  change(value);
  files.set(name, json(value));
};

function fixture(t, mutate = () => {}) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'sop-negotiation-intake-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const source = path.join(temporary, 'source');
  const bundle = path.join(temporary, 'bundle');
  const product = path.join(temporary, 'product');
  for (const dir of [source, bundle, product]) mkdirSync(dir);
  const previous = new Map(Object.entries(prior.members).map(([file, digest]) => {
    const bytes = readFileSync(path.join(root, upstream, prior.contractSetId, file));
    assert.equal(hash(bytes), digest);
    return [file, bytes];
  }));
  const inputs = new Map([
    [SOP_CORRECTED_SOURCE_FILES[0], Buffer.from("throw new Error('Synthetic upstream producer must not execute');\n")],
    [`${SOP_CORRECTED_INPUT}/source.json`, json(SOP_CORRECTED_SOURCE_LOCK)],
    [`${SOP_CORRECTED_INPUT}/authorization.source.json`, json(SOP_CORRECTED_AUTHORIZATION)],
  ]);
  const api = parse(previous, 'openapi.v1.yaml');
  const changedHeaders = [];
  function correct(value, pointer = '') {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      const at = `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      if (item === FROM_PATTERN) {
        value[key] = TO_PATTERN;
        changedHeaders.push({ pointer: at, before: FROM_PATTERN, after: TO_PATTERN });
      } else correct(item, at);
    }
  }
  correct(api);
  assert.equal(changedHeaders.length, 548);
  api.info.version = '1.29.1';
  api['x-contract-set-negotiation'].successorContractSetId = 'deployment-manifest-exact-id';
  const query = parse(previous, 'query-transport.v1.json');
  query.info.version = '1.29.1';
  const installation = parse(previous, 'installation.v1.json');
  installation.schema = 'customer-agent-sop-unified-installation/v2';
  installation.versions = SOP_CORRECTED_SOURCE_LOCK.versions;
  installation.correction = { predecessorContractSetId: prior.contractSetId,
    predecessorSourceGitSha: prior.sourceGitSha, header: 'X-Intake-Contract-Set', pattern: TO_PATTERN };
  installation.requirements.push(
    'The complete actual manifest contract_set_id must pass every negotiation schema. Older versions, prefixes and business aliases do not select the corrected view.',
    'A format-valid unknown suffix is not runtime authorization. Require exact equality with the deployed manifest ID before selecting the successor view.',
    'modelInstallation, modelCompatibility and modelCoverage retain historical model/source v4 metadata. Current versions are owned by top-level versions and the corrected intake negotiation.',
  );
  const compatibility = parse(previous, 'compatibility.v1.json');
  const coverage = parse(previous, 'operation-coverage.v1.json');
  const files = new Map([
    ['openapi.v1.yaml', json(api)], ['schema-v1.33.sql', previous.get('schema-v1.33.sql')],
    ['storage.v1.sql', previous.get('storage.v1.sql')], ['installation.v1.json', json(installation)],
    ['predecessor-lock.v1.json', inputs.get(`${SOP_CORRECTED_INPUT}/source.json`)],
    ['compatibility.v1.json', json({ schema: 'customer-agent-sop-unified-compatibility/v2', modelCompatibility: compatibility.intake, intake: api['x-contract-set-negotiation'], query: compatibility.query })],
    ['operation-coverage.v1.json', json({ modelCoverage: coverage.intake, query: coverage.query, negotiation: { header: 'X-Intake-Contract-Set', pattern: TO_PATTERN, changedHeaders: 548 } })],
    ['legacy-openapi.v7.yaml', previous.get('legacy-openapi.v7.yaml')],
    ['legacy-query.openapi.v1.json', previous.get('legacy-query.openapi.v1.json')],
    ['query-transport.v1.json', json(query)], ['authorization.v1.json', inputs.get(`${SOP_CORRECTED_INPUT}/authorization.source.json`)],
    ['negotiation-proof.v1.json', json({ schema: 'customer-agent-sop-negotiation-proof/v1', predecessorSourceGitSha: prior.sourceGitSha,
      header: 'X-Intake-Contract-Set', fromPattern: FROM_PATTERN, toPattern: TO_PATTERN, changedHeaders })],
  ]);
  mutate({ files, inputs, previous });
  const provenance = {
    schema: 'customer-agent-sop-unified-correction-candidate/v1', status: 'IMPLEMENTATION_APPROVED_CANDIDATE',
    versions: SOP_CORRECTED_SOURCE_LOCK.versions, formalVersionAssigned: true, sourceGitSha: null,
    authorizationEvidenceId: SOP_CORRECTED_AUTHORIZATION.evidenceId,
    sources: Object.fromEntries([...inputs].map(([file, bytes]) => [file, hash(bytes)])),
    artifacts: Object.fromEntries([...files].map(([file, bytes]) => [file, { sha256: hash(bytes), bytes: bytes.length }])),
    runtimeActivated: false, businessMappingApproved: false,
  };
  files.set('provenance.v1.json', json(provenance));
  git(source, ['init', '--quiet']);
  git(source, ['config', 'user.name', 'Synthetic correction source']);
  git(source, ['config', 'user.email', 'correction@example.invalid']);
  const write = (relative, bytes) => { const target = path.join(source, relative); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, bytes); };
  for (const [file, bytes] of previous) write(`${prior.directory}/${file}`, bytes);
  for (const [file, bytes] of inputs) write(file, bytes);
  for (const [file, bytes] of files) {
    write(`${SOP_CORRECTED_SOURCE}/${file}`, bytes);
    writeFileSync(path.join(bundle, file), bytes);
  }
  git(source, ['add', '.']);
  git(source, ['commit', '--quiet', '-m', 'Synthetic corrected contract']);
  const sha = git(source, ['rev-parse', 'HEAD']);
  const descriptors = Object.fromEntries(Object.entries(SOP_CORRECTED_MEMBERS).map(([key, [file, version]]) => [key,
    { version, file, source_path: `${SOP_CORRECTED_SOURCE}/${file}`, sha256: hash(files.get(file)), bytes: files.get(file).length }]));
  const { openapi, database, ...sopUnified } = descriptors;
  const manifest = { schema: 'customer-agent-contract-set/v11', contract_set_id: `cs-ai-c11-openapi-1.29.1-schema-1.33-${sha.slice(0, 12)}`,
    source_repository: 'ai-赋能立项', source_git_sha: sha, architecture_version: '1.16', implementation_version: '1.22', openapi, database, sopUnified };
  writeFileSync(path.join(bundle, 'contract-set.json'), json(manifest));
  writeFileSync(path.join(product, 'package.json'), json({ name: 'customer-agent-demo' }));
  mkdirSync(path.join(product, 'contracts/upstream'), { recursive: true });
  cpSync(path.join(root, upstream), path.join(product, upstream), { recursive: true, filter: file => {
    const name = path.basename(file);
    return name !== SOP_CORRECTED_LOCK && !name.startsWith('cs-ai-c11-openapi-1.29.1-schema-1.33-')
      && name !== '.contract-intake.lock' && !name.startsWith('.contract-intake-') && !name.startsWith('.lock-write-');
  } });
  mkdirSync(path.join(product, 'packages/database'), { recursive: true });
  cpSync(path.join(root, 'packages/database/migrations'), path.join(product, 'packages/database/migrations'), { recursive: true });
  const migrationManifest = path.join(product, 'packages/database/migrations/manifest.generated.json');
  const predecessor = JSON.parse(readFileSync(migrationManifest, 'utf8'));
  for (const migration of predecessor.migrations.slice(83)) {
    rmSync(path.join(product, 'packages/database/migrations', migration.file));
  }
  predecessor.migrations = predecessor.migrations.slice(0, 83);
  delete predecessor.compatibility.sop_unified_successor;
  delete predecessor.compatibility.sop_lifecycle_overlay;
  writeFileSync(migrationManifest, json(predecessor));
  return { source, bundle, product, manifest, files };
}
const ingest = f => ingestContractSet({ projectRoot: f.product, sourceDirectory: f.bundle, sourceRepositoryRoot: f.source });
const destination = f => path.join(f.product, upstream, f.manifest.contract_set_id);
function rejected(f, pattern) {
  assert.throws(() => ingest(f), pattern);
  assert.equal(existsSync(destination(f)), false);
  assert.equal(existsSync(path.join(f.product, upstream, SOP_CORRECTED_LOCK)), false);
  assert.equal(existsSync(path.join(f.product, upstream, '.contract-intake.lock')), false);
}

test('v11 accepts its actual exact manifest ID at all 548 headers and preserves immutable predecessors', t => {
  const f = fixture(t);
  const names = ['contract-set.lock.json', 'repair-contract-set.lock.json', 'readiness-contract-set.lock.json', 'sop-query-contract-set.lock.json', 'sop-unified-contract-set.lock.json'];
  const before = names.map(file => readFileSync(path.join(f.product, upstream, file)));
  assert.equal(ingest(f).status, 'CREATED');
  assert.equal(ingest(f).status, 'REUSED');
  const verified = verifyIngestedCorrectedSopUnifiedContractSet({ projectRoot: f.product });
  assert.equal(verified.profile, 'sopUnifiedCorrected');
  assert.equal(verified.generateMigrations, false);
  assert.equal(verified.runtime_activated, false);
  assert.deepEqual(names.map(file => readFileSync(path.join(f.product, upstream, file))), before);
  assert.equal(readdirSync(destination(f)).length, 14);
  const api = parse(f.files, 'openapi.v1.yaml');
  const proof = parse(f.files, 'negotiation-proof.v1.json');
  let requests = 0;
  for (const change of proof.changedHeaders) {
    const pattern = change.pointer.slice(1).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~')).reduce((value, key) => value[key], api);
    const matches = new RegExp(pattern);
    assert.ok(matches.test(f.manifest.contract_set_id));
    assert.equal(matches.test(prior.contractSetId), false);
    assert.equal(matches.test('menokin-sop-query-v1'), false);
    if (change.pointer.includes('/parameters/')) requests += 1;
  }
  assert.equal(requests, 52);
  assert.equal(proof.changedHeaders.length - requests, 496);
  for (const key of ['schema-v1.33.sql', 'storage.v1.sql', 'legacy-openapi.v7.yaml', 'legacy-query.openapi.v1.json']) assert.equal(hash(f.files.get(key)), prior.members[key]);
});

test('v11 refuses semantic changes even when source commits and all hashes agree', async t => {
  const cases = [
    ['old header', ({ files }) => update(files, 'openapi.v1.yaml', v => { v.paths['/v1/intake/sop/check'].post.parameters.find(p => p.name === 'X-Intake-Contract-Set').schema.pattern = FROM_PATTERN; }), /header count|obsolete/],
    ['unbound successor', ({ files }) => update(files, 'openapi.v1.yaml', v => { v['x-contract-set-negotiation'].successorContractSetId = null; }), /successor manifest/],
    ['missing proof row', ({ files }) => update(files, 'negotiation-proof.v1.json', v => { v.changedHeaders.pop(); }), /negotiation proof/],
    ['forged proof row', ({ files }) => update(files, 'negotiation-proof.v1.json', v => { v.changedHeaders[0].pointer = '/info/version'; }), /negotiation proof/],
    ['runnable migration', ({ files }) => update(files, 'installation.v1.json', v => { v.runnableMigration = true; }), /installation boundary/],
    ['changed storage', ({ files }) => files.set('storage.v1.sql', Buffer.from('SELECT 1;\n')), /immutable predecessor/],
    ['changed legacy', ({ files }) => files.set('legacy-query.openapi.v1.json', Buffer.from('{}\n')), /immutable predecessor/],
    ['source authorization', ({ files, inputs }) => {
      update(files, 'authorization.v1.json', v => { v.scope.push('production'); });
      inputs.set(`${SOP_CORRECTED_INPUT}/authorization.source.json`, files.get('authorization.v1.json'));
    }, /authorization/],
    ['weakened risk', ({ files }) => update(files, 'openapi.v1.yaml', v => { v.components.schemas.MenokinSopQuerySopEntryPermission.properties.risk_level.enum.push('unclassified'); }), /rebuilt artifact openapi/],
    ['mutated predecessor', ({ previous }) => previous.set('openapi.v1.yaml', Buffer.from('{}\n')), /predecessor source/],
  ];
  for (const [name, mutate, pattern] of cases) await t.test(name, subtest => rejected(fixture(subtest, mutate), pattern));
});

test('v11 refuses mixed manifests, member drift, unsafe paths and source symlinks', async t => {
  await t.test('extra member', subtest => {
    const f = fixture(subtest);
    writeFileSync(path.join(f.bundle, 'extra'), 'extra');
    rejected(f, /members mismatch/);
  });
  await t.test('missing member', subtest => {
    const f = fixture(subtest);
    rmSync(path.join(f.bundle, 'negotiation-proof.v1.json'));
    rejected(f, /members mismatch/);
  });
  await t.test('mixed manifest', subtest => {
    const f = fixture(subtest);
    f.manifest.sopUnified.storage.source_path = `${prior.directory}/storage.v1.sql`;
    writeFileSync(path.join(f.bundle, 'contract-set.json'), json(f.manifest));
    rejected(f, /descriptor mismatch/);
  });
  await t.test('bundle symlink', subtest => {
    const f = fixture(subtest);
    const target = path.join(f.bundle, 'storage.v1.sql');
    rmSync(target);
    symlinkSync(path.join(f.source, SOP_CORRECTED_SOURCE, 'storage.v1.sql'), target);
    rejected(f, /symlink|regular/);
  });
  await t.test('Git source symlink', subtest => {
    const f = fixture(subtest);
    const file = path.join(f.source, SOP_CORRECTED_SOURCE_FILES[0]);
    rmSync(file);
    symlinkSync(path.join(f.source, SOP_CORRECTED_SOURCE, 'storage.v1.sql'), file);
    git(f.source, ['add', '.']);
    git(f.source, ['commit', '--quiet', '-m', 'Synthetic symlink source']);
    f.manifest.source_git_sha = git(f.source, ['rev-parse', 'HEAD']);
    f.manifest.contract_set_id = `cs-ai-c11-openapi-1.29.1-schema-1.33-${f.manifest.source_git_sha.slice(0, 12)}`;
    writeFileSync(path.join(f.bundle, 'contract-set.json'), json(f.manifest));
    rejected(f, /regular Git blob/);
  });
  await t.test('missing predecessor', subtest => {
    const f = fixture(subtest);
    rmSync(path.join(f.product, upstream, 'sop-unified-contract-set.lock.json'));
    rejected(f, /regular|missing|ENOENT/i);
  });
});

test('v11 normal CLI verifies the independent corrected lock and rejects active promotion', t => {
  const f = fixture(t);
  const cli = (...args) => JSON.parse(execFileSync(process.execPath, [path.join(root, 'scripts/customer-agent-contract-set.mjs'), ...args], { encoding: 'utf8' }));
  assert.equal(cli('ingest', `--project-root=${f.product}`, `--source=${f.bundle}`, `--source-repository-root=${f.source}`).status, 'CREATED');
  assert.equal(cli('verify', '--profile=sopUnifiedCorrected', `--project-root=${f.product}`, `--id=${f.manifest.contract_set_id}`).status, 'VERIFIED');
  const lock = JSON.parse(readFileSync(path.join(f.product, upstream, SOP_CORRECTED_LOCK)));
  delete lock.profile;
  lock.schema = 'customer-agent-contract-consumption/v1';
  writeFileSync(path.join(f.product, upstream, 'contract-set.lock.json'), json(lock));
  assert.throws(() => verifyIngestedContractSet({ projectRoot: f.product }), /independent candidate lock/);
  const file = path.join(destination(f), 'negotiation-proof.v1.json');
  chmodSync(file, 0o644);
  writeFileSync(file, '{}\n');
  assert.throws(() => verifyContractSetDirectory(destination(f)), /SHA-256|byte|mismatch/i);
});

test('v11 verification reconstructs product bytes without Git after coordinated hash changes', t => {
  const f = fixture(t);
  ingest(f);
  rmSync(f.source, { recursive: true, force: true });
  const directory = destination(f);
  const manifestPath = path.join(directory, 'contract-set.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const apiPath = path.join(directory, manifest.openapi.file);
  const api = JSON.parse(readFileSync(apiPath, 'utf8'));
  api.paths['/v1/intake/sop/check'].post.parameters
    .find(parameter => parameter.name === 'X-Intake-Contract-Set').required = false;
  const apiBytes = json(api);
  const provenancePath = path.join(directory, manifest.sopUnified.provenance.file);
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  provenance.artifacts[manifest.openapi.file] = { sha256: hash(apiBytes), bytes: apiBytes.length };
  const provenanceBytes = json(provenance);
  Object.assign(manifest.openapi, { sha256: hash(apiBytes), bytes: apiBytes.length });
  Object.assign(manifest.sopUnified.provenance, { sha256: hash(provenanceBytes), bytes: provenanceBytes.length });
  for (const [file, bytes] of [[apiPath, apiBytes], [provenancePath, provenanceBytes], [manifestPath, json(manifest)]]) {
    chmodSync(file, 0o644);
    writeFileSync(file, bytes);
  }
  const lockPath = path.join(f.product, upstream, SOP_CORRECTED_LOCK);
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.manifest_sha256 = hash(readFileSync(manifestPath));
  lock.openapi_sha256 = hash(apiBytes);
  writeFileSync(lockPath, json(lock));
  assert.doesNotThrow(() => verifyContractSetDirectory(directory));
  assert.throws(() => verifyIngestedCorrectedSopUnifiedContractSet({ projectRoot: f.product }),
    /product reconstruction openapi.v1.yaml/);
});
