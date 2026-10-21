import { randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import { clock, IntakeRejection, principal, requireFresh, type IntakeTransaction, type Principal } from './transaction.js';

type C = components['schemas'];
type Scope = C['IntakeScope'];
type Grant = C['IntakeGrant'];
export type Source = { scopeId: string; scope: C['IntakeSourceScope']; version: number;
  templateVersion: string; ruleVersion: string; mappingVersion: string; structureDigest: string; mode: string };

export async function source(client: IntakeTransaction, id: string): Promise<Source> {
  const { rows } = await client.query<{ scope_id: string; tenant_id: string; app_id: string; brand_id: string;
    shop_id: string | null; domain: Scope['domain']; current_mapping_version: string;
    template_version: string; rule_version: string; mapping_version: string; structure_digest: string; mode: string }>(`
    SELECT s.*, src.current_mapping_version, src.mode, m.template_version,m.rule_version,m.mapping_version,m.structure_digest
    FROM content_intake.sources src JOIN content_intake.scopes s USING(scope_id)
    JOIN content_intake.source_mappings m ON m.source_id=src.source_id AND m.version=src.current_mapping_version
    WHERE src.source_id=$1`, [id]);
  const r = rows[0];
  if (!r) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  return { scopeId: r.scope_id, scope: { tenantId: r.tenant_id, appId: r.app_id, brandId: r.brand_id,
    shopId: r.shop_id, domain: r.domain, sourceId: id }, version: Number(r.current_mapping_version),
    templateVersion: r.template_version, ruleVersion: r.rule_version, mappingVersion: r.mapping_version, structureDigest: r.structure_digest, mode: r.mode };
}

export async function authorize(client: IntakeTransaction, actor: Principal, action: C['IntakeAction'], src: Source): Promise<number> {
  const now = await clock(client);
  requireFresh(actor, now);
  if (src.scope.tenantId !== actor.tenantId || src.scope.appId !== actor.appId) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  const { rows } = await client.query<{ until: Date | null }>(
    'SELECT content_intake.authorization_deadline($1,$2,$3,$4,clock_timestamp()) AS until',
    [actor.id, action, src.scopeId, src.scope.sourceId]);
  if (!rows[0]?.until) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  client.validUntil(rows[0].until.getTime());
  return rows[0].until.getTime();
}

async function scopeId(client: IntakeTransaction, scope: Scope): Promise<string> {
  const { rows } = await client.query<{ scope_id: string }>(`
    SELECT s.scope_id FROM content_intake.scopes s WHERE tenant_id=$1 AND app_id=$2 AND brand_id=$3
      AND shop_id IS NOT DISTINCT FROM $4 AND domain=$5
      AND ($6::text IS NULL OR EXISTS (SELECT 1 FROM content_intake.sources src WHERE src.scope_id=s.scope_id AND src.source_id=$6))`,
  [scope.tenantId, scope.appId, scope.brandId, scope.shopId, scope.domain, scope.sourceId]);
  if (!rows[0]) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  return rows[0].scope_id;
}

export function samePerson(a: Principal, b: Principal): boolean {
  return a.id === b.id || (a.tenantId === b.tenantId && a.appId === b.appId
    && a.identityScope === b.identityScope && a.personKey === b.personKey);
}

/** The directory and the grant transaction share this role ceiling. Historical
 * grant rows stay; new operations are rechecked here and in SQL. */
export function recipientRoleAllows(role: Principal['role'], kind: 'business' | 'delegation', action: C['IntakeAction']): boolean {
  if (role === null) return false;
  if (role === 'engineer') return true;
  if (kind === 'delegation') return role === 'director' || role === 'manager';
  if (action === 'query') return true;
  return role === 'director' || role === 'manager' || role === 'supervisor' || role === 'lead';
}

export function allocationKinds(actor: Principal, kind: 'business' | 'delegation'): ('allocation' | 'delegation')[] {
  if (actor.role !== 'director' && actor.role !== 'manager' && actor.role !== 'engineer') return [];
  if (kind === 'delegation') return ['allocation'];
  return ['allocation', 'delegation'];
}

async function parentAuthority(client: IntakeTransaction, issuer: Principal, kind: 'business' | 'delegation',
  action: C['IntakeAction'], scope: Scope, period?: { startsAt: string; expiresAt: string }): Promise<string> {
  if (issuer.tenantId !== scope.tenantId || issuer.appId !== scope.appId) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  requireFresh(issuer, await clock(client));
  client.validUntil(issuer.validUntil);
  if (issuer.role === null) throw new IntakeRejection('ROLE_CEILING', 'FORBIDDEN');
  const kinds = allocationKinds(issuer, kind);
  if (!kinds.length) throw new IntakeRejection('REDELEGATION_DENIED', 'FORBIDDEN');
  const id = await scopeId(client, scope);
  const { rows } = await client.query<{ grant_id: string; expires_at: Date }>(`
    SELECT grant_id,expires_at FROM content_intake.grants WHERE recipient_id=$1 AND scope_id=$2 AND action=$3
      AND (source_id IS NULL OR source_id IS NOT DISTINCT FROM $4) AND revoked_at IS NULL
      AND steward_id IS NOT NULL AND starts_at<=clock_timestamp() AND expires_at>clock_timestamp()
      AND ($5::timestamptz IS NULL OR (starts_at<=$5 AND expires_at>=$6))
      AND kind=ANY($7::text[]) ORDER BY grant_id LIMIT 1`,
  [issuer.id, id, action, scope.sourceId, period?.startsAt ?? null, period?.expiresAt ?? null, kinds]);
  if (!rows[0]) throw new IntakeRejection('GRANT_AUTHORITY_DENIED', 'NOT_FOUND');
  client.validUntil(rows[0].expires_at.getTime());
  return rows[0].grant_id;
}

async function issuingParent(client: IntakeTransaction, issuer: Principal, kind: 'business' | 'delegation',
  action: C['IntakeAction'], scope: Scope, period?: { startsAt: string; expiresAt: string }): Promise<string | null> {
  try {
    return await parentAuthority(client, issuer, kind, action, scope, period);
  } catch (error) {
    if (error instanceof IntakeRejection && error.reason === 'GRANT_AUTHORITY_DENIED'
      && kind === 'business' && action === 'import'
      && (issuer.role === 'director' || issuer.role === 'manager' || issuer.role === 'engineer')) return null;
    throw error;
  }
}

export async function readGrant(client: IntakeTransaction, id: string): Promise<Grant> {
  const { rows } = await client.query<{ value: unknown }>(`SELECT jsonb_build_object(
    'grantId',g.grant_id,'version',g.version,'kind',g.kind,'issuerPrincipalId',g.issuer_id,
    'recipientPrincipalId',g.recipient_id,'action',g.action,'scope',jsonb_build_object(
      'tenantId',s.tenant_id,'appId',s.app_id,'brandId',s.brand_id,'shopId',s.shop_id,'domain',s.domain,'sourceId',g.source_id),
    'startsAt',g.starts_at,'expiresAt',g.expires_at,'revokedAt',g.revoked_at,'stewardPrincipalId',g.steward_id,
    'reason',g.reason,'mayRedelegate',g.may_redelegate,'lastChangeReason',g.last_change_reason) AS value
    FROM content_intake.grants g JOIN content_intake.scopes s USING(scope_id) WHERE grant_id=$1`, [id]);
  if (!rows[0]) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  return parseContractSchema('IntakeGrant', rows[0].value);
}

async function prepareGrants(client: IntakeTransaction, issuer: Principal, request: C['IntakeGrantBatch']) {
  const policy = await client.query<{ version: string }>('SELECT version FROM content_intake.policy_versions WHERE tenant_id=$1 AND app_id=$2', [issuer.tenantId, issuer.appId]);
  if (issuer.factsVersion !== request.issuerFactsVersion || Number(policy.rows[0]?.version) !== request.policyVersion) throw new IntakeRejection('PERMISSION_CHANGED');
  const stamped = await client.query<{ at: Date }>('SELECT clock_timestamp() AS at');
  const at = stamped.rows[0]!.at;
  requireFresh(issuer, at.getTime());
  const allowedByAction = new Map<string, Set<string>>();
  const prepared: { item: C['IntakeGrantItem']; parent: string | null }[] = [];
  for (const item of request.items) {
    const recipient = await principal(client, { id: item.recipientPrincipalId });
    requireFresh(recipient, at.getTime());
    client.validUntil(recipient.validUntil);
    if (issuer.tenantId !== recipient.tenantId || issuer.appId !== recipient.appId) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
    if (samePerson(issuer, recipient)) throw new IntakeRejection('SELF_ESCALATION', 'FORBIDDEN');
    if (recipient.factsVersion !== item.recipientFactsVersion) throw new IntakeRejection('PERMISSION_CHANGED');
    if (!recipientRoleAllows(recipient.role, item.kind, item.action)) throw new IntakeRejection('ROLE_CEILING', 'FORBIDDEN');
    if (!item.reason.trim() || Date.parse(item.expiresAt) <= Math.max(Date.parse(item.startsAt), await clock(client))) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
    // Authority to grant this action in this scope comes before the source set, so a caller
    // without a parent still sees REDELEGATION_DENIED rather than a scope denial.
    const parent = await issuingParent(client, issuer, item.kind, item.action, item.scope, item);
    let allowed = allowedByAction.get(item.action);
    if (!allowed) {
      const rows = await client.query<{ source_id: string }>(
        'SELECT source_id FROM content_intake.authorization_sources($1,$2,$3)',
        [issuer.id, item.action, at]);
      allowed = new Set(rows.rows.map(row => row.source_id));
      allowedByAction.set(item.action, allowed);
    }
    if (item.scope.sourceId) {
      if (!allowed.has(item.scope.sourceId)) throw new IntakeRejection('SCOPE_DENIED', 'FORBIDDEN');
    } else {
      const scopeSources = await client.query<{ source_id: string }>(`
        SELECT src.source_id FROM content_intake.sources src
        JOIN content_intake.scopes scope ON scope.scope_id = src.scope_id
        WHERE scope.tenant_id=$1 AND scope.app_id=$2 AND scope.brand_id=$3
          AND scope.shop_id IS NOT DISTINCT FROM $4 AND scope.domain=$5`,
        [item.scope.tenantId, item.scope.appId, item.scope.brandId, item.scope.shopId, item.scope.domain]);
      if (scopeSources.rows.length === 0 || scopeSources.rows.some(row => !allowed.has(row.source_id))) {
        throw new IntakeRejection('SCOPE_DENIED', 'FORBIDDEN');
      }
    }
    prepared.push({ item, parent });
  }
  return prepared;
}

/** Preview shares the command validator and has no DML or receipt. Preview IDs
 * identify hypothetical rows only; saving always validates and allocates anew. */
export async function previewGrants(client: IntakeTransaction, issuer: Principal, request: C['IntakeGrantBatch']): Promise<C['IntakeGrantList']> {
  const prepared = await prepareGrants(client, issuer, request);
  return parseContractSchema('IntakeGrantList', { items: prepared.map(({ item }) => ({
    kind: item.kind, recipientPrincipalId: item.recipientPrincipalId, action: item.action,
    scope: item.scope, startsAt: item.startsAt, expiresAt: item.expiresAt, reason: item.reason, grantId: `preview_${randomUUID()}`, version: 1,
    issuerPrincipalId: issuer.id, revokedAt: null, stewardPrincipalId: issuer.id,
    mayRedelegate: false, lastChangeReason: null,
  })), nextCursor: null });
}

const DISPOSABLE_SYNTHETIC_OWNER = 'usr_synthetic_owner';

export async function bootstrapRootAllocation(client: IntakeTransaction, input: {
  recipientId: string; scopeId: string; sourceId?: string | null; action: C['IntakeAction'];
  reason: string; startsAt: string; expiresAt: string;
}): Promise<{ grantId: string; created: boolean }> {
  const session = await client.query<{ role_name: string }>('SELECT current_user AS role_name');
  if (session.rows[0]?.role_name === 'intake_business') throw new IntakeRejection('GRANT_AUTHORITY_DENIED', 'FORBIDDEN');
  const action = parseContractSchema('IntakeAction', input.action);
  const recipient = await principal(client, { id: input.recipientId });
  if (recipient.userId === DISPOSABLE_SYNTHETIC_OWNER) throw new IntakeRejection('SCOPE_DENIED', 'FORBIDDEN');
  const now = await clock(client);
  const startsAt = Date.parse(input.startsAt);
  const expiresAt = Date.parse(input.expiresAt);
  if (!input.reason.trim() || !Number.isFinite(startsAt) || !Number.isFinite(expiresAt) || startsAt > now || now >= expiresAt) {
    throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  }
  const scope = await client.query<{ tenant_id: string; app_id: string }>(
    'SELECT tenant_id, app_id FROM content_intake.scopes WHERE scope_id=$1', [input.scopeId]);
  const registered = scope.rows[0];
  if (!registered || registered.tenant_id !== recipient.tenantId || registered.app_id !== recipient.appId) {
    throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  }
  const sourceId = input.sourceId ?? null;
  if (sourceId !== null) {
    const source = await client.query('SELECT 1 FROM content_intake.sources WHERE source_id=$1 AND scope_id=$2', [sourceId, input.scopeId]);
    if (!source.rows[0]) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  }
  const existing = await client.query<{ grant_id: string }>(`
    SELECT grant_id FROM content_intake.grants
    WHERE recipient_id=$1 AND scope_id=$2 AND action=$3 AND kind='allocation' AND revoked_at IS NULL
      AND source_id IS NOT DISTINCT FROM $4 AND steward_id IS NOT NULL
      AND starts_at<=clock_timestamp() AND expires_at>clock_timestamp()
    ORDER BY grant_id LIMIT 1`, [recipient.id, input.scopeId, action, sourceId]);
  if (existing.rows[0]) return { grantId: existing.rows[0].grant_id, created: false };
  const id = `grant_${randomUUID()}`;
  await client.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,
    scope_id,source_id,action,starts_at,expires_at,reason,steward_id)
    VALUES ($1,'allocation',$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$2)`,
  [id, recipient.id, recipient.tenantId, recipient.appId, input.scopeId, sourceId, action, input.startsAt, input.expiresAt, input.reason.trim()]);
  await readGrant(client, id);
  return { grantId: id, created: true };
}

/** Listing uses precisely the command's current bounded authority, never the
 * original issuer alone. Allocation rows remain controlled bootstrap records. */
export async function mayManageGrant(client: IntakeTransaction, actor: Principal, grant: Grant): Promise<boolean> {
  if (grant.kind === 'allocation') return false;
  try { await parentAuthority(client, actor, grant.kind, grant.action, grant.scope); return true; }
  catch (error) {
    if (error instanceof IntakeRejection && ['SCOPE_DENIED','GRANT_AUTHORITY_DENIED','REDELEGATION_DENIED'].includes(error.reason)) return false;
    throw error;
  }
}

export async function createGrants(client: IntakeTransaction, issuer: Principal, request: C['IntakeGrantBatch']): Promise<C['IntakeGrantList']> {
  const prepared = await prepareGrants(client, issuer, request);
  // A query grant is read against the policy and store set version current at insert time.
  // Without them authorization_sources drops the row, so a granted query never takes effect.
  const stamped = await client.query<{ policy_version: string; store_set_version: string | null }>(`
    SELECT (SELECT version FROM content_intake.policy_versions WHERE tenant_id=$1 AND app_id=$2) AS policy_version,
           (SELECT version FROM content_intake.store_set_current WHERE tenant_id=$1 AND app_id=$2) AS store_set_version`,
  [issuer.tenantId, issuer.appId]);
  const queryStamp = stamped.rows[0] ?? { policy_version: null, store_set_version: null };
  const results: Grant[] = [], affected = new Set<string>();
  for (const { item, parent } of prepared) {
    const id = `grant_${randomUUID()}`;
    await client.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,
      scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id,policy_version,store_set_version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$3,$13,$14,$15)`,
    [id, item.kind, issuer.id, item.recipientPrincipalId, issuer.tenantId, issuer.appId, await scopeId(client, item.scope),
      item.scope.sourceId, item.action, item.startsAt, item.expiresAt, item.reason, parent,
      item.action === 'query' ? queryStamp.policy_version : null,
      item.action === 'query' ? queryStamp.store_set_version : null]);
    results.push(await readGrant(client, id));
    affected.add(item.recipientPrincipalId);
  }
  // A slow batch cannot extend any recipient/parent deadline observed earlier.
  for (const item of request.items) {
    requireFresh(await principal(client, { id: item.recipientPrincipalId }), await clock(client));
    await issuingParent(client, issuer, item.kind, item.action, item.scope, item);
  }
  // Once per subject per atomic batch, even for a multi-action grant.
  await client.query('UPDATE content_intake.principals SET revocation_generation=revocation_generation+1 WHERE principal_id=ANY($1::text[])', [[...affected].sort()]);
  return parseContractSchema('IntakeGrantList', { items: results, nextCursor: null });
}

