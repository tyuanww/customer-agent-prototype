import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { applyCandidateRelease } from './backup-set.mjs';
import { runProductionRelease, parseOptions } from './customer-agent-production-release.mjs';
import {
  RELEASE_PROOF_SCHEMA, assertReleasePrefix, assertServiceStartup, readServiceStartup,
  verifyReleaseDatabase, ROLLBACK_RUNTIME_SCOPE, probeRollbackRuntime, assertControllerBinding,
} from './release-proof.mjs';

const digest = char => char.repeat(64);
const protocolCapabilities = Object.freeze({
  accessDecisionSopSource: true,
  accessDecisionUnknownDomainRejected: true,
  intakeEntitlementSopSource: true,
  intakeEntitlementUnknownDomainRejected: true,
  intakeContractViewNegotiated: true,
  intakeEntitlementView: 'resource-disable',
});
function catalogue() {
  return Array.from({ length: 88 }, (_, index) => ({
    position: index + 1, id: `${String(index + 1).padStart(4, '0')}_migration`,
    sha256: digest('c'), contractSetId: 'synthetic-contract',
    sourceGitSha: 'd'.repeat(40), sourceSchemaSha256: digest('e'),
  }));
}
function manifestRows(rows) {
  return rows.map(row => ({ position: row.position, id: row.id, sha256: row.sha256,
    contract_set_id: row.contractSetId, source_git_sha: row.sourceGitSha,
    source_schema_sha256: row.sourceSchemaSha256 }));
}
function fixture(t, { sourceCount = 81, rollbackCount = 81 } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'release-proof-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const rows = catalogue();
  const previous = { sha: 'a'.repeat(40), version: '0.3.1', manifest: rows.slice(0, rollbackCount), runtimeBuildSha256: digest('1') };
  previous.root = path.join(root, 'releases', previous.sha);
  previous.targetText = previous.root;
  const next = { sha: 'b'.repeat(40), version: '0.3.2', manifest: rows, runtimeBuildSha256: digest('2') };
  next.root = path.join(root, 'releases', next.sha);
  const controller = { controllerRoot: next.root, controllerGitSha: next.sha,
    controllerBuildSha256: next.runtimeBuildSha256, environmentSha256: digest('9'), runtimeRelease: path.join(root, 'current'),
    stackRoot: path.join(root, 'stack'), unit: 'synthetic-test.service', unitType: 'simple', remainAfterExit: false, restart: 'on-failure' };
  const queryProfile = { mode: 'intake-compat', configurationSha256: digest('3'), apiEnvSha256: digest('4'),
    intakeLogins: { business: 'synthetic_business', usage: 'synthetic_usage', worker: 'synthetic_worker' } };
  const rollbackQueryProfile = { mode: 'unified', configurationSha256: digest('6'), apiEnvSha256: digest('7'), intakeLogins: null };
  const runtime = { status: 'PASS', code: null, queryMode: queryProfile.mode,
    configurationSha256: queryProfile.configurationSha256, scope: 'candidate-intake-catalog-readonly-gates' };
  const state = { count: sourceCount, ddl: [], journal: null, current: previous,
    originalEnv: Buffer.from('# original\r\nCUSTOMER_AGENT_BUILD_VERSION=0.3.1\r\nPRIVATE=synthetic-secret\r\n'),
    candidateEnv: Buffer.from('CUSTOMER_AGENT_BUILD_VERSION=0.3.2\nPRIVATE=synthetic-rotated\n'),
    env: null, backup: null, version: previous.version, installedProfile: null,
    writes: ['already-accepted'], fingerprint: digest('f'), events: [], locked: false };
  state.env = state.originalEnv;
  const client = { connect: async () => {}, end: async () => {}, query: async sql => {
    assert.match(sql, /^\s*(WITH|SELECT)\b/u);
    return { rows: [{ fingerprint: state.fingerprint }] };
  } };
  const database = { verifyAppliedDatabaseMigrations: async () => ({ status: 'PASS', migrationCount: state.count }),
    applyMigrationPrefix: async (_client, count) => {
      state.ddl.push(count);
      const applied = rows.slice(state.count, count);
      state.count = count;
      return { applied };
    } };
  const produce = () => applyCandidateRelease({ socket: '/synthetic/socket', port: 43199 }, 'synthetic_database',
    { database: { databaseOwner: 'synthetic_owner', migrations: rows.slice(0, sourceCount).map(row => ({
      ...row, migrationId: row.id,
    })) } },
    { ...next, gitSha: next.sha, manifest: { migrations: manifestRows(rows) } },
    { ...previous, gitSha: previous.sha, manifest: { migrations: manifestRows(previous.manifest) } },
    queryProfile, { controller, controllerArtifact: { ...next, gitSha: next.sha, manifest: { migrations: manifestRows(rows) } },
      rollbackQueryProfile, rollbackEnvironment: { synthetic: 'controlled' }, candidateApiEnvSha256: digest('4') }, { client,
      modules: [database, {}, { generatedMigrationCatalogue: { migrations: rows } }],
      probeRollback: async (_config, reader, count, requireApplied) => {
        assert.equal(reader.gitSha, controller.controllerGitSha);
        assert.equal(requireApplied, true);
        return verifyReleaseDatabase(database, client, count);
      },
      probeRollbackRuntime: async ({ release, migrationCount }) => ({ status: 'PASS', code: null,
        scope: ROLLBACK_RUNTIME_SCOPE, queryMode: rollbackQueryProfile.mode, protocolCapabilities: { ...protocolCapabilities },
        migrationCount, applicationGitSha: release.gitSha,
        runtimeBuildSha256: release.runtimeBuildSha256, version: release.version,
        configurationSha256: rollbackQueryProfile.configurationSha256, apiEnvSha256: rollbackQueryProfile.apiEnvSha256 }),
      probeRuntime: async () => runtime,
    });
  let evidence;
  const deps = {
    lock: async () => {
      if (state.locked) throw Object.assign(new Error('locked'), { code: 'DEPLOYMENT_LOCKED' });
      state.locked = true;
      return () => { state.locked = false; };
    },
    readCurrent: async () => ({ ...state.current, runtimeBuildSha256: undefined }), readNext: async () => next,
    readHistoricalRelease: async () => previous,
    readCandidateMetadata: async () => next,
    readState: async () => state.journal, writeState: async value => { state.journal = value; },
    readEvidence: async () => evidence,
    readProfile: async () => ({ root: controller.stackRoot }),
    readQueryProfile: async () => queryProfile,
    readInstalledQueryProfile: async () => state.installedProfile,
    readRollbackQueryProfile: async () => rollbackQueryProfile,
    readCandidateApiEnvDigest: async () => digest('4'),
    verifyInstalledApiEnv: async () => { assert.deepEqual(state.env, state.candidateEnv); },
    readServiceStartup: async () => controller,
    readTenantReport: async () => ({ ok: true, status: 'ready', blockers: [], activeBatchCount: 0, historicalDefaultBatchCount: 0 }),
    inspectTenancy: async () => ({ ok: true, status: 'ready', blockers: [], activeBatchCount: 0, historicalDefaultBatchCount: 0 }),
    inspectDatabase: async () => { await verifyReleaseDatabase(database, client); return rows.slice(0, state.count).map(row => row.id); },
    inspectContentFingerprint: async () => state.fingerprint,
    verifyRollbackDatabase: async () => { await verifyReleaseDatabase(database, client); state.events.push('verify-rollback'); },
    applyDatabase: async () => {
      const before = state.count;
      await database.applyMigrationPrefix(client, 88);
      return { appliedIds: rows.slice(before).map(row => row.id), finalIds: rows.map(row => row.id), verifierStatus: 'PASS' };
    },
    readApiVersion: async () => ({ version: state.version }),
    backupApiVersion: async () => {
      state.backup = Buffer.from(state.env);
      state.events.push('backup');
      return { backup: '/synthetic/env.backup', sha256: digest('7'), version: state.version };
    },
    readApiVersionBackup: async () => ({ bytes: state.backup, version: previous.version }),
    installCandidateApiEnv: async () => {
      state.env = state.candidateEnv; state.version = next.version;
      state.installedProfile = queryProfile; state.events.push('env-installed');
    },
    writeApiVersion: async () => { throw new Error('candidate env must be installed in full'); },
    restoreApiVersion: async value => {
      state.env = value.bytes; state.version = previous.version; state.events.push('env-restored');
    },
    switchCurrent: async () => { state.current = next; state.events.push('switch'); },
    restoreCurrent: async () => { state.current = previous; state.events.push('restore-current'); },
    restartService: async () => { state.events.push('restart'); },
    waitForReady: async (_profile, version) => { state.events.push(`ready-${version}`); },
    audit: async () => {},
  };
  const options = { apply: true, root, stackRoot: controller.stackRoot,
    controllerRelease: next.root, candidateApiEnv: '/synthetic/candidate.env', sha: next.sha,
    expectedVersion: next.version };
  return { state, rows, previous, next, controller, queryProfile, rollbackQueryProfile, runtime, produce, deps, options,
    setEvidence: proof => { evidence = { backupId: 'synthetic-backup', migrationCount: proof.targetMigrationCount, deploymentChecks: proof }; },
    get evidence() { return evidence; } };
}

