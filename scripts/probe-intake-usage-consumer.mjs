// Root-owned bridge: API tests may not import desktop source. Run the existing
// desktop test runtime against a loopback-only fixture. Credentials exist only
// in stdin/process memory (never argv or a file), and no user profile is read.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let input = '';
for await (const chunk of process.stdin) {
  input += String(chunk);
  if (input.length > 4096) throw new Error('PROBE_INPUT_LIMIT');
}
const context = JSON.parse(input);
assert.match(context.origin, /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
assert.match(context.token, /^[A-Za-z0-9_-]{43}$/);
assert.equal(typeof context.releaseId, 'string');
assert.ok(Number.isFinite(Date.parse(context.expiresAt)));
const capacity = context.discoverySources === 5000;
assert.ok(context.discoverySources === undefined || capacity);
const desktop = fileURLToPath(new URL('../apps/desktop/', import.meta.url));
const require = createRequire(join(desktop, 'package.json'));
const cli = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const child = spawn(process.execPath, [cli, 'run', '--pool=threads', 'tests/unit/content-intake-usage-http.test.ts'], {
  cwd: desktop, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, CUSTOMER_AGENT_INTAKE_HTTP_PROBE: input },
});
let output = '', overflow = false;
const collect = chunk => {
  if (overflow) return;
  output += String(chunk);
  if (output.length > 1_048_576) { overflow = true; child.kill('SIGKILL'); }
};
child.stdout.on('data', collect); child.stderr.on('data', collect);
const stop = () => child.kill('SIGKILL');
process.once('SIGTERM', stop); process.once('SIGINT', stop);
const deadline = setTimeout(stop, capacity ? 110_000 : 40_000);
try {
  const [code] = await once(child, 'close');
  const marker = capacity ? 'INTAKE_DISCOVERY_CAPACITY_PASS' : 'INTAKE_USAGE_HTTP_PASS';
  if (code !== 0 || overflow || !output.includes(marker)) {
    // Fixture diagnostics only, but defensively strip its token before printing.
    process.stderr.write(output.replaceAll(context.token, '[credential]'));
    throw new Error('INTAKE_USAGE_HTTP_PROBE_FAILED');
  }
  console.log(JSON.stringify(capacity
    ? { status: 'PASS', actualSession: true, discovery: true, sourceCount: context.discoverySources }
    : { status: 'PASS', actualSession: true, discovery: true, largePage: true, cancellation: true,
      publishedText: true, localExpiry: true, normalUpdate: true, revocationFanout: true }));
} finally {
  clearTimeout(deadline); process.off('SIGTERM', stop); process.off('SIGINT', stop);
  if (child.exitCode === null) child.kill('SIGKILL');
}
