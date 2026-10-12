import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { AuthenticatedUser } from '../../src/auth-service.js';
import { createIntakeTransactions, IntakeRejection, type IntakePool } from '../../src/content-intake/transaction.js';
import { candidateContext, readCandidate } from '../../src/content-intake/candidate.js';
import { retainPreviewRowsAtVersion } from '../../src/content-intake/linked-preview.js';

type Candidate = components['schemas']['IntakeCandidate'];
type Key = Candidate['key'];
type Receipt = { candidate: Candidate; rowIds: string[]; inputObjectId: string };
const rowIdPattern = /^sop:[^:]{1,128}:[1-9][0-9]{0,3}$/;
function receipt(value: unknown): Receipt {
  if (!value || typeof value !== 'object' || !('candidate' in value) || !('rowIds' in value) || !('inputObjectId' in value)
    || !Array.isArray(value.rowIds) || value.rowIds.length > 5000
    || value.rowIds.some(id => typeof id !== 'string' || !rowIdPattern.test(id))) throw new Error('INVALID_SOP_DELETION_RECEIPT');
  return { candidate: parseContractSchema('IntakeCandidate', value.candidate), rowIds: value.rowIds,
    inputObjectId: parseContractSchema('IntakeId', value.inputObjectId) };
}
export type DeleteSopRow = { operationId: string; key: Key; rowId: string };
/** DRAFT consumer, excluded from API build and HTTP registration. The successor
 * must replace the media-only 204 command with a versioned, replayable response.
 * Never accept actor/principal identity from its request body. */
export function createSopRowDeletionCandidate(pool: IntakePool, requireProductSession = true, report?: (id: string, error: unknown) => void) {
  const run = createIntakeTransactions(pool, report, { requireProductSession });
  return async (actor: AuthenticatedUser, raw: DeleteSopRow) => {
    const result = await run(actor, 'sop-row-delete-v2', raw, raw?.operationId, async (client, who) => {
      if (!raw || Object.keys(raw).sort().join(',') !== 'key,operationId,rowId'
        || typeof raw.rowId !== 'string' || !rowIdPattern.test(raw.rowId)) {
        throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
      }
      parseContractSchema('IntakeId', raw.operationId);
      const key = parseContractSchema('IntakeCandidateKey', raw.key);
      const context = await candidateContext(client, who, key, 'candidate-cancel', true);
      try {
        const rows = await client.query<{ value: { key: Key; validUntil: string; rowIds: string[] } }>(
          'SELECT content_intake.revise_unused_sop_row($1,$2,$3,$4,$5) AS value',
          [who.id, key.candidateId, key.version, key.digest, raw.rowId]);
        const value = rows.rows[0]!.value;
        client.validUntil(Date.parse(value.validUntil));
        return { candidate: await readCandidate(client, who, value.key.candidateId, value.key.version, 'candidate-cancel'),
          rowIds: value.rowIds, inputObjectId: context.material.object.objectId };
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ZA003') {
          const reason = error.message;
          if (reason === 'SCOPE_DENIED') throw new IntakeRejection(reason, 'NOT_FOUND');
          if (reason === 'ALREADY_PUBLISHED' || reason === 'MATERIAL_CHANGED' || reason === 'COMMIT_UNKNOWN'
            || reason === 'SOURCE_MISMATCH' || reason === 'BASE_CHANGED') throw new IntakeRejection(reason);
        }
        throw error;
      }
    }, receipt);
    // Alias mutation only after confirmed commit or its durable replay. Pending
    // and unknown results must not hide images from a still-live candidate.
    if (!result.ok) return result;
    const { candidate, rowIds, inputObjectId } = result.value;
    retainPreviewRowsAtVersion(candidate.key.candidateId, rowIds, candidate.key.version, inputObjectId);
    return { ok: true as const, value: candidate };
  };
}