for (const count of [81, 82, 83, 84, 85, 86, 87, 88]) {
  test(`rolling_back recovers prefix${count} before candidate/evidence/content gates and retains writes`, async t => {
    const f = fixture(t);
    const { deploymentChecks: proof } = await f.produce();
    f.setEvidence(proof);
    f.state.count = 81;
    f.deps.waitForReady = async (_profile, version) => {
      if (version === f.next.version) throw Object.assign(new Error('not ready'), { code: 'READINESS_FAILED' });
    };
    f.deps.restoreCurrent = async () => { throw new Error('interrupted restore'); };
    await assert.rejects(() => runProductionRelease(f.options, f.deps), { code: 'ROLLBACK_FAILED' });
    assert.equal(f.state.journal.status, 'rolling_back');
    f.state.count = count;
    f.state.writes.push('accepted-after-upgrade');
    f.state.fingerprint = digest('0');
    f.deps.readEvidence = async () => { throw new Error('must recover from original journal'); };
    f.deps.readQueryProfile = async () => { throw new Error('candidate config unavailable'); };
    f.deps.inspectContentFingerprint = async () => { throw new Error('source content has changed'); };
    f.deps.restoreCurrent = async () => { f.state.current = f.previous; };
    f.deps.waitForReady = async (_profile, version) => { assert.equal(version, f.previous.version); };
    const result = await runProductionRelease(f.options, f.deps);
    assert.equal(result.status, 'rolled-back');
    assert.equal(f.state.count, count);
    assert.deepEqual(f.state.env, f.state.originalEnv);
    assert.deepEqual(f.state.writes, ['already-accepted', 'accepted-after-upgrade']);
    assert.equal(f.state.journal.status, 'rolled_back');
  });
}

for (const [label, mutate, code] of [
  ['schema', f => { f.evidence.deploymentChecks.schema = 'unknown'; }, 'RELEASE_PREFLIGHT_REQUIRED'],
  ['profile', f => { f.deps.readQueryProfile = async () => ({ ...f.queryProfile, configurationSha256: digest('8') }); }, 'RELEASE_QUERY_PROFILE_CHANGED'],
  ['env bytes', f => { f.deps.readQueryProfile = async () => ({ ...f.queryProfile, apiEnvSha256: digest('8') }); }, 'RELEASE_QUERY_PROFILE_CHANGED'],
  ['controller service type', f => { f.deps.readServiceStartup = async () => ({ ...f.controller, unitType: 'oneshot' }); }, 'SERVICE_STARTUP_CHANGED'],
  ['controller environment', f => { f.deps.readServiceStartup = async () => ({ ...f.controller, environmentSha256: digest('8') }); }, 'SERVICE_STARTUP_CHANGED'],
  ['controller build', f => { f.deps.readServiceStartup = async () => ({ ...f.controller, controllerBuildSha256: digest('8') }); }, 'SERVICE_STARTUP_CHANGED'],
  ['candidate build', f => { f.deps.readNext = async () => ({ ...f.next, runtimeBuildSha256: digest('8') }); }, 'RELEASE_RUNTIME_BUILD_CHANGED'],
  ['rollback build', f => { f.deps.readHistoricalRelease = async () => ({ ...f.previous, runtimeBuildSha256: digest('8') }); }, 'RELEASE_RUNTIME_BUILD_CHANGED'],
  ['content', f => { f.state.fingerprint = digest('8'); }, 'RELEASE_PREFLIGHT_STALE'],
  ['unknown prefix', f => { f.state.count = 89; f.deps.inspectDatabase = async () => ['unknown']; }, 'DATABASE_PREFIX_MISMATCH'],
]) {
  test(`v3 rejects ${label} drift before release mutation`, async t => {
    const f = fixture(t);
    f.setEvidence(structuredClone((await f.produce()).deploymentChecks));
    mutate(f);
    await assert.rejects(() => runProductionRelease(f.options, f.deps), { code });
    assert.equal(f.state.journal, null);
    assert.deepEqual(f.state.env, f.state.originalEnv);
    assert.equal(f.state.current, f.previous);
  });
}

test('unknown migration commit outcome is checked from actual prefix before recovery', async t => {
  const f = fixture(t);
  f.setEvidence((await f.produce()).deploymentChecks);
  f.state.count = 81;
  f.deps.applyDatabase = async () => { f.state.count = 84; throw new Error('lost commit reply'); };
  await assert.rejects(() => runProductionRelease(f.options, f.deps), /lost commit reply/u);
  assert.equal(f.state.count, 84);
  assert.equal(f.state.journal.status, 'rolled_back');
  assert.deepEqual(f.state.env, f.state.originalEnv);
});

test('physical drift blocks rollback success and keeps a recoverable journal', async t => {
  const f = fixture(t);
  f.setEvidence((await f.produce()).deploymentChecks);
  f.state.count = 81;
  f.deps.applyDatabase = async () => { throw new Error('lost commit reply'); };
  f.deps.inspectDatabase = async () => {
    if (f.state.journal) throw Object.assign(new Error('physical drift'), { code: 'MIGRATION_VERIFY_FAILED' });
    return f.rows.slice(0, 81).map(row => row.id);
  };
  await assert.rejects(() => runProductionRelease(f.options, f.deps), { code: 'ROLLBACK_FAILED' });
  assert.equal(f.state.journal.status, 'rolling_back');
  assert.equal(f.state.current, f.previous);
});

test('exact metadata prefix compares every identity field', () => {
  const rows = catalogue();
  assert.doesNotThrow(() => assertReleasePrefix(rows.slice(0, 81), rows));
  for (const field of ['position', 'id', 'sha256', 'contractSetId', 'sourceGitSha', 'sourceSchemaSha256']) {
    const changed = structuredClone(rows.slice(0, 81));
    changed[80][field] = 'changed';
    assert.throws(() => assertReleasePrefix(changed, rows), { code: 'DATABASE_PREFIX_MISMATCH' });
  }
});

