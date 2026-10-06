import { randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { AuthenticatedUser } from '../auth-service.js';
import type { CanonicalJsonValue } from '../idempotency.js';
import { candidateContext } from './candidate.js';
import { assertSnapshotPageable } from './material.js';
import { createIntakeTransactions, intakeReplay, IntakeRejection, type IntakeResult, type Reason } from './transaction.js';

type C = components['schemas'];
type Run = ReturnType<typeof createIntakeTransactions>;
const receipt = (value: unknown) => parseContractSchema('IntakeReceipt',value);
const json = (value: unknown) => value as CanonicalJsonValue;

/** The private DB publisher reports only existing typed rejection reasons. Other
 * SQL failures retain the transaction owner's diagnostics and certainty handling. */
const denials = new Set<Reason>(['MATERIAL_CHANGED','ALREADY_PUBLISHED','SCOPE_DENIED','MODE_CONFLICT','BASE_CHANGED',
  'APPROVAL_REVOKED','SOURCE_MISMATCH','APPROVAL_CHANGED','AWAITING_APPROVAL','PERMISSION_CHANGED','HUMAN_REVIEW_REQUIRED',
  'APPROVAL_UNAVAILABLE','TICKET_EXPIRED','TICKET_CONSUMED']);

/** Owns the lock-free immediate observation followed by one atomic local commit.
 * Tickets never leave the server. A lost COMMIT response is recovered under the
 * original operation; a replay is a historical receipt, not current read authority. */
export function createIntakePublication(run: Run,
  refresh: (actor: AuthenticatedUser, request: unknown) => Promise<IntakeResult<C['IntakeReview']>>) {
  return {
    async publish(actor: AuthenticatedUser, raw: unknown): Promise<IntakeResult<C['IntakeReceipt']>> {
      const prepared = await run(actor,'publish-prepare',null,null,async (client,who) => {
        const req = parseContractSchema('IntakePublish',raw);
        const prior = await intakeReplay(client,who,'publish',json(req),req.operationId,receipt);
        if (prior) return { req, prior: prior.value };
        const c = await candidateContext(client,who,req.key,'publish',true);
        // Also guard durable candidates created before the reader's admission rule.
        assertSnapshotPageable(c.material.entries);
        if (c.material.baseReleaseId!==req.baseReleaseId) throw new IntakeRejection('BASE_CHANGED');
        if (c.view.sourceEvidenceVersion!==req.sourceEvidenceVersion) throw new IntakeRejection('SOURCE_MISMATCH');
        if (c.view.approvalEvidenceVersion!==req.approvalEvidenceVersion) throw new IntakeRejection('APPROVAL_CHANGED');
        if (!req.title.trim()) throw new IntakeRejection('FILE_INVALID','VALIDATION');
        return { req, prior: null };
      },v => v as { req: C['IntakePublish']; prior: C['IntakeReceipt'] | null });
      if (!prepared.ok) return prepared;
      const { req,prior } = prepared.value;
      if (prior) return { ok:true,value:prior };
      // Fresh internal refresh key: never replay an old observation just because
      // the caller retries its publish operation after a confirmed rollback.
      const observed = await refresh(actor,{ operationId:`publish-check_${randomUUID()}`,key:req.key,
        expectedEvidenceVersion:req.approvalEvidenceVersion });
      if (!observed.ok) return observed;
      return run(actor,'publish',json(req),req.operationId,async (client,who) => {
        try {
          const result = await client.query<{ value: { receipt: unknown; validUntil: string } }>(
            'SELECT content_intake.publish_candidate($1,$2::jsonb,$3::jsonb) AS value',
            [who.id,JSON.stringify(req),JSON.stringify(observed.value)]);
          client.validUntil(Date.parse(result.rows[0]!.value.validUntil));
          return receipt(result.rows[0]!.value.receipt);
        } catch (error) {
          if (error instanceof Error && 'code' in error && (error.code==='ZA003' || error.code==='ZA005')
            && denials.has(error.message as Reason)) throw new IntakeRejection(error.message as Reason,error.code==='ZA005'?'FORBIDDEN':'CONFLICT');
          throw error;
        }
      },receipt);
    },
    publicationReceipt(actor: AuthenticatedUser, operationId: unknown) {
      return run(actor,'publication-receipt',null,null,async (client,who) => {
        const op = parseContractSchema('IntakeId',operationId);
        const saved = await client.query<{ response: unknown }>(`SELECT response FROM backend_review.receipts
          WHERE actor_user_id=$1 AND operation='intake:publish' AND request_key=$2`,[who.userId,op]);
        if (!saved.rows[0]) throw new IntakeRejection('COMMIT_UNKNOWN','NOT_FOUND');
        return receipt(saved.rows[0].response);
      },receipt);
    },
  };
}
