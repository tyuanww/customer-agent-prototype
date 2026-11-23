import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertNoActiveColdCutover, COLD_CUTOVER_STATE_ROOT, COLD_CUTOVER_UNITS, openHeldColdCutover } from './release-cold-cutover.mjs';
import { openColdSnapshot } from './release-cold-snapshot.mjs';

const LINUX = { skip: process.platform !== 'linux' };
const SHA = 'a'.repeat(40);
const STACK = 'customer-agent-stack.service';
const TUNNEL = 'customer-agent-tunnel.service';
const health = 'customer-agent-health-check.timer';
const watchers = 'customer-agent-stack-watchdog.service';

function fixture(t) {
  const root = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'customer-agent-held-cutover-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stateRoot = path.join(root, 'state');
  const stack = path.join(root, 'stack');
  const journal = path.join(root, 'snapshot');
  const pgBin = path.join(root, 'pg-bin');
  const unitRoot = path.join(root, 'units');
  for (const directory of [stateRoot, stack, journal, unitRoot]) mkdirSync(directory, { mode: 0o700 });
  mkdirSync(path.join(stack, 'data', 'pg15'), { recursive: true });
  writeFileSync(path.join(stack, 'data', 'pg15', 'PG_VERSION'), '15\n');
  const marker = path.join(stateRoot, 'maintenance');
  const dropIn = (unit) => path.join(unitRoot, unit + '.d', 'customer-agent-cold-maintenance.conf');
  for (const unit of COLD_CUTOVER_UNITS) {
    mkdirSync(path.dirname(dropIn(unit)), { mode: 0o755 });
    writeFileSync(dropIn(unit), `[Unit]\nConditionPathExists=!${marker}\n`, { mode: 0o644 });
  }
  const record = path.join(stateRoot, 'cutover.json');
  const statusFile = path.join(journal, 'cold-snapshot.json');
  const payload = path.join(stack, 'data', 'payload');
  writeFileSync(payload, 'original');
  const starts = [STACK, TUNNEL, health];
  const states = new Map(COLD_CUTOVER_UNITS.map((unit) => [unit, starts.includes(unit) ? 'active' : 'inactive']));
  const settings = { unguarded: '', transientGuard: false, pg: 'stopped', failStart: false, failStop: false };
  const controls = [];
  const execute = (program, args) => {
    if (program.endsWith('/busctl')) {
      if (args.includes('call')) return JSON.stringify({ data: [args.at(-1)] });
      return JSON.stringify({ data: args.at(-3) === settings.unguarded
        ? [] : [['ConditionPathExists', false, true, marker, 0]] });
    }
    if (program.endsWith('/systemctl')) {
      const unit = args.at(-1);
      assert.equal(args[0], 'show');
      const dropIns = settings.transientGuard ? `/run/systemd/${unit}.d/hold.conf` : dropIn(unit);
      return `Id=${unit}\nLoadState=loaded\nActiveState=${states.get(unit)}\nJob=\nKillMode=control-group\nDropInPaths=${dropIns}\n`;
    }
    if (program.endsWith('/python3')) {
      const [, , , , , action, ...units] = args;
      controls.push([action, ...units]);
      if (action === 'stop') {
        assert(existsSync(marker));
        if (settings.failStop) throw new Error('interrupted stop');
        for (const unit of units) states.set(unit, 'inactive');
      }
      if (action === 'start') {
        assert(!existsSync(marker));
        assert(existsSync(record));
        const snapshot = JSON.parse(readFileSync(statusFile, 'utf8'));
        assert(['sealed', 'rolled-back'].includes(snapshot.phase));
        if (settings.failStart && units.includes(TUNNEL)) throw new Error('interrupted start');
        for (const unit of units) states.set(unit, 'active');
      }
      return '';
    }
    if (program === path.join(pgBin, 'pg_ctl')) {
      if (settings.pg === 'running') return '';
      throw Object.assign(new Error('not running'), { status: 3 });
    }
    if (program === path.join(pgBin, 'pg_controldata')) {
      return 'Database cluster state:               ' + (settings.pg === 'stopped' ? 'shut down' : 'in production') + '\n';
    }
    assert.fail('unexpected command ' + program);
  };
  const open = (candidateSha = SHA) => openHeldColdCutover({ stack, journal, candidateSha, pgBin, stateRoot, unitRoot, execute });
  return {
    open, stateRoot, stack, journal, marker, record, payload, settings, states, starts, controls,
    snapshot: () => openColdSnapshot({ stack, journal, candidateSha: SHA, assertStopped() {} }),
  };
}

