import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acquireDeploymentLock,
  assertApplyPrivilege,
  assertMigrationCompletion,
  parseOptions,
  ProductionReleaseError,
  readinessMatches,
  runProductionRelease,
} from './customer-agent-production-release.mjs';

const OLD = 'a'.repeat(40);
const NEXT = 'b'.repeat(40);
const OLD_VERSION = '0.3.42';
const NEXT_VERSION = '0.3.43';

function migration(position, marker = position) {
  return Object.freeze({
    position,
    id: `${String(position).padStart(4, '0')}_migration_${marker}`,
    sha256: String(marker).repeat(64).slice(0, 64),
    contractSetId: `contract-${marker}`,
    sourceGitSha: 'c'.repeat(40),
    sourceSchemaSha256: 'd'.repeat(64),
  });
}

function fixture({ apply = true, inspectIds } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-production-release-'));
  const oldManifest = Object.freeze([migration(1)]);
  const nextManifest = Object.freeze([...oldManifest, migration(2)]);
  const current = Object.freeze({
    root: path.join(root, 'releases', OLD),
    sha: OLD,
    version: OLD_VERSION,
    targetText: path.join(root, 'releases', OLD),
    manifest: oldManifest,
  });
  const next = Object.freeze({
    root: path.join(root, 'releases', NEXT),
    sha: NEXT,
    version: NEXT_VERSION,
    manifest: nextManifest,
  });
  const events = [];
  const audit = [];
  let lockReleased = false;
  let lockAcquired = false;
  let currentValue = current;
  let apiVersion = OLD_VERSION;
  let deploymentState = null;
  let databaseIds = inspectIds ?? oldManifest.map((item) => item.id);
  const dependencies = {
    lock: async () => {
      lockAcquired = true;
      return () => { lockReleased = true; };
    },
    readCurrent: async () => currentValue,
    readNext: async () => next,
    readState: async () => deploymentState,
    writeState: async (state) => { deploymentState = state; },
    readHistoricalRelease: async () => current,
    readEvidence: async () => Object.freeze({
      path: '/evidence/restore.json',
      backupId: 'backup-001',
      snapshotAt: '2026-11-05T00:00:00Z',
      restoredAt: '2026-11-05T00:01:00Z',
      migrationCount: 2,
    }),
    readTenantReport: async () => Object.freeze({
      path: '/evidence/tenant.json',
      schema: 'customer-agent-production-intake-tenancy/v1',
      ok: true,
      status: 'ready',
      blockers: [],
      activeBatchCount: 0,
      historicalDefaultBatchCount: 0,
    }),
    readProfile: async () => Object.freeze({
      root,
      databaseName: 'customer_agent_formal',
      socket: '/socket',
      port: 43199,
      apiOrigin: 'http://127.0.0.1:43115',
    }),
    inspectTenancy: async () => Object.freeze({
      schema: 'customer-agent-production-intake-tenancy/v1',
      ok: true,
      status: 'ready',
      blockers: [],
      activeBatchCount: 0,
      historicalDefaultBatchCount: 0,
    }),
    inspectDatabase: async () => databaseIds,
    applyDatabase: async () => {
      events.push('migrate');
      databaseIds = nextManifest.map((item) => item.id);
      return Object.freeze({
        appliedIds: [nextManifest[1].id],
        finalIds: databaseIds,
        verifierStatus: 'PASS',
      });
    },
    readApiVersion: async () => Object.freeze({ version: apiVersion }),
    backupApiVersion: async () => {
      events.push('backup-api-version');
      return Object.freeze({
        file: '/stack/api.env',
        backup: '/evidence/api.env.backup',
        sha256: 'a'.repeat(64),
        version: apiVersion,
      });
    },
    readApiVersionBackup: async () => Object.freeze({
      file: '/stack/api.env',
      backup: '/evidence/api.env.backup',
      bytes: Buffer.from('backup'),
      version: OLD_VERSION,
    }),
    writeApiVersion: async (version) => {
      events.push('api-version');
      apiVersion = version;
      return Object.freeze({ file: '/stack/api.env', version, changed: true });
    },
    restoreApiVersion: async () => {
      events.push('restore-api-version');
      apiVersion = OLD_VERSION;
    },
    switchCurrent: async () => {
      events.push('switch');
      currentValue = next;
    },
    restoreCurrent: async () => {
      events.push('restore-current');
      currentValue = current;
    },
    restartService: async () => { events.push('restart'); },
    waitForReady: async (_profile, version) => {
      events.push(`ready-${version}`);
    },
    audit: async (entry) => { audit.push(entry); },
  };
  const options = Object.freeze({
    help: false,
    apply,
    root,
    stackRoot: path.join(root, 'stack'),
    sha: NEXT,
    expectedVersion: NEXT_VERSION,
    backupEvidence: '/evidence/restore.json',
    tenantReport: '/evidence/tenant.json',
    unit: 'customer-agent-stack.service',
    environment: 'production',
    auditFile: path.join(root, 'release-evidence', 'audit.jsonl'),
  });
  return {
    root,
    current,
    next,
    options,
    dependencies,
    events,
    audit,
    isLockReleased: () => lockReleased,
    isLockAcquired: () => lockAcquired,
    get currentValue() { return currentValue; },
    setCurrent: (value) => { currentValue = value; },
    get apiVersion() { return apiVersion; },
    get deploymentState() { return deploymentState; },
  };
}

