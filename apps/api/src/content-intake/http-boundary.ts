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
