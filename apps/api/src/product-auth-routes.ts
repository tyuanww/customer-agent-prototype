import type { FastifyInstance, FastifyReply } from 'fastify';
import { parseContractSchema, validateContractSchema } from '@customer-agent/contracts';
import { bearerToken, type ProductAuthService } from './auth-service.js';
import { isRequestBodyValidationError } from './contract-http-errors.js';
import { IdentityFailure } from './product-auth-service.js';

export function sendIdentityFailure(reply: FastifyReply, failure: IdentityFailure) {
  const mapping = {
    LOGIN_INVALID: [400, 'VALIDATION'], REQUEST_INVALID: [400, 'VALIDATION'],
    LOGIN_EXPIRED: [410, 'GONE'], LOGIN_CONSUMED: [409, 'CONFLICT'],
    SESSION_INVALID: [401, 'UNAUTHORIZED'], CAPABILITY_DENIED: [403, 'FORBIDDEN'],
    DEPENDENCY_UNAVAILABLE: [503, 'OVERLOADED'], RATE_LIMITED: [429, 'RATE_LIMITED'],
  } as const;
  const [status, code] = mapping[failure.reason];
  reply.header('cache-control', 'no-store');
  if (status === 401) reply.header('www-authenticate', 'Bearer');
  if (status === 429 || status === 503) reply.header('retry-after', '1');
  return reply.code(status).send(parseContractSchema('CandidateError', {
    error: { code, message: 'Identity request could not be completed', details: { reason: failure.reason } },
  }));
}

export function registerProductAuthRoutes(app: FastifyInstance, auth: ProductAuthService): void {
  app.register(async scope => {
    scope.setErrorHandler((error, _request, reply) => sendIdentityFailure(reply,
      error instanceof IdentityFailure ? error : new IdentityFailure(
        isRequestBodyValidationError(error) ? 'REQUEST_INVALID' : 'DEPENDENCY_UNAVAILABLE')));
    registerRoutes(scope, auth);
  });
}

function registerRoutes(app: FastifyInstance, auth: ProductAuthService): void {
  // One bounded host-wide budget per operation. No attacker-controlled key map;
  // single-host synthetic load only. Production rate policy remains unapproved.
  const windows = new Map<string, { start: number; count: number }>();
  function limit(operation: string, maximum: number) {
    const now = performance.now();
    const prior = windows.get(operation);
    const window = prior && now - prior.start < 60_000 ? prior : { start: now, count: 0 };
    windows.set(operation, window);
    if (++window.count > maximum) throw new IdentityFailure('RATE_LIMITED');
  }
  app.post('/v1/auth/login-requests', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    limit('create', 20);
    const value = validateContractSchema('LoginCreate', request.body);
    if (!value.ok) throw new IdentityFailure('REQUEST_INVALID');
    const result = await auth.createLogin(value.value.client_challenge);
    return reply.code(201).send(result);
  });
  app.get('/v1/auth/callback', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    limit('callback', 40);
    const query = request.query as Record<string, unknown>;
    if (Object.keys(query).some(key => !['state', 'code', 'error'].includes(key))
      || typeof query.state !== 'string' || query.state.length < 1 || query.state.length > 256
      || (query.code !== undefined && (typeof query.code !== 'string' || query.code.length < 1 || query.code.length > 4096))
      || (query.error !== undefined && (typeof query.error !== 'string' || query.error.length < 1 || query.error.length > 256))
      || (query.code === undefined) === (query.error === undefined)) throw new IdentityFailure('REQUEST_INVALID');
    await auth.callback(query.state, query.code as string | undefined);
    return reply.type('text/html; charset=utf-8')
      .header('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
      .header('referrer-policy', 'no-referrer')
      .send('<!doctype html><meta charset="utf-8"><title>登录完成</title><p>登录已完成，请返回客户端继续。</p>');
  });
  app.post('/v1/auth/login-requests/:login_id/exchange', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    limit('exchange', 120);
    const id = (request.params as Record<string, unknown>).login_id;
    const value = validateContractSchema('LoginExchange', request.body);
    if (typeof id !== 'string' || id.length < 1 || id.length > 128 || !value.ok) throw new IdentityFailure('REQUEST_INVALID');
    const session = await auth.exchange(id, value.value.client_verifier);
    if (session === null) return reply.header('retry-after', '2').code(202).send(parseContractSchema('LoginPending', { status: 'pending', retry_after_seconds: 2 }));
    return session;
  });
  app.post('/v1/auth/logout', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    limit('logout', 120);
    if (request.body !== undefined) throw new IdentityFailure('REQUEST_INVALID');
    const token = bearerToken(request.headers.authorization);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)
      || request.headers['x-mock-user'] !== undefined || request.headers['x-mock-role'] !== undefined) throw new IdentityFailure('SESSION_INVALID');
    // No actor precheck: repeat logout must remain harmless after revocation.
    await auth.logout(token);
    return reply.code(204).send();
  });
}
