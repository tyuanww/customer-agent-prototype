import { parseContractSchema, type components } from '@customer-agent/contracts';
import { qualityTargets } from '../content-normalize.js';
import { candidateContext } from './candidate.js';
import { canonical, digest } from './material.js';
import { requireIndependentReviewer } from './reviewer.js';
import { IntakeRejection, type IntakeTransaction, type Principal } from './transaction.js';

type C = components['schemas'];

/** Sampling tuples only, NOT staging rows or legacy governance content hashes.
 * The key binds the complete material, including internal notes, questions,
 * vocabulary versions and disables which the legacy population omits. */
export type QualityPopulationRow = {
  staging_id: string; script_id: string; operation: 'upsert'; content_hash: string;
  risk_level: 'low' | 'high'; has_conflict: false; quality_status: 'clean';
};

export type IntakeQualityPreview = {
  purpose: 'synthetic-quality-preview';
  key: C['IntakeCandidateKey'];
  sourceId: string;
  population: QualityPopulationRow[];
  entries: { scriptId: string; entry: C['IntakeEntry'] }[];
  withdrawals: string[];
  ordinaryCount: number;
  mandatoryCount: number;
  initialTarget: number;
  expandedTarget: number;
  seedHash: string;
  populationManifestHash: string;
  selectionManifestHash: string;
  initialScriptIds: string[];
  expandedScriptIds: string[];
};

/** Project only frozen material; never accept workbook-supplied scope, risk or
 * sampler seed. Source-qualified IDs avoid collisions between shops. Critical
 * material conservatively makes every live entry mandatory; this does not
 * assign the legacy business risk categories or certify conflict absence. */
export function qualityPopulation(rawKey: unknown, rawMaterial: unknown) {
  const key = parseContractSchema('IntakeCandidateKey', rawKey);
  const material = parseContractSchema('IntakeMaterial', rawMaterial);
  if (digest(canonical(material)) !== key.digest) throw new IntakeRejection('MATERIAL_CHANGED');
  const identities = new Set<string>();
  const population: QualityPopulationRow[] = [];
  const entries: IntakeQualityPreview['entries'] = [];
  const withdrawals: string[] = [];
  for (const entry of material.entries) {
    if (identities.has(entry.businessEntryId)) throw new IntakeRejection('MATERIAL_CHANGED');
    identities.add(entry.businessEntryId);
    const scriptId = `intake_${digest(canonical([material.scope.sourceId, entry.businessEntryId]))}`;
    if (entry.operation === 'disable') { withdrawals.push(entry.businessEntryId); continue; }
    entries.push({ scriptId, entry });
    population.push({ script_id: scriptId, staging_id: `istg_${digest(canonical([key, scriptId]))}`,
      operation: 'upsert', content_hash: digest(canonical({ encoding: 'intake-quality-v1', key, entry })),
      risk_level: material.risk.level === 'critical' ? 'high' : 'low', has_conflict: false, quality_status: 'clean' });
  }
  const ordinaryCount = material.risk.level === 'routine' ? population.length : 0;
  const targets = qualityTargets(ordinaryCount);
  return { purpose: 'synthetic-quality-preview' as const, key, sourceId: material.scope.sourceId,
    population, entries, withdrawals, ordinaryCount, mandatoryCount: population.length - ordinaryCount,
    initialTarget: targets.initial, expandedTarget: targets.expanded,
    seedHash: digest(canonical({ encoding: 'intake-quality-seed-v1', key })) };
}

/** Internal read-only consumer for the sealed synthetic service. The database
 * owns population canonicalization and ranked selection. This is a preview,
 * not a frozen plan, quality evidence, owner acceptance or permission to publish.
 * No receipts: every read rechecks current authorization, source, base and key. */
