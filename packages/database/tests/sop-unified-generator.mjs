import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildDatabaseMigrationOutputs, generateDatabaseMigrations } from '../scripts/generate-migrations.mjs';
import { verifyIngestedCorrectedSopUnifiedContractSet, withVerifiedContractSetSnapshot } from '../../../scripts/customer-agent-contract-set.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const unified = verifyIngestedCorrectedSopUnifiedContractSet({ projectRoot });
const manifest = JSON.parse(readFileSync(path.join(unified.path, 'contract-set.json'), 'utf8'));
const storage = readFileSync(path.join(unified.path, manifest.sopUnified.storage.file), 'utf8');

function copyProduct(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sop-unified-generator-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'package.json'), '{"name":"customer-agent-demo","private":true}\n');
  for (const relative of ['contracts/upstream/customer-agent', 'packages/database']) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    cpSync(path.join(projectRoot, relative), path.join(root, relative), {
      recursive: true, filter: source => !['node_modules', 'dist'].includes(path.basename(source)),
    });
  }
  return root;
}

test('formal generator appends only the verified unified storage and preserves the exact prefix', async () => {
  await withVerifiedContractSetSnapshot({ projectRoot }, snapshot => {
    const prior = buildDatabaseMigrationOutputs(snapshot, { projectRoot });
    const input = { ...snapshot, sopUnified: { manifest, storage_source: storage } };
    const first = buildDatabaseMigrationOutputs(input, { projectRoot });
    const second = buildDatabaseMigrationOutputs(input, { projectRoot });
    assert.equal(prior.migrations.length, 83);
    assert.equal(first.migrations.length, 86);
    assert.deepEqual(first.migrations.slice(0, 83), prior.migrations);
    assert.deepEqual(first.outputs, second.outputs);
    assert.equal(sha256(JSON.stringify(first.manifest.migrations.slice(0, 83))), '21bbce897e23f9f3e5fcdc8a0d52d1dadd42af7f22433b425f1c7c7eed676fae');
    const added = first.migrations[83];
    assert.equal(added.id, '0084_sop_unified_storage');
    assert.equal(manifest.schema, 'customer-agent-contract-set/v11');
    assert.equal(manifest.openapi.version, '1.29.1');
    assert.throws(() => buildDatabaseMigrationOutputs({ ...input, sopUnified: {
      manifest: { ...manifest, schema: 'customer-agent-contract-set/v10' }, storage_source: storage,
    } }, { projectRoot }), /bytes or transaction boundary drifted/);
    assert.equal(added.source_git_sha, manifest.source_git_sha);
    assert.equal(added.contract_set_id, manifest.contract_set_id);
    assert.equal(added.source_schema_sha256, manifest.database.sha256);
    assert.ok(added.sql.includes(storage.trimEnd()));
    assert.equal(added.sql.includes('sop_query_normalize'), false);
    assert.equal(added.sql.includes('CREATE TABLE public.content_current'), false);
    assert.equal(sha256(added.sql), added.sha256);
    const lifecycle = first.migrations[84];
    assert.equal(lifecycle.id, '0085_sop_unified_lifecycle');
    assert.equal(lifecycle.source_git_sha, manifest.source_git_sha);
    assert.equal(sha256(lifecycle.sql), lifecycle.sha256);
    assert.equal(first.manifest.compatibility.sop_lifecycle_overlay.migration_sha256, lifecycle.sha256);
    assert.ok(lifecycle.sql.includes(readFileSync(path.join(projectRoot, 'packages/database/overlays/0085_sop_unified_lifecycle.sql'), 'utf8').trimEnd()));
    const query = first.migrations[85];
    assert.equal(query.id, '0086_sop_unified_query');
    assert.equal(first.manifest.compatibility.sop_query_overlay.migration_sha256, query.sha256);
    assert.equal(sha256(query.sql), query.sha256);

    assert.throws(() => buildDatabaseMigrationOutputs({ ...input,
      sopUnified: { manifest, storage_source: `${storage}\n-- drift` } }, { projectRoot }), /bytes or transaction boundary drifted/);
    assert.throws(() => buildDatabaseMigrationOutputs({ ...snapshot,
      readiness: undefined, sopUnified: input.sopUnified }, { projectRoot }), /immutable 83-migration predecessor/);
    const transaction = `BEGIN;\n${storage}`;
    assert.throws(() => buildDatabaseMigrationOutputs({ ...input, sopUnified: {
      storage_source: transaction,
      manifest: { ...manifest, sopUnified: { ...manifest.sopUnified, storage: {
        ...manifest.sopUnified.storage, sha256: sha256(transaction),
      } } },
    } }, { projectRoot }), /transaction boundary drifted/);
  });
});

