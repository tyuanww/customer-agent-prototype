import { createHash } from 'node:crypto';
import type { AccessAction } from './policy.js';

export const ACCESS_ROLES = [
  'agent',
  'director',
  'enabler',
  'engineer',
  'lead',
  'manager',
  'supervisor',
] as const;
export type AccessRole = (typeof ACCESS_ROLES)[number];
export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type UserId = Brand<string, 'UserId'>;
export type TenantId = Brand<string, 'TenantId'>;
export type AppId = Brand<string, 'AppId'>;
export type BrandId = Brand<string, 'BrandId'>;
export type ShopId = Brand<string, 'ShopId'>;
export type SourceId = Brand<string, 'SourceId'>;

export const DENY_REASONS = [
  'MISSING_PRINCIPAL',
  'AMBIGUOUS_ROLE',
  'ROLE_CEILING',
  'EXPIRED_GRANT',
  'REVOKED_GRANT',
  'EXPIRED_FACTS',
  'SOURCE_OUTSIDE_SET',
  'STORE_SET_CHANGED',
  'SESSION_EXPIRED',
  'POLICY_DENIED',
] as const;
export type DenyReason = (typeof DENY_REASONS)[number];

export type Scope =
  | Readonly<{ kind: 'tenant'; tenantId: TenantId; appId: AppId }>
  | Readonly<{ kind: 'brand'; tenantId: TenantId; appId: AppId; brandId: BrandId }>
  | Readonly<{ kind: 'shop'; tenantId: TenantId; appId: AppId; brandId: BrandId; shopId: ShopId }>
  | Readonly<{
      kind: 'source';
      tenantId: TenantId;
      appId: AppId;
      brandId: BrandId;
      shopId?: ShopId;
      domain: 'product' | 'activity' | 'after-sale' | 'aftersale' | 'general';
      sourceId: SourceId;
    }>;

export type AllowedScope = Readonly<{
  scope: Scope;
  actions: AccessAction[];
  validUntil: string;
}>;

export type AccessDecision = Readonly<{
  userId: UserId;
  role: AccessRole;
  state: 'allowed' | 'denied';
  allowedScopes: AllowedScope[];
  accessRevision: number;
  factsVersion: number;
  revocationGeneration: number;
  policyVersion: number;
  storeSetVersion: number;
  resolvedAt: string;
  expiresAt: string;
  denyReason: DenyReason | null;
}>;

export type QueryAccessView = Readonly<{
  state: 'allowed' | 'denied';
  scopes: Array<{ scope: Scope; validUntil: string }>;
  accessRevision: number;
  factsVersion: number;
  revocationGeneration: number;
  policyVersion: number;
  storeSetVersion: number;
  expiresAt: string;
  denyReason: DenyReason | null;
}>;

export type DashboardSettingsView = Readonly<{
  state: 'open' | 'closed';
  grants: 'open' | 'closed';
  accounts: 'open' | 'closed';
  accessRevision: number;
  expiresAt: string;
  denyReason: DenyReason | null;
}>;

export type AdminAccessView = Readonly<{
  state: 'open' | 'closed';
  role: AccessRole;
  grants: Readonly<{
    state: 'open' | 'closed';
    scopes: Array<{ scope: Scope; validUntil: string }>;
  }>;
  accounts: Readonly<{
    state: 'open' | 'closed';
    scopes: Array<{ scope: Scope; validUntil: string }>;
  }>;
  accessRevision: number;
  policyVersion: number;
  expiresAt: string;
  denyReason: DenyReason | null;
}>;

