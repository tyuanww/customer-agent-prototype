import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSeatPasswordFile, seatPasswordFilePath } from '../src/content-intake/seat-password-file.js';
import { buildAccount, loadPasswordAccounts, passwordMatches, reloadPasswordAccounts } from '../../../scripts/synthetic-stack/identity-admission.js';

/**
 * The password file is read by the identity server, which owns its format. This module is a second
 * writer, and a second writer is only safe if its output is verified by the real reader. Every
 * assertion goes through `identity-admission.ts` rather than reading the JSON back directly.
 *
 * The file always carries one baseline account, because the reader refuses a file with no usable
 * account at all: an empty file makes the identity server refuse every login.
 */
describe('seat password file', () => {
  let root: string;
  let file: string;

  function startWriter(username: string): Readonly<{
    child: ChildProcess;
    ready: Promise<void>;
    done: Promise<void>;
  }> {
    const source = new URL('../src/content-intake/seat-password-file.ts', import.meta.url).href;
    const script = [
      `import { createSeatPasswordFile } from ${JSON.stringify(source)};`,
      "process.send?.('ready');",
      `await createSeatPasswordFile(${JSON.stringify(file)}).upsert(${JSON.stringify(username)}, ${JSON.stringify(`synthetic_seat_${username}`)}, 'correct horse battery');`,
    ].join('\n');
    const child = spawn(process.execPath, [
      '--experimental-strip-types', '--input-type=module', '-e', script,
    ], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
    const ready = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('message', (message) => {
        if (message === 'ready') resolve();
        else reject(new Error(`unexpected writer message: ${String(message)}`));
      });
    });
    const done = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`writer exited with ${String(code)} / ${String(signal)}: ${stderr}`));
      });
    });
    return { child, ready, done };
  }

  function holdLock(pid: number): void {
    const lock = `${file}.lock`;
    mkdirSync(lock, { mode: 0o700 });
    writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({
      token: 'test-lock-token',
      pid,
    }));
    const stale = new Date(Date.now() - 60_000);
    utimesSync(lock, stale, stale);
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'seat-password-'));
    file = seatPasswordFilePath(root);
    writeFileSync(file, `${JSON.stringify([buildAccount('synthetic_owner', 'synthetic_owner', 'baseline pass')])}\n`, { mode: 0o600 });
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('writes an entry the identity server accepts', async () => {
    await createSeatPasswordFile(file).upsert('alice', 'synthetic_seat_alice', 'correct horse battery');
    const account = loadPasswordAccounts(file).get('alice');
    expect(account, 'reader must find the account').toBeDefined();
    expect(account?.bindingId).toBe('synthetic_seat_alice');
    expect(passwordMatches(account!, 'correct horse battery')).toBe(true);
    expect(passwordMatches(account!, 'wrong password')).toBe(false);
  });

  it('replaces an existing entry rather than adding a second one', async () => {
    const store = createSeatPasswordFile(file);
    await store.upsert('alice', 'synthetic_seat_alice', 'first password');
    await store.upsert('alice', 'synthetic_seat_alice', 'second password');
    const rows = JSON.parse(readFileSync(file, 'utf8')) as { username: string }[];
    expect(rows.filter((row) => row.username === 'alice')).toHaveLength(1);
    expect(passwordMatches(loadPasswordAccounts(file).get('alice')!, 'second password')).toBe(true);
  });

  it('keeps entries this writer did not create', async () => {
    await createSeatPasswordFile(file).upsert('alice', 'synthetic_seat_alice', 'correct horse battery');
    expect([...loadPasswordAccounts(file).keys()].sort()).toEqual(['alice', 'synthetic_owner']);
  });

  it('refuses to rewrite a file holding a row it cannot read', async () => {
    // Dropping the row would silently delete an account somebody else created.
    const rows = JSON.parse(readFileSync(file, 'utf8')) as unknown[];
    writeFileSync(file, `${JSON.stringify([...rows, { username: 'odd' }])}\n`, { mode: 0o600 });
    await expect(createSeatPasswordFile(file).upsert('alice', 'synthetic_seat_alice', 'correct horse battery'))
      .rejects.toThrow(/cannot preserve/);
  });

  it('refuses primitive rows instead of dropping them', async () => {
    const rows = JSON.parse(readFileSync(file, 'utf8')) as unknown[];
    writeFileSync(file, `${JSON.stringify([...rows, null, 7, 'odd'])}\n`, { mode: 0o600 });
    const before = readFileSync(file, 'utf8');
    await expect(createSeatPasswordFile(file).upsert('alice', 'synthetic_seat_alice', 'correct horse battery'))
      .rejects.toThrow(/cannot preserve/);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('leaves a readable file behind after a refused write', async () => {
    // A truncated or half-written file makes the reader return null, which turns every seat's next
    // login into a 503, so a refusal must not touch the file at all.
    await createSeatPasswordFile(file).upsert('alice', 'synthetic_seat_alice', 'correct horse battery');
    const before = readFileSync(file, 'utf8');
    await expect(createSeatPasswordFile(file).upsert('bad name', 'synthetic_seat_bad_name', 'correct horse battery'))
      .rejects.toThrow(/not valid/);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(reloadPasswordAccounts(file)?.size).toBe(2);
  });

  it('rejects a password outside the length bound before writing', async () => {
    for (const bad of ['short', 'x'.repeat(257)]) {
      await expect(createSeatPasswordFile(file).upsert('alice', 'synthetic_seat_alice', bad))
        .rejects.toThrow(/not valid/);
    }
    expect(reloadPasswordAccounts(file)?.size).toBe(1);
  });

  it('serializes read-modify-write across processes', async () => {
    const lock = `${file}.lock`;
    mkdirSync(lock, { mode: 0o700 });
    const first = startWriter('alice');
    await first.ready;
    const second = startWriter('bob');
    await second.ready;

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(first.child.exitCode).toBeNull();
    expect(second.child.exitCode).toBeNull();

    rmSync(lock, { recursive: true });
    await Promise.all([first.done, second.done]);
    expect([...loadPasswordAccounts(file).keys()].sort()).toEqual(['alice', 'bob', 'synthetic_owner']);
  });

  it('recovers a lock left behind by a crashed writer', async () => {
    const lock = `${file}.lock`;
    holdLock(999_999_999);

    await createSeatPasswordFile(file).upsert('alice', 'synthetic_seat_alice', 'correct horse battery');

    expect(loadPasswordAccounts(file).has('alice')).toBe(true);
    expect(existsSync(lock)).toBe(false);
  });

  it('does not steal an old lock from a live writer', async () => {
    const lock = `${file}.lock`;
    holdLock(process.pid);
    const writer = startWriter('alice');
    await writer.ready;

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(writer.child.exitCode).toBeNull();

    rmSync(lock, { recursive: true });
    await writer.done;
    expect(loadPasswordAccounts(file).has('alice')).toBe(true);
  });

  it('waits without blocking unrelated work on the event loop', async () => {
    holdLock(process.pid);
    const pending = Promise.resolve().then(() => (
      createSeatPasswordFile(file).upsert('alice', 'synthetic_seat_alice', 'correct horse battery')
    ));
    const outcome = await Promise.race([
      new Promise<'responsive'>((resolve) => setTimeout(() => resolve('responsive'), 100)),
      pending.then(() => 'finished' as const, () => 'finished' as const),
    ]);
    expect(outcome).toBe('responsive');
    rmSync(`${file}.lock`, { recursive: true, force: true });
    await pending;
    expect(loadPasswordAccounts(file).has('alice')).toBe(true);
  });

  it('removes temporary files left by a crashed writer', async () => {
    const interrupted = `${file}.tmp-interrupted`;
    writeFileSync(interrupted, '{"partial":', { mode: 0o600 });

    await createSeatPasswordFile(file).upsert('alice', 'synthetic_seat_alice', 'correct horse battery');

    expect(existsSync(interrupted)).toBe(false);
    expect(loadPasswordAccounts(file).has('alice')).toBe(true);
  });
});
