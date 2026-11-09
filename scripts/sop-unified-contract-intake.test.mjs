import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ingestContractSet, parseCliArguments, verifyContractSetDirectory, verifyIngestedContractSet, verifyIngestedSopUnifiedContractSet } from './customer-agent-contract-set.mjs';
import { SOP_UNIFIED_INPUT, SOP_UNIFIED_LOCK, SOP_UNIFIED_SOURCE_LOCK, SOP_UNIFIED_SOURCE } from './sop-unified-contract.mjs';
import { fixture, git, hash, json, readJson, repositoryRoot, upstream } from './sop-unified-contract.fixture.mjs';

const ingest = f => ingestContractSet({ projectRoot: f.product, sourceDirectory: f.bundle, sourceRepositoryRoot: f.source });
const destination = f => path.join(f.product, upstream, f.manifest.contract_set_id);
const lockPath = f => path.join(f.product, upstream, SOP_UNIFIED_LOCK);
const edit = (files, file, change) => {
  const value = JSON.parse(files.get(file));
  change(value);
  files.set(file, json(value));
};

function assertRejected(f, pattern) {
  assert.throws(() => ingest(f), pattern);
  assert.equal(existsSync(destination(f)), false);
  assert.equal(existsSync(lockPath(f)), false);
  assert.equal(existsSync(path.join(f.product, upstream, '.contract-intake.lock')), false);
}

function protectedBytes(f) {
  return ['contract-set.lock.json', 'repair-contract-set.lock.json', 'readiness-contract-set.lock.json', 'sop-query-contract-set.lock.json']
    .map(file => readFileSync(path.join(f.product, upstream, file)))
    .concat(readFileSync(path.join(f.product, 'packages/database/migrations/manifest.generated.json')));
}

test('v10 CLI intake and verification preserve existing locks and generated migrations, with idempotent reuse', t => {
  const f = fixture(t);
  const before = protectedBytes(f);
  const cli = (...args) => JSON.parse(execFileSync(process.execPath, [path.join(repositoryRoot, 'scripts/customer-agent-contract-set.mjs'), ...args], { encoding: 'utf8' }));
  const args = ['ingest', `--project-root=${f.product}`, `--source=${f.bundle}`, `--source-repository-root=${f.source}`];
  const created = cli(...args);
  assert.equal(created.status, 'CREATED');
  assert.equal(created.profile, 'sopUnified');
  assert.equal(created.source_git_sha, f.manifest.source_git_sha);
  for (const key of ['generateMigrations', 'generateContracts', 'runtime_activated', 'ddev_authorized']) assert.equal(created[key], false);
  const members = readdirSync(destination(f)).sort();
  assert.equal(members.length, 13);
  assert.deepEqual(members, readdirSync(f.bundle).sort());
  assert.equal(cli(...args).status, 'REUSED');
  const verified = cli('verify', '--profile=sopUnified', `--project-root=${f.product}`, `--id=${f.manifest.contract_set_id}`);
  assert.equal(verified.status, 'VERIFIED');
  assert.equal(verified.schema, 'customer-agent-sop-unified-contract-consumption/v1');
  assert.equal(verified.profile, 'sopUnified');
  assert.deepEqual(protectedBytes(f), before);
  assert.equal(verifyIngestedContractSet({ projectRoot: f.product }).contract_set_id, created.preserved_lock);
  assert.equal(existsSync(path.join(f.product, 'packages/contracts')), false);
  assert.equal(existsSync(path.join(f.product, upstream, '.contract-intake.lock')), false);
});

