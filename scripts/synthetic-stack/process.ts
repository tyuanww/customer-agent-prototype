/**
 * Process ownership for the synthetic stack.
 *
 * The stack starts long-lived child processes (identity provider, API, worker).
 * `stop` must remove exactly those and nothing else, so every pid is recorded
 * together with a start signature captured at launch. A pid alone is not an
 * identity: pids are reused. On stop we re-read the signature and refuse to
 * signal a process that no longer matches what we started.
 *
 * Nothing here enumerates or kills unrelated processes, and nothing scans for
 * "anything that looks like our app".
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { PID_DIRECTORY, ensureStackDirectories } from './profile.ts';

export type OwnedProcess = Readonly<{
  name: string;
  pid: number;
  signature: string;
  startedAt: string;
  command: string;
}>;

const SIGNABLE = new Set(['SIGINT', 'SIGTERM', 'SIGKILL']);

function pidFile(name: string): string {
  if (!/^[a-z0-9-]{1,32}$/.test(name)) throw new Error(`Unsafe process name: ${name}`);
  return path.join(PID_DIRECTORY, `${name}.json`);
}

/** `lstart` is second-granular and stable; combined with pid it identifies one process instance. */
export function processSignature(pid: number): string | undefined {
  try {
    const output = execFileSync('/bin/ps', ['-o', 'lstart=,pid=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output.length > 0 ? output : undefined;
  } catch {
    return undefined;
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function recordProcess(name: string, pid: number, command: string): OwnedProcess {
  ensureStackDirectories();
  const signature = processSignature(pid);
  if (signature === undefined) throw new Error(`Cannot read a start signature for pid ${pid}`);
  const record: OwnedProcess = Object.freeze({
    name, pid, signature, startedAt: new Date().toISOString(), command,
  });
  writeFileSync(pidFile(name), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  return record;
}

export function readProcess(name: string): OwnedProcess | undefined {
  const file = pidFile(name);
  if (!existsSync(file)) return undefined;
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object') return undefined;
    const record = value as OwnedProcess;
    if (!Number.isSafeInteger(record.pid) || record.pid <= 0
      || typeof record.signature !== 'string' || record.signature.length === 0) return undefined;
    return record;
  } catch {
    return undefined;
  }
}

export function forgetProcess(name: string): void {
  const file = pidFile(name);
  if (existsSync(file)) unlinkSync(file);
}

/** True only when the recorded pid is still the same process instance we launched. */
export function isOwnedProcessLive(record: OwnedProcess): boolean {
  if (!isAlive(record.pid)) return false;
  return processSignature(record.pid) === record.signature;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, milliseconds); });
}

/**
 * Stop one recorded process. Returns a description of what happened so the
 * caller can report a locatable outcome instead of a silent success.
 */
export async function stopProcess(name: string, { graceMs = 6_000, signal = 'SIGTERM' as const } = {}): Promise<string> {
  const record = readProcess(name);
  if (record === undefined) return `${name}: no recorded process`;
  if (!SIGNABLE.has(signal)) throw new Error(`Refusing to send ${signal}`);
  if (!isOwnedProcessLive(record)) {
    forgetProcess(name);
    return `${name}: pid ${record.pid} is gone or no longer matches the recorded start signature; record removed`;
  }
  process.kill(record.pid, signal);
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isAlive(record.pid)) { forgetProcess(name); return `${name}: stopped (pid ${record.pid})`; }
    await sleep(100);
  }
  // Re-check ownership before escalating: the process may have exited and the
  // pid been reused during the grace period, and SIGKILL would then hit an
  // unrelated process.
  if (!isOwnedProcessLive(record)) {
    forgetProcess(name);
    return `${name}: exited during grace period; record removed`;
  }
  process.kill(record.pid, 'SIGKILL');
  await sleep(200);
  const stopped = !isAlive(record.pid);
  if (stopped) forgetProcess(name);
  return stopped
    ? `${name}: force-stopped after grace period (pid ${record.pid})`
    : `${name}: STILL RUNNING after SIGKILL (pid ${record.pid}); record kept for inspection`;
}

/** Fail-closed port check. Returns a locatable reason instead of binding elsewhere. */
export async function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code === 'EADDRINUSE' || error.code === 'EACCES');
    });
    server.once('listening', () => { server.close(() => resolve(false)); });
    server.listen(port, '127.0.0.1');
  });
}

export async function waitForHttp(url: string, { timeoutMs = 30_000, intervalMs = 250 } = {}): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) return body;
      lastError = `HTTP ${String(response.status)} ${JSON.stringify(body)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}
