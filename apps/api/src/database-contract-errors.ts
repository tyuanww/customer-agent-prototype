export type DatabaseContractFailure =
  | 'VALIDATION'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'OVERLOADED'
  | 'INTERNAL';

const OVERLOAD_CODES = new Set([
  '40001',
  '40P01',
  '53300',
  '53400',
  '55P03',
  '57014',
  '57P01',
  '57P02',
  '57P03',
]);

/**
 * Collapse PostgreSQL failures to the frozen HTTP vocabulary. Raw SQL,
 * parameters, server messages and connection details never cross this port.
 */
export function mapDatabaseContractError(error: unknown): DatabaseContractFailure {
  if (error === null || typeof error !== 'object') return 'INTERNAL';
  const code = Reflect.get(error, 'code');
  const detail = Reflect.get(error, 'detail');
  if (code === 'ZA001' || detail === 'VALIDATION' || detail === 'SEARCH_SCOPE_INVALID') {
    return 'VALIDATION';
  }
  if (code === 'ZA005' || detail === 'FORBIDDEN' || detail === 'POLICY_DENIED') {
    return 'FORBIDDEN';
  }
  if (code === '42501') return 'FORBIDDEN';
  if (code === 'ZA002' || code === '23503' || detail === 'NOT_FOUND') return 'NOT_FOUND';
  if (code === 'ZA003' || code === 'ZA006' || code === '23505'
    || detail === 'CONFLICT' || detail === 'IDEMPOTENCY_BODY_MISMATCH'
    || detail === 'IDEMPOTENCY_IN_FLIGHT' || detail === 'IDEMPOTENCY_LEASE_LOST') {
    return 'CONFLICT';
  }
  if (code === '23514') return 'VALIDATION';
  if ((typeof code === 'string' && (code.startsWith('08') || OVERLOAD_CODES.has(code)))) {
    return 'OVERLOADED';
  }
  return 'INTERNAL';
}
