import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { AuthenticatedUser } from '../auth-service.js';
import type { CanonicalJsonValue } from '../idempotency.js';
import { candidateContext, historicalCandidate, syncCandidateReadiness } from './candidate.js';
import { clock, createIntakeTransactions, IntakeRejection, type IntakeTransaction, type IntakeResult } from './transaction.js';
import type { CandidateReviewBinding as ReviewBinding } from './approval-adapter.js';

type C = components['schemas'];
type Run = ReturnType<typeof createIntakeTransactions>;
const json = (v: unknown) => v as CanonicalJsonValue;
const review = (v: unknown) => parseContractSchema('IntakeReview', v);
type Facts = { facts_version: string; revocation_generation: string; state: 'pending' | 'approved' | 'rejected' | 'revoked';
  checked_at: Date; valid_until: Date; reviewer_id: string | null; human_task_id: string | null; decided_at: Date | null };

async function binding(client: IntakeTransaction, id: string): Promise<ReviewBinding> {
  const rows = await client.query<{ value: unknown }>(`SELECT jsonb_build_object('reviewRequestId',r.review_request_id,
    'key',jsonb_build_object('candidateId',r.candidate_id,'version',r.candidate_version,'digest',r.candidate_digest),
    'evidenceVersion',r.evidence_version,'tenantId',r.tenant_id,'appId',r.app_id,'definitionId',r.definition_id,
    'nodeId',r.node_id,'createUuid',r.create_uuid,'packageObjectId',r.package_object_id,'packageSha256',r.package_sha256,
    'packageBytes',o.bytes,'createdAt',o.received_at,'instanceCode',r.instance_code,'attachmentFileCode',r.attachment_file_code) AS value
    FROM content_intake.review_bindings r JOIN content_intake.objects o ON o.object_id=r.package_object_id WHERE review_request_id=$1`, [id]);
  if (!rows.rows[0]) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  return rows.rows[0].value as ReviewBinding;
}
async function facts(client: IntakeTransaction, b: ReviewBinding): Promise<Facts | null> {
  const rows = await client.query<Facts>(`SELECT f.* FROM content_intake.approval_current p JOIN content_intake.approval_facts f
    ON f.review_request_id=p.review_request_id AND f.facts_version=p.facts_version WHERE p.review_request_id=$1`, [b.reviewRequestId]);
  return rows.rows[0] ?? null;
}
async function reviewView(client: IntakeTransaction, b: ReviewBinding): Promise<C['IntakeReview']> {
  const f = await facts(client, b);
  const now = await clock(client);
  let state: C['IntakeReview']['state'] = 'unavailable';
  if (!b.instanceCode) state='creating';
  else if (f?.state === 'revoked') state='revoked';
  else if (f && f.checked_at.getTime()<=now && now<f.valid_until.getTime()) state=f.state;
  return review({ key: b.key, reviewRequestId: b.reviewRequestId, instanceCode: b.instanceCode, evidenceVersion: b.evidenceVersion,
    revocationGeneration: Number(f?.revocation_generation ?? 0),state,
    checkedAt: f?.checked_at.toISOString() ?? null, validUntil: f?.valid_until.toISOString() ?? null,
    reviewPackageObjectId: b.packageObjectId, reviewPackageSha256: b.packageSha256 });
}
async function currentBinding(client: IntakeTransaction, key: C['IntakeCandidateKey'], version: number): Promise<ReviewBinding> {
  const rows = await client.query<{ review_request_id: string }>(`SELECT review_request_id FROM content_intake.review_bindings
    WHERE candidate_id=$1 AND candidate_version=$2 AND candidate_digest=$3 AND evidence_version=$4`, [key.candidateId,key.version,key.digest,version]);
  if (!rows.rows[0]) throw new IntakeRejection('AWAITING_APPROVAL');
  return binding(client, rows.rows[0].review_request_id);
}

/** Owns source confirmation and read-only legacy approval history. The direct
 * profile never creates packages, observes a provider or renews approval facts. */
