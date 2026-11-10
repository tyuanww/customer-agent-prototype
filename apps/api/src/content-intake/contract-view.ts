import { AsyncLocalStorage } from 'node:async_hooks';
import * as legacy from '@customer-agent/contracts';
import * as graph from '@customer-agent/contracts/sop-unified';
import * as resource from '@customer-agent/contracts/sop-resource-disable';

type GraphSchemas = graph.components['schemas'];
type ResourceSchemas = Omit<resource.components['schemas'], 'IntakeMaterial' | 'IntakeMaterialHeader'> & {
  IntakeMaterial: Omit<resource.components['schemas']['IntakeMaterial'], 'object' | 'entries'>
    & Pick<GraphSchemas['IntakeMaterial'], 'object' | 'entries'>;
  IntakeMaterialHeader: Omit<resource.components['schemas']['IntakeMaterialHeader'], 'object'>
    & Pick<GraphSchemas['IntakeMaterialHeader'], 'object'>;
};
type Schemas = { [Name in keyof GraphSchemas | keyof ResourceSchemas]:
  (Name extends keyof GraphSchemas ? GraphSchemas[Name] : never)
  | (Name extends keyof ResourceSchemas ? ResourceSchemas[Name] : never) };
export type components = { schemas: Schemas };
export type ContractSchemaName = keyof components['schemas'];
export function isContractValidationError(value: unknown): value is legacy.ContractValidationError
  | graph.ContractValidationError | resource.ContractValidationError {
  return value instanceof legacy.ContractValidationError || value instanceof graph.ContractValidationError
    || value instanceof resource.ContractValidationError;
}
export const SOP_CONTRACT_SET = graph.CONTRACT_PROVENANCE.contract_set_id;
export const RESOURCE_CONTRACT_SET = resource.CONTRACT_PROVENANCE.contract_set_id;
export const LEGACY_CONTRACT_SET = 'cs-ai-c11-openapi-1.24.0-schema-1.29-75e1889efee9';
export type IntakeView = 'legacy' | 'graph' | 'resource-disable' | 'unsupported';
const context = new AsyncLocalStorage<IntakeView>();
export const intakeView = (): IntakeView => context.getStore() ?? 'legacy';
export const withIntakeView = <T>(view: IntakeView, work: () => T): T => context.run(view, work);
export const isSopView = (view: IntakeView = intakeView()): boolean => view === 'graph' || view === 'resource-disable';
export const intakeContractSet = (): string => intakeView() === 'resource-disable' ? RESOURCE_CONTRACT_SET
  : intakeView() === 'graph' ? SOP_CONTRACT_SET : LEGACY_CONTRACT_SET;
export function selectIntakeView(headers: readonly string[]): IntakeView {
  if (headers.length === 0) return 'legacy';
  if (headers.length !== 1) return 'unsupported';
  return headers[0] === RESOURCE_CONTRACT_SET ? 'resource-disable'
    : headers[0] === SOP_CONTRACT_SET ? 'graph' : headers[0] === LEGACY_CONTRACT_SET ? 'legacy' : 'unsupported';
}
function graphSchema(name: ContractSchemaName): name is graph.ContractSchemaName {
  return graph.contractSchemaNames.includes(name as graph.ContractSchemaName);
}
export function parseContractSchema<Name extends ContractSchemaName>(name: Name, value: unknown): components['schemas'][Name] {
  const parsed = intakeView() === 'resource-disable' && resourceSchema(name)
    ? parseResourceSchema(name, value)
    : intakeView() === 'graph' && graphSchema(name)
    ? graph.parseContractSchema(name, value)
    : legacy.parseContractSchema(name as legacy.ContractSchemaName, value);
  return parsed as components['schemas'][Name];
}
export function validateContractSchema<Name extends ContractSchemaName>(name: Name, value: unknown):
  { ok: true; value: components['schemas'][Name] } | { ok: false; issues: readonly legacy.ContractValidationIssue[] } {
  try { return { ok: true, value: parseContractSchema(name, value) }; }
  catch (error) {
    if (!isContractValidationError(error)) throw error;
    return { ok: false, issues: error.issues };
  }
}
function resourceSchema(name: ContractSchemaName): name is resource.ContractSchemaName {
  return resource.contractSchemaNames.includes(name as resource.ContractSchemaName);
}

function parseResourceSchema(name: resource.ContractSchemaName, value: unknown): unknown {
  if (name === 'IntakeMaterial') {
    const material = resource.parseContractSchema(name, value);
    if (!Array.isArray(material.entries)) throw new resource.ContractValidationError(name, [{
      instancePath: '/entries', schemaPath: '#/properties/entries/type', keyword: 'type', message: 'must be array',
    }]);
    return { ...material, object: resource.parseContractSchema('IntakeObject', material.object),
      entries: material.entries.map(entry => resource.parseContractSchema('IntakeEntry', entry)) };
  }
  if (name === 'IntakeMaterialHeader') {
    const header = resource.parseContractSchema(name, value);
    return { ...header, object: resource.parseContractSchema('IntakeObject', header.object) };
  }
  return resource.parseContractSchema(name, value);
}

/** Decode the original publication policy independently of the requesting view. */
export function parsePublishedIntakeRisk(value: unknown) {
  if (value !== null && typeof value === 'object'
    && Reflect.get(value, 'policyVersion') === 'risk-sop-resource-disable-v1') {
    return resource.parseContractSchema('IntakeRisk', value);
  }
  return graph.parseContractSchema('IntakeRisk', value);
}
