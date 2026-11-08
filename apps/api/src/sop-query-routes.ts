import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AuthService, AuthenticatedUser } from './auth-service.js';
import { authenticateRequestHeaders } from './auth-service.js';

export const MENOKIN_SOP_QUERY_CONTRACT_SET_ID =
  'cs-ai-c11-openapi-1.25.0-schema-1.30-0fb1dc76ee2b';

const SOP_GROUPS = new Set([
  '过敏流程SOP',
  '长痘痘SOP',
  '品质售后SOP',
  '少错破SOP',
  '税收相关规则',
]);
const PRODUCT_CONTEXT_TYPES = new Set(['storewide', 'category', 'sku']);
const REASON_CODES = new Set([
  'SCOPE_DENIED',
  'LEASE_EXPIRED',
  'APPROVAL_REVOKED',
  'SOURCE_GATE_NOT_READY',
  'GRAPH_UNRESOLVED',
  'TERMINAL_HAS_OUTGOING_EDGE',
  'SAFETY_REVIEW_REQUIRED',
  'MEDIA_UNVERIFIED',
  'STALE_RELEASE',
  'IDEMPOTENCY_CONFLICT',
]);
const NODE_KINDS = new Set(['instruction', 'decision', 'terminal']);
const RISK_LEVELS = new Set(['unclassified', 'low', 'medium', 'high', 'critical']);
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SHOP_ID = /^[-A-Za-z0-9._:]+$/;

export type SopQueryRequest = Readonly<{
  sop_group: string;
  shop_id: string;
  product_context?: null | Readonly<{ type: string; ref: string }>;
  query_text: string;
  context_generation: string;
  request_id: string;
}>;

export type SopQueryReason = Readonly<{
  code: string;
  source_ref?: string;
}>;

type SopNode = Readonly<{
  node_id: string;
  scenario_id: string;
  sequence: number;
  kind: 'instruction' | 'decision' | 'terminal';
  terminal: boolean;
  source_ref: string;
}>;

type SopBranch = Readonly<{
  branch_id: string;
  source_node_id: string;
  option: string;
  target_node_id: string | null;
  is_unresolved: boolean;
}>;

type SopMessage = Readonly<{
  message_id: string;
  node_id: string;
  title: string;
  body: string;
  risk_level: 'unclassified' | 'low' | 'medium' | 'high' | 'critical';
  copy_allowed: boolean;
}>;

type SopMediaRef = Readonly<{
  media_id: string;
  node_id: string;
  content_type: 'image/png' | 'image/jpeg' | 'image/gif';
  preview_handle: string;
  expires_at: string;
}>;

type SopReadyResult = Readonly<{
  entry_node_id: string;
  nodes: readonly SopNode[];
  branches: readonly SopBranch[];
  messages: readonly SopMessage[];
  media_refs: readonly SopMediaRef[];
}>;

type SopEmptyResult = Readonly<{
  nodes: readonly [];
  branches: readonly [];
  messages: readonly [];
  media_refs: readonly [];
}>;

export type SopQueryResponse =
  | Readonly<{
      status: 'ready';
      request_id: string;
      release_id: string;
      lease_expires_at: string;
      result: SopReadyResult;
      reasons: readonly [];
    }>
  | Readonly<{
      status: 'blocked';
      request_id: string;
      release_id: null;
      lease_expires_at: null;
      result: null;
      reasons: readonly SopQueryReason[];
    }>
  | Readonly<{
      status: 'stale';
      request_id: string;
      release_id: string | null;
      lease_expires_at: null;
      result: null;
      reasons: readonly SopQueryReason[];
    }>
  | Readonly<{
      status: 'no_match';
      request_id: string;
      release_id: string;
      lease_expires_at: string;
      result: SopEmptyResult;
      reasons: readonly [];
    }>;

export type SopQueryFailureCode =
  | 'SCOPE_DENIED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SOP_BLOCKED'
  | 'SOP_STALE'
  | 'SOP_UNAVAILABLE';

export type SopQueryOperation = Readonly<{
  execute: (input: Readonly<{
    actor: AuthenticatedUser;
    request: SopQueryRequest;
  }>) => Promise<SopQueryResponse | Readonly<{ ok: false; code: SopQueryFailureCode }>>;
}>;

