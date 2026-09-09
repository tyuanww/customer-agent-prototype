import type { FastifyInstance, FastifyReply } from 'fastify';
import { parseContractSchema, validateContractSchema } from '@customer-agent/contracts';
import { authenticateRequestHeaders, type AuthService } from './auth-service.js';
import type { ContentReleaseFailure, ContentReleaseService } from './content-release-service.js';
import {
  sendConflict,
  sendForbiddenOrPolicyDenied,
  sendInternalError,
  sendNotFound,
  sendOverloaded,
  sendUnauthorized,
  sendValidationError,
} from './contract-http-errors.js';

export type ContentReleaseRouteDependencies = Readonly<{
  service: ContentReleaseService;
}>;

function idempotencyKey(value: string | readonly string[] | undefined): string | null {
  return typeof value === 'string' && value.length >= 1 && value.length <= 255 && value.trim() === value
    ? value
    : null;
}

function sendReleaseFailure(reply: FastifyReply, result: ContentReleaseFailure): FastifyReply {
  reply.header('cache-control', 'no-store');
  if (result.code === 'VALIDATION') {
    return sendValidationError(reply, result.reason === undefined ? undefined : { reason: result.reason });
  }
  if (result.code === 'FORBIDDEN' || result.code === 'POLICY_DENIED') {
    return sendForbiddenOrPolicyDenied(
      reply,
      result.code,
      result.reason === undefined ? undefined : { reason: result.reason },
    );
  }
  if (result.code === 'NOT_FOUND') return sendNotFound(reply);
  if (result.code === 'CONFLICT') {
    return sendConflict(reply);
  }
  if (result.code === 'OVERLOADED') return sendOverloaded(reply);
  return sendInternalError(reply);
}

function sendRateLimited(reply: FastifyReply): FastifyReply {
  reply.header('cache-control', 'no-store');
  reply.header('retry-after', '1');
  return reply.code(429).send(parseContractSchema('RateLimitedErrorEnvelope', {
    error: {
      code: 'RATE_LIMITED',
      message: '请求过于频繁，请稍后重试',
      details: { retry_after_sec: 1 },
    },
  }));
}

export function registerContentReleaseRoutes(
  app: FastifyInstance,
  authService: AuthService,
  dependencies?: ContentReleaseRouteDependencies,
): void {
  const windows = new Map<string, { start: number; count: number }>();
  function limit(operation: string, maximum: number): boolean {
    const now = performance.now();
    const prior = windows.get(operation);
    const window = prior && now - prior.start < 60_000 ? prior : { start: now, count: 0 };
    windows.set(operation, window);
    return ++window.count <= maximum;
  }

  app.post('/v1/content/publish', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (!limit('publish', 5)) return sendRateLimited(reply);
    const key = idempotencyKey(request.headers['idempotency-key']);
    const body = validateContractSchema('PublishRequest', request.body);
    if (key === null || !body.ok) return sendValidationError(reply);
    if (dependencies === undefined) return sendOverloaded(reply);
    const result = await dependencies.service.publish({ actor, idempotencyKey: key, body: body.value });
    if (!result.ok) return sendReleaseFailure(reply, result);
    return result.response;
  });

  app.post('/v1/content/rollback', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (!limit('rollback', 5)) return sendRateLimited(reply);
    const key = idempotencyKey(request.headers['idempotency-key']);
    const body = validateContractSchema('RollbackRequest', request.body);
    if (key === null || !body.ok) return sendValidationError(reply);
    if (dependencies === undefined) return sendOverloaded(reply);
    const result = await dependencies.service.rollback({ actor, idempotencyKey: key, body: body.value });
    if (!result.ok) return sendReleaseFailure(reply, result);
    return result.response;
  });
}
