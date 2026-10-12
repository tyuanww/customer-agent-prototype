import { describe, expect, it } from 'vitest';
import { syntheticPrincipalLabels } from '../src/content-intake/synthetic-principal-labels.js';

describe('synthetic principal labels', () => {
  it('names the four test identities and refuses anyone else', () => {
    const identity = { tenantId: 'tenant-menokin', appId: 'app-customer-agent' };
    expect(syntheticPrincipalLabels({ ...identity, principalId: 'synthetic_owner' })).toBe('测试总监');
    expect(syntheticPrincipalLabels({ ...identity, principalId: 'synthetic_coach' })).toBe('测试整理人');
    expect(syntheticPrincipalLabels({ ...identity, principalId: 'synthetic_agent' })).toBe('测试坐席');
    expect(syntheticPrincipalLabels({ ...identity, principalId: 'synthetic_quality' })).toBe('测试质检');
    expect(syntheticPrincipalLabels({ ...identity, principalId: 'someone-else' })).toBeNull();
    expect(syntheticPrincipalLabels({ principalId: 'synthetic_owner', tenantId: 'other', appId: 'app-customer-agent' })).toBeNull();
  });
});
