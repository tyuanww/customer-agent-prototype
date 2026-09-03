export type DatabaseContractFailure =
  | 'VALIDATION'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'OVERLOADED'
  | 'INTERNAL';

const OVERLOAD_CODES = new Set([
  '53300',
  '53400',
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
  if (code === 'ZA002' || detail === 'NOT_FOUND') return 'NOT_FOUND';
  if (code === 'ZA003' || code === 'ZA006' || detail === 'CONFLICT') return 'CONFLICT';
  if ((typeof code === 'string' && (code.startsWith('08') || OVERLOAD_CODES.has(code)))) {
    return 'OVERLOADED';
  }
  return 'INTERNAL';
}