test('dry-run validates the plan without mutating services or environment', async () => {
  const value = fixture({ apply: false });
  try {
    const result = await runProductionRelease(value.options, value.dependencies);
    assert.equal(result.status, 'dry-run');
    assert.deepEqual(result.pendingMigrationIds, [value.next.manifest[1].id]);
    assert.deepEqual(value.events, [`ready-${OLD_VERSION}`]);
    assert.equal(value.isLockAcquired(), false);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('production apply requires authorization equal to the full candidate SHA', () => {
  const base = [
    '--sha', NEXT,
    '--expected-version', NEXT_VERSION,
    '--backup-evidence', '/evidence/restore.json',
    '--tenant-report', '/evidence/tenant.json',
    '--apply',
  ];
  assert.throws(
    () => parseOptions(base),
    (error) => error instanceof Error && 'code' in error && error.code === 'RELEASE_NOT_AUTHORIZED',
  );
  assert.equal(parseOptions([...base, '--authorization', NEXT]).apply, true);
  assert.throws(
    () => parseOptions([
      '--environment', 'test',
      '--root', '/srv/customer-agent',
      '--stack-root', '/tmp/test-stack',
      ...base,
    ]),
    (error) => error instanceof Error && 'code' in error && error.code === 'INVALID_ARGUMENTS',
  );
  assert.throws(
    () => parseOptions([...base, '--authorization', NEXT, '--stack-root', '/tmp/other-stack']),
    (error) => error instanceof Error && 'code' in error && error.code === 'INVALID_ARGUMENTS',
  );
  assert.throws(
    () => parseOptions([...base, '--authorization', NEXT, '--unit', 'other.service']),
    (error) => error instanceof Error && 'code' in error && error.code === 'INVALID_ARGUMENTS',
  );
});

test('production apply requires root before any writer is initialized', () => {
  assert.doesNotThrow(() => assertApplyPrivilege(false, () => 1000));
  assert.throws(
    () => assertApplyPrivilege(true, () => 1000),
    (error) => error instanceof Error && 'code' in error && error.code === 'DEPLOYMENT_PRIVILEGE_REQUIRED',
  );
  assert.throws(
    () => assertApplyPrivilege(true, () => undefined),
    (error) => error instanceof Error && 'code' in error && error.code === 'DEPLOYMENT_PRIVILEGE_REQUIRED',
  );
  assert.doesNotThrow(() => assertApplyPrivilege(true, () => 0));
});

test('apply migrates before switching, updating the version and proving readiness', async () => {
  const value = fixture();
  try {
    const result = await runProductionRelease(value.options, value.dependencies);
    assert.equal(result.status, 'applied');
    assert.deepEqual(value.events, [
      `ready-${OLD_VERSION}`,
      'migrate',
      'backup-api-version',
      'api-version',
      'switch',
      'restart',
      `ready-${NEXT_VERSION}`,
    ]);
    assert.deepEqual(result.appliedMigrationIds, [value.next.manifest[1].id]);
    assert.equal(value.deploymentState.status, 'complete');
    assert.equal(value.deploymentState.previousSha, OLD);
    assert.equal(value.deploymentState.apiEnvBackup.version, OLD_VERSION);
    assert.equal(value.isLockReleased(), true);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('migration failure leaves the pointer and service untouched', async () => {
  const value = fixture();
  value.dependencies.applyDatabase = async () => {
    throw new ProductionReleaseError('DATABASE_MIGRATION_APPLY_INVALID', 'migration failed');
  };
  try {
    await assert.rejects(
      () => runProductionRelease(value.options, value.dependencies),
      (error) => error?.code === 'DATABASE_MIGRATION_APPLY_INVALID',
    );
    assert.deepEqual(value.events, [`ready-${OLD_VERSION}`]);
    assert.equal(value.isLockReleased(), true);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('readiness failure restores the previous pointer, environment and service', async () => {
  const value = fixture();
  value.dependencies.waitForReady = async (_profile, version) => {
    value.events.push(`ready-${version}`);
    if (version === NEXT_VERSION) {
      throw new ProductionReleaseError('READINESS_FAILED', 'new service did not become ready');
    }
  };
  try {
    await assert.rejects(
      () => runProductionRelease(value.options, value.dependencies),
      (error) => error?.code === 'READINESS_FAILED',
    );
    assert.deepEqual(value.events, [
      `ready-${OLD_VERSION}`,
      'migrate',
      'backup-api-version',
      'api-version',
      'switch',
      'restart',
      `ready-${NEXT_VERSION}`,
      'restore-current',
      'restore-api-version',
      'restart',
      `ready-${OLD_VERSION}`,
    ]);
    assert.ok(value.audit.some((entry) => entry.event === 'rollback-ready'));
    assert.equal(value.isLockReleased(), true);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('symlink failure restores api.env without restarting the old service', async () => {
  const value = fixture();
  value.dependencies.switchCurrent = async () => {
    value.events.push('switch-failed');
    throw new ProductionReleaseError('SYMLINK_SWITCH_FAILED', 'symlink switch failed');
  };
  try {
    await assert.rejects(
      () => runProductionRelease(value.options, value.dependencies),
      (error) => error?.code === 'SYMLINK_SWITCH_FAILED',
    );
    assert.deepEqual(value.events, [
      `ready-${OLD_VERSION}`,
      'migrate',
      'backup-api-version',
      'api-version',
      'switch-failed',
      'restore-current',
      'restore-api-version',
    ]);
    assert.equal(value.isLockReleased(), true);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('restart failure rolls back the pointer and recovers the previous service', async () => {
  const value = fixture();
  let restarts = 0;
  value.dependencies.restartService = async () => {
    restarts += 1;
    value.events.push(`restart-${restarts}`);
    if (restarts === 1) {
      throw new ProductionReleaseError('SERVICE_RESTART_FAILED', 'new service restart failed');
    }
  };
  try {
    await assert.rejects(
      () => runProductionRelease(value.options, value.dependencies),
      (error) => error?.code === 'SERVICE_RESTART_FAILED',
    );
    assert.deepEqual(value.events, [
      `ready-${OLD_VERSION}`,
      'migrate',
      'backup-api-version',
      'api-version',
      'switch',
      'restart-1',
      'restore-current',
      'restore-api-version',
      'restart-2',
      `ready-${OLD_VERSION}`,
    ]);
    assert.equal(value.isLockReleased(), true);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('rollback readiness failure returns ROLLBACK_FAILED and preserves evidence', async () => {
  const value = fixture();
  let oldReadyCalls = 0;
  value.dependencies.waitForReady = async (_profile, version) => {
    value.events.push(`ready-${version}`);
    if (version === NEXT_VERSION || (version === OLD_VERSION && ++oldReadyCalls === 2)) {
      throw new ProductionReleaseError('READINESS_FAILED', `version ${version} not ready`);
    }
  };
  try {
    await assert.rejects(
      () => runProductionRelease(value.options, value.dependencies),
      (error) => error?.code === 'ROLLBACK_FAILED',
    );
    assert.ok(value.audit.some((entry) => entry.event === 'rollback-failed'));
    assert.equal(value.isLockReleased(), true);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('SIGINT after switch triggers rollback before the lock is released', async () => {
  const value = fixture();
  value.dependencies.switchCurrent = async () => {
    value.events.push('switch');
    process.kill(process.pid, 'SIGINT');
    await new Promise((resolve) => setImmediate(resolve));
  };
  try {
    await assert.rejects(
      () => runProductionRelease(value.options, value.dependencies),
      (error) => error?.code === 'INTERRUPTED',
    );
    assert.deepEqual(value.events, [
      `ready-${OLD_VERSION}`,
      'migrate',
      'backup-api-version',
      'api-version',
      'switch',
      'restore-current',
      'restore-api-version',
    ]);
    assert.equal(value.isLockReleased(), true);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('SIGINT during candidate readiness still waits for rollback readiness', async () => {
  const value = fixture();
  value.dependencies.waitForReady = async (_profile, version, assertActive) => {
    value.events.push(`ready-${version}`);
    if (version === NEXT_VERSION) {
      process.kill(process.pid, 'SIGINT');
      await new Promise((resolve) => setImmediate(resolve));
      assertActive();
    }
  };
  try {
    await assert.rejects(
      () => runProductionRelease(value.options, value.dependencies),
      (error) => error?.code === 'INTERRUPTED',
    );
    assert.deepEqual(value.events, [
      `ready-${OLD_VERSION}`,
      'migrate',
      'backup-api-version',
      'api-version',
      'switch',
      'restart',
      `ready-${NEXT_VERSION}`,
      'restore-current',
      'restore-api-version',
      'restart',
      `ready-${OLD_VERSION}`,
    ]);
    assert.equal(value.deploymentState.status, 'rolled_back');
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('already-current retry verifies DB/version and is idempotent without another pointer switch', async () => {
  const value = fixture();
  try {
    const first = await runProductionRelease(value.options, value.dependencies);
    assert.equal(first.status, 'applied');
    value.events.length = 0;
    const result = await runProductionRelease(value.options, value.dependencies);
    assert.equal(result.status, 'already-complete');
    assert.deepEqual(value.events, [`ready-${NEXT_VERSION}`]);
    assert.equal(value.isLockReleased(), true);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('a failed preflight does not roll back an already-complete deployment', async () => {
  const value = fixture();
  try {
    await runProductionRelease(value.options, value.dependencies);
    const completed = value.deploymentState;
    value.events.length = 0;
    value.dependencies.inspectTenancy = async () => Object.freeze({
      schema: 'customer-agent-production-intake-tenancy/v1',
      ok: false,
      status: 'blocked',
      blockers: ['ACTIVE_IMPORT_BATCH_DEFAULT_TENANT'],
      activeBatchCount: 1,
      historicalDefaultBatchCount: 0,
    });
    await assert.rejects(
      () => runProductionRelease(value.options, value.dependencies),
      (error) => error?.code === 'TENANT_REPORT_STALE',
    );
    assert.equal(value.currentValue.sha, NEXT);
    assert.equal(value.apiVersion, NEXT_VERSION);
    assert.equal(value.deploymentState.status, completed.status);
    assert.deepEqual(value.events, []);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('database state must match the current or candidate migration catalogue', async () => {
  const value = fixture({ apply: false, inspectIds: ['unknown-migration'] });
  try {
    await assert.rejects(
      () => runProductionRelease(value.options, value.dependencies),
      (error) => error?.code === 'DATABASE_PREFIX_MISMATCH',
    );
    assert.equal(value.isLockAcquired(), false);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('migration completion requires the candidate verifier and exact applied delta', () => {
  const previousIds = [migration(1).id];
  const nextIds = [migration(1).id, migration(2).id];
  assert.doesNotThrow(() => assertMigrationCompletion(previousIds, nextIds, {
    appliedIds: [nextIds[1]],
    finalIds: nextIds,
    verifierStatus: 'PASS',
  }));
  assert.throws(
    () => assertMigrationCompletion(previousIds, nextIds, {
      appliedIds: [nextIds[1]],
      finalIds: nextIds,
      verifierStatus: 'FAIL',
    }),
    (error) => error?.code === 'DATABASE_MIGRATION_APPLY_INVALID',
  );
  assert.throws(
    () => assertMigrationCompletion(previousIds, nextIds, {
      appliedIds: [],
      finalIds: nextIds,
      verifierStatus: 'PASS',
    }),
    (error) => error?.code === 'DATABASE_MIGRATION_APPLY_INVALID',
  );
});

test('live tenant evidence must match the current database snapshot', async () => {
  const value = fixture({ apply: false });
  value.dependencies.inspectTenancy = async () => Object.freeze({
    schema: 'customer-agent-production-intake-tenancy/v1',
    ok: false,
    status: 'blocked',
    blockers: ['ACTIVE_IMPORT_BATCH_DEFAULT_TENANT'],
    activeBatchCount: 1,
    historicalDefaultBatchCount: 0,
  });
  try {
    await assert.rejects(
      () => runProductionRelease(value.options, value.dependencies),
      (error) => error?.code === 'TENANT_REPORT_STALE',
    );
    assert.deepEqual(value.events, []);
    assert.equal(value.isLockAcquired(), false);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('readiness requires every published dependency check', () => {
  const health = { status: 'ok', service: 'cs-ai-api', version: NEXT_VERSION };
  const ready = {
    status: 'ready',
    checks: { auth: 'ok', content: 'ok', database: 'ok', schema: 'ok', storage: 'ok' },
  };
  assert.equal(readinessMatches(health, ready, NEXT_VERSION), true);
  ready.checks.database = 'not_ready';
  assert.equal(readinessMatches(health, ready, NEXT_VERSION), false);
  ready.checks.database = 'ok';
  ready.checks.unexpected = 'ok';
  assert.equal(readinessMatches(health, ready, NEXT_VERSION), false);
});

test('a persisted rollback journal restores the previous pointer after an interrupted rollback', async () => {
  const value = fixture();
  value.dependencies.waitForReady = async (_profile, version) => {
    value.events.push(`ready-${version}`);
    if (version === NEXT_VERSION) {
      throw new ProductionReleaseError('READINESS_FAILED', 'candidate did not become ready');
    }
  };
  value.dependencies.restoreCurrent = async () => {
    value.events.push('restore-current-failed');
    throw new ProductionReleaseError('ROLLBACK_POINTER_FAILED', 'interrupted rollback');
  };
  try {
    await assert.rejects(
      () => runProductionRelease(value.options, value.dependencies),
      (error) => error?.code === 'ROLLBACK_FAILED',
    );
    assert.equal(value.currentValue.sha, NEXT);
    assert.equal(value.apiVersion, NEXT_VERSION);
    assert.equal(value.deploymentState.status, 'rolling_back');

    value.events.length = 0;
    value.dependencies.restoreCurrent = async () => {
      value.events.push('restore-current');
      value.setCurrent(value.current);
    };
    const recovered = await runProductionRelease(value.options, value.dependencies);
    assert.equal(recovered.status, 'rolled-back');
    assert.equal(value.currentValue.sha, OLD);
    assert.equal(value.apiVersion, OLD_VERSION);
    assert.equal(value.deploymentState.status, 'rolled_back');
    assert.deepEqual(value.events, [
      'restore-current',
      'restore-api-version',
      'restart',
      `ready-${OLD_VERSION}`,
    ]);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('a persisted rollback journal cannot restore an arbitrary target', async () => {
  const value = fixture();
  let state = Object.freeze({
    schema: 'customer-agent-production-release-state/v1',
    status: 'rolling_back',
    candidateSha: NEXT,
    candidateVersion: NEXT_VERSION,
    previousSha: OLD,
    previousVersion: OLD_VERSION,
    previousTargetText: '/tmp/not-the-previous-release',
    backupId: 'backup-001',
    pointerSwitched: true,
    serviceStageReached: true,
    apiEnvBackup: null,
  });
  value.dependencies.readState = async () => state;
  value.dependencies.writeState = async (next) => { state = next; };
  try {
    await assert.rejects(
      () => runProductionRelease(value.options, value.dependencies),
      (error) => error?.code === 'DEPLOYMENT_STATE_INVALID',
    );
    assert.deepEqual(value.events, []);
    assert.equal(state.status, 'rolling_back');
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('deployment lock is exclusive and only the owner releases it', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-release-lock-'));
  const lock = path.join(root, 'deploy.lock');
  try {
    const release = acquireDeploymentLock(lock);
    assert.match(readFileSync(lock, 'utf8'), /"pid":/u);
    assert.throws(
      () => acquireDeploymentLock(lock),
      (error) => error instanceof Error && 'code' in error && error.code === 'DEPLOYMENT_LOCKED',
    );
    release();
    const second = acquireDeploymentLock(lock);
    writeFileSync(lock, '{"replacement":true}\n');
    second();
    assert.equal(readFileSync(lock, 'utf8'), '{"replacement":true}\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('deployment lock reclaims a stale same-host owner but not an unreadable lock', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-release-stale-lock-'));
  const lock = path.join(root, 'deploy.lock');
  try {
    writeFileSync(lock, `${JSON.stringify({ pid: 2_147_483_647, host: os.hostname(), token: 'stale' })}\n`);
    const release = acquireDeploymentLock(lock);
    assert.doesNotMatch(readFileSync(lock, 'utf8'), /"token":"stale"/u);
    release();
    writeFileSync(lock, 'not-json\n');
    assert.throws(
      () => acquireDeploymentLock(lock),
      (error) => error instanceof Error && 'code' in error && error.code === 'DEPLOYMENT_LOCKED',
    );
    writeFileSync(lock, `${JSON.stringify({ pid: 2_147_483_647, host: os.hostname(), token: 'stale' })}\n`);
    writeFileSync(`${lock}.recovery`, '{"pid":2147483647}\n');
    assert.throws(
      () => acquireDeploymentLock(lock),
      (error) => error instanceof Error && 'code' in error && error.code === 'DEPLOYMENT_LOCKED',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
