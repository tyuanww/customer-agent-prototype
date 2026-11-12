import {
  parseAccessDecision,
  type AccessDecision,
  type Domain,
  type Scope,
} from '@customer-agent/unified-contracts';
import type { AuthenticatedUser } from '../auth-service.js';
import {
  createAccessEvaluator,
  parseAccessSnapshot,
  type AccessDecision as DatabaseAccessDecision,
  type AccessEvaluation,
  type AccessEvaluator,
  type AccessRole,
} from '../access/evaluator.js';
import type { AccessAction } from '../access/policy.js';
import type { IntegrationPool } from './database.js';

export type ArcScopeDomain = Domain;
export type ArcSourceScope = Readonly<{
  kind: 'source';
  tenantId: Scope['tenantId'];
  appId: Scope['appId'];
  brandId: NonNullable<Scope['brandId']>;
  shopId: NonNullable<Scope['shopId']>;
  domain: ArcScopeDomain;
  sourceId: NonNullable<Scope['sourceId']>;
}>;

const GLOBAL_SHOP_ID = '__all__';
const ARC_DOMAIN: Readonly<Record<string, ArcScopeDomain>> = Object.freeze({
  presale: 'product',
  campaign: 'activity',
  aftersale: 'after-sale',
  'after-sale': 'after-sale',
  product: 'product',
  activity: 'activity',
  general: 'general',
  sop: 'sop',
});

function canonical(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, normalize(item)]));
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

export function arcDomain(value: string): ArcScopeDomain {
  const mapped = Object.hasOwn(ARC_DOMAIN, value) ? ARC_DOMAIN[value] : undefined;
  if (mapped === undefined) throw new Error('RELEASE_SCOPE_DOMAIN_INVALID');
  return mapped;
}

function canonicalAccessSnapshot(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ACCESS_SNAPSHOT_INVALID');
  }
  const snapshot = { ...(value as Record<string, unknown>) };
  for (const key of ['allowedSources', 'allocationSources'] as const) {
    const entries = snapshot[key];
    if (!Array.isArray(entries)) continue;
    snapshot[key] = entries.map((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error('ACCESS_SNAPSHOT_INVALID');
      }
      const item = { ...(entry as Record<string, unknown>) };
      const scope = item.scope;
      if (scope === null || typeof scope !== 'object' || Array.isArray(scope)) {
        throw new Error('ACCESS_SNAPSHOT_INVALID');
      }
      const source = { ...(scope as Record<string, unknown>) };
      if (typeof source.domain === 'string') source.domain = arcDomain(source.domain);
      item.scope = source;
      return item;
    });
  }
  return snapshot;
}

/**
 * ACL-01 owns the decision logic, but its PostgreSQL source still uses the
 * legacy intake domain names. Normalize those names at the database adapter so
 * route admission and QueryCoordinator consume the same ARC-validated decision.
 */
export function createPostgresAccessEvaluator(pool: IntegrationPool): AccessEvaluator {
  return createAccessEvaluator(async (actorUserId, actions) => {
    const client = await pool.connect();
    let failed = false;
    try {
      const result = await client.query<{ value: unknown }>(
        'SELECT content_intake.access_snapshot($1, clock_timestamp(), $2::text[]) AS value',
        [actorUserId, actions ?? null],
      );
      return parseAccessSnapshot(canonicalAccessSnapshot(result.rows[0]?.value));
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      client.release(failed);
    }
  });
}

function mappedRole(role: AccessRole): 'agent' | 'director' | 'enabler' | 'lead' | 'manager' | 'supervisor' {
  return role === 'engineer' ? 'manager' : role;
}

function mappedActions(actions: readonly AccessAction[]): AccessDecision['allowedScopes'][number]['actions'] {
  return actions.filter((action): action is 'query' => action === 'query');
}

function sentinelSourceScope(
  scope: Extract<DatabaseAccessDecision['allowedScopes'][number]['scope'], { kind: 'source' }>,
): ArcSourceScope {
  const result: ArcSourceScope = {
    kind: 'source',
    tenantId: scope.tenantId,
    appId: scope.appId,
    brandId: scope.brandId,
    shopId: (scope.shopId ?? GLOBAL_SHOP_ID) as never,
    domain: arcDomain(scope.domain),
    sourceId: scope.sourceId,
  };
  return Object.freeze(result);
}

