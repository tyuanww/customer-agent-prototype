import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { parseContractSchema, type ContractSchemaName, type components } from '@customer-agent/contracts';
import type { AuthenticatedUser } from '../auth-service.js';
import { authorize, source } from './authority.js';
import { canonical, digest } from './material.js';
import { QUALITY_LIMITS, readQualityView, type IntakeQualityProgress } from './quality.js';
import { clock, IntakeRejection, lockProductSession, type createIntakeTransactions } from './transaction.js';

type C = components['schemas'];
type Phase = C['IntakeQualitySubmission']['phase'];
const invalid = (): never => { throw new IntakeRejection('FILE_INVALID', 'VALIDATION'); };
const changed = (): never => { throw new IntakeRejection('MATERIAL_CHANGED'); };
function bounded<S extends ContractSchemaName>(schema: S, value: unknown, bytes: number) {
  const parsed = parseContractSchema(schema, value);
  if (Buffer.byteLength(JSON.stringify(parsed)) > bytes) throw new Error('QUALITY_RESPONSE_LIMIT');
  return parsed;
}
function query(raw: unknown, samples: boolean) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
  const r = raw as Record<string, unknown>;
  const allowed = samples ? ['digest', 'viewHash', 'phase', 'limit', 'cursor'] : ['digest'];
  if (Object.keys(r).some(k => !allowed.includes(k))) return invalid();
  if (typeof r.digest !== 'string' || !/^[0-9a-f]{64}$/.test(r.digest)) return invalid();
  const limit = 'limit' in r ? r.limit : 50;
  if (samples && (typeof r.viewHash !== 'string' || !/^[0-9a-f]{64}$/.test(r.viewHash)
    || (r.phase !== 'initial' && r.phase !== 'expanded') || typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100
    || ('cursor' in r && (typeof r.cursor !== 'string' || r.cursor.length < 1 || r.cursor.length > 512)))) return invalid();
  return { digest: r.digest, viewHash: r.viewHash as string, phase: r.phase as Phase, limit: limit as number, cursor: r.cursor as string | undefined };
}
function summary({ preview: p, progress: s }: Awaited<ReturnType<typeof readQualityView>>): C['IntakeQualityStatus'] {
  const state = { key: s.key, state: s.state,
    plan: { policyVersion: 'intake-quality-v1' as const, ordinaryCount: p.ordinaryCount, mandatoryCount: p.mandatoryCount,
      withdrawalCount: p.withdrawals.length, initialTarget: p.initialTarget, expandedTarget: p.expandedTarget,
      initialCount: p.initialScriptIds.length, expandedCount: p.expandedScriptIds.length, seedHash: p.seedHash,
      populationManifestHash: p.populationManifestHash, selectionManifestHash: p.selectionManifestHash },
    frozen: s.frozenBy === null ? null : { principalId: s.frozenBy, factsVersion: s.frozenFactsVersion, recordedAt: s.frozenAt },
    rounds: s.rounds.map(r => ({ phase: r.phase, reviewer: { principalId: r.checkedBy, factsVersion: r.factsVersion, recordedAt: r.recordedAt },
      checkedCount: r.checks.length, defectCount: r.checks.filter(c => c.defect).length })) };
  return bounded('IntakeQualityStatus', { ...state, viewHash: digest(canonical(state)) }, QUALITY_LIMITS.summaryBytes);
}

/** Project a durable internal receipt without returning its population or reasons.
 * Historical receipts predate frozenFactsVersion; do not require that new read-only
 * attribution field. This status describes the operation, never the current page. */
export function qualityReceipt(operationId: string, action: C['IntakeQualityReceipt']['action'], raw: unknown): C['IntakeQualityReceipt'] {
  if (!raw || typeof raw !== 'object' || !('purpose' in raw) || raw.purpose !== 'synthetic-quality-review'
    || !('rounds' in raw) || !Array.isArray(raw.rounds)) throw new Error('INVALID_QUALITY_RECEIPT');
  const progress = raw as IntakeQualityProgress;
  let phase: Phase | null = null;
  if (action === 'quality-check') {
    const last = progress.rounds.at(-1);
    if (!last || (last.phase !== 'initial' && last.phase !== 'expanded')) throw new Error('INVALID_QUALITY_RECEIPT');
    phase = last.phase;
  }
  return bounded('IntakeQualityReceipt', { operationId, action, key: progress.key, state: progress.state, phase }, QUALITY_LIMITS.summaryBytes);
}

/** The existing quality state machine owns sampling and writes. This reader owns
 * the bounded wire projection and cursor lifecycle, sharing one authorized view
 * per transaction. No cursor can carry authorization into the next request. */
