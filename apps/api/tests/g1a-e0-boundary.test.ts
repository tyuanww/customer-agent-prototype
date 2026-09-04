import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { installG1aNetworkGuard } from './support/g1a-e0/network-guard.js';

const SUPPORT_ROOT = new URL('./support/g1a-e0/', import.meta.url);
let restoreGuard: (() => void) | null = null;
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  restoreGuard?.();
  restoreGuard = null;
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function boundaryRoot(base = os.tmpdir()): Promise<string> {
  const root = await mkdtemp(path.join(base, 'g1a-boundary-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return root;
}

describe('G1A-E0 trust boundary', () => {
  it('does not import HTTP, routes, events, desktop, or service repository', async () => {
    const names = (await readdir(SUPPORT_ROOT)).filter((name) => name.endsWith('.ts'));
    const disallowed = [
      'node:http',
      'node:https',
      'node:dgram',
      'node:dns',
      'node:tls',
      'undici',
      'event-repository',
      'search-routes',
      'service-repository',
      'server.js',
      'apps/desktop',
    ];
    for (const name of names) {
      const source = await readFile(new URL(name, SUPPORT_ROOT), 'utf8');
      for (const token of disallowed) expect(source, `${name} imports ${token}`).not.toContain(token);
    }
  });

  it('blocks TCP and fetch while counting attempts', async () => {
    const allowedDirectory = await boundaryRoot();
    const guard = installG1aNetworkGuard(allowedDirectory);
    restoreGuard = guard.restore;

    const socket = new Socket();
    expect(() => socket.connect({ host: '127.0.0.1', port: 9 })).toThrow('G1A_EXTERNAL_NETWORK_BLOCKED');
    await expect(globalThis.fetch('https://example.invalid')).rejects.toThrow('G1A_EXTERNAL_NETWORK_BLOCKED');
    expect(guard.attempts()).toBe(2);
  });

  it('restores proxy variables exactly once and blocks an out-of-bound Unix socket', async () => {
    const allowedDirectory = await boundaryRoot();
    const previousHttpProxy = process.env.HTTP_PROXY;
    const previousNoProxy = process.env.NO_PROXY;
    cleanups.push(async () => {
      if (previousHttpProxy === undefined) delete process.env.HTTP_PROXY;
      else process.env.HTTP_PROXY = previousHttpProxy;
      if (previousNoProxy === undefined) delete process.env.NO_PROXY;
      else process.env.NO_PROXY = previousNoProxy;
    });
    process.env.HTTP_PROXY = ['http:/', '/proxy.example.invalid:8080'].join('');
    process.env.NO_PROXY = '127.0.0.1';

    const guard = installG1aNetworkGuard(allowedDirectory);
    restoreGuard = guard.restore;
    expect(process.env.HTTP_PROXY).toBeUndefined();
    expect(process.env.NO_PROXY).toBeUndefined();

    const socket = new Socket();
    expect(() => socket.connect(path.join(os.tmpdir(), 'outside.sock')))
      .toThrow('G1A_EXTERNAL_NETWORK_BLOCKED');
    expect(guard.attempts()).toBe(1);

    guard.restore();
    guard.restore();
    restoreGuard = null;
    expect(process.env.HTTP_PROXY).toBe(['http:/', '/proxy.example.invalid:8080'].join(''));
    expect(process.env.NO_PROXY).toBe('127.0.0.1');
  });

  it.skipIf(process.platform === 'win32')('rejects a Unix socket reached through a symlinked directory', async () => {
    const root = await boundaryRoot('/tmp');
    const allowedDirectory = path.join(root, 'allowed');
    const outsideDirectory = path.join(root, 'outside');
    await mkdir(allowedDirectory, { mode: 0o700 });
    await mkdir(outsideDirectory, { mode: 0o700 });
    const outsideSocket = path.join(outsideDirectory, 'postgres.sock');
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(outsideSocket, resolve);
    });
    cleanups.push(() => new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve(); });
    }));
    await symlink(outsideDirectory, path.join(allowedDirectory, 'escape'));

    const guard = installG1aNetworkGuard(allowedDirectory);
    restoreGuard = guard.restore;
    const socket = new Socket();
    expect(() => socket.connect(path.join(allowedDirectory, 'escape', 'postgres.sock')))
      .toThrow('G1A_EXTERNAL_NETWORK_BLOCKED');
    expect(guard.attempts()).toBe(1);
  });
});
