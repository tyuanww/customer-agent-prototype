import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AuthService } from './auth-service.js';
import { authenticateRequestHeaders } from './auth-service.js';
import { authenticatedProductSession } from './product-auth-service.js';
import { validateContractSchema } from '@customer-agent/contracts/sop-unified';
import { SOP_UNIFIED_QUERY_CONTRACT_SET_ID, type UnifiedSopQueryOperation } from './sop-unified-query-model.js';
import { parseUnifiedSopQueryResponse } from './sop-unified-query-validation.js';
import type { SopQueryOperation, SopQueryFailureCode } from './sop-query-operation.js';
import { isSopQueryResponse } from './sop-query-validation.js';
import {
  MENOKIN_SOP_QUERY_CONTRACT_SET_ID,
  type SopQueryRequest,
  type SopQueryResponse,
} from './sop-query-model.js';

const SOP_GROUPS = new Set([
  '过敏流程SOP',
  '长痘痘SOP',
  '品质售后SOP',
  '少错破SOP',
  '税收相关规则',
]);
const PRODUCT_CONTEXT_TYPES = new Set(['storewide', 'category', 'sku']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHOP_ID = /^[-A-Za-z0-9._:]+$/;

export type {
  SopQueryFailureCode,
  SopQueryOperation,
} from './sop-query-operation.js';
export type { SopQueryRequest, SopQueryResponse } from './sop-query-model.js';

export type SopQueryRouteDependencies = Readonly<{
  operation?: SopQueryOperation;
  unifiedOperation?: UnifiedSopQueryOperation;
}>;

type RecordValue = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

function hasOnlyKeys(value: RecordValue, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseRequest(value: unknown): SopQueryRequest | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'sop_group', 'shop_id', 'product_context', 'query_text', 'context_generation', 'request_id',
  ])) return null;
  if (!SOP_GROUPS.has(String(value.sop_group))
    || !boundedString(value.shop_id, 1, 128) || !SHOP_ID.test(value.shop_id)
    || !boundedString(value.query_text, 1, 2048) || !/\S/.test(value.query_text)
    || !boundedString(value.context_generation, 1, 128) || !/\S/.test(value.context_generation)
    || typeof value.request_id !== 'string' || !UUID.test(value.request_id)) return null;
  if (value.product_context !== undefined && value.product_context !== null) {
    if (!isRecord(value.product_context)
      || !hasOnlyKeys(value.product_context, ['type', 'ref'])
      || !PRODUCT_CONTEXT_TYPES.has(String(value.product_context.type))
      || !boundedString(value.product_context.ref, 1, 256)) return null;
  }
  const productContext = value.product_context === undefined
    ? undefined
    : value.product_context === null
      ? null
      : {
          type: value.product_context.type as string,
          ref: value.product_context.ref as string,
        };
  return Object.freeze({
    sop_group: value.sop_group as string,
    shop_id: value.shop_id,
    ...(productContext === undefined ? {} : { product_context: productContext }),
    query_text: value.query_text,
    context_generation: value.context_generation,
    request_id: value.request_id,
  });
}

function errorBody(code: string, message: string, requestId?: string): Record<string, unknown> {
  return {
    code,
    message,
    ...(requestId === undefined ? {} : { request_id: requestId }),
  };
}

function sendSopError(
  reply: FastifyReply,
  statusCode: 400 | 401 | 403 | 409 | 422 | 503,
  code: string,
  message: string,
  requestId?: string,
): FastifyReply {
  return reply.code(statusCode).send(errorBody(code, message, requestId));
}

function requestIdOf(value: unknown): string | undefined {
  return isRecord(value) && typeof value.request_id === 'string' && UUID.test(value.request_id)
    ? value.request_id
    : undefined;
}

