import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createHttp } from 'node:http';
import { createServer as createNet } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { OPS_DIAGNOSTIC_CODES } from './ops-diagnostic-codes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const alert = path.join(here, 'send-ops-alert.sh');
const backup = path.join(here, 'customer-agent-backup.sh');
const diagnostics = path.resolve(here, '../../apps/api/src/runtime-diagnostics.ts');

chmodSync(alert, 0o755);

function listen() {
  const bodies = [];
  const server = createHttp((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      bodies.push(body);
      response.end('ok');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('no port');
      resolve({ server, bodies, port: address.port });
    });
  });
}

test('the ops codes stay out of the API diagnostic list', () => {
  assert.deepEqual(OPS_DIAGNOSTIC_CODES, ['LEASE_REFRESH_FAILED', 'BACKUP_FAILED']);
  const source = readFileSync(diagnostics, 'utf8');
  assert.equal(source.includes('LEASE_REFRESH_FAILED'), false);
  assert.equal(source.includes('BACKUP_FAILED'), false);
});

test('an unknown code does not post', () => {
  const result = spawnSync(alert, ['NOT_A_CODE'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});

test('backup failure posts BACKUP_FAILED and a missing webhook does not connect', async () => {
  const hook = await listen();
  try {
    const posted = spawnSync('bash', [backup], {
      encoding: 'utf8',
      env: {
        ...process.env,
        FEISHU_ALERT_WEBHOOK: `http://127.0.0.1:${String(hook.port)}/hook`,
        CUSTOMER_AGENT_BACKUP_KEEP: '0',
        CUSTOMER_AGENT_MONITOR_ENV: path.join(tmpdir(), 'missing-monitor.env'),
      },
    });
    assert.equal(posted.status, 1);
    assert.match(posted.stdout + posted.stderr, /diagnostic=BACKUP_FAILED/);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(hook.bodies.length, 1);
    assert.deepEqual(JSON.parse(hook.bodies[0]), { diagnostic: 'BACKUP_FAILED', text: 'backup failed' });

    hook.bodies.length = 0;
    const quiet = spawnSync('bash', [backup], {
      encoding: 'utf8',
      env: {
        ...process.env,
        FEISHU_ALERT_WEBHOOK: '',
        CUSTOMER_AGENT_BACKUP_KEEP: '0',
        CUSTOMER_AGENT_MONITOR_ENV: path.join(tmpdir(), 'missing-monitor.env'),
      },
    });
    assert.equal(quiet.status, 1);
    assert.match(quiet.stdout + quiet.stderr, /diagnostic=BACKUP_FAILED/);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(hook.bodies.length, 0);
  } finally {
    hook.server.close();
  }
});

test('an unconfigured offsite copy exits 3 and does not post', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'backup-exit3-'));
  const bin = path.join(root, 'bin');
  const socketDir = path.join(root, 'socket');
  mkdirSync(bin);
  mkdirSync(socketDir);
  writeFileSync(path.join(bin, 'pg_dump'), `#!/bin/sh
while [ $# -gt 0 ]; do
  if [ "$1" = "-f" ]; then printf PGDMP > "$2"; exit 0; fi
  shift
done
exit 1
`);
  chmodSync(path.join(bin, 'pg_dump'), 0o755);
  const socket = path.join(socketDir, '.s.PGSQL.43199');
  const server = createNet();
  await new Promise((resolve) => server.listen(socket, resolve));
  const hook = await listen();
  try {
    const result = spawnSync('bash', [backup], {
      encoding: 'utf8',
      env: {
        ...process.env,
        FEISHU_ALERT_WEBHOOK: `http://127.0.0.1:${String(hook.port)}/hook`,
        CUSTOMER_AGENT_BACKUP_KEEP: '14',
        CUSTOMER_AGENT_BACKUP_DATABASE: 'synth',
        CUSTOMER_AGENT_BACKUP_ROOT: path.join(root, 'backups'),
        CUSTOMER_AGENT_PG15_BIN: bin,
        CUSTOMER_AGENT_BACKUP_SOCKET: socketDir,
        CUSTOMER_AGENT_BACKUP_COPY_TO: '',
        CUSTOMER_AGENT_MONITOR_ENV: path.join(tmpdir(), 'missing-monitor.env'),
      },
    });
    assert.equal(result.status, 3, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /offsite copy: NOT CONFIGURED/);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(hook.bodies.length, 0);
  } finally {
    server.close();
    hook.server.close();
  }
});
