import { randomBytes } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { AuthenticatedUser } from '../auth-service.js';
import { canonical, digest, SNAPSHOT_VOCABULARY_LIMIT, snapshotVocabularyKeys } from './material.js';
import { listPreviews, previewApplies, type LinkedPreview } from './linked-preview.js';
import { clock, createIntakeTransactions, lockProductSession, IntakeRejection, type IntakeTransaction, type Principal } from './transaction.js';

type C = components['schemas'];
/** Immutable server-owned context, reconstructed from storage for every page.
 * Main owns its current selection; it never resends selection with pagination. */
type IntakeUsageContext = {
  sessionTokenHash: string; shopId: string; contextGeneration: number;
  productIds: string[]; scenarioIds: string[];
};
/** Internal trusted reader: list metadata only; open exactly one authorized row.
 * The opaque storage value belongs to the adapter and never crosses the wire. */
export type IntakePreviewItem = Omit<LinkedPreview, 'bytes'> & {
  sizeBytes: number; storage: unknown; operation?: string;
  effectiveFrom?: string | null; effectiveTo?: string | null;
};
export type IntakePreviewReader = {
  list(client: IntakeTransaction, context: { principalId: string; entitlementHash: string;
    sessionTokenHash: string; releaseId: string; sourceIds: ReadonlySet<string> }): Promise<readonly IntakePreviewItem[]>;
  read(item: IntakePreviewItem): Promise<Buffer>;
};
const memoryPreviewReader: IntakePreviewReader = {
  async list(_client, context) {
    return listPreviews(context.releaseId, context.sourceIds).map(item => ({ ...item,
      sizeBytes: item.bytes.length, storage: item.bytes }));
  },
  async read(item) {
    if (!Buffer.isBuffer(item.storage)) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
    return item.storage;
  },
};
type ScopeRow = { source_id: string; scope: C['IntakeSourceScope']; generation: string; mode_version: string; mode: string; until: Date | null };
type Lease = { entitlement_hash: string; release_id: string; shop_id: string; context_generation: string;
  principal_generation: string; issued_at: Date; valid_until: Date; expires_at: Date; client_id: string; source_binding_hash: string;
  product_ids: string[]; scenario_ids: string[] };

async function validateSelection(client: IntakeTransaction, ctx: IntakeUsageContext, scopes: ScopeRow[]) {
  const selected = [...ctx.productIds.map(id => ({id,kind:'product'})), ...ctx.scenarioIds.map(id => ({id,kind:'scenario'}))];
  const result = await client.query<{ count: string }>(`SELECT count(*) FROM jsonb_to_recordset($1::jsonb) selected(id text,kind text)
    JOIN content_intake.vocabulary v ON v.vocabulary_id=selected.id AND v.kind=selected.kind AND v.active
    JOIN content_intake.scopes s USING(scope_id)
    WHERE (s.shop_id=$2 OR s.shop_id IS NULL) AND EXISTS (SELECT 1 FROM jsonb_to_recordset($3::jsonb)
      allowed("tenantId" text,"appId" text,"brandId" text,domain text)
      WHERE s.tenant_id=allowed."tenantId" AND s.app_id=allowed."appId" AND s.brand_id=allowed."brandId" AND s.domain=allowed.domain)`,
  [JSON.stringify(selected), ctx.shopId, JSON.stringify(scopes.map(s => s.scope))]);
  if (Number(result.rows[0]!.count)!==selected.length) throw new IntakeRejection('SCOPE_DENIED','NOT_FOUND');
}

// The old lease's opaque client identity is namespaced to this server-owned
// session/selection and the exact source generations. The private session hash
// is persisted only in entitlement_contexts; no bearer/lease token is exposed.
function binding(ctx: IntakeUsageContext, scopes: ScopeRow[]): string {
  return `intake:${digest(canonical({ ...ctx, sources: scopes.map(s =>
    [s.source_id, s.generation, s.mode_version]).sort((a,b) => a[0]! < b[0]! ? -1 : 1) }))}`;
}

