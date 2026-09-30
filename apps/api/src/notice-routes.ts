import type { FastifyInstance, FastifyRequest } from 'fastify';
import { validateContractSchema } from '@customer-agent/contracts';
import { authenticateRequestHeaders, type AuthService } from './auth-service.js';
import {
  sendConflict,
  sendInternalError,
  sendNotFound,
  sendOverloaded,
  sendUnauthorized,
  sendValidationError,
} from './contract-http-errors.js';
import type { NoticeService } from './notice-service.js';

export type NoticeRouteDependencies = Readonly<{ service: NoticeService }>;

function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index]);
}

function idempotencyKey(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 200 ? trimmed : null;
}

export function registerNoticeRoutes(
  app: FastifyInstance,
  authService: AuthService,
  dependencies?: NoticeRouteDependencies,
): void {
  app.get('/v1/notices/current', async (request: FastifyRequest, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (dependencies === undefined) return sendOverloaded(reply);
    const result = await dependencies.service.current(actor);
    if (result.ok) return result.response;
    if (result.code === 'NOT_FOUND') return sendNotFound(reply);
    if (result.code === 'OVERLOADED') return sendOverloaded(reply);
    return sendInternalError(reply);
  });

  app.post('/v1/notices/:version/decision', async (request: FastifyRequest, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (!hasExactKeys(request.body, ['decision'])) return sendValidationError(reply);
    const parsed = validateContractSchema('NoticeDecisionRequest', request.body);
    if (!parsed.ok) return sendValidationError(reply);
    const key = idempotencyKey(request.headers['idempotency-key']);
    if (key === null) return sendValidationError(reply);
    const version = request.params !== null && typeof request.params === 'object'
      ? Reflect.get(request.params, 'version')
      : undefined;
    if (typeof version !== 'string' || version.length < 1 || version.length > 100) {
      return sendValidationError(reply);
    }
    if (dependencies === undefined) return sendOverloaded(reply);
    const result = await dependencies.service.recordDecision({
      actor, version, decision: parsed.value.decision, idempotencyKey: key,
    });
    if (result.ok) return result.response;
    if (result.code === 'NOT_FOUND') return sendNotFound(reply);
    if (result.code === 'CONFLICT') return sendConflict(reply);
    if (result.code === 'OVERLOADED') return sendOverloaded(reply);
    if (result.code === 'UNAUTHORIZED') return sendUnauthorized(reply);
    return sendInternalError(reply);
  });
}