test('v10 rejects unknown, missing and mixed-profile manifest fields and unsafe descriptors', async t => {
  const f = fixture(t);
  const original = structuredClone(f.manifest);
  const mutations = [
    ['root extra', m => { m.runtime = {}; }],
    ['root missing', m => { delete m.implementation_version; }],
    ['missing member', m => { delete m.sopUnified.authorization; }],
    ['extra member', m => { m.sopUnified.approval = m.sopUnified.authorization; }],
    ['nested extra', m => { m.sopUnified.query.extra = true; }],
    ['wrong schema', m => { m.schema = 'customer-agent-contract-set/v8'; }],
    ['wrong source', m => { m.source_repository = 'other'; }],
    ['wrong SHA', m => { m.source_git_sha = 'a'.repeat(40); }],
    ['non-string SHA', m => { m.source_git_sha = [m.source_git_sha]; m.contract_set_id = `cs-ai-c11-openapi-1.29.0-schema-1.33-${m.source_git_sha}`; }],
    ['wrong architecture', m => { m.architecture_version = '1.17'; }],
    ['wrong implementation', m => { m.implementation_version = '1.23'; }],
    ['wrong version', m => { m.sopUnified.query.version = '2'; }],
    ['wrong OpenAPI', m => { m.openapi.file = 'openapi.v2.yaml'; }],
    ['wrong database', m => { m.database.version = 'schema.v1.30'; }],
    ['path traversal', m => { m.sopUnified.query.source_path = '../query-transport.v1.json'; }],
    ['absolute path', m => { m.sopUnified.query.source_path = '/query-transport.v1.json'; }],
    ['wrong source profile', m => { m.sopUnified.query.source_path = `${SOP_UNIFIED_SOURCE_LOCK.legacyQuery.directory}/rules.v1.json`; }],
    ['filename traversal', m => { m.sopUnified.query.file = '../query-transport.v1.json'; }],
    ['file collision', m => { m.sopUnified.query.file = m.sopUnified.legacyQuery.file; }],
    ['hash', m => { m.sopUnified.query.sha256 = 'a'.repeat(64); }],
    ['length', m => { m.sopUnified.query.bytes++; }],
    ['invalid length', m => { m.sopUnified.query.bytes = 0; }],
  ];
  for (const [name, mutate] of mutations) await t.test(name, () => {
    const manifest = structuredClone(original);
    mutate(manifest);
    writeFileSync(path.join(f.bundle, 'contract-set.json'), json(manifest));
    assertRejected(f, /invalid|mismatch|unexpected|Unsupported|SHA-256/i);
  });
});

test('v10 rejects incomplete members, surplus members and bundle symlinks', async t => {
  const f = fixture(t);
  const target = path.join(f.bundle, 'query-transport.v1.json');
  const bytes = readFileSync(target);
  await t.test('missing', () => { rmSync(target); assertRejected(f, /members mismatch/); writeFileSync(target, bytes); });
  await t.test('extra', () => {
    writeFileSync(path.join(f.bundle, 'extra'), 'surplus');
    assertRejected(f, /members mismatch/);
    rmSync(path.join(f.bundle, 'extra'));
  });
  await t.test('symlink file', () => {
    rmSync(target);
    symlinkSync(path.join(f.source, SOP_UNIFIED_SOURCE, 'query-transport.v1.json'), target);
    assertRejected(f, /regular|symlink/);
    rmSync(target);
    writeFileSync(target, bytes);
  });
  await t.test('symlink directory', () => {
    const alias = path.join(f.root, 'bundle-link');
    symlinkSync(f.bundle, alias);
    assertRejected({ ...f, bundle: alias }, /non-symlink/);
  });
});

