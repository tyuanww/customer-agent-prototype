import type { FastifyReply } from 'fastify';
import {
  sendConflict,
  sendForbiddenOrPolicyDenied,
  sendInternalError,
  sendNotFound,
  sendOverloaded,
  sendSourceGateNotReady,
  sendValidationError,
} from './contract-http-errors.js';

export type OperationFailureCode =
  | 'VALIDATION'
  | 'FORBIDDEN'
  | 'POLICY_DENIED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SOURCE_GATE_NOT_READY'
  | 'OVERLOADED'
  | 'INTERNAL';

export type OperationResult<T> =
  | Readonly<{ ok: true; response: T }>
  | Readonly<{ ok: false; code: OperationFailureCode }>;

export function sendOperationFailure(
  reply: FastifyReply,
  result: Readonly<{ ok: false; code: OperationFailureCode }>,
): FastifyReply {
  if (result.code === 'VALIDATION') return sendValidationError(reply);
  if (result.code === 'FORBIDDEN' || result.code === 'POLICY_DENIED') {
    return sendForbiddenOrPolicyDenied(reply, result.code);
  }
  if (result.code === 'NOT_FOUND') return sendNotFound(reply);
  if (result.code === 'CONFLICT') return sendConflict(reply);
  if (result.code === 'SOURCE_GATE_NOT_READY') return sendSourceGateNotReady(reply);
  if (result.code === 'OVERLOADED') return sendOverloaded(reply);
  return sendInternalError(reply);
}
