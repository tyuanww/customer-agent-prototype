import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { exploreSeatRevocation } from '../models/seat-revocation.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../../../..');
const skillRoot = path.resolve(scriptDirectory, '..');
const requireFromApi = createRequire(path.join(repositoryRoot, 'apps/api/package.json'));

const expectedControls = Object.freeze({
  'no-check': 'write_without_admin_check',
  'write-before-check': 'write_before_admin_check',
});

function failModel(message) {
  console.error(`MODEL_ERROR ${message}`);
  process.exitCode = 2;
}

function verifyReceipts() {
  const receipts = JSON.parse(readFileSync(path.join(skillRoot, 'receipts.json'), 'utf8'));
  for (const [relative, expected] of Object.entries(receipts.files)) {
    const actual = createHash('sha256').update(readFileSync(path.join(repositoryRoot, relative))).digest('hex');
    if (actual !== expected) throw new Error(`${relative} changed since formal verification was synchronized`);
  }
}

function runModelChecks() {
  for (const [mode, expected] of Object.entries(expectedControls)) {
    const finding = exploreSeatRevocation(mode);
    if (finding.violation !== expected) {
      throw new Error(`${mode} did not produce ${expected}`);
    }
    console.log(`MUTATION_DETECTED ${mode} ${finding.path.join(' -> ')}`);
  }
  const requestTime = exploreSeatRevocation('request-time');
  if (requestTime.violation !== null) {
    throw new Error(`request-time policy unexpectedly failed: ${requestTime.violation}`);
  }
  console.log(`POLICY_PASS request-time ${String(requestTime.states)} states`);
  const strictCandidate = exploreSeatRevocation('strict');
  console.log(`SAFETY_CANDIDATE commit-time ${strictCandidate.path.join(' -> ')} ${strictCandidate.violation}`);
  return requestTime;
}

function deferred() {
  let resolve;
  const promise = new Promise(next => { resolve = next; });
  return { promise, resolve };
}

function startPasswordWriter(moduleUrl, file, username) {
  const script = [
    `import { createSeatPasswordFile } from ${JSON.stringify(moduleUrl)};`,
    "process.send?.('ready');",
    `await createSeatPasswordFile(${JSON.stringify(file)}).upsert(${JSON.stringify(username)}, ${JSON.stringify(`synthetic_seat_${username}`)}, 'formal-concurrent-password');`,
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('message', message => {
      if (message === 'ready') resolve();
      else reject(new Error(`unexpected password writer message: ${String(message)}`));
    });
  });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`password writer exited with ${String(code)} / ${String(signal)}: ${stderr}`));
    });
  });
  return { child, ready, done };
}

