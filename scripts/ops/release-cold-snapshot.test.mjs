import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { openColdSnapshot } from './release-cold-snapshot.mjs';

const linuxOnly = { skip: process.platform !== 'linux' };

function fixture(t) {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'customer-agent-cold-snapshot-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stack = path.join(root, 'stack');
  const journal = path.join(root, 'evidence');
  mkdirSync(stack, { mode: 0o700 });
  mkdirSync(journal, { mode: 0o700 });
  mkdirSync(path.join(stack, 'data'), { mode: 0o700 });
  writeFileSync(path.join(stack, 'data', 'marker'), 'before', { mode: 0o600 });
  let stopped = true;
  const open = (release = 'a'.repeat(40)) => openColdSnapshot({
    stack, journal, candidateSha: release,
    assertStopped() { if (!stopped) throw new Error('stack is running'); },
  });
  return {
    stack, journal, open,
    setRunning() { stopped = false; },
    read() { return readFileSync(path.join(stack, 'data', 'marker'), 'utf8'); },
    write(value) { writeFileSync(path.join(stack, 'data', 'marker'), value); },
  };
}

test('stopped stack is copied, the original is preserved and reopening restores it', linuxOnly, (t) => {
  const s = fixture(t);
  const originalInode = lstatSync(s.stack, { bigint: true }).ino;
  const setup = s.open();
  setup.prepare();
  setup.prepare();
  setup.startCandidate();
  assert.notEqual(lstatSync(s.stack, { bigint: true }).ino, originalInode);
  assert.equal(s.read(), 'before');
  s.write('candidate');
  const reopened = s.open();
  reopened.startCandidate();
  assert.equal(s.read(), 'candidate');
  reopened.restoreOriginal();
  s.open().restoreOriginal();
  assert.equal(lstatSync(s.stack, { bigint: true }).ino, originalInode);
  assert.equal(s.read(), 'before');
  s.write('writes after rollback');
  assert.throws(() => s.open().startCandidate(), { code: 'COLD_SNAPSHOT_ROLLED_BACK' });
  assert.equal(s.read(), 'writes after rollback');
});

test('owner termination after directory exchange still allows deterministic rollback', linuxOnly, (t) => {
  const s = fixture(t);
  s.open().prepare();
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', [
    'import {openColdSnapshot} from ' + JSON.stringify(new URL('./release-cold-snapshot.mjs', import.meta.url).href) + ';',
    'const [stack, journal] = process.argv.slice(1);',
    'openColdSnapshot({stack, journal, candidateSha: "a".repeat(40), assertStopped() {}}).startCandidate();',
    'process.kill(process.pid, "SIGKILL");',
  ].join('\n'), s.stack, s.journal], { encoding: 'utf8' });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  s.write('candidate');
  s.open().restoreOriginal();
  assert.equal(s.read(), 'before');
});

