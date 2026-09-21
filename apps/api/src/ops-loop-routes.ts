import type { Readable } from 'node:stream';
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
import { parseSopCsv } from './ops-loop-csv.js';
import type { OpsLoopRepository } from './ops-loop-repository.js';
import { sendOperationFailure } from './operation-result.js';
import type { ApiHmacKeyRing } from './runtime-config.js';

type RetrievalWindow = components['schemas']['RetrievalWindow'];

export type OpsLoopRouteDependencies = Readonly<{
  repository: OpsLoopRepository;
  idempotencyHmac: ApiHmacKeyRing;
}>;

const WINDOWS = new Set<RetrievalWindow>(['current_release', 'last_7d']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOP_UPLOAD_MAX_BYTES = 256 * 1024;

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

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128;
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

async function readLimited(stream: Readable, maxBytes: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

function extractCsvFromMultipart(body: Buffer, contentType: string): string | null {
  const match = contentType.match(/;\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  const token = match?.[1] ?? match?.[2]?.trim();
  if (!token) return null;
  const boundary = Buffer.from(`--${token}`);
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset < body.length) {
    const start = body.indexOf(boundary, offset);
    if (start < 0) break;
    const contentStart = start + boundary.length;
    if (body.subarray(contentStart, contentStart + 2).equals(Buffer.from('--'))) break;
    const next = body.indexOf(boundary, contentStart);
    if (next < 0) break;
    let part = body.subarray(contentStart + 2, next);
    if (part.length >= 2 && part.subarray(part.length - 2).equals(Buffer.from('\r\n'))) {
      part = part.subarray(0, part.length - 2);
    }
    parts.push(part);
    offset = next;
  }
  for (const part of parts) {
    const split = part.indexOf(Buffer.from('\r\n\r\n'));
    if (split < 0) continue;
    const headers = part.subarray(0, split).toString('latin1');
    if (!/name="file"/i.test(headers)) continue;
    return part.subarray(split + 4).toString('utf8');
  }
  return null;
}

export function registerOpsLoopRoutes(
  app: FastifyInstance,
  authService: AuthService,
  dependencies?: OpsLoopRouteDependencies,
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

  app.post('/v1/inaccuracy-reports', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (actor.role !== 'agent' && actor.role !== 'coach' && actor.role !== 'owner') {
      return sendForbiddenOrPolicyDenied(reply, 'FORBIDDEN');
    }
    const key = idempotencyKey(headerValue(request.headers['idempotency-key']));
    if (key === null) return sendValidationError(reply);
    const contract = validateContractSchema('InaccuracyReportRequest', request.body);
    if (!contract.ok) return sendValidationError(reply);
    if (!UUID.test(contract.value.query_id)) return sendValidationError(reply);
    if (dependencies === undefined) return sendOverloaded(reply);
    if (!limit('inaccuracy', actor.user_id, 30)) return sendRateLimited(reply);
    const body: CanonicalJsonValue = {
      query_id: contract.value.query_id,
      script_id: contract.value.script_id,
      ...(contract.value.script_version === undefined ? {} : { script_version: contract.value.script_version }),
      ...(contract.value.rank === undefined ? {} : { rank: contract.value.rank }),
      ...(contract.value.content_hash === undefined ? {} : { content_hash: contract.value.content_hash }),
    };
    const result = await dependencies.repository.recordInaccuracy({
      actor,
      queryId: contract.value.query_id,
      scriptId: contract.value.script_id,
      scriptVersion: contract.value.script_version ?? null,
      rank: contract.value.rank ?? null,
      contentHash: contract.value.content_hash ?? null,
      idempotencyKey: key,
      requestHashes: prepareIdempotencyHashes(body, dependencies.idempotencyHmac),
    });
    if (!result.ok) return sendOperationFailure(reply, result);
    return parseContractSchema('InaccuracyReportResponse', result.response);
  });

  app.get('/v1/sop/catalog', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (!isCoachOrOwner(actor.role)) return sendForbiddenOrPolicyDenied(reply, 'FORBIDDEN');
    if (dependencies === undefined) return sendOverloaded(reply);
    if (!limit('sop-catalog', actor.user_id, 60)) return sendRateLimited(reply);
    const result = await dependencies.repository.readSopCatalog(actor);
    if (!result.ok) return sendOperationFailure(reply, result);
    return parseContractSchema('SopCatalogResponse', result.response);
  });

  app.register(async (scope) => {
    scope.addContentTypeParser('multipart/form-data', (_request, payload, done) => {
      done(null, payload);
    });
    scope.post('/v1/sop/import', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const actor = await authenticateRequestHeaders(authService, request.headers);
      if (actor === null) return sendUnauthorized(reply);
      if (!isCoachOrOwner(actor.role)) return sendForbiddenOrPolicyDenied(reply, 'FORBIDDEN');
      const key = idempotencyKey(headerValue(request.headers['idempotency-key']));
      if (key === null) return sendValidationError(reply);
      const contentType = request.headers['content-type'];
      if (typeof contentType !== 'string') return sendValidationError(reply);
      if (dependencies === undefined) return sendOverloaded(reply);
      if (!limit('sop-import', actor.user_id, 10)) return sendRateLimited(reply);
      const raw = await readLimited(request.body as Readable, SOP_UPLOAD_MAX_BYTES);
      if (raw === null) return sendValidationError(reply);
      const csv = extractCsvFromMultipart(raw, contentType);
      if (csv === null) return sendValidationError(reply);
      const nodes = parseSopCsv(csv);
      if (nodes === null) return sendValidationError(reply);
      const result = await dependencies.repository.importSopCatalog({
        actor,
        nodes,
        idempotencyKey: key,
        requestHashes: prepareIdempotencyHashes(
          { nodes: nodes.map((node) => ({ ...node })) },
          dependencies.idempotencyHmac,
        ),
      });
      if (!result.ok) return sendOperationFailure(reply, result);
      return reply.code(202).send(parseContractSchema('SopImportAccepted', result.response));
    });
  }, { bodyLimit: SOP_UPLOAD_MAX_BYTES + 32 * 1024 });

  app.patch('/v1/sop/nodes/:node_id', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (!isCoachOrOwner(actor.role)) return sendForbiddenOrPolicyDenied(reply, 'FORBIDDEN');
    const nodeId = (request.params as { node_id?: unknown }).node_id;
    if (!isId(nodeId)) return sendValidationError(reply);
    const key = idempotencyKey(headerValue(request.headers['idempotency-key']));
    if (key === null) return sendValidationError(reply);
    const contract = validateContractSchema('SopNodePatch', request.body);
    if (!contract.ok) return sendValidationError(reply);
    if (dependencies === undefined) return sendOverloaded(reply);
    if (!limit('sop-patch', actor.user_id, 30)) return sendRateLimited(reply);
    const result = await dependencies.repository.patchSopNode({
      actor,
      nodeId,
      expectedVersion: contract.value.expected_version,
      title: contract.value.title ?? null,
      body: contract.value.body ?? null,
      sortKey: contract.value.sort_key ?? null,
      idempotencyKey: key,
      requestHashes: prepareIdempotencyHashes(
        {
          expected_version: contract.value.expected_version,
          node_id: nodeId,
          title: contract.value.title ?? null,
          body: contract.value.body ?? null,
          sort_key: contract.value.sort_key ?? null,
        },
        dependencies.idempotencyHmac,
      ),
    });
    if (!result.ok) return sendOperationFailure(reply, result);
    return parseContractSchema('SopNode', result.response);
  });

  app.delete('/v1/sop/nodes/:node_id', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (actor.role !== 'owner') return sendForbiddenOrPolicyDenied(reply, 'FORBIDDEN');
    const nodeId = (request.params as { node_id?: unknown }).node_id;
    if (!isId(nodeId)) return sendValidationError(reply);
    const key = idempotencyKey(headerValue(request.headers['idempotency-key']));
    if (key === null) return sendValidationError(reply);
    const contract = validateContractSchema('SopNodeDelete', request.body);
    if (!contract.ok) return sendValidationError(reply);
    if (dependencies === undefined) return sendOverloaded(reply);
    if (!limit('sop-delete', actor.user_id, 20)) return sendRateLimited(reply);
    const result = await dependencies.repository.deleteSopNode({
      actor,
      nodeId,
      expectedVersion: contract.value.expected_version,
      idempotencyKey: key,
      requestHashes: prepareIdempotencyHashes(
        { expected_version: contract.value.expected_version, node_id: nodeId },
        dependencies.idempotencyHmac,
      ),
    });
    if (!result.ok) return sendOperationFailure(reply, result);
    return parseContractSchema('SopNode', result.response);
  });

  app.patch('/v1/content/scripts/:script_id', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (actor.role !== 'owner') return sendForbiddenOrPolicyDenied(reply, 'FORBIDDEN');
    const scriptId = (request.params as { script_id?: unknown }).script_id;
    if (!isId(scriptId)) return sendValidationError(reply);
    const key = idempotencyKey(headerValue(request.headers['idempotency-key']));
    if (key === null) return sendValidationError(reply);
    const contract = validateContractSchema('ScriptPatchRequest', request.body);
    if (!contract.ok) return sendValidationError(reply);
    if (dependencies === undefined) return sendOverloaded(reply);
    if (!limit('script-patch', actor.user_id, 20)) return sendRateLimited(reply);
    const result = await dependencies.repository.mutateScript({
      actor,
      scriptId,
      action: 'patch',
      expectedVersion: contract.value.expected_version,
      title: contract.value.title,
      answerText: contract.value.answer_text,
      effectiveFrom: contract.value.effective_from,
      effectiveTo: contract.value.effective_to ?? null,
      idempotencyKey: key,
      requestHashes: prepareIdempotencyHashes(
        {
          action: 'patch',
          expected_version: contract.value.expected_version,
          script_id: scriptId,
          title: contract.value.title,
          answer_text: contract.value.answer_text,
          effective_from: contract.value.effective_from,
          effective_to: contract.value.effective_to ?? null,
        },
        dependencies.idempotencyHmac,
      ),
    });
    if (!result.ok) return sendOperationFailure(reply, result);
    return parseContractSchema('ScriptMutationResponse', result.response);
  });

  app.delete('/v1/content/scripts/:script_id', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (actor.role !== 'owner') return sendForbiddenOrPolicyDenied(reply, 'FORBIDDEN');
    const scriptId = (request.params as { script_id?: unknown }).script_id;
    if (!isId(scriptId)) return sendValidationError(reply);
    const key = idempotencyKey(headerValue(request.headers['idempotency-key']));
    if (key === null) return sendValidationError(reply);
    const contract = validateContractSchema('ScriptDeleteRequest', request.body);
    if (!contract.ok) return sendValidationError(reply);
    if (dependencies === undefined) return sendOverloaded(reply);
    if (!limit('script-delete', actor.user_id, 20)) return sendRateLimited(reply);
    const result = await dependencies.repository.mutateScript({
      actor,
      scriptId,
      action: 'delete',
      expectedVersion: contract.value.expected_version,
      title: null,
      answerText: null,
      effectiveFrom: null,
      effectiveTo: null,
      idempotencyKey: key,
      requestHashes: prepareIdempotencyHashes(
        { action: 'delete', expected_version: contract.value.expected_version, script_id: scriptId },
        dependencies.idempotencyHmac,
      ),
    });
    if (!result.ok) return sendOperationFailure(reply, result);
    return parseContractSchema('ScriptMutationResponse', result.response);
  });

  app.get('/v1/metrics/retrieval', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (!isCoachOrOwner(actor.role)) return sendForbiddenOrPolicyDenied(reply, 'FORBIDDEN');
    const window = (request.query as { window?: unknown }).window;
    if (typeof window !== 'string' || !WINDOWS.has(window as RetrievalWindow)) {
      return sendValidationError(reply);
    }
    if (dependencies === undefined) return sendOverloaded(reply);
    if (!limit('retrieval', actor.user_id, 60)) return sendRateLimited(reply);
    const result = await dependencies.repository.readRetrievalMetrics(actor, window as RetrievalWindow);
    if (!result.ok) return sendOperationFailure(reply, result);
    return parseContractSchema('RetrievalMetrics', result.response);
  });

  app.get('/v1/software/releases', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (actor.role !== 'owner') return sendForbiddenOrPolicyDenied(reply, 'FORBIDDEN');
    if (dependencies === undefined) return sendOverloaded(reply);
    if (!limit('software-list', actor.user_id, 30)) return sendRateLimited(reply);
    const result = await dependencies.repository.listSoftwareReleases(actor);
    if (!result.ok) return sendOperationFailure(reply, result);
    return parseContractSchema('SoftwareReleaseList', result.response);
  });

  app.get('/v1/software/releases/current', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (actor.role !== 'owner') return sendForbiddenOrPolicyDenied(reply, 'FORBIDDEN');
    if (dependencies === undefined) return sendOverloaded(reply);
    if (!limit('software-current', actor.user_id, 30)) return sendRateLimited(reply);
    const result = await dependencies.repository.currentSoftwareRelease(actor);
    if (!result.ok) return sendOperationFailure(reply, result);
    return parseContractSchema('SoftwareRelease', result.response);
  });
}
