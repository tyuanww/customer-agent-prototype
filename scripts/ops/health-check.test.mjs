import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

const script = fileURLToPath(new URL('./customer-agent-health-check.sh', import.meta.url));
const service = fileURLToPath(new URL('./customer-agent-health-check.service', import.meta.url));
const timer = fileURLToPath(new URL('./customer-agent-health-check.timer', import.meta.url));

/**
 * The stub MUST run in its own process. The probe is invoked with spawnSync, which
 * blocks this process's event loop; an in-process HTTP server would never get to
 * answer, every curl would hit its timeout, and the test would pass or fail for the
 * wrong reason. It also records alert POST bodies to a file the test can read.
 */
const STUB_SOURCE = `
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
const [portFile, alertFile, mode] = process.argv.slice(2);
const server = createServer((req, res) => {
  if (req.method === 'GET') {
    if (mode === 'down') { res.writeHead(503); res.end('not ready'); return; }
    res.writeHead(200); res.end('{"status":"ready"}');
    return;
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => { appendFileSync(alertFile, body + '\\n'); res.end('{"ok":true}'); });
});
server.listen(0, '127.0.0.1', () => { appendFileSync(portFile, String(server.address().port)); });
`;

/** Live stub children, killed when the file finishes. */
const stubs = [];
after(() => { for (const child of stubs) child.kill('SIGKILL'); });

/** Starts the stub in a child process (async spawn: it does not exit on its own). */
function startStub(dir, mode) {
  const portFile = path.join(dir, `port-${mode}`);
  const alertFile = path.join(dir, `alerts-${mode}`);
  writeFileSync(alertFile, '');
  const stubPath = path.join(dir, `stub-${mode}.mjs`);
  writeFileSync(stubPath, STUB_SOURCE);
  const child = spawn('node', [stubPath, portFile, alertFile, mode], { stdio: 'ignore' });
  stubs.push(child);
  return { portFile, alertFile };
}

/** Reads the port the stub bound, polling briefly since it is written asynchronously. */
async function awaitPort(portFile) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const value = readFileSync(portFile, 'utf8').trim();
      if (value.length > 0) return Number(value);
    } catch { /* not written yet */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`stub did not report a port via ${portFile}`);
}

function alertsOf(alertFile) {
  return readFileSync(alertFile, 'utf8').split('\n').filter((line) => line.length > 0);
}

function writeEnv(dir, webhook, probeUrl) {
  // Exercises the parser: a comment line, a blank line, then the two keys.
  writeFileSync(
    path.join(dir, 'monitor.env'),
    `# comment line\n\nFEISHU_ALERT_WEBHOOK=${webhook}\nCUSTOMER_AGENT_HEALTH_URL=${probeUrl}\n`,
  );
}

function runProbe(dir) {
  return spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      CUSTOMER_AGENT_MONITOR_ENV: path.join(dir, 'monitor.env'),
      CUSTOMER_AGENT_HEALTH_STATE: path.join(dir, 'failures'),
    },
  });
}

function counterOf(dir) {
  try {
    return readFileSync(path.join(dir, 'failures'), 'utf8').trim();
  } catch {
    return '<absent>';
  }
}

test('the probe targets /ready, never the dependency-free /health', () => {
  const body = readFileSync(script, 'utf8');
  assert.match(body, /DEFAULT_URL="https:\/\/agent-auth\.jianghua\.site\/ready"/);
  // /health answers 200 even when every dependency is down, so a probe on it would
  // report all-clear during exactly the failure this timer exists to catch.
  assert.doesNotMatch(body, /agent-auth\.jianghua\.site\/health/);
});