export async function previewQuality(client: IntakeTransaction, actor: Principal, rawKey: unknown): Promise<IntakeQualityPreview> {
  const key = parseContractSchema('IntakeCandidateKey', rawKey);
  const { material } = await candidateContext(client, actor, key, 'review', true);
  const plan = qualityPopulation(key, material);
  const { rows } = await client.query<{
    population_hash: string; selection_hash: string; initial_ids: string[]; expanded_ids: string[];
  }>(`WITH selected AS (SELECT
      public.content_quality_population_manifest_hash($1::jsonb) AS population_hash,
      backend_review.sample_ids($1::jsonb,$2,$3) AS initial_ids,
      backend_review.sample_ids($1::jsonb,$2,$4) AS expanded_ids)
    SELECT *,encode(sha256(convert_to(jsonb_build_array(initial_ids,expanded_ids)::text,'UTF8')),'hex') AS selection_hash
    FROM selected`, [JSON.stringify(plan.population), plan.seedHash, plan.initialTarget, plan.expandedTarget]);
  const sampled = rows[0]!;
  return { ...plan, populationManifestHash: sampled.population_hash, selectionManifestHash: sampled.selection_hash,
    initialScriptIds: sampled.initial_ids, expandedScriptIds: sampled.expanded_ids };
}

type Phase = 'initial' | 'expanded';
export type QualityCheck = { scriptId: string; contentHash: string; defect: boolean; reason: string };
type FrozenPlan = Pick<IntakeQualityPreview, 'population' | 'ordinaryCount' | 'mandatoryCount' | 'initialTarget' | 'expandedTarget'
  | 'seedHash' | 'populationManifestHash' | 'selectionManifestHash' | 'initialScriptIds' | 'expandedScriptIds'>;
export type IntakeQualityProgress = {
  purpose: 'synthetic-quality-review'; key: C['IntakeCandidateKey'];
  state: 'not_frozen' | 'initial_required' | 'expansion_required' | 'passed' | 'revision_required' | 'blocked';
  plan: FrozenPlan | null; frozenBy: string | null; frozenAt: string | null;
  rounds: { phase: Phase; checks: QualityCheck[]; checkedBy: string; factsVersion: number; recordedAt: string }[];
};
type QualityCommand = { operationId: string; key: C['IntakeCandidateKey'] };
type QualitySubmission = QualityCommand & { phase: Phase; checks: QualityCheck[] };
const invalid = (): never => { throw new IntakeRejection('FILE_INVALID', 'VALIDATION'); };
function fields(value: unknown, expected: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some(k => !expected.includes(k))) return invalid();
  return value as Record<string, unknown>;
}
/** Internal commands only. No caller-supplied actor, plan, counts or conclusion. */
export function qualityCommand(raw: unknown): QualityCommand {
  const input = fields(raw, ['operationId', 'key']);
  return { operationId: parseContractSchema('IntakeId', input.operationId), key: parseContractSchema('IntakeCandidateKey', input.key) };
}
export function qualitySubmission(raw: unknown): QualitySubmission {
  const input = fields(raw, ['operationId', 'key', 'phase', 'checks']);
  if (input.phase !== 'initial' && input.phase !== 'expanded') return invalid();
  if (!Array.isArray(input.checks) || input.checks.length > 5000) return invalid();
  const checks = input.checks.map((raw): QualityCheck => {
    const c = fields(raw, ['scriptId', 'contentHash', 'defect', 'reason']);
    if (typeof c.scriptId !== 'string' || !/^intake_[0-9a-f]{64}$/.test(c.scriptId)
      || typeof c.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(c.contentHash)
      || typeof c.defect !== 'boolean' || typeof c.reason !== 'string' || c.reason.length > 1000
      || (c.defect && c.reason.trim() === '')) return invalid();
    return { scriptId: c.scriptId, contentHash: c.contentHash, defect: c.defect, reason: c.reason };
  });
  if (new Set(checks.map(c => c.scriptId)).size !== checks.length) return invalid();
  return { ...qualityCommand({ operationId: input.operationId, key: input.key }), phase: input.phase, checks };
}
function frozenPlan(p: IntakeQualityPreview): FrozenPlan {
  const { population, ordinaryCount, mandatoryCount, initialTarget, expandedTarget, seedHash,
    populationManifestHash, selectionManifestHash, initialScriptIds, expandedScriptIds } = p;
  return { population, ordinaryCount, mandatoryCount, initialTarget, expandedTarget, seedHash,
    populationManifestHash, selectionManifestHash, initialScriptIds, expandedScriptIds };
}

/** Rechecks current authority/material before exposing durable quality evidence.
 * A passed quality state is never an approval, ticket or permission to publish. */