test('applied reader owns its transaction while legacy reader still requires complete catalogue', async () => {
  const sql = [];
  const client = { query: async value => { sql.push(value); } };
  assert.equal((await verifyReleaseDatabase({ verifyAppliedDatabaseMigrations: async () => ({ status: 'PASS', migrationCount: 81 }) }, client, 81)).capability, 'applied-prefix');
  assert.deepEqual(sql, []);
  const legacy = { inspectDatabaseMigrations: async () => ({ state: 'PARTIAL', applied: Array(81) }),
    verifyDatabaseMigrations: async () => { throw new Error('cannot bypass catalogue inspection'); } };
  await assert.rejects(() => verifyReleaseDatabase(legacy, client, 81), { code: 'ROLLBACK_MIGRATION_INCOMPATIBLE' });
  assert.equal(sql.at(-1), 'ROLLBACK');
  legacy.inspectDatabaseMigrations = async () => ({ state: 'COMPLETE', applied: Array(81) });
  legacy.verifyDatabaseMigrations = async () => ({ status: 'PASS', migrationCount: 81 });
  assert.equal((await verifyReleaseDatabase(legacy, client, 81)).capability, 'complete-catalogue');
  await assert.rejects(() => verifyReleaseDatabase(legacy, client, 82), { code: 'DATABASE_PREFIX_VERIFICATION_FAILED' });
});

function serviceFixture() {
  const expected = { controllerRoot: '/synthetic/releases/' + 'b'.repeat(40), controllerGitSha: 'b'.repeat(40),
    controllerBuildSha256: digest('c'), runtimeRelease: '/synthetic/current', stackRoot: '/synthetic/stack',
    unit: 'synthetic.service', unitType: 'simple', remainAfterExit: false, restart: 'on-failure' };
  const argv = ['/usr/local/bin/node', path.join(expected.controllerRoot, 'scripts/synthetic-stack/stack.ts'),
    'start', '--foreground', '--existing-database', '--runtime-release', expected.runtimeRelease];
  const properties = {
    ExecStart: `{ path=${argv[0]} ; argv[]=${argv.join(' ')} ; ignore_errors=no ; pid=123 ; code=(null) ; status=0/0 }`,
    Environment: `CUSTOMER_AGENT_STACK_ROOT=${expected.stackRoot}`,
    EnvironmentFiles: '', Type: 'simple', RemainAfterExit: 'no', Restart: 'on-failure',
    MainPID: '123', ActiveState: 'active',
  };
  const files = new Map([
    ['/proc/123/cmdline', Buffer.from(argv.join('\0') + '\0')],
    ['/proc/123/environ', Buffer.from(properties.Environment + '\0PRIVATE=synthetic-secret\0INVOCATION_ID=first\0')],
  ]);
  const read = filename => {
    if (!files.has(filename)) throw Object.assign(new Error('synthetic-private-read-error'), { code: 'ENOENT' });
    return files.get(filename);
  };
  const execute = (command, args, options) => {
    assert.equal(command, 'systemctl');
    assert.deepEqual(args, ['show', expected.unit, '--all',
      '--property=ExecStart,Environment,EnvironmentFiles,Type,RemainAfterExit,Restart,MainPID,ActiveState']);
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
    return Object.entries(properties).map(([key, value]) => `${key}=${value}\n`).join('');
  };
  return { expected, argv, properties, files, read, execute,
    inspect: () => readServiceStartup(expected, execute, read) };
}

test('service startup pins immutable controller, foreground, existing DB, current runtime and stack root', () => {
  const { expected, argv } = serviceFixture();
  const startup = { ...expected, argv, environmentSha256: digest('9') };
  assert.deepEqual(assertServiceStartup(startup, expected), { ...expected, environmentSha256: digest('9') });
  for (const position of [3, 4, 5, 6]) {
    const reordered = argv.filter(value => value !== '--foreground');
    reordered.splice(position, 0, '--foreground');
    assert.doesNotThrow(() => assertServiceStartup({ ...startup, argv: reordered }, expected));
  }
  for (const change of [values => values.filter(x => x !== '--existing-database'), values => [...values, '--no-seed'],
    values => values.map(x => x === expected.runtimeRelease ? '/other/current' : x),
    values => values.map(x => x.endsWith('stack.ts') ? '/synthetic/current/scripts/synthetic-stack/stack.ts' : x),
    values => [42, ...values.slice(1)], values => [...values, null], values => [...values, '--foreground']]) {
    assert.throws(() => assertServiceStartup({ ...startup, argv: change(argv) }, expected), { code: 'SERVICE_STARTUP_INVALID' });
  }
  for (const change of [{ stackRoot: '/other/stack' }, { unitType: 'oneshot' }, { remainAfterExit: 'false' },
    { restart: 'no' }, { environmentSha256: undefined }]) {
    assert.throws(() => assertServiceStartup({ ...startup, ...change }, expected), { code: 'SERVICE_STARTUP_INVALID' });
  }
});

test('systemd empty properties can be present or omitted', () => {
  const f = serviceFixture();
  const binding = f.inspect();
  const { environmentSha256, ...fields } = binding;
  assert.deepEqual(fields, f.expected);
  assert.match(environmentSha256, /^[0-9a-f]{64}$/u);
  delete f.properties.EnvironmentFiles;
  assert.deepEqual(f.inspect(), binding);
  f.properties.Environment = '';
  const empty = f.inspect();
  delete f.properties.Environment;
  assert.deepEqual(f.inspect(), empty);
});

for (const unitType of ['simple', 'exec']) {
  for (const restart of ['on-failure', 'always']) {
    for (const remainAfterExit of [false, true]) {
      test(`service binds ${unitType} ${restart} RemainAfterExit=${remainAfterExit}`, () => {
        const f = serviceFixture();
        Object.assign(f.properties, { Type: unitType, Restart: restart, RemainAfterExit: remainAfterExit ? 'yes' : 'no' });
        const binding = f.inspect();
        assert.equal(binding.unitType, unitType);
        assert.equal(binding.restart, restart);
        assert.equal(binding.remainAfterExit, remainAfterExit);
        assert.doesNotThrow(() => assertControllerBinding(binding, { ...binding }));
      });
    }
  }
}

test('environment files bind ordered paths, bytes and explicitly missing optional files', () => {
  const f = serviceFixture();
  const empty = f.inspect();
  f.properties.EnvironmentFiles = '/synthetic/base.env (ignore_errors=no) /synthetic/optional.env (ignore_errors=yes)';
  f.properties.Environment = 'PRIVATE=synthetic-declared-secret';
  f.files.set('/synthetic/base.env', Buffer.from(`CUSTOMER_AGENT_STACK_ROOT=${f.expected.stackRoot}\nPRIVATE=synthetic-secret\n`));
  const missing = f.inspect();
  assert.notEqual(missing.environmentSha256, empty.environmentSha256);
  assert.doesNotThrow(() => assertControllerBinding(missing, { ...missing }));
  f.files.set('/synthetic/optional.env', Buffer.alloc(0));
  const present = f.inspect();
  assert.notEqual(present.environmentSha256, missing.environmentSha256);
  f.files.set('/synthetic/optional.env', Buffer.from('PRIVATE=synthetic-rotated\n'));
  const changed = f.inspect();
  assert.notEqual(changed.environmentSha256, present.environmentSha256);
  assert.throws(() => assertControllerBinding(missing, changed), { code: 'SERVICE_STARTUP_CHANGED' });
  f.properties.EnvironmentFiles = '/synthetic/optional.env (ignore_errors=yes) /synthetic/base.env (ignore_errors=no)';
  assert.notEqual(f.inspect().environmentSha256, changed.environmentSha256);
  f.properties.EnvironmentFiles = '/synthetic/copied.env (ignore_errors=no) /synthetic/optional.env (ignore_errors=yes)';
  f.files.set('/synthetic/copied.env', f.files.get('/synthetic/base.env'));
  assert.notEqual(f.inspect().environmentSha256, changed.environmentSha256);
  assert.doesNotMatch(JSON.stringify(changed), /synthetic-(?:declared-secret|secret|rotated)/u);
});

