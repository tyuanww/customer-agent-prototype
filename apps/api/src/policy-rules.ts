import type { components } from '@customer-agent/contracts/generated';

type UserClaims = components['schemas']['UserClaims'];
type PolicyFlagUpdateRequest = components['schemas']['PolicyFlagUpdateRequest'];

export type PolicyUpdateDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; code: 'FORBIDDEN' | 'POLICY_DENIED' }>;

const PHASE1_HARD_OFF_FLAGS = new Set<PolicyFlagUpdateRequest['flag_key']>([
  'rewrite',
  'auto_send',
]);

/**
 * This pure gate owns policy authorization before an admin database capability
 * is selected. ADR evidence never permits Phase 1 hard-off flags to cross the
 * lifecycle boundary.
 */
export function authorizePolicyUpdate(
  actor: UserClaims,
  update: PolicyFlagUpdateRequest,
): PolicyUpdateDecision {
  if (actor.role !== 'owner') {
    return Object.freeze({ allowed: false, code: 'FORBIDDEN' });
  }
  if (update.flag_value && PHASE1_HARD_OFF_FLAGS.has(update.flag_key)) {
    return Object.freeze({ allowed: false, code: 'POLICY_DENIED' });
  }
  return Object.freeze({ allowed: true });
}
