import type { FastifyInstance, FastifyReply } from 'fastify';
import { parseContractSchema, validateContractSchema } from '@customer-agent/contracts';
import type { Readable } from 'node:stream';
import { authenticateRequestHeaders, type AuthService } from './auth-service.js';
import type { ContentImportService } from './content-import-service.js';
import { CONTENT_UPLOAD_MAX_BYTES } from './content-object-store.js';
import {
  sendConflict,
  sendForbiddenOrPolicyDenied,
  sendInternalError,
  sendNotFound,
  sendOverloaded,
  sendUnauthorized,
  sendValidationError,
} from './contract-http-errors.js';
import type { ContentImportFailure } from './content-import-repository.js';

export type ContentImportRouteDependencies = Readonly<{
  service: ContentImportService;
}>;

function idempotencyKey(value: string | readonly string[] | undefined): string | null {
  return typeof value === 'string' && value.length >= 1 && value.length <= 255 && value.trim() === value
    ? value
    : null;
}

function sendImportFailure(reply: FastifyReply, result: ContentImportFailure): FastifyReply {
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
  if (result.code === 'CONFLICT') return sendConflict(reply);
  if (result.code === 'OVERLOADED' || result.code === 'SOURCE_GATE_NOT_READY') return sendOverloaded(reply);
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

export function registerContentImportRoutes(
  app: FastifyInstance,
  authService: AuthService,
  dependencies?: ContentImportRouteDependencies,
): void {
  const windows = new Map<string, { start: number; count: number }>();
  function limit(operation: string, maximum: number): boolean {
    const now = performance.now();
    const prior = windows.get(operation);
    const window = prior && now - prior.start < 60_000 ? prior : { start: now, count: 0 };
    windows.set(operation, window);
    return ++window.count <= maximum;
  }

  app.register(async (scope) => {
    scope.addContentTypeParser('multipart/form-data', (request, payload, done) => {
      done(null, payload);
    });

    scope.post('/v1/content/import', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const actor = await authenticateRequestHeaders(authService, request.headers);
      if (actor === null) return sendUnauthorized(reply);
      if (!limit('import', 20)) return sendRateLimited(reply);
      const key = idempotencyKey(request.headers['idempotency-key']);
      if (key === null) return sendValidationError(reply);
      if (dependencies === undefined) return sendOverloaded(reply);
      const contentType = request.headers['content-type'];
      if (typeof contentType !== 'string') return sendValidationError(reply);
      if (contentType.toLowerCase().includes('application/json')) return sendValidationError(reply);
      const result = await dependencies.service.acceptUpload({
        actor,
        idempotencyKey: key,
        contentType,
        body: request.body as Readable,
      });
      if (!result.ok) return sendImportFailure(reply, result);
      return reply.code(202).send(result.response);
    });
  }, { bodyLimit: CONTENT_UPLOAD_MAX_BYTES + 64 * 1024 });

  app.get('/v1/content/import/:import_batch_id', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (!limit('status', 120)) return sendRateLimited(reply);
    if (dependencies === undefined) return sendOverloaded(reply);
    const id = (request.params as { import_batch_id?: string }).import_batch_id;
    if (typeof id !== 'string') return sendValidationError(reply);
    const result = await dependencies.service.readStatus(actor, id);
    if (!result.ok) return sendImportFailure(reply, result);
    return result.response;
  });

  app.post('/v1/content/import/:import_batch_id/cancel', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (!limit('cancel', 40)) return sendRateLimited(reply);
    const key = idempotencyKey(request.headers['idempotency-key']);
    if (key === null) return sendValidationError(reply);
    const id = (request.params as { import_batch_id?: string }).import_batch_id;
    const body = validateContractSchema('CancelImportRequest', request.body);
    if (typeof id !== 'string' || !body.ok) return sendValidationError(reply);
    if (dependencies === undefined) return sendOverloaded(reply);
    const result = await dependencies.service.cancel({
      actor,
      importBatchId: id,
      reason: body.value.reason,
      idempotencyKey: key,
    });
    if (!result.ok) return sendImportFailure(reply, result);
    return result.response;
  });
}