export async function changeGrant(client: IntakeTransaction, actor: Principal, id: string, request: C['IntakeGrantChange']): Promise<Grant> {
  const grant = await readGrant(client, id);
  if (grant.kind === 'allocation') throw new IntakeRejection('GRANT_AUTHORITY_DENIED', 'NOT_FOUND');
  // A controlled allocator may revoke/take over within its own bounded authority;
  // original issuer identity alone is never sufficient after its authority expires.
  // Revocation/takeover do not issue or extend a grant. A newly qualified steward
  // need not have held authority when the original issuer created this grant.
  await parentAuthority(client, actor, grant.kind, grant.action, grant.scope);
  if (grant.revokedAt !== null && request.change === 'revoke') return grant;
  if (request.expectedVersion !== grant.version) throw new IntakeRejection('PERMISSION_CHANGED');
  if (request.stewardPrincipalId !== null) {
    const steward = await principal(client, { id: request.stewardPrincipalId });
    await parentAuthority(client, steward, grant.kind, grant.action, grant.scope);
  } else if (request.change === 'takeover') throw new IntakeRejection('NO_STEWARD', 'VALIDATION');
  const affected = new Set([grant.recipientPrincipalId]);
  if (grant.kind === 'delegation' && request.change === 'revoke') {
    const { rows } = await client.query<{ recipient_id: string }>(`UPDATE content_intake.grants SET
      steward_id=$2,version=version+1,last_change_reason=$3
      WHERE parent_grant_id=$1 AND kind='business' AND revoked_at IS NULL RETURNING recipient_id`,
    [id, request.stewardPrincipalId, request.reason]);
    rows.forEach(r => affected.add(r.recipient_id));
  }
  await client.query(`UPDATE content_intake.grants SET version=version+1,last_change_reason=$2,steward_id=$3,
    revoked_at=CASE WHEN $4='revoke' THEN clock_timestamp() ELSE revoked_at END WHERE grant_id=$1`,
  [id, request.reason, request.stewardPrincipalId, request.change]);
  await client.query('UPDATE content_intake.principals SET revocation_generation=revocation_generation+1 WHERE principal_id=ANY($1::text[])', [[...affected].sort()]);
  return readGrant(client, id);
}
