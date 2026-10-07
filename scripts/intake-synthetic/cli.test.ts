import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const options = { skip: process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_TEST !== '1', timeout: 30_000 };
function start(nodeArguments: string[] = [], environment = process.env) {
  const child = spawn(process.execPath, [...nodeArguments, 'scripts/intake-synthetic/run.ts'], { cwd: root, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines: string[] = []; let stderr = '';
  const input = createInterface({ input: child.stdout });
  input.on('line', line => { lines.push(line); }); child.stderr.on('data', chunk => { stderr += String(chunk); });
  const exit = once(child, 'exit');
  async function waitFor(predicate: (line: string) => boolean): Promise<string> {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const found = lines.find(predicate); if (found) return found;
      if (child.exitCode !== null || child.signalCode !== null || Date.now() >= deadline) throw new Error(`Synthetic CLI did not produce expected output: ${JSON.stringify({ lines, stderr })}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  return { child, lines, waitFor, exit, stderr: () => stderr, async close() {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exit; input.close();
  } };
}
type Ready = { hostDirectory: string; desktopProfile: string; expiresAt: string };

test('foreground CLI consumes fixed commands and cleans its host while retaining separately owned Electron profile', options, async () => {
  const cli = start(); let ready: Ready | undefined;
  try {
    ready = JSON.parse(await cli.waitFor(line => line.includes('"status":"READY_SYNTHETIC_ONLY"'))) as Ready;
    assert.ok(Date.parse(ready.expiresAt) > Date.now());
    assert.ok(existsSync(ready.hostDirectory));
    assert.equal(path.relative(ready.hostDirectory, ready.desktopProfile).startsWith('..'), true);
    // Simulate the independently launched Electron owning its separate profile.
    mkdirSync(ready.desktopProfile); writeFileSync(path.join(ready.desktopProfile, 'owned-by-desktop'), 'synthetic');
    cli.child.stdin.write('status\n');
    const status = JSON.parse(await cli.waitFor(line => line.includes('"currentReleaseId"'))) as { publications: number; pendingApprovals: number };
    assert.equal(status.publications, 0); assert.equal(status.pendingApprovals, 0);
    cli.child.stdin.write('identity agent\n');
    await cli.waitFor(line => line === '下一次合成登录：agent');
    cli.child.stdin.write('approve\n');
    // No requested review exists: this command cannot manufacture an approval.
    await new Promise(resolve => setTimeout(resolve, 50));
    cli.child.stdin.write('quit\n');
    const stopped = JSON.parse(await cli.waitFor(line => line.includes('"status":"STOPPED"'))) as { reason: string; hostDataRemoved: boolean; desktopProfileRetained: string };
    assert.equal(stopped.reason, 'requested'); assert.equal(stopped.hostDataRemoved, true);
    assert.equal(stopped.desktopProfileRetained, ready.desktopProfile);
    assert.deepEqual(await cli.exit, [0, null]);
    assert.match(cli.stderr(), /Exactly one pending synthetic review is required/);
    assert.equal(existsSync(ready.hostDirectory), false);
    assert.equal(readFileSync(path.join(ready.desktopProfile, 'owned-by-desktop'), 'utf8'), 'synthetic');
  } finally { await cli.close(); if (ready) rmSync(ready.desktopProfile, { recursive: true, force: true }); }
});

test('piped stdin EOF drains status and identity commands before shutdown', options, async () => {
  const cli = start();
  try {
    const ready = JSON.parse(await cli.waitFor(line => line.includes('"status":"READY_SYNTHETIC_ONLY"'))) as Ready;
    cli.child.stdin.end('status\nidentity agent\n');
    await cli.waitFor(line => line.includes('"currentReleaseId"'));
    await cli.waitFor(line => line === '下一次合成登录：agent');
    const stopped = JSON.parse(await cli.waitFor(line => line.includes('"status":"STOPPED"'))) as { reason: string };
    assert.equal(stopped.reason, 'stdin-closed'); assert.deepEqual(await cli.exit, [0, null]);
    assert.equal(existsSync(ready.hostDirectory), false); assert.equal(existsSync(ready.desktopProfile), false);
    assert.equal(cli.stderr(), '');
  } finally { await cli.close(); }
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) test(`startup ${signal} cleans the already started private PostgreSQL without announcing readiness`, options, async () => {
  // Short, dedicated TMPDIR keeps the Unix socket below macOS path limits.
  // The preload runs only in this test child; the CLI/host has no test protocol.
  const probe = mkdtempSync('/tmp/intake-sig-'), record = path.join(probe, 'cluster.json');
  const harness = new URL('../../packages/database/dist/testkit/pg15-harness.js', import.meta.url).href;
  const hook = `
    import { readFileSync, writeFileSync } from 'node:fs';
    import { Pg15Harness } from ${JSON.stringify(harness)};
    const original = Pg15Harness.prototype.start;
    Pg15Harness.prototype.start = function () {
      original.call(this);
      writeFileSync(${JSON.stringify(record)}, JSON.stringify({ root: this.root, data: this.data, bin: this.bin,
        pid: Number(readFileSync(this.data + '/postmaster.pid', 'utf8').split('\\n')[0]) }));
      process.kill(process.pid, ${JSON.stringify(signal)});
    };
  `;
  const cli = start(['--import', `data:text/javascript,${encodeURIComponent(hook)}`], { ...process.env, TMPDIR: probe });
  type Cluster = { root: string; data: string; bin: string; pid: number };
  const cluster = (): Cluster => {
    const value = JSON.parse(readFileSync(record, 'utf8')) as Cluster;
    assert.equal(path.dirname(value.root), probe); assert.ok(path.basename(value.root).startsWith('customer-agent-pg15-'));
    assert.equal(value.data, path.join(value.root, 'data')); assert.ok(Number.isSafeInteger(value.pid) && value.pid > 0);
    return value;
  };
  try {
    const exited = await cli.exit;
    const owned = cluster();
    assert.deepEqual(exited, [0, null], JSON.stringify({ exited, root: owned.root, pid: owned.pid, directoryStillExists: existsSync(owned.root) }));
    const stopped = JSON.parse(await cli.waitFor(line => line.includes('"status":"STOPPED"'))) as { reason: string; hostDataRemoved: boolean };
    assert.equal(stopped.reason, signal); assert.equal(stopped.hostDataRemoved, true);
    assert.equal(cli.lines.some(line => line.includes('"status":"READY_SYNTHETIC_ONLY"')), false);
    assert.equal(existsSync(owned.root), false);
    assert.throws(() => process.kill(owned.pid, 0), { code: 'ESRCH' });
    assert.equal(cli.stderr(), '');
  } finally {
    await cli.close();
    // The deliberately failing pre-fix run can orphan its cluster. Never scan
    // or kill another process: both path and postmaster PID must match this probe.
    if (existsSync(record)) {
      const owned = cluster(), pidFile = path.join(owned.data, 'postmaster.pid');
      if (existsSync(pidFile)) {
        assert.equal(Number(readFileSync(pidFile, 'utf8').split('\n')[0]), owned.pid);
        execFileSync(path.join(owned.bin, 'pg_ctl'), ['-D', owned.data, '-m', 'immediate', '-w', 'stop'], { timeout: 10_000, stdio: 'pipe' });
      }
    }
    rmSync(probe, { recursive: true, force: true });
  }
});