function mapAllowedScopes(
  decision: DatabaseAccessDecision,
  releaseScopes: readonly Scope[],
): AccessDecision['allowedScopes'] {
  const scopes: AccessDecision['allowedScopes'] = [];
  for (const allowed of decision.allowedScopes) {
    const actions = mappedActions(allowed.actions);
    if (actions.length === 0) continue;
    if (allowed.scope.kind !== 'source') {
      scopes.push(Object.freeze({
        scope: Object.freeze({ ...allowed.scope }) as Scope,
        actions,
        validUntil: allowed.validUntil,
      }));
      continue;
    }
    const source = allowed.scope;
    const domain = arcDomain(source.domain);
    if (source.shopId !== undefined && source.shopId !== null) {
      const scope: ArcSourceScope = {
        kind: 'source',
        tenantId: source.tenantId,
        appId: source.appId,
        brandId: source.brandId,
        shopId: source.shopId,
        domain,
        sourceId: source.sourceId,
      };
      scopes.push(Object.freeze({ scope, actions, validUntil: allowed.validUntil }));
      continue;
    }
    const expanded = releaseScopes.filter((scope) => (
      scope.kind === 'source'
      && scope.sourceId === source.sourceId
      && scope.domain === domain
    ));
    for (const scope of expanded.length === 0 ? [sentinelSourceScope(source)] : expanded) {
      scopes.push(Object.freeze({ scope, actions, validUntil: allowed.validUntil }));
    }
  }
  const unique = new Map(scopes.map((scope) => [canonical({
    scope: scope.scope,
    actions: scope.actions,
    validUntil: scope.validUntil,
  }), scope]));
  return [...unique.values()];
}

function mappedDecision(
  decision: DatabaseAccessDecision,
  releaseScopes: readonly Scope[],
): AccessDecision {
  const allowedScopes = mapAllowedScopes(decision, releaseScopes);
  const state = decision.state === 'allowed' && allowedScopes.length > 0 ? 'allowed' : 'denied';
  return parseAccessDecision({
    userId: decision.userId,
    role: mappedRole(decision.role),
    state,
    allowedScopes,
    accessRevision: decision.accessRevision,
    factsVersion: decision.factsVersion,
    revocationGeneration: decision.revocationGeneration,
    policyVersion: decision.policyVersion,
    storeSetVersion: decision.storeSetVersion,
    resolvedAt: decision.resolvedAt,
    expiresAt: decision.expiresAt,
    denyReason: state === 'allowed' ? null : decision.denyReason ?? 'POLICY_DENIED',
  });
}

function deniedDecision(
  actor: AuthenticatedUser,
  evaluation: AccessEvaluation,
): AccessDecision {
  const resolvedAt = evaluation.snapshot.resolvedAt;
  return parseAccessDecision({
    userId: actor.user_id,
    role: mappedRole((evaluation.snapshot.roles[0] ?? 'agent') as AccessRole),
    state: 'denied',
    allowedScopes: [],
    accessRevision: Math.max(1, evaluation.accessRevision),
    factsVersion: Math.max(1, evaluation.snapshot.factsVersion ?? 1),
    revocationGeneration: evaluation.snapshot.revocationGeneration,
    policyVersion: Math.max(1, evaluation.snapshot.policyVersion ?? 1),
    storeSetVersion: Math.max(1, evaluation.snapshot.storeSetVersion ?? 1),
    resolvedAt,
    expiresAt: new Date(Date.parse(resolvedAt) + 1_000).toISOString(),
    denyReason: evaluation.denyReason ?? 'POLICY_DENIED',
  });
}

export function toArcAccessDecision(
  actor: AuthenticatedUser,
  evaluation: AccessEvaluation,
  releaseScopes: readonly Scope[],
): AccessDecision {
  return evaluation.decision === null
    ? deniedDecision(actor, evaluation)
    : mappedDecision(evaluation.decision, releaseScopes);
}