test('v10 rejects committed semantic tampering even when all descriptor hashes are recomputed', async t => {
  const mutations = [
    ['runtime activation', ({ files }) => edit(files, 'installation.v1.json', v => { v.runtimeActivated = true; }), /installation boundary/],
    ['runnable migration', ({ files }) => edit(files, 'installation.v1.json', v => { v.runnableMigration = true; }), /installation boundary/],
    ['legacy query exact ID', ({ files }) => edit(files, 'installation.v1.json', v => { v.queryTransport.legacyContractSetId = 'menokin-sop-query-v1'; }), /installation boundary/],
    ['authorization scope', ({ files }) => edit(files, 'authorization.v1.json', v => { v.scope.push('production'); }), /authorization/],
    ['critical self-review', ({ files }) => edit(files, 'openapi.v1.yaml', v => { v['x-sop-graph-contract'].quality = { authorSelfReview: true }; }), /rebuilt v4 and query OpenAPI/],
    ['predecessor SHA', ({ files }) => edit(files, 'predecessor-lock.v1.json', v => { v.sourceGitSha = 'a'.repeat(40); }), /fixed predecessor/],
    ['predecessor self-reported hash', ({ files, inputs, model }) => {
      model['storage.v4.sql'] = Buffer.from('SELECT 1;\n');
      for (const [values, name] of [[files, 'predecessor-lock.v1.json'], [inputs, `${SOP_UNIFIED_INPUT}/source.json`]]) {
        edit(values, name, v => { v.model.members['storage.v4.sql'] = hash(model['storage.v4.sql']); });
      }
    }, /fixed predecessor/],
    ['source schema', ({ inputs }) => edit(inputs, `${SOP_UNIFIED_INPUT}/source.json`, v => { v.schema = 'other'; }), /predecessor source hash/],
    ['source authorization', ({ inputs }) => edit(inputs, `${SOP_UNIFIED_INPUT}/authorization.source.json`, v => { v.runtimeActivated = true; }), /authorization source hash/],
    ['source query', ({ inputs }) => edit(inputs, `${SOP_UNIFIED_INPUT}/query.source.json`, v => { v.info.version = '1.25.0'; }), /query source hash/],
    ['legacy transport relaxation', ({ files }) => edit(files, 'openapi.v1.yaml', v => { delete v.paths['/v1/search'].post.responses['503']; }), /rebuilt v4 and query OpenAPI/],
    ['storage composition', ({ files }) => files.set('storage.v1.sql', Buffer.from('SELECT 2;\n')), /storage composition/],
    ['DDL composition', ({ files }) => files.set('schema-v1.33.sql', Buffer.from('SELECT 2;\n')), /DDL composition/],
    ['source v4 predecessor bytes', ({ model }) => { model['storage.v4.sql'] = Buffer.from('changed'); }, /source predecessor model/],
    ['source old query predecessor bytes', ({ old }) => { old['rules.v1.json'] = json({ changed: true }); }, /source predecessor legacyQuery/],
    ['v4 installation', ({ files }) => edit(files, 'installation.v1.json', v => { v.modelInstallation.requiredProductWork = []; }), /v4 installation/],
    ['v4 compatibility', ({ files }) => edit(files, 'compatibility.v1.json', v => { v.intake.negotiation = {}; }), /v4 compatibility/],
    ['v4 coverage', ({ files }) => edit(files, 'operation-coverage.v1.json', v => { v.intake = {}; }), /v4 operation coverage/],
    ['old query sidecar', ({ files }) => edit(files, 'legacy-query.openapi.v1.json', v => { delete v.paths['/v1/sop/query'].post.parameters; }), /legacy query bytes/],
    ['v7 sidecar', ({ files }) => edit(files, 'legacy-openapi.v7.yaml', v => { delete v.paths['/v1/search']; }), /legacy intake bytes/],
    ['graph digest missing', ({ files, inputs }) => {
      for (const [values, name] of [[files, 'query-transport.v1.json'], [inputs, `${SOP_UNIFIED_INPUT}/query.source.json`]]) {
        edit(values, name, v => { delete v.components.schemas.SopReadyResult.properties.graph_digest; });
      }
    }, /complete query result/],
    ['import-only notes exposed', ({ files, inputs }) => {
      for (const [values, name] of [[files, 'query-transport.v1.json'], [inputs, `${SOP_UNIFIED_INPUT}/query.source.json`]]) {
        edit(values, name, v => { v.components.schemas.SopReadyResult.properties.entries.items.properties.entry.$ref = '#/components/schemas/IntakeEntry'; });
      }
    }, /complete query result/],
    ['header-only flow', ({ files, inputs }) => {
      for (const [values, name] of [[files, 'query-transport.v1.json'], [inputs, `${SOP_UNIFIED_INPUT}/query.source.json`]]) {
        edit(values, name, v => { v.components.schemas.SopReadyResult.properties.flow.$ref = '#/components/schemas/IntakeSopPublishedFlow'; });
      }
    }, /complete query result/],
    ['query permissions removed', ({ files, inputs }) => {
      for (const [values, name] of [[files, 'query-transport.v1.json'], [inputs, `${SOP_UNIFIED_INPUT}/query.source.json`]]) {
        edit(values, name, v => { delete v.components.schemas.SopReadyResult.properties.permissions; });
      }
    }, /complete query result/],
    ['query request relaxation', ({ files, inputs }) => {
      for (const [values, name] of [[files, 'query-transport.v1.json'], [inputs, `${SOP_UNIFIED_INPUT}/query.source.json`]]) {
        edit(values, name, v => { v.components.schemas.SopQueryRequest.additionalProperties = true; });
      }
    }, /query source transport/],
    ['unclassified permission risk', ({ files, inputs }) => {
      for (const [values, name] of [[files, 'query-transport.v1.json'], [inputs, `${SOP_UNIFIED_INPUT}/query.source.json`]]) {
        edit(values, name, v => { v.components.schemas.SopEntryPermission.properties.risk_level.enum.push('unclassified'); });
      }
    }, /entry permission facts/],
    ['query fragment origin', ({ predecessorInputs }) => {
      predecessorInputs.set(SOP_UNIFIED_SOURCE_LOCK.legacyQuery.fragment, json({ changed: true }));
    }, /source legacy fragment/],
    ['lease fragment origin', ({ predecessorInputs }) => {
      predecessorInputs.set(SOP_UNIFIED_SOURCE_LOCK.legacyQuery.leaseStorage, Buffer.from('SELECT 1;'));
    }, /source legacy lease/],
    ['patch source changes', ({ inputs }) => inputs.set(`${SOP_UNIFIED_INPUT}/storage.patch.sql`, Buffer.from('SELECT 1;')), /storage patch hash/],
    ['lease TTL extended', ({ files }) => files.set('storage.v1.sql', Buffer.from(files.get('storage.v1.sql').toString().replaceAll("'5 minutes'", "'15 minutes'"))), /storage composition/],
    ['outer lease transaction retained', ({ files }) => files.set('storage.v1.sql', Buffer.concat([files.get('storage.v1.sql'), Buffer.from('COMMIT;\n')])), /storage composition/],
  ];
  for (const [name, mutate, pattern] of mutations) await t.test(name, subtest => {
    const f = fixture(subtest, mutate);
    assertRejected(f, pattern);
  });
});

