import { randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { ParseResult } from '@customer-agent/content-intake';
import { canonical, digest, materialFromParse } from './material.js';
import { authorize, source, type Source } from './authority.js';
import { clock, IntakeRejection, principal, type IntakeTransaction, type Principal } from './transaction.js';

type C = components['schemas'];
export type Job = { job_id: string; source_id: string; object_id: string; actor_id: string;
  source_version: string; contributor_ids: string[]; generation: string; state: C['IntakeParseJob']['state'];
  base_release_id: string | null; expected_prior_id: string | null; expected_prior_version: string | null;
  expected_prior_digest: string | null; result_candidate_id: string | null; result_candidate_version: string | null;
  report_object_id: string | null; started_at: Date };

export function jobView(job: Pick<Job, 'job_id' | 'generation' | 'state' | 'result_candidate_id' | 'result_candidate_version' | 'report_object_id'>, parsed?: ParseResult): C['IntakeParseJob'] {
  return parseContractSchema('IntakeParseJob', { jobId: job.job_id, generation: Number(job.generation), state: job.state,
    candidateId: job.result_candidate_id, candidateVersion: job.result_candidate_version === null ? null : Number(job.result_candidate_version),
    issues: (parsed?.issues ?? []).slice(0, 100).map(i => ({ code: i.code, message: i.fix,
      location: { sheet: i.sheet || '文件', row: Math.max(1, i.row),
        column: Math.min(32, Math.max(1, [...i.column].reduce((v, c) => v * 26 + c.charCodeAt(0) - 64, 0))) } })),
    totalIssues: parsed?.issues.length ?? 0, excludedSheetCount: parsed?.excluded.length ?? 0,
    excludedMediaCount: parsed?.excluded.reduce((sum, e) => sum + e.images, 0) ?? 0, reportObjectId: job.report_object_id });
}

export async function getJob(client: IntakeTransaction, actor: Principal, id: string): Promise<{ job: Job; src: Source }> {
  const { rows } = await client.query<Job>('SELECT j.*, j.contributor_ids::text[] AS contributor_ids FROM content_intake.parse_jobs j WHERE job_id=$1', [id]);
  const job = rows[0];
  if (!job) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  const src = await source(client, job.source_id);
  await authorize(client, actor, 'import', src);
  return { job, src };
}

async function currentBase(client: IntakeTransaction, expected: string | null): Promise<void> {
  // Legacy publication takes this existing lock but not lock_content(). Take it
  // after the content lock, including when current has no row to lock yet.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('cs_ai_content_publish'))");
  const { rows } = await client.query<{ current_release_id: string }>('SELECT current_release_id FROM public.content_current WHERE id=1 FOR UPDATE');
  if ((rows[0]?.current_release_id ?? null) !== expected) throw new IntakeRejection('BASE_CHANGED');
  // Old release rows cannot be silently interpreted as an empty v2 source catalog.
  if (expected !== null) {
    const catalog = await client.query('SELECT 1 FROM content_intake.release_catalogs WHERE release_id=$1', [expected]);
    if (catalog.rowCount !== 1) throw new IntakeRejection('MODE_CONFLICT');
  }
}

export async function receive(client: IntakeTransaction, actor: Principal, sourceId: string, req: C['IntakeReceive']): Promise<C['IntakeParseJob']> {
  const src = await source(client, sourceId);
  await authorize(client, actor, 'import', src);
  if (src.mode !== 'v2-preview') throw new IntakeRejection('MODE_CONFLICT');
  if (src.version !== req.sourceVersion) throw new IntakeRejection('SOURCE_MISMATCH');
  await currentBase(client, req.baseReleaseId);
  const object = await client.query<{ bytes: string }>(`SELECT bytes FROM content_intake.objects
    WHERE object_id=$1 AND source_id=$2 AND actor_id=$3 AND purpose='input'`, [req.objectId, sourceId, actor.id]);
  if (!object.rows[0]) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  const contributors = [...new Set([actor.id, req.contributorDeclaration.preparerPrincipalId, ...req.contributorDeclaration.editorPrincipalIds])].sort();
  for (const id of contributors) {
    const p = await principal(client, { id });
    // Contributors need confirmed identity, not current content permission/enabled employment.
    if (p.tenantId !== actor.tenantId || p.appId !== actor.appId) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  }
  if (req.expectedPriorKey) {
    const old = await readCandidate(client, actor, req.expectedPriorKey.candidateId, req.expectedPriorKey.version, 'import');
    if (old.sourceId !== sourceId || old.key.digest !== req.expectedPriorKey.digest
      || !['awaiting-evidence', 'ready'].includes(old.state)) throw new IntakeRejection('MATERIAL_CHANGED');
  }
  // Revisions reserve the existing candidate identity, including at the quota boundary.
  // Several revisions may race, but only one can consume the old key at freeze.
  const counts = await client.query<{ actor: string; source: string; actor_jobs: string; source_jobs: string; bytes: string }>(`SELECT
    (SELECT count(DISTINCT identity) FROM (
      SELECT candidate_id::text AS identity FROM content_intake.candidate_versions WHERE actor_id=$1 AND state IN ('awaiting-evidence','ready','publishing')
      UNION ALL SELECT coalesce(expected_prior_id,job_id)::text FROM content_intake.parse_jobs WHERE actor_id=$1 AND state IN ('reading','parsing')
      UNION ALL SELECT coalesce($4::text,'new-admission')
    ) q) AS actor,
    (SELECT count(DISTINCT identity) FROM (
      SELECT candidate_id::text AS identity FROM content_intake.candidate_versions WHERE source_id=$2 AND state IN ('awaiting-evidence','ready','publishing')
      UNION ALL SELECT coalesce(expected_prior_id,job_id)::text FROM content_intake.parse_jobs WHERE source_id=$2 AND state IN ('reading','parsing')
      UNION ALL SELECT coalesce($4::text,'new-admission')
    ) q) AS source,
    (SELECT count(*) FROM content_intake.parse_jobs WHERE actor_id=$1 AND state IN ('reading','parsing')) AS actor_jobs,
    (SELECT count(*) FROM content_intake.parse_jobs WHERE source_id=$2 AND state IN ('reading','parsing')) AS source_jobs,
    (SELECT coalesce(sum(bytes),0) FROM content_intake.objects WHERE tenant_id=$3) AS bytes`, [actor.id, sourceId, actor.tenantId, req.expectedPriorKey?.candidateId ?? null]);
  const count = counts.rows[0]!;
  if (Number(count.actor) > 10 || Number(count.source) > 100 || Number(count.actor_jobs) >= 10
    || Number(count.source_jobs) >= 100 || Number(count.bytes) > 1073741824) throw new IntakeRejection('QUOTA_EXCEEDED', 'RATE_LIMITED');
  const { rows } = await client.query<Job>(`INSERT INTO content_intake.parse_jobs(job_id,source_version,contributor_ids,generation,
    source_id,object_id,actor_id,state,base_release_id,started_at,expected_prior_id,expected_prior_version,expected_prior_digest)
    VALUES ($1,$2,$3,1,$4,$5,$6,'reading',$7,clock_timestamp(),$8,$9,$10) RETURNING *`,
  [`parse_${randomUUID()}`, src.version, contributors, sourceId, req.objectId, actor.id, req.baseReleaseId,
    req.expectedPriorKey?.candidateId ?? null, req.expectedPriorKey?.version ?? null, req.expectedPriorKey?.digest ?? null]);
  return jobView(rows[0]!);
}

export async function readCandidate(client: IntakeTransaction, actor: Principal, id: string, version: number,
  action: C['IntakeAction'] = 'content-manage'): Promise<C['IntakeCandidate']> {
  const { rows } = await client.query<{ source_id: string; value: unknown }>(`SELECT c.source_id,jsonb_build_object(
    'key',jsonb_build_object('candidateId',c.candidate_id,'version',c.version,'digest',c.digest),
    'sourceId',c.source_id,'state',c.state,'readinessReasons','[]'::jsonb,
    'sourceEvidenceVersion',c.source_evidence_version,'approvalEvidenceVersion',c.approval_evidence_version,
    'revocationGeneration',c.revocation_generation,'createdAt',c.created_at,'updatedAt',c.updated_at,
    'publishedReleaseId',p.release_id) AS value FROM content_intake.candidate_versions c
    LEFT JOIN content_intake.publications p ON p.candidate_id=c.candidate_id AND p.candidate_version=c.version
    WHERE c.candidate_id=$1 AND c.version=$2`, [id, version]);
  if (!rows[0]) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  await authorize(client, actor, action, await source(client, rows[0].source_id));
  const view = parseContractSchema('IntakeCandidate', rows[0].value);
  if (!['awaiting-evidence', 'ready'].includes(view.state)) return view;
  // Readiness is a projection of current evidence, never a cached permission.
  // Merely reading it does not renew approval validity or change its history.
  const facts = (await client.query<{ source_ok: boolean; base_ok: boolean; approval_state: string | null;
    fresh: boolean | null; reviewer_until: Date | null; reviewer_enabled: boolean | null }>(`SELECT
      s.current_mapping_version=c.source_version AND s.mode='v2-preview' AS source_ok,
      c.base_release_id IS NOT DISTINCT FROM (SELECT current_release_id FROM public.content_current WHERE id=1) AS base_ok,
      f.state AS approval_state, f.checked_at<=clock_timestamp() AND clock_timestamp()<f.valid_until AS fresh,
      content_intake.authorization_deadline(f.reviewer_id,'review',c.scope_id,c.source_id,clock_timestamp()) AS reviewer_until,
      b.enabled AS reviewer_enabled
      FROM content_intake.candidate_versions c JOIN content_intake.sources s USING(source_id)
      LEFT JOIN content_intake.review_bindings r ON r.candidate_id=c.candidate_id AND r.candidate_version=c.version AND r.evidence_version=c.approval_evidence_version
      LEFT JOIN content_intake.approval_current p USING(review_request_id)
      LEFT JOIN content_intake.approval_facts f ON f.review_request_id=p.review_request_id AND f.facts_version=p.facts_version
      LEFT JOIN content_intake.principals reviewer ON reviewer.principal_id=f.reviewer_id
      LEFT JOIN backend_identity.subject_bindings b ON b.user_id=reviewer.user_id
      WHERE c.candidate_id=$1 AND c.version=$2`, [id, version])).rows[0]!;
  const reasons: string[] = [];
  if (!facts.source_ok) reasons.push('SOURCE_MISMATCH');
  if (!facts.base_ok) reasons.push('BASE_CHANGED');
  if (view.sourceEvidenceVersion === 0) reasons.push('SOURCE_CONFIRMATION_REQUIRED');
  if (facts.approval_state === 'revoked') reasons.push('APPROVAL_REVOKED');
  else if (!facts.fresh) reasons.push(view.approvalEvidenceVersion ? 'APPROVAL_UNAVAILABLE' : 'AWAITING_APPROVAL');
  else if (facts.approval_state !== 'approved') reasons.push('AWAITING_APPROVAL');
  else if (!facts.reviewer_until || !facts.reviewer_enabled) reasons.push('PERMISSION_CHANGED');
  return { ...view, state: reasons.length ? 'awaiting-evidence' : 'ready', readinessReasons: reasons };
}

/** Exact key and source authorization before any material or review package leaves the DB. */
export async function candidateContext(client: IntakeTransaction, actor: Principal, key: C['IntakeCandidateKey'],
  action: C['IntakeAction'], mutable = false) {
  const view = await readCandidate(client, actor, key.candidateId, key.version, action);
  if (view.key.digest !== key.digest) throw new IntakeRejection('MATERIAL_CHANGED');
  if (mutable && !['awaiting-evidence','ready'].includes(view.state)) throw new IntakeRejection(view.state === 'published' ? 'ALREADY_PUBLISHED' : 'MATERIAL_CHANGED');
  const row = (await client.query<{ material: unknown }>('SELECT material FROM content_intake.candidate_versions WHERE candidate_id=$1 AND version=$2',
    [key.candidateId, key.version])).rows[0]!;
  const material = parseContractSchema('IntakeMaterial', row.material);
  const src = await source(client, view.sourceId);
  if (mutable) {
    if (src.mode !== 'v2-preview' || src.version !== material.sourceVersion) throw new IntakeRejection('SOURCE_MISMATCH');
    await currentBase(client, material.baseReleaseId);
    const pending = await client.query(`SELECT 1 FROM content_intake.write_attempts WHERE candidate_id=$1 AND candidate_version=$2
      AND action='publish' AND state IN ('pending','unknown')`, [key.candidateId, key.version]);
    if (pending.rowCount) throw new IntakeRejection('COMMIT_UNKNOWN');
  }
  return { view, material, src };
}

/** Evidence writers persist the current projection; GET still recomputes time-dependent gates. */
export async function syncCandidateReadiness(client: IntakeTransaction, actor: Principal, key: C['IntakeCandidateKey'], action: C['IntakeAction']) {
  const view = await readCandidate(client, actor, key.candidateId, key.version, action);
  if (['awaiting-evidence','ready'].includes(view.state)) await client.query(`UPDATE content_intake.candidate_versions
    SET state=$3,updated_at=clock_timestamp() WHERE candidate_id=$1 AND version=$2`, [key.candidateId, key.version, view.state]);
  return readCandidate(client, actor, key.candidateId, key.version, action);
}

export async function freezeParsed(client: IntakeTransaction, actor: Principal, job: Job, src: Source, parsed: ParseResult): Promise<C['IntakeCandidate']> {
  if (job.state !== 'parsing' || job.actor_id !== actor.id) throw new IntakeRejection('MATERIAL_CHANGED');
  if (src.mode !== 'v2-preview' || src.version !== Number(job.source_version)) throw new IntakeRejection('SOURCE_MISMATCH');
  await currentBase(client, job.base_release_id);
  const old = job.expected_prior_id ? await readCandidate(client, actor, job.expected_prior_id, Number(job.expected_prior_version), 'import') : null;
  if (old && (old.key.digest !== job.expected_prior_digest || !['awaiting-evidence', 'ready'].includes(old.state))) throw new IntakeRejection('MATERIAL_CHANGED');
  const uncertain = old ? await client.query(`SELECT 1 FROM content_intake.write_attempts WHERE candidate_id=$1 AND candidate_version=$2
    AND action='publish' AND state IN ('pending','unknown')`, [old.key.candidateId, old.key.version]) : null;
  if (uncertain?.rowCount) throw new IntakeRejection('COMMIT_UNKNOWN');
  const objects = await client.query<{ object_id: string; sha256: string; bytes: string; mime: string }>(
    'SELECT * FROM content_intake.objects WHERE object_id=$1', [job.object_id]);
  const o = objects.rows[0]!;
  const base = await client.query<{ entry: C['IntakeEntry'] }>(`SELECT e AS entry FROM content_intake.release_lineage l
    JOIN content_intake.candidate_versions c ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version
    CROSS JOIN LATERAL jsonb_array_elements(c.material->'entries') e
    WHERE l.release_id=$1 AND l.source_id=$2 AND e->>'businessEntryId'=l.business_entry_id`, [job.base_release_id, job.source_id]);
  const terms = await client.query<{ id: string; kind: 'product' | 'scenario'; display_version: string }>(`SELECT v.vocabulary_id AS id,v.kind,max(d.display_version) AS display_version
    FROM content_intake.vocabulary v JOIN content_intake.vocabulary_displays d USING(vocabulary_id)
    JOIN content_intake.scopes s USING(scope_id) WHERE v.active AND s.tenant_id=$1 AND s.app_id=$2 AND s.brand_id=$3
      AND s.domain=$4 AND (s.shop_id IS NULL OR s.shop_id IS NOT DISTINCT FROM $5) GROUP BY v.vocabulary_id,v.kind`,
  [src.scope.tenantId, src.scope.appId, src.scope.brandId, src.scope.domain, src.scope.shopId]);
  const recent = await client.query<{ count: string }>(`SELECT coalesce(sum(c.explicit_disable_count),0) AS count
    FROM content_intake.publications p JOIN content_intake.candidate_versions c ON c.candidate_id=p.candidate_id AND c.version=p.candidate_version
    JOIN public.content_releases r ON r.release_id=p.release_id WHERE c.source_id=$1
      AND r.published_at>clock_timestamp()-interval '24 hours' AND r.published_at<=clock_timestamp()`, [job.source_id]);
  const material = materialFromParse({ parsed, source: src,
    object: parseContractSchema('IntakeObject', { objectId: o.object_id, sha256: o.sha256, bytes: Number(o.bytes), mime: o.mime, sourceId: job.source_id }),
    contributors: job.contributor_ids, previous: base.rows.map(r => parseContractSchema('IntakeEntry', r.entry)),
    terms: terms.rows.map(t => ({ ...t, displayVersion: Number(t.display_version) })),
    baseReleaseId: job.base_release_id, now: await clock(client), recentDisables: Number(recent.rows[0]!.count) });
  const id = old?.key.candidateId ?? `candidate_${randomUUID()}`;
  const version = (old?.key.version ?? 0) + 1;
  if (old) await client.query(`UPDATE content_intake.candidate_versions SET state='invalidated',revocation_generation=revocation_generation+1,
    updated_at=clock_timestamp() WHERE candidate_id=$1 AND version=$2`, [id, old.key.version]);
  const encoded = canonical(material);
  await client.query(`INSERT INTO content_intake.candidate_versions(candidate_id,version,source_id,scope_id,source_version,
    object_id,file_sha256,actor_id,base_release_id,canonical_encoding,canonical_material,material,risk,explicit_disable_count,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'candidate-p1.1',$10,$11::jsonb,$12,$13,clock_timestamp(),clock_timestamp())`,
  [id, version, job.source_id, src.scopeId, src.version, o.object_id, o.sha256, actor.id, job.base_release_id,
    encoded, JSON.stringify(material), material.risk.level, material.risk.explicitDisableCount]);
  const vocabulary = new Map(material.entries.flatMap(e => [...e.productRefs, ...e.scenarioRefs]).map(t => [t.id, t.displayVersion]));
  await client.query(`INSERT INTO content_intake.candidate_vocabulary SELECT $1,$2,id,display_version
    FROM unnest($3::text[],$4::bigint[]) AS refs(id,display_version)`, [id, version, [...vocabulary.keys()], [...vocabulary.values()]]);
  await client.query(`UPDATE content_intake.parse_jobs SET state='validated',finished_at=clock_timestamp(),result_candidate_id=$2,result_candidate_version=$3 WHERE job_id=$1`, [job.job_id, id, version]);
  await authorize(client, await principal(client, { id: actor.id }), 'import', src);
  const result = await readCandidate(client, actor, id, version, 'import');
  if (result.key.digest !== digest(encoded)) throw new IntakeRejection('MATERIAL_CHANGED');
  return result;
}

export async function cancelCandidate(client: IntakeTransaction, actor: Principal, req: C['IntakeCancel']): Promise<C['IntakeCandidate']> {
  const c = await readCandidate(client, actor, req.key.candidateId, req.key.version, 'candidate-cancel');
  if (c.key.digest !== req.key.digest) throw new IntakeRejection('MATERIAL_CHANGED');
  if (c.state === 'published') throw new IntakeRejection('ALREADY_PUBLISHED');
  const uncertain = await client.query(`SELECT 1 FROM content_intake.write_attempts WHERE candidate_id=$1 AND candidate_version=$2
    AND action='publish' AND state IN ('pending','unknown')`, [req.key.candidateId, req.key.version]);
  if (c.state === 'publishing' || uncertain.rowCount) throw new IntakeRejection('COMMIT_UNKNOWN');
  if (c.state === 'invalidated') throw new IntakeRejection('MATERIAL_CHANGED');
  await client.query(`INSERT INTO content_intake.write_attempts(actor_id,operation_id,action,candidate_id,candidate_version,
    candidate_digest,payload_digest,state,created_at) VALUES ($1,$2,'cancel',$3,$4,$5,$6,'pending',clock_timestamp())`,
  [actor.id, req.operationId, req.key.candidateId, req.key.version, req.key.digest, digest(canonical(req))]);
  if (c.state !== 'cancelled') await client.query(`UPDATE content_intake.candidate_versions SET state='cancelled',
    revocation_generation=revocation_generation+1,updated_at=clock_timestamp() WHERE candidate_id=$1 AND version=$2`, [req.key.candidateId, req.key.version]);
  await client.query("UPDATE content_intake.write_attempts SET state='cancelled' WHERE actor_id=$1 AND action='cancel' AND operation_id=$2", [actor.id, req.operationId]);
  return readCandidate(client, actor, req.key.candidateId, req.key.version, 'candidate-cancel');
}
