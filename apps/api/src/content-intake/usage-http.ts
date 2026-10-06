import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import { authenticateRequestHeaders, type AuthenticatedUser, type ProductAuthService } from '../auth-service.js';
import type { createContentIntakeService } from './service.js';
import type { IntakeResult } from './transaction.js';

type C = components['schemas'];
type Failure = C['IntakeFailure'];
const STATUS: Record<Failure['code'], number> = {
  VALIDATION: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  CONFLICT: 409, RATE_LIMITED: 429, OVERLOADED: 503, INTERNAL_ERROR: 500,
};
function failure(reply: FastifyReply, code: Failure['code'], reason: Failure['details']['reason'], diagnosticId: string = randomUUID()) {
  const value: C['IntakeError'] = { error: { code, message: '资料请求未完成。', details: { reason, diagnosticId } } };
  return reply.code(STATUS[code]).send(value);
}
function send<T>(reply: FastifyReply, result: IntakeResult<T>, schema: 'IntakeEntitlement' | 'IntakeSnapshot') {
  if (!result.ok) return failure(reply, result.code, result.reason, result.diagnosticId);
  return reply.send(parseContractSchema(schema, result.value));
}

/** Sealed adapter: the isolated synthetic host explicitly registers these two
 * routes. Production app/server factories do not register it or acquire new ACL.
 * Authenticated DTO identity is retained (no spread/clone); the usage service
 * locks and rechecks its private session binding in each transaction.
 */
export const contentIntakeUsageRoutes: FastifyPluginAsync<{
  auth: ProductAuthService;
  usage: Pick<ReturnType<typeof createContentIntakeService>, 'issueEntitlement' | 'snapshot'>;
  report?: (diagnosticId: string, error: unknown) => void;
}> = async (app, { auth, usage, report }) => {
  const actors = new WeakMap<FastifyRequest, AuthenticatedUser>();
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(auth, request.headers);
    if (!actor) return failure(reply, 'UNAUTHORIZED', 'SCOPE_DENIED');
    actors.set(request, actor);
  });
  app.setErrorHandler((error, _request, reply) => {
    const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : null;
    if (status === 400 || status === 413 || status === 415) {
      return failure(reply, 'VALIDATION', status === 413 ? 'FILE_LIMIT' : 'FILE_INVALID');
    }
    const diagnosticId = randomUUID();
    try { report?.(diagnosticId, error); }
    catch { /* Diagnostics cannot replace the fixed public error or disclose a sink exception. */ }
    return failure(reply, 'INTERNAL_ERROR', 'ORG_FACTS_UNAVAILABLE', diagnosticId);
  });
  app.post('/v1/intake/entitlements', { bodyLimit: 65_536 }, async (request, reply) => {
    if (Object.keys(request.query as object).length) return failure(reply, 'VALIDATION', 'FILE_INVALID');
    return send(reply, await usage.issueEntitlement(actors.get(request)!, request.body), 'IntakeEntitlement');
  });
  app.get('/v1/intake/snapshot', { exposeHeadRoute: false }, async (request, reply) => {
    // Fastify preserves repeated query parameters as arrays. Only a single
    // decimal limit is decoded; duplicates/unknown fields remain for strict
    // service validation rather than being dropped or guessed by coercion.
    const query = { ...request.query as Record<string, unknown> };
    if (typeof query.limit === 'string' && /^(?:[1-9][0-9]{0,2})$/.test(query.limit)) query.limit = Number(query.limit);
    return send(reply, await usage.snapshot(actors.get(request)!, query), 'IntakeSnapshot');
  });
};
