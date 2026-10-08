import { randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import { clock, IntakeRejection, principal, requireFresh, type IntakeTransaction, type Principal } from './transaction.js';

type C = components['schemas'];
type Scope = C['IntakeScope'];
type Grant = C['IntakeGrant'];
export type Source = { scopeId: string; scope: C['IntakeSourceScope']; version: number;
  templateVersion: string; ruleVersion: string; mappingVersion: string; mode: string };

export async function source(client: IntakeTransaction, id: string): Promise<Source> {
  const { rows } = await client.query<{ scope_id: string; tenant_id: string; app_id: string; brand_id: string;
    shop_id: string | null; domain: Scope['domain']; current_mapping_version: string;
    template_version: string; rule_version: string; mapping_version: string; mode: string }>(`
    SELECT s.*, src.current_mapping_version, src.mode, m.template_version,m.rule_version,m.mapping_version
    FROM content_intake.sources src JOIN content_intake.scopes s USING(scope_id)
    JOIN content_intake.source_mappings m ON m.source_id=src.source_id AND m.version=src.current_mapping_version
    WHERE src.source_id=$1`, [id]);
  const r = rows[0];
  if (!r) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  return { scopeId: r.scope_id, scope: { tenantId: r.tenant_id, appId: r.app_id, brandId: r.brand_id,
    shopId: r.shop_id, domain: r.domain, sourceId: id }, version: Number(r.current_mapping_version),
    templateVersion: r.template_version, ruleVersion: r.rule_version, mappingVersion: r.mapping_version, mode: r.mode };
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
  if (kind === 'delegation') return role === 'director' || role === 'manager';
  if (action === 'query') return true;
  return role === 'director' || role === 'manager' || role === 'supervisor' || role === 'lead';
}

/** Only director/manager allocate. Delegation cannot create another delegation;
 * it can still back a business grant. Historical rows stay and are rechecked. */
export function allocationKinds(actor: Principal, kind: 'business' | 'delegation'): ('allocation' | 'delegation')[] {
  if (actor.role !== 'director' && actor.role !== 'manager') return [];
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
  const prepared: { item: C['IntakeGrantItem']; parent: string }[] = [];
  for (const item of request.items) {
    const recipient = await principal(client, { id: item.recipientPrincipalId });
    requireFresh(recipient, await clock(client));
    client.validUntil(recipient.validUntil);
    if (issuer.tenantId !== recipient.tenantId || issuer.appId !== recipient.appId) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
    if (samePerson(issuer, recipient)) throw new IntakeRejection('SELF_ESCALATION', 'FORBIDDEN');
    if (recipient.factsVersion !== item.recipientFactsVersion) throw new IntakeRejection('PERMISSION_CHANGED');
    if (!recipientRoleAllows(recipient.role, item.kind, item.action)) throw new IntakeRejection('ROLE_CEILING', 'FORBIDDEN');
    if (!item.reason.trim() || Date.parse(item.expiresAt) <= Math.max(Date.parse(item.startsAt), await clock(client))) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
    const parent = await parentAuthority(client, issuer, item.kind, item.action, item.scope, item);
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
  const results: Grant[] = [], affected = new Set<string>();
  for (const { item, parent } of prepared) {
    const id = `grant_${randomUUID()}`;
    await client.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,
      scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$3,$13)`,
    [id, item.kind, issuer.id, item.recipientPrincipalId, issuer.tenantId, issuer.appId, await scopeId(client, item.scope),
      item.scope.sourceId, item.action, item.startsAt, item.expiresAt, item.reason, parent]);
    results.push(await readGrant(client, id));
    affected.add(item.recipientPrincipalId);
  }
  // A slow batch cannot extend any recipient/parent deadline observed earlier.
  for (const item of request.items) {
    requireFresh(await principal(client, { id: item.recipientPrincipalId }), await clock(client));
    await parentAuthority(client, issuer, item.kind, item.action, item.scope, item);
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
