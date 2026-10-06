import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { AuthenticatedUser } from '../auth-service.js';
import { allocationKinds } from './authority.js';
import { canonical, digest } from './material.js';
import { clock, createIntakeTransactions, IntakeRejection, lockProductSession, type IntakeTransaction, type Principal } from './transaction.js';

type C = components['schemas'];
type Capability = C['IntakeAuthorization']['capabilities'][number];
type Kind = 'authorization' | 'sources';
type Page = { limit: number; cursor?: string };
// Discovery is a bounded menu, never a grant or a cached authorization decision.
const MAX_SOURCES = 5_000;
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
    SELECT jsonb_build_object('scope',jsonb_build_object('tenantId',s.tenant_id,'appId',s.app_id,
      'brandId',s.brand_id,'shopId',s.shop_id,'domain',s.domain,'sourceId',src.source_id),
      'version',src.current_mapping_version,'templateVersion',m.template_version,'ruleVersion',m.rule_version,
      'mappingVersion',m.mapping_version,'structureDigest',m.structure_digest,
      'contentIntakeMode',src.mode,'modeVersion',src.mode_version) AS source, rights.items AS rights
    FROM content_intake.sources src JOIN content_intake.scopes s USING(scope_id)
    JOIN content_intake.source_mappings m ON m.source_id=src.source_id AND m.version=src.current_mapping_version
    CROSS JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('action',action,'kind',kind,'until',until) ORDER BY kind,action) AS items FROM (
        -- The business predicate already aggregates the effective grant set.
        -- Evaluate it once per action/kind, not once per overlapping grant.
        SELECT g.action,g.kind,CASE WHEN g.kind='business' THEN
          content_intake.authorization_deadline($1,g.action,s.scope_id,src.source_id,clock_timestamp())
          ELSE max(g.expires_at) END AS until
        FROM content_intake.grants g WHERE g.recipient_id=$1 AND g.scope_id=s.scope_id
          AND (g.source_id IS NULL OR g.source_id=src.source_id) AND g.revoked_at IS NULL
          AND g.starts_at<=clock_timestamp() AND g.expires_at>clock_timestamp()
          AND (g.kind='business' OR (g.kind=ANY($4::text[]) AND g.steward_id IS NOT NULL))
        GROUP BY g.action,g.kind
      ) effective WHERE until IS NOT NULL
    ) rights
    WHERE s.tenant_id=$2 AND s.app_id=$3 AND rights.items IS NOT NULL
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
export function createIntakeDiscovery(run: ReturnType<typeof createIntakeTransactions>) {
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
    authorizations: (actor: AuthenticatedUser, raw: unknown) => read(actor, raw, 'authorization', 'IntakeAuthorization'),
    sources: (actor: AuthenticatedUser, raw: unknown) => read(actor, raw, 'sources', 'IntakeSourceList'),
  };
}
