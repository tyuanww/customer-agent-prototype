import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { connect, createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
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

async function waitForListenerClose(address, {
  connectSocket = connect,
  timeoutMs = 5_000,
  now = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const { hostname, port } = new URL(address);
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const open = await new Promise((resolve, reject) => {
      const socket = connectSocket({ host: hostname, port: Number(port) });
      socket.setTimeout(500);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', (error) => {
        if (error.code === 'ECONNREFUSED') resolve(false);
        else if (error.code === 'ECONNRESET') resolve(true);
        else reject(error);
      });
      socket.once('timeout', () => { socket.destroy(); resolve(true); });
    });
    if (!open) return;
    await wait(50);
  }
  throw new Error('API did not stop accepting connections');
}

function scriptedProbes(outcomes) {
  let attempts = 0;
  let elapsed = 0;
  return {
    options: {
      now: () => elapsed,
      wait: async (ms) => { elapsed += ms; },
      connectSocket() {
        const socket = new EventEmitter();
        socket.setTimeout = () => socket;
        socket.destroy = () => socket;
        const outcome = outcomes[Math.min(attempts, outcomes.length - 1)];
        attempts += 1;
        queueMicrotask(() => {
          if (outcome === 'timeout') socket.emit('timeout');
          else if (outcome === 'connected') socket.emit('connect');
          else socket.emit('error', Object.assign(new Error(outcome), { code: outcome }));
        });
        return socket;
      },
    },
    attempts: () => attempts,
  };
}

for (const transient of ['ECONNRESET', 'timeout']) {
  test(`listener close probe retries ${transient} until refusal`, async () => {
    const probes = scriptedProbes([transient, 'ECONNREFUSED']);
    await waitForListenerClose('http://127.0.0.1:12345', { ...probes.options, timeoutMs: 150 });
    assert.equal(probes.attempts(), 2);
  });
}

for (const outcome of ['ECONNRESET', 'timeout', 'connected']) {
  test(`listener close probe rejects persistent ${outcome}`, async () => {
    const probes = scriptedProbes([outcome]);
    await assert.rejects(
      waitForListenerClose('http://127.0.0.1:12345', { ...probes.options, timeoutMs: 150 }),
      /API did not stop accepting connections/,
    );
    assert.ok(probes.attempts() >= 2);
  });
}

test('listener close probe rejects unexpected errors', async () => {
  const probes = scriptedProbes(['EACCES']);
  await assert.rejects(
    waitForListenerClose('http://127.0.0.1:12345', { ...probes.options, timeoutMs: 150 }),
    { code: 'EACCES' },
  );
  assert.equal(probes.attempts(), 1);
});

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

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`compiled content worker handles repeated ${signal} while connecting`, {
    timeout: 35_000,
    skip: process.platform === 'win32' ? 'Windows does not deliver Unix signals to child processes' : false,
  }, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'content-worker-signal-'));
    const observer = path.join(directory, 'signal-observer.mjs');
    const connections = new Set();
    const server = createServer((connection) => { connections.add(connection); });
    let serverError;
    server.on('error', (error) => { serverError = error; });
    let child;
    let socket;
    let exited;
    try {
      await writeFile(observer, `process.once(${JSON.stringify(signal)}, () => process.stdout.write('signal-observed\\n'));\n`);
      const listening = once(server, 'listening');
      server.listen(0, '127.0.0.1');
      await waitWithin(listening, 'synthetic database listener');
      const connected = new Promise((resolve) => server.once('connection', (connection) => resolve([connection])));
      const serverFailure = new Promise((resolve) => server.once('error', resolve));
      const port = server.address().port;
      const db = (user) => `postgresql://${user}@127.0.0.1:${port}/synthetic`;
      child = spawn(process.execPath, ['--import', observer, 'dist/content-worker-main.js'], {
        cwd: apiDirectory,
        env: {
          PATH: process.env.PATH,
          CUSTOMER_AGENT_PROFILE: 'test',
          AUTH_MODE: 'mock',
          DATABASE_URL: db('runtime'),
          CONTENT_ADMIN_DATABASE_URL: db('admin'),
          CONTENT_WORKER_DATABASE_URL: db('worker'),
          CONTENT_OBJECT_STORE_DIR: directory,
          DB_CONNECTION_TIMEOUT_MS: '10000',
          IDEMPOTENCY_HMAC_KEYS: JSON.stringify({ 'hmac-idempotency-v1': 'synthetic-idempotency-material-main' }),
          IDEMPOTENCY_HMAC_CURRENT_VERSION: 'hmac-idempotency-v1',
          LOG_HASH_KEY: 'synthetic-log-hash-material-main-01',
          LOG_HASH_KEY_VERSION: 'hmac-log-v1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      let errors = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { errors += chunk; });
      const observed = new Promise((resolve) => {
        child.stdout.on('data', (chunk) => {
          output += chunk;
          if (output.includes('signal-observed\n')) resolve();
        });
      });
      exited = once(child, 'exit');
      const earlyFailure = exited.then(([code, exitSignal]) => {
        throw new Error(`Worker exited early: code=${String(code)} signal=${String(exitSignal)} stderr=${errors}`);
      });
      const failedServer = serverFailure.then((error) => { throw error; });
      [socket] = await waitWithin(Promise.race([connected, earlyFailure, failedServer]), 'worker connection', 15_000);
      assert.equal(child.kill(signal), true);
      await waitWithin(Promise.race([observed, earlyFailure, failedServer]), 'first signal', 15_000);
      assert.equal(child.kill(signal), true);
      const earlyExit = await Promise.race([
        exited.then(([code, exitSignal]) => ({ code, signal: exitSignal })),
        new Promise((resolve) => setTimeout(() => resolve(null), 500)),
      ]);
      assert.equal(earlyExit, null, 'repeated signal interrupted the worker');
      socket.destroy();
      const [code, exitSignal] = await waitWithin(exited, 'worker exit', 15_000);
      assert.equal(code, 0);
      assert.equal(exitSignal, null);
      assert.equal(serverError, undefined);
    } finally {
      for (const connection of connections) connection.destroy();
      try {
        if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        if (exited) await waitWithin(exited, 'worker cleanup', 15_000);
      } finally {
        try {
          if (server.listening) {
            await waitWithin(new Promise((resolve, reject) => {
              server.close((error) => { if (error) reject(error); else resolve(); });
            }), 'listener cleanup', 15_000);
          }
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      }
    }
  });
}