export function createIntakeEvidence(run: Run) {
  const unavailable = (actor: AuthenticatedUser, raw: unknown) => run(actor, 'review-disabled', null, null, async (client, who) => {
    const req = parseContractSchema('IntakeReviewRequest', raw);
    await candidateContext(client, who, req.key, 'content-manage');
    throw new IntakeRejection('MODE_CONFLICT');
  }, review);
  return {
    async confirmSource(actor: AuthenticatedUser, raw: unknown): Promise<IntakeResult<C['IntakeCandidate']>> {
      // Keep the human reason in the permanent private receipt alongside its result.
      // The frozen upstream source_confirmations table has no reason column.
      const result = await run(actor, 'source-confirm', json(raw), typeof raw === 'object' && raw !== null && typeof Reflect.get(raw,'operationId') === 'string'
        ? Reflect.get(raw,'operationId') as string : null, async (client, who) => {
        const req = parseContractSchema('IntakeSourceConfirmation', raw);
        const { view, material } = await candidateContext(client, who, req.key, 'source-confirm', true);
        if (view.sourceEvidenceVersion !== req.expectedEvidenceVersion) throw new IntakeRejection('SOURCE_MISMATCH');
        if (material.object.sha256 !== req.objectSha256 || material.sourceClaim.acquisition !== req.acquisition) throw new IntakeRejection('SOURCE_MISMATCH');
        if (!req.reason.trim() || !req.confirmedVersionValue.trim()) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
        if (req.confirmedVersionKind === 'integer') {
          if (!/^(0|[1-9][0-9]{0,18})$/u.test(req.confirmedVersionValue)) throw new IntakeRejection('SOURCE_ORDER_UNKNOWN', 'VALIDATION');
          const newer = await client.query(`SELECT 1 FROM content_intake.source_confirmations e
            JOIN content_intake.candidate_versions c ON c.candidate_id=e.candidate_id AND c.version=e.candidate_version AND c.source_evidence_version=e.evidence_version
            JOIN content_intake.publications p ON p.candidate_id=c.candidate_id AND p.candidate_version=c.version
            WHERE e.source_id=$1 AND e.version_kind='integer'
              AND (e.version_value::numeric>$2::numeric OR (e.version_value::numeric=$2::numeric AND e.object_sha256<>$3))`,
          [view.sourceId,req.confirmedVersionValue,req.objectSha256]);
          if (newer.rowCount) throw new IntakeRejection('SOURCE_MISMATCH');
        }
        await client.query(`INSERT INTO content_intake.source_confirmations(candidate_id,candidate_version,candidate_digest,source_id,
          evidence_version,revocation_generation,version_kind,version_value,acquisition,confirmed_by,confirmed_at,object_sha256)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp(),$11)`, [req.key.candidateId,req.key.version,req.key.digest,view.sourceId,
          view.sourceEvidenceVersion+1,view.revocationGeneration+1,req.confirmedVersionKind,req.confirmedVersionValue,req.acquisition,who.id,req.objectSha256]);
        await client.query(`UPDATE content_intake.candidate_versions SET source_evidence_version=source_evidence_version+1,
          revocation_generation=revocation_generation+1,updated_at=clock_timestamp() WHERE candidate_id=$1 AND version=$2`, [req.key.candidateId,req.key.version]);
        return { candidate: await syncCandidateReadiness(client,who,req.key,'source-confirm'), reason: req.reason };
      }, value => {
        const v = value as { candidate: unknown; reason: string };
        return { candidate: historicalCandidate(v.candidate), reason: v.reason };
      });
      return result.ok ? { ok: true, value: result.value.candidate } : result;
    },
    review(actor: AuthenticatedUser, rawKey: unknown) {
      return run(actor,'review-read',null,null,async (client,who) => {
        const key = parseContractSchema('IntakeCandidateKey',rawKey);
        const c = await candidateContext(client,who,key,'content-manage');
        return reviewView(client,await currentBinding(client,key,c.view.approvalEvidenceVersion));
      },review);
    },
    requestReview: unavailable,
    refreshReview: unavailable,
  };
}