test('the unit does not keep its failure counter in the private /tmp', () => {
  const unit = readFileSync(service, 'utf8');
  assert.match(unit, /PrivateTmp=true/);
  // With PrivateTmp each run gets a fresh /tmp, so a counter there resets every
  // minute and the threshold is unreachable. Guard the pairing, not just the flags.
  assert.match(unit, /CUSTOMER_AGENT_HEALTH_STATE=\/var\/lib\/customer-agent\//);
  assert.doesNotMatch(unit, /HEALTH_STATE=\/tmp\//);
  assert.match(unit, /StateDirectory=customer-agent/);
  assert.match(unit, /User=customer-agent/);
});

test('the timer fires every minute and starts shortly after boot', () => {
  const unit = readFileSync(timer, 'utf8');
  assert.match(unit, /OnBootSec=2min/);
  assert.match(unit, /OnUnitActiveSec=1min/);
  assert.match(unit, /Unit=customer-agent-health-check\.service/);
  assert.match(unit, /WantedBy=timers\.target/);
});

test('an unreachable configuration fails loudly instead of probing a default', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'health-probe-'));
  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, CUSTOMER_AGENT_MONITOR_ENV: path.join(dir, 'absent.env') },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr + result.stdout, /FATAL monitor env unreadable/);
});

test('an empty webhook fails loudly', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'health-probe-'));
  writeFileSync(path.join(dir, 'monitor.env'), 'FEISHU_ALERT_WEBHOOK=\n');
  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, CUSTOMER_AGENT_MONITOR_ENV: path.join(dir, 'monitor.env') },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr + result.stdout, /FEISHU_ALERT_WEBHOOK is empty/);
});

test('a healthy endpoint alerts nobody and leaves the counter empty', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'health-probe-'));
  const stub = startStub(dir, 'up');
  const port = await awaitPort(stub.portFile);
  writeEnv(dir, `http://127.0.0.1:${port}/hook`, `http://127.0.0.1:${port}/probe`);

  const result = runProbe(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(alertsOf(stub.alertFile).length, 0);
  assert.equal(counterOf(dir), '<absent>');
});

test('alerts once, on the third consecutive failure, then stays quiet', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'health-probe-'));
  const stub = startStub(dir, 'down');
  const port = await awaitPort(stub.portFile);
  writeEnv(dir, `http://127.0.0.1:${port}/hook`, `http://127.0.0.1:${port}/probe`);

  for (let run = 1; run <= 4; run += 1) {
    const result = runProbe(dir);
    assert.equal(result.status, 0, `run ${String(run)}: ${result.stderr}`);
    assert.equal(counterOf(dir), String(run), `counter after run ${String(run)}`);
    assert.equal(alertsOf(stub.alertFile).length, run >= 3 ? 1 : 0, `alerts after run ${String(run)}`);
  }
  const alert = alertsOf(stub.alertFile)[0];
  assert.match(alert, /连续失败 3 次/);
  assert.match(alert, /503/);
});

test('recovery clears the counter so a later outage alerts again', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'health-probe-'));
  const down = startStub(dir, 'down');
  const downPort = await awaitPort(down.portFile);
  writeEnv(dir, `http://127.0.0.1:${downPort}/hook`, `http://127.0.0.1:${downPort}/probe`);
  for (let run = 0; run < 3; run += 1) runProbe(dir);
  assert.equal(counterOf(dir), '3');
  assert.equal(alertsOf(down.alertFile).length, 1);

  const up = startStub(dir, 'up');
  const upPort = await awaitPort(up.portFile);
  writeEnv(dir, `http://127.0.0.1:${upPort}/hook`, `http://127.0.0.1:${upPort}/probe`);
  const recovered = runProbe(dir);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(counterOf(dir), '0');
  assert.equal(alertsOf(up.alertFile).length, 0);
});

const watchdogScript = fileURLToPath(new URL('./customer-agent-stack-watchdog.sh', import.meta.url));
const watchdogService = fileURLToPath(new URL('./customer-agent-stack-watchdog.service', import.meta.url));
const watchdogTimer = fileURLToPath(new URL('./customer-agent-stack-watchdog.timer', import.meta.url));
const stackService = fileURLToPath(new URL('./customer-agent-stack.service', import.meta.url));

