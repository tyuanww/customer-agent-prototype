import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { parseContractSchema, type ContractSchemaName, type components } from '@customer-agent/contracts';
import { authenticateRequestHeaders, type AuthService, type AuthenticatedUser } from '../auth-service.js';
import type { IntakeResult } from './transaction.js';

declare module 'fastify' {
  interface FastifyContextConfig { intakeFileLimitStatus?: 413 }
}

type Failure = components['schemas']['IntakeFailure'];
const STATUS: Record<Failure['code'], number> = {
  VALIDATION: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  CONFLICT: 409, RATE_LIMITED: 429, OVERLOADED: 503, INTERNAL_ERROR: 500,
};

async function emptyGetBody(request: FastifyRequest): Promise<boolean> {
  const length = request.headers['content-length'];
  if (length !== undefined && length !== '0') return false;
  const stream = request.raw;
  // Fastify skips GET body parsing. A parent intake hook may already have drained
  // this stream; readableEnded then proves the same request was fully consumed.
  if (stream.readableEnded) return true;
  if (stream.destroyed) return false;
  if (request.headers['transfer-encoding'] === undefined) return true;
  return new Promise(resolve => {
    const finish = (empty: boolean) => {
      clearTimeout(deadline);
      stream.off('data', data);
      stream.off('end', end);
      stream.off('error', failed);
      stream.off('aborted', failed);
      stream.off('close', failed);
      if (!empty) stream.pause();
      resolve(empty);
    };
    const data = (chunk: Buffer) => { if (chunk.length) finish(false); };
    const end = () => finish(true);
    const failed = () => finish(false);
    // Absolute deadline: extra chunks must not keep an unfinished read alive.
    const deadline = setTimeout(failed, 5_000);
    stream.on('data', data);
    stream.once('end', end);
    stream.once('error', failed);
    stream.once('aborted', failed);
    stream.once('close', failed);
  });
}

export function intakeFailure(reply: FastifyReply, code: Failure['code'], reason: Failure['details']['reason'], diagnosticId: string = randomUUID()) {
  const value: components['schemas']['IntakeError'] = { error: { code, message: '资料请求未完成。', details: { reason, diagnosticId } } };
  // Only the new quality contract opts into 413; preserve predecessor error wire.
  const status = code === 'VALIDATION' && reason === 'FILE_LIMIT' ? reply.request.routeOptions.config.intakeFileLimitStatus ?? STATUS[code] : STATUS[code];
  return reply.code(status).send(value);
}
export function sendIntake(reply: FastifyReply, result: IntakeResult<unknown>, schema: ContractSchemaName, status = 200) {
  if (!result.ok) return intakeFailure(reply, result.code, result.reason, result.diagnosticId);
  const value = parseContractSchema(schema, result.value);
  return reply.code(status).send(value);
}

/** Install only in an encapsulated intake plugin. Preserve product-auth's private
 * DTO identity; each DB operation still locks its authenticated session. */
export function intakeHttpBoundary(app: FastifyInstance, auth: AuthService,
  report?: (diagnosticId: string, error: unknown) => void) {
  const actors = new WeakMap<FastifyRequest, AuthenticatedUser>();
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(auth, request.headers);
    if (!actor) return intakeFailure(reply, 'UNAUTHORIZED', request.routeOptions.url === '/v1/intake/shop-directory' ? 'SHOP_DIRECTORY_SESSION' : 'SCOPE_DENIED');
    if (request.method === 'GET' && !await emptyGetBody(request)) {
      if (request.raw.destroyed) return reply.hijack();
      reply.header('connection', 'close');
      return intakeFailure(reply, 'VALIDATION', request.routeOptions.url === '/v1/intake/shop-directory' ? 'SHOP_DIRECTORY_CURSOR' : 'FILE_INVALID');
    }
    actors.set(request, actor);
  });
  app.setErrorHandler((error, request, reply) => {
    const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : null;
    if (status === 400 || status === 413 || status === 415) {
      return intakeFailure(reply, 'VALIDATION', request.routeOptions.url === '/v1/intake/shop-directory' ? 'SHOP_DIRECTORY_CURSOR' : status === 413 ? 'FILE_LIMIT' : 'FILE_INVALID');
    }
    const diagnosticId = randomUUID();
    try { report?.(diagnosticId, error); }
    catch { /* Diagnostics cannot replace the fixed public error or disclose a sink exception. */ }
    return request.routeOptions.url === '/v1/intake/shop-directory'
      ? intakeFailure(reply, 'OVERLOADED', 'SHOP_DIRECTORY_UNAVAILABLE', diagnosticId)
      : intakeFailure(reply, 'INTERNAL_ERROR', 'ORG_FACTS_UNAVAILABLE', diagnosticId);
  });
  return (request: FastifyRequest): AuthenticatedUser => actors.get(request)!;
}

/** Decode just the one numeric query field. Preserve duplicates and unknowns so
 * the service rejects them instead of silently changing the request meaning. */
export function intakePageQuery(request: FastifyRequest): Record<string, unknown> {
  const query = { ...request.query as Record<string, unknown> };
  if (typeof query.limit === 'string' && /^(?:[1-9][0-9]{0,2})$/.test(query.limit)) query.limit = Number(query.limit);
  return query;
}

/** Only the material list pages backwards. Keeping this out of `intakePageQuery`
 * means a future list that forgets to reject unknown keys cannot silently accept a
 * key it never implemented. */
export function materialPageQuery(request: FastifyRequest): Record<string, unknown> {
  const query = intakePageQuery(request);
  if (query.previous === 'true') query.previous = true;
  else if (query.previous === 'false') query.previous = false;
  return query;
}
