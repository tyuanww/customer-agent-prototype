import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { AuthenticatedUser } from '../auth-service.js';
import type { CanonicalJsonValue } from '../idempotency.js';
import { candidateContext, cancellationReceipt } from './candidate.js';
import { assertSnapshotPageable } from './material.js';
import { createIntakeTransactions, intakeReplay, IntakeRejection, type IntakeResult, type Reason } from './transaction.js';
import { adoptPreviews } from './linked-preview.js';

type C = components['schemas'];
type Run = ReturnType<typeof createIntakeTransactions>;
const receipt = (value: unknown) => parseContractSchema('IntakeReceipt',value);
const json = (value: unknown) => value as CanonicalJsonValue;

/** The private DB publisher reports only existing typed rejection reasons. Other
 * SQL failures retain the transaction owner's diagnostics and certainty handling. */
const denials = new Set<Reason>(['FILE_LIMIT','MATERIAL_CHANGED','ALREADY_PUBLISHED','SCOPE_DENIED','MODE_CONFLICT','BASE_CHANGED',
  'APPROVAL_REVOKED','SOURCE_MISMATCH','APPROVAL_CHANGED','AWAITING_APPROVAL','PERMISSION_CHANGED','HUMAN_REVIEW_REQUIRED',
  'APPROVAL_UNAVAILABLE','TICKET_EXPIRED','TICKET_CONSUMED']);

/** Owns confirmed direct publication followed by one atomic local commit.
 * Tickets never leave the server. A lost COMMIT response is recovered under the
 * original operation; a replay is a historical receipt, not current read authority. */
export function createIntakePublication(run: Run) {
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
        if (c.view.publicationPolicy !== 'direct-v1') throw new IntakeRejection('MODE_CONFLICT');
        if (!req.title.trim()) throw new IntakeRejection('FILE_INVALID','VALIDATION');
        return { req, prior: null };
      },v => v as { req: C['IntakePublish']; prior: C['IntakeReceipt'] | null });
      if (!prepared.ok) return prepared;
      const { req,prior } = prepared.value;
      if (prior) return { ok:true,value:prior };
      return run(actor,'publish',json(req),req.operationId,async (client,who) => {
        try {
          const result = await client.query<{ value: { receipt: unknown; validUntil: string } }>(
            'SELECT content_intake.publish_candidate($1,$2::jsonb,$3::jsonb) AS value',
            [who.id,JSON.stringify(req),'null']);
          client.validUntil(Date.parse(result.rows[0]!.value.validUntil));
          const published = receipt(result.rows[0]!.value.receipt);
          // The additive rollback lineage is checked by the DB publication trigger.
          // Preserve its shortest approval deadline through the final COMMIT too.
          const inherited = await client.query<{ until: Date | null }>(`SELECT min(f.valid_until) AS until
            FROM content_intake.release_rollback_lineage l
            JOIN content_intake.approval_current c USING(review_request_id)
            JOIN content_intake.approval_facts f USING(review_request_id,facts_version)
            WHERE l.release_id=$1`, [published.releaseId]);
          if (inherited.rows[0]?.until) client.validUntil(inherited.rows[0].until.getTime());
          if (published.releaseId) adoptPreviews(req.key.candidateId, published.releaseId);
          return published;
        } catch (error) {
          if (error instanceof Error && 'code' in error && (error.code==='ZA001' || error.code==='ZA003' || error.code==='ZA005')
            && denials.has(error.message as Reason)) {
            // Resource authority can change after publish-prepare; keep the final
            // SQL rejection indistinguishable from an absent candidate.
            let code: C['IntakeFailure']['code'] = 'CONFLICT';
            if (error.code==='ZA001') code = 'VALIDATION';
            else if (error.code==='ZA005') code = error.message==='SCOPE_DENIED' ? 'NOT_FOUND' : 'FORBIDDEN';
            throw new IntakeRejection(error.message as Reason,code);
          }
          throw error;
        }
      },receipt);
    },
    operationReceipt(actor: AuthenticatedUser, operationId: unknown, action: unknown) {
      return run(actor,'operation-receipt',null,null,async (client,who) => {
        const op = parseContractSchema('IntakeId',operationId);
        if (action !== 'publish' && action !== 'cancel' && action !== 'rollback') throw new IntakeRejection('FILE_INVALID','VALIDATION');
        const saved = await client.query<{ response: unknown }>(`SELECT response FROM backend_review.receipts
          WHERE actor_user_id=$1 AND operation=$2 AND request_key=$3`,[who.userId,`intake:${action}`,op]);
        if (!saved.rows[0]) throw new IntakeRejection('COMMIT_UNKNOWN','NOT_FOUND');
        const result = action === 'cancel' ? cancellationReceipt(op,saved.rows[0].response)
          : parseContractSchema('IntakeOperationReceipt',saved.rows[0].response);
        if (result.operationId !== op || result.action !== action) throw new IntakeRejection('COMMIT_UNKNOWN');
        return result;
      },value => parseContractSchema('IntakeOperationReceipt',value));
    },
  };
}
