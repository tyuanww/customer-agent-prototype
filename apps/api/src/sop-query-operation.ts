import type { AuthenticatedUser } from './auth-service.js';
import type { SopQueryReadResult, SopQueryRequest, SopQueryResponse } from './sop-query-model.js';

export type SopQueryFailureCode =
  | 'SCOPE_DENIED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SOP_BLOCKED'
  | 'SOP_STALE'
  | 'SOP_UNAVAILABLE';

export type SopQueryOperationFailure = Readonly<{
  ok: false;
  code: SopQueryFailureCode;
}>;

export type SopQueryReadPort = Readonly<{
  read: (input: Readonly<{
    actor: AuthenticatedUser;
    request: SopQueryRequest;
  }>) => Promise<SopQueryReadResult | SopQueryOperationFailure>;
}>;

export type SopQueryOperation = Readonly<{
  execute: (input: Readonly<{
    actor: AuthenticatedUser;
    request: SopQueryRequest;
  }>) => Promise<SopQueryResponse | SopQueryOperationFailure>;
}>;

/** Binds the server-owned request identity after the read port returns its release result. */
export function createSopQueryOperation(readPort: SopQueryReadPort): SopQueryOperation {
  return {
    async execute(input) {
      const result = await readPort.read(input);
      if ('ok' in result && result.ok === false) return result;
      return { ...result, request_id: input.request.request_id };
    },
  };
}
