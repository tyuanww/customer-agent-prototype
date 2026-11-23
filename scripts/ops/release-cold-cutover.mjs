import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, rmSync,
  unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { openColdSnapshot } from './release-cold-snapshot.mjs';

export const COLD_CUTOVER_STATE_ROOT = '/var/lib/customer-agent-release';
const HOLD_FILE = 'maintenance';
const STATE_FILE = 'cutover.json';
const STATE_SCHEMA = 'customer-agent-cold-cutover/v1';
const UNIT_ROOT = '/etc/systemd/system';
const DROP_IN = 'customer-agent-cold-maintenance.conf';
const SHA = /^[0-9a-f]{40}$/u;
const STACK_UNIT = 'customer-agent-stack.service';
const TUNNEL_UNIT = 'customer-agent-tunnel.service';
const SCHEDULED = ['stack-watchdog', 'roster-refresh', 'backup', 'health-check'];
const TIMERS = SCHEDULED.map((job) => `customer-agent-${job}.timer`);
const STARTABLE = [STACK_UNIT, TUNNEL_UNIT, ...TIMERS];
export const COLD_CUTOVER_UNITS = Object.freeze([
  ...STARTABLE, ...SCHEDULED.map((job) => `customer-agent-${job}.service`),
]);
const SYSTEMD_BUS = 'org.freedesktop.systemd1';
const COMMAND_OPTIONS = {
  encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
  stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000,
};

// The systemctl child can outlive its Node caller. Bind each queued action to
// the durable intent and keep the lock through systemctl's job completion.
const SYSTEMD_IO = [
  'import fcntl, json, os, subprocess, sys',
  'state_root, candidate, journal, action, *units = sys.argv[1:]',
  'lock = os.open(os.path.join(state_root, "systemd-io.lock"), os.O_CREAT | os.O_NOFOLLOW | os.O_RDWR, 0o600)',
  'fcntl.flock(lock, fcntl.LOCK_EX)',
  'with open(os.path.join(state_root, "cutover.json"), "rb") as file:',
  '    state = json.load(file)',
  'expected = "holding" if action == "stop" else "resuming"',
  'if (state["candidateSha"], state["journal"], state["phase"]) != (candidate, journal, expected):',
  '    sys.exit("cutover intent changed while waiting for the lock")',
  'if action == "wait":',
  '    sys.exit(0)',
  'marker_present = os.path.lexists(os.path.join(state_root, "maintenance"))',
  'if marker_present != (action == "stop"):',
  '    sys.exit("cutover maintenance state changed while waiting for the lock")',
  'if units:',
  '    subprocess.run(["/usr/bin/systemctl", action, "--", *units], check=True, pass_fds=(lock,))',
].join('\n');

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function optionalStat(file) {
  try {
    return lstatSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  }
}

function checkStateRoot(root, stat) {
  const uid = process.geteuid();
  if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o777) !== 0o700 || realpathSync(root) !== root) {
    fail('COLD_CUTOVER_STATE_INVALID', 'Cold cutover state directory must be private and canonical');
  }
  for (let parent = path.dirname(root); ; parent = path.dirname(parent)) {
    const info = lstatSync(parent);
    const stickyRoot = info.uid === 0 && (info.mode & 0o1000) !== 0;
    if (!info.isDirectory() || (info.uid !== 0 && info.uid !== uid) || (!stickyRoot && (info.mode & 0o022) !== 0)) {
      fail('COLD_CUTOVER_STATE_INVALID', 'Cold cutover state parent can be modified by another account');
    }
    if (parent === path.dirname(parent)) return;
  }
}

/** Use in the normal production publisher while it holds the deployment lock. */
export function assertNoActiveColdCutover(root = COLD_CUTOVER_STATE_ROOT) {
  const stat = optionalStat(root);
  if (!stat) return;
  checkStateRoot(root, stat);
  if (optionalStat(path.join(root, HOLD_FILE)) || optionalStat(path.join(root, STATE_FILE))) {
    fail('COLD_CUTOVER_ACTIVE', 'The held cold cutover must be recovered before a normal deployment');
  }
}

