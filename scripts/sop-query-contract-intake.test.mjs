import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ingestContractSet, verifyIngestedContractSet } from './customer-agent-contract-set.mjs';

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const sourceBundle = path.join(
  repositoryRoot,
  'contracts/upstream/customer-agent/cs-ai-c11-openapi-1.25.0-schema-1.30-0fb1dc76ee2b',
);

const json = value => `${JSON.stringify(value, null, 2)}\n`;
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

function runGit(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function copyBundle(target) {
  cpSync(sourceBundle, target, { recursive: true });
}

function makeSource() {
  const source = mkdtempSync(path.join(os.tmpdir(), 'menokin-sop-query-source-'));
  runGit(source, ['init', '--quiet']);
  runGit(source, ['config', 'user.email', 'sop-test@example.invalid']);
  runGit(source, ['config', 'user.name', 'SOP test']);
  const sourceManifest = readJson(path.join(sourceBundle, 'contract-set.json'));
  const files = [
    sourceManifest.openapi,
    sourceManifest.database,
    ...Object.values(sourceManifest.sopGraph),
  ];
  for (const descriptor of files) {
    const target = path.join(source, descriptor.source_path);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(sourceBundle, descriptor.file), target);
  }
  writeFileSync(path.join(source, 'README.md'), 'synthetic source fixture\n');
  runGit(source, ['add', '.']);
  runGit(source, ['commit', '--quiet', '-m', 'synthetic SOP query source']);
  const sourceGitSha = runGit(source, ['rev-parse', 'HEAD']);
  const manifest = {
    ...sourceManifest,
    source_git_sha: sourceGitSha,
    contract_set_id: `cs-ai-c11-openapi-1.25.0-schema-1.30-${sourceGitSha.slice(0, 12)}`,
  };
  const bundle = mkdtempSync(path.join(os.tmpdir(), 'menokin-sop-query-bundle-'));
  copyBundle(bundle);
  chmodSync(path.join(bundle, 'contract-set.json'), 0o644);
  writeFileSync(path.join(bundle, 'contract-set.json'), json(manifest));
  return { source, bundle, manifest };
}

function makeProduct() {
  const product = mkdtempSync(path.join(os.tmpdir(), 'menokin-sop-query-product-'));
  writeFileSync(path.join(product, 'package.json'), JSON.stringify({ name: 'customer-agent-demo' }));
  mkdirSync(path.join(product, 'contracts/upstream'), { recursive: true });
  cpSync(path.join(repositoryRoot, 'contracts/upstream/customer-agent'), path.join(product, 'contracts/upstream/customer-agent'), { recursive: true });
  mkdirSync(path.join(product, 'packages/database'), { recursive: true });
  cpSync(path.join(repositoryRoot, 'packages/database/migrations'), path.join(product, 'packages/database/migrations'), { recursive: true });
  const candidateRoot = path.join(product, 'contracts/upstream/customer-agent');
  const manifest = readJson(path.join(sourceBundle, 'contract-set.json'));
  rmSync(path.join(candidateRoot, manifest.contract_set_id), { recursive: true, force: true });
  rmSync(path.join(candidateRoot, 'sop-query-contract-set.lock.json'), { force: true });
  return product;
}

test('v8 query candidate intake is isolated and idempotent', () => {
  const { source, bundle, manifest } = makeSource();
  const product = makeProduct();
  try {
    const activeLockPath = path.join(product, 'contracts/upstream/customer-agent/contract-set.lock.json');
    const readinessLockPath = path.join(product, 'contracts/upstream/customer-agent/readiness-contract-set.lock.json');
    const migrationManifestPath = path.join(product, 'packages/database/migrations/manifest.generated.json');
    const before = [activeLockPath, readinessLockPath, migrationManifestPath].map(file => readFileSync(file));

    const created = ingestContractSet({ projectRoot: product, sourceDirectory: bundle, sourceRepositoryRoot: source });
    assert.equal(created.status, 'CREATED');
    assert.equal(created.profile, 'sopGraph');
    assert.equal(created.source_git_sha, manifest.source_git_sha);
    assert.equal(created.generateMigrations, false);
    assert.equal(created.generateContracts, false);
    assert.equal(verifyIngestedContractSet({ projectRoot: product }).contract_set_id, 'cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780');

    const candidateLock = readJson(path.join(product, 'contracts/upstream/customer-agent/sop-query-contract-set.lock.json'));
    assert.equal(candidateLock.schema, 'customer-agent-sop-query-contract-consumption/v1');
    assert.equal(candidateLock.profile, 'sopGraph');
    assert.equal(candidateLock.runtime_activated, false);
    const candidateMembersBefore = readdirNames(path.join(product, 'contracts/upstream/customer-agent', manifest.contract_set_id));

    const reused = ingestContractSet({ projectRoot: product, sourceDirectory: bundle, sourceRepositoryRoot: source });
    assert.equal(reused.status, 'REUSED');
    assert.deepEqual([activeLockPath, readinessLockPath, migrationManifestPath].map(file => readFileSync(file)), before);
    assert.deepEqual(readdirNames(path.join(product, 'contracts/upstream/customer-agent', manifest.contract_set_id)), candidateMembersBefore);
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(bundle, { recursive: true, force: true });
    rmSync(product, { recursive: true, force: true });
  }
});

test('v8 query candidate rejects broken package before writing destination', () => {
  const { source, bundle, manifest } = makeSource();
  const product = makeProduct();
  try {
    rmSync(path.join(bundle, 'approval.v1.json'));
    assert.throws(
      () => ingestContractSet({ projectRoot: product, sourceDirectory: bundle, sourceRepositoryRoot: source }),
      /members mismatch|missing|approval/i,
    );
    assert.equal(existsSync(path.join(product, 'contracts/upstream/customer-agent', manifest.contract_set_id)), false);
    assert.equal(existsSync(path.join(product, 'contracts/upstream/customer-agent/sop-query-contract-set.lock.json')), false);
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(bundle, { recursive: true, force: true });
    rmSync(product, { recursive: true, force: true });
  }
});

test('v8 query candidate refuses collision instead of overwriting it', () => {
  const { source, bundle, manifest } = makeSource();
  const product = makeProduct();
  try {
    ingestContractSet({ projectRoot: product, sourceDirectory: bundle, sourceRepositoryRoot: source });
    const destination = path.join(product, 'contracts/upstream/customer-agent', manifest.contract_set_id);
    const target = path.join(destination, 'rules.v1.json');
    chmodSync(target, 0o644);
    writeFileSync(target, `${readFileSync(target, 'utf8')}\ncollision\n`);
    assert.throws(
      () => ingestContractSet({ projectRoot: product, sourceDirectory: bundle, sourceRepositoryRoot: source }),
      /hash|byte|members|SOP query/i,
    );
    assert.match(readFileSync(target, 'utf8'), /collision/);
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(bundle, { recursive: true, force: true });
    rmSync(product, { recursive: true, force: true });
  }
});

function readdirNames(directory) {
  return readdirSync(directory).sort();
}