export type AccessSnapshot = Readonly<{
  present: boolean;
  principalId: string | null;
  tenantId: string | null;
  appId: string | null;
  factsVersion: number | null;
  revocationGeneration: number;
  policyVersion: number | null;
  storeSetVersion: number | null;
  facts: null | Readonly<{
    enabled: boolean;
    checkedAt: string;
    validUntil: string;
  }>;
  roles: readonly string[];
  roleActions: readonly string[];
  mayAllocate: boolean;
  accountsManage: Readonly<{ allowed: boolean; validUntil: string | null }>;
  allowedSources: ReadonlyArray<Readonly<{
    scope: Extract<Scope, { kind: 'source' }>;
    action: AccessAction;
    validUntil: string;
  }>>;
  allocationSources: ReadonlyArray<Readonly<{
    scope: Extract<Scope, { kind: 'source' }>;
    grantVersion: number;
    validUntil: string;
  }>>;
  evidence: Readonly<{
    revokedGrant: boolean;
    expiredGrant: boolean;
    sourceOutsideSet: boolean;
    storeSetChanged: boolean;
  }>;
  revisionSeed: string;
  resolvedAt: string;
}>;

export type AccessEvaluation = Readonly<{
  snapshot: AccessSnapshot;
  decision: AccessDecision | null;
  accessRevision: number;
  denyReason: DenyReason | null;
  actionReasons: Readonly<Partial<Record<AccessAction, DenyReason>>>;
}>;

export type AccessEvaluator = Readonly<{
  evaluate: (actorUserId: string, actions?: readonly AccessAction[]) => Promise<AccessEvaluation>;
}>;

type SnapshotLoader = (
  actorUserId: string,
  actions?: readonly AccessAction[],
) => Promise<AccessSnapshot>;

const MINUTE = 60_000;
const actionSet = new Set<string>([
  'query', 'content-manage', 'import', 'source-confirm', 'review', 'publish',
  'candidate-cancel', 'rollback',
]);
const roleSet = new Set<string>(ACCESS_ROLES);
const domainSet = new Set(['product', 'activity', 'after-sale', 'aftersale', 'general']);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('ACCESS_SNAPSHOT_INVALID');
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function integer(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error('ACCESS_SNAPSHOT_INVALID');
  return value as number;
}

function nullableInteger(value: unknown, minimum = 1): number | null {
  return value === null ? null : integer(value, minimum);
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('ACCESS_SNAPSHOT_INVALID');
  return value;
}

function iso(value: unknown): string {
  const parsed = text(value);
  if (!Number.isFinite(Date.parse(parsed))) throw new Error('ACCESS_SNAPSHOT_INVALID');
  return parsed;
}

function sourceScope(value: unknown): Extract<Scope, { kind: 'source' }> {
  const item = record(value);
  if (!item) throw new Error('ACCESS_SNAPSHOT_INVALID');
  const domain = text(item.domain);
  if (!domainSet.has(domain)) throw new Error('ACCESS_SNAPSHOT_INVALID');
  return {
    kind: 'source',
    tenantId: text(item.tenantId) as TenantId,
    appId: text(item.appId) as AppId,
    brandId: text(item.brandId) as BrandId,
    ...(item.shopId === null ? {} : { shopId: text(item.shopId) as ShopId }),
    domain: domain as Extract<Scope, { kind: 'source' }>['domain'],
    sourceId: text(item.sourceId) as SourceId,
  };
}