test('environment file paths with literal spaces retain their byte binding', () => {
  const f = serviceFixture();
  f.properties.EnvironmentFiles = '/synthetic/config files/base.env (ignore_errors=no)';
  f.files.set('/synthetic/config files/base.env', Buffer.from(`CUSTOMER_AGENT_STACK_ROOT=${f.expected.stackRoot}\n`));
  const binding = f.inspect();
  assert.match(binding.environmentSha256, /^[0-9a-f]{64}$/u);
  f.files.set('/synthetic/config files/base.env', Buffer.from('PRIVATE=synthetic-secret\n'));
  assert.notEqual(f.inspect().environmentSha256, binding.environmentSha256);
});

test('restart-generated process environment and MainPID leave the static environment digest stable', () => {
  const f = serviceFixture();
  const original = f.inspect();
  f.properties.MainPID = '456';
  f.files.set('/proc/456/cmdline', f.files.get('/proc/123/cmdline'));
  f.files.set('/proc/456/environ', Buffer.from(`INVOCATION_ID=second\0JOURNAL_STREAM=other\0PRIVATE=rotated\0CUSTOMER_AGENT_STACK_ROOT=${f.expected.stackRoot}\0`));
  assert.deepEqual(f.inspect(), original);
  f.properties.Environment += ' PRIVATE=synthetic-declared-secret';
  assert.notEqual(f.inspect().environmentSha256, original.environmentSha256);
});

for (const [label, mutate] of [
  ['unserialized environment file', f => { f.properties.EnvironmentFiles = '/synthetic/base.env'; }],
  ['bad ignore-errors value', f => { f.properties.EnvironmentFiles = '/synthetic/base.env (ignore_errors=maybe)'; }],
  ['relative environment file', f => { f.properties.EnvironmentFiles = 'base.env (ignore_errors=yes)'; }],
  ['trailing file garbage', f => { f.properties.EnvironmentFiles = '/synthetic/base.env (ignore_errors=yes) garbage'; }],
  ['required missing environment file', f => { f.properties.EnvironmentFiles = '/synthetic/base.env (ignore_errors=no)'; }],
  ['unexpected arguments', f => { f.properties.ExecStart = f.properties.ExecStart.replace('--existing-database', '--no-seed'); }],
  ['escaped arguments', f => { f.properties.ExecStart = f.properties.ExecStart.replace('argv[]=', 'argv[]=\\'); }],
  ['oneshot', f => { f.properties.Type = 'oneshot'; }],
  ['bad boolean', f => { f.properties.RemainAfterExit = 'false'; }],
  ['no restart', f => { f.properties.Restart = 'no'; }],
  ['missing PID', f => { delete f.properties.MainPID; }],
  ['zero PID', f => { f.properties.MainPID = '0'; }],
  ['negative PID', f => { f.properties.MainPID = '-123'; }],
  ['fractional PID', f => { f.properties.MainPID = '1.23'; }],
  ['unsafe PID', f => { f.properties.MainPID = '9007199254740993'; }],
  ['inactive', f => { f.properties.ActiveState = 'inactive'; }],
  ['missing process', f => { f.files.delete('/proc/123/cmdline'); }],
  ['missing process environment', f => { f.files.delete('/proc/123/environ'); }],
  ['actual argv mismatch', f => { f.files.set('/proc/123/cmdline', Buffer.from(f.argv.map(value => value === f.expected.runtimeRelease ? '/other/current' : value).join('\0') + '\0')); }],
  ['actual root mismatch', f => { f.files.set('/proc/123/environ', Buffer.from('CUSTOMER_AGENT_STACK_ROOT=/other/stack\0')); }],
  ['actual root missing', f => { f.files.set('/proc/123/environ', Buffer.from('PRIVATE=synthetic-secret\0')); }],
  ['duplicate actual root', f => { f.files.set('/proc/123/environ', Buffer.from(`${f.properties.Environment}\0${f.properties.Environment}\0`)); }],
  ['unterminated cmdline', f => { f.files.set('/proc/123/cmdline', Buffer.from(f.argv.join('\0'))); }],
  ['unterminated environment', f => { f.files.set('/proc/123/environ', Buffer.from(f.properties.Environment)); }],
]) {
  test(`service rejects ${label} with a stable sanitized error`, () => {
    const f = serviceFixture();
    mutate(f);
    assert.throws(f.inspect, error => {
      assert.equal(error.code, 'SERVICE_STARTUP_INVALID');
      assert.equal(error.message, 'SERVICE_STARTUP_INVALID');
      assert.doesNotMatch(error.stack, /synthetic-(?:private|secret)/u);
      return true;
    });
  });
}

test('optional environment files only ignore ENOENT and command failures stay sanitized', () => {
  const f = serviceFixture();
  f.properties.EnvironmentFiles = '/synthetic/optional.env (ignore_errors=yes)';
  for (const code of ['EACCES', 'EISDIR', 'EIO']) {
    assert.throws(() => readServiceStartup(f.expected, f.execute, () => {
      throw Object.assign(new Error('synthetic-private-read-error'), { code });
    }), { code: 'SERVICE_STARTUP_INVALID', message: 'SERVICE_STARTUP_INVALID' });
  }
  assert.throws(() => readServiceStartup(f.expected, () => { throw new Error('synthetic-private-systemctl-error'); }, f.read),
    { code: 'SERVICE_STARTUP_INVALID', message: 'SERVICE_STARTUP_INVALID' });
});

test('controller environment digest is required and drift is rejected', () => {
  const binding = serviceFixture().inspect();
  for (const value of [undefined, null, '', 'invalid', digest('0')]) {
    assert.throws(() => assertControllerBinding(binding, { ...binding, environmentSha256: value }), { code: 'SERVICE_STARTUP_CHANGED' });
    if (value !== digest('0')) {
      assert.throws(() => assertControllerBinding({ ...binding, environmentSha256: value }, { ...binding, environmentSha256: value }),
        { code: 'SERVICE_STARTUP_CHANGED' });
    }
  }
  for (const change of [{ remainAfterExit: true }, { restart: 'always' }]) {
    assert.throws(() => assertControllerBinding(binding, { ...binding, ...change }), { code: 'SERVICE_STARTUP_CHANGED' });
  }
});

for (const count of [82, 83, 84, 85, 86, 87]) {
  test(`deploying retry resumes exact committed prefix${count} without replaying its migrations`, async t => {
    const f = fixture(t);
    const { deploymentChecks: proof } = await f.produce();
    f.setEvidence(proof);
    f.state.count = count;
    f.state.backup = Buffer.from(f.state.originalEnv);
    f.state.journal = { schema: 'customer-agent-production-release-state/v1', status: 'deploying',
      releaseProof: proof, candidateSha: f.next.sha, candidateVersion: f.next.version,
      previousSha: f.previous.sha, previousVersion: f.previous.version, previousTargetText: f.previous.root,
      backupId: 'synthetic-backup', pointerSwitched: false, serviceStageReached: false,
      apiEnvBackup: { path: '/synthetic/env.backup', sha256: digest('7'), version: f.previous.version } };
    f.state.writes.push('accepted-before-retry');
    const result = await runProductionRelease(f.options, f.deps);
    assert.equal(result.status, 'applied');
    assert.equal(result.resuming, true);
    assert.deepEqual(result.appliedMigrationIds, f.rows.slice(count).map(row => row.id));
    assert.deepEqual(f.state.writes, ['already-accepted', 'accepted-before-retry']);
  });
}

