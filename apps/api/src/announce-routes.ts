import type { FastifyInstance, FastifyReply } from 'fastify';
import { parseContractSchema, validateContractSchema } from '@customer-agent/contracts';
import { authenticateRequestHeaders, type AuthService } from './auth-service.js';
import type { AnnounceFailure, AnnounceService } from './announce-service.js';
import {
  sendConflict,
  sendForbiddenOrPolicyDenied,
  sendInternalError,
  sendNotFound,
  sendOverloaded,
  sendSourceGateNotReady,
  sendUnauthorized,
  sendValidationError,
} from './contract-http-errors.js';

export type AnnounceRouteDependencies = Readonly<{
  service: AnnounceService;
}>;

const LEASE_TOKEN_PATTERN = /^osl_[0-9a-f]{64}$/;

function clientId(value: string | undefined): string | null {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 ? value : null;
}

function headerValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function sendAnnounceFailure(reply: FastifyReply, result: AnnounceFailure): FastifyReply {
  reply.header('cache-control', 'no-store');
  if (result.code === 'VALIDATION') {
    return sendValidationError(reply, result.reason === undefined ? undefined : { reason: result.reason });
  }
  if (result.code === 'FORBIDDEN' || result.code === 'POLICY_DENIED') {
    return sendForbiddenOrPolicyDenied(
      reply,
      result.code === 'POLICY_DENIED' ? 'POLICY_DENIED' : 'FORBIDDEN',
      result.reason === undefined ? undefined : { reason: result.reason },
    );
  }
  if (result.code === 'NOT_FOUND') return sendNotFound(reply);
  if (result.code === 'CONFLICT') return sendConflict(reply);
  if (result.code === 'SOURCE_GATE_NOT_READY') return sendSourceGateNotReady(reply);
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

export function registerAnnounceRoutes(
  app: FastifyInstance,
  authService: AuthService,
  dependencies?: AnnounceRouteDependencies,
): void {
  const windows = new Map<string, { start: number; count: number }>();
  function limit(operation: string, maximum: number): boolean {
    const now = performance.now();
    const prior = windows.get(operation);
    const window = prior && now - prior.start < 60_000 ? prior : { start: now, count: 0 };
    windows.set(operation, window);
    return ++window.count <= maximum;
  }

  app.get('/v1/announce/current', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (!limit('current', 60)) return sendRateLimited(reply);
    const snapshotClientId = clientId(headerValue(request.headers['x-client-id']));
    if (snapshotClientId === null) return sendValidationError(reply);
    const leaseToken = headerValue(request.headers['x-snapshot-lease']);
    if (leaseToken !== undefined && !LEASE_TOKEN_PATTERN.test(leaseToken)) return sendValidationError(reply);
    if (dependencies === undefined) return sendOverloaded(reply);
    const ifNoneMatch = headerValue(request.headers['if-none-match']);
    const result = await dependencies.service.current({
      actor,
      clientId: snapshotClientId,
      ...(ifNoneMatch === undefined ? {} : { ifNoneMatch }),
      ...(leaseToken === undefined ? {} : { leaseToken }),
    });
    if (!result.ok) return sendAnnounceFailure(reply, result);
    reply.header('cache-control', 'max-age=10');
    reply.header('etag', result.etag);
    if (result.status === 304) {
      reply.header('x-snapshot-lease', result.leaseToken);
      reply.header('x-snapshot-lease-expires', result.leaseExpiresAt);
      return reply.code(304).send();
    }
    return result.response;
  });

  app.get('/v1/announce/snapshot', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (!limit('snapshot', 60)) return sendRateLimited(reply);
    const snapshotClientId = clientId(headerValue(request.headers['x-client-id']));
    const leaseToken = headerValue(request.headers['x-snapshot-lease']);
    const query = request.query as { release_id?: unknown; cursor?: unknown; limit?: unknown };
    const releaseId = typeof query.release_id === 'string' ? query.release_id : undefined;
    const cursor = query.cursor === undefined ? null : query.cursor;
    const limitValue = query.limit === undefined ? 200 : Number(query.limit);
    if (snapshotClientId === null
      || leaseToken === undefined || !LEASE_TOKEN_PATTERN.test(leaseToken)
      || releaseId === undefined || releaseId.length < 1
      || (cursor !== null && (typeof cursor !== 'string' || cursor.length < 1))
      || !Number.isInteger(limitValue) || limitValue < 1 || limitValue > 500) {
      return sendValidationError(reply);
    }
    if (dependencies === undefined) return sendOverloaded(reply);
    const result = await dependencies.service.snapshot({
      actor,
      clientId: snapshotClientId,
      leaseToken,
      releaseId,
      cursor,
      limit: limitValue,
    });
    if (!result.ok) return sendAnnounceFailure(reply, result);
    return result.response;
  });

  app.post('/v1/announce/ack', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (!limit('ack', 20)) return sendRateLimited(reply);
    const body = validateContractSchema('AnnouncementAckRequest', request.body);
    if (!body.ok) return sendValidationError(reply);
    if (dependencies === undefined) return sendOverloaded(reply);
    const result = await dependencies.service.ack({
      actor,
      clientId: body.value.client_id,
      releaseId: body.value.release_id,
      releaseSeq: body.value.release_seq,
      leaseToken: body.value.offline_lease_token,
    });
    if (!result.ok) return sendAnnounceFailure(reply, result);
    return parseContractSchema('OkResponse', { ok: true });
  });
}
