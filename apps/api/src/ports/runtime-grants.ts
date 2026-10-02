/**
 * Privilege rows the runtime role must hold before a feature is trustworthy.
 *
 * Features name their own relations and functions. The readiness probe is the
 * only place that turns these rows into the single ACL statement. Keeping the
 * shape here stops each feature from learning SQL quoting or the proof query.
 *
 * This is not a shared package. The rows are customer-agent schema grants, and
 * a shared package must not carry this product's relations or function names.
 */

export type RuntimeRelationGrant = readonly [relation: string, privilege: 'SELECT' | 'INSERT'];

export type RuntimeColumnGrant = readonly [
  relation: string,
  column: string,
  privilege: 'SELECT',
];

export type RuntimeFunctionGrant = string;