async function scopesFor(client: IntakeTransaction, actor: Principal, shop: string, hash?: string): Promise<ScopeRow[]> {
  const { rows } = await client.query<ScopeRow>(`SELECT src.source_id,src.revocation_generation AS generation,src.mode_version,src.mode,
    jsonb_build_object('tenantId',s.tenant_id,'appId',s.app_id,'brandId',s.brand_id,'shopId',s.shop_id,'domain',s.domain,'sourceId',src.source_id) AS scope,
    content_intake.authorization_deadline($1,'query',s.scope_id,src.source_id,clock_timestamp()) AS until
    FROM content_intake.sources src JOIN content_intake.scopes s USING(scope_id)
    WHERE s.tenant_id=$2 AND s.app_id=$3 AND (s.shop_id=$4 OR s.shop_id IS NULL)
      AND ($5::text IS NULL OR EXISTS (SELECT 1 FROM content_intake.entitlement_scopes es WHERE es.entitlement_hash=$5 AND es.source_id=src.source_id))
    ORDER BY src.source_id COLLATE "C"`, [actor.id, actor.tenantId, actor.appId, shop, hash ?? null]);
  if (hash) {
    const count = await client.query<{ count: string }>('SELECT count(*) FROM content_intake.entitlement_scopes WHERE entitlement_hash=$1', [hash]);
    if (Number(count.rows[0]!.count) !== rows.length || rows.some(s => !s.until || s.mode !== 'v2-preview')) {
      throw new IntakeRejection('PERMISSION_CHANGED', 'FORBIDDEN');
    }
  }
  const authorized = rows.filter(s => s.until && s.mode === 'v2-preview');
  const brands = new Set(authorized.filter(s => s.scope.shopId === shop).map(s => s.scope.brandId));
  if (!brands.size) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  const selected = authorized.filter(s => brands.has(s.scope.brandId));
  if (selected.length !== rows.length && hash) throw new IntakeRejection('PERMISSION_CHANGED', 'FORBIDDEN');
  for (const s of selected) client.validUntil(s.until!.getTime());
  return selected;
}

/** Whole-release approval dependencies are checked even when some sources are
 * outside this shop. A revoked inherited approval invalidates the whole release.
 * This only consumes local facts; refresh/remote I/O belongs to evidence.ts. */
async function releaseDeadline(client: IntakeTransaction, releaseId: string, tenant: string): Promise<number> {
  const release = await client.query<{ ready: boolean; revoked: boolean }>(`SELECT
    (gate.source_gate_ready AND public.owner_acceptance_release_content_ready(c.release_id)) AS ready,
    EXISTS (SELECT 1 FROM content_intake.release_revocations r WHERE r.release_id=c.release_id) AS revoked
    FROM content_intake.release_catalogs c JOIN public.content_releases cr USING(release_id)
    JOIN public.v_release_source_gate gate USING(release_id) WHERE c.release_id=$1 AND cr.tenant_id=$2`, [releaseId, tenant]);
  if (!release.rows[0]) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  if (release.rows[0].revoked) throw new IntakeRejection('APPROVAL_REVOKED', 'FORBIDDEN');
  if (!release.rows[0].ready) throw new IntakeRejection('SOURCE_MISMATCH', 'FORBIDDEN');
  // Current source bindings and immutable material remain mandatory for both
  // policies. A new lease cannot make an old mapping current again merely because
  // direct publication no longer has a short-lived approval observation.
  const provenance = await client.query(`SELECT 1 FROM content_intake.release_lineage l
    JOIN content_intake.candidate_versions c ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version
    JOIN content_intake.sources s ON s.source_id=l.source_id
    LEFT JOIN content_intake.source_confirmations sc ON sc.candidate_id=c.candidate_id AND sc.candidate_version=c.version
      AND sc.evidence_version=c.source_evidence_version
    WHERE l.release_id=$1 AND (s.mode<>'v2-preview' OR s.current_mapping_version<>c.source_version OR c.state<>'published'
      OR sc.candidate_digest IS DISTINCT FROM c.digest OR sc.object_sha256 IS DISTINCT FROM c.file_sha256) LIMIT 1`, [releaseId]);
  if (provenance.rowCount) throw new IntakeRejection('SOURCE_MISMATCH', 'FORBIDDEN');
  // Shared with both publication writers: old catalogs cannot bypass the full
  // family/root proof simply because their candidate predates this reader.
  try {
    await client.query('SELECT content_intake.assert_family_catalog($1::text)', [releaseId]);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ZA003' && error.message === 'SOURCE_MISMATCH') {
      throw new IntakeRejection('SOURCE_MISMATCH', 'FORBIDDEN');
    }
    throw error;
  }
  const facts = await client.query<{ invalid: boolean; until: Date | null }>(`SELECT
    coalesce(bool_or(f.state IS DISTINCT FROM 'approved' OR f.checked_at>clock_timestamp()
      OR f.valid_until<=clock_timestamp() OR f.package_verified_sha256 IS DISTINCT FROM r.package_sha256),false) AS invalid,
    min(f.valid_until) AS until FROM (
      SELECT review_request_id FROM content_intake.release_lineage WHERE release_id=$1 AND publication_policy='approval-v1'
      UNION SELECT review_request_id FROM content_intake.release_rollback_lineage WHERE release_id=$1
    ) l
    LEFT JOIN content_intake.review_bindings r USING(review_request_id)
    LEFT JOIN content_intake.approval_current cur USING(review_request_id)
    LEFT JOIN content_intake.approval_facts f ON f.review_request_id=cur.review_request_id AND f.facts_version=cur.facts_version
    `, [releaseId]);
  if (facts.rows[0]!.invalid) throw new IntakeRejection('APPROVAL_UNAVAILABLE', 'FORBIDDEN');
  const owners = await client.query<{ until: Date | null }>(`SELECT min(public.owner_acceptance_instant(a.record->'expires_at')) AS until
    FROM public.release_items i JOIN public.content_releases r USING(release_id)
    JOIN public.owner_acceptance_records a ON a.tenant_id=r.tenant_id AND a.record_sha256=i.owner_acceptance_record_sha256
    WHERE i.release_id=$1 AND i.review_mode='owner_acceptance'`, [releaseId]);
  return Math.min(facts.rows[0]!.until?.getTime() ?? Infinity, owners.rows[0]!.until?.getTime() ?? Infinity);
}

