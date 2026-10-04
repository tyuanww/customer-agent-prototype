/** P1 synthetic model, deliberately outside API dist/routes. Formal persistence and
 * locking require approved contracts. Identity, job ceiling, business grants and grant
 * authority are separate facts; this module is the sole owner of their intersection. */
export const FACTS_MAX_AGE_MS = 300_000;
export const BUSINESS_ACTIONS = ['query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback'] as const;
export type Action = typeof BUSINESS_ACTIONS[number];
export type Role = 'agent' | 'enabler' | 'lead' | 'supervisor' | 'manager' | 'director';
export type Scope = Readonly<{ tenant: string; app: string; brand: string; shop: string | null; domain: string; source: string | null }>;
export type Principal = Readonly<{
  id: string; personKey: string; tenant: string; app: string; departments: readonly string[];
  job: string; enabled: boolean; checkedAt: number; version: number; generation: number;
}>;
export type RoleRule = Readonly<{ department: string; job: string; role: Role }>;
export type Grant = Readonly<{
  // One action/scope per record keeps revocation and stewardship independently writable.
  // A UI batch may contain many records; its atomic persistence is a P2 contract.
  id: string; issuer: string; recipient: string; action: Action; scope: Scope;
  startsAt: number; expiresAt: number; revoked: boolean; version: number; reason: string;
  steward: string | null;
}>;
export type Delegation = Grant & Readonly<{ mayRedelegate: false }>;
export type Authority = Readonly<{
  rules: readonly RoleRule[]; grants: readonly Grant[];
  /** Configured by controlled operations, never inferred from a job title. */
  allocations: readonly Grant[]; delegations: readonly Delegation[];
}>;
export type Decision = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;
const yes: Decision = Object.freeze({ ok: true });
const no = (reason: string): Decision => ({ ok: false, reason });

export function roleOf(principal: Principal, rules: readonly RoleRule[]): Role | null {
  const roles = new Set(rules.filter((r) => r.job === principal.job && principal.departments.includes(r.department)).map((r) => r.role));
  return roles.size === 1 ? [...roles][0]! : null;
}
export function fresh(principal: Principal, now: number): boolean {
  return principal.enabled && !!principal.id && !!principal.personKey && Number.isSafeInteger(now)
    && !!principal.tenant && !!principal.app && Number.isSafeInteger(principal.version) && principal.version > 0
    && Number.isSafeInteger(principal.generation) && principal.generation >= 0
    && Number.isSafeInteger(principal.checkedAt) && principal.checkedAt <= now && now < principal.checkedAt + FACTS_MAX_AGE_MS;
}
function live(grant: Grant, now: number): boolean {
  return !grant.revoked && Number.isSafeInteger(grant.startsAt) && Number.isSafeInteger(grant.expiresAt)
    && grant.startsAt <= now && now < grant.expiresAt;
}
/** Brand-common is a separate scope, not a wildcard granting every shop. A null source
 * explicitly grants all sources inside this exact shop/domain; it never widens a shop. */
export function covers(outer: Scope, inner: Scope): boolean {
  return !!outer.tenant && !!outer.app && !!outer.brand && !!outer.domain
    && outer.tenant === inner.tenant && outer.app === inner.app && outer.brand === inner.brand
    && outer.shop === inner.shop && outer.domain === inner.domain
    && (outer.source === null || outer.source === inner.source);
}
function ceiling(role: Role | null, action: Action): boolean {
  return role !== null && BUSINESS_ACTIONS.includes(action) && (role !== 'agent' || action === 'query');
}
function inGrant(grant: Grant, principal: Principal, action: Action, scope: Scope, now: number): boolean {
  return grant.recipient === principal.id && live(grant, now) && grant.action === action
    && covers(grant.scope, scope);
}

/** Latest usable deadline across alternative matching grants, bounded by identity facts.
 * Callers do not need to reproduce grant matching to bound their evidence or tickets. */