export function createIntakeQualityAccess(run: ReturnType<typeof createIntakeTransactions>) {
  const secret = randomBytes(32);
  const mac = (body: string, binding: string) => createHmac('sha256', secret).update(`${binding}\0${body}`).digest();
  return {
    qualityStatus(actor: AuthenticatedUser, candidateId: string, version: number, raw: unknown) {
      return run(actor, 'quality-status', null, null, async (client, who) => {
        const q = query(raw, false), key = parseContractSchema('IntakeCandidateKey', { candidateId, version, digest: q.digest });
        return summary(await readQualityView(client, who, key));
      }, value => bounded('IntakeQualityStatus', value, QUALITY_LIMITS.summaryBytes));
    },
    qualitySamples(actor: AuthenticatedUser, candidateId: string, version: number, raw: unknown) {
      return run(actor, 'quality-samples', null, null, async (client, who) => {
        const q = query(raw, true), key = parseContractSchema('IntakeCandidateKey', { candidateId, version, digest: q.digest });
        const session = await lockProductSession(client, actor);
        const view = await readQualityView(client, who, key), status = summary(view);
        if (q.viewHash !== status.viewHash) return changed();
        const src = await source(client, view.preview.sourceId);
        const until = Math.min(session.validUntil, who.validUntil, await authorize(client, who, 'review', src));
        const policy = (await client.query<{ version: string }>('SELECT version FROM content_intake.policy_versions WHERE tenant_id=$1 AND app_id=$2', [who.tenantId, who.appId])).rows[0];
        if (!policy) throw new IntakeRejection('ORG_FACTS_UNAVAILABLE', 'FORBIDDEN');
        const binding = canonical(['quality-samples', session.hash, who.id, who.factsVersion, who.generation, policy.version, src.version, key, status.viewHash, q.phase, q.limit]);
        let start = 0, deadline = until;
        if (q.cursor) {
          const parts = q.cursor.split('.');
          if (parts.length !== 2 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) return changed();
          const actual = Buffer.from(parts[1]!, 'base64url'), expected = mac(parts[0]!, binding);
          if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return changed();
          let tuple: unknown;
          try { tuple = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString()); } catch { return changed(); }
          if (!Array.isArray(tuple) || tuple.length !== 2 || !Number.isSafeInteger(tuple[0]) || tuple[0] < 1
            || typeof tuple[1] !== 'number' || !Number.isFinite(tuple[1]) || await clock(client) >= tuple[1]) return changed();
          start = tuple[0]; deadline = Math.min(until, tuple[1]);
        }
        client.validUntil(deadline);
        const p = view.preview, ids = q.phase === 'initial' ? p.initialScriptIds : p.expandedScriptIds;
        if (start > 0 && start >= ids.length) return changed();
        const entries = new Map(p.entries.map(e => [e.scriptId, e.entry]));
        const population = new Map(p.population.map(r => [r.script_id, r]));
        // Expanded checks inherit immutable initial checks before that round exists.
        const checks = new Map(view.progress.rounds.filter(r => r.phase === 'initial' || q.phase === 'expanded').flatMap(r => r.checks).map(c => [c.scriptId, c]));
        const cursor = (offset: number): string | null => {
          if (offset >= ids.length) return null;
          const body = Buffer.from(JSON.stringify([offset, deadline])).toString('base64url');
          return `${body}.${mac(body, binding).toString('base64url')}`;
        };
        const page: C['IntakeQualitySamplePage'] = { key, viewHash: status.viewHash, phase: q.phase,
          selectionManifestHash: p.selectionManifestHash, items: [], nextCursor: null };
        // Reserve the maximum cursor and comma overhead once; complete entries
        // are measured individually so sizing stays linear even near 8 MiB.
        let bytes = Buffer.byteLength(JSON.stringify(page)) + 514;
        let end = start;
        while (end < ids.length && page.items.length < q.limit) {
          const id = ids[end]!, row = population.get(id)!, entry = entries.get(id)!;
          if (entry.operation !== 'upsert') throw new Error('INVALID_QUALITY_SAMPLE');
          const item = { scriptId: id, contentHash: row.content_hash, mandatory: row.risk_level === 'high', entry: { ...entry, operation: entry.operation }, check: checks.get(id) ?? null };
          const added = Buffer.byteLength(JSON.stringify(item)) + (page.items.length ? 1 : 0);
          if (bytes + added > QUALITY_LIMITS.sampleBytes) break;
          page.items.push(item); bytes += added; end++;
        }
        if (end === start && start < ids.length) throw new Error('QUALITY_SAMPLE_LIMIT');
        page.nextCursor = cursor(end);
        return bounded('IntakeQualitySamplePage', page, QUALITY_LIMITS.sampleBytes);
      }, value => bounded('IntakeQualitySamplePage', value, QUALITY_LIMITS.sampleBytes));
    },
    qualityOperationReceipt(actor: AuthenticatedUser, operationId: unknown, action: unknown) {
      return run(actor, 'quality-operation-receipt', null, null, async (client, who) => {
        const id = parseContractSchema('IntakeId', operationId);
        if (action !== 'quality-freeze' && action !== 'quality-check') return invalid();
        const saved = await client.query<{ response: unknown }>('SELECT response FROM backend_review.receipts WHERE actor_user_id=$1 AND operation=$2 AND request_key=$3', [who.userId, `intake:${action}`, id]);
        if (!saved.rows[0]) throw new IntakeRejection('COMMIT_UNKNOWN', 'NOT_FOUND');
        return qualityReceipt(id, action, saved.rows[0].response);
      }, value => bounded('IntakeQualityReceipt', value, QUALITY_LIMITS.summaryBytes));
    },
  };
}