// Expand each immutable candidate once, not once per lineage row (5,000 x 5,000).
const entries = `WITH materials AS MATERIALIZED (
  SELECT c.source_id,c.candidate_id,c.version,c.material FROM content_intake.candidate_versions c
  WHERE c.source_id=ANY($2::text[]) AND EXISTS (SELECT 1 FROM content_intake.release_lineage l
    WHERE l.release_id=$1 AND l.candidate_id=c.candidate_id AND l.candidate_version=c.version)),
  expanded AS MATERIALIZED (SELECT c.source_id,c.candidate_id,c.version,e FROM materials c
    CROSS JOIN LATERAL jsonb_array_elements(c.material->'entries') e)
  SELECT l.source_id,l.business_entry_id,e FROM expanded c JOIN content_intake.release_lineage l
    ON l.release_id=$1 AND l.source_id=c.source_id AND l.candidate_id=c.candidate_id
    AND l.candidate_version=c.version AND l.business_entry_id=c.e->>'businessEntryId'`;
export const contentEntryAppliesSql = `e->>'operation'='upsert'
  AND (cardinality($4::text[])=0 OR EXISTS (SELECT 1 FROM jsonb_array_elements(e->'productRefs') ref WHERE ref->>'id'=ANY($4::text[])))
  AND (cardinality($5::text[])=0 OR EXISTS (SELECT 1 FROM jsonb_array_elements(e->'scenarioRefs') ref WHERE ref->>'id'=ANY($5::text[])))
  AND NOT (coalesce(e->>'familySourceId','')='' AND jsonb_array_length(e->'productRefs')=0 AND jsonb_array_length(e->'scenarioRefs')=0
    AND EXISTS (SELECT 1 FROM content_intake.sources src JOIN content_intake.scopes sc USING (scope_id)
      WHERE src.source_id=entries.source_id AND sc.shop_id IS NULL))`;
const applies = contentEntryAppliesSql;

async function contentDeadline(client: IntakeTransaction, release: string, scopes: ScopeRow[], ctx: IntakeUsageContext, now: number): Promise<number> {
  const { rows } = await client.query<{ until: Date | null }>(`WITH entries AS (${entries}) SELECT
    min(CASE WHEN (e->>'effectiveFrom')::timestamptz>$3 THEN (e->>'effectiveFrom')::timestamptz
      ELSE (e->>'effectiveTo')::timestamptz END) FILTER (WHERE ${applies}
      AND ((e->>'effectiveTo') IS NULL OR (e->>'effectiveTo')::timestamptz>$3)) AS until FROM entries`,
  [release, scopes.map(s => s.source_id), new Date(now), ctx.productIds, ctx.scenarioIds]);
  // Include starts/ends of currently hidden overrides: a lease must expire
  // before its shop choice would switch to/from the generic family root.
  return rows[0]!.until?.getTime() ?? Infinity;
}

