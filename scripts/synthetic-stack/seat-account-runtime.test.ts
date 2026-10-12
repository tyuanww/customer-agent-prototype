import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const script = fileURLToPath(new URL('./seat-account-runtime.ts', import.meta.url));
const live = path.join(process.env.HOME ?? '', '.customer-agent-synthetic-stack', 'password-accounts.json');

function run(payload: string) {
  return spawnSync(process.execPath, [script], { input: payload, encoding: 'utf8', timeout: 10000 });
}

describe('seat account runtime', () => {
  it('rejects an invalid intent without writing the password file', () => {
    const before = existsSync(live) ? statSync(live) : null;
    const result = run('{"action":"nope"}');
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), { ok: false, message: '账号输入无效。' });
    if (before) {
      const after = statSync(live);
      assert.equal(after.mtimeMs, before.mtimeMs);
      assert.equal(after.size, before.size);
    }
  });
});
