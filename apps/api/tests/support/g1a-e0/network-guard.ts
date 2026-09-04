import { lstatSync, realpathSync } from 'node:fs';
import { Socket } from 'node:net';
import path from 'node:path';

const PROXY_ENV_KEYS = Object.freeze([
  'ALL_PROXY',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'all_proxy',
  'https_proxy',
  'http_proxy',
  'no_proxy',
] as const);

type ConnectMethod = (this: Socket, ...arguments_: readonly unknown[]) => Socket;

function unixSocketPath(arguments_: readonly unknown[]): string | null {
  const first = arguments_[0];
  if (typeof first === 'string') return first;
  if (typeof first !== 'object' || first === null || Array.isArray(first)) return null;
  const candidate = (first as Readonly<{ path?: unknown }>).path;
  return typeof candidate === 'string' ? candidate : null;
}

function isInsideAllowedSocketDirectory(candidate: string, allowedDirectory: string): boolean {
  if (!path.isAbsolute(candidate)) return false;
  try {
    const candidateStat = lstatSync(candidate);
    if (candidateStat.isSymbolicLink() || !candidateStat.isSocket()) return false;
    const canonicalDirectory = realpathSync(allowedDirectory);
    const canonicalCandidateDirectory = path.dirname(realpathSync(candidate));
    const relative = path.relative(canonicalDirectory, canonicalCandidateDirectory);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

/**
 * Prevents accidental Node-level outbound connections while the dedicated
 * evaluator runs. This is a process guard, not an OS sandbox or a defence
 * against malicious native code.
 */
export function installG1aNetworkGuard(allowedUnixSocketDirectory: string): Readonly<{
  attempts: () => number;
  restore: () => void;
}> {
  const originalConnect = Socket.prototype.connect as unknown as ConnectMethod;
  const originalFetch = globalThis.fetch;
  const savedProxyEnvironment = new Map<string, string>();
  let attempts = 0;
  let restored = false;

  for (const key of PROXY_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) savedProxyEnvironment.set(key, value);
    delete process.env[key];
  }

  const guardedConnect: ConnectMethod = function guardedConnect(...arguments_) {
    const socketPath = unixSocketPath(arguments_);
    if (socketPath === null || !isInsideAllowedSocketDirectory(socketPath, allowedUnixSocketDirectory)) {
      attempts += 1;
      throw new Error('G1A_EXTERNAL_NETWORK_BLOCKED');
    }
    return Reflect.apply(originalConnect, this, arguments_) as Socket;
  };
  Object.defineProperty(Socket.prototype, 'connect', {
    configurable: true,
    value: guardedConnect,
    writable: true,
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => {
      attempts += 1;
      throw new Error('G1A_EXTERNAL_NETWORK_BLOCKED');
    },
    writable: true,
  });

  return Object.freeze({
    attempts: () => attempts,
    restore: () => {
      if (restored) return;
      restored = true;
      Object.defineProperty(Socket.prototype, 'connect', {
        configurable: true,
        value: originalConnect,
        writable: true,
      });
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: originalFetch,
        writable: true,
      });
      for (const key of PROXY_ENV_KEYS) delete process.env[key];
      for (const [key, value] of savedProxyEnvironment) process.env[key] = value;
    },
  });
}