function sendOperationFailure(reply: FastifyReply, failure: Readonly<{ ok: false; code: SopQueryFailureCode }>): FastifyReply {
  switch (failure.code) {
    case 'SCOPE_DENIED': return sendSopError(reply, 403, 'SCOPE_DENIED', '当前主体没有该店铺或 SOP 查询资格');
    case 'IDEMPOTENCY_CONFLICT': return sendSopError(reply, 409, 'IDEMPOTENCY_CONFLICT', '同一请求编号对应的请求内容冲突');
    case 'SOP_BLOCKED': return sendSopError(reply, 422, 'SOP_BLOCKED', '当前 SOP 不能安全提供');
    case 'SOP_STALE': return sendSopError(reply, 409, 'SOP_STALE', '当前 SOP release 已失效');
    case 'SOP_UNAVAILABLE': return sendSopError(reply, 503, 'SOP_UNAVAILABLE', '当前 SOP 服务不可用');
  }
}

export function registerSopQueryRoute(
  app: FastifyInstance,
  authService: AuthService,
  dependencies?: SopQueryRouteDependencies,
): void {
  if (dependencies === undefined) return;
  app.post('/v1/sop/query', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) {
      reply.header('www-authenticate', 'Bearer');
      return sendSopError(reply, 401, 'SCOPE_DENIED', '缺少或无法验证产品会话');
    }
    const contractHeader = request.headers['x-intake-contract-set'];
    if (contractHeader === SOP_UNIFIED_QUERY_CONTRACT_SET_ID && dependencies.unifiedOperation) {
      const parsed = validateContractSchema('MenokinSopQuerySopQueryRequest', request.body);
      if (!parsed.ok) return sendSopError(reply, 400, 'CONTRACT_UPGRADE_REQUIRED', '请求体不符合 SOP 查询合同', requestIdOf(request.body));
      try {
        const result = await dependencies.unifiedOperation.execute({ actor, request: parsed.value });
        if ('ok' in result) return sendOperationFailure(reply, result);
        const value = parseUnifiedSopQueryResponse(result, parsed.value.request_id);
        reply.header('x-intake-contract-set', SOP_UNIFIED_QUERY_CONTRACT_SET_ID);
        return reply.code(200).send(value);
      } catch {
        return sendSopError(reply, 503, 'SOP_UNAVAILABLE', '当前 SOP 服务不可用', parsed.value.request_id);
      }
    }
    if (typeof contractHeader !== 'string' || contractHeader !== MENOKIN_SOP_QUERY_CONTRACT_SET_ID) {
      return sendSopError(reply, 409, 'CONTRACT_UPGRADE_REQUIRED', '请求使用的合同集不受支持', requestIdOf(request.body));
    }
    if (!dependencies.operation) return sendSopError(reply, 409, 'CONTRACT_UPGRADE_REQUIRED', '请求使用的合同集不受支持', requestIdOf(request.body));
    const parsed = parseRequest(request.body);
    if (parsed === null) return sendSopError(reply, 400, 'CONTRACT_UPGRADE_REQUIRED', '请求体不符合 Menokin SOP 查询合同', requestIdOf(request.body));
    let result: SopQueryResponse | Readonly<{ ok: false; code: SopQueryFailureCode }>;
    try {
      result = await dependencies.operation.execute({
        actor,
        request: parsed,
        session_token_hash: authenticatedProductSession(actor),
      });
    } catch {
      return sendSopError(reply, 503, 'SOP_UNAVAILABLE', '当前 SOP 服务不可用', parsed.request_id);
    }
    if ('ok' in result && result.ok === false) return sendOperationFailure(reply, result);
    if (!isSopQueryResponse(result)) {
      return sendSopError(reply, 503, 'SOP_UNAVAILABLE', '当前 SOP 服务不可用', parsed.request_id);
    }
    if (result.request_id !== parsed.request_id) {
      return sendSopError(reply, 503, 'SOP_UNAVAILABLE', '当前 SOP 服务不可用', parsed.request_id);
    }
    reply.header('x-intake-contract-set', MENOKIN_SOP_QUERY_CONTRACT_SET_ID);
    return reply.code(200).send(result);
  });
}
