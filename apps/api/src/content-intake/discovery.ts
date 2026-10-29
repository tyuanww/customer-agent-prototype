import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { AuthenticatedUser } from '../auth-service.js';
import { allocationKinds, authorize, mayManageGrant, readGrant, recipientRoleAllows, samePerson, source } from './authority.js';
import { readCandidate } from './candidate.js';
import { canonical, digest } from './material.js';
import { clock, createIntakeTransactions, IntakeRejection, lockProductSession, registeredPrincipalPage, requireFresh, type IntakeTransaction, type Principal } from './transaction.js';

type C = components['schemas'];
type Capability = C['IntakeAuthorization']['capabilities'][number];
type Kind = 'authorization' | 'sources';
type Page = { limit: number; cursor?: string };
/** Already-authorized identity projection, synchronous and without remote I/O.
 * The synthetic host supplies explicitly registered labels. Missing labels fail
 * the whole page; never derive names from user/provider IDs or create a new store. */
export type IntakePrincipalLabels = (identity: Readonly<{ principalId: string; tenantId: string; appId: string }>) => string | null;
// Discovery is a bounded menu, never a grant or a cached authorization decision.
const MAX_SOURCES = 5_000;
const RETIRED_HANGZHOU_FACT_VERSIONS = new Map([['hz-allocator', 8], ['hz-reviewer', 5]]);

function isRetiredDirectoryIdentity(principal: Principal & { hasNewIdentityActivity: boolean }, actorId: string, label: string | null | undefined): boolean {
  // Old facts do not imply retirement once a person, login, or name is attached.
  return principal.id !== actorId && principal.identityScope === 'confirmed-hangzhou' && !label && !principal.hasNewIdentityActivity
    && RETIRED_HANGZHOU_FACT_VERSIONS.get(principal.id) === principal.factsVersion;
}
function page(raw: unknown): Page {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => k !== 'cursor' && k !== 'limit')) {
    throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  }
  const r = raw as Record<string, unknown>;
  const limit = 'limit' in r ? r.limit : 50;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100
    || ('cursor' in r && (typeof r.cursor !== 'string' || !r.cursor.length || r.cursor.length > 512))) {
    throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
  }
  return { limit, ...(typeof r.cursor === 'string' ? { cursor: r.cursor } : {}) };
}

