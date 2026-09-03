import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const apiDirectory = fileURLToPath(new URL('..', import.meta.url));

function waitForListeningAddress(child, output, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      reject(new Error(`Timed out waiting for API startup. stdout=${output.stdout} stderr=${output.stderr}`));
    }, timeoutMs);
    deadline.unref?.();

    const inspect = () => {
      const match = output.stdout.match(/\[api\] listening at (http:\/\/127\.0\.0\.1:\d+)/);
      if (!match) return;
      clearTimeout(deadline);
      cleanup();
      resolve(match[1]);
    };
    const exited = (code, signal) => {
      clearTimeout(deadline);
      cleanup();
      reject(new Error(`API exited before startup. code=${String(code)} signal=${String(signal)} stdout=${output.stdout} stderr=${output.stderr}`));
    };
    const cleanup = () => {
      child.stdout.off('data', inspect);
      child.off('exit', exited);
    };

    child.stdout.on('data', inspect);
    child.once('exit', exited);
    inspect();
  });
}

test('compiled main entry starts, serves both probes, and closes on SIGINT', async () => {
  const output = { stdout: '', stderr: '' };
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: apiDirectory,
    env: {
      PATH: process.env.PATH,
      CUSTOMER_AGENT_PROFILE: 'test',
      AUTH_MODE: 'mock',
      CUSTOMER_AGENT_API_PORT: '0',
      CUSTOMER_AGENT_BUILD_VERSION: '0.3.0-m1-main',
      DATABASE_URL: 'postgresql://w5_main@127.0.0.1:1/w5_main',
      CONTENT_ADMIN_DATABASE_URL: 'postgresql://w1b_admin@127.0.0.1:1/w5_main',
      IDEMPOTENCY_HMAC_KEYS: JSON.stringify({
        'hmac-idempotency-v1': 'synthetic-idempotency-material-main',
      }),
      IDEMPOTENCY_HMAC_CURRENT_VERSION: 'hmac-idempotency-v1',
      LOG_HASH_KEY: 'synthetic-log-hash-material-main-01',
      LOG_HASH_KEY_VERSION: 'hmac-log-v1',
      DB_CONNECTION_TIMEOUT_MS: '100',
      DB_READINESS_TIMEOUT_MS: '100',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output.stdout += chunk; });
  child.stderr.on('data', (chunk) => { output.stderr += chunk; });

  try {
    const address = await waitForListeningAddress(child, output);
    const health = await fetch(`${address}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: 'ok',
      service: 'cs-ai-api',
      version: '0.3.0-m1-main',
    });

    const readiness = await fetch(`${address}/ready`);
    assert.equal(readiness.status, 503);
    assert.deepEqual(await readiness.json(), {
      status: 'not_ready',
      checks: {
        database: 'not_ready',
        schema: 'not_ready',
        auth: 'ok',
        storage: 'not_ready',
        content: 'not_ready',
      },
    });

    child.kill('SIGINT');
    const [code, signal] = await once(child, 'exit');
    assert.equal(code, 0);
    assert.equal(signal, null);
    assert.match(output.stdout, /\[api\] closed after SIGINT/);
    assert.equal(output.stderr, '[api] diagnostic=DATABASE_READINESS_PROBE_FAILED\n');
    assert.doesNotMatch(output.stderr, /w5_main|postgresql:\/\//);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

test('compiled main rejects missing private capability configuration before listening', async () => {
  const output = { stdout: '', stderr: '' };
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: apiDirectory,
    env: {
      PATH: process.env.PATH,
      CUSTOMER_AGENT_PROFILE: 'test',
      AUTH_MODE: 'mock',
      CUSTOMER_AGENT_API_PORT: '0',
      DATABASE_URL: 'postgresql://w5_main@127.0.0.1:1/w5_main',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output.stdout += chunk; });
  child.stderr.on('data', (chunk) => { output.stderr += chunk; });

  const [code, signal] = await once(child, 'exit');
  assert.equal(code, 1);
  assert.equal(signal, null);
  assert.equal(output.stdout, '');
  assert.match(output.stderr, /\[CONFIG_INVALID\]/);
  assert.match(output.stderr, /CONTENT_ADMIN_DATABASE_URL:missing/);
  assert.match(output.stderr, /IDEMPOTENCY_HMAC_KEYS:missing/);
  assert.match(output.stderr, /LOG_HASH_KEY:missing/);
  assert.doesNotMatch(output.stderr, /postgresql:\/\//);
});
