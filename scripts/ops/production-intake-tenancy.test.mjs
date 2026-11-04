import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  evaluateSnapshot,
  normalizeSnapshot,
  parseOptions,
  readStackProfile,
} from './production-intake-tenancy.mjs';
import { PG_PORT, stackPortPairForRoot } from '../synthetic-stack/profile.ts';

function snapshot(overrides = {}) {
  return {
    batches: [],
    historical: { default_count: 0 },
    currentRelease: {
      present: true,
      tenant_default: false,
      source_count: 4,
      source_mismatch_count: 0,
    },
    ...overrides,
  };
}

test('accepts clean active imports and ignores completed historical defaults', () => {
  const report = evaluateSnapshot(snapshot({
    batches: [{
      status: 'staged',
      tenant_kind: 'explicit',
      actor_state: 'bound',
      base_state: 'current',
      base_tenant_state: 'bound',
      row_count: 1,
      source_count: 4,
      source_mismatch_count: 0,
    }],
    historical: { default_count: 2 },
  }));
  assert.equal(report.ok, true);
  assert.equal(report.status, 'ready');
  assert.equal(report.historicalDefaultBatchCount, 2);
});

test('blocks active default, missing actor, and tenant mismatch groups', () => {
  const report = evaluateSnapshot(snapshot({
    batches: [
      {
        status: 'validating',
        tenant_kind: 'default',
        actor_state: 'missing',
        base_state: 'current',
        base_tenant_state: 'bound',
        row_count: 2,
        source_count: 0,
        source_mismatch_count: 0,
      },
      {
        status: 'staged',
        tenant_kind: 'explicit',
        actor_state: 'mismatch',
        base_state: 'current',
        base_tenant_state: 'bound',
        row_count: 1,
        source_count: 4,
        source_mismatch_count: 1,
      },
    ],
  }));
  assert.equal(report.ok, false);
  assert.deepEqual(report.blockers, [
    'ACTIVE_IMPORT_BATCH_DEFAULT_TENANT',
    'ACTIVE_IMPORT_BATCH_PRINCIPAL_MISSING',
    'ACTIVE_IMPORT_BATCH_SOURCE_MISSING',
    'ACTIVE_IMPORT_BATCH_SOURCE_TENANT_MISMATCH',
    'ACTIVE_IMPORT_BATCH_TENANT_MISMATCH',
  ]);
});

test('blocks an invalid current release tenant or source set', () => {
  const report = evaluateSnapshot(snapshot({
    currentRelease: {
      present: true,
      tenant_default: true,
      source_count: 3,
      source_mismatch_count: 2,
    },
  }));
  assert.deepEqual(report.blockers, [
    'CURRENT_RELEASE_DEFAULT_TENANT',
    'CURRENT_RELEASE_SOURCE_SET_INVALID',
    'CURRENT_RELEASE_SOURCE_TENANT_MISMATCH',
  ]);
});

test('blocks an active batch with an incomplete source set', () => {
  const report = evaluateSnapshot(snapshot({
    batches: [{
      status: 'staged',
      tenant_kind: 'explicit',
      actor_state: 'bound',
      base_state: 'current',
      base_tenant_state: 'bound',
      row_count: 1,
      source_count: 3,
      source_mismatch_count: 0,
    }],
  }));
  assert.deepEqual(report.blockers, ['ACTIVE_IMPORT_BATCH_SOURCE_SET_INVALID']);
});

test('blocks an active batch whose base release is stale or missing', () => {
  const report = evaluateSnapshot(snapshot({
    batches: [
      {
        status: 'staged',
        tenant_kind: 'explicit',
        actor_state: 'bound',
        base_state: 'stale',
        base_tenant_state: 'bound',
        row_count: 1,
        source_count: 4,
        source_mismatch_count: 0,
      },
      {
        status: 'validating',
        tenant_kind: 'explicit',
        actor_state: 'bound',
        base_state: 'missing',
        base_tenant_state: 'missing',
        row_count: 1,
        source_count: 4,
        source_mismatch_count: 0,
      },
    ],
  }));
  assert.deepEqual(report.blockers, ['ACTIVE_IMPORT_BATCH_BASE_RELEASE_STALE']);
  assert.equal(report.activeBatchCount, 2);
});