test('v10 binds source provenance and bundle bytes to the declared exact commit', async t => {
  const f = fixture(t);
  await t.test('bundle rehash without source change', () => {
    const file = path.join(f.bundle, 'provenance.v1.json');
    const provenance = readJson(file);
    provenance.sources['business-docs/08-工具/build_customer_agent_sop_unified_contract.mjs'] = 'a'.repeat(64);
    const bytes = json(provenance);
    writeFileSync(file, bytes);
    const manifest = structuredClone(f.manifest);
    manifest.sopUnified.provenance.sha256 = hash(bytes);
    manifest.sopUnified.provenance.bytes = bytes.length;
    writeFileSync(path.join(f.bundle, 'contract-set.json'), json(manifest));
    assertRejected(f, /declared source Git commit/);
    writeFileSync(file, f.files.get('provenance.v1.json'));
    writeFileSync(path.join(f.bundle, 'contract-set.json'), json(f.manifest));
  });
  await t.test('later source commit with changed input', () => {
    writeFileSync(path.join(f.source, 'business-docs/08-工具/build_customer_agent_sop_unified_contract.mjs'), 'changed producer\n');
    git(f.source, ['add', '.']);
    git(f.source, ['commit', '--quiet', '-m', 'Alter source input']);
    const manifest = { ...f.manifest, source_git_sha: git(f.source, ['rev-parse', 'HEAD']) };
    manifest.contract_set_id = `cs-ai-c11-openapi-1.29.0-schema-1.33-${manifest.source_git_sha.slice(0, 12)}`;
    writeFileSync(path.join(f.bundle, 'contract-set.json'), json(manifest));
    assertRejected({ ...f, manifest }, /source provenance/);
    writeFileSync(path.join(f.bundle, 'contract-set.json'), json(f.manifest));
    assert.equal(ingest(f).status, 'CREATED');
  });
});

