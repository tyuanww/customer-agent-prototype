import type { AuthenticatedUser } from './auth-service.js';

/** The only session role allowed to drive the historical batch chain. */
export const LEGACY_BATCH_OPERATOR_ROLE = 'owner' as const;

/**
 * The historical batch chain archives a whole content domain and rebuilds it from one
 * upload, and its SQL gates admit any principal holding a domain-scoped grant. The faq-v2
 * candidate path already replaces one source at a time; this chain stays operator-only
 * maintenance rather than a second, wider way for a granted coach to publish.
 *
 * The session role is checked here and the binding role is checked again inside each SQL
 * function. A caller that reaches the function directly, or a token whose role claim
 * disagrees with the binding, must not turn a domain grant into a tenant-wide rewrite.
 */
export function mayOperateLegacyContentBatch(actor: Pick<AuthenticatedUser, 'role'>): boolean {
  return actor.role === LEGACY_BATCH_OPERATOR_ROLE;
}