test('v3 invalid journal proof cannot trigger recovery side effects', async t => {
  const f = fixture(t);
  f.setEvidence((await f.produce()).deploymentChecks);
  f.state.count = 81;
  f.deps.waitForReady = async (_profile, version) => {
    if (version === f.next.version) throw new Error('not ready');
  };
  f.deps.restoreCurrent = async () => { throw new Error('interrupted rollback'); };
  await assert.rejects(() => runProductionRelease(f.options, f.deps), { code: 'ROLLBACK_FAILED' });
  const original = f.state.journal;
  f.state.journal = { ...original, releaseProof: { ...original.releaseProof, rollbackGitSha: f.next.sha } };
  f.state.events.length = 0;
  await assert.rejects(() => runProductionRelease(f.options, f.deps), { code: 'RELEASE_PREFLIGHT_REQUIRED' });
  assert.deepEqual(f.state.events, []);
  assert.equal(f.state.journal.status, 'rolling_back');
});

test('v3 backs up the original config before journal and audit writes and keeps it after pre-switch failure', async t => {
  const f = fixture(t);
  f.setEvidence((await f.produce()).deploymentChecks);
  const writeState = f.deps.writeState;
  f.deps.writeState = async value => {
    assert.deepEqual(f.state.backup, f.state.originalEnv);
    return writeState(value);
  };
  f.deps.audit = async () => { assert.deepEqual(f.state.backup, f.state.originalEnv); };
  f.deps.applyDatabase = async () => { throw new Error('before pointer'); };
  await assert.rejects(() => runProductionRelease(f.options, f.deps), /before pointer/u);
  assert.equal(f.state.current, f.previous);
  assert.deepEqual(f.state.env, f.state.originalEnv);
  assert.equal(f.state.journal.status, 'rolled_back');
});


test('v3 migrates81 to full88 with controller physical proof and actual rollback application scope, then converges', async t => {
  const f = fixture(t);
  const result = await f.produce();
  const proof = result.deploymentChecks;
  assert.equal(proof.schema, RELEASE_PROOF_SCHEMA);
  assert.equal(proof.sourceMigrationCount, 81);
  assert.equal(proof.targetMigrationCount, 88);
  assert.equal(f.previous.manifest.length, 81);
  assert.deepEqual(f.state.ddl, [82, 83, 84, 85, 86, 87, 88]);
  assert.deepEqual(proof.rollback.map(row => row.migrationCount), [81, 82, 83, 84, 85, 86, 87, 88]);
  assert.equal(proof.rollback.every(row => row.database.readerGitSha === f.controller.controllerGitSha), true);
  assert.equal(proof.rollback.every(row => row.runtime.applicationGitSha === f.previous.sha && row.runtime.scope === ROLLBACK_RUNTIME_SCOPE), true);
  f.setEvidence(proof);
  f.state.count = 81;
  assert.equal((await runProductionRelease(f.options, f.deps)).status, 'applied');
  assert.equal(f.state.count, 88);
  assert.deepEqual(f.state.env, f.state.candidateEnv);
  assert.deepEqual(f.state.writes, ['already-accepted']);
  const ddl = [...f.state.ddl];
  assert.equal((await runProductionRelease(f.options, f.deps)).status, 'already-complete');
  assert.deepEqual(f.state.ddl, ddl);
});

test('removed release action is rejected by CLI and programmatic boundary', async t => {
  const f = fixture(t);
  await assert.rejects(() => runProductionRelease({ ...f.options, action: 'runtime-only' }, f.deps), { code: 'INVALID_ARGUMENTS' });
  assert.throws(() => parseOptions(['--action', 'runtime-only']), { code: 'INVALID_ARGUMENTS' });
});

test('v3 cannot replace the complete candidate target with the source prefix', async t => {
  const f = fixture(t);
  f.setEvidence({ ...(await f.produce()).deploymentChecks, targetMigrationCount: 81 });
  f.state.count = 81;
  await assert.rejects(() => runProductionRelease(f.options, f.deps), { code: 'RELEASE_PREFLIGHT_REQUIRED' });
  assert.equal(f.state.journal, null);
});

test('v3 completion verifies the actual target ledger even when intermediate readiness is green', async t => {
  const f = fixture(t);
  f.setEvidence((await f.produce()).deploymentChecks);
  f.state.count = 81;
  await runProductionRelease(f.options, f.deps);
  f.state.count = 84;
  await assert.rejects(() => runProductionRelease(f.options, f.deps), { code: 'DATABASE_PREFIX_MISMATCH' });
  assert.equal(f.state.journal.status, 'complete');
});