export async function readQuality(client: IntakeTransaction, actor: Principal, rawKey: unknown): Promise<IntakeQualityProgress> {
  const preview = await previewQuality(client, actor, rawKey);
  const key = preview.key;
  const args = [key.candidateId, key.version, key.digest];
  const stored = (await client.query<{ plan: FrozenPlan; frozen_by: string; frozen_at: Date }>(
    'SELECT plan,frozen_by,frozen_at FROM content_intake.quality_plans WHERE candidate_id=$1 AND candidate_version=$2 AND candidate_digest=$3', args)).rows[0];
  if (stored && canonical(stored.plan) !== canonical(frozenPlan(preview))) throw new IntakeRejection('MATERIAL_CHANGED');
  const rounds = await client.query<{ phase: Phase; checks: QualityCheck[]; checked_by: string; facts_version: string; recorded_at: Date }>(
    'SELECT * FROM content_intake.quality_rounds WHERE candidate_id=$1 AND candidate_version=$2 AND candidate_digest=$3 ORDER BY recorded_at,phase', args);
  const state = (await client.query<{ state: IntakeQualityProgress['state'] }>('SELECT content_intake.quality_state($1,$2) AS state', args.slice(0, 2))).rows[0]!.state;
  return { purpose: 'synthetic-quality-review', key, state, plan: stored?.plan ?? null,
    frozenBy: stored?.frozen_by ?? null, frozenAt: stored?.frozen_at.toISOString() ?? null,
    rounds: rounds.rows.map(r => ({ phase: r.phase, checks: r.checks, checkedBy: r.checked_by, factsVersion: Number(r.facts_version), recordedAt: r.recorded_at.toISOString() })) };
}

export async function freezeQuality(client: IntakeTransaction, actor: Principal, request: QualityCommand): Promise<IntakeQualityProgress> {
  const p = await previewQuality(client, actor, request.key);
  await client.query(`INSERT INTO content_intake.quality_plans(candidate_id,candidate_version,candidate_digest,policy_version,plan,frozen_by,facts_version)
    VALUES ($1,$2,$3,'intake-quality-v1',$4::jsonb,$5,$6) ON CONFLICT (candidate_id,candidate_version) DO NOTHING`,
  [p.key.candidateId, p.key.version, p.key.digest, JSON.stringify(frozenPlan(p)), actor.id, actor.factsVersion]);
  return readQuality(client, actor, p.key);
}

/** Each phase submits the exact frozen set atomically. Expanded checks repeat
 * initial items unchanged; users must revise the candidate to repair a defect.
 * The permanent transaction receipt recovers a lost COMMIT without another write. */
export async function checkQuality(client: IntakeTransaction, actor: Principal, request: QualitySubmission): Promise<IntakeQualityProgress> {
  const progress = await readQuality(client, actor, request.key);
  if (!progress.plan || progress.state !== (request.phase === 'initial' ? 'initial_required' : 'expansion_required')) throw new IntakeRejection('MATERIAL_CHANGED');
  const { material } = await candidateContext(client, actor, request.key, 'review', true);
  await requireIndependentReviewer(client, material, { identity_scope: actor.identityScope, person_key: actor.personKey });
  const ids = request.phase === 'initial' ? progress.plan.initialScriptIds : progress.plan.expandedScriptIds;
  const selected = new Set(ids);
  const expected = new Map(progress.plan.population.map(r => [r.script_id, r.content_hash]));
  const prior = new Map(progress.rounds.flatMap(r => r.checks).map(c => [c.scriptId, c]));
  if (request.checks.length !== ids.length || request.checks.some(c => !selected.has(c.scriptId) || expected.get(c.scriptId) !== c.contentHash
    || (prior.has(c.scriptId) && canonical(prior.get(c.scriptId)!) !== canonical(c)))) return invalid();
  await client.query(`INSERT INTO content_intake.quality_rounds(candidate_id,candidate_version,candidate_digest,phase,checks,checked_by,facts_version)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`, [request.key.candidateId, request.key.version, request.key.digest,
    request.phase, JSON.stringify(request.checks), actor.id, actor.factsVersion]);
  return readQuality(client, actor, request.key);
}
