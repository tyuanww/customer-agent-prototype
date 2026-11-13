import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BACKUP_SET_SCHEMA,
  DATABASE_DUMP_FILE,
  MANIFEST_DIGEST_FILE,
  MANIFEST_FILE,
  OBJECTS_ARCHIVE_FILE,
  ROLES_FILE,
  createBackupSet,
  assertCandidateBuildDigests,
  assertCandidateRuntimeUnchanged,
  extractObjectArchive,
  inspectObjectArchive,
  inspectObjectStore,
  loadStackProfile,
  pruneVerifiedBackupSets,
  readCandidateRelease,
  replicationConfiguration,
  verifyBackupSet,
} from './backup-set.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '../..');
const productVersion = readFileSync(path.join(repositoryRoot, 'VERSION'), 'utf8').trim();
const databaseName = 'customer_agent_intake_test';
const objectId = `obj_${'1'.repeat(64)}`;
const otherObjectId = `obj_${'2'.repeat(64)}`;

test('backup rejects a non-boolean preservation option before accessing the stack', async () => {
  await assert.rejects(createBackupSet({ preserveExisting: 'true' }), { code: 'BACKUP_ARGUMENT_INVALID' });
});

test('backup rejects unknown options before accessing the stack', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-backup-option-'));
  try {
    const backupRoot = path.join(root, 'backups');
    const result = spawnSync(process.execPath, [path.join(testDirectory, 'backup-set.mjs'), 'backup', '--preserve-exisitng'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 30_000,
      env: { PATH: process.env.PATH, CUSTOMER_AGENT_STACK_ROOT: path.join(root, 'missing-profile'),
        CUSTOMER_AGENT_BACKUP_ROOT: backupRoot, CUSTOMER_AGENT_PG15_BIN: path.join(root, 'missing-pg15') },
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /BACKUP_ARGUMENT_INVALID/);
    assert.equal(existsSync(backupRoot), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('backup wrapper forwards and rejects unsupported options', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-backup-wrapper-option-'));
  try {
    const backupRoot = path.join(root, 'backups');
    const wrapper = path.join(root, 'customer-agent-backup.sh');
    const marker = path.join(root, 'alert-invoked');
    copyFileSync(path.join(testDirectory, 'customer-agent-backup.sh'), wrapper);
    copyFileSync(path.join(testDirectory, 'backup-set.mjs'), path.join(root, 'backup-set.mjs'));
    copyFileSync(path.join(testDirectory, 'release-proof.mjs'), path.join(root, 'release-proof.mjs'));
    writeFileSync(path.join(root, 'send-ops-alert.sh'), `#!/bin/sh\ntouch "$ALERT_MARKER"\n`, { mode: 0o755 });
    const environment = { PATH: process.env.PATH, ALERT_MARKER: marker, FEISHU_ALERT_WEBHOOK: '',
      CUSTOMER_AGENT_MONITOR_ENV: path.join(root, 'no-monitor-env'), CUSTOMER_AGENT_STACK_ROOT: path.join(root, 'missing-profile'),
      CUSTOMER_AGENT_BACKUP_ROOT: backupRoot, CUSTOMER_AGENT_PG15_BIN: path.join(root, 'missing-pg15') };
    for (const args of [['--preserve-exisitng'], ['--preserve-existing', '--preserve-existing']]) {
      const result = spawnSync('bash', [wrapper, ...args], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        timeout: 30_000,
        env: environment,
      });
      assert.equal(existsSync(marker), false);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /BACKUP_ARGUMENT_INVALID/);
      assert.equal(existsSync(backupRoot), false);
    }
    const failure = spawnSync('bash', [wrapper], { cwd: repositoryRoot, encoding: 'utf8', timeout: 30_000, env: environment });
    assert.equal(failure.status, 1);
    assert.equal(existsSync(marker), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const wrapper of ['customer-agent-backup.sh', 'customer-agent-restore-drill.sh']) {
  test(`${wrapper} CLI refuses invalid input through a symbolic release path`, { skip: process.platform === 'win32' }, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-backup-cli-'));
    try {
      const current = path.join(root, 'current');
      symlinkSync(testDirectory, current, 'dir');
      const child = spawnSync('/bin/bash', [path.join(current, wrapper)], {
        encoding: 'utf8', timeout: 30_000,
        env: { ...process.env,
          FEISHU_ALERT_WEBHOOK: '',
          CUSTOMER_AGENT_MONITOR_ENV: path.join(root, 'no-monitor-env'),
          CUSTOMER_AGENT_STACK_ROOT: path.join(root, 'missing-profile'),
          CUSTOMER_AGENT_BACKUP_ROOT: path.join(root, 'backups'),
          CUSTOMER_AGENT_BACKUP_COPY_TO: '',
          CUSTOMER_AGENT_PG15_BIN: path.join(root, 'missing-pg15'),
        },
      });
      assert.equal(child.status, 1, `invalid input must fail; stderr=${child.stderr}`);
      assert.match(child.stderr, /FATAL (PROFILE_INVALID|PG15_REQUIRED|BACKUP_SET_FAILED)/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
const batchId = 'imp_backup_fixture_01';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function temporaryDirectory(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeTar(store, archive) {
  execFileSync('tar', [
    '--format=ustar',
    '--create',
    '--file', archive,
    '--directory', store,
    'objects',
    'batches',
  ]);
}

function artifactSummary(directory, file) {
  const bytes = readFileSync(path.join(directory, file));
  return { file, bytes: bytes.length, sha256: sha256(bytes) };
}

function writeManifest(directory, manifest) {
  const raw = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(path.join(directory, MANIFEST_FILE), raw);
  writeFileSync(path.join(directory, MANIFEST_DIGEST_FILE), `${sha256(raw)}  ${MANIFEST_FILE}\n`);
}

function fixtureSet(root, id, options = {}) {
  const directory = path.join(root, id);
  const store = path.join(directory, '.object-fixture');
  const objectRoot = path.join(store, 'objects');
  const receiptRoot = path.join(store, 'batches');
  mkdirSync(objectRoot, { recursive: true });
  mkdirSync(receiptRoot, { recursive: true });

  const objectBytes = Buffer.from(options.objectBytes ?? 'synthetic object bytes');
  const otherBytes = Buffer.from('unreferenced legacy object');
  writeFileSync(path.join(objectRoot, objectId), objectBytes);
  writeFileSync(path.join(objectRoot, otherObjectId), otherBytes);
  const receipt = {
    importBatchId: batchId,
    objectId,
    sourceType: 'csv',
    sha256: sha256(objectBytes),
    sizeBytes: objectBytes.length,
    sourceBindingHash: 'a'.repeat(64),
    sourceBindings: [{ domain: 'product', source_version_id: 'srcv_fixture' }],
  };
  const receiptRaw = Buffer.from(JSON.stringify(receipt));
  writeFileSync(path.join(receiptRoot, `${batchId}.json`), receiptRaw);
  writeTar(store, path.join(directory, OBJECTS_ARCHIVE_FILE));
  rmSync(store, { recursive: true });

  writeFileSync(path.join(directory, DATABASE_DUMP_FILE), Buffer.from('fixture custom dump'));
  writeFileSync(path.join(directory, ROLES_FILE), [
    'DO $fixture$ BEGIN',
    "  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN",
    '    CREATE ROLE app_runtime NOLOGIN;',
    '  END IF;',
    'END $fixture$;',
    '',
  ].join('\n'));

  const migrations = [{
    position: 1,
    migrationId: '0001_extensions',
    sha256: '3'.repeat(64),
    contractSetId: 'fixture-contract',
    sourceGitSha: '4'.repeat(40),
    sourceSchemaSha256: '5'.repeat(64),
    appliedAt: '2026-01-01T00:00:00.000Z',
    executionMs: 1,
  }];
  const roles = [{
    name: 'gate_owner',
    login: true,
    superuser: true,
    createdb: true,
    createrole: true,
    inherit: true,
    replication: false,
    bypassrls: false,
    memberships: [],
  }];
  const manifest = {
    schema: BACKUP_SET_SCHEMA,
    schemaVersion: 1,
    backupId: id,
    databaseName,
    startedAt: '2026-01-01T00:00:00.000Z',
    snapshotAt: '2026-01-01T00:00:00.250Z',
    dumpStartedAt: '2026-01-01T00:00:00.500Z',
    dumpCompletedAt: '2026-01-01T00:00:00.750Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    application: {
      productVersion,
      productVersionSource: 'release-version-file',
      gitSha: null,
      gitShaSource: 'not-provided',
    },
    tooling: { implementation: 'scripts/ops/backup-set.mjs', sha256: '9'.repeat(64) },
    artifacts: {
      databaseDump: artifactSummary(directory, DATABASE_DUMP_FILE),
      roles: artifactSummary(directory, ROLES_FILE),
      objectsArchive: artifactSummary(directory, OBJECTS_ARCHIVE_FILE),
    },
    database: {
      databaseOwner: 'gate_owner',
      migrations,
      migrationDigest: sha256(canonicalJson(migrations.map((migration) => ({
        position: migration.position,
        migrationId: migration.migrationId,
        sha256: migration.sha256,
        contractSetId: migration.contractSetId,
        sourceGitSha: migration.sourceGitSha,
        sourceSchemaSha256: migration.sourceSchemaSha256,
      })))),
      objects: [{
        objectId,
        objectKey: `intake/${objectId}`,
        sha256: sha256(objectBytes),
        bytes: objectBytes.length,
      }],
      importBatches: [{
        importBatchId: batchId,
        sourceType: 'csv',
        sourceRef: objectId,
        sourceSha256: sha256(objectBytes),
        sourceSizeBytes: objectBytes.length,
        sourceBindingHash: 'a'.repeat(64),
        status: 'validating',
      }],
      roles,
      rolesFingerprint: sha256(canonicalJson(roles)),
      roleCount: 1,
      ownershipFingerprint: '8'.repeat(64),
      aclFingerprint: '7'.repeat(64),
    },
    objects: {
      files: [
        {
          objectId,
          path: `objects/${objectId}`,
          bytes: objectBytes.length,
          sha256: sha256(objectBytes),
          databaseReferenced: true,
          receiptReferenced: true,
        },
        {
          objectId: otherObjectId,
          path: `objects/${otherObjectId}`,
          bytes: otherBytes.length,
          sha256: sha256(otherBytes),
          databaseReferenced: false,
          receiptReferenced: false,
        },
      ],
      receipts: [{
        importBatchId: batchId,
        objectId,
        sha256: sha256(objectBytes),
        sizeBytes: objectBytes.length,
        sourceBindingHash: 'a'.repeat(64),
        receiptPath: `batches/${batchId}.json`,
        receiptBytes: receiptRaw.length,
        receiptSha256: sha256(receiptRaw),
        durableDatabaseBatch: true,
      }],
      unreferencedObjectIds: [otherObjectId],
    },
    replication: { mode: 'none', durability: 'not-assessed', destinationIdSha256: null },
  };
  writeManifest(directory, manifest);
  return { directory, manifest, receipt, objectBytes, otherBytes };
}

function rawTarHeader(name) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 'ascii');
  header.write('0000000\0', 108, 'ascii');
  header.write('0000000\0', 116, 'ascii');
  header.write('00000000000\0', 124, 'ascii');
  header.write('00000000000\0', 136, 'ascii');
  header.fill(0x20, 148, 156);
  header.write('0', 156, 'ascii');
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return header;
}

test('profile is the source for the database and object paths', () => {
  const root = temporaryDirectory('customer-agent-backup-profile-');
  try {
    const socket = path.join(root, 'socket');
    const objects = path.join(root, 'objects');
    mkdirSync(socket);
    mkdirSync(objects);
    writeFileSync(path.join(root, 'profile.json'), JSON.stringify({
      version: 1,
      stackRoot: root,
      databaseName,
      pgPort: 43199,
      pgSocketDirectory: socket,
      objectStoreDirectory: objects,
    }));
    const profile = loadStackProfile({ stackRoot: root });
    assert.equal(profile.databaseName, databaseName);
    assert.equal(profile.pgSocketDirectory, execFileSync('realpath', [socket], { encoding: 'utf8' }).trim());
    assert.equal(profile.objectStoreDirectory, execFileSync('realpath', [objects], { encoding: 'utf8' }).trim());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unavailable database prevents backup staging', async () => {
  const root = temporaryDirectory('customer-agent-backup-failure-');
  try {
    const backupRoot = path.join(root, 'backups');
    await assert.rejects(
      createBackupSet({
        backupRoot,
        stack: {
          databaseName,
          pgPort: 1,
          pgSocketDirectory: path.join(root, 'missing-socket'),
          objectStoreDirectory: path.join(root, 'objects'),
        },
        pgBin: path.join(root, 'unused-pg-bin'),
      }),
      (error) => error instanceof Error && 'code' in error && error.code === 'BACKUP_LOCK_FAILED',
    );
    assert.deepEqual(readdirSync(backupRoot), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('backup set consumer rejects missing, corrupt, and tampered artifacts', async () => {
  const root = temporaryDirectory('customer-agent-backup-verify-');
  try {
    const id = `${databaseName}-20260101T000001Z-001`;
    const fixture = fixtureSet(root, id);
    const verified = await verifyBackupSet(fixture.directory);
    assert.equal(verified.manifest.backupId, id);

    const missing = path.join(root, `${databaseName}-20260101T000002Z-001`);
    fixtureSet(root, path.basename(missing));
    rmSync(path.join(missing, OBJECTS_ARCHIVE_FILE));
    await assert.rejects(
      verifyBackupSet(missing),
      (error) => error instanceof Error && 'code' in error && error.code === 'BACKUP_ARTIFACT_MISSING',
    );

    const corrupt = path.join(root, `${databaseName}-20260101T000003Z-001`);
    const corruptFixture = fixtureSet(root, path.basename(corrupt));
    writeFileSync(path.join(corrupt, DATABASE_DUMP_FILE), 'corrupt');
    await assert.rejects(
      verifyBackupSet(corrupt),
      (error) => error instanceof Error && 'code' in error && error.code === 'BACKUP_ARTIFACT_SIZE_MISMATCH',
    );
    assert.equal(corruptFixture.manifest.databaseName, databaseName);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('backup set consumer requires an ACL fingerprint', async () => {
  const root = temporaryDirectory('customer-agent-backup-acl-');
  try {
    const id = `${databaseName}-20260101T000001Z-001`;
    const fixture = fixtureSet(root, id);
    const manifest = JSON.parse(readFileSync(path.join(fixture.directory, MANIFEST_FILE), 'utf8'));
    delete manifest.database.aclFingerprint;
    writeManifest(fixture.directory, manifest);
    await assert.rejects(
      verifyBackupSet(fixture.directory),
      (error) => error instanceof Error && 'code' in error && error.code === 'MANIFEST_INVALID',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('object extraction rejects content that differs from the manifest', async () => {
  const root = temporaryDirectory('customer-agent-backup-object-tamper-');
  try {
    const id = `${databaseName}-20260101T000004Z-001`;
    const fixture = fixtureSet(root, id);
    const store = path.join(root, 'tampered-store');
    const objectRoot = path.join(store, 'objects');
    const receiptRoot = path.join(store, 'batches');
    mkdirSync(objectRoot, { recursive: true });
    mkdirSync(receiptRoot, { recursive: true });
    writeFileSync(path.join(objectRoot, objectId), Buffer.from('different bytes'));
    writeFileSync(path.join(objectRoot, otherObjectId), fixture.otherBytes);
    writeFileSync(path.join(receiptRoot, `${batchId}.json`), JSON.stringify(fixture.receipt));
    writeTar(store, path.join(fixture.directory, OBJECTS_ARCHIVE_FILE));
    rmSync(store, { recursive: true });

    const manifest = JSON.parse(readFileSync(path.join(fixture.directory, MANIFEST_FILE), 'utf8'));
    manifest.artifacts.objectsArchive = artifactSummary(fixture.directory, OBJECTS_ARCHIVE_FILE);
    writeManifest(fixture.directory, manifest);
    const destination = path.join(root, 'extracted');
    await assert.rejects(
      extractObjectArchive(
        path.join(fixture.directory, OBJECTS_ARCHIVE_FILE),
        destination,
        manifest.objects,
      ),
      (error) => error instanceof Error && 'code' in error && error.code === 'OBJECT_ARCHIVE_MISMATCH',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('backup set verification rejects archive content that differs from the manifest', async () => {
  const root = temporaryDirectory('customer-agent-backup-archive-content-tamper-');
  try {
    const id = `${databaseName}-20260101T000001Z-001`;
    const fixture = fixtureSet(root, id);
    const store = path.join(root, 'store');
    await extractObjectArchive(
      path.join(fixture.directory, OBJECTS_ARCHIVE_FILE),
      store,
      fixture.manifest.objects,
    );
    writeFileSync(path.join(store, 'objects', objectId), 'modified archive bytes');
    writeTar(store, path.join(fixture.directory, OBJECTS_ARCHIVE_FILE));
    const manifest = JSON.parse(readFileSync(path.join(fixture.directory, MANIFEST_FILE), 'utf8'));
    manifest.artifacts.objectsArchive = artifactSummary(fixture.directory, OBJECTS_ARCHIVE_FILE);
    writeManifest(fixture.directory, manifest);
    await assert.rejects(
      verifyBackupSet(fixture.directory),
      (error) => error instanceof Error && 'code' in error && error.code === 'OBJECT_ARCHIVE_MISMATCH',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('backup set verification rejects unlisted object archive entries', async () => {
  const root = temporaryDirectory('customer-agent-backup-extra-object-');
  try {
    const id = `${databaseName}-20260101T000001Z-001`;
    const fixture = fixtureSet(root, id);
    const store = path.join(root, 'store');
    await extractObjectArchive(
      path.join(fixture.directory, OBJECTS_ARCHIVE_FILE),
      store,
      fixture.manifest.objects,
    );
    writeFileSync(path.join(store, 'objects', `obj_${'3'.repeat(64)}`), 'unlisted bytes');
    writeTar(store, path.join(fixture.directory, OBJECTS_ARCHIVE_FILE));
    const manifest = JSON.parse(readFileSync(path.join(fixture.directory, MANIFEST_FILE), 'utf8'));
    manifest.artifacts.objectsArchive = artifactSummary(fixture.directory, OBJECTS_ARCHIVE_FILE);
    writeManifest(fixture.directory, manifest);
    await assert.rejects(
      verifyBackupSet(fixture.directory),
      (error) => error instanceof Error && 'code' in error && error.code === 'OBJECT_ARCHIVE_MISMATCH',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('object consumer requires database files and durable batch receipts', async () => {
  const root = temporaryDirectory('customer-agent-backup-object-consistency-');
  try {
    const id = `${databaseName}-20260101T000005Z-001`;
    const fixture = fixtureSet(root, id);
    const store = path.join(root, 'object-store');
    const objectRoot = path.join(store, 'objects');
    const receiptRoot = path.join(store, 'batches');
    mkdirSync(objectRoot, { recursive: true });
    mkdirSync(receiptRoot, { recursive: true });
    writeFileSync(path.join(objectRoot, objectId), fixture.objectBytes);
    await assert.rejects(
      inspectObjectStore({ objectStoreDirectory: store }, fixture.manifest.database),
      (error) => error instanceof Error && 'code' in error && error.code === 'OBJECT_RECEIPT_MISSING',
    );
    writeFileSync(path.join(receiptRoot, `${batchId}.json`), JSON.stringify(fixture.receipt));
    rmSync(path.join(objectRoot, objectId));
    await assert.rejects(
      inspectObjectStore({ objectStoreDirectory: store }, fixture.manifest.database),
      (error) => error instanceof Error && 'code' in error && error.code === 'OBJECT_DATABASE_MISMATCH',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('tar path traversal and non-regular entries fail closed', () => {
  const root = temporaryDirectory('customer-agent-backup-tar-safety-');
  try {
    const traversal = path.join(root, 'traversal.tar');
    writeFileSync(traversal, Buffer.concat([
      rawTarHeader('objects/../../escape'),
      Buffer.alloc(1024),
    ]));
    assert.throws(
      () => inspectObjectArchive(traversal),
      (error) => error instanceof Error && 'code' in error && error.code === 'OBJECT_ARCHIVE_INVALID',
    );

    const symlink = path.join(root, 'symlink.tar');
    const header = rawTarHeader('objects/valid');
    header.write('2', 156, 'ascii');
    header.fill(0x20, 148, 156);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
    writeFileSync(symlink, Buffer.concat([header, Buffer.alloc(1024)]));
    assert.throws(
      () => inspectObjectArchive(symlink),
      (error) => error instanceof Error && 'code' in error && error.code === 'OBJECT_ARCHIVE_INVALID',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('replication metadata distinguishes same-host copies from declared offsite copies', () => {
  const original = process.env.CUSTOMER_AGENT_BACKUP_COPY_SCOPE;
  try {
    delete process.env.CUSTOMER_AGENT_BACKUP_COPY_SCOPE;
    assert.deepEqual(replicationConfiguration('/tmp/customer-agent-copy'), {
      mode: 'same-host-copy',
      durability: 'not-assessed',
      destinationIdSha256: sha256(path.resolve('/tmp/customer-agent-copy')),
    });
    process.env.CUSTOMER_AGENT_BACKUP_COPY_SCOPE = 'offsite';
    assert.equal(replicationConfiguration('/tmp/customer-agent-copy').mode, 'offsite-declared');
    assert.equal(replicationConfiguration('/tmp/customer-agent-copy').durability, 'not-assessed');
    assert.deepEqual(replicationConfiguration(null), {
      mode: 'none',
      durability: 'not-assessed',
      destinationIdSha256: null,
    });
  } finally {
    if (original === undefined) delete process.env.CUSTOMER_AGENT_BACKUP_COPY_SCOPE;
    else process.env.CUSTOMER_AGENT_BACKUP_COPY_SCOPE = original;
  }
});

test('candidate release rehearsal input requires one consistent built release', () => {
  const root = temporaryDirectory('customer-agent-candidate-release-');
  const candidateRoot = path.join(root, 'candidate');
  try {
    mkdirSync(path.join(candidateRoot, 'apps/desktop'), { recursive: true });
    mkdirSync(path.join(candidateRoot, 'packages/database/migrations'), { recursive: true });
    mkdirSync(path.join(candidateRoot, 'packages/database/src/generated'), { recursive: true });
    symlinkSync(path.join(repositoryRoot, 'packages/database/node_modules'),
      path.join(candidateRoot, 'packages/database/node_modules'), 'dir');
    writeFileSync(path.join(candidateRoot, 'package.json'), '{"private":true}\n');
    writeFileSync(path.join(candidateRoot, '.gitignore'), '/packages/database/node_modules\n/packages/database/dist/\n');
    writeFileSync(path.join(candidateRoot, 'packages/database/tsconfig.json'), JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
        strict: true,
      },
    }));
    writeFileSync(path.join(candidateRoot, 'packages/database/tsconfig.build.json'), JSON.stringify({
      extends: './tsconfig.json',
      compilerOptions: {
        rootDir: 'src',
        outDir: 'dist',
        declaration: true,
      },
      include: ['src/**/*.ts'],
    }));
    writeFileSync(path.join(candidateRoot, 'VERSION'), '0.3.43\n');
    writeFileSync(path.join(candidateRoot, 'apps/desktop/package.json'), '{"version":"0.3.43"}\n');
    writeFileSync(
      path.join(candidateRoot, 'packages/database/migrations/manifest.generated.json'),
      '{"migrations":[{"position":81,"id":"0081_next"}]}\n',
    );
    writeFileSync(path.join(candidateRoot, 'packages/database/src/index.ts'), 'export const index = true;\n');
    writeFileSync(path.join(candidateRoot, 'packages/database/src/verifier.ts'), 'export const verifier = true;\n');
    writeFileSync(
      path.join(candidateRoot, 'packages/database/src/generated/migrations.generated.ts'),
      'export const generatedMigrationCatalogue = { migrations: [] };\n',
    );
    const gitEnvironment = {
      ...process.env,
      GIT_CONFIG_GLOBAL: os.devNull,
      GIT_CONFIG_NOSYSTEM: '1',
    };
    execFileSync(path.join(repositoryRoot, 'packages/database/node_modules/.bin/tsc'), [
      '-p', 'packages/database/tsconfig.build.json',
    ], { cwd: candidateRoot, env: gitEnvironment });
    execFileSync('git', ['init', '-q'], { cwd: candidateRoot, env: gitEnvironment });
    execFileSync('git', ['add', '.'], { cwd: candidateRoot, env: gitEnvironment });
    execFileSync('git', [
      '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '-qm', 'candidate',
    ], { cwd: candidateRoot, env: gitEnvironment });
    const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: candidateRoot,
      encoding: 'utf8',
      env: gitEnvironment,
    }).trim();
    const releaseRoot = path.join(root, gitSha);
    renameSync(candidateRoot, releaseRoot);
    const resolvedRoot = realpathSync(releaseRoot);
    assert.deepEqual(readCandidateRelease(releaseRoot), {
      root: resolvedRoot,
      gitSha,
      version: '0.3.43',
      manifest: { migrations: [{ position: 81, id: '0081_next' }] },
      databaseModulePath: path.join(resolvedRoot, 'packages/database/dist/index.js'),
      verifierModulePath: path.join(resolvedRoot, 'packages/database/dist/verifier.js'),
      generatedModulePath: path.join(resolvedRoot, 'packages/database/dist/generated/migrations.generated.js'),
    });
    writeFileSync(path.join(releaseRoot, 'packages/database/dist/index.js'), 'export const tampered = true;\n');
    assert.throws(
      () => readCandidateRelease(releaseRoot),
      (error) => error instanceof Error && 'code' in error && error.code === 'CANDIDATE_RELEASE_BUILD_MISMATCH',
    );
    execFileSync(path.join(repositoryRoot, 'packages/database/node_modules/.bin/tsc'), [
      '-p', 'packages/database/tsconfig.build.json',
    ], { cwd: releaseRoot, env: gitEnvironment });
    writeFileSync(path.join(releaseRoot, 'packages/database/src/untracked.ts'), 'export const untracked = true;\n');
    writeFileSync(
      path.join(releaseRoot, 'packages/database/dist/untracked.js'),
      'export const untracked = true;\n',
    );
    assert.throws(
      () => readCandidateRelease(releaseRoot),
      (error) => error instanceof Error && 'code' in error && error.code === 'CANDIDATE_RELEASE_BUILD_MISMATCH',
    );
    rmSync(path.join(releaseRoot, 'packages/database/src/untracked.ts'));
    rmSync(path.join(releaseRoot, 'packages/database/dist/untracked.js'));
    execFileSync(path.join(repositoryRoot, 'packages/database/node_modules/.bin/tsc'), [
      '-p', 'packages/database/tsconfig.build.json',
    ], { cwd: releaseRoot, env: gitEnvironment });
    const outside = path.join(root, 'outside.js');
    writeFileSync(outside, 'export const outside = true;\n');
    rmSync(path.join(releaseRoot, 'packages/database/dist/verifier.js'));
    symlinkSync(outside, path.join(releaseRoot, 'packages/database/dist/verifier.js'));
    assert.throws(
      () => readCandidateRelease(releaseRoot),
      (error) => error instanceof Error && 'code' in error && error.code === 'CANDIDATE_RELEASE_INVALID',
    );
    rmSync(path.join(releaseRoot, 'packages/database/dist/verifier.js'));
    execFileSync(path.join(repositoryRoot, 'packages/database/node_modules/.bin/tsc'), [
      '-p', 'packages/database/tsconfig.build.json',
    ], { cwd: releaseRoot, env: gitEnvironment });
    writeFileSync(path.join(releaseRoot, 'apps/desktop/package.json'), '{"version":"0.3.42"}\n');
    assert.throws(
      () => readCandidateRelease(releaseRoot),
      (error) => error instanceof Error && 'code' in error && error.code === 'CANDIDATE_RELEASE_INVALID',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retention removes only verified matching backup sets and preserves corrupt or unrelated entries', async () => {
  const root = temporaryDirectory('customer-agent-backup-retention-');
  try {
    const ids = [
      `${databaseName}-20260101T000001Z-001`,
      `${databaseName}-20260101T000002Z-001`,
      `${databaseName}-20260101T000003Z-001`,
    ];
    for (const id of ids) fixtureSet(root, id);
    mkdirSync(path.join(root, `${databaseName}-20251231T235959Z-001`));
    mkdirSync(path.join(root, 'unrelated-backup'));
    const result = await pruneVerifiedBackupSets({
      root,
      databaseName,
      keep: 2,
      currentBackupId: ids[2],
    });
    assert.equal(result.removed, 1);
    assert.equal(result.preserved, 1);
    assert.equal(existsSync(path.join(root, ids[0])), false);
    assert.equal(existsSync(path.join(root, 'unrelated-backup')), true);

    const second = await pruneVerifiedBackupSets({
      root,
      databaseName,
      keep: 1,
      currentBackupId: ids[2],
    });
    assert.equal(second.removed, 1);
    assert.equal(existsSync(path.join(root, ids[0])), false);
    assert.equal(existsSync(path.join(root, ids[1])), false);
    assert.equal(existsSync(path.join(root, ids[2])), true);
    assert.equal(existsSync(path.join(root, `${databaseName}-20251231T235959Z-001`)), true);
    assert.equal(existsSync(path.join(root, 'unrelated-backup')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const corruptIndex of [0, 1, 2]) test(`corrupt backup ${corruptIndex + 1} does not consume a verified retention slot`, async () => {
  const root = temporaryDirectory('customer-agent-backup-valid-retention-');
  try {
    const ids = [1, 2, 3].map(n => `${databaseName}-20260101T00000${n}Z-001`);
    for (const [index, id] of ids.entries()) {
      if (index === corruptIndex) mkdirSync(path.join(root, id));
      else fixtureSet(root, id);
    }
    const currentBackupId = ids.filter((_, index) => index !== corruptIndex).at(-1);
    const result = await pruneVerifiedBackupSets({ root, databaseName, keep: 2, currentBackupId });
    assert.equal(result.removed, 0);
    assert.equal(result.preserved, 1);
    assert.deepEqual(readdirSync(root).sort(), ids);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('verified runtime artifacts are rechecked for source, dist and workspace drift without rebuilding', () => {
  const root = temporaryDirectory('candidate-runtime-recheck-');
  let candidate = path.join(root, 'candidate');
  const directories = ['packages/contracts', 'packages/retrieval-core', 'packages/job-roster',
    'packages/unified-contracts', 'packages/content-intake', 'packages/database', 'apps/api'];
  try {
    mkdirSync(candidate);
    writeFileSync(path.join(candidate, '.gitignore'), '**/dist/\n**/node_modules/\n');
    copyFileSync(path.join(repositoryRoot, 'pnpm-lock.yaml'), path.join(candidate, 'pnpm-lock.yaml'));
    for (const directory of directories) {
      mkdirSync(path.join(candidate, directory, 'dist'), { recursive: true });
      for (const file of ['package.json', 'tsconfig.json', 'tsconfig.build.json']) {
        copyFileSync(path.join(repositoryRoot, directory, file), path.join(candidate, directory, file));
      }
      writeFileSync(path.join(candidate, directory, 'tracked-input.txt'), 'synthetic verified input\n');
      writeFileSync(path.join(candidate, directory, 'dist/index.js'), 'export const synthetic = true;\n');
    }
    const git = (args, encoding) => execFileSync('git', ['-C', candidate, ...args], {
      encoding, env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' },
    });
    git(['init', '-q']);
    git(['add', '.']);
    git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
    const gitSha = git(['rev-parse', 'HEAD'], 'utf8').trim();
    const destination = path.join(root, gitSha);
    renameSync(candidate, destination);
    candidate = realpathSync(destination);
    for (const directory of directories) {
      const scope = path.join(candidate, directory, 'node_modules/@customer-agent');
      mkdirSync(scope, { recursive: true });
      for (const dependency of directories) symlinkSync(path.join(candidate, dependency), path.join(scope, path.basename(dependency)), 'dir');
    }
    const digests = directories.map(directory => {
      const dist = path.join(candidate, directory, 'dist');
      return [directory, assertCandidateBuildDigests(dist, dist)];
    });
    const release = { root: candidate, gitSha, runtimeBuildSha256: sha256(JSON.stringify(digests)) };
    assert.doesNotThrow(() => assertCandidateRuntimeUnchanged(release));
    const output = path.join(candidate, 'apps/api/dist/index.js');
    writeFileSync(output, 'export const synthetic = false;\n');
    assert.throws(() => assertCandidateRuntimeUnchanged(release), { code: 'CANDIDATE_RUNTIME_BUILD_MISMATCH' });
    writeFileSync(output, 'export const synthetic = true;\n');
    git(['update-index', '--assume-unchanged', 'apps/api/tracked-input.txt']);
    writeFileSync(path.join(candidate, 'apps/api/tracked-input.txt'), 'changed hidden input\n');
    assert.throws(() => assertCandidateRuntimeUnchanged(release), { code: 'CANDIDATE_RELEASE_INVALID' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