export function parseAccessSnapshot(value: unknown): AccessSnapshot {
  const item = record(value);
  if (!item) throw new Error('ACCESS_SNAPSHOT_INVALID');
  const present = bool(item.present);
  const roles = Array.isArray(item.roles) ? item.roles.map(text) : [];
  const roleActions = Array.isArray(item.roleActions) ? item.roleActions.map(text) : [];
  if (roleActions.some((action) => !actionSet.has(action))) throw new Error('ACCESS_SNAPSHOT_INVALID');
  const accounts = record(item.accountsManage);
  if (!accounts) throw new Error('ACCESS_SNAPSHOT_INVALID');
  const facts = item.facts === null ? null : record(item.facts);
  if (item.facts !== null && !facts) throw new Error('ACCESS_SNAPSHOT_INVALID');
  const allowedSources = Array.isArray(item.allowedSources) ? item.allowedSources.map((entry) => {
    const source = record(entry);
    if (!source || !actionSet.has(text(source.action))) throw new Error('ACCESS_SNAPSHOT_INVALID');
    return {
      scope: sourceScope(source.scope),
      action: text(source.action) as AccessAction,
      validUntil: iso(source.validUntil),
    };
  }) : [];
  const allocationSources = Array.isArray(item.allocationSources) ? item.allocationSources.map((entry) => {
    const allocation = record(entry);
    if (!allocation) throw new Error('ACCESS_SNAPSHOT_INVALID');
    return {
      scope: sourceScope(allocation.scope),
      grantVersion: integer(allocation.grantVersion, 1),
      validUntil: iso(allocation.validUntil),
    };
  }) : [];
  const evidence = record(item.evidence);
  if (!evidence) throw new Error('ACCESS_SNAPSHOT_INVALID');
  return {
    present,
    principalId: nullableText(item.principalId),
    tenantId: nullableText(item.tenantId),
    appId: nullableText(item.appId),
    factsVersion: nullableInteger(item.factsVersion),
    revocationGeneration: integer(item.revocationGeneration),
    policyVersion: nullableInteger(item.policyVersion),
    storeSetVersion: nullableInteger(item.storeSetVersion),
    facts: facts === null ? null : {
      enabled: bool(facts.enabled),
      checkedAt: iso(facts.checkedAt),
      validUntil: iso(facts.validUntil),
    },
    roles,
    roleActions,
    mayAllocate: bool(item.mayAllocate),
    accountsManage: {
      allowed: bool(accounts.allowed),
      validUntil: accounts.validUntil === null ? null : iso(accounts.validUntil),
    },
    allowedSources,
    allocationSources,
    evidence: {
      revokedGrant: bool(evidence.revokedGrant),
      expiredGrant: bool(evidence.expiredGrant),
      sourceOutsideSet: bool(evidence.sourceOutsideSet),
      storeSetChanged: bool(evidence.storeSetChanged),
    },
    revisionSeed: text(item.revisionSeed),
    resolvedAt: iso(item.resolvedAt),
  };
}

function sourceKey(scope: Extract<Scope, { kind: 'source' }>): string {
  return [scope.tenantId, scope.appId, scope.brandId, scope.shopId ?? '', scope.domain, scope.sourceId]
    .join('\0');
}

function scopeKey(scope: Scope): string {
  return scope.kind === 'tenant'
    ? ['tenant', scope.tenantId, scope.appId].join('\0')
    : sourceKey(scope as Extract<Scope, { kind: 'source' }>);
}

