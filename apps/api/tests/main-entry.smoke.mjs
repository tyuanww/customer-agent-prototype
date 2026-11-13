import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
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

async function waitWithin(promise, label, timeoutMs = 5_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForListenerClose(address) {
  const { hostname, port } = new URL(address);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const open = await new Promise((resolve, reject) => {
      const socket = connect({ host: hostname, port: Number(port) });
      socket.setTimeout(500);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', (error) => {
        if (error.code === 'ECONNREFUSED') resolve(false);
        else reject(error);
      });
      socket.once('timeout', () => { socket.destroy(); reject(new Error('Connection probe timed out')); });
    });
    if (!open) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('API did not stop accepting connections');
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

    const diagnosticStartedAt = Date.now();
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
    const diagnostic = output.stderr.match(/^\[api\] diagnostic=DATABASE_READINESS_PROBE_FAILED at=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\n$/u);
    assert.ok(diagnostic);
    assert.equal(new Date(diagnostic[1]).toISOString(), diagnostic[1]);
    const eventAt = Date.parse(diagnostic[1]);
    assert.ok(eventAt >= diagnosticStartedAt - 5_000 && eventAt <= Date.now() + 5_000);
    assert.doesNotMatch(output.stderr, /w5_main|postgresql:\/\/|synthetic-idempotency-material-main|synthetic-log-hash-material-main-01/u);
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

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`compiled main completes an active request after repeated ${signal}`, {
    timeout: 35_000,
    skip: process.platform === 'win32' ? 'Windows does not deliver Unix signals to child processes' : false,
  }, async () => {
    const output = { stdout: '', stderr: '' };
    const child = spawn(process.execPath, ['dist/main.js'], {
      cwd: apiDirectory,
      env: {
        PATH: process.env.PATH,
        CUSTOMER_AGENT_PROFILE: 'test',
        AUTH_MODE: 'mock',
        CUSTOMER_AGENT_API_PORT: '0',
        DATABASE_URL: 'postgresql://w5_main@127.0.0.1:1/w5_main',
        CONTENT_ADMIN_DATABASE_URL: 'postgresql://w1b_admin@127.0.0.1:1/w5_main',
        IDEMPOTENCY_HMAC_KEYS: JSON.stringify({ 'hmac-idempotency-v1': 'synthetic-idempotency-material-main' }),
        IDEMPOTENCY_HMAC_CURRENT_VERSION: 'hmac-idempotency-v1',
        LOG_HASH_KEY: 'synthetic-log-hash-material-main-01',
        LOG_HASH_KEY_VERSION: 'hmac-log-v1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output.stdout += chunk; });
    child.stderr.on('data', (chunk) => { output.stderr += chunk; });
    const exited = once(child, 'exit');
    let request;
    try {
      const address = await waitForListeningAddress(child, output, 15_000);
      const body = JSON.stringify({ user_id: 'usr_drain_test', role: 'owner' });
      const response = new Promise((resolve, reject) => {
        request = httpRequest(`${address}/v1/auth/mock-login`, {
          method: 'POST', agent: false,
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        }, (reply) => {
          reply.resume();
          reply.once('end', () => resolve(reply.statusCode));
          reply.once('error', reject);
        });
        request.once('error', reject);
        request.write(body.slice(0, 12));
      });
      const settledResponse = response.then((status) => ({ status }), (error) => ({ error }));
      const [socket] = await waitWithin(once(request, 'socket'), 'request socket');
      if (socket.connecting) await waitWithin(once(socket, 'connect'), 'request connection');
      await new Promise((resolve) => setTimeout(resolve, 100));
      child.kill(signal);
      await waitForListenerClose(address);
      assert.equal(child.exitCode, null);
      assert.equal(child.signalCode, null);
      child.kill(signal);
      const earlyExit = await Promise.race([
        exited.then(([code, exitSignal]) => ({ code, signal: exitSignal })),
        new Promise((resolve) => setTimeout(() => resolve(null), 500)),
      ]);
      assert.equal(earlyExit, null, 'repeated shutdown signal interrupted the active request');
      request.end(body.slice(12));
      assert.deepEqual(await waitWithin(settledResponse, 'active request'), { status: 200 });
      const [code, exitSignal] = await waitWithin(exited, 'API exit');
      assert.equal(code, 0);
      assert.equal(exitSignal, null);
      assert.match(output.stdout, new RegExp(`\\[api\\] closed after ${signal}`));
    } finally {
      request?.destroy();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await waitWithin(exited, 'API cleanup');
    }
  });
}