test('the production systemd drop-in uses the publisher interlock marker', () => {
  const file = new URL('./customer-agent-cold-maintenance.conf', import.meta.url);
  assert.equal(readFileSync(file, 'utf8'), `[Unit]\nConditionPathExists=!${COLD_CUTOVER_STATE_ROOT}/maintenance\n`);
});

test('hold requires every effective guard and can retry an interrupted stop', LINUX, (t) => {
  const f = fixture(t);
  f.settings.unguarded = watchers;
  assert.throws(() => f.open().hold(), { code: 'COLD_CUTOVER_GUARD_INVALID' });
  assert(!existsSync(f.marker));
  f.settings.unguarded = '';
  f.settings.transientGuard = true;
  assert.throws(() => f.open().hold(), { code: 'COLD_CUTOVER_GUARD_INVALID' });
  assert(!existsSync(f.marker));
  f.settings.transientGuard = false;
  f.settings.failStop = true;
  assert.throws(() => f.open().hold(), { code: 'COLD_CUTOVER_SYSTEMD_FAILED' });
  assert(existsSync(f.marker));
  assert.throws(() => assertNoActiveColdCutover(f.stateRoot), { code: 'COLD_CUTOVER_ACTIVE' });
  assert.throws(() => f.open().stageCandidate(), { code: 'COLD_CUTOVER_NOT_HELD' });
  assert.throws(() => f.open('b'.repeat(40)).hold(), { code: 'COLD_CUTOVER_STATE_INVALID' });

  f.settings.failStop = false;
  f.states.set(watchers, 'activating');
  f.open().hold();
  assert([...f.states.values()].every((state) => state === 'inactive'));
  f.settings.pg = 'running';
  assert.throws(() => f.open().stageCandidate(), { code: 'COLD_CUTOVER_POSTGRES_NOT_STOPPED' });
  f.settings.pg = 'unclean';
  assert.throws(() => f.open().stageCandidate(), { code: 'COLD_CUTOVER_POSTGRES_NOT_STOPPED' });
  assert.deepEqual(f.snapshot().status(), { phase: 'unprepared', active: 'original' });
});

test('rollback privately verifies and opens exactly the units active before the hold', LINUX, async (t) => {
  const f = fixture(t);
  f.open().hold();
  f.open().stageCandidate();
  writeFileSync(f.payload, 'candidate writes');
  f.open().restoreOriginal();
  assert.equal(readFileSync(f.payload, 'utf8'), 'original');
  await assert.rejects(f.open().resumeWrites('original', async () => {
    assert(existsSync(f.marker));
    throw new Error('private check failed');
  }), /private check failed/u);
  assert(existsSync(f.marker));
  await f.open().resumeWrites('original', async ({ side }) => {
    assert.equal(side, 'original');
    assert(existsSync(f.marker));
    assert.equal(readFileSync(f.payload, 'utf8'), 'original');
  });
  assert.deepEqual([...f.states].filter(([, state]) => state === 'active').map(([unit]) => unit), f.starts);
  assertNoActiveColdCutover(f.stateRoot);
  assert.throws(() => f.open().stageCandidate(), { code: 'COLD_CUTOVER_NOT_HELD' });
});

test('candidate seal precedes opening writes and interrupted start can only resume the sealed side', LINUX, async (t) => {
  const f = fixture(t);
  f.open().hold();
  f.open().stageCandidate();
  f.settings.failStart = true;
  await assert.rejects(f.open().resumeWrites('candidate', async () => {
    assert(existsSync(f.marker));
    assert.equal(f.snapshot().status().phase, 'prepared');
  }), { code: 'COLD_CUTOVER_SYSTEMD_FAILED' });
  assert(!existsSync(f.marker));
  assert.throws(() => assertNoActiveColdCutover(f.stateRoot), { code: 'COLD_CUTOVER_ACTIVE' });
  assert.equal(f.snapshot().status().phase, 'sealed');
  writeFileSync(f.payload, 'writes after publication');
  assert.throws(() => f.snapshot().restoreOriginal(), { code: 'COLD_SNAPSHOT_SEALED' });
  await assert.rejects(f.open().resumeWrites('original'), { code: 'COLD_CUTOVER_STATE_INVALID' });
  assert.throws(() => f.open().hold(), { code: 'COLD_CUTOVER_STATE_INVALID' });

  f.settings.failStart = false;
  await f.open().resumeWrites('candidate');
  assert.equal(readFileSync(f.payload, 'utf8'), 'writes after publication');
  assertNoActiveColdCutover(f.stateRoot);
});