test('v10 rejects symlink Git source, incomplete history and surplus frozen Git members', async t => {
  for (const mode of ['symlink', 'shallow', 'surplus']) await t.test(mode, subtest => {
    const f = fixture(subtest);
    if (mode === 'symlink') {
      const target = path.join(f.source, 'business-docs/08-工具/build_customer_agent_sop_unified_contract.mjs');
      rmSync(target);
      symlinkSync('other.mjs', target);
      git(f.source, ['add', '.']);
      git(f.source, ['commit', '--quiet', '-m', 'Symlink producer']);
    } else if (mode === 'surplus') {
      writeFileSync(path.join(f.source, SOP_UNIFIED_SOURCE, 'surplus.json'), '{}');
      git(f.source, ['add', '.']);
      git(f.source, ['commit', '--quiet', '-m', 'Surplus frozen member']);
    } else {
      writeFileSync(path.join(f.source, '.git/shallow'), `${f.manifest.source_git_sha}\n`);
      assertRejected(f, /complete Git history/);
      return;
    }
    f.manifest.source_git_sha = git(f.source, ['rev-parse', 'HEAD']);
    f.manifest.contract_set_id = `cs-ai-c11-openapi-1.29.0-schema-1.33-${f.manifest.source_git_sha.slice(0, 12)}`;
    writeFileSync(path.join(f.bundle, 'contract-set.json'), json(f.manifest));
    assertRejected(f, /regular Git blob|committed frozen members/);
  });
});

test('v10 refuses corrupt or missing product predecessor and lock collisions', async t => {
  const f = fixture(t);
  const oldLock = path.join(f.product, upstream, 'sop-query-contract-set.lock.json');
  const originalLock = readFileSync(oldLock);
  await t.test('missing predecessor', () => { rmSync(oldLock); assertRejected(f, /predecessor lock/); writeFileSync(oldLock, originalLock); });
  await t.test('wrong predecessor SHA', () => {
    const lock = JSON.parse(originalLock);
    lock.source_git_sha = 'a'.repeat(40);
    writeFileSync(oldLock, json(lock));
    assertRejected(f, /lock mismatch/);
    writeFileSync(oldLock, originalLock);
  });
  await t.test('concurrent intake mutex', () => {
    const mutex = path.join(f.product, upstream, '.contract-intake.lock');
    mkdirSync(mutex);
    assert.throws(() => ingest(f), /already in progress/);
    assert.equal(existsSync(destination(f)), false);
    rmSync(mutex, { recursive: true });
  });
  await t.test('symlink destination path', () => {
    symlinkSync(f.bundle, destination(f));
    assert.throws(() => ingest(f), /symlink/);
    rmSync(destination(f));
  });
  await t.test('dangling symlink lock', () => {
    symlinkSync(path.join(f.root, 'absent-lock'), lockPath(f));
    assert.throws(() => ingest(f), /symlink/);
    rmSync(lockPath(f));
  });
  await t.test('orphan destination', () => {
    cpSync(f.bundle, destination(f), { recursive: true });
    assert.throws(() => ingest(f), /destination without its lock/);
    rmSync(destination(f), { recursive: true });
  });
  assert.equal(ingest(f).status, 'CREATED');
  const validLock = readFileSync(lockPath(f));
  await t.test('existing lock extra key', () => {
    const lock = JSON.parse(validLock);
    lock.extra = true;
    writeFileSync(lockPath(f), json(lock));
    assert.throws(() => ingest(f), /unexpected fields/);
    writeFileSync(lockPath(f), validLock);
  });
  await t.test('existing lock wrong profile', () => {
    const lock = JSON.parse(validLock);
    lock.profile = 'sopGraph';
    writeFileSync(lockPath(f), json(lock));
    assert.throws(() => ingest(f), /identity/);
    writeFileSync(lockPath(f), validLock);
  });
  await t.test('symlink lock', () => {
    const outside = path.join(f.root, 'outside-lock');
    writeFileSync(outside, validLock);
    rmSync(lockPath(f));
    symlinkSync(outside, lockPath(f));
    assert.throws(() => ingest(f), /symlink/);
    rmSync(lockPath(f));
    writeFileSync(lockPath(f), validLock);
  });
  await t.test('destination bytes collision', () => {
    const file = path.join(destination(f), 'query-transport.v1.json');
    chmodSync(file, 0o644);
    writeFileSync(file, 'collision\n');
    assert.throws(() => ingest(f), /byte size|SHA-256/);
    assert.equal(readFileSync(file, 'utf8'), 'collision\n');
    writeFileSync(file, f.files.get('query-transport.v1.json'));
  });
  await t.test('orphan lock', () => {
    rmSync(destination(f), { recursive: true });
    assert.throws(() => ingest(f), /orphaned/);
    assert.deepEqual(readFileSync(lockPath(f)), validLock);
  });
});

