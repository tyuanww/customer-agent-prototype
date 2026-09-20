import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  parseContractSchema,
  validateContractSchema,
  type components,
} from '@customer-agent/contracts';
import { authenticateRequestHeaders, type AuthService } from './auth-service.js';
import {
  sendForbiddenOrPolicyDenied,
  sendOverloaded,
  sendUnauthorized,
  sendValidationError,
} from './contract-http-errors.js';
import { prepareIdempotencyHashes, type CanonicalJsonValue } from './idempotency.js';
import type {
  IterationTaskRepository,
  IterationTaskListQuery,
} from './iteration-task-repository.js';
import { sendOperationFailure } from './operation-result.js';
import type { ApiHmacKeyRing } from './runtime-config.js';

type IterationTaskStatus = components['schemas']['IterationTaskStatus'];

export type IterationTaskRouteDependencies = Readonly<{
  repository: IterationTaskRepository;
  idempotencyHmac: ApiHmacKeyRing;
}>;

const STATUSES = new Set<IterationTaskStatus>(['open', 'in_progress', 'resolved', 'wont_fix']);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function isCoachOrOwner(role: string): boolean {
  return role === 'coach' || role === 'owner';
}

function headerValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function idempotencyKey(value: string | readonly string[] | undefined): string | null {
  if (typeof value !== 'string' || value.length > 255 || value.trim().length === 0) return null;
  return value;
}

function isTaskId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128;
}

function singleQuery(value: unknown): string | undefined | false {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : false;
}

function parseLimit(value: unknown): number | null {
  if (value === undefined) return DEFAULT_LIMIT;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) return null;
  return parsed;
}

