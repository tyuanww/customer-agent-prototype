import type { FastifyInstance } from 'fastify';
import { parseContractSchema, validateContractSchema } from '@customer-agent/contracts';
import { authenticateRequestHeaders, bearerToken, type AuthService } from './auth-service.js';
import { sendIdentityFailure } from './product-auth-routes.js';
import { IdentityFailure } from './product-auth-service.js';
import { ContentReviewFailure, type ContentReviewService } from './content-review-service.js';
import { sendUnauthorized } from './contract-http-errors.js';

export type ContentReviewRouteDependencies = Readonly<{
  service: ContentReviewService;
}>;

function tokenOf(authorization: string | string[] | undefined): string {
  const value = typeof authorization === 'string' ? authorization : undefined;
  const token = bearerToken(value);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new IdentityFailure('SESSION_INVALID');
  return token;
}

export function registerContentReviewRoutes(
  app: FastifyInstance,
  authService: AuthService,
  dependencies?: ContentReviewRouteDependencies,
): void {
  app.register(async (scope) => {
    scope.setErrorHandler((error, _request, reply) => {
      if (error instanceof ContentReviewFailure) {
        return reply.header('cache-control', 'no-store')
          .code(error.code === 'VALIDATION' ? 400 : 409)
          .send(parseContractSchema('CandidateError', {
            error: { code: error.code, message: '内容审核请求未通过校验', details: { reason: error.reason } },
          }));
      }
      return sendIdentityFailure(reply,
        error instanceof IdentityFailure ? error : new IdentityFailure('DEPENDENCY_UNAVAILABLE'));
    });

    scope.get('/v1/admin/content/reviews', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (await authenticateRequestHeaders(authService, request.headers) === null) {
        return sendUnauthorized(reply);
      }
      if (!dependencies) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
      const query = request.query as { cursor?: unknown; limit?: unknown };
      const cursor = query.cursor === undefined ? null : String(query.cursor);
      const limit = query.limit === undefined ? 20 : Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new IdentityFailure('REQUEST_INVALID');
      return dependencies.service.list(tokenOf(request.headers.authorization), cursor, limit);
    });

    scope.get('/v1/admin/content/reviews/:batch_id', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (await authenticateRequestHeaders(authService, request.headers) === null) {
        return sendUnauthorized(reply);
      }
      if (!dependencies) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
      const params = request.params as { batch_id: string };
      const query = request.query as { review_revision?: unknown; after?: unknown; limit?: unknown };
      if (typeof query.review_revision !== 'string') throw new IdentityFailure('REQUEST_INVALID');
      const after = query.after === undefined ? 0 : Number(query.after);
      const limit = query.limit === undefined ? 20 : Number(query.limit);
      if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new IdentityFailure('REQUEST_INVALID');
      }
      return dependencies.service.page(
        tokenOf(request.headers.authorization),
        params.batch_id,
        query.review_revision,
        after,
        limit,
      );
    });

    scope.post('/v1/admin/content/reviews/:batch_id/decisions', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (await authenticateRequestHeaders(authService, request.headers) === null) {
        return sendUnauthorized(reply);
      }
      if (!dependencies) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string' || key.length < 1) throw new IdentityFailure('REQUEST_INVALID');
      const body = validateContractSchema('ReviewDecision', request.body);
      if (!body.ok) throw new IdentityFailure('REQUEST_INVALID');
      return dependencies.service.decide(
        tokenOf(request.headers.authorization),
        (request.params as { batch_id: string }).batch_id,
        key,
        body.value,
      );
    });

    scope.post('/v1/admin/content/reviews/:batch_id/quality-evidence', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (await authenticateRequestHeaders(authService, request.headers) === null) {
        return sendUnauthorized(reply);
      }
      if (!dependencies) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string' || key.length < 1) throw new IdentityFailure('REQUEST_INVALID');
      const body = validateContractSchema('QualityEvidence', request.body);
      if (!body.ok) throw new IdentityFailure('REQUEST_INVALID');
      return dependencies.service.quality(
        tokenOf(request.headers.authorization),
        (request.params as { batch_id: string }).batch_id,
        key,
        body.value,
      );
    });

    scope.post('/v1/admin/content/reviews/:batch_id/resume', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (await authenticateRequestHeaders(authService, request.headers) === null) {
        return sendUnauthorized(reply);
      }
      if (!dependencies) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
      const body = validateContractSchema('ReviewResume', request.body);
      if (!body.ok) throw new IdentityFailure('REQUEST_INVALID');
      return dependencies.service.resume(
        tokenOf(request.headers.authorization),
        (request.params as { batch_id: string }).batch_id,
        body.value.review_revision,
      );
    });

    scope.post('/v1/admin/content/reviews/:batch_id/cancel', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (await authenticateRequestHeaders(authService, request.headers) === null) {
        return sendUnauthorized(reply);
      }
      if (!dependencies) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
      return dependencies.service.cancel(
        tokenOf(request.headers.authorization),
        (request.params as { batch_id: string }).batch_id,
      );
    });
  });
}
