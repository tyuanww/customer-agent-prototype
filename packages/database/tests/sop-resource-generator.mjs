import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildDatabaseMigrationOutputs } from '../scripts/generate-migrations.mjs';
import { verifyIngestedCorrectedSopUnifiedContractSet, verifyIngestedSopResourceDisableContractSet, withVerifiedContractSetSnapshot } from '../../../scripts/customer-agent-contract-set.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const hash = value => createHash('sha256').update(value).digest('hex');
function source(verified, field) {
  const manifest = JSON.parse(readFileSync(path.join(verified.path, 'contract-set.json')));
  return { manifest, storage_source: readFileSync(path.join(verified.path, manifest[field].storage.file), 'utf8') };
}
test('resource lifecycle generation pins the actual source and preserves all 87 predecessor descriptors and SQL', async t => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'sop-resource-generator-'));
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'customer-agent-demo', private: true }));
  for (const relative of ['contracts/upstream/customer-agent', 'packages/database']) {
    mkdirSync(path.dirname(path.join(projectRoot, relative)), { recursive: true });
    cpSync(path.join(root, relative), path.join(projectRoot, relative), { recursive: true,
      filter: source => !['node_modules', 'dist'].includes(path.basename(source)) });
  }
  const sopUnified = source(verifyIngestedCorrectedSopUnifiedContractSet({ projectRoot }), 'sopUnified');
  const sopResource = source(verifyIngestedSopResourceDisableContractSet({ projectRoot }), 'resourceDisable');
  await withVerifiedContractSetSnapshot({ projectRoot }, snapshot => {
    const prior = buildDatabaseMigrationOutputs({ ...snapshot, sopUnified }, { projectRoot });
    const result = buildDatabaseMigrationOutputs({ ...snapshot, sopUnified, sopResource }, { projectRoot });
    assert.equal(prior.migrations.length, 87); assert.equal(result.migrations.length, 88);
    assert.deepEqual(result.migrations.slice(0, 87), prior.migrations);
    assert.equal(hash(JSON.stringify(result.manifest.migrations.slice(0, 87))), '3d48f9989552918848421d2e2650d8da0bea80515cc728cdb790afcae4a1e8ae');
    const final = result.migrations[87];
    assert.equal(final.id, '0088_sop_resource_lifecycle');
    assert.equal(final.source_git_sha, '0405c5651564958702ddd5484bbf41a0f193515f');
    assert.equal(hash(final.sql), final.sha256);
    assert.ok(final.sql.includes(sopResource.storage_source.trimEnd()));
    assert.throws(() => buildDatabaseMigrationOutputs({ ...snapshot, sopUnified, sopResource: {
      ...sopResource, storage_source: `${sopResource.storage_source}\n-- drift`,
    } }, { projectRoot }), /source drifted/);
    assert.throws(() => buildDatabaseMigrationOutputs({ ...snapshot, sopUnified, sopResource: {
      ...sopResource, manifest: { ...sopResource.manifest, source_git_sha: '0'.repeat(40) },
    } }, { projectRoot }), /source drifted/);
  });
});