type Page = { entitlementId: string; cursor?: string; limit: number };
function page(raw: unknown): Page {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !['entitlementId','cursor','limit'].includes(k))) {
    throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  }
  const v = raw as Record<string,unknown>;
  const limit = v.limit === undefined ? 50 : v.limit;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100
    || (v.cursor !== undefined && (typeof v.cursor !== 'string' || !v.cursor.length || v.cursor.length > 512))) {
    throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  }
  return { entitlementId: parseContractSchema('IntakeId',v.entitlementId), limit,
    ...(v.cursor === undefined ? {} : { cursor: v.cursor as string }) };
}
function cursor(raw: string | undefined, hash: string): [string,string] {
  if (raw === undefined) return ['',''];
  try {
    const decoded: unknown = JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
    if (!Array.isArray(decoded) || decoded.length!==3 || decoded[0]!==hash
      || Buffer.from(JSON.stringify(decoded)).toString('base64url')!==raw) throw new Error('CURSOR_BINDING');
    return [parseContractSchema('IntakeId',decoded[1]),parseContractSchema('IntakeId',decoded[2])];
  } catch { throw new IntakeRejection('FILE_INVALID','VALIDATION'); }
}

function decodePreview(value: unknown) {
  const preview = value as { mime?: unknown; sha256?: unknown; bytesBase64?: unknown; url?: unknown; items?: unknown };
  if ('url' in preview) throw new IntakeRejection('FILE_INVALID','VALIDATION');
  if (Array.isArray(preview.items)) {
    if ('bytesBase64' in preview || 'mime' in preview) throw new IntakeRejection('FILE_INVALID','VALIDATION');
    return { items: preview.items.map(item => {
      if (!item || typeof item !== 'object') throw new IntakeRejection('FILE_INVALID','VALIDATION');
      const row = item as { objectId?: unknown; sha256?: unknown; url?: unknown };
      if (typeof row.objectId !== 'string' || !/^med_[0-9a-f]{64}$/.test(row.objectId)
        || typeof row.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.sha256) || 'url' in row) {
        throw new IntakeRejection('FILE_INVALID','VALIDATION');
      }
      return { objectId: row.objectId, sha256: row.sha256 };
    }) };
  }
  if (typeof preview.mime !== 'string' || typeof preview.sha256 !== 'string' || typeof preview.bytesBase64 !== 'string') {
    throw new IntakeRejection('FILE_INVALID','VALIDATION');
  }
  return { mime: preview.mime, sha256: preview.sha256, bytesBase64: preview.bytesBase64 };
}

/** The single usage owner hides deadlines, immutable pagination and white-list
 * projection. It shares the transaction/lease owners; there is no second current,
 * permission cache, remote approval call, legacy read adapter or runtime ACL. */
