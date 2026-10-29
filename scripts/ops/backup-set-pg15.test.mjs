import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
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

import { Pg15Harness } from '../../packages/database/dist/testkit/index.js';
import { applyMigrationPrefix } from '../../packages/database/dist/index.js';
import { generatedMigrationCatalogue } from '../../packages/database/dist/generated/migrations.generated.js';
import { verifyReadinessSuccessor } from '../../packages/database/dist/verifier.js';
import {
  DATABASE_DUMP_FILE,
  ROLES_FILE,
  MANIFEST_DIGEST_FILE,
  MANIFEST_FILE,
  OBJECTS_ARCHIVE_FILE,
  extractObjectArchive,
  verifyBackupSet,
} from './backup-set.mjs';

const enabled = process.env.CUSTOMER_AGENT_BACKUP_PG15_INTEGRATION === '1';
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '../..');
const databaseName = 'customer_agent_intake_test';
const productionApplicationSha = 'f960913314a2927f39daf3acdef19f63a5d1ebdc';
const productionApplicationVersion = '0.3.35';
const productionDesktopVersion = '0.3.34';
const keepDiagnosticClusters = process.env.CUSTOMER_AGENT_BACKUP_KEEP_DIAGNOSTIC_CLUSTERS === '1';
const backupScript = path.join(testDirectory, 'customer-agent-backup.sh');
const restoreScript = path.join(testDirectory, 'customer-agent-restore-drill.sh');
const credentialMarker = 'credential-must-not-appear-in-output';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function pg15Bin() {
  return process.env.CUSTOMER_AGENT_PG15_BIN
    ?? execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
}

