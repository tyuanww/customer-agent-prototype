import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync, fsyncSync, lstatSync, openSync, readdirSync, readFileSync,
  realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

const JOURNAL_SCHEMA = 'customer-agent-cold-snapshot/v1';
const SHA = /^[0-9a-f]{40}$/u;
const FILESYSTEM_ID = /^[0-9]+:[1-9][0-9]*$/u;
const COMMAND_OPTIONS = { timeout: 600_000, stdio: ['ignore', 'ignore', 'pipe'] };
// The lock follows the child, including cp, if the publisher process dies.
const SNAPSHOT_IO = [
  'import ctypes, fcntl, json, os, shutil, stat, subprocess, sys',
  'journal, stack, working, pending, action, phase, original, copied = sys.argv[1:]',
  'lock = os.open(os.path.join(journal, "snapshot-io.lock"), os.O_CREAT | os.O_NOFOLLOW | os.O_RDWR, 0o600)',
  'fcntl.flock(lock, fcntl.LOCK_EX)',
  'with open(os.path.join(journal, "cold-snapshot.json"), "rb") as file:',
  '    state = json.load(file)',
  'if (state["phase"], state["original"], state.get("working", "")) != (phase, original, copied):',
  '    sys.exit("snapshot intent changed while waiting for the lock")',
  'def identity(directory):',
  '    entry = os.lstat(directory)',
  '    if not stat.S_ISDIR(entry.st_mode):',
  '        sys.exit("snapshot directory identity changed")',
  '    return f"{entry.st_dev}:{entry.st_ino}"',
  'if action == "wait":',
  '    sys.exit(0)',
  'if action == "copy":',
  '    if identity(stack) != original or os.path.lexists(working):',
  '        sys.exit("snapshot changed before copying")',
  '    if os.path.lexists(pending):',
  '        shutil.rmtree(pending)',
  '    subprocess.run(["/usr/bin/cp", "--archive", "--reflink=auto", "--sparse=always",',
  '        "--one-file-system", "--no-target-directory", "--", stack, pending],',
  '        check=True, pass_fds=(lock,))',
  '    sys.exit(0)',
  'desired = (copied, original) if action == "candidate" else (original, copied)',
  'current = (identity(stack), identity(working))',
  'if current != desired:',
  '    if current != desired[::-1]:',
  '        sys.exit("snapshot directories changed before exchanging")',
  '    rename = ctypes.CDLL(None, use_errno=True).renameat2',
  '    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]',
  '    rename.restype = ctypes.c_int',
  '    if rename(-100, os.fsencode(stack), -100, os.fsencode(working), 2):',
  '        raise OSError(ctypes.get_errno(), "renameat2 exchange failed")',
  'for directory in (os.path.dirname(stack), journal):',
  '    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)',
  '    os.fsync(fd)',
  '    os.close(fd)',
].join('\n');

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function optionalStat(entry) {
  try {
    return lstatSync(entry, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function identity(stat) {
  if (!stat?.isDirectory()) fail('COLD_SNAPSHOT_DRIFT', 'Expected a real stack directory');
  return [stat.dev, stat.ino].join(':');
}

function inside(directory, entry) {
  return entry === directory || entry.startsWith(directory + path.sep);
}

function assertTrustedParents(entry) {
  const uid = BigInt(process.geteuid());
  for (let directory = path.dirname(entry); ; directory = path.dirname(directory)) {
    const info = lstatSync(directory, { bigint: true });
    const stickyRoot = info.uid === 0n && (info.mode & 0o1000n) !== 0n;
    if (!info.isDirectory() || (info.uid !== 0n && info.uid !== uid)
      || (!stickyRoot && (info.mode & 0o022n) !== 0n)) {
      fail('COLD_SNAPSHOT_PATH_INVALID', 'Snapshot parent can be changed by another account');
    }
    if (directory === path.dirname(directory)) return;
  }
}

function assertTree(directory, device) {
  const mounts = readFileSync('/proc/self/mountinfo', 'utf8').trimEnd().split('\n');
  if (mounts.some((row) => {
    const mount = row.split(' ')[4].replace(/\\([0-7]{3})/gu, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
    return inside(directory, mount);
  })) fail('COLD_SNAPSHOT_TREE_UNSAFE', 'Stack includes a mount point');

  const pending = [directory];
  while (pending.length > 0) {
    const entry = pending.pop();
    const info = lstatSync(entry, { bigint: true });
    if (info.dev !== device || !(info.isDirectory() || (info.isFile() && info.nlink === 1n))) {
      fail('COLD_SNAPSHOT_TREE_UNSAFE', 'Stack contains a link, special file or another filesystem');
    }
    if (info.isDirectory()) {
      for (const child of readdirSync(entry)) pending.push(path.join(entry, child));
    }
  }
}

function syncDirectory(directory) {
  const fd = openSync(directory, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeState(directory, file, state) {
  const temporary = path.join(directory, 'state-' + randomUUID());
  try {
    writeFileSync(temporary, JSON.stringify(state) + '\n', { flag: 'wx', mode: 0o600 });
    const fd = openSync(temporary, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, file);
    syncDirectory(directory);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function readState(file, stack, candidateSha) {
  const stat = optionalStat(file);
  if (!stat) return undefined;
  if (!stat.isFile() || stat.nlink !== 1n || stat.uid !== BigInt(process.geteuid())
    || (stat.mode & 0o777n) !== 0o600n || stat.size > 4096n) {
    fail('COLD_SNAPSHOT_STATE_INVALID', 'Cold snapshot journal file is invalid');
  }
  let state;
  try {
    state = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    fail('COLD_SNAPSHOT_STATE_INVALID', 'Cold snapshot journal cannot be read');
  }
  if (!state || state.schema !== JOURNAL_SCHEMA || state.stack !== stack || state.candidateSha !== candidateSha
    || typeof state.original !== 'string' || !FILESYSTEM_ID.test(state.original)
    || !['preparing', 'prepared', 'restoring', 'aborting', 'rolled-back', 'sealed'].includes(state.phase)
    || (['preparing', 'aborting'].includes(state.phase) && state.working !== undefined)
    || (state.working === undefined ? ['prepared', 'restoring', 'sealed'].includes(state.phase)
      : typeof state.working !== 'string' || !FILESYSTEM_ID.test(state.working) || state.original === state.working)) {
    fail('COLD_SNAPSHOT_STATE_INVALID', 'Cold snapshot journal does not match this release');
  }
  return state;
}

/**
 * Use under the deployment lock, with all outside writes blocked until sealCandidate returns.
 * The stopped assertion also checks PostgreSQL. Only prepare/start/restore require a stopped stack.
 * The journal outlives either directory, and the directory identities determine which one is live.
 */
export function openColdSnapshot({ stack, journal, candidateSha, assertStopped }) {
  if (process.platform !== 'linux' || typeof assertStopped !== 'function' || !SHA.test(candidateSha)
    || !path.isAbsolute(stack) || !path.isAbsolute(journal)
    || inside(stack, journal) || inside(journal, stack)
    || realpathSync(stack) !== stack || realpathSync(journal) !== journal) {
    fail('COLD_SNAPSHOT_PATH_INVALID', 'Expected distinct canonical Linux stack and journal directories');
  }
  assertTrustedParents(stack);
  assertTrustedParents(journal);
  const stackStat = lstatSync(stack, { bigint: true });
  const stackDevice = stackStat.dev;
  const journalStat = lstatSync(journal, { bigint: true });
  if (!stackStat.isDirectory() || !journalStat.isDirectory() || journalStat.uid !== BigInt(process.geteuid())
    || (journalStat.mode & 0o777n) !== 0o700n || stackDevice !== journalStat.dev) {
    fail('COLD_SNAPSHOT_PATH_INVALID', 'Journal must be private and on the stack filesystem');
  }

  const working = path.join(journal, 'working-stack');
  const pending = path.join(journal, 'pending-copy');
  const stateFile = path.join(journal, 'cold-snapshot.json');
  const state = () => readState(stateFile, stack, candidateSha);
  const persist = (value) => writeState(journal, stateFile, value);
  const activeIdentity = () => identity(optionalStat(stack));
  const runSnapshotIo = (action, snapshot) => execFileSync('/usr/bin/python3', [
    '-c', SNAPSHOT_IO, journal, stack, working, pending, action,
    snapshot.phase, snapshot.original, snapshot.working ?? '',
  ], COMMAND_OPTIONS);
  const syncSelection = () => {
    syncDirectory(path.dirname(stack));
    syncDirectory(journal);
  };

  function activeSide(snapshot) {
    if (!snapshot || snapshot.working === undefined) {
      fail('COLD_SNAPSHOT_STATE_INVALID', 'Cold snapshot has not finished copying');
    }
    const active = activeIdentity();
    const inactive = identity(optionalStat(working));
    if (active === snapshot.original && inactive === snapshot.working) return 'original';
    if (active === snapshot.working && inactive === snapshot.original) return 'candidate';
    fail('COLD_SNAPSHOT_DRIFT', 'Directory identities disagree with the cold snapshot journal');
  }

  function select(snapshot, target) {
    const side = activeSide(snapshot);
    if (side === target && target === 'candidate') {
      syncSelection();
      return;
    }
    // Even if the original directory looks live, an exchange child may have
    // passed its journal check before rollback wrote the restoring intent.
    assertStopped();
    assertTree(stack, stackDevice);
    assertTree(working, stackDevice);
    assertStopped();
    runSnapshotIo(target, snapshot);
    if (activeSide(snapshot) !== target) fail('COLD_SNAPSHOT_DRIFT', 'Directory exchange did not persist the target');
  }

  return Object.freeze({
    prepare() {
      let snapshot = state();
      if (snapshot && snapshot.phase !== 'preparing') {
        if (['aborting', 'restoring', 'rolled-back'].includes(snapshot.phase)) {
          fail('COLD_SNAPSHOT_ROLLED_BACK', 'Start a fresh release after restoring the original stack');
        }
        activeSide(snapshot);
        return;
      }
      assertStopped();
      const original = activeIdentity();
      assertTree(stack, stackDevice);
      if (!snapshot) {
        if (optionalStat(working) || optionalStat(pending)) fail('COLD_SNAPSHOT_DRIFT', 'Unexpected working directory');
        snapshot = { schema: JOURNAL_SCHEMA, stack, candidateSha, original, phase: 'preparing' };
        persist(snapshot);
      } else if (snapshot.original !== original) {
        fail('COLD_SNAPSHOT_DRIFT', 'Original stack moved before the copy finished');
      }
      if (!optionalStat(working)) {
        runSnapshotIo('copy', snapshot);
        assertTree(pending, stackDevice);
        execFileSync('/usr/bin/sync', ['-f', '--', pending], COMMAND_OPTIONS);
        renameSync(pending, working);
        syncDirectory(journal);
      }
      assertStopped();
      if (activeIdentity() !== original) fail('COLD_SNAPSHOT_DRIFT', 'Original stack moved during the copy');
      assertTree(working, stackDevice);
      persist({ ...snapshot, phase: 'prepared', working: identity(optionalStat(working)) });
    },
    startCandidate() {
      const snapshot = state();
      if (['aborting', 'restoring', 'rolled-back'].includes(snapshot?.phase)) {
        fail('COLD_SNAPSHOT_ROLLED_BACK', 'Start a fresh release after restoring the original stack');
      }
      if (snapshot?.phase === 'sealed' && activeSide(snapshot) !== 'candidate') {
        fail('COLD_SNAPSHOT_DRIFT', 'A sealed candidate must remain active');
      }
      select(snapshot, 'candidate');
    },
    restoreOriginal() {
      let snapshot = state();
      if (snapshot?.phase === 'sealed') {
        fail('COLD_SNAPSHOT_SEALED', 'The release reached the point where writes can reopen');
      }
      if (!snapshot || snapshot.working === undefined) {
        if (!snapshot && (optionalStat(working) || optionalStat(pending))) {
          fail('COLD_SNAPSHOT_DRIFT', 'Unexpected working directory');
        }
        const original = activeIdentity();
        if (snapshot && snapshot.original !== original) {
          fail('COLD_SNAPSHOT_DRIFT', 'The original stack changed before the copy finished');
        }
        if (snapshot?.phase === 'rolled-back') {
          syncSelection();
          return;
        }
        assertStopped();
        snapshot = { schema: JOURNAL_SCHEMA, stack, candidateSha, original, phase: 'aborting' };
        persist(snapshot);
        // The copy child may still hold the IO lock after the publisher died.
        // Disarm any queued copy, and drain the active copy before opening writes.
        runSnapshotIo('wait', snapshot);
        assertStopped();
        if (activeIdentity() !== original) fail('COLD_SNAPSHOT_DRIFT', 'The original stack changed while aborting');
        persist({ ...snapshot, phase: 'rolled-back' });
        return;
      }
      if (snapshot.phase === 'rolled-back') {
        if (activeSide(snapshot) !== 'original') {
          fail('COLD_SNAPSHOT_DRIFT', 'The restored original must remain active');
        }
        syncSelection();
        return;
      }
      if (snapshot.phase !== 'restoring') {
        assertStopped();
        snapshot = { ...snapshot, phase: 'restoring' };
        persist(snapshot);
      }
      select(snapshot, 'original');
      persist({ ...snapshot, phase: 'rolled-back' });
    },
    status() {
      const snapshot = state();
      if (!snapshot || snapshot.working === undefined) {
        if (snapshot && activeIdentity() !== snapshot.original) {
          fail('COLD_SNAPSHOT_DRIFT', 'The original stack does not match the journal');
        }
        return { phase: snapshot?.phase ?? 'unprepared', active: 'original' };
      }
      return { phase: snapshot.phase, active: activeSide(snapshot) };
    },
    sealCandidate() {
      const snapshot = state();
      if (activeSide(snapshot) !== 'candidate' || !['prepared', 'sealed'].includes(snapshot.phase)) {
        fail('COLD_SNAPSHOT_STATE_INVALID', 'Only the active candidate can be sealed');
      }
      if (snapshot.phase !== 'sealed') persist({ ...snapshot, phase: 'sealed' });
      syncSelection();
    },
  });
}