export function createIntakeUsage(run: ReturnType<typeof createIntakeTransactions>, previewReader: IntakePreviewReader = memoryPreviewReader) {
  async function selectPreview(client: IntakeTransaction, who: Principal, actor: AuthenticatedUser, raw: unknown) {
    const query = raw as { entitlementId?: unknown; objectId?: unknown };
    const entitlementId = parseContractSchema('IntakeId', query.entitlementId);
    if (query.objectId !== undefined && (typeof query.objectId !== 'string' || !/^med_[0-9a-f]{64}$/.test(query.objectId))) {
      throw new IntakeRejection('FILE_INVALID','VALIDATION');
    }
    const hash = digest(entitlementId), {hash:sessionTokenHash,validUntil:sessionUntil}=await lockProductSession(client,actor);
    const leases=await client.query<Lease>(`SELECT e.*,l.client_id,l.expires_at,l.source_binding_hash,c.product_ids,c.scenario_ids
      FROM content_intake.entitlements e JOIN public.snapshot_offline_leases l USING(lease_token_hash)
      JOIN content_intake.entitlement_contexts c USING(entitlement_hash)
      WHERE e.entitlement_hash=$1 AND e.principal_id=$2 AND e.user_id=$3 AND c.session_token_hash=$4`,[hash,who.id,who.userId,sessionTokenHash]);
    const lease=leases.rows[0];
    if (!lease) throw new IntakeRejection('SCOPE_DENIED','NOT_FOUND');
    const ctx: IntakeUsageContext={sessionTokenHash,shopId:lease.shop_id,contextGeneration:Number(lease.context_generation),
      productIds:lease.product_ids,scenarioIds:lease.scenario_ids};
    if (Number(lease.principal_generation)!==who.generation) throw new IntakeRejection('PERMISSION_CHANGED','FORBIDDEN');
    if (Math.min(lease.valid_until.getTime(),lease.expires_at.getTime())<=await clock(client)) throw new IntakeRejection('LEASE_EXPIRED','FORBIDDEN');
    const scopes=await scopesFor(client,who,ctx.shopId,hash);
    if (lease.client_id!==binding(ctx,scopes)) throw new IntakeRejection('SCOPE_DENIED','NOT_FOUND');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('cs_ai_content_publish'))");
    const until=Math.min(lease.valid_until.getTime(),lease.expires_at.getTime(),sessionUntil,who.validUntil,
      ...scopes.map(scope => scope.until!.getTime()),await releaseDeadline(client,lease.release_id,who.tenantId),
      await contentDeadline(client,lease.release_id,scopes,ctx,lease.issued_at.getTime()));
    client.validUntil(until);
    const sourceIds=new Set(scopes.map(scope=>scope.source_id));
    const at = lease.issued_at.getTime();
    const visible = (await previewReader.list(client, { principalId: who.id, entitlementHash: hash,
      sessionTokenHash, releaseId: lease.release_id, sourceIds })).filter(item => sourceIds.has(item.sourceId)
        && (item.operation === undefined || item.operation === 'upsert')
        && (item.effectiveFrom == null || Date.parse(item.effectiveFrom) <= at)
        && (item.effectiveTo == null || Date.parse(item.effectiveTo) > at)
        && previewApplies(item, ctx, scopes.some(scope => scope.source_id === item.sourceId && scope.scope.shopId === null)));
    // Applicability belongs to a row. Deduplicate shared bytes only after all
    // row filters; an invisible first row must not hide another visible row.
    const linked = new Map<string, IntakePreviewItem>();
    for (const item of visible) {
      const previous = linked.get(item.objectId);
      if (previous && (previous.sha256 !== item.sha256 || previous.mime !== item.mime || previous.sizeBytes !== item.sizeBytes)) {
        throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
      }
      linked.set(item.objectId, item);
    }
    if (query.objectId === undefined) return { kind: 'list' as const, value: decodePreview({ items: [...linked.values()].map(({ objectId, sha256 }) => ({ objectId, sha256 })) }) };
    const item = linked.get(query.objectId);
    if (!item) throw new IntakeRejection('SCOPE_DENIED','NOT_FOUND');
    return { kind: 'item' as const, item, validUntil: until };
  }
  return {
    issueEntitlement(actor: AuthenticatedUser, raw: unknown) {
      return run(actor,'entitlement',null,null,async (client,who) => {
        const req=parseContractSchema('IntakeEntitlementRequest',raw);
        const {hash:sessionTokenHash,validUntil:sessionUntil}=await lockProductSession(client,actor);
        const ctx: IntakeUsageContext={sessionTokenHash,shopId:req.shopId,contextGeneration:req.contextGeneration,
          productIds:[...req.productIds].sort(),scenarioIds:[...req.scenarioIds].sort()};
        await client.query("SELECT pg_advisory_xact_lock(hashtext('cs_ai_content_publish'))");
        const scopes=await scopesFor(client,who,ctx.shopId);
        await validateSelection(client,ctx,scopes);
        const current=await client.query<{ current_release_id: string }>('SELECT current_release_id FROM public.content_current WHERE id=1');
        const release=current.rows[0]?.current_release_id;
        if (!release) throw new IntakeRejection('SCOPE_DENIED','NOT_FOUND');
        if (req.releaseId!==null && req.releaseId!==release) throw new IntakeRejection('BASE_CHANGED');
        const issued=await clock(client);
        let until=Math.min(who.validUntil,sessionUntil,issued+300_000,...scopes.map(s=>s.until!.getTime()),
          await releaseDeadline(client,release,who.tenantId),await contentDeadline(client,release,scopes,ctx,issued));
        const lease=await client.query<{ offline_lease_token: string; lease_expires_at: Date; release_id: string }>(
          'SELECT * FROM public.issue_snapshot_offline_lease($1,$2,300)',[binding(ctx,scopes),who.userId]);
        const base=lease.rows[0]!;
        if (base.release_id!==release) throw new IntakeRejection('BASE_CHANGED');
        // Preserve PostgreSQL microseconds in SQL. A JS Date round trip truncates
        // issued_at and can put the entitlement BEFORE its underlying lease.
        const leaseHash=digest(base.offline_lease_token);
        until=Math.min(until,base.lease_expires_at.getTime());
        if (until<=await clock(client)) throw new IntakeRejection('LEASE_EXPIRED','FORBIDDEN');
        client.validUntil(until);
        const id=`ite_${randomBytes(32).toString('hex')}`, hash=digest(id);
        await client.query(`INSERT INTO content_intake.entitlements(entitlement_hash,principal_id,user_id,lease_token_hash,release_id,
          shop_id,context_generation,principal_generation,release_generation,issued_at,valid_until)
          SELECT $1,$2,$3,$4,$5,$6,$7,$8,0,issued_at,$9 FROM public.snapshot_offline_leases WHERE lease_token_hash=$4`,
        [hash,who.id,who.userId,leaseHash,release,ctx.shopId,ctx.contextGeneration,who.generation,new Date(until)]);
        await client.query('INSERT INTO content_intake.entitlement_scopes SELECT $1,unnest($2::text[])',[hash,scopes.map(s=>s.source_id)]);
        await client.query(`INSERT INTO content_intake.entitlement_contexts(entitlement_hash,session_token_hash,product_ids,scenario_ids)
          VALUES ($1,$2,$3,$4)`,[hash,sessionTokenHash,ctx.productIds,ctx.scenarioIds]);
        return { entitlementId:id,releaseId:release,shopId:ctx.shopId,contextGeneration:ctx.contextGeneration,
          revocationGeneration:who.generation,validUntil:new Date(until).toISOString(),scopes:scopes.map(s=>s.scope) };
      },v=>parseContractSchema('IntakeEntitlement',v));
    },
    snapshot(actor: AuthenticatedUser, raw: unknown) {
      return run(actor,'snapshot',null,null,async (client,who) => {
        const req=page(raw), hash=digest(req.entitlementId), {hash:sessionTokenHash}=await lockProductSession(client,actor);
        const leases=await client.query<Lease>(`SELECT e.*,l.client_id,l.expires_at,l.source_binding_hash,c.product_ids,c.scenario_ids
          FROM content_intake.entitlements e JOIN public.snapshot_offline_leases l USING(lease_token_hash)
          JOIN content_intake.entitlement_contexts c USING(entitlement_hash)
          WHERE e.entitlement_hash=$1 AND e.principal_id=$2 AND e.user_id=$3 AND c.session_token_hash=$4`,[hash,who.id,who.userId,sessionTokenHash]);
        const lease=leases.rows[0];
        if (!lease) throw new IntakeRejection('SCOPE_DENIED','NOT_FOUND');
        const ctx: IntakeUsageContext={sessionTokenHash,shopId:lease.shop_id,contextGeneration:Number(lease.context_generation),
          productIds:lease.product_ids,scenarioIds:lease.scenario_ids};
        if (Number(lease.principal_generation)!==who.generation) throw new IntakeRejection('PERMISSION_CHANGED','FORBIDDEN');
        if (Math.min(lease.valid_until.getTime(),lease.expires_at.getTime())<=await clock(client)) throw new IntakeRejection('LEASE_EXPIRED','FORBIDDEN');
        const scopes=await scopesFor(client,who,ctx.shopId,hash);
        if (lease.client_id!==binding(ctx,scopes)) throw new IntakeRejection('SCOPE_DENIED','NOT_FOUND');
        await client.query("SELECT pg_advisory_xact_lock(hashtext('cs_ai_content_publish'))");
        const until=Math.min(lease.valid_until.getTime(),lease.expires_at.getTime(),await releaseDeadline(client,lease.release_id,who.tenantId));
        client.validUntil(until);
        await contentDeadline(client,lease.release_id,scopes,ctx,lease.issued_at.getTime());
        const after=cursor(req.cursor,hash);
        // Resolve the complete authorized set BEFORE pagination. Each selected
        // product/scenario gets an integer slot (one unrestricted slot if empty).
        // Multiranges union scenario coverage per product without expanding the
        // full product x scenario Cartesian set for every family and every page.
        const result=await client.query<{ source_id: string; business_entry_id: string; e: C['IntakeEntry'] }>(`WITH entries AS (${entries}),
          products AS MATERIALIZED (SELECT id,(n-1)::int slot FROM unnest(
            CASE WHEN cardinality($4::text[])=0 THEN ARRAY[NULL::text] ELSE $4 END) WITH ORDINALITY p(id,n)),
          scenarios AS MATERIALIZED (SELECT id,(n-1)::int slot FROM unnest(
            CASE WHEN cardinality($5::text[])=0 THEN ARRAY[NULL::text] ELSE $5 END) WITH ORDINALITY s(id,n)),
          eligible AS MATERIALIZED (SELECT * FROM entries WHERE ${applies} AND (e->>'effectiveFrom')::timestamptz<=$3
            AND ((e->>'effectiveTo') IS NULL OR (e->>'effectiveTo')::timestamptz>$3)),
          contexts AS MATERIALIZED (SELECT *,
            CASE WHEN jsonb_array_length(e->'productRefs')=0
              THEN CASE WHEN cardinality($4::text[])=0 THEN int4multirange(int4range(0,1)) ELSE int4multirange() END
              ELSE (SELECT range_agg(int4range(p.slot,p.slot+1)) FROM products p
                WHERE p.id=ANY(ARRAY(SELECT ref->>'id' FROM jsonb_array_elements(e->'productRefs') ref))) END product_mask,
            CASE WHEN jsonb_array_length(e->'scenarioRefs')=0
              THEN CASE WHEN cardinality($5::text[])=0 THEN int4multirange(int4range(0,1)) ELSE int4multirange() END
              ELSE (SELECT range_agg(int4range(s.slot,s.slot+1)) FROM scenarios s
                WHERE s.id=ANY(ARRAY(SELECT ref->>'id' FROM jsonb_array_elements(e->'scenarioRefs') ref))) END scenario_mask
            FROM eligible),
          cells AS (
            SELECT source_id::text,business_entry_id::text,p.slot,scenario_mask required,NULL::int4multirange covered
              FROM contexts JOIN products p ON product_mask @> p.slot WHERE e->>'familySourceId' IS NULL
            UNION ALL
            SELECT e->>'familySourceId',e->>'familyBusinessEntryId',p.slot,NULL::int4multirange,scenario_mask
              FROM contexts JOIN products p ON product_mask @> p.slot WHERE e->>'familySourceId' IS NOT NULL),
          coverage AS (SELECT source_id,business_entry_id,slot,range_agg(required) required,range_agg(covered) covered
            FROM cells GROUP BY 1,2,3),
          choices AS (SELECT source_id,business_entry_id,bool_and(coalesce(covered @> required,false)) hide
            FROM coverage WHERE required IS NOT NULL GROUP BY 1,2),
          -- Materialize once: a nested-loop plan must not recompute this aggregate per entry.
          hidden AS MATERIALIZED (SELECT coalesce(jsonb_object_agg(jsonb_build_array(source_id,business_entry_id)::text,true)
            FILTER(WHERE hide),'{}'::jsonb) keys FROM choices)
          -- Grouping tagged requirements and coverage avoids a quadratic CTE
          -- join when PG estimates JSON expansion as one row. The final lookup
          -- contains only hidden keys, never another catalog or persisted state.
          SELECT eligible.* FROM eligible CROSS JOIN hidden
          WHERE NOT hidden.keys ? jsonb_build_array(source_id,business_entry_id)::text
            AND (source_id COLLATE "C",business_entry_id COLLATE "C")>($6::text COLLATE "C",$7::text COLLATE "C")
          ORDER BY source_id COLLATE "C",business_entry_id COLLATE "C" LIMIT $8`,
        [lease.release_id,scopes.map(s=>s.source_id),lease.issued_at,ctx.productIds,ctx.scenarioIds,...after,req.limit+1]);
        const rows: typeof result.rows=[];
        let vocabularyKeys=new Set<string>();
        for (const row of result.rows.slice(0,req.limit)) {
          const combined=new Set([...vocabularyKeys,...snapshotVocabularyKeys(row.e)]);
          if (combined.size>SNAPSHOT_VOCABULARY_LIMIT) {
            // An older unsupported single row is a visible limit failure, never
            // silently truncated or skipped. New candidates cannot reach here.
            if (!rows.length) throw new IntakeRejection('FILE_LIMIT','VALIDATION');
            break;
          }
          rows.push(row);vocabularyKeys=combined;
        }
        const faq=rows.map(({source_id,e})=>({ sourceId:source_id,entry:parseContractSchema('IntakePublishedEntry',{
          businessEntryId:e.businessEntryId,scriptVersion:e.scriptVersion,operation:e.operation,title:e.title,answerText:e.answerText,
          questions:e.questions.filter(q=>q.active),productRefs:e.productRefs,scenarioRefs:e.scenarioRefs,
          effectiveFrom:e.effectiveFrom,effectiveTo:e.effectiveTo,applicabilityNote:e.applicabilityNote,
          familySourceId:e.familySourceId,familyBusinessEntryId:e.familyBusinessEntryId,brandNonOverridable:e.brandNonOverridable,
          category:e.category,riskNote:e.riskNote,
        }) }));
        // Only referenced display versions travel with this page. A later rename
        // must not rewrite the meaning/label of an immutable release.
        const refs=faq.flatMap(f=>[...f.entry.productRefs,...f.entry.scenarioRefs]);
        const vocabulary=await client.query<{ value: C['IntakeVocabulary'] }>(`SELECT DISTINCT jsonb_build_object('id',v.vocabulary_id,
          'kind',v.kind,'displayVersion',d.display_version,'displayName',d.display_name,'meaningDigest',v.meaning_digest,'active',v.active,
          'scope',jsonb_build_object('tenantId',s.tenant_id,'appId',s.app_id,'brandId',s.brand_id,'shopId',s.shop_id,'domain',s.domain,'sourceId',NULL)) AS value
          FROM jsonb_to_recordset($1::jsonb) ref(id text,"displayVersion" bigint)
          JOIN content_intake.vocabulary v ON v.vocabulary_id=ref.id
          JOIN content_intake.vocabulary_displays d ON d.vocabulary_id=ref.id AND d.display_version=ref."displayVersion"
          JOIN content_intake.scopes s USING(scope_id) ORDER BY value`,[JSON.stringify(refs)]);
        const expected=new Set(refs.map(r=>`${r.id}:${r.displayVersion}`));
        if (vocabulary.rows.length!==expected.size || vocabulary.rows.some(v=>!v.value.active)) throw new IntakeRejection('SOURCE_MISMATCH','FORBIDDEN');
        const last=rows.at(-1);
        // Cursor is only a bounded keyset position, not authority. Rechecked
        // entitlement/scopes/selection always determine the accessible rows.
        return { releaseId:lease.release_id,entitlementId:req.entitlementId,contextGeneration:ctx.contextGeneration,faq,
          // The consumed IntakeSnapshot contract keeps media, sopNodes and sopEdges at maxItems 0.
          // Related images are read through preview(), which returns bytes for this release only.
          sopNodes:[],sopEdges:[],media:[],vocabulary:vocabulary.rows.map(v=>v.value),
          nextCursor:result.rows.length>rows.length && last ? Buffer.from(JSON.stringify([hash,last.source_id,last.business_entry_id])).toString('base64url') : null };
      },v=>parseContractSchema('IntakeSnapshot',v));
    },
    async preview(actor: AuthenticatedUser, raw: unknown) {
      const selected = await run(actor,'preview',null,null,
        (client,who) => selectPreview(client,who,actor,raw), value => value as Awaited<ReturnType<typeof selectPreview>>);
      if (!selected.ok) return selected;
      if (selected.value.kind === 'list') return { ok: true as const, value: selected.value.value };
      const original = selected.value;
      // No database transaction or global content lock is held during file I/O.
      // Keep errors for the final transaction owner to normalize consistently.
      let read: { ok: true; bytes: Buffer } | { ok: false; error: unknown };
      try { read = { ok: true, bytes: await previewReader.read(original.item) }; }
      catch (error) { read = { ok: false, error }; }
      return run(actor,'preview',null,null,async (client,who) => {
        if (await clock(client) >= original.validUntil) throw new IntakeRejection('PERMISSION_CHANGED','FORBIDDEN');
        client.validUntil(original.validUntil);
        const current = await selectPreview(client,who,actor,raw);
        if (current.kind !== 'item' || current.item.objectId !== original.item.objectId
          || current.item.sourceId !== original.item.sourceId || current.item.sha256 !== original.item.sha256
          || current.item.mime !== original.item.mime || current.item.sizeBytes !== original.item.sizeBytes) {
          throw new IntakeRejection('MATERIAL_CHANGED');
        }
        if (!read.ok) throw read.error;
        const { bytes } = read, { item } = current;
        if (bytes.length !== item.sizeBytes || bytes.length > 5 * 1024 * 1024 || digest(bytes) !== item.sha256) {
          throw new IntakeRejection('FILE_INVALID','VALIDATION');
        }
        return { mime: item.mime, sha256: item.sha256, bytesBase64: bytes.toString('base64') };
      }, decodePreview);
    },
  };
}
