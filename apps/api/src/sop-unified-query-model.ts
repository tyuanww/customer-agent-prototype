import type { components } from './content-intake/contract-view.js';
import { CONTRACT_PROVENANCE } from '@customer-agent/contracts/sop-unified';
import type { AuthenticatedUser } from './auth-service.js';
import type { SopQueryOperationFailure } from './sop-query-operation.js';

type C = components['schemas'];
export const SOP_UNIFIED_QUERY_CONTRACT_SET_ID = CONTRACT_PROVENANCE.contract_set_id;
export const SOP_QUERY_MAX_RESPONSE_BYTES = 1_048_576;
export type UnifiedSopQueryRequest = C['MenokinSopQuerySopQueryRequest'];
export type UnifiedSopQueryResponse = C['MenokinSopQuerySopQueryResponse'];
export type UnifiedSopReadyResult = C['MenokinSopQuerySopReadyResult'];
export type SopEntryPermission = C['MenokinSopQuerySopEntryPermission'];
export type SopQueryReasonCode = C['MenokinSopQuerySopReason']['code'];
export type SopGraph = {
  definition: C['IntakeSopFlowDefinition'];
  entries: UnifiedSopReadyResult['entries'];
  media: C['IntakeSopMedia'][];
};

export type UnifiedSopQueryOperation = {
  execute(input: { actor: AuthenticatedUser; request: UnifiedSopQueryRequest }):
    Promise<UnifiedSopQueryResponse | SopQueryOperationFailure>;
};