export type SopQueryRouteDependencies = Readonly<{
  operation: SopQueryOperation;
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

function isReason(value: unknown): value is SopQueryReason {
  if (!isRecord(value) || !hasOnlyKeys(value, ['code', 'source_ref']) || !REASON_CODES.has(String(value.code))) {
    return false;
  }
  return value.source_ref === undefined || boundedString(value.source_ref, 1, 512);
}

function isNode(value: unknown): value is SopNode {
  return isRecord(value) && hasOnlyKeys(value, ['node_id', 'scenario_id', 'sequence', 'kind', 'terminal', 'source_ref'])
    && boundedString(value.node_id, 1, 256)
    && boundedString(value.scenario_id, 1, 128)
    && typeof value.sequence === 'number' && Number.isSafeInteger(value.sequence)
    && value.sequence >= 0 && value.sequence <= 10000
    && NODE_KINDS.has(String(value.kind))
    && typeof value.terminal === 'boolean'
    && boundedString(value.source_ref, 1, 512);
}

function isBranch(value: unknown): value is SopBranch {
  return isRecord(value) && hasOnlyKeys(value, ['branch_id', 'source_node_id', 'option', 'target_node_id', 'is_unresolved'])
    && boundedString(value.branch_id, 1, 256)
    && boundedString(value.source_node_id, 1, 256)
    && boundedString(value.option, 1, 512)
    && (value.target_node_id === null || boundedString(value.target_node_id, 1, 256))
    && typeof value.is_unresolved === 'boolean';
}

function isMessage(value: unknown): value is SopMessage {
  return isRecord(value) && hasOnlyKeys(value, ['message_id', 'node_id', 'title', 'body', 'risk_level', 'copy_allowed'])
    && boundedString(value.message_id, 1, 256)
    && boundedString(value.node_id, 1, 256)
    && boundedString(value.title, 1, 512)
    && boundedString(value.body, 1, 8192)
    && RISK_LEVELS.has(String(value.risk_level))
    && typeof value.copy_allowed === 'boolean';
}

function isMediaRef(value: unknown): value is SopMediaRef {
  return isRecord(value) && hasOnlyKeys(value, ['media_id', 'node_id', 'content_type', 'preview_handle', 'expires_at'])
    && boundedString(value.media_id, 1, 256)
    && boundedString(value.node_id, 1, 256)
    && MEDIA_TYPES.has(String(value.content_type))
    && boundedString(value.preview_handle, 1, 512)
    && typeof value.expires_at === 'string' && ISO_DATE.test(value.expires_at)
    && !Number.isNaN(Date.parse(value.expires_at));
}

function isReadyResult(value: unknown): value is SopReadyResult {
  return isRecord(value) && hasOnlyKeys(value, ['entry_node_id', 'nodes', 'branches', 'messages', 'media_refs'])
    && boundedString(value.entry_node_id, 1, 256)
    && Array.isArray(value.nodes) && value.nodes.length <= 128 && value.nodes.every(isNode)
    && Array.isArray(value.branches) && value.branches.length <= 512 && value.branches.every(isBranch)
    && Array.isArray(value.messages) && value.messages.length <= 256 && value.messages.every(isMessage)
    && Array.isArray(value.media_refs) && value.media_refs.length <= 500 && value.media_refs.every(isMediaRef);
}

function isEmptyResult(value: unknown): value is SopEmptyResult {
  return isRecord(value) && hasOnlyKeys(value, ['nodes', 'branches', 'messages', 'media_refs'])
    && Array.isArray(value.nodes) && value.nodes.length === 0
    && Array.isArray(value.branches) && value.branches.length === 0
    && Array.isArray(value.messages) && value.messages.length === 0
    && Array.isArray(value.media_refs) && value.media_refs.length === 0;
}

function isSopQueryResponse(value: unknown): value is SopQueryResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'status', 'request_id', 'release_id', 'lease_expires_at', 'result', 'reasons',
  ]) || !UUID.test(String(value.request_id)) || !Array.isArray(value.reasons)
    || value.reasons.length > 8 || !value.reasons.every(isReason)) return false;
  if (value.status === 'ready') {
    return boundedString(value.release_id, 1, 256)
      && typeof value.lease_expires_at === 'string' && ISO_DATE.test(value.lease_expires_at)
      && !Number.isNaN(Date.parse(value.lease_expires_at))
      && isReadyResult(value.result) && value.reasons.length === 0;
  }
  if (value.status === 'blocked') {
    return value.release_id === null && value.lease_expires_at === null
      && value.result === null && value.reasons.length >= 1;
  }
  if (value.status === 'stale') {
    return (value.release_id === null || boundedString(value.release_id, 1, 256))
      && value.lease_expires_at === null && value.result === null && value.reasons.length >= 1;
  }
  if (value.status === 'no_match') {
    return boundedString(value.release_id, 1, 256)
      && typeof value.lease_expires_at === 'string' && ISO_DATE.test(value.lease_expires_at)
      && !Number.isNaN(Date.parse(value.lease_expires_at))
      && isEmptyResult(value.result) && value.reasons.length === 0;
  }
  return false;
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
    if (typeof contractHeader !== 'string' || contractHeader !== MENOKIN_SOP_QUERY_CONTRACT_SET_ID) {
      return sendSopError(reply, 409, 'CONTRACT_UPGRADE_REQUIRED', '请求使用的合同集不受支持', requestIdOf(request.body));
    }
    const parsed = parseRequest(request.body);
    if (parsed === null) return sendSopError(reply, 400, 'CONTRACT_UPGRADE_REQUIRED', '请求体不符合 Menokin SOP 查询合同', requestIdOf(request.body));
    let result: SopQueryResponse | Readonly<{ ok: false; code: SopQueryFailureCode }>;
    try {
      result = await dependencies.operation.execute({ actor, request: parsed });
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
