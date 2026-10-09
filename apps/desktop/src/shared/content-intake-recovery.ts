import type { ProductErrorCode } from './product-session';

const ROLLED_BACK_CODES: readonly ProductErrorCode[] = ['VALIDATION', 'FORBIDDEN', 'UNAUTHORIZED', 'CONFLICT', 'GONE'];

/** Intake transaction.ts checks and rolls back these failures before COMMIT;
 * failures after COMMIT starts are reported as COMMIT_UNKNOWN. A caller must
 * still distinguish its first write from a later replay of an uncertain write. */
export function isDefinitiveRollback(code: ProductErrorCode, reason?: string): boolean {
  return reason !== 'COMMIT_UNKNOWN' && ROLLED_BACK_CODES.includes(code);
}
