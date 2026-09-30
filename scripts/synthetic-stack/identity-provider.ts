/**
 * Loopback synthetic identity provider.
 *
 * This is the local stand-in for an external identity provider. It is the only
 * thing the API's `SYNTHETIC_IDENTITY_PROVIDER_ORIGIN` may point at, and it is
 * deliberately tiny:
 *
 *   GET  /authorize?state=...&redirect_uri=...  -> 302 to the API callback
 *   POST /password {username, password}          -> {code: bindingId} (seeded subjects only)
 *   POST /exchange {code}                        -> {provider:'synthetic', binding_id}
 *   GET  /health                                 -> liveness
 *
 * `/exchange` echoes the requested binding id only when it matches a seeded
 * synthetic subject, so a typo fails the login instead of silently creating an
 * unknown identity. No real Feishu URL, credential, token or redirect is
 * accepted, and nothing here is reachable from off-host.
 *
 * The help page the desktop opens is served by the desktop main process itself
 * (`apps/desktop/src/main/product-help-open.ts`), so this module stays free of
 * cross-package imports.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STACK_ROOT, SYNTHETIC_IDENTITIES } from './profile.ts';
import { isAdmittedHost, loadPasswordAccounts, passwordMatches } from './identity-admission.ts';

const MAX_BODY_BYTES = 4_096;
const ALLOWED_BINDINGS = new Set(SYNTHETIC_IDENTITIES.map((identity) => identity.bindingId));
const ACCOUNTS_FILE = path.join(STACK_ROOT, 'password-accounts.json');

/** The authorize endpoint always grants the agent subject; /exchange picks the subject. */
const DEFAULT_BINDING = 'synthetic_agent';

function send(response: ServerResponse, status: number, body: string, contentType = 'application/json'): void {
  response.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
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

export function createIdentityProvider(
  { port, accountsFile = ACCOUNTS_FILE }: Readonly<{ port: number; accountsFile?: string }>,
) {
  // Loaded once at startup. A missing or empty file fails the process rather than
  // falling back to a built-in password, which is what the previous version did.
  const accounts = loadPasswordAccounts(accountsFile);
  const server = createServer((request, response) => {
    // NOTE: `url` is built from a fixed loopback base, so `url.hostname` is always
    // '127.0.0.1' and can never reject anything. Admission must read the Host header.
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${String(port)}`);
    if (!isAdmittedHost(request.headers.host)) { send(response, 403, '{"error":"loopback_only"}'); return; }

    if (request.method === 'GET' && url.pathname === '/authorize') {
      const state = url.searchParams.get('state');
      const redirect = url.searchParams.get('redirect_uri');
      if (!state || !redirect) { send(response, 400, '{"error":"invalid_request"}'); return; }
      let target: URL;
      try { target = new URL(redirect); } catch { send(response, 400, '{"error":"invalid_redirect"}'); return; }
      if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1'
        || target.pathname !== '/v1/auth/callback') {
        send(response, 400, '{"error":"invalid_redirect"}'); return;
      }
      // The synthetic provider always grants the default subject; a test that
      // wants another seeded subject posts its binding id to /exchange directly.
      target.searchParams.set('state', state);
      target.searchParams.set('code', DEFAULT_BINDING);
      response.writeHead(302, { location: target.href, 'cache-control': 'no-store' });
      response.end();
      return;
    }

    if (request.method === 'POST' && url.pathname === '/password') {
      void readBody(request).then((body) => {
        let parsed: unknown;
        try { parsed = body ? JSON.parse(body) : null; } catch { send(response, 400, '{"error":"invalid_json"}'); return; }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { send(response, 400, '{"error":"invalid_request"}'); return; }
        const username = Reflect.get(parsed, 'username');
        const password = Reflect.get(parsed, 'password');
        if (typeof username !== 'string' || typeof password !== 'string') { send(response, 400, '{"error":"invalid_request"}'); return; }
        const identity = SYNTHETIC_IDENTITIES.find((item) => item.bindingId === username);
        // Verify against the account file. The old code compared the submitted
        // password to a module constant, which granted any seeded subject — including
        // owner — to anyone who knew that string.
        const account = identity === undefined ? undefined : accounts.get(username);
        if (!identity || !account || !passwordMatches(account, password)) {
          send(response, 401, '{"error":"invalid_credentials"}'); return;
        }
        send(response, 200, JSON.stringify({ code: identity.bindingId }));
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/exchange') {
      void readBody(request).then((body) => {
        if (body === null) { send(response, 413, '{"error":"too_large"}'); return; }
        let code = '';
        try {
          const parsed: unknown = JSON.parse(body);
          if (parsed && typeof parsed === 'object') {
            const value = Reflect.get(parsed, 'code');
            if (typeof value === 'string') code = value;
          }
        } catch { code = ''; }
        if (!ALLOWED_BINDINGS.has(code)) { send(response, 401, '{"error":"unknown_subject"}'); return; }
        send(response, 200, JSON.stringify({ provider: 'synthetic', binding_id: code }));
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      send(response, 200, '{"status":"ok","provider":"synthetic"}');
      return;
    }

    send(response, 404, '{"error":"not_found"}');
  });

  return Object.freeze({
    listen: () => new Promise<string>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${String(port)}`));
    }),
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
  });
}

/** Entry point when spawned as a child process by the stack. */
export async function runIdentityProvider(port: number): Promise<void> {
  const provider = createIdentityProvider({ port });
  const origin = await provider.listen();
  console.info(`[identity] listening at ${origin} provider=synthetic`);
  const stop = () => { void provider.close().then(() => { process.exitCode = 0; }); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

// Spawned directly by stack.ts as `identity-provider.ts <port>`.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.argv[2]);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    console.error('[identity] FAILED: a loopback port 1024..65535 is required');
    process.exitCode = 1;
  } else {
    void runIdentityProvider(port);
  }
}
