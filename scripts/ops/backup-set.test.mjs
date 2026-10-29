import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
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
  acquireBackupLock,
  createBackupSet,
  extractObjectArchive,
  inspectObjectArchive,
  inspectObjectStore,
  loadStackProfile,
  pruneVerifiedBackupSets,
  replicationConfiguration,
  verifyBackupSet,
} from './backup-set.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '../..');
const productVersion = readFileSync(path.join(repositoryRoot, 'VERSION'), 'utf8').trim();
const databaseName = 'customer_agent_intake_test';
const objectId = `obj_${'1'.repeat(64)}`;
const otherObjectId = `obj_${'2'.repeat(64)}`;
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

test('concurrent backup lock fails closed until the owner releases it', () => {
  const root = temporaryDirectory('customer-agent-backup-lock-');
  try {
    const release = acquireBackupLock(root);
    assert.throws(
      () => acquireBackupLock(root),
      (error) => error instanceof Error && 'code' in error && error.code === 'BACKUP_LOCKED',
    );
    release();
    const second = acquireBackupLock(root);
    second();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('failed backup removes its staging directory and releases the lock', async () => {
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
      (error) => error instanceof Error && 'code' in error && error.code === 'DATABASE_SNAPSHOT_FAILED',
    );
    assert.deepEqual(readdirSync(path.join(backupRoot, 'backup-sets')), []);
    const release = acquireBackupLock(backupRoot);
    release();
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
