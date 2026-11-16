import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runOwnerReviewedSopFactsCommand } from './register-owner-reviewed-sop-facts.mjs';

const command = fileURLToPath(new URL('./register-owner-reviewed-sop-facts.mjs', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const token = 't'.repeat(43);
const privateMarker = 'SYNTHETIC_PRIVATE_VALUE_DO_NOT_PRINT';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sop-facts-cli-'));
  const files = Object.fromEntries(['config', 'token-file', 'document', 'original', 'artifact'].map(key => [key, path.join(root, key)]));
  const original = Buffer.from('synthetic original workbook');
  const artifact = Buffer.from('synthetic transformed workbook');
  const originalSha256 = hash(original);
  const document = {
    kind: 'owner-reviewed-file', originalSha256, artifactSha256: hash(artifact), reviewedByPrincipalId: 'director',
    document: { candidateId: 'candidate-a', candidateVersion: 1, sourceId: 'source-a', flowId: 'flow-a',
      graphDigest: 'c'.repeat(64), sopGroup: '品质售后SOP', permissions: [
        { entry: { sourceId: 'source-a', businessEntryId: 'entry-a', scriptVersion: 1 }, risk_level: 'unclassified',
          copy_allowed: null, source_ref: `owner-reviewed-file:${originalSha256}@review-1#entry-a` },
      ] },
  };
  writeFileSync(files.original, original);
  writeFileSync(files.artifact, artifact);
  writeFileSync(files.document, JSON.stringify(document));
  const configuration = { authMode: 'mock', authDatabase: `postgresql://auth:${privateMarker}@localhost/synthetic`,
    businessDatabase: `postgresql://business:${privateMarker}@localhost/synthetic` };
  writeFileSync(files.config, JSON.stringify(configuration), { mode: 0o600 });
  writeFileSync(files['token-file'], `${token}\n`, { mode: 0o600 });
  const args = Object.entries(files).flatMap(([key, value]) => [`--${key}`, value]);
  args.push('--source-version', 'review-1', '--expected-version', '0', '--operation-id', 'test-owner-facts');
  return { root, files, original, artifact, document, configuration, args,
    close: () => rmSync(root, { recursive: true, force: true }) };
}

function replaceArgument(args, key, value) {
  const result = [...args];
  result[result.indexOf(`--${key}`) + 1] = value;
  return result;
}

test('default command validates actual reviewed bytes without reading credentials or opening a runtime', async () => {
  const f = fixture();
  try {
    let opened = 0;
    const args = replaceArgument(replaceArgument(f.args, 'config', path.join(f.root, 'absent-config')), 'token-file', path.join(f.root, 'absent-token'));
    const result = await runOwnerReviewedSopFactsCommand(args, { runtimeFactory: () => { opened += 1; throw Error('unexpected runtime'); } });
    assert.equal(opened, 0);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.output, { status: 'FILES_VALIDATED', databaseChecked: false, writeExecuted: false,
      sourceSha256: hash(Buffer.from(JSON.stringify(f.document))), originalSha256: hash(f.original), artifactSha256: hash(f.artifact), entryCount: 1 });
    const child = spawnSync(process.execPath, [command, ...args], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(JSON.parse(child.stdout).status, 'FILES_VALIDATED');
  } finally { f.close(); }
});

test('unknown, duplicate, missing and relative arguments produce bounded failures', async () => {
  const f = fixture();
  try {
    for (const args of [[...f.args, '--unknown', privateMarker], [...f.args, '--apply', '--apply'],
      f.args.slice(2), replaceArgument(f.args, 'document', './relative'),
      replaceArgument(f.args, 'expected-version', '1e3'), replaceArgument(f.args, 'expected-version', '9007199254740992')]) {
      const result = await runOwnerReviewedSopFactsCommand(args);
      assert.equal(result.exitCode, 1);
      assert.equal(result.output.commit, 'not_attempted');
      assert.equal(JSON.stringify(result).includes(privateMarker), false);
    }
  } finally { f.close(); }
});

test('changed original and transformed bytes are rejected before runtime creation', async () => {
  const f = fixture();
  try {
    let opened = false;
    const runtimeFactory = () => { opened = true; throw Error('unexpected runtime'); };
    writeFileSync(f.files.original, 'synthetic changed original');
    let result = await runOwnerReviewedSopFactsCommand([...f.args, '--apply'], { runtimeFactory });
    assert.equal(result.output.code, 'FILE_HASH_MISMATCH');
    writeFileSync(f.files.original, f.original);
    writeFileSync(f.files.artifact, 'synthetic changed artifact');
    result = await runOwnerReviewedSopFactsCommand([...f.args, '--apply'], { runtimeFactory });
    assert.equal(result.output.code, 'FILE_HASH_MISMATCH');
    assert.equal(opened, false);
  } finally { f.close(); }
});

test('review input rejects symlinks, directories and oversized documents', async () => {
  const f = fixture();
  try {
    const link = path.join(f.root, 'linked-document');
    symlinkSync(f.files.document, link);
    let result = await runOwnerReviewedSopFactsCommand(replaceArgument(f.args, 'document', link));
    assert.equal(result.output.code, 'FILE_INVALID');
    result = await runOwnerReviewedSopFactsCommand(replaceArgument(f.args, 'document', f.root));
    assert.equal(result.output.code, 'FILE_INVALID');
    writeFileSync(f.files.document, Buffer.alloc(1_048_577, 32));
    result = await runOwnerReviewedSopFactsCommand(f.args);
    assert.equal(result.output.code, 'FILE_LIMIT');
  } finally { f.close(); }
});

test('apply rejects public credential files, symlinks and a different database target', async () => {
  const f = fixture();
  try {
    let opened = false;
    const runtimeFactory = () => { opened = true; throw Error('unexpected runtime'); };
    chmodSync(f.files.config, 0o644);
    let result = await runOwnerReviewedSopFactsCommand([...f.args, '--apply'], { runtimeFactory });
    assert.equal(result.output.code, 'PRIVATE_FILE_REQUIRED');
    chmodSync(f.files.config, 0o600);
    chmodSync(f.files['token-file'], 0o640);
    result = await runOwnerReviewedSopFactsCommand([...f.args, '--apply'], { runtimeFactory });
    assert.equal(result.output.code, 'PRIVATE_FILE_REQUIRED');
    chmodSync(f.files['token-file'], 0o600);
    const link = path.join(f.root, 'linked-token');
    symlinkSync(f.files['token-file'], link);
    result = await runOwnerReviewedSopFactsCommand([...replaceArgument(f.args, 'token-file', link), '--apply'], { runtimeFactory });
    assert.equal(result.output.code, 'FILE_INVALID');
    writeFileSync(f.files.config, JSON.stringify({ ...f.configuration, businessDatabase: 'postgresql://business@localhost/different' }));
    result = await runOwnerReviewedSopFactsCommand([...f.args, '--apply'], { runtimeFactory });
    assert.equal(result.output.code, 'DATABASE_TARGET_INVALID');
    assert.equal(opened, false);
    assert.equal(JSON.stringify(result).includes(privateMarker), false);
  } finally { f.close(); }
});

test('apply reuses database configuration rules for remote hosts and driver overrides', async () => {
  const f = fixture();
  try {
    for (const authDatabase of ['postgresql://auth@remote.example/synthetic', 'postgresql://auth@localhost/synthetic?options=-cunsafe',
      'postgresql://auth@localhost/synthetic?host=/tmp/socket&host=/tmp/other', 'not-a-dsn']) {
      writeFileSync(f.files.config, JSON.stringify({ ...f.configuration, authDatabase }));
      const result = await runOwnerReviewedSopFactsCommand([...f.args, '--apply'], { runtimeFactory: () => { throw Error('unexpected runtime'); } });
      assert.equal(result.output.code, 'CONFIG_INVALID');
      assert.equal(result.output.commit, 'not_attempted');
    }
  } finally { f.close(); }
});

test('apply passes exact reviewed bytes and existing token to the runtime and closes resources', async () => {
  const f = fixture();
  try {
    let closed = 0;
    let received;
    const result = await runOwnerReviewedSopFactsCommand([...f.args, '--apply'], { runtimeFactory: async (configuration, existingToken) => {
      assert.equal(existingToken, token);
      assert.equal(configuration.authDatabase.poolMax, 1);
      return { async write(input) { received = input; return { ok: true, value: 1 }; }, async close() { closed += 1; } };
    } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.status, 'APPLIED');
    assert.equal(result.output.commit, 'committed');
    assert.equal(received.operationId, 'test-owner-facts');
    assert.equal(received.expectedVersion, 0);
    assert.equal(received.source.version, 'review-1');
    assert.deepEqual(received.source.bytes, Buffer.from(JSON.stringify(f.document)));
    const raw = JSON.parse(received.source.bytes.toString('utf8'));
    assert.equal(raw.document.permissions[0].risk_level, 'unclassified');
    assert.equal(raw.document.permissions[0].copy_allowed, null);
    assert.equal(closed, 1);
    assert.equal(JSON.stringify(result).includes(token), false);
    assert.equal(JSON.stringify(result).includes(privateMarker), false);
  } finally { f.close(); }
});

test('unknown commit preserves operation identity for a caller retry and never retries automatically', async () => {
  const f = fixture();
  try {
    const operations = [];
    let closed = 0;
    const runtimeFactory = async () => ({ async write(input) {
      operations.push(input.operationId);
      return { ok: false, code: 'OVERLOADED', reason: 'COMMIT_UNKNOWN', commit: 'unknown', diagnosticId: 'intake_00000000-0000-4000-8000-000000000001' };
    }, async close() { closed += 1; } });
    const first = await runOwnerReviewedSopFactsCommand([...f.args, '--apply'], { runtimeFactory });
    assert.equal(first.exitCode, 1);
    assert.equal(first.output.commit, 'unknown');
    assert.equal(operations.length, 1);
    await runOwnerReviewedSopFactsCommand([...f.args, '--apply'], { runtimeFactory });
    assert.deepEqual(operations, ['test-owner-facts', 'test-owner-facts']);
    assert.equal(closed, 2);
  } finally { f.close(); }
});

test('runtime failures suppress raw errors and preserve uncertain write state', async () => {
  const f = fixture();
  try {
    const result = await runOwnerReviewedSopFactsCommand([...f.args, '--apply'], { runtimeFactory: async () => ({
      async write() { throw Error(`${privateMarker} ${token}`); }, async close() {},
    }) });
    assert.deepEqual(result.output, { status: 'FAILED', stage: 'apply', code: 'COMMAND_FAILED', commit: 'unknown' });
    assert.equal(JSON.stringify(result).includes(token), false);
    assert.equal(JSON.stringify(result).includes(privateMarker), false);
  } finally { f.close(); }
});

test('cleanup failure retains the committed write result', async () => {
  const f = fixture();
  try {
    const result = await runOwnerReviewedSopFactsCommand([...f.args, '--apply'], { runtimeFactory: async () => ({
      async write() { return { ok: true, value: 3 }; }, async close() { throw Error(privateMarker); },
    }) });
    assert.equal(result.exitCode, 1);
    assert.equal(result.output.status, 'APPLIED');
    assert.equal(result.output.commit, 'committed');
    assert.equal(result.output.factVersion, 3);
    assert.equal(result.output.cleanup, 'failed');
    assert.equal(JSON.stringify(result).includes(privateMarker), false);
  } finally { f.close(); }
});
