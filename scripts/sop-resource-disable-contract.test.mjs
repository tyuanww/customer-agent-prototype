import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseCliArguments, verifyContractSetDirectory, verifyIngestedSopResourceDisableContractSet, verifyIngestedCorrectedSopResourceDisableContractSet, verifyCurrentSopResourceDisableContractSet } from './customer-agent-contract-set.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstream = path.join(root, 'contracts/upstream/customer-agent');
const lockPath = path.join(upstream, 'sop-resource-disable-contract-set.lock.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function withChangedSnapshot(change, pattern, snapshotLockPath = lockPath) {
  const lock = JSON.parse(readFileSync(snapshotLockPath, 'utf8'));
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sop-resource-intake-'));
  try {
    cpSync(path.join(upstream, lock.contract_set_id), directory, { recursive: true });
    const manifestPath = path.join(directory, 'contract-set.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const update = (key, mutate) => {
      const descriptor = manifest.resourceDisable[key];
      const file = path.join(directory, descriptor.file);
      const value = JSON.parse(readFileSync(file, 'utf8'));
      mutate(value);
      const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
      chmodSync(file, 0o600);
      writeFileSync(file, bytes);
      descriptor.sha256 = hash(bytes);
      descriptor.bytes = bytes.length;
      if (key !== 'provenance') update('provenance', provenance => {
        provenance.artifacts[descriptor.file] = { sha256: descriptor.sha256, bytes: descriptor.bytes };
      });
    };
    change({ directory, manifest, update });
    chmodSync(manifestPath, 0o600);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => verifyContractSetDirectory(directory), pattern);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('resource profile has an explicit verify CLI selector', () => {
  assert.deepEqual(parseCliArguments(['verify', '--profile=sopResourceDisable']), {
    command: 'verify', options: { profile: 'sopResourceDisable' },
  });
  assert.throws(() => parseCliArguments(['verify', '--profile=resourceDisable']), /Unsupported/);
  assert.throws(() => parseCliArguments(['ingest', '--profile=sopResourceDisable']), /Unsupported/);
});

test('the accepted resource snapshot verifies all 30 physical members with an independent inactive lock', () => {
  const result = verifyIngestedSopResourceDisableContractSet({ projectRoot: root });
  const snapshot = verifyContractSetDirectory(result.path);
  assert.equal(snapshot.manifest.schema, 'customer-agent-contract-set/v12');
  assert.equal(Object.keys(snapshot.manifest.resourceDisable).length, 13);
  assert.equal(Object.keys(snapshot.manifest.legacyV11.members).length, 14);
  assert.equal(result.runtime_activated, false);
  assert.equal(result.ddev_authorized, false);
  assert.equal(result.generateMigrations, false);
  assert.equal(result.generateContracts, false);
});

for (const [name, change, pattern] of [
  ['unrecognized top-level field', ({ manifest }) => { manifest.extra = true; }, /unexpected fields/],
  ['unrecognized resource field', ({ manifest }) => { manifest.resourceDisable.extra = manifest.openapi; }, /unexpected fields/],
  ['unrecognized legacy field', ({ manifest }) => { manifest.legacyV11.extra = true; }, /unexpected fields/],
  ['mismatched version pair', ({ manifest }) => { manifest.openapi.version = '1.29.1'; }, /descriptor/],
  ['short source SHA', ({ manifest }) => { manifest.source_git_sha = manifest.source_git_sha.slice(0, 12); }, /identity/],
  ['unapproved full source SHA', ({ manifest }) => { manifest.source_git_sha = 'a'.repeat(40); manifest.contract_set_id = 'cs-ai-c11-openapi-1.30.0-schema-1.34-aaaaaaaaaaaa'; }, /identity/],
  ['wrong manifest suffix', ({ manifest }) => { manifest.contract_set_id += 'x'; }, /identity/],
  ['missing legacy member', ({ manifest }) => { delete manifest.legacyV11.members['contract-set.json']; }, /unexpected fields/],
  ['oversized artifact', ({ manifest }) => { manifest.openapi.bytes = 33554433; }, /export bound/],
  ['unsafe source path', ({ manifest }) => { manifest.openapi.source_path = '../openapi.v1.yaml'; }, /source_path/],
  ['extra physical member', ({ directory }) => { writeFileSync(path.join(directory, 'extra.json'), '{}'); }, /members mismatch/],
  ['missing physical member', ({ directory }) => { rmSync(path.join(directory, 'v11-storage.v1.sql')); }, /members mismatch/],
  ['symlink member', ({ directory }) => {
    const file = path.join(directory, 'openapi.v1.yaml');
    rmSync(file);
    symlinkSync(path.join(directory, 'v11-openapi.v1.yaml'), file);
  }, /regular non-symlink/],
  ['changed artifact bytes', ({ directory }) => {
    const file = path.join(directory, 'storage.v1.sql');
    chmodSync(file, 0o600);
    writeFileSync(file, '\n', { flag: 'a' });
  }, /byte size mismatch/],
  ['runtime activation even with a rehashed descriptor', ({ update }) => { update('installation', value => { value.runtimeActivated = true; }); }, /runtimeActivated/],
  ['changed handoff projection', ({ update }) => { update('handoff', value => { value.schemas.IntakeResourceDisableKey.oneOf = [{ type: 'string' }]; }); }, /handoff field projections/],
  ['coordinated artifact and provenance rewrite', ({ update }) => { update('coverage', value => { value.headerSchemas = 0; }); }, /frozen manifest/],
  ['unclosed source provenance', ({ update }) => { update('provenance', value => { value.sources['unapproved.js'] = 'a'.repeat(64); }); }, /source closure/],
]) {
  test(`resource intake rejects ${name}`, () => withChangedSnapshot(change, pattern));
}


test('the corrected resource lock preserves the frozen v12 and selects the independent v13 source', () => {
  const original = verifyIngestedSopResourceDisableContractSet({ projectRoot: root });
  const corrected = verifyIngestedCorrectedSopResourceDisableContractSet({ projectRoot: root });
  const current = verifyCurrentSopResourceDisableContractSet({ projectRoot: root });
  assert.equal(original.contract_set_id, 'cs-ai-c11-openapi-1.30.0-schema-1.34-0405c5651564');
  assert.equal(corrected.contract_set_id, 'cs-ai-c11-openapi-1.30.1-schema-1.35-5fb5c1285056');
  assert.equal(current.contract_set_id, corrected.contract_set_id);
  assert.notEqual(original.lock_path, corrected.lock_path);
  const snapshot = verifyContractSetDirectory(corrected.path);
  assert.equal(snapshot.manifest.schema, 'customer-agent-contract-set/v13');
  assert.equal(snapshot.manifest.openapi.version, '1.30.1');
  assert.equal(corrected.runtime_activated, false);
  assert.equal(corrected.generateMigrations, false);
  assert.equal(parseCliArguments(['verify', '--profile=sopResourceDisableCorrected']).options.profile, 'sopResourceDisableCorrected');
});

for (const [name, change, pattern] of [
  ['original schema with corrected identity', ({ manifest }) => { manifest.schema = 'customer-agent-contract-set/v12'; }, /identity/],
  ['original OpenAPI version', ({ manifest }) => { manifest.openapi.version = '1.30.0'; }, /descriptor/],
  ['unallocated source SHA', ({ manifest }) => {
    manifest.source_git_sha = 'a'.repeat(40);
    manifest.contract_set_id = 'cs-ai-c11-openapi-1.30.1-schema-1.35-aaaaaaaaaaaa';
  }, /identity/],
]) {
  test(`corrected resource intake rejects ${name}`, () => {
    withChangedSnapshot(change, pattern, path.join(upstream, 'sop-resource-disable-corrected-contract-set.lock.json'));
  });
}