function earliest(left: string, right: string): string {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function baseReason(snapshot: AccessSnapshot): DenyReason | null {
  if (!snapshot.present) return 'MISSING_PRINCIPAL';
  if (!snapshot.facts?.enabled || Date.parse(snapshot.facts.validUntil) <= Date.parse(snapshot.resolvedAt)
    || Date.parse(snapshot.facts.checkedAt) > Date.parse(snapshot.resolvedAt)) return 'EXPIRED_FACTS';
  if (snapshot.roles.length !== 1 || !roleSet.has(snapshot.roles[0]!)) return 'AMBIGUOUS_ROLE';
  return null;
}

function scopedActions(snapshot: AccessSnapshot): AllowedScope[] {
  if (baseReason(snapshot) !== null) return [];
  const grouped = new Map<string, { scope: Scope; actions: Set<AccessAction>; validUntil: string }>();
  for (const item of snapshot.allowedSources) {
    const key = sourceKey(item.scope);
    const prior = grouped.get(key);
    if (prior) {
      prior.actions.add(item.action);
      prior.validUntil = earliest(prior.validUntil, item.validUntil);
    } else {
      grouped.set(key, { scope: item.scope, actions: new Set([item.action]), validUntil: item.validUntil });
    }
  }
  if (snapshot.mayAllocate) {
    for (const allocation of snapshot.allocationSources) {
      const key = sourceKey(allocation.scope);
      const prior = grouped.get(key);
      if (prior) {
        prior.actions.add('grants-manage');
        prior.validUntil = earliest(prior.validUntil, allocation.validUntil);
      } else {
        grouped.set(key, { scope: allocation.scope, actions: new Set(['grants-manage']), validUntil: allocation.validUntil });
      }
    }
  }
  if (snapshot.accountsManage.allowed && snapshot.accountsManage.validUntil && snapshot.tenantId && snapshot.appId) {
    grouped.set('accounts\0tenant', {
      scope: {
        kind: 'tenant',
        tenantId: snapshot.tenantId as TenantId,
        appId: snapshot.appId as AppId,
      },
      actions: new Set(['accounts-manage']),
      validUntil: snapshot.accountsManage.validUntil,
    });
  }
  return [...grouped.values()].map((item) => ({
    scope: item.scope,
    actions: [...item.actions].sort() as AccessAction[],
    validUntil: item.validUntil,
  })).sort((left, right) => scopeKey(left.scope).localeCompare(scopeKey(right.scope)));
}

export function accessRevision(snapshot: AccessSnapshot): number {
  const authority = {
    principalId: snapshot.principalId,
    tenantId: snapshot.tenantId,
    appId: snapshot.appId,
    factsVersion: snapshot.factsVersion,
    revocationGeneration: snapshot.revocationGeneration,
    policyVersion: snapshot.policyVersion,
    storeSetVersion: snapshot.storeSetVersion,
    factsEnabled: snapshot.facts?.enabled ?? null,
    factsValidUntil: snapshot.facts?.validUntil ?? null,
    roles: snapshot.roles,
    roleActions: snapshot.roleActions,
    mayAllocate: snapshot.mayAllocate,
    accountsManage: snapshot.accountsManage,
    revisionSeed: snapshot.revisionSeed,
  };
  const value = createHash('sha256').update(JSON.stringify(authority)).digest();
  return Math.max(1, value.readUIntBE(0, 6));
}

function actionReason(snapshot: AccessSnapshot, actions: readonly AccessAction[]): DenyReason | null {
  const base = baseReason(snapshot);
  if (base) return base;
  const business = actions.filter((action): action is Exclude<AccessAction, 'grants-manage' | 'accounts-manage'> =>
    action !== 'grants-manage' && action !== 'accounts-manage');
  if (business.length > 0 && business.every((action) => !snapshot.roleActions.includes(action))) return 'ROLE_CEILING';
  if (snapshot.evidence.storeSetChanged) return 'STORE_SET_CHANGED';
  if (snapshot.evidence.sourceOutsideSet) return 'SOURCE_OUTSIDE_SET';
  if (snapshot.evidence.revokedGrant) return 'REVOKED_GRANT';
  if (snapshot.evidence.expiredGrant) return 'EXPIRED_GRANT';
  return 'POLICY_DENIED';
}

export function decisionFromSnapshot(
  userId: string,
  snapshot: AccessSnapshot,
  actions: readonly AccessAction[] = [
    'query', 'content-manage', 'import', 'source-confirm', 'review', 'publish',
    'candidate-cancel', 'rollback', 'grants-manage', 'accounts-manage',
  ],
): AccessDecision | null {
  if (baseReason(snapshot) !== null) return null;
  const allowedScopes = scopedActions(snapshot).filter((entry) =>
    entry.actions.some((action) => actions.includes(action)));
  const reason = allowedScopes.length > 0 ? null : actionReason(snapshot, actions);
  const expiresAt = allowedScopes.length > 0
    ? allowedScopes.map((entry) => entry.validUntil).sort((left, right) => Date.parse(left) - Date.parse(right))[0]!
    : new Date(Date.parse(snapshot.resolvedAt) + 1_000).toISOString();
  return Object.freeze({
    userId: userId as UserId,
    role: snapshot.roles[0]! as AccessRole,
    state: allowedScopes.length > 0 ? 'allowed' : 'denied',
    allowedScopes,
    accessRevision: accessRevision(snapshot),
    factsVersion: snapshot.factsVersion!,
    revocationGeneration: snapshot.revocationGeneration,
    policyVersion: snapshot.policyVersion ?? 1,
    storeSetVersion: snapshot.storeSetVersion ?? 1,
    resolvedAt: snapshot.resolvedAt,
    expiresAt,
    denyReason: reason,
  });
}

export function createAccessEvaluator(loadSnapshot: SnapshotLoader): AccessEvaluator {
  return Object.freeze({
    async evaluate(actorUserId, actions) {
      const snapshot = await loadSnapshot(actorUserId, actions);
      const decision = decisionFromSnapshot(actorUserId, snapshot);
      const actionReasons = Object.freeze(Object.fromEntries(
        (['query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback'] as const)
          .map((action): [AccessAction, DenyReason] => [
            action,
            baseReason(snapshot) ?? actionReason(snapshot, [action]) ?? 'POLICY_DENIED',
          ]),
      )) as Readonly<Partial<Record<AccessAction, DenyReason>>>;
      return Object.freeze({
        snapshot,
        decision,
        accessRevision: accessRevision(snapshot),
        denyReason: baseReason(snapshot) ?? decision?.denyReason ?? null,
        actionReasons,
      });
    },
  });
}

export function createUnavailableAccessEvaluator(): AccessEvaluator {
  return Object.freeze({
    evaluate: async () => {
      throw new Error('ACCESS_EVALUATOR_UNAVAILABLE');
    },
  });
}

export function createMockAccessEvaluator(now: () => Date = () => new Date()): AccessEvaluator {
  const actions: readonly AccessAction[] = [
    'query', 'content-manage', 'import', 'source-confirm', 'review', 'publish',
    'candidate-cancel', 'rollback',
  ];
  return Object.freeze({
    async evaluate(actorUserId) {
      const at = now();
      const validUntil = new Date(at.getTime() + 5 * 60_000).toISOString();
      const scope = {
        kind: 'source' as const,
        tenantId: 'synthetic-tenant' as TenantId,
        appId: 'synthetic-app' as AppId,
        brandId: 'synthetic-brand' as BrandId,
        domain: 'product' as const,
        sourceId: 'synthetic-source' as SourceId,
      };
      const snapshot: AccessSnapshot = {
        present: true,
        principalId: `synthetic-${actorUserId}`,
        tenantId: scope.tenantId,
        appId: scope.appId,
        factsVersion: 1,
        revocationGeneration: 0,
        policyVersion: 1,
        storeSetVersion: 1,
        facts: { enabled: true, checkedAt: at.toISOString(), validUntil },
        roles: ['director'],
        roleActions: actions,
        mayAllocate: true,
        accountsManage: { allowed: true, validUntil },
        allowedSources: actions.map((action) => ({ scope, action, validUntil })),
        allocationSources: [{ scope, grantVersion: 1, validUntil }],
        evidence: {
          revokedGrant: false,
          expiredGrant: false,
          sourceOutsideSet: false,
          storeSetChanged: false,
        },
        revisionSeed: 'mock-access-revision-v1',
        resolvedAt: at.toISOString(),
      };
      const decision = decisionFromSnapshot(actorUserId, snapshot);
      return {
        snapshot,
        decision,
        accessRevision: accessRevision(snapshot),
        denyReason: decision?.denyReason ?? null,
        actionReasons: Object.freeze(Object.fromEntries(
          (['query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback'] as const)
            .map((action) => [action, 'POLICY_DENIED']),
        )) as Readonly<Partial<Record<AccessAction, DenyReason>>>,
      };
    },
  });
}

export function decisionAllows(decision: AccessDecision, anyOf: readonly AccessAction[]): boolean {
  return decision.state === 'allowed'
    && decision.allowedScopes.some((scope) => scope.actions.some((action) => anyOf.includes(action)));
}

export function evaluationAllows(evaluation: AccessEvaluation, anyOf: readonly AccessAction[]): boolean {
  return evaluation.decision !== null && decisionAllows(evaluation.decision, anyOf);
}

export function evaluationDenyReason(
  evaluation: AccessEvaluation,
  anyOf: readonly AccessAction[],
): DenyReason {
  for (const action of anyOf) {
    const reason = evaluation.actionReasons[action];
    if (reason) return reason;
  }
  return evaluation.denyReason ?? 'POLICY_DENIED';
}

function filteredDecision(
  decision: AccessDecision,
  actions: readonly AccessAction[],
): AccessDecision {
  const allowedScopes = decision.allowedScopes
    .map((entry) => ({
      ...entry,
      actions: entry.actions.filter((action) => actions.includes(action)),
    }))
    .filter((entry) => entry.actions.length > 0);
  const allowed = allowedScopes.length > 0;
  const expiresAt = allowed
    ? allowedScopes.map((entry) => entry.validUntil)
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0]!
    : decision.expiresAt;
  return {
    ...decision,
    state: allowed ? 'allowed' : 'denied',
    allowedScopes,
    expiresAt,
    denyReason: allowed ? null : decision.denyReason ?? 'POLICY_DENIED',
  };
}