function syncFile(file) {
  const fd = openSync(file, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function persist(root, file, value) {
  const temporary = path.join(root, `record-${randomUUID()}`);
  try {
    writeFileSync(temporary, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
    syncFile(temporary);
    renameSync(temporary, file);
    syncFile(root);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function readRecord(file) {
  const stat = optionalStat(file);
  if (!stat) return undefined;
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.geteuid()
    || (stat.mode & 0o777) !== 0o600 || stat.size > 4096) {
    fail('COLD_CUTOVER_STATE_INVALID', 'Cold cutover record has unsafe permissions');
  }
  try {
    const record = JSON.parse(readFileSync(file, 'utf8'));
    if (record !== null) return record;
  } catch {
    // Invalid and unreadable records both leave the maintenance marker intact.
  }
  fail('COLD_CUTOVER_STATE_INVALID', 'Cold cutover record cannot be read');
}

function hasPersistentGuard(unitRoot, unit, marker, dropInPaths) {
  const directory = path.join(unitRoot, unit + '.d');
  const file = path.join(directory, DROP_IN);
  const paths = dropInPaths?.split(' ') ?? [];
  if (!paths.includes(file) || paths.some((entry) => entry.startsWith('/run/'))) return false;
  const dir = optionalStat(directory);
  const entry = optionalStat(file);
  return dir?.isDirectory() && dir.uid === process.geteuid() && (dir.mode & 0o022) === 0
    && entry?.isFile() && entry.nlink === 1 && entry.uid === process.geteuid() && (entry.mode & 0o022) === 0
    && entry.size < 1024 && realpathSync(file) === file
    && readFileSync(file, 'utf8') === `[Unit]\nConditionPathExists=!${marker}\n`;
}

function manager(execute, stateRoot, marker, candidateSha, journal, unitRoot) {
  const run = (command, args) => {
    try {
      return execute(command, args, COMMAND_OPTIONS);
    } catch {
      fail('COLD_CUTOVER_SYSTEMD_FAILED', 'Cannot establish the current systemd unit state');
    }
  };
  const bus = (operation, args) => {
    try {
      return JSON.parse(run('/usr/bin/busctl', ['--system', '--json=short', operation, SYSTEMD_BUS, ...args])).data;
    } catch {
      fail('COLD_CUTOVER_SYSTEMD_FAILED', 'Cannot read the effective systemd unit conditions');
    }
  };

  return {
    observe() {
      return Object.fromEntries(COLD_CUTOVER_UNITS.map((unit) => {
        const [objectPath] = bus('call', [
          '/org/freedesktop/systemd1', `${SYSTEMD_BUS}.Manager`, 'LoadUnit', 's', unit,
        ]);
        const conditions = bus('get-property', [objectPath, `${SYSTEMD_BUS}.Unit`, 'Conditions']);
        if (!Array.isArray(conditions) || !conditions.some(([type, trigger, negate, argument]) =>
          type === 'ConditionPathExists' && trigger === false && negate === true && argument === marker)) {
          fail('COLD_CUTOVER_GUARD_INVALID', `Effective maintenance condition is missing on ${unit}`);
        }
        const properties = Object.fromEntries(run('/usr/bin/systemctl', [
          'show', '--all', '--property=Id,LoadState,ActiveState,Job,KillMode,DropInPaths', '--', unit,
        ]).trimEnd().split('\n').map((property) => property.split('=')));
        const { Id: id, LoadState: loadState, ActiveState: activeState, Job: job, KillMode: killMode, DropInPaths: dropIns } = properties;
        if (!hasPersistentGuard(unitRoot, unit, marker, dropIns)) {
          fail('COLD_CUTOVER_GUARD_INVALID', `Persistent maintenance drop-in is missing or unsafe on ${unit}`);
        }
        if (unit.endsWith('.service') && killMode !== 'control-group') {
          fail('COLD_CUTOVER_GUARD_INVALID', `Service must stop its complete control group: ${unit}`);
        }
        if (id !== unit || loadState !== 'loaded' || !activeState || job === undefined) {
          fail('COLD_CUTOVER_SYSTEMD_FAILED', `Cannot establish the current state for ${unit}`);
        }
        return [unit, { activeState, pending: job !== '' }];
      }));
    },
    control(action, units) {
      run('/usr/bin/python3', ['-c', SYSTEMD_IO, stateRoot, candidateSha, journal, action, ...units]);
    },
  };
}

/** Checks the canonical stack cluster, including a clean PostgreSQL shutdown. */
export function assertColdPostgresStopped(stack, pgBin, execute = execFileSync) {
  const data = path.join(stack, 'data', 'pg15');
  let info;
  try {
    info = lstatSync(data);
    if (!info.isDirectory() || realpathSync(data) !== data || readFileSync(path.join(data, 'PG_VERSION'), 'utf8').trim() !== '15'
      || optionalStat(path.join(data, 'postmaster.pid'))) {
      fail('COLD_CUTOVER_POSTGRES_NOT_STOPPED', 'The stack does not have a stopped PostgreSQL 15 cluster');
    }
  } catch (error) {
    if (error.code === 'COLD_CUTOVER_POSTGRES_NOT_STOPPED') throw error;
    fail('COLD_CUTOVER_POSTGRES_NOT_STOPPED', 'Cannot read the stack PostgreSQL 15 cluster');
  }
  // pg_ctl refuses to run as root, even for status on a stopped cluster.
  const options = process.geteuid() === 0 ? { ...COMMAND_OPTIONS, uid: info.uid, gid: info.gid } : COMMAND_OPTIONS;
  try {
    execute(path.join(pgBin, 'pg_ctl'), ['-D', data, 'status'], options);
    fail('COLD_CUTOVER_POSTGRES_NOT_STOPPED', 'PostgreSQL is still running');
  } catch (error) {
    if (error.code === 'COLD_CUTOVER_POSTGRES_NOT_STOPPED') throw error;
    if (error.status !== 3) fail('COLD_CUTOVER_POSTGRES_NOT_STOPPED', 'Cannot confirm PostgreSQL has stopped');
  }
  let control;
  try {
    control = execute(path.join(pgBin, 'pg_controldata'), ['-D', data], options);
  } catch {
    fail('COLD_CUTOVER_POSTGRES_NOT_STOPPED', 'Cannot read the PostgreSQL cluster shutdown state');
  }
  if (!/^Database cluster state:[ \t]+shut down$/mu.test(control)) {
    fail('COLD_CUTOVER_POSTGRES_NOT_STOPPED', 'PostgreSQL did not shut down cleanly');
  }
}

/**
 * The caller holds the same deployment lock as the online publisher. The caller
 * also owns release admission, private runtime isolation and the current pointer.
 * The named systemd units are the managed ingress and background writers.
 */
export function openHeldColdCutover({
  stack, journal, candidateSha, pgBin,
  stateRoot = COLD_CUTOVER_STATE_ROOT, unitRoot = UNIT_ROOT, execute = execFileSync,
}) {
  if (process.platform !== 'linux' || !SHA.test(candidateSha)
    || !path.isAbsolute(pgBin) || !path.isAbsolute(stateRoot) || !path.isAbsolute(unitRoot)) {
    fail('COLD_CUTOVER_STATE_INVALID', 'Expected the candidate SHA and absolute deployment paths');
  }
  checkStateRoot(stateRoot, lstatSync(stateRoot));
  const marker = path.join(stateRoot, HOLD_FILE);
  const record = path.join(stateRoot, STATE_FILE);
  const units = manager(execute, stateRoot, marker, candidateSha, journal, unitRoot);
  const binding = { schema: STATE_SCHEMA, stack, journal, candidateSha };
  const markerMatches = (value) => value === undefined || value === candidateSha;
  const read = () => {
    const state = readRecord(record);
    if (state === undefined) return undefined;
    if (Object.entries(binding).some(([key, value]) => state[key] !== value)
      || !['holding', 'resuming'].includes(state.phase)
      || !Array.isArray(state.resumeUnits) || new Set(state.resumeUnits).size !== state.resumeUnits.length
      || !state.resumeUnits.every((unit) => STARTABLE.includes(unit))
      || (state.phase === 'holding' ? state.side !== undefined : !['candidate', 'original'].includes(state.side))) {
      fail('COLD_CUTOVER_STATE_INVALID', 'Cold cutover record does not match this candidate');
    }
    return state;
  };

  const assertClosed = () => {
    if (readRecord(marker) !== candidateSha) fail('COLD_CUTOVER_NOT_HELD', 'Durable maintenance hold is missing');
    if (Object.values(units.observe()).some(({ activeState, pending }) =>
      pending || !['inactive', 'failed'].includes(activeState))) {
      fail('COLD_CUTOVER_NOT_HELD', 'One or more managed writers are still active');
    }
  };
  const assertStopped = () => {
    assertClosed();
    assertColdPostgresStopped(stack, pgBin, execute);
  };
  const snapshot = openColdSnapshot({ stack, journal, candidateSha, assertStopped });
  const assertTerminal = (side) => {
    const { phase, active } = snapshot.status();
    if (active !== side || phase !== (side === 'candidate' ? 'sealed' : 'rolled-back')) {
      fail('COLD_CUTOVER_STATE_INVALID', 'Snapshot journal does not confirm the terminal selection');
    }
  };

  return Object.freeze({
    hold() {
      const state = read();
      const existingMarker = readRecord(marker);
      if (!markerMatches(existingMarker) || (!state && existingMarker !== undefined) || state?.phase === 'resuming') {
        fail('COLD_CUTOVER_STATE_INVALID', 'Cold cutover is owned by another operation or already resuming');
      }
      const observed = units.observe();
      if (!state) {
        if (snapshot.status().phase !== 'unprepared') {
          fail('COLD_CUTOVER_STATE_INVALID', 'A fresh cutover requires a new snapshot journal');
        }
        if (STARTABLE.some((unit) => observed[unit].pending
          || !['active', 'inactive', 'failed'].includes(observed[unit].activeState))) {
          fail('COLD_CUTOVER_SYSTEMD_FAILED', 'Startable units are still transitioning');
        }
        const resumeUnits = STARTABLE.filter((unit) => observed[unit].activeState === 'active');
        persist(stateRoot, record, { ...binding, phase: 'holding', resumeUnits });
      }
      if (existingMarker === undefined) persist(stateRoot, marker, candidateSha);
      units.control('stop', COLD_CUTOVER_UNITS);
      assertClosed();
    },
    stageCandidate() {
      if (read()?.phase !== 'holding') fail('COLD_CUTOVER_NOT_HELD', 'Cold cutover is not holding writes');
      assertStopped();
      snapshot.prepare();
      snapshot.startCandidate();
    },
    restoreOriginal() {
      if (read()?.phase !== 'holding') fail('COLD_CUTOVER_NOT_HELD', 'Cold cutover is not holding writes');
      assertStopped();
      snapshot.restoreOriginal();
    },
    async resumeWrites(side, verifySelection) {
      const state = read();
      if (!state || !['candidate', 'original'].includes(side) || !markerMatches(readRecord(marker))) {
        fail('COLD_CUTOVER_STATE_INVALID', 'Cold cutover cannot resume the requested selection');
      }
      if (state.phase === 'holding') {
        const { active, phase } = snapshot.status();
        const selectable = side === 'candidate' ? ['prepared', 'sealed'] : ['rolled-back'];
        if (active !== side || !selectable.includes(phase) || typeof verifySelection !== 'function') {
          fail('COLD_CUTOVER_STATE_INVALID', 'Selected stack must be privately verified before opening writes');
        }
        assertStopped();
        await verifySelection({ side, candidateSha });
        assertStopped();
        if (side === 'candidate') snapshot.sealCandidate();
        assertTerminal(side);
        persist(stateRoot, record, { ...state, phase: 'resuming', side });
      } else if (state.side !== side) {
        fail('COLD_CUTOVER_STATE_INVALID', 'Retry must resume the terminal selection');
      }
      assertTerminal(side);
      units.control('wait', []);
      units.observe();
      if (readRecord(marker) !== undefined) {
        assertClosed();
        unlinkSync(marker);
      }
      syncFile(stateRoot);
      units.control('start', state.resumeUnits.filter((unit) => unit === STACK_UNIT));
      units.control('start', state.resumeUnits.filter((unit) => unit !== STACK_UNIT));
      const observed = units.observe();
      if (!state.resumeUnits.every((unit) => observed[unit].activeState === 'active' && !observed[unit].pending)) {
        fail('COLD_CUTOVER_SYSTEMD_FAILED', 'One or more previously active units did not resume');
      }
      unlinkSync(record);
      syncFile(stateRoot);
    },
  });
}
