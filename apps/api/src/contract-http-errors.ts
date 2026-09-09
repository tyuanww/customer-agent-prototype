import type { FastifyReply } from 'fastify';
import { parseContractSchema } from '@customer-agent/contracts';

const VALIDATION_ERROR_CODES = new Set([
  'FST_ERR_CTP_BODY_TOO_LARGE',
  'FST_ERR_CTP_EMPTY_JSON_BODY',
  'FST_ERR_CTP_INVALID_CONTENT_LENGTH',
  'FST_ERR_CTP_INVALID_JSON_BODY',
  'FST_ERR_CTP_INVALID_MEDIA_TYPE',
]);

export function sendValidationError(
  reply: FastifyReply,
  details?: Readonly<Record<string, unknown>>,
): FastifyReply {
  return reply.code(400).send(parseContractSchema('ValidationErrorEnvelope', {
    error: {
      code: 'VALIDATION',
      message: '请求不符合已冻结合同',
      ...(details === undefined ? {} : { details }),
    },
  }));
}

export function sendUnauthorized(reply: FastifyReply): FastifyReply {
  reply.header('www-authenticate', 'Bearer');
  return reply.code(401).send(parseContractSchema('UnauthorizedErrorEnvelope', {
    error: {
      code: 'UNAUTHORIZED',
      message: '缺少或无法验证会话',
    },
  }));
}

export function sendOverloaded(reply: FastifyReply): FastifyReply {
  reply.header('retry-after', '1');
  return reply.code(503).send(parseContractSchema('OverloadedErrorEnvelope', {
    error: {
      code: 'OVERLOADED',
      message: '服务暂不可用',
    },
  }));
}

export function sendSourceGateNotReady(reply: FastifyReply): FastifyReply {
  reply.header('retry-after', '1');
  return reply.code(503).send(parseContractSchema('OverloadedErrorEnvelope', {
    error: {
      code: 'OVERLOADED',
      message: '当前内容来源校验未通过',
      details: {
        reason: 'SOURCE_GATE_NOT_READY',
        retry_after_sec: 1,
      },
    },
  }));
}

export function sendNotFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send(parseContractSchema('NotFoundErrorEnvelope', {
    error: { code: 'NOT_FOUND', message: '指定资源不存在' },
  }));
}

export function sendConflict(reply: FastifyReply): FastifyReply {
  return reply.code(409).send(parseContractSchema('ConflictErrorEnvelope', {
    error: { code: 'CONFLICT', message: '请求与当前状态冲突' },
  }));
}

export function sendForbiddenOrPolicyDenied(
  reply: FastifyReply,
  code: 'FORBIDDEN' | 'POLICY_DENIED',
  details?: Readonly<Record<string, unknown>>,
): FastifyReply {
  return reply.code(403).send(parseContractSchema('ForbiddenOrPolicyDeniedErrorEnvelope', {
    error: {
      code,
      message: code === 'FORBIDDEN'
        ? '当前身份无权访问该资源或执行此操作'
        : 'Phase 1 禁止启用该策略',
      ...(details === undefined ? {} : { details }),
    },
  }));
}

export function sendInternalError(reply: FastifyReply): FastifyReply {
  return reply.code(500).send(parseContractSchema('InternalErrorEnvelope', {
    error: {
      code: 'INTERNAL',
      message: '服务内部错误',
    },
  }));
}

export function isRequestBodyValidationError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' && VALIDATION_ERROR_CODES.has(code);
}