async function runPasswordFileReplay() {
  const moduleUrl = pathToFileURL(
    path.join(repositoryRoot, 'apps/api/dist/content-intake/seat-password-file.js'),
  ).href;
  const { createSeatPasswordFile } = await import(moduleUrl);
  const root = mkdtempSync(path.join(tmpdir(), 'seat-password-formal-'));
  const file = path.join(root, 'password-accounts.json');
  const lock = `${file}.lock`;
  try {
    await createSeatPasswordFile(file).upsert('baseline', 'synthetic_seat_baseline', 'formal-baseline-password');
    mkdirSync(lock, { mode: 0o700 });
    const alice = startPasswordWriter(moduleUrl, file, 'alice');
    await alice.ready;
    const bob = startPasswordWriter(moduleUrl, file, 'bob');
    await bob.ready;
    await new Promise(resolve => setTimeout(resolve, 100));
    if (alice.child.exitCode !== null || bob.child.exitCode !== null) {
      throw new Error('password writer ignored a live cross-process lock');
    }
    rmSync(lock, { recursive: true });
    await Promise.all([alice.done, bob.done]);
    const rows = JSON.parse(readFileSync(file, 'utf8'));
    const usernames = new Set(rows.map(row => row.username));
    for (const expected of ['baseline', 'alice', 'bob']) {
      if (!usernames.has(expected)) throw new Error(`cross-process write lost ${expected}`);
    }

    mkdirSync(lock, { mode: 0o700 });
    writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({
      token: 'formal-live-owner',
      pid: process.pid,
    }));
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    const live = startPasswordWriter(moduleUrl, file, 'live-owner');
    await live.ready;
    await new Promise(resolve => setTimeout(resolve, 100));
    if (live.child.exitCode !== null) throw new Error('password writer stole a live owner lock');
    rmSync(lock, { recursive: true });
    await live.done;
    if (!new Set(JSON.parse(readFileSync(file, 'utf8')).map(row => row.username)).has('live-owner')) {
      throw new Error('password write after live owner release was lost');
    }

    mkdirSync(lock, { mode: 0o700 });
    const stale = new Date(Date.now() - 60_000);
    utimesSync(lock, stale, stale);
    const interrupted = `${file}.tmp-interrupted`;
    writeFileSync(interrupted, '{"partial":');
    await createSeatPasswordFile(file).upsert(
      'after-crash', 'synthetic_seat_after-crash', 'formal-after-crash-password');
    if (existsSync(lock)) throw new Error('stale password lock was not recovered');
    if (existsSync(interrupted)) throw new Error('interrupted password temporary file was not removed');
    if (!new Set(JSON.parse(readFileSync(file, 'utf8')).map(row => row.username)).has('after-crash')) {
      throw new Error('crash recovery did not apply the waiting password write');
    }
    return 'serialized two writers, kept a live owner, and recovered a stale lock';
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function runRealReplay() {
  const { Pool } = requireFromApi('pg');
  const { applyDatabaseMigrations } = await import(
    pathToFileURL(path.join(repositoryRoot, 'packages/database/dist/index.js'))
  );
  const { Pg15Harness } = await import(
    pathToFileURL(path.join(repositoryRoot, 'packages/database/dist/testkit/index.js'))
  );
  const { createSeatService, SeatRefusal } = await import(
    pathToFileURL(path.join(repositoryRoot, 'apps/api/dist/content-intake/seats.js'))
  );
  const { createOrganizationFactsWriter } = await import(
    pathToFileURL(path.join(repositoryRoot, 'apps/api/dist/content-intake/organization/facts-writer.js'))
  );
  const { createSeatPasswordFile } = await import(
    pathToFileURL(path.join(repositoryRoot, 'apps/api/dist/content-intake/seat-password-file.js'))
  );

  const harness = new Pg15Harness();
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'seat-admin-formal-'));
  let admin;
  let pool;
  try {
    harness.start();
    const database = harness.createDatabase('seat_admin_revocation');
    admin = await harness.connect(database.config);
    await applyDatabaseMigrations(admin);
    pool = new Pool({ ...database.config, max: 4 });

    async function seedAdministrator(label) {
      const config = {
        tenantId: `tenant-${label}`,
        appId: `app-${label}`,
        departmentId: `dept-${label}`,
        principalId: `seat-admin-${label}`,
        userId: `usr-seat-admin-${label}`,
        allocationId: `alloc-seat-admin-${label}`,
        scopeId: `scope-${label}`,
      };
      await admin.query('BEGIN');
      try {
        await admin.query(`INSERT INTO backend_identity.subject_bindings(
            binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
          VALUES ($1,'synthetic',$2,$1,$3,repeat('a',64),true,'owner')`,
        [config.principalId, config.tenantId, config.userId]);
        await admin.query(`INSERT INTO content_intake.principals(
            principal_id, user_id, tenant_id, app_id, identity_scope, person_key, current_facts_version)
          VALUES ($1,$2,$3,$4,'confirmed-synthetic',$1,1)`,
        [config.principalId, config.userId, config.tenantId, config.appId]);
        await admin.query(`INSERT INTO content_intake.principal_facts(
            principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest)
          VALUES ($1,1,ARRAY[$2],'job-customer-service-director',true,
            statement_timestamp()-interval '1 second',statement_timestamp()+interval '240 seconds',repeat('b',64))`,
        [config.principalId, config.departmentId]);
        await admin.query(`INSERT INTO content_intake.role_rules(
            tenant_id, app_id, department_id, job_id, policy_version, role)
          VALUES ($1,$2,$3,'job-customer-service-director',1,'director')`,
        [config.tenantId, config.appId, config.departmentId]);
        await admin.query(`INSERT INTO content_intake.scopes(
            scope_id, tenant_id, app_id, brand_id, domain)
          VALUES ($1,$2,$3,$4,'product')`,
        [config.scopeId, config.tenantId, config.appId, `brand-${label}`]);
        await admin.query(`INSERT INTO content_intake.grants(
            grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, action,
            starts_at, expires_at, reason, steward_id)
          VALUES ($1,'allocation',$2,$2,$3,$4,$5,'publish',
            clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 minutes',
            'formal verification bootstrap',$2)`,
        [config.allocationId, config.principalId, config.tenantId, config.appId, config.scopeId]);
        await admin.query('COMMIT');
        return Object.freeze(config);
      } catch (error) {
        await admin.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    }

    async function seedSeat(config, username, displayName) {
      await admin.query(
        'SELECT * FROM backend_identity.create_seat($1,$2,$3,$4,$5,$6,$7)',
        [username, displayName, '客服', config.tenantId, config.appId, config.departmentId, config.principalId],
      );
    }

    function recordingPasswordFile(label, failing = false) {
      const file = path.join(temporaryRoot, label, 'password-accounts.json');
      if (!failing) mkdirSync(path.dirname(file), { recursive: true });
      const owner = createSeatPasswordFile(file);
      const writes = [];
      return {
        writes,
        file: {
          async upsert(username, bindingId, password) {
            await owner.upsert(username, bindingId, password);
            writes.push({ username, bindingId, password });
          },
          remove(username) { return owner.remove(username); },
        },
      };
    }

    function observableService(config, passwordFile) {
      const checkObserved = deferred();
      const releaseWrite = deferred();
      let holdFirstAdministrationRead = true;
      const observedPool = {
        async connect() {
          const client = await pool.connect();
          if (!holdFirstAdministrationRead) return client;
          holdFirstAdministrationRead = false;
          const query = client.query.bind(client);
          client.query = async (...args) => {
            const result = await query(...args);
            if (typeof args[0] === 'string' && args[0].includes('seat_administration_allowed')) {
              checkObserved.resolve();
              await releaseWrite.promise;
              client.query = query;
            }
            return result;
          };
          return client;
        },
      };
      return {
        checkObserved: checkObserved.promise,
        releaseWrite,
        passwordWrites: passwordFile.writes,
        service: createSeatService(observedPool, passwordFile.file, config),
      };
    }

    async function revokeAdministrator(config, mode) {
      if (mode === 'facts') {
        const refreshFacts = createOrganizationFactsWriter(pool, {
          tenantId: config.tenantId,
          appId: config.appId,
        });
        const revokedAt = new Date();
        const refresh = await refreshFacts({
          principalId: config.principalId,
          expectedFactsVersion: 1,
          departmentIds: [config.departmentId],
          jobId: 'job-customer-service-director',
          enabled: false,
          checkedAt: revokedAt.toISOString(),
          validUntil: new Date(revokedAt.getTime() + 60_000).toISOString(),
        });
        if (!refresh.ok) throw new Error(`facts writer failed: ${refresh.reason}`);
      } else if (mode === 'allocation') {
        await admin.query(`UPDATE content_intake.grants
          SET version=version+1, revoked_at=clock_timestamp(),
            last_change_reason='formal verification direct allocation revocation'
          WHERE grant_id=$1`, [config.allocationId]);
      } else if (mode === 'role') {
        await admin.query(`UPDATE content_intake.role_rules SET role='agent'
          WHERE tenant_id=$1 AND app_id=$2 AND department_id=$3
            AND job_id='job-customer-service-director'`,
        [config.tenantId, config.appId, config.departmentId]);
      } else if (mode === 'binding') {
        await admin.query('UPDATE backend_identity.subject_bindings SET enabled=false WHERE binding_id=$1',
          [config.principalId]);
      } else {
        throw new Error(`unknown revocation mode: ${mode}`);
      }
      const check = await admin.query(
        'SELECT content_intake.seat_administration_allowed($1) AS allowed', [config.userId]);
      if (check.rows[0]?.allowed !== false) {
        throw new Error('fixture failed to revoke seat administration authority');
      }
    }

    async function expectSeatForbidden(run) {
      await expectRefusal(run, 'SEAT_FORBIDDEN');
    }

    async function expectRefusal(run, reason) {
      try {
        await run();
      } catch (error) {
        if (error instanceof SeatRefusal && error.reason === reason) return;
        throw error;
      }
      throw new Error(`expected ${reason}`);
    }

    const revocationModes = ['facts', 'allocation', 'role', 'binding'];
    for (const mode of revocationModes) {
      const createConfig = await seedAdministrator(`create-${mode}`);
      const admittedUsername = `create-${mode}-admitted`;
      const rejectedUsername = `create-${mode}-rejected`;
      const createHarness = observableService(createConfig, recordingPasswordFile(`create-${mode}`));
      const admittedCreate = createHarness.service.create(createConfig.userId, {
        displayName: `Create ${mode} admitted`,
        username: admittedUsername,
        password: 'password-for-formal-check',
        post: '客服',
      });
      await createHarness.checkObserved;
      await revokeAdministrator(createConfig, mode);
      createHarness.releaseWrite.resolve();
      await admittedCreate;
      const created = await admin.query(
        'SELECT 1 FROM backend_identity.subject_bindings WHERE binding_id=$1',
        [`synthetic_seat_${admittedUsername}`]);
      if (created.rowCount !== 1 || createHarness.passwordWrites.length !== 1) {
        throw new Error(`admitted create did not complete after ${mode} revocation`);
      }
      const createWritesBefore = createHarness.passwordWrites.length;
      await expectSeatForbidden(() => createHarness.service.create(createConfig.userId, {
        displayName: `Create ${mode} rejected`,
        username: rejectedUsername,
        password: 'password-for-revoked-request',
        post: '客服',
      }));
      const rejectedCreate = await admin.query(
        'SELECT 1 FROM backend_identity.subject_bindings WHERE binding_id=$1',
        [`synthetic_seat_${rejectedUsername}`]);
      if (rejectedCreate.rowCount !== 0 || createHarness.passwordWrites.length !== createWritesBefore) {
        throw new Error(`create started after ${mode} revocation produced a side effect`);
      }

      const resetConfig = await seedAdministrator(`reset-${mode}`);
      const admittedResetUsername = `reset-${mode}-admitted`;
      const rejectedResetUsername = `reset-${mode}-rejected`;
      await seedSeat(resetConfig, admittedResetUsername, `Reset ${mode} admitted`);
      await seedSeat(resetConfig, rejectedResetUsername, `Reset ${mode} rejected`);
      const resetHarness = observableService(resetConfig, recordingPasswordFile(`reset-${mode}`));
      const admittedReset = resetHarness.service.reset(resetConfig.userId, {
        username: admittedResetUsername,
        password: 'password-after-revoke',
      });
      await resetHarness.checkObserved;
      await revokeAdministrator(resetConfig, mode);
      resetHarness.releaseWrite.resolve();
      await admittedReset;
      if (!resetHarness.passwordWrites.some(write => write.username === admittedResetUsername)) {
        throw new Error(`admitted reset did not complete after ${mode} revocation`);
      }
      const resetWritesBefore = resetHarness.passwordWrites.length;
      await expectSeatForbidden(() => resetHarness.service.reset(resetConfig.userId, {
        username: rejectedResetUsername,
        password: 'password-for-revoked-reset',
      }));
      if (resetHarness.passwordWrites.length !== resetWritesBefore) {
        throw new Error(`reset started after ${mode} revocation produced a password write`);
      }

      const disableConfig = await seedAdministrator(`disable-${mode}`);
      const admittedDisableUsername = `disable-${mode}-admitted`;
      const rejectedDisableUsername = `disable-${mode}-rejected`;
      await seedSeat(disableConfig, admittedDisableUsername, `Disable ${mode} admitted`);
      await seedSeat(disableConfig, rejectedDisableUsername, `Disable ${mode} rejected`);
      const disableHarness = observableService(disableConfig, recordingPasswordFile(`disable-${mode}`));
      const admittedDisable = disableHarness.service.disable(disableConfig.userId, {
        username: admittedDisableUsername,
      });
      await disableHarness.checkObserved;
      await revokeAdministrator(disableConfig, mode);
      disableHarness.releaseWrite.resolve();
      await admittedDisable;
      const disabled = await admin.query(
        'SELECT enabled FROM backend_identity.subject_bindings WHERE binding_id=$1',
        [`synthetic_seat_${admittedDisableUsername}`]);
      if (disabled.rows[0]?.enabled !== false) {
        throw new Error(`admitted disable did not complete after ${mode} revocation`);
      }
      await expectSeatForbidden(() => disableHarness.service.disable(disableConfig.userId, {
        username: rejectedDisableUsername,
      }));
      const stillEnabled = await admin.query(
        'SELECT enabled FROM backend_identity.subject_bindings WHERE binding_id=$1',
        [`synthetic_seat_${rejectedDisableUsername}`]);
      if (stillEnabled.rows[0]?.enabled !== true) {
        throw new Error(`disable started after ${mode} revocation changed the seat`);
      }
    }

    const parallelA = await seedAdministrator('parallel-a');
    const parallelB = await seedAdministrator('parallel-b');
    const parallelFile = path.join(temporaryRoot, 'parallel-password-accounts.json');
    const sharedPasswordFile = createSeatPasswordFile(parallelFile);
    const parallelServiceA = createSeatService(pool, sharedPasswordFile, parallelA);
    const parallelServiceB = createSeatService(pool, sharedPasswordFile, parallelB);
    await Promise.all([
      parallelServiceA.create(parallelA.userId, {
        displayName: 'Parallel administrator A',
        username: 'parallel-admin-a',
        password: 'parallel-password-a',
        post: '客服',
      }),
      parallelServiceB.create(parallelB.userId, {
        displayName: 'Parallel administrator B',
        username: 'parallel-admin-b',
        password: 'parallel-password-b',
        post: '客服',
      }),
    ]);
    const parallelUsernames = new Set(JSON.parse(readFileSync(parallelFile, 'utf8'))
      .map(row => row.username));
    if (!parallelUsernames.has('parallel-admin-a') || !parallelUsernames.has('parallel-admin-b')) {
      throw new Error('two admitted administrators lost a password-file update');
    }

    const duplicateA = await seedAdministrator('duplicate-a');
    const duplicateB = await seedAdministrator('duplicate-b');
    const duplicateInput = {
      displayName: 'Concurrent duplicate',
      username: 'concurrent-duplicate',
      password: 'concurrent-duplicate-password',
      post: '客服',
    };
    const duplicateHarnessA = observableService(
      duplicateA,
      recordingPasswordFile('concurrent-duplicate-a'),
    );
    const duplicateHarnessB = observableService(
      duplicateB,
      recordingPasswordFile('concurrent-duplicate-b'),
    );
    const duplicateAttempts = [
      duplicateHarnessA.service.create(duplicateA.userId, duplicateInput),
      duplicateHarnessB.service.create(duplicateB.userId, duplicateInput),
    ];
    await Promise.all([
      duplicateHarnessA.checkObserved,
      duplicateHarnessB.checkObserved,
    ]);
    duplicateHarnessA.releaseWrite.resolve();
    duplicateHarnessB.releaseWrite.resolve();
    const duplicateResults = await Promise.allSettled(duplicateAttempts);
    const completedDuplicates = duplicateResults.filter(result => result.status === 'fulfilled');
    const rejectedDuplicates = duplicateResults.filter(result => result.status === 'rejected');
    if (completedDuplicates.length !== 1
      || rejectedDuplicates.length !== 1
      || !(rejectedDuplicates[0].reason instanceof SeatRefusal)
      || rejectedDuplicates[0].reason.reason !== 'SEAT_EXISTS') {
      throw new Error('concurrent duplicate create did not produce one success and SEAT_EXISTS');
    }

    const lossConfig = await seedAdministrator('password-loss');
    await seedSeat(lossConfig, 'password-reset-existing', '口令失败账号');
    const lossHarness = observableService(lossConfig, recordingPasswordFile('password-loss', true));
    const failedCreate = lossHarness.service.create(lossConfig.userId, {
      displayName: '口令写入失败账号',
      username: 'password-loss-created',
      password: 'password-that-cannot-write',
      post: '客服',
    });
    await lossHarness.checkObserved;
    lossHarness.releaseWrite.resolve();
    await expectRefusal(() => failedCreate, 'SEAT_PASSWORD_NOT_WRITTEN');
    const partial = await admin.query(
      'SELECT 1 FROM backend_identity.subject_bindings WHERE binding_id=$1',
      ['synthetic_seat_password-loss-created']);
    if (partial.rowCount !== 1) throw new Error('partial create lost the committed identity');
    await expectRefusal(() => lossHarness.service.reset(lossConfig.userId, {
      username: 'password-reset-existing',
      password: 'password-that-cannot-write',
    }), 'SEAT_PASSWORD_NOT_WRITTEN');

    return Object.freeze({
      revocations: revocationModes.join(', '),
      parallelAdministrators: 'two admitted creates retained both password rows',
      create: 'completed then rejected a new command for every revocation entry',
      reset: 'completed then rejected a new command for every revocation entry',
      disable: 'completed then rejected a new command for every revocation entry',
      duplicateCreate: 'one concurrent duplicate completed and the other returned SEAT_EXISTS',
      passwordFailure: 'kept identity and rejected password write',
    });
  } finally {
    if (pool) await pool.end().catch(() => undefined);
    if (admin) await admin.query('ROLLBACK').catch(() => undefined);
    if (admin) await admin.end().catch(() => undefined);
    rmSync(temporaryRoot, { recursive: true, force: true });
    harness.stop();
  }
}

try {
  verifyReceipts();
  runModelChecks();

  const build = spawnSync('pnpm', ['build:services'], {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
  });
  if (build.status !== 0) {
    process.stderr.write(build.stdout ?? '');
    process.stderr.write(build.stderr ?? '');
    throw new Error(`pnpm build:services exited ${String(build.status)}`);
  }

  const passwordFileResult = await runPasswordFileReplay();
  const realResult = await runRealReplay();
  console.log(`REAL_PASS create ${realResult.create}`);
  console.log(`REAL_PASS reset ${realResult.reset}`);
  console.log(`REAL_PASS disable ${realResult.disable}`);
  console.log(`REAL_PASS duplicate-create ${realResult.duplicateCreate}`);
  console.log(`REAL_PASS password-failure ${realResult.passwordFailure}`);
  console.log(`REAL_PASS multiple-administrators ${realResult.parallelAdministrators}`);
  console.log(`REAL_PASS password-file ${passwordFileResult}`);
  console.log('POLICY_PASS request-time real-commands');
  process.exitCode = 0;
} catch (error) {
  failModel(error instanceof Error ? error.message : String(error));
}
