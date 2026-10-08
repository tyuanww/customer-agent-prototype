/** Offline assembly probe. Excluded from API dist and HTTP registration.
 * A missing claim manifest is never completed by an empty release catalog,
 * an administrator connection, or a login/job role label. This module does not
 * accept a manifest, insert lineage, call inherit_legacy_catalog, or open a pool.
 */

type Row = Record<string, unknown>;
export type AssemblyClient = {
  query: (sql: string, params?: readonly unknown[]) => Promise<{ rows: Row[] }>;
};

export class IntakeAssemblyRefusal extends Error {
  readonly reason = 'CLAIM_LIST_UNUSABLE' as const;
  constructor() {
    super('CLAIM_LIST_UNUSABLE');
  }
}

export type AssemblyDecision = {
  readonly ready: false;
  readonly legacyAdopted: false;
  readonly reason: 'CLAIM_MANIFEST_ABSENT' | 'ASSEMBLY_UNREADABLE';
  readonly actor: string | null;
  readonly releaseId: string | null;
  readonly catalogPresent: boolean;
  readonly lineageCount: number;
  readonly legacyItemCount: number;
  readonly emptyCatalog: boolean;
  readonly administratorPool: boolean;
  readonly identityWritable: boolean;
  readonly canInheritLegacyCatalog: boolean;
};

export type ShopAuthorization = {
  readonly principalId: string;
  readonly action: string;
  readonly scopeId: string;
  readonly sourceId: string;
  readonly granted: boolean;
  readonly loginRole: string | null;
  readonly matchedRoles: readonly string[];
  readonly deadline: string | null;
};

const CATALOG_SQL = `SELECT current_user AS actor, c.current_release_id,
  EXISTS (SELECT 1 FROM content_intake.release_catalogs cat WHERE cat.release_id=c.current_release_id) AS catalog_present,
  (SELECT count(*)::int FROM content_intake.release_lineage l WHERE l.release_id=c.current_release_id) AS lineage_count,
  (SELECT count(*)::int FROM public.release_items i WHERE i.release_id=c.current_release_id) AS legacy_item_count
  FROM public.content_current c WHERE c.id=1`;

const ACTOR_SQL = `SELECT current_user AS actor, r.rolsuper, r.rolcreaterole, r.rolbypassrls,
  EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='content_intake' AND c.relname='release_catalogs' AND c.relowner=r.oid) AS owns_catalog,
  has_function_privilege(current_user,'content_intake.inherit_legacy_catalog(text,text)','EXECUTE') AS can_inherit,
  COALESCE((SELECT bool_or(has_table_privilege(current_user,c.oid,p.priv))
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE')) AS p(priv)
    WHERE n.nspname='backend_identity'
      AND c.relname IN ('sessions','subject_bindings','capability_bindings','login_requests')),false) AS identity_writable
  FROM pg_roles r WHERE r.rolname=current_user`;

function absentManifest(input: unknown): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new IntakeAssemblyRefusal();
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== 'claimManifest' || record.claimManifest !== null) throw new IntakeAssemblyRefusal();
}

function permissionDenied(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '42501';
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`ASSEMBLY_SHAPE:${name}`);
  return value;
}
function flag(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`ASSEMBLY_SHAPE:${name}`);
  return value;
}
function count(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`ASSEMBLY_SHAPE:${name}`);
  return value;
}

const unread = (reason: AssemblyDecision['reason']): AssemblyDecision => Object.freeze({
  ready: false, legacyAdopted: false, reason, actor: null, releaseId: null, catalogPresent: false,
  lineageCount: 0, legacyItemCount: 0, emptyCatalog: false, administratorPool: false,
  identityWritable: false, canInheritLegacyCatalog: false,
});

/** Refuse legacy adoption unless a claim manifest exists. This experiment has no
 * approved manifest, so the only decision is refusal. An empty catalog row and a
 * superuser/owner/identity-writer connection are reported and then ignored. */
export async function assessIntakeRuntimeAssembly(client: AssemblyClient, input: unknown): Promise<AssemblyDecision> {
  absentManifest(input);
  try {
    const catalog = await client.query(CATALOG_SQL);
    const actor = await client.query(ACTOR_SQL);
    const catalogRow = catalog.rows[0];
    const actorRow = actor.rows[0];
    if (!actorRow) return unread('ASSEMBLY_UNREADABLE');
    const identityWritable = flag(actorRow.identity_writable, 'identity_writable');
    const canInheritLegacyCatalog = flag(actorRow.can_inherit, 'can_inherit');
    const administratorPool = flag(actorRow.rolsuper, 'rolsuper') || flag(actorRow.rolcreaterole, 'rolcreaterole')
      || flag(actorRow.rolbypassrls, 'rolbypassrls') || flag(actorRow.owns_catalog, 'owns_catalog')
      || identityWritable || canInheritLegacyCatalog;
    const releaseId = catalogRow ? text(catalogRow.current_release_id, 'current_release_id') : null;
    const catalogPresent = catalogRow ? flag(catalogRow.catalog_present, 'catalog_present') : false;
    const lineageCount = catalogRow ? count(catalogRow.lineage_count, 'lineage_count') : 0;
    const legacyItemCount = catalogRow ? count(catalogRow.legacy_item_count, 'legacy_item_count') : 0;
    return Object.freeze({
      ready: false,
      legacyAdopted: false,
      reason: 'CLAIM_MANIFEST_ABSENT',
      actor: text(actorRow.actor, 'actor'),
      releaseId,
      catalogPresent,
      lineageCount,
      legacyItemCount,
      emptyCatalog: catalogPresent && lineageCount === 0 && legacyItemCount === 0,
      administratorPool,
      identityWritable,
      canInheritLegacyCatalog,
    });
  } catch (error) {
    if (permissionDenied(error)) return unread('ASSEMBLY_UNREADABLE');
    throw error;
  }
}

/** Read the existing authorization function. Login role and matched job-role
 * labels are returned only as observations; they are not turned into a grant. */
export async function readShopAuthorization(client: AssemblyClient, principalId: string, action: string, scopeId: string, sourceId: string): Promise<ShopAuthorization> {
  const login = await client.query(`SELECT b.role AS login_role FROM content_intake.principals p
    JOIN backend_identity.subject_bindings b ON b.user_id=p.user_id WHERE p.principal_id=$1`, [principalId]);
  const roles = await client.query(`SELECT r.role FROM content_intake.principals p
    JOIN content_intake.principal_facts f ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
    JOIN content_intake.role_rules r ON r.tenant_id=p.tenant_id AND r.app_id=p.app_id
      AND r.job_id=f.job_id AND r.department_id=ANY(f.department_ids)
    WHERE p.principal_id=$1 ORDER BY r.role`, [principalId]);
  const deadline = await client.query(`SELECT content_intake.authorization_deadline($1,$2,$3,$4,clock_timestamp()) AS until`,
    [principalId, action, scopeId, sourceId]);
  const until = deadline.rows[0]?.until;
  const iso = until instanceof Date ? until.toISOString() : null;
  return Object.freeze({
    principalId, action, scopeId, sourceId, granted: iso !== null,
    loginRole: typeof login.rows[0]?.login_role === 'string' ? login.rows[0].login_role : null,
    matchedRoles: roles.rows.map(row => text(row.role, 'role')),
    deadline: iso,
  });
}
