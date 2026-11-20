import type { components } from './generated/sop-candidates/openapi.generated.js';
import { CONTRACT_PROVENANCE } from './generated/sop-candidates/provenance.generated.js';
import {
  COMPONENT_SCHEMA_NAMES,
  OPENAPI_RUNTIME_SCHEMA_DOCUMENT,
  OPENAPI_RUNTIME_SCHEMA_ID,
} from './generated/sop-candidates/runtime-schema.generated.js';
import { createContractRuntime } from './runtime-engine.js';

type Schemas = components['schemas'];

export const SOP_CANDIDATE_CONTRACT_SET_ID = CONTRACT_PROVENANCE.contract_set_id;
export type SopCandidateDiscoverRequest = Schemas['W5SopCandidateDiscoverRequest'];
export type SopCandidateDiscoverResponse = Schemas['W5SopCandidateDiscoverResponse'];
export type SopCandidateSelectRequest = Schemas['W5SopCandidateSelectRequest'];

const runtime = createContractRuntime<Schemas>({
  id: OPENAPI_RUNTIME_SCHEMA_ID,
  names: COMPONENT_SCHEMA_NAMES,
  document: OPENAPI_RUNTIME_SCHEMA_DOCUMENT,
});

export const validateContractSchema = runtime.validate;
export const parseContractSchema = runtime.parse;
