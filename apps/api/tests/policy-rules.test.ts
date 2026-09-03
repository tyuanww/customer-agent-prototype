import { describe, expect, it } from 'vitest';
import { authorizePolicyUpdate } from '../src/policy-rules.js';

describe('DEV-M1 Phase 1 policy rules', () => {
  it('denies every non-owner before selecting a database capability', () => {
    expect(authorizePolicyUpdate(
      { user_id: 'usr_synthetic_agent_001', role: 'agent' },
      { flag_key: 'llm_ranker', flag_value: false, adr_id: null },
    )).toEqual({ allowed: false, code: 'FORBIDDEN' });
  });

  it.each(['rewrite', 'auto_send'] as const)(
    'keeps %s hard-off even when an owner supplies ADR evidence',
    (flagKey) => {
      expect(authorizePolicyUpdate(
        { user_id: 'usr_synthetic_owner_001', role: 'owner' },
        { flag_key: flagKey, flag_value: true, adr_id: 'ADR-SYNTHETIC-001' },
      )).toEqual({ allowed: false, code: 'POLICY_DENIED' });
    },
  );

  it('allows only owner updates that still require the admin database adapter', () => {
    expect(authorizePolicyUpdate(
      { user_id: 'usr_synthetic_owner_001', role: 'owner' },
      { flag_key: 'llm_ranker', flag_value: false, adr_id: null },
    )).toEqual({ allowed: true });
  });
});