function runCli(script, arguments_, environment, expectedStatuses, timeout = 10 * 60_000) {
  const result = spawnSync(script, arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: environment,
    maxBuffer: 32 * 1024 * 1024,
    timeout,
  });
  assert.equal(
    result.status !== null && expectedStatuses.includes(result.status),
    true,
    `unexpected exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.equal(`${result.stdout}${result.stderr}`.includes(credentialMarker), false);
  return result;
}

function backupSets(backupRoot) {
  const root = path.join(backupRoot, 'backup-sets');
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.endsWith('.partial'))
    .map((entry) => path.join(root, entry.name))
    .sort();
}

function artifactSummary(directory, file) {
  const bytes = readFileSync(path.join(directory, file));
  return { file, bytes: bytes.length, sha256: sha256(bytes) };
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

function rewriteManifest(directory, change) {
  const manifest = JSON.parse(readFileSync(path.join(directory, MANIFEST_FILE), 'utf8'));
  change(manifest);
  const raw = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(path.join(directory, MANIFEST_FILE), raw);
  writeFileSync(path.join(directory, MANIFEST_DIGEST_FILE), `${sha256(raw)}  ${MANIFEST_FILE}\n`);
}

function cloneSet(source, destinationRoot, backupId) {
  const destination = path.join(destinationRoot, backupId);
  cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
  rewriteManifest(destination, (manifest) => {
    manifest.backupId = backupId;
  });
  return destination;
}

async function seedSyntheticDatabase(client, migrationCount) {
  await applyMigrationPrefix(client, migrationCount);
  await client.query(`
    CREATE ROLE backup_acl_reader LOGIN PASSWORD '${credentialMarker}';
  `);
  const objectBytes = Buffer.from('synthetic database and object backup fixture\n');
  const extraBytes = Buffer.from('synthetic unreferenced legacy object\n');
  const objectId = `obj_${'1'.repeat(64)}`;
  const extraObjectId = `obj_${'2'.repeat(64)}`;
  const batchId = 'imp_backup_pg15_0001';
  const objectSha = sha256(objectBytes);
  const sourceBindingHash = sha256('synthetic-source-binding');
  await client.query('BEGIN');
  try {
    await client.query(`
      INSERT INTO backend_identity.subject_bindings(
        binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role,authorization_version
      ) VALUES(
        'binding-backup-test','synthetic','tenant-backup','subject-backup','user-backup',$1,true,'agent',1
      )
    `, ['a'.repeat(64)]);
    await client.query(`
      INSERT INTO content_intake.principals(
        principal_id,user_id,tenant_id,app_id,identity_scope,person_key,current_facts_version
      ) VALUES(
        'principal-backup','user-backup','tenant-backup','app-backup','scope-backup','person-backup',1
      )
    `);
    await client.query(`
      INSERT INTO content_intake.principal_facts(
        principal_id,facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest
      ) VALUES(
        'principal-backup',1,ARRAY['department-backup'],'job-backup',true,
        clock_timestamp(),clock_timestamp()+interval '4 minutes',$1
      )
    `, ['b'.repeat(64)]);
    await client.query(`
      INSERT INTO content_intake.scopes(
        scope_id,tenant_id,app_id,brand_id,shop_id,domain
      ) VALUES(
        'scope-backup','tenant-backup','app-backup','brand-backup','shop-backup','product'
      )
    `);
    await client.query(`
      INSERT INTO content_intake.sources(
        source_id,scope_id,current_mapping_version,mode
      ) VALUES('src-backup','scope-backup',1,'legacy')
    `);
    await client.query(`
      INSERT INTO content_intake.source_mappings(
        source_id,version,template_version,rule_version,mapping_version,structure_digest
      ) VALUES(
        'src-backup',1,'faq-p1.1','intake-p1.1','mapping-backup',$1
      )
    `, ['c'.repeat(64)]);
    await client.query(`
      INSERT INTO public.import_batches(
        import_batch_id,source_type,source_ref,source_sha256,source_size_bytes,
        source_binding_hash,status
      ) VALUES($1,'excel',$2,$3,$4,$5,'validating')
    `, [batchId, objectId, objectSha, objectBytes.length, sourceBindingHash]);
    await client.query(`
      INSERT INTO content_intake.objects(
        object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at
      ) VALUES(
        $1,'src-backup','principal-backup','tenant-backup','app-backup',$2,$3,$4,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','input',clock_timestamp()
      )
    `, [objectId, `intake/${objectId}`, objectSha, objectBytes.length]);
    await client.query(`INSERT INTO public.import_batches(
      import_batch_id,source_type,source_ref,source_binding_hash,status
    ) VALUES ('legacy-batch','seed','synthetic-seed',$1,'validating')`, [sourceBindingHash]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  return {
    objectBytes,
    extraBytes,
    objectId,
    extraObjectId,
    batchId,
    objectSha,
    sourceBindingHash,
  };
}

async function exerciseBackupSetForMigrationCount(migrationCount) {
  const previousTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = '/private/tmp';
  const root = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-backup-integration-'));
  const stackRoot = path.join(root, 'stack');
  const objectStore = path.join(root, 'object-store');
  const backupRoot = path.join(root, 'backups');
  const copyRoot = path.join(root, 'same-host-copy');
  const evidenceRoot = path.join(root, 'evidence');
  const tamperRoot = path.join(root, 'tampered');
  mkdirSync(stackRoot);
  mkdirSync(objectStore);
  mkdirSync(backupRoot);
  mkdirSync(copyRoot);
  mkdirSync(evidenceRoot);
  mkdirSync(tamperRoot);
  writeFileSync(path.join(evidenceRoot, 'production-identity.json'), `${JSON.stringify({
    dataClassification: 'synthetic-test',
    productionRootVersion: productionApplicationVersion,
    productionDesktopVersion,
    desktopVersionDrift: true,
    productionApplicationGitSha: productionApplicationSha,
  }, null, 2)}\n`, { mode: 0o600 });
  const harness = new Pg15Harness();
  const socket = harness.socket;
  let admin;
  let databaseClient;
  try {
    harness.start();
    admin = await harness.connect({
      host: harness.socket,
      port: harness.port,
      user: harness.owner,
      database: 'postgres',
    });
    await admin.query(`CREATE DATABASE ${databaseName}`);
    databaseClient = await harness.connect({
      host: harness.socket,
      port: harness.port,
      user: harness.owner,
      database: databaseName,
    });
    const fixture = await seedSyntheticDatabase(databaseClient, migrationCount);
    const sourceVerification = await verifyReadinessSuccessor(databaseClient, {
      ...generatedMigrationCatalogue,
      migrations: generatedMigrationCatalogue.migrations.slice(0, migrationCount),
    });
    assert.equal(sourceVerification.status, 'PASS');
    const objectDirectory = path.join(objectStore, 'objects');
    const receiptDirectory = path.join(objectStore, 'batches');
    mkdirSync(objectDirectory);
    mkdirSync(receiptDirectory);
    writeFileSync(path.join(objectDirectory, fixture.objectId), fixture.objectBytes, { mode: 0o600 });
    writeFileSync(path.join(objectDirectory, fixture.extraObjectId), fixture.extraBytes, { mode: 0o600 });
    const receipt = {
      importBatchId: fixture.batchId,
      objectId: fixture.objectId,
      sourceType: 'excel',
      sha256: fixture.objectSha,
      sizeBytes: fixture.objectBytes.length,
      sourceBindingHash: fixture.sourceBindingHash,
      sourceBindings: [{ domain: 'product', source_version_id: 'srcv_backup_pg15' }],
    };
    writeFileSync(
      path.join(receiptDirectory, `${fixture.batchId}.json`),
      `${JSON.stringify(receipt)}\n`,
      { mode: 0o600 },
    );
    writeFileSync(path.join(stackRoot, 'profile.json'), `${JSON.stringify({
      version: 1,
      stackRoot,
      databaseName,
      pgPort: harness.port,
      pgSocketDirectory: socket,
      objectStoreDirectory: objectStore,
    }, null, 2)}\n`, { mode: 0o600 });

    const ledger = await databaseClient.query(`
      SELECT count(*)::int AS count, max(migration_id) AS last
      FROM customer_agent_meta.schema_migrations
    `);
    const baseEnvironment = {
      ...process.env,
      PGPASSWORD: credentialMarker,
      CUSTOMER_AGENT_STACK_ROOT: stackRoot,
      CUSTOMER_AGENT_BACKUP_ROOT: backupRoot,
      CUSTOMER_AGENT_BACKUP_KEEP: '1',
      CUSTOMER_AGENT_BACKUP_USER: harness.owner,
      CUSTOMER_AGENT_PG15_BIN: pg15Bin(),
      CUSTOMER_AGENT_BACKUP_DIAGNOSTICS: '1',
      CUSTOMER_AGENT_BACKUP_GIT_SHA: productionApplicationSha,
      CUSTOMER_AGENT_BACKUP_PRODUCT_VERSION: productionApplicationVersion,
    };

    const first = runCli(backupScript, [], baseEnvironment, [3]);
    assert.match(first.stdout, /retention skipped because no verified copy exists/u);
    const firstSets = backupSets(backupRoot);
    assert.equal(firstSets.length, 1);
    const firstId = path.basename(firstSets[0]);

    const second = runCli(backupScript, [], baseEnvironment, [3]);
    const afterSecond = backupSets(backupRoot);
    assert.equal(afterSecond.length, 2);
    assert.equal(afterSecond.some((entry) => path.basename(entry) === firstId), true);
    assert.equal(second.stdout.includes(credentialMarker), false);

    const copyEnvironment = {
      ...baseEnvironment,
      CUSTOMER_AGENT_BACKUP_COPY_TO: copyRoot,
      CUSTOMER_AGENT_BACKUP_COPY_SCOPE: 'same-host',
    };
    runCli(backupScript, [], copyEnvironment, [3]);
    const currentSets = backupSets(backupRoot);
    assert.equal(currentSets.length, 1);
    const current = currentSets[0];
    const currentId = path.basename(current);
    assert.notEqual(currentId, firstId);
    const copySets = backupSets(copyRoot);
    assert.deepEqual(copySets.map((entry) => path.basename(entry)), [currentId]);

    const verified = await verifyBackupSet(current, { pgBin: pg15Bin() });
    assert.equal(verified.manifest.databaseName, databaseName);
    assert.equal(verified.manifest.database.migrations.length, ledger.rows[0].count);
    assert.equal(verified.manifest.database.migrations.at(-1).migrationId, ledger.rows[0].last);
    assert.equal(verified.manifest.application.gitSha, productionApplicationSha);
    assert.equal(verified.manifest.application.productVersion, productionApplicationVersion);
    assert.equal(verified.manifest.application.productVersionSource, 'environment');
    assert.equal(
      verified.manifest.tooling.sha256,
      sha256(readFileSync(path.join(testDirectory, 'backup-set.mjs'))),
    );
    assert.notEqual(verified.manifest.tooling.sha256, productionApplicationSha);
    assert.equal(verified.manifest.replication.mode, 'same-host-copy');
    assert.equal(verified.manifest.replication.durability, 'not-assessed');
    assert.match(verified.manifest.database.aclFingerprint, /^[0-9a-f]{64}$/u);
    assert.equal(
      verified.manifest.database.roles.some((role) => role.name === 'backup_acl_reader' && role.login),
      true,
    );
    assert.equal(verified.manifest.objects.files.length, 2);
    assert.deepEqual(verified.manifest.objects.receipts.map((item) => item.importBatchId), [fixture.batchId]);
    assert.deepEqual(verified.manifest.objects.unreferencedObjectIds, [fixture.extraObjectId]);
    const rolesSql = readFileSync(path.join(current, ROLES_FILE), 'utf8');
    assert.match(rolesSql, /backup_acl_reader/u);
    assert.equal(rolesSql.includes(credentialMarker), false);
    assert.doesNotMatch(rolesSql, /\bPASSWORD\b/iu);

    const missingObjectId = `${databaseName}-20260101T000010Z-001`;
    const missingObject = cloneSet(current, tamperRoot, missingObjectId);
    rmSync(path.join(missingObject, OBJECTS_ARCHIVE_FILE));
    runCli(restoreScript, [missingObject], {
      ...baseEnvironment,
      CUSTOMER_AGENT_RESTORE_EVIDENCE_FILE: path.join(evidenceRoot, 'missing-object.json'),
    }, [1]);

    const corruptDumpId = `${databaseName}-20260101T000011Z-001`;
    const corruptDump = cloneSet(current, tamperRoot, corruptDumpId);
    writeFileSync(path.join(corruptDump, DATABASE_DUMP_FILE), 'not a PostgreSQL custom dump');
    runCli(restoreScript, [corruptDump], {
      ...baseEnvironment,
      CUSTOMER_AGENT_RESTORE_EVIDENCE_FILE: path.join(evidenceRoot, 'corrupt-dump.json'),
    }, [1]);

    const scratchPrefix = 'customer-agent-backup-restore-';
    const scratchBefore = new Set(readdirSync(os.tmpdir()).filter((name) => name.startsWith(scratchPrefix)));
    const missingPhysicalObjectId = `${databaseName}-20260101T000012Z-001`;
    const missingPhysicalObject = cloneSet(current, tamperRoot, missingPhysicalObjectId);
    const objectStoreFromArchive = path.join(root, 'mutated-object-store');
    await extractObjectArchive(
      path.join(missingPhysicalObject, OBJECTS_ARCHIVE_FILE),
      objectStoreFromArchive,
      verified.manifest.objects,
    );
    rmSync(path.join(objectStoreFromArchive, 'objects', fixture.objectId));
    rmSync(path.join(objectStoreFromArchive, 'batches', `${fixture.batchId}.json`));
    writeTar(objectStoreFromArchive, path.join(missingPhysicalObject, OBJECTS_ARCHIVE_FILE));
    rewriteManifest(missingPhysicalObject, (manifest) => {
      manifest.objects.files = manifest.objects.files.filter((file) => file.objectId !== fixture.objectId);
      manifest.objects.receipts = manifest.objects.receipts
        .filter((receipt) => receipt.importBatchId !== fixture.batchId);
      manifest.database.objects = manifest.database.objects
        .filter((object) => object.objectId !== fixture.objectId);
      manifest.database.importBatches = manifest.database.importBatches
        .filter((batch) => batch.importBatchId !== fixture.batchId);
      manifest.artifacts.objectsArchive = artifactSummary(missingPhysicalObject, OBJECTS_ARCHIVE_FILE);
    });
    const failureEvidence = path.join(evidenceRoot, 'missing-physical-object.json');
    runCli(restoreScript, [missingPhysicalObject], {
      ...baseEnvironment,
      CUSTOMER_AGENT_RESTORE_EVIDENCE_FILE: failureEvidence,
      CUSTOMER_AGENT_BACKUP_KEEP_SCRATCH_FOR_REVIEW: '0',
    }, [1]);
    const scratchAfter = new Set(readdirSync(os.tmpdir()).filter((name) => name.startsWith(scratchPrefix)));
    assert.deepEqual(scratchAfter, scratchBefore);
    const failure = JSON.parse(readFileSync(failureEvidence, 'utf8'));
    assert.equal(failure.status, 'FAIL');
    assert.equal(failure.errorCode, 'RESTORE_OBJECT_METADATA_MISMATCH');
    assert.equal(failure.scratchCleaned, true);

    const validEvidence = path.join(evidenceRoot, 'valid.json');
    const restoreResult = runCli(restoreScript, [copySets[0]], {
      ...copyEnvironment,
      CUSTOMER_AGENT_RESTORE_EVIDENCE_FILE: validEvidence,
      ...(keepDiagnosticClusters ? { CUSTOMER_AGENT_BACKUP_KEEP_SCRATCH_FOR_REVIEW: '1' } : {}),
    }, [0, 1]);
    const evidence = JSON.parse(readFileSync(validEvidence, 'utf8'));
    assert.ok(verified.manifest.database.importBatches.some((batch) => batch.importBatchId === 'legacy-batch'));
    const expectedVerifierMode = migrationCount === generatedMigrationCatalogue.migrations.length ? 'complete' : `readiness-prefix:${migrationCount}`;
    if (restoreResult.status === 1) {
      assert.equal(evidence.status, 'FAIL');
      assert.equal(evidence.metadataAndObjectFidelity, 'PASS');
      assert.equal(evidence.errorCode, 'MIGRATION_VERIFY_FAILED');
      assert.equal(evidence.verifierMode, expectedVerifierMode);
      assert.equal(evidence.backupSnapshotAt, verified.manifest.snapshotAt);
      assert.equal(typeof evidence.rpoSeconds, 'number');
      assert.equal(evidence.applicationGitSha, productionApplicationSha);
      assert.equal(evidence.productVersion, productionApplicationVersion);
      assert.equal(evidence.aclFingerprint, verified.manifest.database.aclFingerprint);
      assert.equal(evidence.toolingSha256, verified.manifest.tooling.sha256);
      assert.equal(evidence.scratchCleaned, !keepDiagnosticClusters);
      if (keepDiagnosticClusters) {
        assert.equal(evidence.reviewDiagnostics.port > 0, true);
      }
      throw new Error(
        'BLOCKED: faithful full pg_restore passed owner/data/object fidelity, '
        + `but the ${migrationCount}-migration verifier rejected pg_dump normalization`,
      );
    }
    assert.match(restoreResult.stdout, /restore drill passed/u);
    assert.equal(evidence.status, 'PASS');
    assert.equal(evidence.backupId, currentId);
    assert.equal(evidence.verifierStatus, 'PASS');
    assert.equal(evidence.verifierMode, expectedVerifierMode);
    assert.equal(evidence.metadataAndObjectFidelity, 'PASS');
    assert.equal(evidence.applicationGitSha, productionApplicationSha);
    assert.equal(evidence.productVersion, productionApplicationVersion);
    assert.equal(evidence.aclFingerprint, verified.manifest.database.aclFingerprint);
    assert.equal(evidence.toolingSha256, verified.manifest.tooling.sha256);
    assert.equal(evidence.objectCount, 1);
    assert.equal(evidence.receiptCount, 1);
    assert.equal(evidence.unreferencedObjectCount, 1);
    assert.equal(evidence.scratchCleaned, !keepDiagnosticClusters);
    assert.equal(typeof evidence.rpoSeconds, 'number');
    assert.equal(typeof evidence.rtoMs, 'number');
  } finally {
    await databaseClient?.end().catch(() => undefined);
    await admin?.end().catch(() => undefined);
    if (!keepDiagnosticClusters) {
      harness.stop();
    } else {
      writeFileSync(path.join(evidenceRoot, 'source-diagnostics.json'), `${JSON.stringify({
        clusterRoot: harness.root,
        dataDirectory: harness.data,
        socketDirectory: harness.socket,
        port: harness.port,
        owner: harness.owner,
        databaseName,
      }, null, 2)}\n`, { mode: 0o600 });
    }
    const evidenceOutput = process.env.CUSTOMER_AGENT_BACKUP_TEST_EVIDENCE_DIR;
    if (evidenceOutput && readdirSync(evidenceRoot).length > 0) {
      const outputRoot = path.resolve(evidenceOutput);
      mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
      const outputRun = mkdtempSync(path.join(outputRoot, 'run-'));
      for (const name of readdirSync(evidenceRoot)) {
        cpSync(path.join(evidenceRoot, name), path.join(outputRun, name));
      }
      process.stdout.write(`SYNTHETIC_EVIDENCE_DIR=${outputRun}\n`);
    }
    if (!keepDiagnosticClusters) {
      rmSync(root, { recursive: true, force: true });
    }
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
  }
}

for (const migrationCount of [75, 76, 77]) {
  test(
    `backup and restore consume a real PG15 snapshot at migration ${migrationCount} with objects, owners, roles, ACL, and verifier`,
    {
      skip: enabled ? false : 'set CUSTOMER_AGENT_BACKUP_PG15_INTEGRATION=1',
      timeout: 20 * 60_000,
    },
    async () => exerciseBackupSetForMigrationCount(migrationCount),
  );
}