function rollbackServerFixture(t, { behavior = 'ready', decoder = 'modern', mode = 'unified',
  manifestCount = 81, migrationCount = 84 } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rollback-server-probe-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dist = path.join(root, 'apps/api/dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  const unified = path.join(root, 'packages/unified-contracts/dist');
  mkdirSync(unified, { recursive: true });
  mkdirSync(path.join(dist, 'content-intake'), { recursive: true });
  const actualUnifiedContracts = new URL('../../packages/unified-contracts/dist/index.js', import.meta.url).href;
  const actualIntakeEntitlement = new URL('../../apps/api/dist/content-intake/contract-view.js', import.meta.url).href;
  const actualResourceContracts = new URL('../../packages/contracts/dist/sop-resource-disable.js', import.meta.url).href;
  const actualBootstrap = new URL('../../apps/api/dist/runtime-config.js', import.meta.url).href;
  const resourceDist = path.join(root, 'packages/contracts/dist');
  mkdirSync(resourceDist, { recursive: true });
  writeFileSync(path.join(resourceDist, 'sop-resource-disable.js'),
    `export { CONTRACT_PROVENANCE } from ${JSON.stringify(actualResourceContracts)};`);
  writeFileSync(path.join(unified, 'index.js'), `
    import { parseAccessDecision as parseActual } from ${JSON.stringify(actualUnifiedContracts)};
    export function parseAccessDecision(value) {
      if (${JSON.stringify(decoder)} === 'legacy-access' && value.allowedScopes.some(row => row.scope.domain === 'sop')) throw new Error('old decoder');
      if (${JSON.stringify(decoder)} === 'permissive-access' && value.allowedScopes.some(row => !['product', 'sop'].includes(row.scope.domain))) return value;
      const parsed = parseActual(value);
      if (${JSON.stringify(decoder)} === 'discarded-access') parsed.allowedScopes.pop();
      return parsed;
    }
  `);
  writeFileSync(path.join(dist, 'content-intake/contract-view.js'), `
    import { parseContractSchema as parseActual, selectIntakeView as selectActual, intakeContractSet as actualContractSet } from ${JSON.stringify(actualIntakeEntitlement)};
    import { parseContractSchema as parseLegacy } from ${JSON.stringify(new URL('../../packages/contracts/dist/index.js', import.meta.url).href)};
    export { withIntakeView } from ${JSON.stringify(actualIntakeEntitlement)};
    export function selectIntakeView(headers) {
      return ${JSON.stringify(decoder)} === 'legacy-view' ? 'unsupported' : selectActual(headers);
    }
    export function intakeContractSet() {
      return ${JSON.stringify(decoder)} === 'wrong-view-context' ? 'synthetic-other-contract' : actualContractSet();
    }
    export function parseContractSchema(name, value) {
      if (${JSON.stringify(decoder)} === 'legacy-entitlement') return parseLegacy(name, value);
      if (${JSON.stringify(decoder)} === 'permissive-entitlement' && value.scopes.some(row => !['product', 'sop'].includes(row.domain))) return value;
      const parsed = parseActual(name, value);
      if (${JSON.stringify(decoder)} === 'discarded-entitlement') return { ...parsed, scopes: parsed.scopes.slice(0, 1) };
      return parsed;
    }
  `);
  writeFileSync(path.join(dist, 'runtime-config.js'), `
    import { parseApiPrivateBootstrapConfig as parseActual } from ${JSON.stringify(actualBootstrap)};
    export function parseApiPrivateBootstrapConfig(environment) {
      const bootstrap = parseActual(environment);
      if (${JSON.stringify(decoder)} === 'bootstrap-mismatch') return { ...bootstrap, query: { ...bootstrap.query, mode: 'intake-compat' } };
      return bootstrap;
    }
  `);
  if (decoder === 'missing-access') rmSync(path.join(unified, 'index.js'));
  if (decoder === 'missing-entitlement') writeFileSync(path.join(dist, 'content-intake/contract-view.js'), 'export {};');
  if (decoder === 'missing-bootstrap') writeFileSync(path.join(dist, 'runtime-config.js'), 'export {};');
  const observed = path.join(root, 'observed.json');
  writeFileSync(path.join(dist, 'server.js'), `
    import { createServer } from 'node:http';
    import { writeFileSync } from 'node:fs';
    const intakeAtImport = process.env.INTAKE_BUSINESS_DATABASE_URL;
    if (process.env.PGOPTIONS !== '-c default_transaction_read_only=on') throw new Error('import requires read-only');
    export async function startApi({ environment }) {
      if (intakeAtImport !== environment.INTAKE_BUSINESS_DATABASE_URL) throw new Error('import composition mismatch');
      if (process.env.PGOPTIONS !== '-c default_transaction_read_only=on') throw new Error('read-only required');
      if (${JSON.stringify(behavior)} === 'ambient-missing') delete process.env.INTAKE_BUSINESS_DATABASE_URL;
      if (${JSON.stringify(behavior)} === 'ambient-mismatch') process.env.INTAKE_BUSINESS_DATABASE_URL = 'postgresql://synthetic_wrong@127.0.0.1/synthetic_restored';
      for (const [key, value] of Object.entries(environment)) {
        if (process.env[key] !== value) throw new Error('ambient composition mismatch');
      }
      if (environment.CUSTOMER_AGENT_REVIEW_LOGIN_PORT !== undefined) throw new Error('extra listener');
      if (environment.CONTENT_OBJECT_STORE_DIR === '/synthetic/live-objects') throw new Error('live objects');
      const connections = Object.entries(environment).filter(([key]) => key === 'DATABASE_URL' || key.endsWith('_DATABASE_URL'));
      if (connections.some(([, value]) => new URL(value).pathname !== '/synthetic_restored')) throw new Error('wrong database');
      const facts = { objectStore: environment.CONTENT_OBJECT_STORE_DIR, readonly: process.env.PGOPTIONS,
        queryMode: environment.CUSTOMER_AGENT_QUERY_MODE, pools: connections.length, requests: [], closed: false };
      const record = () => writeFileSync(${JSON.stringify(observed)}, JSON.stringify(facts));
      record();
      const server = createServer((request, response) => {
        facts.requests.push(request.method + ' ' + request.url);
        record();
        const checks = { auth: 'ok', content: 'ok', database: 'ok', schema: 'ok', storage: 'ok' };
        if (${JSON.stringify(behavior)} === 'not-ready') checks.schema = 'not_ready';
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(request.url === '/health'
          ? { status: 'ok', service: 'cs-ai-api', version: ${JSON.stringify(behavior)} === 'wrong-version' ? '9.9.9' : environment.CUSTOMER_AGENT_BUILD_VERSION }
          : { status: 'ready', checks }));
      });
      await new Promise(resolve => server.listen(Number(environment.CUSTOMER_AGENT_API_PORT), '127.0.0.1', resolve));
      return { address: 'http://127.0.0.1:' + server.address().port,
        async close() {
          await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
          facts.closed = true;
          record();
          if (${JSON.stringify(behavior)} === 'cleanup-failed') throw new Error('private cleanup detail');
        } };
    }
  `);
  const environment = { CUSTOMER_AGENT_BUILD_VERSION: '0.3.1', CONTENT_OBJECT_STORE_DIR: '/synthetic/live-objects',
    CUSTOMER_AGENT_REVIEW_LOGIN_PORT: '43112', PGOPTIONS: '-c default_transaction_read_only=off',
    CUSTOMER_AGENT_PROFILE: 'formal-dev', AUTH_MODE: 'mock', AUTH_SESSION_MODE: 'product',
    CUSTOMER_AGENT_QUERY_MODE: mode, SYNTHETIC_IDENTITY_PROVIDER_ORIGIN: 'http://127.0.0.1:44002',
    IDEMPOTENCY_HMAC_KEYS: JSON.stringify({ 'hmac-idempotency-v1': 'synthetic-idempotency-material-0001' }),
    IDEMPOTENCY_HMAC_CURRENT_VERSION: 'hmac-idempotency-v1',
    LOG_HASH_KEY: 'synthetic-log-hash-material-00000001', LOG_HASH_KEY_VERSION: 'hmac-log-v1' };
  for (const key of ['DATABASE_URL', 'CONTENT_ADMIN_DATABASE_URL', 'AUTH_DATABASE_URL', 'CONTENT_REVIEW_DATABASE_URL',
    'CONTENT_WORKER_DATABASE_URL', 'INTAKE_BUSINESS_DATABASE_URL', 'INTAKE_USAGE_DATABASE_URL', 'INTAKE_WORKER_DATABASE_URL']) {
    environment[key] = 'postgresql://synthetic_' + key.toLowerCase() + '@127.0.0.1/synthetic_live';
  }
  const options = { release: { root, gitSha: 'a'.repeat(40), runtimeBuildSha256: digest('1'), version: '0.3.1',
    manifest: { migrations: manifestRows(catalogue().slice(0, manifestCount)) } },
    database: { host: '/synthetic/scratch-socket', port: 43199, database: 'synthetic_restored' }, environment,
    queryProfile: { mode, configurationSha256: digest('6'), apiEnvSha256: digest('7') }, migrationCount };
  return { root, observed, options };
}

for (const behavior of ['ready', 'not-ready', 'wrong-version', 'cleanup-failed', 'ambient-missing', 'ambient-mismatch']) {
  test(`rollback probe imports the actual server entry and checks HTTP with isolated resources ${behavior}`, async t => {
    const { options, observed } = rollbackServerFixture(t, { behavior });
    const result = await probeRollbackRuntime(options);
    assert.equal(result.scope, ROLLBACK_RUNTIME_SCOPE);
    assert.equal(result.migrationCount, 84);
    assert.equal(result.status, behavior === 'ready' ? 'PASS' : 'FAIL');
    assert.equal(result.code, behavior === 'ready' ? null : behavior === 'cleanup-failed' ? 'ROLLBACK_API_CLEANUP_FAILED' : 'ROLLBACK_API_RUNTIME_FAILED');
    if (behavior.startsWith('ambient-')) {
      assert.equal(existsSync(observed), false);
      return;
    }
    const facts = JSON.parse(readFileSync(observed, 'utf8'));
    assert.equal(existsSync(facts.objectStore), false);
    assert.equal(facts.pools, 8);
    assert.equal(facts.readonly, '-c default_transaction_read_only=on');
    assert.equal(JSON.stringify(result).includes('private cleanup detail'), false);
    assert.deepEqual(facts.requests, ['GET /health', 'GET /ready']);
    assert.equal(facts.closed, true);
    if (behavior === 'ready') {
      assert.deepEqual(result.protocolCapabilities, protocolCapabilities);
      assert.equal(result.queryMode, 'unified');
    }
  });
}

test('rollback protocol admission runs actual compiled decoders and the selected intake-compat bootstrap', async t => {
  const { options, observed } = rollbackServerFixture(t, { mode: 'intake-compat' });
  const result = await probeRollbackRuntime(options);
  assert.equal(result.status, 'PASS');
  assert.equal(result.code, null);
  assert.equal(result.queryMode, 'intake-compat');
  assert.deepEqual(result.protocolCapabilities, protocolCapabilities);
  const facts = JSON.parse(readFileSync(observed, 'utf8'));
  assert.equal(facts.queryMode, 'intake-compat');
  assert.deepEqual(facts.requests, ['GET /health', 'GET /ready']);
  assert.equal(facts.closed, true);
});

for (const decoder of ['legacy-access', 'legacy-entitlement', 'permissive-access', 'permissive-entitlement',
  'discarded-access', 'discarded-entitlement', 'missing-access', 'missing-entitlement', 'missing-bootstrap', 'bootstrap-mismatch',
  'legacy-view', 'wrong-view-context']) {
  test(`rollback protocol admission rejects ${decoder} in the actual child`, async t => {
    const { options, observed } = rollbackServerFixture(t, { decoder });
    const result = await probeRollbackRuntime(options);
    assert.equal(result.status, 'FAIL');
    assert.equal(result.code, 'ROLLBACK_PROTOCOL_INCOMPATIBLE');
    if (existsSync(observed)) {
      const facts = JSON.parse(readFileSync(observed, 'utf8'));
      assert.deepEqual(facts.requests, ['GET /health', 'GET /ready']);
      assert.equal(facts.closed, true);
      assert.equal(existsSync(facts.objectStore), false);
    }
  });
}

for (const [label, modify] of [
  ['health-only v3', row => { row.scope = 'rollback-api-server-readonly-health-ready'; delete row.protocolCapabilities; delete row.queryMode; }],
  ['missing capabilities', row => { delete row.protocolCapabilities; }],
  ['missing SOP decoder', row => { delete row.protocolCapabilities.accessDecisionSopSource; }],
  ['missing view negotiation', row => { delete row.protocolCapabilities.intakeContractViewNegotiated; }],
  ['unknown domain accepted', row => { row.protocolCapabilities.intakeEntitlementUnknownDomainRejected = false; }],
  ['wrong view', row => { row.protocolCapabilities.intakeEntitlementView = 'legacy'; }],
  ['missing query mode', row => { delete row.queryMode; }],
  ['wrong query mode', row => { row.queryMode = 'intake-compat'; }],
]) {
  test(`rollback protocol receipt rejects ${label} before release mutation`, async t => {
    const f = fixture(t);
    const proof = structuredClone((await f.produce()).deploymentChecks);
    modify(proof.rollback[0].runtime);
    f.setEvidence(proof);
    f.state.count = 81;
    await assert.rejects(() => runProductionRelease(f.options, f.deps), { code: 'ROLLBACK_PROTOCOL_INCOMPATIBLE' });
    assert.equal(f.state.journal, null);
    assert.equal(f.state.current, f.previous);
    assert.deepEqual(f.state.env, f.state.originalEnv);
  });
}

for (const [label, receipt] of [
  ['health-only', { status: 'PASS', code: null }],
  ['missing capabilities', { status: 'PASS', code: null, queryMode: 'unified' }],
  ['tampered capability', { status: 'PASS', code: null, queryMode: 'unified',
    protocolCapabilities: { ...protocolCapabilities, accessDecisionSopSource: false } }],
  ['mismatched mode', { status: 'PASS', code: null, queryMode: 'intake-compat', protocolCapabilities }],
]) {
  test(`rollback protocol admission rejects a ${label} child receipt`, async t => {
    const { options } = rollbackServerFixture(t);
    const result = await probeRollbackRuntime(options, () => ({ status: 0, output: [null, null, null, JSON.stringify(receipt)] }));
    assert.equal(result.status, 'FAIL');
    assert.equal(result.code, 'ROLLBACK_PROTOCOL_INCOMPATIBLE');
  });
}

test('rollback protocol admission cannot substitute intake-compat for the selected unified profile', async t => {
  const { options, observed } = rollbackServerFixture(t);
  options.environment.CUSTOMER_AGENT_QUERY_MODE = 'intake-compat';
  const result = await probeRollbackRuntime(options);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.code, 'ROLLBACK_PROTOCOL_INCOMPATIBLE');
  assert.equal(existsSync(observed), false);
});

