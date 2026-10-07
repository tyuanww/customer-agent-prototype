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
const quality = context.qualityKey !== undefined;
const managementContext = context.managementContext === true;
assert.ok(context.managementContext === undefined || managementContext);
if (managementContext) assert.match(context.objectId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const principals = context.principals === true;
assert.ok(context.principals === undefined || principals);
assert.ok([managementContext, principals, quality, capacity].filter(Boolean).length <= 1);
if (quality) {
  assert.equal(capacity, false);
  assert.match(context.qualityKey.candidateId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
  assert.ok(Number.isSafeInteger(context.qualityKey.version) && context.qualityKey.version > 0);
  assert.match(context.qualityKey.digest, /^[0-9a-f]{64}$/);
}
const desktop = fileURLToPath(new URL('../apps/desktop/', import.meta.url));
const require = createRequire(join(desktop, 'package.json'));
const cli = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
let probe = { file: 'tests/unit/content-intake-usage-http.test.ts', marker: 'INTAKE_USAGE_HTTP_PASS',
  result: { status: 'PASS', actualSession: true, discovery: true, largePage: true, cancellation: true,
    publishedText: true, localExpiry: true, normalUpdate: true, revocationFanout: true } };
if (managementContext) probe = { file: 'tests/unit/content-intake-management-context-http.test.ts', marker: 'INTAKE_MANAGEMENT_CONTEXT_HTTP_PASS',
  result: { status: 'PASS', actualSession: true, managementContext: true, receive: true, cancellation: true, logoutLateResponse: true } };
else if (principals) probe = { file: 'tests/unit/content-intake-principals-http.test.ts', marker: 'INTAKE_PRINCIPALS_HTTP_PASS',
  result: { status: 'PASS', actualSession: true, principals: true, pagination: true, cancellation: true, logoutLateResponse: true } };
else if (quality) probe = { file: 'tests/unit/content-intake-quality-http.test.ts', marker: 'INTAKE_QUALITY_HTTP_PASS',
  result: { status: 'PASS', actualSession: true, quality: true, unknownCommitRecovery: true } };
else if (capacity) probe = { file: 'tests/unit/content-intake-usage-http.test.ts', marker: 'INTAKE_DISCOVERY_CAPACITY_PASS',
  result: { status: 'PASS', actualSession: true, discovery: true, sourceCount: context.discoverySources } };
const child = spawn(process.execPath, [cli, 'run', '--pool=threads', probe.file], {
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
  if (code !== 0 || overflow || !output.includes(probe.marker)) {
    // Fixture diagnostics only, but defensively strip its token before printing.
    process.stderr.write(output.replaceAll(context.token, '[credential]'));
    throw new Error('INTAKE_USAGE_HTTP_PROBE_FAILED');
  }
  console.log(JSON.stringify(probe.result));
} finally {
  clearTimeout(deadline); process.off('SIGTERM', stop); process.off('SIGINT', stop);
  if (child.exitCode === null) child.kill('SIGKILL');
}
