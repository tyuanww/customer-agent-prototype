import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ContractValidationError, parseContractSchema } from '@customer-agent/contracts';
import type { AuthenticatedUser } from '../../src/auth-service.js';
import { canonical, digest } from '../../src/content-intake/material.js';
import { authorize, source } from '../../src/content-intake/authority.js';
import {
  clock, IntakeRejection, principal, requireFresh,
  type IntakePool, type IntakeResult, type IntakeTransaction, type Principal,
} from '../../src/content-intake/transaction.js';
import type { CanonicalJsonValue } from '../../src/idempotency.js';
import { authenticatedProductSession } from '../../src/product-auth-service.js';

/** Offline privilege probes only. Excluded from API dist and HTTP registration.
 * They are not the actual service, snapshot pager, or copy consumer. Identity
 * comes only from the authenticated private session. No receipts are written.
 * The qualification SQL copy is needed only to exercise lease/context triggers
 * under these candidate ACLs while the actual service's session lock remains
 * incompatible. Remove it when a governed lock/ACL intake and purpose pool routing
 * let actual service qualification, non-empty snapshot/copy and invalidation tests
 * replace the probe. Changing the lock alone does not prove those consumers.
 */

type SessionLock = { hash: string; validUntil: number };
type ScopeRow = {
  source_id: string; scope: { tenantId: string; appId: string; brandId: string; shopId: string | null; domain: string; sourceId: string };
  generation: string; mode_version: string; mode: string; until: Date | null;
};
type UsageRequest = { shopId: string; contextGeneration: number; productIds: string[]; scenarioIds: string[]; releaseId: string | null };

const entries = `WITH materials AS MATERIALIZED (
  SELECT c.source_id,c.candidate_id,c.version,c.material FROM content_intake.candidate_versions c
  WHERE c.source_id=ANY($2::text[]) AND EXISTS (SELECT 1 FROM content_intake.release_lineage l
    WHERE l.release_id=$1 AND l.candidate_id=c.candidate_id AND l.candidate_version=c.version)),
  expanded AS MATERIALIZED (SELECT c.source_id,c.candidate_id,c.version,e FROM materials c
    CROSS JOIN LATERAL jsonb_array_elements(c.material->'entries') e)
  SELECT l.source_id,l.business_entry_id,e FROM expanded c JOIN content_intake.release_lineage l
    ON l.release_id=$1 AND l.source_id=c.source_id AND l.candidate_id=c.candidate_id
    AND l.candidate_version=c.version AND l.business_entry_id=c.e->>'businessEntryId'`;

function denied(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ZA003';
}

async function lockNarrow(client: IntakeTransaction, actor: AuthenticatedUser, hash: string): Promise<SessionLock> {
  try {
    const result = await client.query<{ expires_at: Date }>(
      'SELECT intake_runtime_probe.lock_product_session($1,$2) AS expires_at', [hash, actor.user_id]);
    const expires = result.rows[0]?.expires_at;
    if (!expires) throw new IntakeRejection('SCOPE_DENIED', 'UNAUTHORIZED');
    const validUntil = expires.getTime();
    client.validUntil(validUntil);
    return { hash, validUntil };
  } catch (error) {
    if (error instanceof IntakeRejection) throw error;
    if (denied(error)) throw new IntakeRejection('SCOPE_DENIED', 'UNAUTHORIZED');
    throw error;
  }
}

async function scopesFor(client: IntakeTransaction, actor: Principal, shop: string): Promise<ScopeRow[]> {
  const { rows } = await client.query<ScopeRow>(`SELECT src.source_id,src.revocation_generation AS generation,src.mode_version,src.mode,
    jsonb_build_object('tenantId',s.tenant_id,'appId',s.app_id,'brandId',s.brand_id,'shopId',s.shop_id,'domain',s.domain,'sourceId',src.source_id) AS scope,
    content_intake.authorization_deadline($1,'query',s.scope_id,src.source_id,clock_timestamp()) AS until
    FROM content_intake.sources src JOIN content_intake.scopes s USING(scope_id)
    WHERE s.tenant_id=$2 AND s.app_id=$3 AND (s.shop_id=$4 OR s.shop_id IS NULL)
    ORDER BY src.source_id COLLATE "C"`, [actor.id, actor.tenantId, actor.appId, shop]);
  const authorized = rows.filter(row => row.until && row.mode === 'v2-preview');
  const brands = new Set(authorized.filter(row => row.scope.shopId === shop).map(row => row.scope.brandId));
  if (!brands.size) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  const selected = authorized.filter(row => brands.has(row.scope.brandId));
  for (const row of selected) client.validUntil(row.until!.getTime());
  return selected;
}