export function authorizationExpiry(principal: Principal, action: Action, scope: Scope, authority: Authority, now: number): number | null {
  if (!authorize(principal, action, scope, authority, now).ok) return null;
  return Math.min(principal.checkedAt + FACTS_MAX_AGE_MS,
    Math.max(...authority.grants.filter((g) => inGrant(g, principal, action, scope, now)).map((g) => g.expiresAt)));
}
export function authorize(principal: Principal, action: Action, scope: Scope, authority: Authority, now: number): Decision {
  if (!fresh(principal, now)) return no('ORG_FACTS_UNAVAILABLE');
  if (scope.tenant !== principal.tenant || scope.app !== principal.app) return no('SCOPE_DENIED');
  if (!ceiling(roleOf(principal, authority.rules), action)) return no('ROLE_CEILING');
  // The issuer's subsequent loss of grant authority does NOT invalidate issued business
  // grants. Their own expiry/revocation and the recipient's current ceiling still apply.
  return authority.grants.some((g) => inGrant(g, principal, action, scope, now)) ? yes : no('SCOPE_DENIED');
}

/** Validates a proposed grant/delegation; caller must commit with both principals'
 * facts versions and revocation generations checked under the same DB lock in P2. */
export function canAssign(issuer: Principal, recipient: Principal, proposed: Grant, kind: 'business' | 'delegation', authority: Authority, now: number): Decision {
  if (!fresh(issuer, now) || !fresh(recipient, now)) return no('ORG_FACTS_UNAVAILABLE');
  if (issuer.id === recipient.id || issuer.personKey === recipient.personKey) return no('SELF_ESCALATION');
  if (issuer.tenant !== recipient.tenant || issuer.app !== recipient.app || proposed.recipient !== recipient.id || proposed.issuer !== issuer.id) return no('SCOPE_DENIED');
  if (!proposed.id || !proposed.reason.trim() || !live(proposed, now) || !Number.isSafeInteger(proposed.version) || proposed.version < 1) return no('INVALID_GRANT');
  const issuerRole = roleOf(issuer, authority.rules), recipientRole = roleOf(recipient, authority.rules);
  const intrinsic = issuerRole === 'supervisor' || issuerRole === 'manager' || issuerRole === 'director';
  if (kind === 'delegation' && issuerRole !== 'manager' && issuerRole !== 'director') return no('REDELEGATION_DENIED');
  const { scope, action } = proposed;
  if (scope.tenant !== issuer.tenant || scope.app !== issuer.app) return no('SCOPE_DENIED');
  // A delegate may distribute a capability it cannot use, but a business recipient
  // can only receive actions within its job ceiling (agent stays read-only).
  if (!BUSINESS_ACTIONS.includes(action) || (kind === 'business' && !ceiling(recipientRole, action))) return no('ROLE_CEILING');
  const eligible = [
    ...(intrinsic ? authority.allocations : []),
    ...(kind === 'business' ? authority.delegations : []),
  ].filter((g) => inGrant(g, issuer, action, scope, now)
    && g.steward !== null && proposed.startsAt >= g.startsAt && proposed.expiresAt <= g.expiresAt);
  if (!eligible.length) return no('GRANT_AUTHORITY_DENIED');
  return yes;
}

/** Revoking delegation preserves downstream business rights and their original issuer.
 * A missing takeover owner freezes new distribution; operations may later appoint one. */
export function revokeDelegation(authority: Authority, delegationId: string, steward: string | null): Authority {
  const delegation = authority.delegations.find((d) => d.id === delegationId);
  if (!delegation || delegation.revoked) return authority;
  return {
    ...authority,
    delegations: authority.delegations.map((d) => d.id === delegationId ? { ...d, revoked: true, version: d.version + 1 } : d),
    grants: authority.grants.map((g) => g.issuer === delegation.recipient && g.action === delegation.action
      && covers(delegation.scope, g.scope) ? { ...g, steward, version: g.version + 1 } : g),
  };
}

export function selectShop(allowed: readonly string[], requested?: string): Readonly<{ ok: true; shop: string }> | Readonly<{ ok: false; reason: string }> {
  const shops = [...new Set(allowed)];
  if (requested) return shops.includes(requested) ? { ok: true, shop: requested } : { ok: false, reason: 'SCOPE_DENIED' };
  return shops.length === 1 ? { ok: true, shop: shops[0]! } : { ok: false, reason: shops.length ? 'CHOOSE_SHOP' : 'NO_SHOP' };
}
