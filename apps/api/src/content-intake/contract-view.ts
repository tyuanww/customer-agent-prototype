import { AsyncLocalStorage } from 'node:async_hooks';
import * as legacy from '@customer-agent/contracts';
import * as graph from '@customer-agent/contracts/sop-unified';

export type { components } from '@customer-agent/contracts/sop-unified';
import type { components } from '@customer-agent/contracts/sop-unified';
export type ContractSchemaName = keyof components['schemas'];
export const ContractValidationError: typeof legacy.ContractValidationError = legacy.ContractValidationError;
export const SOP_CONTRACT_SET = graph.CONTRACT_PROVENANCE.contract_set_id;
export const LEGACY_CONTRACT_SET = 'cs-ai-c11-openapi-1.24.0-schema-1.29-75e1889efee9';
export type IntakeView = 'legacy' | 'graph' | 'unsupported';
const context = new AsyncLocalStorage<IntakeView>();
export const intakeView = (): IntakeView => context.getStore() ?? 'legacy';
export const withIntakeView = <T>(view: IntakeView, work: () => T): T => context.run(view, work);
export function selectIntakeView(headers: readonly string[]): IntakeView {
  if (headers.length === 0) return 'legacy';
  if (headers.length !== 1) return 'unsupported';
  return headers[0] === SOP_CONTRACT_SET ? 'graph' : headers[0] === LEGACY_CONTRACT_SET ? 'legacy' : 'unsupported';
}
function graphSchema(name: ContractSchemaName): name is graph.ContractSchemaName {
  return graph.contractSchemaNames.includes(name as graph.ContractSchemaName);
}
export function parseContractSchema<Name extends ContractSchemaName>(name: Name, value: unknown): components['schemas'][Name] {
  const parsed = intakeView() === 'graph' && graphSchema(name)
    ? graph.parseContractSchema(name, value)
    : legacy.parseContractSchema(name as legacy.ContractSchemaName, value);
  return parsed as components['schemas'][Name];
}
export function validateContractSchema<Name extends ContractSchemaName>(name: Name, value: unknown):
  { ok: true; value: components['schemas'][Name] } | { ok: false; issues: readonly legacy.ContractValidationIssue[] } {
  const result = intakeView() === 'graph' && graphSchema(name) ? graph.validateContractSchema(name, value)
    : legacy.validateContractSchema(name as legacy.ContractSchemaName, value);
  return result as { ok: true; value: components['schemas'][Name] } | { ok: false; issues: readonly legacy.ContractValidationIssue[] };
}
