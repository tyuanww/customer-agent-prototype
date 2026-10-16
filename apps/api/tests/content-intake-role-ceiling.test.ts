import { describe, expect, it } from 'vitest';
import { allocationKinds, previewGrants, recipientRoleAllows } from '../src/content-intake/authority.js';
import { IntakeRejection, type IntakeTransaction, type Principal } from '../src/content-intake/transaction.js';

const actions = ['query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback'] as const;
const now = Date.now();
const actor = (role: Principal['role']): Principal => ({
  id: 'p', userId: 'u', tenantId: 'tenant-a', appId: 'app-a', identityScope: 'confirmed-synthetic', personKey: 'k',
  factsVersion: 1, generation: 0, enabled: true, checkedAt: now - 1_000, validUntil: now + 60_000, role,
});

describe('content intake role ceiling', () => {
  it('allows query for every non-null role and business actions only for the four posts', () => {
    for (const role of ['agent', 'enabler', 'lead', 'supervisor', 'manager', 'director', 'engineer'] as const) {
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
    for (const action of actions) {
      expect(recipientRoleAllows('engineer', 'business', action)).toBe(true);
      expect(recipientRoleAllows('engineer', 'delegation', action)).toBe(true);
    }
    expect(allocationKinds(actor('engineer'), 'delegation')).toEqual(['allocation']);
    expect(allocationKinds(actor('engineer'), 'business')).toEqual(['allocation', 'delegation']);
  });

  it('prepares an import business grant without a parent row for director, manager, and engineer', async () => {
    const scope = { tenantId: 'tenant-a', appId: 'app-a', brandId: 'brand-a', shopId: 'shop-a', domain: 'product' as const, sourceId: 'source-a' };
    const now = Date.now();
    const person = (id: string, role: Principal['role'], personKey: string) => ({
      principal_id: id, user_id: `user-${id}`, tenant_id: 'tenant-a', app_id: 'app-a',
      identity_scope: 'confirmed-synthetic', person_key: personKey, current_facts_version: '1',
      revocation_generation: '0', enabled: true, checked_at: new Date(now - 1_000),
      valid_until: new Date(now + 60_000), roles: role === null ? [] : [role],
    });
    const client = (issuerRole: Principal['role'], recipientRole: Principal['role'], recipientId: string): IntakeTransaction => ({
      validUntil() {},
      beforeCommit() {},
      query: (async (sql: string, params?: unknown[]) => {
        if (sql.includes('policy_versions')) return { rows: [{ version: '1' }] };
        if (sql.includes('clock_timestamp() AS time')) return { rows: [{ time: new Date(now) }] };
        if (sql.includes('AS roles')) {
          const id = String(params?.[0]);
          const role = id === 'issuer' ? issuerRole : recipientRole;
          const key = id === 'issuer' || id === recipientId && recipientId === 'issuer' ? 'person-issuer' : `person-${id}`;
          return { rows: [person(id, role, id === 'issuer' ? 'person-issuer' : key)] };
        }
        if (sql.includes('FROM content_intake.scopes')) return { rows: [{ scope_id: 'scope-a' }] };
        if (sql.includes('grant_id,expires_at')) return { rows: [] };
        return { rows: [] };
      }) as IntakeTransaction['query'],
    });
    const request = (recipientId: string) => ({
      operationId: 'grant-import', issuerFactsVersion: 1, policyVersion: 1,
      items: [{ kind: 'business' as const, recipientPrincipalId: recipientId, recipientFactsVersion: 1,
        action: 'import' as const, scope, startsAt: new Date(now - 1_000).toISOString(),
        expiresAt: new Date(now + 60_000).toISOString(), reason: '上传授权' }],
    });
    for (const role of ['director', 'manager', 'engineer'] as const) {
      const prepared = await previewGrants(client(role, 'lead', 'lead-1'), actor(role), request('lead-1'));
      expect(prepared.items).toHaveLength(1);
      expect(prepared.items[0]).toMatchObject({ kind: 'business', action: 'import', recipientPrincipalId: 'lead-1' });
    }
    await expect(previewGrants(client('supervisor', 'lead', 'lead-1'), actor('supervisor'), request('lead-1')))
      .rejects.toMatchObject({ reason: 'REDELEGATION_DENIED' });
    await expect(previewGrants(client('director', 'director', 'issuer'), { ...actor('director'), id: 'issuer', personKey: 'person-issuer' }, request('issuer')))
      .rejects.toBeInstanceOf(IntakeRejection);
    await expect(previewGrants(client('director', 'director', 'issuer'), { ...actor('director'), id: 'issuer', personKey: 'person-issuer' }, request('issuer')))
      .rejects.toMatchObject({ reason: 'SELF_ESCALATION' });
    for (const role of ['agent', 'enabler'] as const) {
      expect(recipientRoleAllows(role, 'business', 'import')).toBe(false);
      expect(recipientRoleAllows(role, 'business', 'publish')).toBe(false);
    }
  });
});
