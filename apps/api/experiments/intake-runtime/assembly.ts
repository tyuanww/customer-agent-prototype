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

/** Offline runtime candidate. An empty object catalog is readable and is not adoption.
 * claimManifest stays null; this factory never invents a list or calls refresh.
 * direct-v1 has no approval transport argument. Historical approval-v1 rows are not rewritten.
 */
export class IntakeRuntimeAssemblyRefusal extends Error {
  constructor(readonly reason:
    | 'CLAIM_LIST_UNUSABLE' | 'APPROVAL_TRANSPORT_REJECTED' | 'PARSER_UNAVAILABLE'
    | 'ORGANIZATION_DEPENDENCY_MISSING' | 'PURPOSE_PRIVILEGE_MISSING' | 'SOURCE_MODE_UNUSABLE'
    | 'FUNCTION_OWNER_UNUSABLE' | 'OBJECT_CATALOG_UNREADABLE' | 'CANCELLED' | 'CLOSED'
    | 'ALREADY_RUNNING' | 'LEGACY_ADOPTION_REFUSED' | 'ASSEMBLY_UNREADABLE',
  readonly gaps: readonly string[] = []) {
    super(reason);
  }
}

export type RuntimeAssemblyChecked = {
  readonly state: 'checked-not-activated';
  readonly ready: false;
  readonly legacyAdopted: false;
  readonly reason: 'CLAIM_MANIFEST_ABSENT';
  readonly catalogObjects: number;
  readonly claimManifest: null;
};

export type RuntimeParserProbe = { probe: (signal: AbortSignal) => Promise<boolean> };
export type OrganizationDependency = { refresh: (snapshot: unknown) => Promise<unknown> };
type PurposeName = 'usage' | 'business' | 'worker' | 'organization';
const PURPOSE_NAMES: readonly PurposeName[] = ['usage', 'business', 'worker', 'organization'];
const REQUEST_KEYS = ['claimManifest', 'connections', 'parser', 'organization', 'catalog'];

const SOURCE_MODE_SQL = `SELECT count(*) FILTER (WHERE mode='v2-preview')::int AS preview,
  count(*) FILTER (WHERE mode<>'v2-preview')::int AS other FROM content_intake.sources`;
const OWNER_SQL = `SELECT rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
  FROM pg_roles WHERE rolname='intake_runtime_fn_owner'`;
const CATALOG_COUNT_SQL = 'SELECT count(*)::int AS objects FROM content_intake.objects';

type RuntimeRequest = {
  connections: Record<PurposeName, AssemblyClient>;
  parser: RuntimeParserProbe;
  organization: OrganizationDependency;
  catalog: AssemblyClient;
};

function isClient(value: unknown): value is AssemblyClient {
  return !!value && typeof value === 'object' && typeof (value as AssemblyClient).query === 'function';
}

function readRequest(input: unknown): RuntimeRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new IntakeRuntimeAssemblyRefusal('CLAIM_LIST_UNUSABLE');
  const record = input as Record<string, unknown>;
  if ('approvalTransport' in record) throw new IntakeRuntimeAssemblyRefusal('APPROVAL_TRANSPORT_REJECTED');
  if (!Object.hasOwn(record, 'claimManifest') || record.claimManifest !== null) throw new IntakeRuntimeAssemblyRefusal('CLAIM_LIST_UNUSABLE');
  if (Object.keys(record).some(key => !REQUEST_KEYS.includes(key))) throw new IntakeRuntimeAssemblyRefusal('CLAIM_LIST_UNUSABLE');
  const connections = record.connections;
  if (!connections || typeof connections !== 'object' || Array.isArray(connections)) throw new IntakeRuntimeAssemblyRefusal('ASSEMBLY_UNREADABLE');
  const source = connections as Record<string, unknown>;
  const selected = {} as Record<PurposeName, AssemblyClient>;
  for (const name of PURPOSE_NAMES) {
    const client = source[name];
    if (!isClient(client)) throw new IntakeRuntimeAssemblyRefusal('ASSEMBLY_UNREADABLE');
    selected[name] = client;
  }
  const parser = record.parser;
  if (!parser || typeof parser !== 'object' || typeof (parser as RuntimeParserProbe).probe !== 'function') {
    throw new IntakeRuntimeAssemblyRefusal('PARSER_UNAVAILABLE');
  }
  const organization = record.organization;
  if (!organization || typeof organization !== 'object' || typeof (organization as OrganizationDependency).refresh !== 'function') {
    throw new IntakeRuntimeAssemblyRefusal('ORGANIZATION_DEPENDENCY_MISSING');
  }
  if (!isClient(record.catalog)) throw new IntakeRuntimeAssemblyRefusal('OBJECT_CATALOG_UNREADABLE');
  return { connections: selected, parser: parser as RuntimeParserProbe, organization: organization as OrganizationDependency, catalog: record.catalog };
}