async function discover(client: IntakeTransaction, who: Principal, sessionUntil: number) {
  const allocating = allocationKinds(who, 'business'), delegating = allocationKinds(who, 'delegation');
  const result = await client.query<{ source: C['IntakeSource']; rights: { action: C['IntakeAction']; kind: string; until: string }[] }>(`
    WITH stamp AS MATERIALIZED (
      SELECT clock_timestamp() AS at
    ), business_actions AS MATERIALIZED (
      SELECT DISTINCT g.action
      FROM content_intake.grants g CROSS JOIN stamp
      WHERE g.recipient_id=$1 AND g.kind='business' AND g.revoked_at IS NULL
        AND g.starts_at<=stamp.at AND stamp.at<g.expires_at
    ), business_sources AS MATERIALIZED (
      SELECT actions.action, allowed.scope_id, allowed.source_id, max(allowed.valid_until) AS until
      FROM business_actions actions CROSS JOIN stamp
      CROSS JOIN LATERAL content_intake.authorization_sources($1,actions.action,stamp.at) allowed
      GROUP BY actions.action,allowed.scope_id,allowed.source_id
    ), effective AS (
      SELECT allowed.scope_id,allowed.source_id,allowed.action,'business'::text AS kind,allowed.until
      FROM business_sources allowed
      UNION ALL
      SELECT g.scope_id,src.source_id,g.action,g.kind,max(g.expires_at) AS until
      FROM content_intake.grants g CROSS JOIN stamp
      JOIN content_intake.sources src ON src.scope_id=g.scope_id
        AND (g.source_id IS NULL OR g.source_id=src.source_id)
      WHERE g.recipient_id=$1 AND g.revoked_at IS NULL
        AND g.starts_at<=stamp.at AND stamp.at<g.expires_at
        AND g.kind=ANY($4::text[]) AND g.steward_id IS NOT NULL
      GROUP BY g.scope_id,src.source_id,g.action,g.kind
    ), rights AS (
      SELECT scope_id,source_id,
        jsonb_agg(jsonb_build_object('action',action,'kind',kind,'until',until) ORDER BY kind,action) AS items
      FROM effective WHERE until IS NOT NULL GROUP BY scope_id,source_id
    )
    SELECT jsonb_build_object('scope',jsonb_build_object('tenantId',s.tenant_id,'appId',s.app_id,
      'brandId',s.brand_id,'shopId',s.shop_id,'domain',s.domain,'sourceId',src.source_id),
      'version',src.current_mapping_version,'templateVersion',m.template_version,'ruleVersion',m.rule_version,
      'mappingVersion',m.mapping_version,'structureDigest',m.structure_digest,
      'contentIntakeMode',src.mode,'modeVersion',src.mode_version) AS source, rights.items AS rights
    FROM content_intake.sources src JOIN content_intake.scopes s USING(scope_id)
    JOIN content_intake.source_mappings m ON m.source_id=src.source_id AND m.version=src.current_mapping_version
    JOIN rights ON rights.scope_id=s.scope_id AND rights.source_id=src.source_id
    WHERE s.tenant_id=$2 AND s.app_id=$3
    ORDER BY src.source_id COLLATE "C" LIMIT $5`, [who.id, who.tenantId, who.appId, allocating, MAX_SOURCES + 1]);
  if (result.rows.length > MAX_SOURCES) throw new IntakeRejection('FILE_LIMIT', 'OVERLOADED');
  const policy = await client.query<{ version: string }>('SELECT version FROM content_intake.policy_versions WHERE tenant_id=$1 AND app_id=$2', [who.tenantId, who.appId]);
  if (!policy.rows[0]) throw new IntakeRejection('ORG_FACTS_UNAVAILABLE', 'FORBIDDEN');
  const baseDeadline = Math.min(who.validUntil, sessionUntil);
  let validUntil = baseDeadline;
  const sources: C['IntakeSource'][] = [], capabilities: Capability[] = [];
  for (const row of result.rows) {
    const src = parseContractSchema('IntakeSource', row.source);
    const actions = new Set<C['IntakeAction']>(), mayAllocate = new Set<C['IntakeAction']>(), mayDelegate = new Set<C['IntakeAction']>();
    let until = baseDeadline;
    for (const right of row.rights) {
      const action = parseContractSchema('IntakeAction', right.action);
      if (right.kind === 'business') actions.add(action);
      else {
        mayAllocate.add(action);
        if (delegating.includes(right.kind as 'allocation' | 'delegation')) mayDelegate.add(action);
      }
      until = Math.min(until, Date.parse(right.until));
    }
    sources.push(src);
    capabilities.push({ scope: src.scope, actions: [...actions].sort(), mayAllocate: [...mayAllocate].sort(),
      mayDelegate: [...mayDelegate].sort(), validUntil: new Date(until).toISOString() });
    validUntil = Math.min(validUntil, until);
  }
  client.validUntil(validUntil);
  const meta = { factsVersion: who.factsVersion, revocationGeneration: who.generation,
    policyVersion: Number(policy.rows[0].version), validUntil: new Date(validUntil).toISOString() };
  return { meta, sources, capabilities, revision: digest(canonical({ meta, sources, capabilities })) };
}

/** Current, session-bound discovery using the same business predicate and
 * allocation ceilings as commands. Every page rereads the complete bounded
 * projection under the content lock. Changed rights/mappings/modes invalidate
 * its signed cursor; callers restart at page one instead of merging revisions.
 * The process-local signing key deliberately expires cursors on service restart.
 */
