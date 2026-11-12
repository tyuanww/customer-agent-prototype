import { expect, it } from 'vitest';
import { parseAccessDecision } from '@customer-agent/unified-contracts';
import { arcDomain, toArcAccessDecision } from '../src/integration/access.js';
import { createAccessEvaluator, parseAccessSnapshot } from '../src/access/evaluator.js';
import type {
  AccessDecision as ArcAccessDecision,
  AdminAccessView as ArcAdminAccessView,
  DashboardSettingsView as ArcDashboardSettingsView,
  QueryAccessView as ArcQueryAccessView,
} from '../../../packages/unified-contracts/src/index.js';
import type {
  AccessDecision,
  AdminAccessView,
  DashboardSettingsView,
  QueryAccessView,
} from '../src/access/evaluator.js';

type Assignable<Contract, Local extends Contract> = Local;

type DecisionContract = Assignable<ArcAccessDecision, AccessDecision>;
type QueryContract = Assignable<ArcQueryAccessView, QueryAccessView>;
type SettingsContract = Assignable<ArcDashboardSettingsView, DashboardSettingsView>;
type AdminContract = Assignable<ArcAdminAccessView, AdminAccessView>;

it('keeps evaluator projections structurally compatible with the shared contracts', () => {
  const proofs: [DecisionContract?, QueryContract?, SettingsContract?, AdminContract?] = [];
  expect(proofs).toHaveLength(0);
});

const sourceScope = (domain: string) => ({
  kind: 'source', tenantId: 'tenant-a', appId: 'app-a', brandId: 'brand-a',
  shopId: 'shop-a', domain, sourceId: 'source-a',
});
const snapshot = (domain: string) => ({
  present: true, principalId: 'agent', tenantId: 'tenant-a', appId: 'app-a',
  factsVersion: 1, revocationGeneration: 0, policyVersion: 1, storeSetVersion: 1,
  facts: { enabled: true, checkedAt: '2026-11-12T00:00:00Z', validUntil: '2026-11-12T01:00:00Z' },
  roles: ['agent'], roleActions: ['query'], mayAllocate: false,
  accountsManage: { allowed: false, validUntil: null },
  allowedSources: [{ scope: sourceScope(domain), action: 'query', validUntil: '2026-11-12T01:00:00Z' }],
  allocationSources: [{ scope: sourceScope(domain), grantVersion: 1, validUntil: '2026-11-12T01:00:00Z' }],
  evidence: { revokedGrant: false, expiredGrant: false, sourceOutsideSet: false, storeSetChanged: false },
  revisionSeed: 'domain-regression', resolvedAt: '2026-11-12T00:00:00Z',
});

it.each(['product', 'activity', 'after-sale', 'aftersale', 'general', 'sop'])(
  'parses normalized %s source and allocation domains', domain => {
    const parsed = parseAccessSnapshot(snapshot(domain));
    expect(parsed.allowedSources[0]?.scope).toEqual(sourceScope(domain));
    expect(parsed.allocationSources[0]?.scope).toEqual(sourceScope(domain));
  },
);

it.each([
  ['presale', 'product'], ['campaign', 'activity'], ['aftersale', 'after-sale'],
  ['after-sale', 'after-sale'], ['product', 'product'], ['activity', 'activity'],
  ['general', 'general'], ['sop', 'sop'],
])('normalizes SQL source domain %s to %s', (input, expected) => {
  expect(arcDomain(input)).toBe(expected);
});

it.each(['unknown', 'unclassified', 'sop-v2', '', 'toString', '__proto__'])(
  'rejects unsupported source domain %s at both access boundaries', domain => {
    expect(() => arcDomain(domain)).toThrow('RELEASE_SCOPE_DOMAIN_INVALID');
    expect(() => parseAccessSnapshot(snapshot(domain))).toThrow('ACCESS_SNAPSHOT_INVALID');
  },
);

it.each(['sop', 'product'])(
  'expands shop-wide %s authority only to its matching source and domain', async domain => {
    const raw = snapshot(domain);
    const evaluation = await createAccessEvaluator(async () => parseAccessSnapshot({
      ...raw,
      allowedSources: [{ ...raw.allowedSources[0], scope: { ...sourceScope(domain), shopId: null } }],
    })).evaluate('agent');
    const release = parseAccessDecision({
      userId: 'agent', role: 'agent', state: 'allowed',
      allowedScopes: [
        sourceScope(domain),
        { ...sourceScope(domain === 'sop' ? 'product' : 'sop') },
        { ...sourceScope(domain), sourceId: 'other-source' },
      ].map(scope => ({ scope, actions: ['query'], validUntil: '2026-11-12T01:00:00Z' })),
      accessRevision: 1, factsVersion: 1, revocationGeneration: 0, policyVersion: 1, storeSetVersion: 1,
      resolvedAt: '2026-11-12T00:00:00Z', expiresAt: '2026-11-12T01:00:00Z', denyReason: null,
    });
    const decision = toArcAccessDecision(
      { user_id: 'agent', role: 'agent', auth_mode: 'mock' }, evaluation,
      release.allowedScopes.map(item => item.scope),
    );
    expect(decision.allowedScopes).toEqual([{
      scope: sourceScope(domain), actions: ['query'], validUntil: evaluation.decision?.expiresAt,
    }]);
  },
);
