import { createServer, type Server } from 'node:http';

/** Not the public API port. The tunnel reaches 127.0.0.1:43110, so this listener stays on its own port. */
export const REVIEW_LOGIN_PORT = 43112;

/** Absent, blank, or the same as the public API port means the listener stays off. */
export function reviewLoginPort(environment: NodeJS.ProcessEnv, apiPort: number): number | undefined {
  const raw = environment.CUSTOMER_AGENT_REVIEW_LOGIN_PORT ?? '';
  if (raw.trim() === '') return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === apiPort) return undefined;
  return port;
}
const REVIEW_BINDINGS = new Set(['synthetic_coach', 'synthetic_owner', 'synthetic_quality']);

export type ReviewSessionIssuer = (bindingId: string) => Promise<{
  access_token: string;
  expires_at: string;
}>;

function loopbackPeer(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::ffff:127.0.0.1' || address === '::1';
}

/** Issues review-actor sessions for the desktop. It never serves the Feishu authorize URL. */
export function startReviewLoginServer(issue: ReviewSessionIssuer, port = REVIEW_LOGIN_PORT): Promise<Server> {
  const server = createServer((request, response) => {
    if (!loopbackPeer(request.socket.remoteAddress)) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/auth/review-login') {
      response.writeHead(404);
      response.end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024) request.destroy();
      else chunks.push(chunk);
    });
    request.on('end', () => {
      void (async () => {
        try {
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const bindingId = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? Reflect.get(parsed, 'binding_id')
            : undefined;
          if (typeof bindingId !== 'string' || !REVIEW_BINDINGS.has(bindingId)) {
            response.writeHead(400);
            response.end();
            return;
          }
          const session = await issue(bindingId);
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({
            access_token: session.access_token,
            token_type: 'Bearer',
            expires_at: session.expires_at,
          }));
        } catch {
          if (!response.headersSent) response.writeHead(403);
          response.end();
        }
      })();
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
