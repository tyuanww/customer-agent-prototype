import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import * as formatsModule from 'ajv-formats';
import type { FormatsPlugin } from 'ajv-formats';
import type { components } from './generated/openapi.generated.js';
import {
  COMPONENT_SCHEMA_NAMES,
  OPENAPI_RUNTIME_SCHEMA_DOCUMENT,
  OPENAPI_RUNTIME_SCHEMA_ID,
  type GeneratedComponentSchemaName,
} from './generated/runtime-schema.generated.js';

export type ContractSchemaName = keyof components['schemas'] & GeneratedComponentSchemaName;
export type ContractSchemaValue<Name extends ContractSchemaName> = components['schemas'][Name];

export type ContractValidationIssue = Readonly<{
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
}>;

export type ContractValidationResult<Name extends ContractSchemaName> =
  | Readonly<{ ok: true; value: ContractSchemaValue<Name> }>
  | Readonly<{ ok: false; issues: readonly ContractValidationIssue[] }>;

const addFormats = (formatsModule.default ?? formatsModule) as unknown as FormatsPlugin;
const UNIQUE_BY_KEYWORD = 'x-unique-by';
const MAX_VALIDATION_ISSUES = 16;

type ValidationRuntime = Readonly<{
  ajv: Ajv2020;
  validators: Map<string, ValidateFunction>;
}>;

let validationRuntime: ValidationRuntime | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function scalarIdentity(value: unknown): string | undefined {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return `${typeof value}:${String(value)}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `number:${String(value)}`;
  }
  return undefined;
}

function hasUniquePropertyValues(propertyName: string | string[], items: unknown[]): boolean {
  const properties = typeof propertyName === 'string' ? [propertyName] : propertyName;
  const seen = new Set<string>();
  for (const item of items) {
    if (!isRecord(item) || !properties.every((name) => Object.hasOwn(item, name))) {
      continue;
    }
    const values = properties.map((name) => scalarIdentity(item[name]));
    // Tuple encoding preserves boundaries even when string values contain separators.
    const identity = JSON.stringify(values);
    if (values.includes(undefined) || seen.has(identity)) {
      return false;
    }
    seen.add(identity);
  }
  return true;
}

function toIssue(error: ErrorObject): ContractValidationIssue {
  return Object.freeze({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? 'contract validation failed',
  });
}

function jsonPointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function buildValidationRuntime(): ValidationRuntime {
  const ajv = new Ajv2020({
    allErrors: false,
    strict: true,
    strictTypes: false,
    validateFormats: true,
  });
  addFormats(ajv);
  ajv.addFormat('binary', { type: 'string', validate: () => true });
  ajv.addFormat('double', { type: 'number', validate: Number.isFinite });
  ajv.addKeyword({
    keyword: UNIQUE_BY_KEYWORD,
    type: 'array',
    schemaType: ['string', 'array'],
    metaSchema: { anyOf: [
      { type: 'string', minLength: 1 },
      { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 } },
    ] },
    errors: false,
    validate: hasUniquePropertyValues,
  });
  ajv.addSchema(OPENAPI_RUNTIME_SCHEMA_DOCUMENT);
  return Object.freeze({ ajv, validators: new Map<string, ValidateFunction>() });
}

const componentSchemaNameSet = new Set<string>(COMPONENT_SCHEMA_NAMES);

function getValidator(name: string): ValidateFunction | undefined {
  if (!componentSchemaNameSet.has(name)) {
    return undefined;
  }
  validationRuntime ??= buildValidationRuntime();
  const existing = validationRuntime.validators.get(name);
  if (existing) {
    return existing;
  }
  const validator = validationRuntime.ajv.compile({
    $ref: `${OPENAPI_RUNTIME_SCHEMA_ID}#/$defs/${jsonPointerSegment(name)}`,
  });
  validationRuntime.validators.set(name, validator);
  return validator;
}

export const contractSchemaNames: readonly ContractSchemaName[] = Object.freeze(
  [...COMPONENT_SCHEMA_NAMES] as ContractSchemaName[],
);

export function validateContractSchema<Name extends ContractSchemaName>(
  name: Name,
  value: unknown,
): ContractValidationResult<Name> {
  const validator = getValidator(name);
  if (!validator) {
    return Object.freeze({
      ok: false,
      issues: Object.freeze([
        Object.freeze({
          instancePath: '',
          schemaPath: '',
          keyword: 'schema',
          message: 'unknown contract component schema',
        }),
      ]),
    });
  }
  if (validator(value)) {
    return Object.freeze({ ok: true, value: value as ContractSchemaValue<Name> });
  }
  return Object.freeze({
    ok: false,
    issues: Object.freeze((validator.errors ?? []).slice(0, MAX_VALIDATION_ISSUES).map(toIssue)),
  });
}

export class ContractValidationError extends Error {
  readonly code = 'CONTRACT_VALIDATION_FAILED';
  readonly schemaName: ContractSchemaName;
  readonly issues: readonly ContractValidationIssue[];

  constructor(schemaName: ContractSchemaName, issues: readonly ContractValidationIssue[]) {
    super(`Contract validation failed for ${schemaName}`);
    this.name = 'ContractValidationError';
    this.schemaName = schemaName;
    this.issues = Object.freeze([...issues]);
  }
}

export function parseContractSchema<Name extends ContractSchemaName>(
  name: Name,
  value: unknown,
): ContractSchemaValue<Name> {
  const result = validateContractSchema(name, value);
  if (!result.ok) {
    throw new ContractValidationError(name, result.issues);
  }
  return result.value;
}
