import { describe, expect, it } from 'vitest';
import {
  accessRevision,
  decisionAllows,
  projectAdminAccess,
  projectDashboardSettings,
  projectQueryAccess,
  type AccessDecision,
  type AccessSnapshot,
} from '../src/access/evaluator.js';
import { createBoundedDenialAudit } from '../src/access/audit.js';

describe('access projections', () => {
  it('changes the opaque revision for every authority-bearing version group', () => {
    const base = {
      present: true,
      principalId: 'principal-1',
      tenantId: 'tenant-1',
      appId: 'app-1',
      factsVersion: 1,
      revocationGeneration: 0,
      policyVersion: 1,
      storeSetVersion: 1,
      facts: {
        enabled: true,
        checkedAt: '2026-11-05T10:00:00Z',
        validUntil: '2026-11-05T10:04:00Z',
      },
      roles: ['director' as const],
      roleActions: ['query'],
      mayAllocate: false,
      accountsManage: { allowed: false, validUntil: null },
      allowedSources: [{
        scope: {
          kind: 'source' as const,
          tenantId: 'tenant-1',
          appId: 'app-1',
          brandId: 'brand-1',
          shopId: 'shop-1',
          domain: 'product' as const,
          sourceId: 'source-1',
        },
        action: 'query' as const,
        validUntil: '2026-11-05T10:03:00Z',
      }],
      allocationSources: [],
      evidence: {
        revokedGrant: false,
        expiredGrant: false,
        sourceOutsideSet: false,
        storeSetChanged: false,
      },
      revisionSeed: 'revision-1',
      resolvedAt: '2026-11-05T10:00:00Z',
    } as unknown as AccessSnapshot;
    const original = accessRevision(base);
    for (const changed of [
      { ...base, factsVersion: 2 },
      { ...base, revocationGeneration: 1 },
      { ...base, policyVersion: 2 },
      { ...base, storeSetVersion: 2 },
      { ...base, revisionSeed: 'revision-2' },
    ]) {
      expect(accessRevision(changed)).not.toBe(original);
    }
    expect(accessRevision({ ...base, resolvedAt: '2026-11-05T10:01:00Z' })).toBe(original);
  });

  it('exposes only the query fields, never account or grant management fields', () => {
    const decision = {
      userId: 'user-1',
      role: 'director' as const,
      state: 'allowed' as const,
      allowedScopes: [{
        scope: {
          kind: 'source' as const,
          tenantId: 'tenant-1',
          appId: 'app-1',
          brandId: 'brand-1',
          shopId: 'shop-1',
          domain: 'product' as const,
          sourceId: 'source-1',
        },
        actions: ['query', 'grants-manage', 'accounts-manage'] as const,
        validUntil: '2026-11-05T12:00:00Z',
      }],
      accessRevision: 7,
      factsVersion: 3,
      revocationGeneration: 2,
      policyVersion: 5,
      storeSetVersion: 4,
      resolvedAt: '2026-11-05T10:00:00Z',
      expiresAt: '2026-11-05T12:00:00Z',
      denyReason: null,
    } as unknown as AccessDecision;

    const query = projectQueryAccess(decision);
    expect(query).toEqual({
      state: 'allowed',
      scopes: [{ scope: decision.allowedScopes[0]!.scope, validUntil: '2026-11-05T12:00:00Z' }],
      accessRevision: 7,
      factsVersion: 3,
      revocationGeneration: 2,
      policyVersion: 5,
      storeSetVersion: 4,
      expiresAt: '2026-11-05T12:00:00Z',
      denyReason: null,
    });
    expect(Object.keys(query).sort()).toEqual([
      'accessRevision', 'denyReason', 'expiresAt', 'factsVersion',
      'policyVersion', 'revocationGeneration', 'scopes', 'state', 'storeSetVersion',
    ]);

    const settings = projectDashboardSettings(decision);
    expect(settings).toEqual({
      state: 'open',
      grants: 'open',
      accounts: 'open',
      accessRevision: 7,
      expiresAt: '2026-11-05T12:00:00Z',
      denyReason: null,
    });
    expect(Object.keys(settings).sort()).toEqual([
      'accessRevision', 'accounts', 'denyReason', 'expiresAt', 'grants', 'state',
    ]);

    const admin = projectAdminAccess(decision);
    expect(admin.role).toBe('director');
    expect(admin.grants.state).toBe('open');
    expect(admin.accounts.state).toBe('open');
    expect(decisionAllows(decision, ['accounts-manage'])).toBe(true);
    expect(decisionAllows(decision, ['publish'])).toBe(false);
  });

  it('keeps grants and account settings independently open', () => {
    const base = {
      userId: 'user-1',
      role: 'manager' as const,
      state: 'allowed' as const,
      accessRevision: 8,
      factsVersion: 2,
      revocationGeneration: 1,
      policyVersion: 2,
      storeSetVersion: 1,
      resolvedAt: '2026-11-05T10:00:00Z',
      expiresAt: '2026-11-05T11:00:00Z',
      denyReason: null,
    };
    const grantOnly = {
      ...base,
      allowedScopes: [{
        scope: { kind: 'tenant' as const, tenantId: 't', appId: 'a' },
        actions: ['grants-manage'] as const,
        validUntil: '2026-11-05T11:00:00Z',
      }],
    } as unknown as AccessDecision;
    expect(projectDashboardSettings(grantOnly)).toMatchObject({
      state: 'open', grants: 'open', accounts: 'closed',
    });
    const accountOnly = {
      ...base,
      allowedScopes: [{
        scope: { kind: 'tenant' as const, tenantId: 't', appId: 'a' },
        actions: ['accounts-manage'] as const,
        validUntil: '2026-11-05T11:05:00Z',
      }],
    } as unknown as AccessDecision;
    expect(projectDashboardSettings(accountOnly)).toMatchObject({
      state: 'open', grants: 'closed', accounts: 'open',
    });
  });
});

describe('bounded denial audit', () => {
  it('deduplicates within the window and caps the number of live keys', () => {
    let now = 1_000;
    const records: string[] = [];
    const audit = createBoundedDenialAudit({
      maxEntries: 2,
      windowMs: 10_000,
      now: () => now,
      write: (entry) => records.push(`${entry.actorHash}:${entry.route}:${entry.accessRevision}:${entry.reason}`),
    });
    const base = {
      actorUserId: 'user-1',
      route: 'POST /v1/search',
      accessRevision: 4,
      reason: 'REVOKED_GRANT' as const,
    };
    audit.record(base);
    audit.record(base);
    audit.record({ ...base, route: 'POST /v1/events/adoption' });
    audit.record({ ...base, route: 'POST /v1/events/escalate' });
    expect(records).toHaveLength(3);
    expect(audit.size()).toBe(2);
    now += 10_001;
    audit.record(base);
    expect(records).toHaveLength(4);
  });
});
