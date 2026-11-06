import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { SopReleaseFacts } from '@customer-agent/content-intake';
import type { AuthenticatedUser } from '../auth-service.js';
import type { CanonicalJsonValue } from '../idempotency.js';
import { candidateContext, cancellationReceipt } from './candidate.js';
import { assertSnapshotPageable } from './material.js';
import { createIntakeTransactions, intakeReplay, IntakeRejection, type IntakeResult, type IntakeTransaction, type Reason } from './transaction.js';
import { adoptPreviews } from './linked-preview.js';

type C = components['schemas'];
type Run = ReturnType<typeof createIntakeTransactions>;
const receipt = (value: unknown) => parseContractSchema('IntakeReceipt',value);
const json = (value: unknown) => value as CanonicalJsonValue;

/** A decoded receipt is projected only after its transaction confirms success.
 * The same path repairs an unknown publication once its durable receipt is read;
 * the cache does not confer read authority or reconstruct missing image bytes. */
function projectPublishedPreviews(value: C['IntakeOperationReceipt']): void {
  if (value.action === 'publish' && value.state === 'published' && value.releaseId) {
    adoptPreviews(value.key.candidateId, value.releaseId);
  }
}

export type SopReleasePublication = Readonly<{
  releaseId: string;
  factsHash: string;
  indexHash: string;
  itemCount: number;
  state: 'inserted' | 'replayed';
}>;

/** This function must run in the same IntakeTransaction as content publication.
 * The SQL function writes entity rows and the immutable projection in that
 * transaction; a repeat with identical facts returns the original result. */
export async function publishSopReleaseFacts(
  client: Pick<IntakeTransaction, 'query'>,
  facts: SopReleaseFacts,
): Promise<SopReleasePublication> {
  const { rows } = await client.query<{ value: unknown }>(
    'SELECT content_intake.publish_sop_release_facts($1,$2::jsonb,$3::jsonb) AS value',
    [facts.releaseId, JSON.stringify(facts), JSON.stringify(facts.projection)],
  );
  const value = rows[0]?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IntakeRejection('MATERIAL_CHANGED');
  }
  const result = value as Record<string, unknown>;
  if (result.releaseId !== facts.releaseId
    || typeof result.factsHash !== 'string'
    || !/^[a-f0-9]{64}$/u.test(result.factsHash)
    || result.indexHash !== facts.projection.indexHash
    || result.itemCount !== facts.projection.itemCount
    || (result.state !== 'inserted' && result.state !== 'replayed')) {
    throw new IntakeRejection('MATERIAL_CHANGED');
  }
  return {
    releaseId: facts.releaseId,
    factsHash: result.factsHash,
    indexHash: facts.projection.indexHash,
    itemCount: facts.projection.itemCount,
    state: result.state,
  };
}

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
      if (prior) {
        projectPublishedPreviews(prior);
        return { ok:true,value:prior };
      }
      const result = await run(actor,'publish',json(req),req.operationId,async (client,who) => {
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
      if (result.ok) projectPublishedPreviews(result.value);
      return result;
    },
    async operationReceipt(actor: AuthenticatedUser, operationId: unknown, action: unknown) {
      const result = await run(actor,'operation-receipt',null,null,async (client,who) => {
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
      if (result.ok) projectPublishedPreviews(result.value);
      return result;
    },
  };
}
