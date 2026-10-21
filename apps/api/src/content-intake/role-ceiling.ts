import type { components } from '@customer-agent/contracts';

type Action = components['schemas']['IntakeAction'];

/** Mirrors `content_intake.role_ceiling` row for row. The SQL table is the single owner of
 * these boundaries; this constant exists only because the directory projection and the
 * grant preview need the answer without a round trip. `role-ceiling.test.ts` compares them,
 * so an edit to either side fails the suite instead of drifting silently.
 *
 * Keep the key order and the arrays exact: the comparison is on values, not on layout. */
export const ROLE_CEILING = Object.freeze({
  director: {
    businessActions: ['query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback'],
    mayAllocate: true, mayDelegate: true, maySkipImportParent: true,
  },
  manager: {
    businessActions: ['query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback'],
    mayAllocate: true, mayDelegate: true, maySkipImportParent: true,
  },
  engineer: {
    businessActions: ['query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback'],
    mayAllocate: true, mayDelegate: true, maySkipImportParent: true,
  },
  supervisor: {
    businessActions: ['query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback'],
    mayAllocate: false, mayDelegate: false, maySkipImportParent: false,
  },
  lead: {
    businessActions: ['query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback'],
    mayAllocate: false, mayDelegate: false, maySkipImportParent: false,
  },
  agent: {
    businessActions: ['query'],
    mayAllocate: false, mayDelegate: false, maySkipImportParent: false,
  },
  enabler: {
    businessActions: ['query'],
    mayAllocate: false, mayDelegate: false, maySkipImportParent: false,
  },
} as const);

export type CeilingRole = keyof typeof ROLE_CEILING;
type CeilingRow = Readonly<{
  businessActions: readonly Action[];
  mayAllocate: boolean;
  mayDelegate: boolean;
  maySkipImportParent: boolean;
}>;

const row = (role: string | null): CeilingRow | null =>
  role !== null && role in ROLE_CEILING ? ROLE_CEILING[role as CeilingRole] as CeilingRow : null;

/** A null role means "no current role", which never authorizes. Mirrors
 *  `content_intake.role_allows`. */
export function roleAllows(role: string | null, action: Action): boolean {
  return row(role)?.businessActions.includes(action) ?? false;
}

export function roleMayAllocate(role: string | null): boolean {
  return row(role)?.mayAllocate ?? false;
}

export function roleMayDelegate(role: string | null): boolean {
  return row(role)?.mayDelegate ?? false;
}

export function roleMaySkipImportParent(role: string | null): boolean {
  return row(role)?.maySkipImportParent ?? false;
}