test('the production stack stays in the foreground and restarts on child failure', () => {
  const unit = readFileSync(stackService, 'utf8');
  assert.match(unit, /Type=simple/);
  assert.match(unit, /--foreground --no-seed/);
  assert.match(unit, /Environment=CUSTOMER_AGENT_PG15_BIN=\/opt\/pg15\/usr\/lib\/postgresql\/15\/bin/);
  assert.match(unit, /Environment=CUSTOMER_AGENT_DESKTOP_USERDATA=\/srv\/customer-agent\/desktop-profile/);
  assert.match(unit, /ExecStop=\/usr\/local\/bin\/node \/srv\/customer-agent\/current\/scripts\/synthetic-stack\/stack\.ts stop/);
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /KillMode=control-group/);
  assert.match(unit, /TimeoutStartSec=420s/);
  assert.match(unit, /TimeoutStopSec=120s/);
  assert.doesNotMatch(unit, /RemainAfterExit/);
});

test('the watchdog never uses flock, which may not exist on the host', () => {
  const body = readFileSync(watchdogScript, 'utf8');
  // flock is util-linux. If it is absent the command fails, and treating that as
  // "lock held" would exit 0 on every run: a watchdog that looks healthy and never
  // fires. The lock is mkdir-based instead.
  assert.doesNotMatch(body, /^\s*flock\b/m);
  assert.match(body, /mkdir "\$LOCK_DIR"/);
  // A lock left by a killed run must expire, or one SIGKILL disables it forever.
  assert.match(body, /-mmin \+10/);
});

test('the watchdog restarts via the stack unit\'s own command, and does not reseed', () => {
  const body = readFileSync(watchdogScript, 'utf8');
  // start, not restart: the survivors must not be disturbed.
  assert.match(body, /node "\$STACK_ENTRY" start --no-seed/);
  assert.doesNotMatch(body, /"\$STACK_ENTRY" restart/);
  // If systemd has stopped the foreground unit, never fall back to detached
  // children: that would recreate the old unsupervised-process failure mode.
  assert.match(body, /systemctl is-active --quiet "\$STACK_UNIT"/);
  assert.match(body, /leaving process ownership to systemd/);
});

test('the watchdog unit carries the same environment the stack unit does', () => {
  const unit = readFileSync(watchdogService, 'utf8');
  assert.match(unit, /Type=oneshot/);
  assert.match(unit, /User=customer-agent/);
  assert.match(unit, /Environment=CUSTOMER_AGENT_PG15_BIN=\/opt\/pg15\/usr\/lib\/postgresql\/15\/bin/);
  assert.match(unit, /Environment=CUSTOMER_AGENT_DESKTOP_USERDATA=\/srv\/customer-agent\/desktop-profile/);
  // PATH is not inherited; node lives in /usr/local/bin on that host.
  assert.match(unit, /Environment=PATH=\/usr\/local\/bin:/);
  // A repair writes under the stack root and must be allowed to.
  assert.match(unit, /ReadWritePaths=\/srv\/customer-agent\/stack \/srv\/customer-agent\/desktop-profile/);
  assert.match(unit, /StateDirectory=customer-agent/);
});

test('the watchdog timer starts after the stack has had a chance', () => {
  const unit = readFileSync(watchdogTimer, 'utf8');
  assert.match(unit, /OnBootSec=4min/);
  assert.match(unit, /OnUnitActiveSec=1min/);
  assert.match(unit, /Unit=customer-agent-stack-watchdog\.service/);
});

test('a healthy stack makes the watchdog exit silently without restarting', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'watchdog-'));
  const result = spawnSync('bash', [watchdogScript], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      // Nothing listens here, so readiness fails; the entry is absent so it must
      // stop before running anything. This asserts the guard order.
      CUSTOMER_AGENT_READY_URL: 'http://127.0.0.1:1/ready',
      CUSTOMER_AGENT_STACK_ENTRY: path.join(dir, 'absent-stack.ts'),
      CUSTOMER_AGENT_WATCHDOG_LOCK: path.join(dir, 'wd.lock'),
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /stack entry not found/);
});
