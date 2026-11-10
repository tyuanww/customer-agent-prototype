import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('legacy candidate check verifies the complete 86 tail and preserves historical 83/84/85 artifacts', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sop-query-candidate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const relative of ['package.json', 'contracts/upstream/customer-agent', 'packages/database', 'scripts/customer-agent-contract-set.mjs',
    'scripts/readiness-contract.mjs', 'scripts/sop-unified-contract.mjs', 'scripts/sop-unified-corrected-contract.mjs']) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    cpSync(path.join(projectRoot, relative), path.join(root, relative), {
      recursive: true, filter: source => !['node_modules', 'dist'].includes(path.basename(source)),
    });
  }
  const migrationManifest = path.join(root, 'packages/database/migrations/manifest.generated.json');
  const original = readFileSync(migrationManifest, 'utf8');
  const candidateRoot = path.join(root, 'packages/database/candidates/0084_sop_query');
  const artifacts = ['candidate.generated.sql', 'manifest.generated.json'];
  const bytes = artifacts.map(file => readFileSync(path.join(candidateRoot, file)));
  const check = () => spawnSync(process.execPath, [path.join(candidateRoot, 'generate.mjs'), '--check'], { encoding: 'utf8' });
  let result = check();
  assert.equal(result.status, 0, result.stderr);
  const lifecyclePrefix = JSON.parse(original);
  lifecyclePrefix.migrations = lifecyclePrefix.migrations.slice(0, 85);
  delete lifecyclePrefix.compatibility.sop_query_overlay;
  writeFileSync(migrationManifest, JSON.stringify(lifecyclePrefix));
  result = check();
  assert.equal(result.status, 0, result.stderr);
  const storage = JSON.parse(original);
  storage.migrations = storage.migrations.slice(0, 84);
  delete storage.compatibility.sop_lifecycle_overlay;
  delete storage.compatibility.sop_query_overlay;
  writeFileSync(migrationManifest, JSON.stringify(storage));
  result = check();
  assert.equal(result.status, 0, result.stderr);
  const prefix = JSON.parse(original);
  prefix.migrations = prefix.migrations.slice(0, 83);
  delete prefix.compatibility.sop_unified_successor;
  delete prefix.compatibility.sop_lifecycle_overlay;
  delete prefix.compatibility.sop_query_overlay;
  writeFileSync(migrationManifest, JSON.stringify(prefix));
  result = check();
  assert.equal(result.status, 0, result.stderr);
  prefix.migrations[82].source_git_sha = '0'.repeat(40);
  writeFileSync(migrationManifest, JSON.stringify(prefix));
  assert.match(check().stderr, /immutable 0083 predecessor/);
  writeFileSync(migrationManifest, original);
  const lifecycle = JSON.parse(original);
  lifecycle.migrations[84].sha256 = '0'.repeat(64);
  writeFileSync(migrationManifest, JSON.stringify(lifecycle));
  assert.match(check().stderr, /lifecycle implementation metadata drift/);
  writeFileSync(migrationManifest, original);
  const lastPrefix = path.join(root, 'packages/database/migrations/0083_sop_pipeline_projection.sql');
  writeFileSync(lastPrefix, `${readFileSync(lastPrefix, 'utf8')}\n-- drift`);
  assert.match(check().stderr, /Candidate predecessor bytes drift/);
  artifacts.forEach((file, index) => assert.deepEqual(readFileSync(path.join(candidateRoot, file)), bytes[index]));
});