test('v10 staged failure rolls back only its own snapshot and releases the intake mutex', t => {
  const f = fixture(t);
  const before = protectedBytes(f);
  const originalRename = fs.renameSync;
  fs.renameSync = (source, target) => {
    if (path.basename(target) === SOP_UNIFIED_LOCK) throw new Error('Synthetic lock rename failure');
    return originalRename(source, target);
  };
  syncBuiltinESMExports();
  try {
    assert.throws(() => ingest(f), /Synthetic lock rename failure/);
  } finally {
    fs.renameSync = originalRename;
    syncBuiltinESMExports();
  }
  assert.equal(existsSync(destination(f)), false);
  assert.equal(existsSync(lockPath(f)), false);
  assert.equal(existsSync(path.join(f.product, upstream, '.contract-intake.lock')), false);
  assert.deepEqual(readdirSync(path.join(f.product, upstream)).filter(file => file.startsWith('.lock-write-') || file.startsWith('.contract-intake-')), []);
  assert.deepEqual(protectedBytes(f), before);
  assert.equal(ingest(f).status, 'CREATED');
});

test('v10 standalone verification rejects altered locks and unsupported CLI profile selection', t => {
  const f = fixture(t);
  ingest(f);
  assert.throws(() => verifyIngestedSopUnifiedContractSet({ projectRoot: f.product, expectedContractSetId: 'wrong' }), /Unexpected/);
  const lock = readJson(lockPath(f));
  lock.runtime_activated = true;
  writeFileSync(lockPath(f), json(lock));
  assert.throws(() => verifyIngestedSopUnifiedContractSet({ projectRoot: f.product }), /not activated/);
  assert.throws(() => parseCliArguments(['ingest', '--profile=sopUnified']), /Unsupported/);
  assert.throws(() => parseCliArguments(['verify', '--profile=sopGraph']), /Unsupported/);
  assert.equal(verifyContractSetDirectory(path.join(repositoryRoot, upstream, 'cs-ai-c11-openapi-1.25.0-schema-1.30-0fb1dc76ee2b')).manifest.schema, 'customer-agent-contract-set/v8');
});

test('v10 cannot become an active runtime input through a forged active lock', t => {
  const f = fixture(t);
  ingest(f);
  const candidate = readJson(lockPath(f));
  delete candidate.profile;
  candidate.schema = 'customer-agent-contract-consumption/v1';
  writeFileSync(path.join(f.product, upstream, 'contract-set.lock.json'), json(candidate));
  assert.throws(() => verifyIngestedContractSet({ projectRoot: f.product }), /independent candidate lock/);
});
