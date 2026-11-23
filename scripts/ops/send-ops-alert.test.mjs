import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttp } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';
import { OPS_DIAGNOSTIC_CODES } from './ops-diagnostic-codes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const alert = path.join(here, 'send-ops-alert.sh');
const backup = path.join(here, 'customer-agent-backup.sh');
const diagnostics = path.resolve(here, '../../apps/api/src/runtime-diagnostics.ts');
const runFile = promisify(execFile);

function listen(statusCode = 200, body = '{"code":0}') {
  const bodies = [];
  const server = createHttp((request, response) => {
    let received = '';
    request.on('data', (chunk) => { received += chunk; });
    request.on('end', () => {
      bodies.push(received);
      response.statusCode = statusCode;
      response.end(body);
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

test('a rejected webhook is reported without logging delivery or the receiver response', async () => {
  const hook = await listen(429);
  try {
    const result = await runFile(alert, ['BACKUP_FAILED'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        FEISHU_ALERT_WEBHOOK: `http://127.0.0.1:${String(hook.port)}/hook`,
      },
    }).catch(error => error);
    assert.equal(result.code, 1);
    assert.deepEqual(hook.bodies.map(body => JSON.parse(body)), [{ msg_type: 'text', content: { text: '[customer-agent] BACKUP_FAILED' } }]);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /WARN alert delivery failed.*429/);
    assert.doesNotMatch(result.stderr, /127\.0\.0\.1|\bok\b/);
  } finally {
    hook.server.close();
  }
});

test('an HTTP success with a Feishu rejection is not marked as delivered', async () => {
  const hook = await listen(200, '{"code":9499,"msg":"private receiver response"}');
  try {
    const result = await runFile(alert, ['BACKUP_FAILED'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        FEISHU_ALERT_WEBHOOK: `http://127.0.0.1:${String(hook.port)}/hook`,
      },
    }).catch(error => error);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /WARN alert delivery failed.*200/);
    assert.doesNotMatch(result.stderr, /private receiver response/);
  } finally {
    hook.server.close();
  }
});

test('backup failure posts BACKUP_FAILED and a missing webhook does not connect', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'backup-alert-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    PATH: process.env.PATH,
    CUSTOMER_AGENT_STACK_ROOT: path.join(root, 'missing-stack'),
    CUSTOMER_AGENT_MONITOR_ENV: path.join(root, 'missing-monitor.env'),
  };
  const hook = await listen();
  try {
    const posted = await runFile('bash', [backup], {
      encoding: 'utf8',
      env: {
        ...env,
        FEISHU_ALERT_WEBHOOK: `http://127.0.0.1:${String(hook.port)}/hook`,
      },
    }).catch(error => error);
    assert.equal(posted.code, 1);
    assert.match(posted.stdout, /alert sent diagnostic=BACKUP_FAILED/);
    assert.equal(hook.bodies.length, 1);
    assert.deepEqual(JSON.parse(hook.bodies[0]), { msg_type: 'text', content: { text: '[customer-agent] BACKUP_FAILED' } });

    hook.bodies.length = 0;
    const quiet = await runFile('bash', [backup], {
      encoding: 'utf8',
      env: {
        ...env,
        FEISHU_ALERT_WEBHOOK: '',
      },
    }).catch(error => error);
    assert.equal(quiet.code, 1);
    assert.match(quiet.stderr, /FATAL PROFILE_INVALID/);
    assert.equal(hook.bodies.length, 0);
  } finally {
    hook.server.close();
  }
});

test('the backup wrapper preserves degraded exit 3 without posting an alert', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'backup-exit3-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const wrapper = path.join(root, 'customer-agent-backup.sh');
  copyFileSync(backup, wrapper);
  copyFileSync(alert, path.join(root, 'send-ops-alert.sh'));
  writeFileSync(path.join(root, 'backup-set.mjs'), 'process.exitCode = 3;\n');
  const hook = await listen();
  try {
    const result = await runFile('bash', [wrapper], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        FEISHU_ALERT_WEBHOOK: `http://127.0.0.1:${String(hook.port)}/hook`,
      },
    }).catch(error => error);
    assert.equal(result.code, 3, result.stdout + result.stderr);
    assert.equal(hook.bodies.length, 0);
  } finally {
    hook.server.close();
  }
});