async function validateSelection(client: IntakeTransaction, shopId: string, productIds: readonly string[], scenarioIds: readonly string[], scopes: readonly ScopeRow[]): Promise<void> {
  const selected = [...productIds.map(id => ({ id, kind: 'product' })), ...scenarioIds.map(id => ({ id, kind: 'scenario' }))];
  const result = await client.query<{ count: string }>(`SELECT count(*) FROM jsonb_to_recordset($1::jsonb) selected(id text,kind text)
    JOIN content_intake.vocabulary v ON v.vocabulary_id=selected.id AND v.kind=selected.kind AND v.active
    JOIN content_intake.scopes s USING(scope_id)
    WHERE (s.shop_id=$2 OR s.shop_id IS NULL) AND EXISTS (SELECT 1 FROM jsonb_to_recordset($3::jsonb)
      allowed("tenantId" text,"appId" text,"brandId" text,domain text)
      WHERE s.tenant_id=allowed."tenantId" AND s.app_id=allowed."appId" AND s.brand_id=allowed."brandId" AND s.domain=allowed.domain)`,
  [JSON.stringify(selected), shopId, JSON.stringify(scopes.map(row => row.scope))]);
  if (Number(result.rows[0]?.count) !== selected.length) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
}

async function releaseDeadline(client: IntakeTransaction, releaseId: string, tenant: string): Promise<number> {
  const release = await client.query<{ ready: boolean; revoked: boolean }>(`SELECT
    (gate.source_gate_ready AND public.owner_acceptance_release_content_ready(c.release_id)) AS ready,
    EXISTS (SELECT 1 FROM content_intake.release_revocations r WHERE r.release_id=c.release_id) AS revoked
    FROM content_intake.release_catalogs c JOIN public.content_releases cr USING(release_id)
    JOIN public.v_release_source_gate gate USING(release_id) WHERE c.release_id=$1 AND cr.tenant_id=$2`, [releaseId, tenant]);
  if (!release.rows[0]) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  if (release.rows[0].revoked) throw new IntakeRejection('APPROVAL_REVOKED', 'FORBIDDEN');
  if (!release.rows[0].ready) throw new IntakeRejection('SOURCE_MISMATCH', 'FORBIDDEN');
  const provenance = await client.query(`SELECT 1 FROM content_intake.release_lineage l
    JOIN content_intake.candidate_versions c ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version
    JOIN content_intake.sources s ON s.source_id=l.source_id
    LEFT JOIN content_intake.source_confirmations sc ON sc.candidate_id=c.candidate_id AND sc.candidate_version=c.version
      AND sc.evidence_version=c.source_evidence_version
    WHERE l.release_id=$1 AND (s.mode<>'v2-preview' OR s.current_mapping_version<>c.source_version OR c.state<>'published'
      OR sc.candidate_digest IS DISTINCT FROM c.digest OR sc.object_sha256 IS DISTINCT FROM c.file_sha256) LIMIT 1`, [releaseId]);
  if (provenance.rowCount) throw new IntakeRejection('SOURCE_MISMATCH', 'FORBIDDEN');
  try {
    await client.query('SELECT content_intake.assert_family_catalog($1::text)', [releaseId]);
  } catch (error) {
    if (denied(error) && error instanceof Error && error.message === 'SOURCE_MISMATCH') throw new IntakeRejection('SOURCE_MISMATCH', 'FORBIDDEN');
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
    LEFT JOIN content_intake.approval_facts f ON f.review_request_id=cur.review_request_id AND f.facts_version=cur.facts_version`,
  [releaseId]);
  if (facts.rows[0]?.invalid) throw new IntakeRejection('APPROVAL_UNAVAILABLE', 'FORBIDDEN');
  const owners = await client.query<{ until: Date | null }>(`SELECT min(public.owner_acceptance_instant(a.record->'expires_at')) AS until
    FROM public.release_items i JOIN public.content_releases r USING(release_id)
    JOIN public.owner_acceptance_records a ON a.tenant_id=r.tenant_id AND a.record_sha256=i.owner_acceptance_record_sha256
    WHERE i.release_id=$1 AND i.review_mode='owner_acceptance'`, [releaseId]);
  return Math.min(facts.rows[0]?.until?.getTime() ?? Infinity, owners.rows[0]?.until?.getTime() ?? Infinity);
}

function binding(sessionHash: string, request: UsageRequest, scopes: readonly ScopeRow[]): string {
  const body: CanonicalJsonValue = {
    sessionTokenHash: sessionHash, shopId: request.shopId, contextGeneration: request.contextGeneration,
    productIds: request.productIds, scenarioIds: request.scenarioIds,
    sources: scopes.map(row => [row.source_id, row.generation, row.mode_version]).sort((left, right) => left[0]! < right[0]! ? -1 : 1),
  };
  return `intake:${digest(canonical(body))}`;
}

/** Same terminal writes as the unexported worker finish. No grant, publish, or identity write. */
export async function probeParseFailureWrites(pool: IntakePool, jobId: string, actorUserId: string,
  stored: { objectId: string; sha256: string; sizeBytes: number }): Promise<{ finished: true }> {
  const client = await pool.connect();
  let broken = false;
  let committing = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s'");
    await client.query('SELECT backend_review.lock_content()');
    const inserted = await client.query(`INSERT INTO content_intake.objects(object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
      SELECT $2,j.source_id,j.actor_id,p.tenant_id,p.app_id,$3,$4,$5,'application/json','report',clock_timestamp()
      FROM content_intake.parse_jobs j JOIN content_intake.principals p ON p.principal_id=j.actor_id
      WHERE j.job_id=$1 AND j.state IN ('reading','parsing') AND p.user_id=$6`,
    [jobId, stored.objectId, `intake/${stored.objectId}`, stored.sha256, stored.sizeBytes, actorUserId]);
    if (inserted.rowCount !== 1) throw new IntakeRejection('COMMIT_UNKNOWN');
    const adopted = await client.query(`UPDATE content_intake.object_reservations r
      SET state='adopted',updated_at=clock_timestamp() FROM content_intake.objects o
      WHERE r.object_id=$1 AND o.object_id=r.object_id AND r.state='persisted'
      AND r.sha256=$2 AND r.actual_bytes=$3 AND o.sha256=r.sha256 AND o.bytes=r.actual_bytes
      AND o.source_id IS NOT DISTINCT FROM r.source_id AND o.actor_id=r.actor_id
      AND o.tenant_id=r.tenant_id AND o.app_id=r.app_id AND o.purpose=r.purpose`,
    [stored.objectId, stored.sha256, stored.sizeBytes]);
    if (adopted.rowCount !== 1) throw new IntakeRejection('COMMIT_UNKNOWN');
    await client.query(`UPDATE content_intake.parse_jobs SET state='failed',finished_at=clock_timestamp(),report_object_id=$2
      WHERE job_id=$1 AND state IN ('reading','parsing') AND EXISTS
        (SELECT 1 FROM content_intake.principals WHERE principal_id=actor_id AND user_id=$3)`,
    [jobId, stored.objectId, actorUserId]);
    committing = true;
    await client.query('COMMIT');
    return { finished: true };
  } catch (error) {
    broken = true;
    if (!committing) { try { await client.query('ROLLBACK'); } catch { /* Keep the connection unusable. */ } }
    throw error;
  } finally { client.release(broken); }
}

export function createPurposePrivilegeProbe(pool: IntakePool, report: (diagnosticId: string, error: unknown) => void = () => undefined) {
  async function run<T>(actor: AuthenticatedUser,
    work: (client: IntakeTransaction, who: Principal, session: SessionLock) => Promise<T>): Promise<IntakeResult<T>> {
    const hash = authenticatedProductSession(actor);
    const diagnosticId = `intake_${randomUUID()}`;
    if (!hash) return { ok: false, code: 'UNAUTHORIZED', reason: 'SCOPE_DENIED', commit: 'rolled_back', diagnosticId };
    let client: PoolClient | undefined;
    let committing = false;
    let broken = false;
    try {
      client = await pool.connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='5s'");
      await client.query('SELECT backend_review.lock_content()');
      const deadline = await clock(client) + 5_000;
      let authorityDeadline = Infinity;
      const transaction: IntakeTransaction = {
        query: client.query.bind(client),
        beforeCommit() { throw new Error('HISTORICAL_PROBE_FINALIZER_UNSUPPORTED'); },
        validUntil(until) {
          if (!Number.isFinite(until)) throw new IntakeRejection('PERMISSION_CHANGED');
          authorityDeadline = Math.min(authorityDeadline, until);
        },
      };
      const session = await lockNarrow(transaction, actor, hash);
      const who = await principal(client, { userId: actor.user_id });
      requireFresh(who, await clock(client));
      const value = await work(transaction, who, session);
      requireFresh(await principal(client, { id: who.id }), await clock(client));
      const now = await clock(client);
      if (now >= authorityDeadline) throw new IntakeRejection('PERMISSION_CHANGED', 'FORBIDDEN');
      if (now >= deadline) throw new IntakeRejection('PERMISSION_CHANGED', 'OVERLOADED');
      committing = true;
      await client.query('COMMIT');
      return { ok: true, value };
    } catch (error) {
      if (client && !committing) { try { await client.query('ROLLBACK'); } catch { broken = true; } }
      else if (client) broken = true;
      try { report(diagnosticId, error); } catch { /* Diagnostics must not change transaction certainty. */ }
      if (committing) return { ok: false, code: 'OVERLOADED', reason: 'COMMIT_UNKNOWN', commit: 'unknown', diagnosticId };
      const rejection = error instanceof IntakeRejection ? error
        : error instanceof ContractValidationError ? new IntakeRejection('FILE_INVALID', 'VALIDATION')
          : new IntakeRejection('COMMIT_UNKNOWN', 'INTERNAL_ERROR');
      return { ok: false, code: rejection.code, reason: rejection.reason, commit: broken ? 'unknown' : 'rolled_back', diagnosticId };
    } finally { client?.release(broken); }
  }

  return {
    run,
    probeQualificationWrites(actor: AuthenticatedUser, raw: unknown) {
      return run(actor, async (client, who, session) => {
        const request = parseContractSchema('IntakeEntitlementRequest', raw);
        const usage: UsageRequest = {
          shopId: request.shopId, contextGeneration: request.contextGeneration,
          productIds: [...request.productIds].sort(), scenarioIds: [...request.scenarioIds].sort(), releaseId: request.releaseId,
        };
        await client.query("SELECT pg_advisory_xact_lock(hashtext('cs_ai_content_publish'))");
        const scopes = await scopesFor(client, who, usage.shopId);
        await validateSelection(client, usage.shopId, usage.productIds, usage.scenarioIds, scopes);
        const current = await client.query<{ current_release_id: string }>('SELECT current_release_id FROM public.content_current WHERE id=1');
        const release = current.rows[0]?.current_release_id;
        if (!release) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
        if (usage.releaseId !== null && usage.releaseId !== release) throw new IntakeRejection('BASE_CHANGED');
        const issued = await clock(client);
        let until = Math.min(who.validUntil, session.validUntil, issued + 300_000, ...scopes.map(row => row.until!.getTime()),
          await releaseDeadline(client, release, who.tenantId));
        const content = await client.query<{ until: Date | null }>(`WITH entries AS (${entries}) SELECT
          min(CASE WHEN (e->>'effectiveFrom')::timestamptz>$3 THEN (e->>'effectiveFrom')::timestamptz
            ELSE (e->>'effectiveTo')::timestamptz END) FILTER (WHERE e->>'operation'='upsert'
            AND (cardinality($4::text[])=0 OR EXISTS (SELECT 1 FROM jsonb_array_elements(e->'productRefs') ref WHERE ref->>'id'=ANY($4::text[])))
            AND (cardinality($5::text[])=0 OR EXISTS (SELECT 1 FROM jsonb_array_elements(e->'scenarioRefs') ref WHERE ref->>'id'=ANY($5::text[])))
            AND ((e->>'effectiveTo') IS NULL OR (e->>'effectiveTo')::timestamptz>$3)) AS until FROM entries`,
        [release, scopes.map(row => row.source_id), new Date(issued), usage.productIds, usage.scenarioIds]);
        until = Math.min(until, content.rows[0]?.until?.getTime() ?? Infinity);
        const lease = await client.query<{ lease_hash: string; lease_expires_at: Date; release_id: string }>(`SELECT
          encode(public.digest(convert_to(offline_lease_token,'UTF8'),'sha256'),'hex') AS lease_hash,
          lease_expires_at, release_id FROM public.issue_snapshot_offline_lease($1,$2,300)`,
        [binding(session.hash, usage, scopes), who.userId]);
        const leased = lease.rows[0];
        if (!leased || leased.release_id !== release) throw new IntakeRejection('BASE_CHANGED');
        until = Math.min(until, leased.lease_expires_at.getTime());
        if (until <= await clock(client)) throw new IntakeRejection('LEASE_EXPIRED', 'FORBIDDEN');
        client.validUntil(until);
        const hash = digest(`ite_${randomBytes(32).toString('hex')}`);
        const inserted = await client.query(`INSERT INTO content_intake.entitlements(entitlement_hash,principal_id,user_id,lease_token_hash,release_id,
          shop_id,context_generation,principal_generation,release_generation,issued_at,valid_until)
          SELECT $1,$2,$3,$4,$5,$6,$7,$8,0,issued_at,$9 FROM public.snapshot_offline_leases WHERE lease_token_hash=$4`,
        [hash, who.id, who.userId, leased.lease_hash, release, usage.shopId, usage.contextGeneration, who.generation, new Date(until)]);
        if (inserted.rowCount !== 1) throw new IntakeRejection('COMMIT_UNKNOWN');
        await client.query('INSERT INTO content_intake.entitlement_scopes SELECT $1,unnest($2::text[])', [hash, scopes.map(row => row.source_id)]);
        await client.query(`INSERT INTO content_intake.entitlement_contexts(entitlement_hash,session_token_hash,product_ids,scenario_ids)
          VALUES ($1,$2,$3,$4)`, [hash, session.hash, usage.productIds, usage.scenarioIds]);
        return { entitlementHash: hash, releaseId: release, shopId: usage.shopId, validUntil: new Date(until).toISOString() };
      });
    },
    /** Empty-catalog keyset only. The formal snapshot page stays inside usage.ts. */
    probeEmptyCatalogReads(actor: AuthenticatedUser, shopId: string, releaseId: string) {
      return run(actor, async (client, who, _session) => {
        await scopesFor(client, who, shopId);
        const page = await client.query<{ source_id: string; business_entry_id: string }>(`SELECT source_id,business_entry_id
          FROM content_intake.release_lineage WHERE release_id=$1 AND (source_id,business_entry_id) > ($2::text,$3::text)
          ORDER BY source_id COLLATE "C", business_entry_id COLLATE "C" LIMIT 1`, [releaseId, '', '']);
        const facts = await client.query<{ invalid: boolean }>(`SELECT coalesce(bool_or(f.state IS DISTINCT FROM 'approved'),false) AS invalid
          FROM content_intake.release_lineage l
          LEFT JOIN content_intake.approval_facts f ON f.review_request_id=l.review_request_id
          WHERE l.release_id=$1 AND l.publication_policy='approval-v1'`, [releaseId]);
        return { rows: page.rowCount ?? page.rows.length, approvalInvalid: facts.rows[0]?.invalid === true };
      });
    },
    probeQueryAuthorization(actor: AuthenticatedUser, sourceId: string) {
      return run(actor, async (client, who, _session) => {
        const src = await source(client, sourceId);
        const until = await authorize(client, who, 'query', src);
        return { sourceId, action: 'query' as const, until: new Date(until).toISOString() };
      });
    },
  };
}
