/**
 * Product-owned password identity (scheme C). Loopback only.
 *
 * POST /password {username, password} -> {code}  (one-time, 2 min)
 * POST /exchange {code}               -> {provider:'synthetic', binding_id}
 * GET  /health
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STACK_ROOT, SYNTHETIC_IDENTITIES } from './profile.ts';

const MAX_BODY_BYTES = 4_096;
const CODE_TTL_MS = 120_000;
const FAIL_LIMIT = 5;
const LOCK_MS = 300_000;
const ACCOUNTS_FILE = path.join(STACK_ROOT, 'password-accounts.json');

type Account = Readonly<{ username: string; bindingId: string; salt: string; hash: string }>;
type CodeRow = { bindingId: string; expiresAt: number };

function send(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(body);
}

function readBody(request: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > MAX_BODY_BYTES) { request.destroy(); resolve(null); return; }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', () => resolve(null));
  });
}

function loadAccounts(): Map<string, Account> {
  const accounts = new Map<string, Account>();
  if (existsSync(ACCOUNTS_FILE)) {
    const raw: unknown = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8'));
    if (!Array.isArray(raw)) throw new Error('password-accounts.json must be an array');
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue;
      const username = Reflect.get(row, 'username');
      const bindingId = Reflect.get(row, 'bindingId');
      const salt = Reflect.get(row, 'salt');
      const hash = Reflect.get(row, 'hash');
      if (typeof username !== 'string' || typeof bindingId !== 'string'
        || typeof salt !== 'string' || typeof hash !== 'string') continue;
      if (!/^synthetic_[A-Za-z0-9_-]{1,100}$/.test(bindingId)) continue;
      accounts.set(username, Object.freeze({ username, bindingId, salt, hash }));
    }
  }
  if (accounts.size === 0) {
    for (const identity of SYNTHETIC_IDENTITIES) {
      const salt = randomBytes(16).toString('hex');
      const hash = scryptSync('synthetic-password', salt, 64).toString('hex');
      accounts.set(identity.bindingId, Object.freeze({
        username: identity.bindingId, bindingId: identity.bindingId, salt, hash,
      }));
    }
  }
  return accounts;
}

function passwordOk(account: Account, password: string): boolean {
  const actual = scryptSync(password, account.salt, 64);
  const expected = Buffer.from(account.hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createPasswordIdentityServer({ port }: Readonly<{ port: number }>) {
  const accounts = loadAccounts();
  const codes = new Map<string, CodeRow>();
  const failures = new Map<string, { count: number; lockedUntil: number }>();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${String(port)}`);
    const remote = request.socket.remoteAddress;
    const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    if (!loopback) {
      send(response, 403, '{"error":"loopback_only"}'); return;
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      send(response, 200, '{"ok":true,"kind":"password"}'); return;
    }
    if (request.method === 'POST' && url.pathname === '/password') {
      void readBody(request).then((body) => {
        if (body === null) { send(response, 413, '{"error":"too_large"}'); return; }
        let parsed: unknown;
        try { parsed = JSON.parse(body); } catch { send(response, 400, '{"error":"invalid"}'); return; }
        if (!parsed || typeof parsed !== 'object') { send(response, 400, '{"error":"invalid"}'); return; }
        const username = Reflect.get(parsed, 'username');
        const password = Reflect.get(parsed, 'password');
        if (typeof username !== 'string' || typeof password !== 'string') {
          send(response, 400, '{"error":"invalid"}'); return;
        }
        const now = Date.now();
        const fail = failures.get(username);
        if (fail && fail.lockedUntil > now) { send(response, 401, '{"error":"locked"}'); return; }
        const account = accounts.get(username);
        if (!account || !passwordOk(account, password)) {
          const next = { count: (fail?.count ?? 0) + 1, lockedUntil: 0 };
          if (next.count >= FAIL_LIMIT) next.lockedUntil = now + LOCK_MS;
          failures.set(username, next);
          send(response, 401, '{"error":"invalid"}'); return;
        }
        failures.delete(username);
        const code = randomBytes(32).toString('hex');
        codes.set(code, { bindingId: account.bindingId, expiresAt: now + CODE_TTL_MS });
        send(response, 200, JSON.stringify({ code }));
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/exchange') {
      void readBody(request).then((body) => {
        if (body === null) { send(response, 413, '{"error":"too_large"}'); return; }
        let parsed: unknown;
        try { parsed = JSON.parse(body); } catch { send(response, 400, '{"error":"invalid"}'); return; }
        const code = parsed && typeof parsed === 'object' ? Reflect.get(parsed, 'code') : undefined;
        if (typeof code !== 'string') { send(response, 400, '{"error":"invalid"}'); return; }
        const row = codes.get(code);
        codes.delete(code);
        if (!row || row.expiresAt < Date.now()) { send(response, 401, '{"error":"invalid"}'); return; }
        send(response, 200, JSON.stringify({ provider: 'synthetic', binding_id: row.bindingId }));
      });
      return;
    }
    send(response, 404, '{"error":"not_found"}');
  });
  return {
    listen: () => new Promise<void>((resolve) => { server.listen(port, '127.0.0.1', resolve); }),
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve(); });
    }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.argv[2]);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    console.error('[password-identity] FAILED: a loopback port 1024..65535 is required');
    process.exitCode = 1;
  } else {
    void createPasswordIdentityServer({ port }).listen().then(() => {
      console.info(`[password-identity] listening at http://127.0.0.1:${String(port)}`);
    });
  }
}