function decodeCursor(cursor: string): { createdAt: string; taskId: string } | null {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (Buffer.from(decoded, 'utf8').toString('base64url') !== cursor) return null;
  const separator = decoded.indexOf('|');
  if (separator < 1) return null;
  const createdAt = decoded.slice(0, separator);
  const taskId = decoded.slice(separator + 1);
  if (!isTaskId(taskId) || !Number.isFinite(Date.parse(createdAt))) return null;
  return { createdAt, taskId };
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

function startBody(taskId: string, expectedVersion: number): CanonicalJsonValue {
  return { expected_version: expectedVersion, task_id: taskId };
}

function closeBody(
  taskId: string,
  expectedVersion: number,
  status: string,
  resolutionNote: string,
): CanonicalJsonValue {
  return {
    expected_version: expectedVersion,
    status,
    resolution_note: resolutionNote,
    task_id: taskId,
  };
}

export function registerIterationTaskRoutes(
  app: FastifyInstance,
  authService: AuthService,
  dependencies?: IterationTaskRouteDependencies,
): void {
  const windows = new Map<string, { start: number; count: number }>();
  function limit(operation: string, userId: string, maximum: number): boolean {
    const now = performance.now();
    const key = `${operation}:${userId}`;
    const prior = windows.get(key);
    const window = prior && now - prior.start < 60_000 ? prior : { start: now, count: 0 };
    windows.set(key, window);
    return ++window.count <= maximum;
  }

  app.get('/v1/metrics/iteration-tasks', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (!isCoachOrOwner(actor.role)) return sendForbiddenOrPolicyDenied(reply, 'FORBIDDEN');
    const query = request.query as {
      status?: unknown;
      signal_id?: unknown;
      assignee_role?: unknown;
      cursor?: unknown;
      limit?: unknown;
    };
    const statusValue = singleQuery(query.status);
    const signalId = singleQuery(query.signal_id);
    const assigneeRole = singleQuery(query.assignee_role);
    const cursorValue = singleQuery(query.cursor);
    const pageLimit = parseLimit(query.limit);
    if (statusValue === false || signalId === false || assigneeRole === false || cursorValue === false) {
      return sendValidationError(reply);
    }
    if (statusValue !== undefined && !STATUSES.has(statusValue as IterationTaskStatus)) {
      return sendValidationError(reply);
    }
    if (signalId !== undefined && (signalId.length < 1 || signalId.length > 128)) {
      return sendValidationError(reply);
    }
    if (assigneeRole !== undefined && (assigneeRole.length < 1 || assigneeRole.length > 128)) {
      return sendValidationError(reply);
    }
    if (cursorValue !== undefined && cursorValue.length < 1) return sendValidationError(reply);
    const cursor = cursorValue === undefined ? null : decodeCursor(cursorValue);
    if (cursorValue !== undefined && cursor === null) return sendValidationError(reply);
    if (pageLimit === null) return sendValidationError(reply);
    if (dependencies === undefined) return sendOverloaded(reply);
    if (!limit('list', actor.user_id, 60)) return sendRateLimited(reply);
    const listQuery: IterationTaskListQuery = {
      limit: pageLimit,
      ...(statusValue === undefined ? {} : { status: statusValue as IterationTaskStatus }),
      ...(signalId === undefined ? {} : { signalId }),
      ...(assigneeRole === undefined ? {} : { assigneeRole }),
      ...(cursor === null ? {} : { cursorCreatedAt: cursor.createdAt, cursorTaskId: cursor.taskId }),
    };
    const result = await dependencies.repository.list(listQuery, actor);
    if (!result.ok) return sendOperationFailure(reply, result);
    return parseContractSchema('IterationTaskListResponse', result.response);
  });

  app.post('/v1/events/iteration-tasks/:task_id/start', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (!isCoachOrOwner(actor.role)) return sendForbiddenOrPolicyDenied(reply, 'FORBIDDEN');
    const taskId = (request.params as { task_id?: unknown }).task_id;
    if (!isTaskId(taskId)) return sendValidationError(reply);
    const key = idempotencyKey(headerValue(request.headers['idempotency-key']));
    if (key === null) return sendValidationError(reply);
    const contract = validateContractSchema('IterationTaskStartRequest', request.body);
    if (!contract.ok) return sendValidationError(reply);
    if (dependencies === undefined) return sendOverloaded(reply);
    if (!limit('start', actor.user_id, 20)) return sendRateLimited(reply);
    const result = await dependencies.repository.start({
      actor,
      taskId,
      expectedVersion: contract.value.expected_version,
      idempotencyKey: key,
      requestHashes: prepareIdempotencyHashes(
        startBody(taskId, contract.value.expected_version),
        dependencies.idempotencyHmac,
      ),
    });
    if (!result.ok) return sendOperationFailure(reply, result);
    return parseContractSchema('IterationTask', result.response);
  });

  app.post('/v1/events/iteration-tasks/:task_id/close', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (!isCoachOrOwner(actor.role)) return sendForbiddenOrPolicyDenied(reply, 'FORBIDDEN');
    const taskId = (request.params as { task_id?: unknown }).task_id;
    if (!isTaskId(taskId)) return sendValidationError(reply);
    const key = idempotencyKey(headerValue(request.headers['idempotency-key']));
    if (key === null) return sendValidationError(reply);
    const contract = validateContractSchema('IterationTaskCloseRequest', request.body);
    if (!contract.ok) return sendValidationError(reply);
    if (dependencies === undefined) return sendOverloaded(reply);
    if (!limit('close', actor.user_id, 20)) return sendRateLimited(reply);
    const result = await dependencies.repository.close({
      actor,
      taskId,
      expectedVersion: contract.value.expected_version,
      status: contract.value.status,
      resolutionNote: contract.value.resolution_note,
      idempotencyKey: key,
      requestHashes: prepareIdempotencyHashes(
        closeBody(
          taskId,
          contract.value.expected_version,
          contract.value.status,
          contract.value.resolution_note,
        ),
        dependencies.idempotencyHmac,
      ),
    });
    if (!result.ok) return sendOperationFailure(reply, result);
    return parseContractSchema('IterationTask', result.response);
  });
}