test('existing generation check rejects artifact drift and missing unified source without rewriting outputs', async t => {
  const root = copyProduct(t);
  assert.equal((await generateDatabaseMigrations({ projectRoot: root, check: true })).status, 'VERIFIED');
  const target = path.join(root, 'packages/database/migrations/0084_sop_unified_storage.sql');
  const original = readFileSync(target, 'utf8');
  writeFileSync(target, `${original}\n-- tampered`);
  await assert.rejects(generateDatabaseMigrations({ projectRoot: root, check: true }), /SOP unified migration bytes drift/);
  assert.equal(readFileSync(target, 'utf8'), `${original}\n-- tampered`);
  writeFileSync(target, original);
  rmSync(path.join(root, 'contracts/upstream/customer-agent/sop-unified-corrected-contract-set.lock.json'));
  await assert.rejects(generateDatabaseMigrations({ projectRoot: root }), /SOP corrected unified lock/);
  assert.equal(readFileSync(target, 'utf8'), original);
});

test('snapshot consumption accepts only the locked formal 85 and its immutable predecessors', async t => {
  const root = copyProduct(t);
  const migrationManifest = path.join(root, 'packages/database/migrations/manifest.generated.json');
  const originalManifest = readFileSync(migrationManifest, 'utf8');
  const consume = () => withVerifiedContractSetSnapshot({ projectRoot: root }, () => {
    verifyIngestedCorrectedSopUnifiedContractSet({ projectRoot: root });
    return 'verified';
  });
  assert.equal(await consume(), 'verified');
  const mutations = [
    value => { value.migrations.push(value.migrations[83]); },
    value => { value.migrations[83].id = '0084_sop_query_candidate'; },
    value => { value.migrations[83].source_ranges = [{ start_line: 1, end_line: 1 }]; },
    value => { value.migrations[83].source_git_sha = '0'.repeat(40); },
    value => { value.migrations[83].bytes += 1; },
    value => { value.migrations[83].sha256 = '0'.repeat(64); },
    value => { value.migrations[83].unexpected = true; },
    value => { value.compatibility.sop_unified_successor.storage_sha256 = '0'.repeat(64); },
    value => { value.compatibility.sop_unified_successor.migration_sha256 = '0'.repeat(64); },
    value => { value.migrations[82].source_git_sha = '0'.repeat(40); },
    value => { value.migrations.pop(); },
    value => { value.migrations[84].id = '0085_other'; },
    value => { value.migrations[84].sha256 = '0'.repeat(64); },
    value => { value.migrations[84].source_ranges = [{ start_line: 1, end_line: 1 }]; },
    value => { value.compatibility.sop_lifecycle_overlay.source_sha256 = '0'.repeat(64); },
    value => { value.compatibility.sop_lifecycle_overlay.migration_sha256 = '0'.repeat(64); },
  ];
  for (const mutate of mutations) {
    const value = JSON.parse(originalManifest);
    mutate(value);
    writeFileSync(migrationManifest, `${JSON.stringify(value, null, 2)}\n`);
    await assert.rejects(consume());
    writeFileSync(migrationManifest, originalManifest);
  }
  const relativeFiles = [
    'packages/database/migrations/0083_sop_pipeline_projection.sql',
    'packages/database/migrations/0084_sop_unified_storage.sql',
    'packages/database/migrations/0085_sop_unified_lifecycle.sql',
    'packages/database/overlays/0085_sop_unified_lifecycle.sql',
    'contracts/upstream/customer-agent/sop-unified-contract-set.lock.json',
    'contracts/upstream/customer-agent/sop-unified-corrected-contract-set.lock.json',
    `contracts/upstream/customer-agent/${manifest.contract_set_id}/storage.v1.sql`,
    `contracts/upstream/customer-agent/${manifest.contract_set_id}/authorization.v1.json`,
  ];
  for (const relative of relativeFiles) {
    const file = path.join(root, relative);
    const bytes = readFileSync(file);
    chmodSync(file, 0o644);
    writeFileSync(file, Buffer.concat([bytes, Buffer.from('\n-- drift')]));
    await assert.rejects(consume());
    writeFileSync(file, bytes);
    rmSync(file);
    symlinkSync(path.join(projectRoot, relative), file);
    await assert.rejects(consume(), /symlink|symbolic|regular|escapes/i);
    rmSync(file);
    writeFileSync(file, bytes);
  }
  const lockPath = path.join(root, 'contracts/upstream/customer-agent/sop-unified-corrected-contract-set.lock.json');
  const originalLock = readFileSync(lockPath, 'utf8');
  for (const change of [{ runtime_activated: true }, { profile: 'sopUnified' }, { manifest_sha256: '0'.repeat(64) }]) {
    writeFileSync(lockPath, JSON.stringify({ ...JSON.parse(originalLock), ...change }));
    await assert.rejects(consume());
  }
  writeFileSync(lockPath, originalLock);
  assert.equal(await consume(), 'verified');
});
