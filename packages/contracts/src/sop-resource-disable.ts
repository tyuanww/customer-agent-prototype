import type { components } from './generated/sop-resource-disable/openapi.generated.js';
import {
  COMPONENT_SCHEMA_NAMES,
  OPENAPI_RUNTIME_SCHEMA_DOCUMENT,
  OPENAPI_RUNTIME_SCHEMA_ID,
  type GeneratedComponentSchemaName,
} from './generated/sop-resource-disable/runtime-schema.generated.js';
import { createContractRuntime, SchemaValidationError, type SchemaValidationResult } from './runtime-engine.js';

export type * from './generated/sop-resource-disable/openapi.generated.js';
export { CONTRACT_PROVENANCE } from './generated/sop-resource-disable/provenance.generated.js';
export type { ContractValidationIssue } from './runtime-engine.js';
export type ContractSchemaName = keyof components['schemas'] & GeneratedComponentSchemaName;
export type ContractSchemaValue<Name extends ContractSchemaName> = components['schemas'][Name];
export type ContractValidationResult<Name extends ContractSchemaName> = SchemaValidationResult<ContractSchemaValue<Name>>;

const runtime = createContractRuntime<components['schemas']>({
  id: OPENAPI_RUNTIME_SCHEMA_ID,
  names: COMPONENT_SCHEMA_NAMES,
  document: OPENAPI_RUNTIME_SCHEMA_DOCUMENT,
  // The schema requires fields declared in an enclosing branch. AJV's lint
  // cannot follow those declarations, while JSON Schema required still applies.
  strictRequired: false,
});

export const contractSchemaNames: readonly ContractSchemaName[] = runtime.names;
export const validateContractSchema: <Name extends ContractSchemaName>(
  name: Name, value: unknown,
) => ContractValidationResult<Name> = runtime.validate;
export const parseContractSchema: <Name extends ContractSchemaName>(
  name: Name, value: unknown,
) => ContractSchemaValue<Name> = runtime.parse;
export const ContractValidationError: typeof SchemaValidationError<ContractSchemaName> = runtime.ContractValidationError;
export type ContractValidationError = SchemaValidationError<ContractSchemaName>;