export function createIntakeDiscovery(run: ReturnType<typeof createIntakeTransactions>, labels?: IntakePrincipalLabels) {
  const secret = randomBytes(32);
  const signature = (body: string, sessionHash: string) => createHmac('sha256', secret).update(`${sessionHash}\0${body}`).digest();
  async function read<S extends 'IntakeAuthorization' | 'IntakeSourceList'>(actor: AuthenticatedUser, raw: unknown, kind: Kind, schema: S) {
    return run(actor, `discover-${kind}`, null, null, async (client, who) => {
      const request = page(raw), session = await lockProductSession(client, actor);
      const state = await discover(client, who, session.validUntil);
      let after = '';
      if (request.cursor) {
        const parts = request.cursor.split('.');
        if (parts.length !== 2 || !parts.every(s => /^[A-Za-z0-9_-]+$/.test(s))) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
        const body = parts[0]!, mac = Buffer.from(parts[1]!, 'base64url'), expected = signature(body, session.hash);
        if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) throw new IntakeRejection('PERMISSION_CHANGED');
        let tuple: unknown;
        try { tuple = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { throw new IntakeRejection('FILE_INVALID', 'VALIDATION'); }
        if (!Array.isArray(tuple) || tuple.length !== 4 || tuple[0] !== kind || tuple[1] !== state.revision
          || typeof tuple[2] !== 'string' || typeof tuple[3] !== 'number' || await clock(client) >= tuple[3]) {
          throw new IntakeRejection('PERMISSION_CHANGED');
        }
        after = tuple[2];
      }
      const start = after ? state.sources.findIndex(s => s.scope.sourceId === after) + 1 : 0;
      if (after && start === 0) throw new IntakeRejection('PERMISSION_CHANGED');
      const end = Math.min(start + request.limit, state.sources.length);
      let nextCursor: string | null = null;
      if (end < state.sources.length) {
        const body = Buffer.from(JSON.stringify([kind, state.revision, state.sources[end-1]!.scope.sourceId, Date.parse(state.meta.validUntil)])).toString('base64url');
        nextCursor = `${body}.${signature(body, session.hash).toString('base64url')}`;
      }
      return parseContractSchema(schema, kind === 'authorization' ? { ...state.meta, capabilities: state.capabilities.slice(start, end), nextCursor }
        : { items: state.sources.slice(start, end), nextCursor });
    }, value => parseContractSchema(schema, value));
  }
  return {
    /** Keyset scan is bounded before authority filtering. Empty pages may have a
     * next cursor. This is a current menu, not a historical identity directory. */
    grants(actor: AuthenticatedUser, raw: unknown) {
      return run(actor, 'discover-grants', null, null, async (client, who) => {
        const request = page(raw), session = await lockProductSession(client, actor);
        const access = await discover(client, who, session.validUntil);
        if (!allocationKinds(who, 'business').length) return { items: [], nextCursor: null };
        const binding = digest(canonical([access.revision, who.id, request.limit, 'grants']));
        let after = '', until = Date.parse(access.meta.validUntil);
        if (request.cursor) {
          const parts = request.cursor.split('.'), body = parts[0] ?? '';
          const mac = Buffer.from(parts[1] ?? '', 'base64url'), expected = signature(body, session.hash);
          if (parts.length !== 2 || mac.length !== expected.length || !timingSafeEqual(mac, expected)) throw new IntakeRejection('PERMISSION_CHANGED');
          let tuple: unknown;
          try { tuple = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { throw new IntakeRejection('FILE_INVALID','VALIDATION'); }
          if (!Array.isArray(tuple) || tuple.length !== 3 || tuple[0] !== binding || typeof tuple[1] !== 'string'
            || typeof tuple[2] !== 'number' || !Number.isFinite(tuple[2]) || await clock(client) >= tuple[2]) throw new IntakeRejection('PERMISSION_CHANGED');
          after = parseContractSchema('IntakeId', tuple[1]); until = Math.min(until, tuple[2]);
        }
        client.validUntil(until);
        const rows = (await client.query<{ grant_id: string }>(`SELECT g.grant_id FROM content_intake.grants g JOIN content_intake.scopes s USING(scope_id)
          WHERE g.tenant_id=$1 AND g.app_id=$2 AND g.kind <> 'allocation' AND g.grant_id COLLATE "C">$3
          AND EXISTS (SELECT 1 FROM jsonb_array_elements($8::jsonb) c
            WHERE c->'scope'->>'brandId'=s.brand_id AND c->'scope'->>'shopId' IS NOT DISTINCT FROM s.shop_id
              AND c->'scope'->>'domain'=s.domain AND (g.source_id IS NULL OR c->'scope'->>'sourceId'=g.source_id)
              AND (CASE WHEN g.kind='business' THEN c->'mayAllocate' ELSE c->'mayDelegate' END) ? g.action)
          AND EXISTS (SELECT 1 FROM content_intake.grants p WHERE p.recipient_id=$5 AND p.scope_id=g.scope_id AND p.action=g.action
            AND (p.source_id IS NULL OR p.source_id IS NOT DISTINCT FROM g.source_id) AND p.revoked_at IS NULL
            AND p.steward_id IS NOT NULL AND p.starts_at<=clock_timestamp() AND p.expires_at>clock_timestamp()
            AND p.kind=ANY(CASE WHEN g.kind='business' THEN $6::text[] ELSE $7::text[] END))
          ORDER BY g.grant_id COLLATE "C" LIMIT $4`, [who.tenantId,who.appId,after,request.limit+1,who.id,
          allocationKinds(who,'business'),allocationKinds(who,'delegation'),JSON.stringify(access.capabilities)])).rows;
        const scanned = rows.slice(0,request.limit), items: C['IntakeGrant'][] = [];
        for (const row of scanned) {
          const grant = await readGrant(client,row.grant_id);
          if (await mayManageGrant(client,who,grant)) items.push(grant);
        }
        let nextCursor: string | null = null;
        if (rows.length > request.limit) {
          const body = Buffer.from(JSON.stringify([binding,scanned.at(-1)!.grant_id,until])).toString('base64url');
          nextCursor = `${body}.${signature(body,session.hash).toString('base64url')}`;
        }
        return { items, nextCursor };
      }, value => parseContractSchema('IntakeGrantList',value));
    },
    /** Read-only query menu. Names come from the latest registered display
     * version, never from answer text. Each page binds the complete bounded
     * vocabulary and current authority; a rename/revocation restarts paging. */
    vocabulary(actor: AuthenticatedUser, sourceId: unknown, raw: unknown) {
      return run(actor, 'discover-vocabulary', null, null, async (client, who) => {
        const id = parseContractSchema('IntakeId', sourceId), request = page(raw);
        const session = await lockProductSession(client, actor), src = await source(client, id);
        const grantUntil = await authorize(client, who, 'query', src);
        if (src.mode !== 'v2-preview') throw new IntakeRejection('MODE_CONFLICT');
        const until = Math.min(session.validUntil, who.validUntil, grantUntil);
        const rows = await client.query<{ value: C['IntakeVocabulary'] }>(`
          SELECT jsonb_build_object('id',v.vocabulary_id,'kind',v.kind,'active',v.active,
            'meaningDigest',v.meaning_digest,'displayVersion',d.display_version,'displayName',d.display_name,
            'scope',jsonb_build_object('tenantId',s.tenant_id,'appId',s.app_id,'brandId',s.brand_id,
              'shopId',s.shop_id,'domain',s.domain,'sourceId',NULL)) AS value
          FROM content_intake.vocabulary v JOIN content_intake.scopes s USING(scope_id)
          LEFT JOIN LATERAL (SELECT display_version,display_name FROM content_intake.vocabulary_displays
            WHERE vocabulary_id=v.vocabulary_id ORDER BY display_version DESC LIMIT 1) d ON true
          WHERE v.active AND s.tenant_id=$1 AND s.app_id=$2 AND s.brand_id=$3 AND s.domain=$4
            AND (s.shop_id IS NULL OR s.shop_id=$5)
          ORDER BY v.vocabulary_id COLLATE "C" LIMIT 5001`,
        [src.scope.tenantId,src.scope.appId,src.scope.brandId,src.scope.domain,src.scope.shopId]);
        if (rows.rows.length > 5000 || Buffer.byteLength(JSON.stringify(rows.rows)) > 4 * 1024 * 1024) {
          throw new IntakeRejection('FILE_LIMIT', 'OVERLOADED');
        }
        const items = rows.rows.map(row => parseContractSchema('IntakeVocabulary', row.value));
        const revision = digest(canonical([id,src,who.factsVersion,who.generation,until,request.limit,items]));
        let offset = 0;
        if (request.cursor) {
          const parts = request.cursor.split('.'), body = parts[0] ?? '';
          const mac = Buffer.from(parts[1] ?? '', 'base64url'), expected = signature(body, session.hash);
          if (parts.length !== 2 || mac.length !== expected.length || !timingSafeEqual(mac, expected)) {
            throw new IntakeRejection('PERMISSION_CHANGED');
          }
          let tuple: unknown;
          try { tuple = JSON.parse(Buffer.from(body, 'base64url').toString()); }
          catch { throw new IntakeRejection('FILE_INVALID', 'VALIDATION'); }
          if (!Array.isArray(tuple) || tuple.length !== 3 || tuple[0] !== 'vocabulary' || tuple[1] !== revision
            || !Number.isInteger(tuple[2]) || tuple[2] < 1 || tuple[2] >= items.length) {
            throw new IntakeRejection('PERMISSION_CHANGED');
          }
          offset = tuple[2];
        }
        client.validUntil(until);
        const end = Math.min(offset + request.limit, items.length);
        const body = Buffer.from(JSON.stringify(['vocabulary', revision, end])).toString('base64url');
        return { items: items.slice(offset, end), nextCursor: end < items.length ? `${body}.${signature(body, session.hash).toString('base64url')}` : null };
      }, value => parseContractSchema('IntakeVocabularyList', value));
    },
    /** An importer's current input hints, not a grant, lease or commit ticket.
     * The existing publication lock also fences a missing current row. Receive
     * reauthorizes and compares this base/source version in its own transaction. */
    managementContext(actor: AuthenticatedUser, sourceId: unknown) {
      return run(actor, 'management-context', null, null, async (client, who) => {
        const session = await lockProductSession(client, actor);
        const id = parseContractSchema('IntakeId', sourceId), src = await source(client, id);
        const importUntil = await authorize(client, who, 'import', src);
        const validUntil = Math.min(session.validUntil, who.validUntil, importUntil);
        client.validUntil(validUntil);
        await client.query("SELECT pg_advisory_xact_lock(hashtext('cs_ai_content_publish'))");
        const current = await client.query<{ current_release_id: string }>('SELECT current_release_id FROM public.content_current WHERE id=1');
        const result = parseContractSchema('IntakeManagementContext', { sourceId: id, sourceVersion: src.version,
          baseReleaseId: current.rows[0]?.current_release_id ?? null, principalId: who.id,
          factsVersion: who.factsVersion, validUntil: new Date(validUntil).toISOString() });
        if (Buffer.byteLength(JSON.stringify(result)) > 65_536) throw new IntakeRejection('FILE_LIMIT', 'OVERLOADED');
        return result;
      }, value => parseContractSchema('IntakeManagementContext', value));
    },
    /** Bounded registered-identity scan. Targets need no existing business grant;
     * contributors may be disabled, while grant recipients must be eligible now.
     * Filtered empty pages still advance. No snapshot, grant, lease or write. */
    principals(actor: AuthenticatedUser, raw: unknown) {
      return run(actor, 'discover-principals', null, null, async (client, who) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
        const { sourceId, purpose, ...paging } = raw as Record<string, unknown>;
        const id = parseContractSchema('IntakeId', sourceId), request = page(paging);
        if (purpose !== 'contributor' && purpose !== 'grant-recipient') throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
        const session = await lockProductSession(client, actor), access = await discover(client, who, session.validUntil);
        const capability = access.capabilities.find(c => c.scope.sourceId === id);
        if (!capability || (purpose === 'contributor' ? !capability.actions.includes('import') : !capability.mayAllocate.length)) {
          throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
        }
        const binding = digest(canonical([access.revision, who.id, who.tenantId, who.appId, id, purpose, request.limit]));
        let after = '', until = Date.parse(access.meta.validUntil);
        if (request.cursor) {
          const parts = request.cursor.split('.');
          if (parts.length !== 2 || !parts.every(s => /^[A-Za-z0-9_-]+$/.test(s))) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
          const mac = Buffer.from(parts[1]!, 'base64url'), expected = signature(parts[0]!, session.hash);
          if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) throw new IntakeRejection('PERMISSION_CHANGED');
          let tuple: unknown;
          try { tuple = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString()); } catch { throw new IntakeRejection('FILE_INVALID', 'VALIDATION'); }
          if (!Array.isArray(tuple) || tuple.length !== 4 || tuple[0] !== binding || typeof tuple[1] !== 'string'
            || typeof tuple[2] !== 'number' || !Number.isFinite(tuple[2]) || tuple[3] !== 'principals' || await clock(client) >= tuple[2]) {
            throw new IntakeRejection('PERMISSION_CHANGED');
          }
          after = parseContractSchema('IntakeId', tuple[1]); until = Math.min(until, tuple[2]);
        }
        client.validUntil(until);
        // Scan registered identities first, before eligibility filtering. Limiting
        // after filtering would make sparse directories an unbounded scan.
        const rows = await registeredPrincipalPage(client, who, after, request.limit);
        const scanned = rows.slice(0, request.limit), items: C['IntakePrincipalPage']['items'] = [];
        const now = await clock(client);
        for (const target of scanned) {
          if (target.identityScope === 'content-intake-system') continue;
          if (purpose === 'grant-recipient') {
            try { requireFresh(target, now); }
            catch (error) {
              if (error instanceof IntakeRejection && error.reason === 'ORG_FACTS_UNAVAILABLE') continue;
              throw error;
            }
            if (samePerson(who, target) || !(capability.mayAllocate.some(action => recipientRoleAllows(target.role, 'business', action))
              || capability.mayDelegate.some(action => recipientRoleAllows(target.role, 'delegation', action)))) continue;
          }
          const displayLabel = target.displayName
            ?? labels?.({ principalId: target.id, tenantId: target.tenantId, appId: target.appId });
          if (isRetiredDirectoryIdentity(target, who.id, displayLabel)) continue;
          if (purpose === 'grant-recipient') client.validUntil(target.validUntil);
          if (typeof displayLabel !== 'string' || !displayLabel.trim() || [...displayLabel].length > 256) {
            throw new IntakeRejection('ORG_FACTS_UNAVAILABLE', 'OVERLOADED');
          }
          items.push({ principalId: target.id, displayLabel, factsVersion: target.factsVersion,
            validUntil: new Date(target.validUntil).toISOString(), enabled: target.enabled });
        }
        let nextCursor: string | null = null;
        if (rows.length > request.limit) {
          const body = Buffer.from(JSON.stringify([binding, scanned.at(-1)!.id, until, 'principals'])).toString('base64url');
          nextCursor = `${body}.${signature(body, session.hash).toString('base64url')}`;
        }
        const result = parseContractSchema('IntakePrincipalPage', { items, nextCursor });
        if (Buffer.byteLength(JSON.stringify(result)) > 262_144) throw new IntakeRejection('FILE_LIMIT', 'OVERLOADED');
        return result;
      }, value => parseContractSchema('IntakePrincipalPage', value));
    },
    /** Recovery menu, not a point-in-time snapshot. Scan at most limit versions
     * per page and project readiness through the command owner's predicate.
     * A state-filtered page may be empty with a next cursor. Every page rechecks
     * the complete authority projection; a cursor grants no resource access. */
    candidates(actor: AuthenticatedUser, raw: unknown) {
      return run(actor, 'discover-candidates', null, null, async (client, who) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
        const { sourceId, state: wanted, ...paging } = raw as Record<string, unknown>;
        const request = page(paging);
        if (sourceId !== undefined) parseContractSchema('IntakeId', sourceId);
        if (wanted !== undefined && !['awaiting-evidence','ready','publishing','published','cancelled','invalidated'].includes(wanted as string)) {
          throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
        }
        const session = await lockProductSession(client, actor), access = await discover(client, who, session.validUntil);
        const sources = access.capabilities.filter(c => c.actions.includes('content-manage')).map(c => c.scope.sourceId!);
        if (sourceId !== undefined && !sources.includes(sourceId as string)) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
        const binding = digest(canonical([access.revision, (sourceId as string | undefined) ?? null, (wanted as string | undefined) ?? null]));
        let afterId = '', afterVersion = 0;
        if (request.cursor) {
          const parts = request.cursor.split('.');
          if (parts.length !== 2 || !parts.every(s => /^[A-Za-z0-9_-]+$/.test(s))) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
          const mac = Buffer.from(parts[1]!, 'base64url'), expected = signature(parts[0]!, session.hash);
          if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) throw new IntakeRejection('PERMISSION_CHANGED');
          let tuple: unknown;
          try { tuple = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString()); } catch { throw new IntakeRejection('FILE_INVALID', 'VALIDATION'); }
          if (!Array.isArray(tuple) || tuple.length !== 5 || tuple[0] !== binding || typeof tuple[1] !== 'string'
            || !Number.isSafeInteger(tuple[2]) || tuple[2] < 1 || typeof tuple[3] !== 'number'
            || tuple[4] !== 'candidates' || await clock(client) >= tuple[3]) throw new IntakeRejection('PERMISSION_CHANGED');
          afterId = tuple[1]; afterVersion = tuple[2];
        }
        const rows = (await client.query<{ candidate_id: string; version: string }>(`SELECT candidate_id,version
          FROM content_intake.candidate_versions WHERE source_id=ANY($1::text[])
            AND (candidate_id COLLATE "C",version)>($2 COLLATE "C",$3::bigint)
          ORDER BY candidate_id COLLATE "C",version LIMIT $4`,
        [sourceId === undefined ? sources : [sourceId], afterId, afterVersion, request.limit + 1])).rows;
        const scanned = rows.slice(0, request.limit), items: C['IntakeCandidate'][] = [];
        for (const row of scanned) {
          const candidate = await readCandidate(client, who, row.candidate_id, Number(row.version));
          if (wanted === undefined || candidate.state === wanted) items.push(candidate);
        }
        let nextCursor: string | null = null;
        if (rows.length > request.limit) {
          const last = scanned.at(-1)!;
          const body = Buffer.from(JSON.stringify([binding, last.candidate_id, Number(last.version), Date.parse(access.meta.validUntil), 'candidates'])).toString('base64url');
          nextCursor = `${body}.${signature(body, session.hash).toString('base64url')}`;
        }
        return { items, nextCursor };
      }, value => parseContractSchema('IntakeCandidateList', value));
    },
    authorizations: (actor: AuthenticatedUser, raw: unknown) => read(actor, raw, 'authorization', 'IntakeAuthorization'),
    sources: (actor: AuthenticatedUser, raw: unknown) => read(actor, raw, 'sources', 'IntakeSourceList'),
  };
}
