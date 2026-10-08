import { describe, expect, it } from 'vitest';
import { allocationKinds, recipientRoleAllows } from '../src/content-intake/authority.js';
import type { Principal } from '../src/content-intake/transaction.js';

const actions = ['query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback'] as const;
const actor = (role: Principal['role']): Principal => ({
  id: 'p', userId: 'u', tenantId: 't', appId: 'a', identityScope: 's', personKey: 'k',
  factsVersion: 1, generation: 0, enabled: true, checkedAt: 0, validUntil: 1, role,
});

describe('content intake role ceiling', () => {
  it('allows query for every non-null role and business actions only for the four posts', () => {
    for (const role of ['agent', 'enabler', 'lead', 'supervisor', 'manager', 'director'] as const) {
      expect(recipientRoleAllows(role, 'business', 'query')).toBe(true);
    }
    for (const role of ['agent', 'enabler'] as const) {
      for (const action of actions) if (action !== 'query') expect(recipientRoleAllows(role, 'business', action)).toBe(false);
    }
    for (const role of ['lead', 'supervisor', 'manager', 'director'] as const) {
      for (const action of actions) expect(recipientRoleAllows(role, 'business', action)).toBe(true);
    }
  });

  it('creates delegation only for director and manager, and never from a delegation credential', () => {
    expect(recipientRoleAllows(null, 'business', 'query')).toBe(false);
    expect(recipientRoleAllows(null, 'delegation', 'publish')).toBe(false);
    for (const role of ['agent', 'enabler', 'lead', 'supervisor'] as const) {
      expect(recipientRoleAllows(role, 'delegation', 'publish')).toBe(false);
      expect(allocationKinds(actor(role), 'business')).toEqual([]);
      expect(allocationKinds(actor(role), 'delegation')).toEqual([]);
    }
    for (const role of ['director', 'manager'] as const) {
      expect(recipientRoleAllows(role, 'delegation', 'import')).toBe(true);
      expect(allocationKinds(actor(role), 'delegation')).toEqual(['allocation']);
      expect(allocationKinds(actor(role), 'business')).toEqual(['allocation', 'delegation']);
    }
    expect(allocationKinds(actor(null), 'business')).toEqual([]);
  });
});