function gapList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new IntakeRuntimeAssemblyRefusal('ASSEMBLY_UNREADABLE');
  return value as string[];
}

export function createIntakeRuntimeAssembly(input: unknown) {
  const request = readRequest(input);
  let closed = false;
  let checked = false;
  let controller: AbortController | null = null;
  return {
    async start(): Promise<RuntimeAssemblyChecked> {
      if (closed) throw new IntakeRuntimeAssemblyRefusal('CLOSED');
      if (checked || controller) throw new IntakeRuntimeAssemblyRefusal('ALREADY_RUNNING');
      controller = new AbortController();
      const signal = controller.signal;
      // Reserve the attempt before the first await. A query cannot be aborted by
      // this client interface, so discard its result before doing any next work.
      const checkActive = () => {
        if (closed) throw new IntakeRuntimeAssemblyRefusal('CLOSED');
        if (signal.aborted) throw new IntakeRuntimeAssemblyRefusal('CANCELLED');
      };
      const read = async (client: AssemblyClient, sql: string, params?: readonly unknown[]) => {
        checkActive();
        const result = await client.query(sql, params);
        checkActive();
        return result;
      };
      try {
        let parsed = false;
        try { parsed = await request.parser.probe(signal); }
        catch (error) {
          if (closed) throw new IntakeRuntimeAssemblyRefusal('CLOSED');
          if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw new IntakeRuntimeAssemblyRefusal('CANCELLED');
          throw error;
        }
        if (closed) throw new IntakeRuntimeAssemblyRefusal('CLOSED');
        if (signal.aborted) throw new IntakeRuntimeAssemblyRefusal('CANCELLED');
        if (!parsed) throw new IntakeRuntimeAssemblyRefusal('PARSER_UNAVAILABLE');
        for (const purpose of PURPOSE_NAMES) {
          let rows: { rows: Row[] };
          try { rows = await read(request.connections[purpose], 'SELECT intake_runtime_probe.purpose_gap($1) AS gap', [purpose]); }
          catch (error) {
            if (permissionDenied(error)) throw new IntakeRuntimeAssemblyRefusal('PURPOSE_PRIVILEGE_MISSING');
            throw error;
          }
          const gaps = gapList(rows.rows[0]?.gap);
          if (gaps.length) throw new IntakeRuntimeAssemblyRefusal('PURPOSE_PRIVILEGE_MISSING', gaps);
        }
        let modes: { rows: Row[] };
        try { modes = await read(request.connections.usage, SOURCE_MODE_SQL); }
        catch (error) {
          if (permissionDenied(error)) throw new IntakeRuntimeAssemblyRefusal('ASSEMBLY_UNREADABLE');
          throw error;
        }
        const preview = count(modes.rows[0]?.preview, 'preview');
        const other = count(modes.rows[0]?.other, 'other');
        if (preview < 1 || other !== 0) throw new IntakeRuntimeAssemblyRefusal('SOURCE_MODE_UNUSABLE');
        let owner: { rows: Row[] };
        try { owner = await read(request.connections.usage, OWNER_SQL); }
        catch (error) {
          if (permissionDenied(error)) throw new IntakeRuntimeAssemblyRefusal('FUNCTION_OWNER_UNUSABLE');
          throw error;
        }
        const ownerRow = owner.rows[0];
        if (!ownerRow || flag(ownerRow.rolcanlogin, 'rolcanlogin') || flag(ownerRow.rolsuper, 'rolsuper')
          || flag(ownerRow.rolcreaterole, 'rolcreaterole') || flag(ownerRow.rolcreatedb, 'rolcreatedb')
          || flag(ownerRow.rolbypassrls, 'rolbypassrls')) throw new IntakeRuntimeAssemblyRefusal('FUNCTION_OWNER_UNUSABLE');
        let catalog: { rows: Row[] };
        try { catalog = await read(request.catalog, CATALOG_COUNT_SQL); }
        catch (error) {
          if (permissionDenied(error)) throw new IntakeRuntimeAssemblyRefusal('OBJECT_CATALOG_UNREADABLE');
          throw error;
        }
        const catalogObjects = count(catalog.rows[0]?.objects, 'objects');
        checked = true;
        return Object.freeze({
          state: 'checked-not-activated', ready: false, legacyAdopted: false, reason: 'CLAIM_MANIFEST_ABSENT',
          catalogObjects, claimManifest: null,
        });
      } finally {
        controller = null;
      }
    },
    // Connections are borrowed. Neither cancel nor close shuts down their pools;
    // the caller owns those lifecycles. Only this check and its parser signal stop.
    cancel(): void { controller?.abort(); },
    close(): void { closed = true; checked = false; controller?.abort(); },
    adoptLegacy(): never { throw new IntakeRuntimeAssemblyRefusal('LEGACY_ADOPTION_REFUSED'); },
  };
}
