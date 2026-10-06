import { parseContractSchema, type components } from '@customer-agent/contracts';
import { qualityTargets } from '../content-normalize.js';
import { candidateContext } from './candidate.js';
import { canonical, digest } from './material.js';
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