test('rollback protocol receipt from the actual child is consumed by release admission', async t => {
  const f = fixture(t);
  const proof = structuredClone((await f.produce()).deploymentChecks);
  const { options } = rollbackServerFixture(t);
  const result = await probeRollbackRuntime(options);
  assert.equal(result.status, 'PASS');
  proof.rollback.find(row => row.migrationCount === result.migrationCount).runtime = result;
  f.setEvidence(proof);
  f.state.count = 81;
  assert.equal((await runProductionRelease(f.options, f.deps)).status, 'applied');
});

for (const migrationCount of [7, 9]) {
  test(`rollback application with a complete catalogue7 accepts actual prefix${migrationCount}`, async t => {
    const { options } = rollbackServerFixture(t, { manifestCount: 7, migrationCount });
    const result = await probeRollbackRuntime(options);
    assert.equal(result.status, 'PASS');
    assert.equal(result.code, null);
    assert.equal(result.migrationCount, migrationCount);
  });
}

for (const [manifestCount, migrationCount] of [[8, 7], [88, 81]]) {
  test(`rollback application catalogue${manifestCount} rejects incomplete actual prefix${migrationCount} before child startup`, async t => {
    const { options, observed } = rollbackServerFixture(t, { manifestCount, migrationCount });
    let childInvoked = false;
    const result = await probeRollbackRuntime(options, () => { childInvoked = true; throw new Error('unexpected child'); });
    assert.equal(result.status, 'FAIL');
    assert.equal(result.code, 'ROLLBACK_MIGRATION_INCOMPATIBLE');
    assert.equal(childInvoked, false);
    assert.equal(existsSync(observed), false);
  });
}

test('rollback application requires its own nonempty migration manifest', async t => {
  const { options } = rollbackServerFixture(t);
  delete options.release.manifest;
  assert.equal((await probeRollbackRuntime(options)).code, 'ROLLBACK_API_PROBE_INVALID');
  options.release.manifest = { migrations: [] };
  assert.equal((await probeRollbackRuntime(options)).code, 'ROLLBACK_API_PROBE_INVALID');
});