export function projectQueryAccess(decision: AccessDecision, denyReason?: DenyReason): QueryAccessView {
  const filtered = filteredDecision(decision, ['query']);
  const reason = filtered.state === 'allowed' ? null : denyReason ?? filtered.denyReason;
  return {
    state: filtered.state,
    scopes: filtered.allowedScopes.map(({ scope, validUntil }) => ({ scope, validUntil })),
    accessRevision: filtered.accessRevision,
    factsVersion: filtered.factsVersion,
    revocationGeneration: filtered.revocationGeneration,
    policyVersion: filtered.policyVersion,
    storeSetVersion: filtered.storeSetVersion,
    expiresAt: filtered.expiresAt,
    denyReason: reason,
  };
}

export function projectDashboardSettings(decision: AccessDecision, denyReason?: DenyReason): DashboardSettingsView {
  const filtered = filteredDecision(decision, ['grants-manage', 'accounts-manage']);
  const grants = filtered.allowedScopes.some((entry) => entry.actions.includes('grants-manage'));
  const accounts = filtered.allowedScopes.some((entry) => entry.actions.includes('accounts-manage'));
  return {
    state: grants || accounts ? 'open' : 'closed',
    grants: grants ? 'open' : 'closed',
    accounts: accounts ? 'open' : 'closed',
    accessRevision: decision.accessRevision,
    expiresAt: filtered.expiresAt,
    denyReason: grants || accounts ? null : denyReason ?? decision.denyReason ?? 'POLICY_DENIED',
  };
}

export function projectAdminAccess(decision: AccessDecision): AdminAccessView {
  const grantScopes = decision.allowedScopes
    .filter((entry) => entry.actions.includes('grants-manage'))
    .map(({ scope, validUntil }) => ({ scope, validUntil }));
  const accountScopes = decision.allowedScopes
    .filter((entry) => entry.actions.includes('accounts-manage'))
    .map(({ scope, validUntil }) => ({ scope, validUntil }));
  return {
    state: decision.state === 'allowed' ? 'open' : 'closed',
    role: decision.role,
    grants: { state: grantScopes.length > 0 ? 'open' : 'closed', scopes: grantScopes },
    accounts: { state: accountScopes.length > 0 ? 'open' : 'closed', scopes: accountScopes },
    accessRevision: decision.accessRevision,
    policyVersion: decision.policyVersion,
    expiresAt: decision.expiresAt,
    denyReason: decision.denyReason,
  };
}

export function snapshotValidity(snapshot: AccessSnapshot): number {
  return snapshot.facts ? Date.parse(snapshot.facts.validUntil) - Date.parse(snapshot.resolvedAt) : MINUTE;
}