test('blocks an active batch whose base release belongs to another tenant', () => {
  const report = evaluateSnapshot(snapshot({
    batches: [{
      status: 'staged',
      tenant_kind: 'explicit',
      actor_state: 'bound',
      base_state: 'current',
      base_tenant_state: 'mismatch',
      row_count: 1,
      source_count: 4,
      source_mismatch_count: 0,
    }],
  }));
  assert.deepEqual(report.blockers, ['ACTIVE_IMPORT_BATCH_BASE_RELEASE_TENANT_MISMATCH']);
});

test('blocks a missing current release and rejects malformed counts', () => {
  assert.deepEqual(evaluateSnapshot(snapshot({
    currentRelease: {
      present: false,
      tenant_default: false,
      source_count: 0,
      source_mismatch_count: 0,
    },
  })).blockers, ['CURRENT_RELEASE_MISSING']);
  assert.throws(() => normalizeSnapshot({
    batches: [{ status: 'staged', tenant_kind: 'explicit', actor_state: 'bound' }],
    historical: {},
    currentRelease: {},
  }), /SNAPSHOT_INVALID/u);
  assert.throws(() => normalizeSnapshot(snapshot({
    batches: [{
      status: 'unknown',
      tenant_kind: 'explicit',
      actor_state: 'bound',
      base_state: 'current',
      base_tenant_state: 'bound',
      row_count: 1,
      source_count: 4,
      source_mismatch_count: 0,
    }],
  })), /SNAPSHOT_INVALID/u);
  assert.throws(() => normalizeSnapshot(snapshot({
    currentRelease: {
      present: true,
      tenant_default: 'false',
      source_count: 4,
      source_mismatch_count: 0,
    },
  })), /SNAPSHOT_INVALID/u);
});

test('reads only a confined production stack profile', () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'customer-agent-tenancy-profile-')));
  try {
    const socket = path.join(root, 'data', 'pg15-socket');
    mkdirSync(socket, { recursive: true });
    const ports = stackPortPairForRoot(root);
    writeFileSync(path.join(root, 'profile.json'), JSON.stringify({
      version: 1,
      environment: 'synthetic-local',
      createdAt: '2026-11-05T00:00:00.000Z',
      stackRoot: root,
      apiOrigin: `http://127.0.0.1:${ports.api}`,
      identityOrigin: `http://127.0.0.1:${ports.identity}`,
      apiPort: ports.api,
      identityPort: ports.identity,
      databaseName: 'customer_agent_intake_test',
      pgSocketDirectory: socket,
      pgPort: PG_PORT,
      objectStoreDirectory: path.join(root, 'objects'),
      clientId: 'test-client',
    }));
    assert.deepEqual(readStackProfile(root), {
      stackRoot: root,
      databaseName: 'customer_agent_intake_test',
      pgSocketDirectory: socket,
      pgPort: PG_PORT,
    });
    writeFileSync(path.join(root, 'profile.json'), JSON.stringify({
      version: 1,
      environment: 'synthetic-local',
      createdAt: '2026-11-05T00:00:00.000Z',
      stackRoot: root,
      apiOrigin: `http://127.0.0.1:${ports.api}`,
      identityOrigin: `http://127.0.0.1:${ports.identity}`,
      apiPort: ports.api,
      identityPort: ports.identity,
      databaseName: 'customer_agent_formal',
      pgSocketDirectory: '/tmp/outside-socket',
      pgPort: PG_PORT,
      objectStoreDirectory: path.join(root, 'objects'),
      clientId: 'test-client',
    }));
    assert.throws(() => readStackProfile(root), /PROFILE_INVALID/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('parses only an absolute stack root', () => {
  assert.equal(parseOptions([]).stackRoot, '/srv/customer-agent/stack');
  assert.equal(parseOptions(['--stack-root', '/tmp/stack']).stackRoot, '/tmp/stack');
  assert.equal(parseOptions(['--stack-root', 'relative']).ok, false);
  assert.equal(parseOptions(['--unknown']).ok, false);
});

test('runs when invoked through the current release symlink', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'customer-agent-tenancy-entry-'));
  try {
    const current = path.join(root, 'current');
    symlinkSync(path.resolve('scripts/ops/production-intake-tenancy.mjs'), current);
    const result = spawnSync(process.execPath, [current, '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: node scripts\/ops\/production-intake-tenancy\.mjs/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