for (const [label, modify, code] of [
  ['old application reader attribution', proof => { proof.rollback[0].database.readerGitSha = proof.rollbackGitSha; }, 'ROLLBACK_INCOMPATIBLE'],
  ['ordinary query scope', proof => { proof.rollback[0].runtime.scope = 'candidate-query-runtime-readonly-initialization'; }, 'ROLLBACK_INCOMPATIBLE'],
  ['missing application proof', proof => { delete proof.rollback[0].runtime; }, 'ROLLBACK_PROTOCOL_INCOMPATIBLE'],
  ['application identity', proof => { proof.rollback[0].runtime.applicationGitSha = proof.candidateGitSha; }, 'ROLLBACK_INCOMPATIBLE'],
  ['cleanup failed', proof => { proof.rollback[0].runtime.status = 'FAIL'; proof.rollback[0].runtime.code = 'ROLLBACK_API_CLEANUP_FAILED'; }, 'ROLLBACK_INCOMPATIBLE'],
  ['candidate raw config', proof => { proof.candidateApiEnvSha256 = digest('0'); }, 'RELEASE_QUERY_PROFILE_CHANGED'],
]) {
  test(`v3 rejects ${label} before migration`, async t => {
    const f = fixture(t);
    const proof = structuredClone((await f.produce()).deploymentChecks);
    modify(proof);
    f.setEvidence(proof);
    f.state.count = 81;
    await assert.rejects(() => runProductionRelease(f.options, f.deps), { code });
    assert.equal(f.state.journal, null);
  });
}


for (const dimensions of [{ sourceCount: 81, rollbackCount: 80 }, { sourceCount: 84, rollbackCount: 81 }]) {
  test(`actual source${dimensions.sourceCount} and rollback catalogue${dimensions.rollbackCount} retain distinct ownership`, async t => {
    const f = fixture(t, dimensions);
    const { deploymentChecks: proof } = await f.produce();
    assert.equal(proof.sourceMigrationCount, dimensions.sourceCount);
    assert.equal(proof.targetMigrationCount, 88);
    f.setEvidence(proof);
    f.state.count = dimensions.sourceCount;
    assert.equal((await runProductionRelease(f.options, f.deps)).status, 'applied');
    assert.equal(f.state.count, 88);
  });
}


test('v3 without candidate-api-env keeps the existing version-only update while binding the source bytes', async t => {
  const f = fixture(t);
  delete f.options.candidateApiEnv;
  delete f.queryProfile.apiEnvSha256;
  f.queryProfile.mode = 'unified';
  f.runtime.queryMode = 'unified';
  f.runtime.scope = 'candidate-query-runtime-readonly-initialization';
  f.state.candidateEnv = Buffer.from(f.state.originalEnv.toString('utf8').replace('0.3.1', '0.3.2'));
  f.deps.writeApiVersion = async version => {
    assert.equal(version, f.next.version);
    f.state.env = f.state.candidateEnv;
    f.state.version = version;
    f.state.installedProfile = f.queryProfile;
  };
  f.deps.installCandidateApiEnv = async () => { throw new Error('no candidate env selected'); };
  f.setEvidence((await f.produce()).deploymentChecks);
  f.state.count = 81;
  assert.equal((await runProductionRelease(f.options, f.deps)).status, 'applied');
  assert.equal((await runProductionRelease(f.options, f.deps)).status, 'already-complete');
});

test('controller startup failure leaves current, environment and journal untouched', async t => {
  const f = fixture(t);
  f.setEvidence((await f.produce()).deploymentChecks);
  f.state.count = 81;
  f.deps.readServiceStartup = async () => { throw Object.assign(new Error('controller missing'), { code: 'SERVICE_STARTUP_INVALID' }); };
  await assert.rejects(() => runProductionRelease(f.options, f.deps), { code: 'SERVICE_STARTUP_INVALID' });
  assert.equal(f.state.journal, null);
  assert.equal(f.state.current, f.previous);
  assert.deepEqual(f.state.env, f.state.originalEnv);
});

for (const activeState of ['failed', 'inactive']) {
  test(`startup declaration remains verifiable for ${activeState} service with MainPID0`, () => {
    const f = serviceFixture();
    const original = f.inspect();
    f.properties.ActiveState = activeState;
    f.properties.MainPID = '0';
    f.files.delete('/proc/123/cmdline');
    f.files.delete('/proc/123/environ');
    assert.deepEqual(readServiceStartup(f.expected, f.execute, f.read, { declarationOnly: true }), original);
    assert.throws(f.inspect, { code: 'SERVICE_STARTUP_INVALID' });
    f.properties.Environment += ' PRIVATE=changed';
    assert.throws(() => assertControllerBinding(original,
      readServiceStartup(f.expected, f.execute, f.read, { declarationOnly: true })), { code: 'SERVICE_STARTUP_CHANGED' });
  });
}

test('publisher-managed api.env has a stable controller marker while other files retain byte bindings', () => {
  const f = serviceFixture();
  const managed = path.join(f.expected.stackRoot, 'api.env');
  f.properties.EnvironmentFiles = `${managed} (ignore_errors=no) /synthetic/other.env (ignore_errors=no)`;
  f.files.set(managed, Buffer.from('CUSTOMER_AGENT_BUILD_VERSION=0.3.1\n'));
  f.files.set('/synthetic/other.env', Buffer.from('PRIVATE=original\n'));
  const original = f.inspect();
  f.files.set(managed, Buffer.from('CUSTOMER_AGENT_BUILD_VERSION=0.3.2\nPRIVATE=changed\n'));
  assert.deepEqual(f.inspect(), original);
  f.files.delete(managed);
  assert.deepEqual(f.inspect(), original);
  f.files.set('/synthetic/other.env', Buffer.from('PRIVATE=changed\n'));
  assert.throws(() => assertControllerBinding(original, f.inspect()), { code: 'SERVICE_STARTUP_CHANGED' });
  f.files.set('/proc/123/environ', Buffer.from('CUSTOMER_AGENT_STACK_ROOT=/other/root\0'));
  assert.throws(f.inspect, { code: 'SERVICE_STARTUP_INVALID' });
});


test('declaration observation keeps source, runtime pointer and static root binding when the service is stopped', () => {
  const f = serviceFixture();
  const binding = f.inspect();
  f.properties.ActiveState = 'inactive';
  f.properties.MainPID = '0';
  const inspectDeclaration = () => readServiceStartup(f.expected, f.execute, f.read, { declarationOnly: true });
  f.properties.Environment = 'CUSTOMER_AGENT_STACK_ROOT=/other/root';
  assert.throws(() => assertControllerBinding(binding, inspectDeclaration()), { code: 'SERVICE_STARTUP_CHANGED' });
  f.properties.ExecStart = f.properties.ExecStart.replace(f.expected.runtimeRelease, '/other/current');
  assert.throws(inspectDeclaration, { code: 'SERVICE_STARTUP_INVALID' });
});

test('only the exact publisher api.env path gets the managed marker', () => {
  const f = serviceFixture();
  f.properties.EnvironmentFiles = '/synthetic/other/api.env (ignore_errors=no)';
  f.files.set('/synthetic/other/api.env', Buffer.from('VALUE=original\n'));
  const binding = f.inspect();
  f.files.set('/synthetic/other/api.env', Buffer.from('VALUE=changed\n'));
  assert.throws(() => assertControllerBinding(binding, f.inspect()), { code: 'SERVICE_STARTUP_CHANGED' });
});

test('rollback proof consumer enforces the application minimum complete catalogue despite a forged PASS receipt', async t => {
  const f = fixture(t, { sourceCount: 81, rollbackCount: 88 });
  const proof = (await f.produce()).deploymentChecks;
  f.setEvidence(proof);
  f.state.count = 81;
  await assert.rejects(() => runProductionRelease(f.options, f.deps), { code: 'ROLLBACK_MIGRATION_INCOMPATIBLE' });
  assert.equal(f.state.journal, null);
  assert.equal(f.state.current, f.previous);
  assert.deepEqual(f.state.env, f.state.originalEnv);
});
