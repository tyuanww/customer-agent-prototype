import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const options = { skip: process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_TEST !== '1', timeout: 30_000 };
function start(nodeArguments: string[] = [], environment = process.env, command = ['scripts/intake-synthetic/run.ts']) {
  const child = spawn(process.execPath, [...nodeArguments, ...command], { cwd: root, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
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

for (const identity of ['agent', 'roster-nogrant'] as const) test(`W5 CLI selects ${identity} for HTTP login`, options, async () => {
  const { parseContractSchema } = await import('../../packages/contracts/dist/index.js');
  const probe = mkdtempSync('/tmp/w5-cli-');
  const cli = start(['--experimental-transform-types'], { ...process.env, TMPDIR: probe }, [
    'scripts/intake-synthetic/sop-candidates-host.ts', ...(identity === 'agent' ? [] : [`--identity=${identity}`]),
  ]);
  try {
    const ready = JSON.parse(await cli.waitFor(line => line.includes('"status":"READY_SYNTHETIC_ONLY"')));
    assert.equal(ready.identity, identity);
    const { apiOrigin, identityOrigin } = JSON.parse(readFileSync(ready.profile, 'utf8'));
    const request = (url: string | URL, init?: RequestInit) => fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5_000), ...init });
    const post = (route: string, body: unknown) => request(`${apiOrigin}${route}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const started = await post('/v1/auth/login-requests', { client_challenge: challenge, challenge_method: 'S256' });
    const login = parseContractSchema('LoginCreated', await started.json());
    const authorize = new URL(login.authorize_url);
    assert.equal(authorize.origin, identityOrigin);
    const authorized = await request(authorize, { redirect: 'manual' });
    const location = authorized.headers.get('location');
    assert.ok(location);
    const callback = new URL(location);
    assert.equal(callback.origin, apiOrigin);
    assert.ok((await request(callback)).ok);
    const exchanged = await post(`/v1/auth/login-requests/${login.login_id}/exchange`, { client_verifier: verifier });
    const session = parseContractSchema('LoginSession', await exchanged.json());
    const me = await request(`${apiOrigin}/v1/auth/me`, { headers: { authorization: `Bearer ${session.access_token}` } });
    assert.equal(parseContractSchema('CurrentUserResponse', await me.json()).user_id, `user-${identity}`);
  } finally { await cli.close(); rmSync(probe, { recursive: true, force: true }); }
});

test('W5 CLI refuses an unknown identity before preparing PG15 or writing a profile', options, async () => {
  const probe = mkdtempSync('/tmp/w5-cli-');
  const cli = start(['--experimental-transform-types'], { ...process.env, TMPDIR: probe, CUSTOMER_AGENT_PG15_BIN: probe }, [
    'scripts/intake-synthetic/sop-candidates-host.ts', '--identity=unknown',
  ]);
  try {
    assert.deepEqual(await cli.exit, [1, null]);
    assert.match(cli.stderr(), /Specify --identity=agent or --identity=roster-nogrant/);
    assert.deepEqual(cli.lines, []);
    assert.deepEqual(readdirSync(probe), []);
  } finally { await cli.close(); rmSync(probe, { recursive: true, force: true }); }
});

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
    // Removed approval command only displays the fixed help; it cannot write facts.
    await new Promise(resolve => setTimeout(resolve, 50));
    cli.child.stdin.write('quit\n');
    const stopped = JSON.parse(await cli.waitFor(line => line.includes('"status":"STOPPED"'))) as { reason: string; hostDataRemoved: boolean; desktopProfileRetained: string };
    assert.equal(stopped.reason, 'requested'); assert.equal(stopped.hostDataRemoved, true);
    assert.equal(stopped.desktopProfileRetained, ready.desktopProfile);
    assert.deepEqual(await cli.exit, [0, null]);
    assert.equal(cli.stderr(), '');
    assert.ok(cli.lines.filter(line => line.startsWith('固定命令：')).length >= 2);
    assert.ok(cli.lines.filter(line => line.startsWith('固定命令：')).every(line => !line.includes('approve')));
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