test('a delayed exchange cannot activate the candidate after rollback is recorded', linuxOnly, async (t) => {
  const s = fixture(t);
  s.open().prepare();
  const lock = spawn('/usr/bin/flock', [
    path.join(s.journal, 'snapshot-io.lock'), process.execPath, '-e',
    'console.log("locked"); process.stdin.resume();',
  ]);
  t.after(() => lock.stdin.end());
  const lockClosed = once(lock, 'close');
  assert.equal(String((await once(lock.stdout, 'data'))[0]).trim(), 'locked');

  const exchange = spawn(process.execPath, ['--input-type=module', '-e', [
    'import {openColdSnapshot} from ' + JSON.stringify(new URL('./release-cold-snapshot.mjs', import.meta.url).href) + ';',
    'const [stack, journal] = process.argv.slice(1);',
    'openColdSnapshot({stack, journal, candidateSha: "a".repeat(40), assertStopped() {}}).startCandidate();',
  ].join('\n'), s.stack, s.journal]);
  t.after(() => { if (exchange.exitCode === null) exchange.kill(); });
  const exchangeClosed = once(exchange, 'close');
  let failure = '';
  exchange.stderr.setEncoding('utf8').on('data', (chunk) => { failure += chunk; });
  const children = '/proc/' + exchange.pid + '/task/' + exchange.pid + '/children';
  const limit = Date.now() + 3_000;
  while (!readFileSync(children, 'utf8').trim() && Date.now() < limit) await delay(5);
  assert.match(readFileSync(children, 'utf8'), /\d+/u, 'exchange must already be waiting for the lock');

  const rollback = spawn(process.execPath, ['--input-type=module', '-e', [
    'import {openColdSnapshot} from ' + JSON.stringify(new URL('./release-cold-snapshot.mjs', import.meta.url).href) + ';',
    'const [stack, journal] = process.argv.slice(1);',
    'openColdSnapshot({stack, journal, candidateSha: "a".repeat(40), assertStopped() {}}).restoreOriginal();',
  ].join('\n'), s.stack, s.journal]);
  t.after(() => { if (rollback.exitCode === null) rollback.kill(); });
  const rollbackClosed = once(rollback, 'close');
  const stateFile = path.join(s.journal, 'cold-snapshot.json');
  const rollbackLimit = Date.now() + 3_000;
  const phase = () => JSON.parse(readFileSync(stateFile, 'utf8')).phase;
  while (phase() === 'prepared' && Date.now() < rollbackLimit) await delay(5);
  assert.equal(phase(), 'restoring', 'rollback must remain provisional while an exchange owns the lock');
  assert.equal(rollback.exitCode, null);
  lock.stdin.end();
  assert.equal((await lockClosed)[0], 0);
  assert.equal((await rollbackClosed)[0], 0);
  assert.notEqual((await exchangeClosed)[0], 0);
  assert.match(failure, /snapshot intent changed while waiting for the lock/u);
  assert.equal(s.read(), 'before');
});

test('a sealed candidate forbids restoring old data', linuxOnly, (t) => {
  const s = fixture(t);
  const snapshot = s.open();
  snapshot.prepare();
  assert.throws(() => snapshot.sealCandidate(), { code: 'COLD_SNAPSHOT_STATE_INVALID' });
  snapshot.startCandidate();
  snapshot.sealCandidate();
  s.setRunning();
  s.write('new writes');
  assert.throws(() => s.open().restoreOriginal(), { code: 'COLD_SNAPSHOT_SEALED' });
  assert.equal(s.read(), 'new writes');
});

test('live stack, foreign release and unknown directory identity fail closed', linuxOnly, (t) => {
  const s = fixture(t);
  s.open().prepare();
  assert.throws(() => s.open('b'.repeat(40)).startCandidate(), { code: 'COLD_SNAPSHOT_STATE_INVALID' });
  execFileSync('/usr/bin/mv', [s.stack, s.stack + '.other']);
  mkdirSync(s.stack);
  assert.throws(() => s.open().restoreOriginal(), { code: 'COLD_SNAPSHOT_DRIFT' });
  s.setRunning();
  const another = fixture(t);
  another.setRunning();
  assert.throws(() => another.open().prepare(), /stack is running/);
});

test('rejects a stack with a link outside its directory before creating the copy', linuxOnly, (t) => {
  const s = fixture(t);
  symlinkSync(s.journal, path.join(s.stack, 'data', 'external'));
  assert.throws(() => s.open().prepare(), { code: 'COLD_SNAPSHOT_TREE_UNSAFE' });
  assert.equal(s.read(), 'before');
});

test('can permanently abort before the cold copy is prepared', linuxOnly, (t) => {
  const s = fixture(t);
  const original = lstatSync(s.stack, { bigint: true });
  writeFileSync(path.join(s.journal, 'cold-snapshot.json'), JSON.stringify({
    schema: 'customer-agent-cold-snapshot/v1',
    stack: s.stack,
    candidateSha: 'a'.repeat(40),
    original: [original.dev, original.ino].join(':'),
    phase: 'preparing',
  }), { mode: 0o600 });
  s.open().restoreOriginal();
  s.open().restoreOriginal();
  assert.deepEqual(s.open().status(), { active: 'original', phase: 'rolled-back' });
  assert.throws(() => s.open().prepare(), { code: 'COLD_SNAPSHOT_ROLLED_BACK' });
  assert.throws(() => s.open().startCandidate(), { code: 'COLD_SNAPSHOT_ROLLED_BACK' });
  assert.equal(s.read(), 'before');
});
