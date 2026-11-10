import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import * as formatsModule from 'ajv-formats';
import type { FormatsPlugin } from 'ajv-formats';

export type ContractValidationIssue = Readonly<{
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
}>;

export type SchemaValidationResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; issues: readonly ContractValidationIssue[] }>;

export class SchemaValidationError<Name extends string> extends Error {
  readonly code = 'CONTRACT_VALIDATION_FAILED';
  readonly schemaName: Name;
  readonly issues: readonly ContractValidationIssue[];

  constructor(schemaName: Name, issues: readonly ContractValidationIssue[]) {
    super(`Contract validation failed for ${schemaName}`);
    this.name = 'ContractValidationError';
    this.schemaName = schemaName;
    this.issues = Object.freeze([...issues]);
  }
}

const formatsPlugin: unknown = formatsModule.default ?? formatsModule;

function isFormatsPlugin(value: unknown): value is FormatsPlugin {
  return typeof value === 'function' && 'get' in value && typeof value.get === 'function';
}

const UNIQUE_BY_KEYWORD = 'x-unique-by';
const MAX_VALIDATION_ISSUES = 16;

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

function buildValidationRuntime(document: Readonly<Record<string, unknown>>, strictRequired: boolean): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: false,
    strict: true,
    strictTypes: false,
    strictRequired,
    validateFormats: true,
  });
  if (!isFormatsPlugin(formatsPlugin)) throw new TypeError('Invalid ajv-formats plugin');
  formatsPlugin(ajv);
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
  ajv.addSchema(document);
  return ajv;
}

/** Each generated view owns its lazy schema registry and validator cache. */
export function createContractRuntime<Schemas>(configuration: Readonly<{
  id: string;
  names: readonly (keyof Schemas & string)[];
  document: Readonly<Record<string, unknown>>;
  strictRequired?: boolean;
}>) {
  type Name = keyof Schemas & string;
  class ContractValidationError extends SchemaValidationError<Name> {}

  const names = Object.freeze([...configuration.names]);
  const nameSet = new Set<string>(names);
  const validators: { [Key in keyof Schemas]?: ValidateFunction<Schemas[Key]> } = {};
  let ajv: Ajv2020 | undefined;

  function getValidator<Key extends Name>(name: Key): ValidateFunction<Schemas[Key]> | undefined {
    if (!nameSet.has(name)) return undefined;
    ajv ??= buildValidationRuntime(configuration.document, configuration.strictRequired ?? true);
    const existing = Object.hasOwn(validators, name) ? validators[name] : undefined;
    if (existing) return existing;
    const validator = ajv.compile<Schemas[Key]>({
      $ref: `${configuration.id}#/$defs/${jsonPointerSegment(name)}`,
    });
    Object.defineProperty(validators, name, { value: validator, enumerable: true });
    return validator;
  }

  function validate<Key extends Name>(name: Key, value: unknown): SchemaValidationResult<Schemas[Key]> {
    const validator = getValidator(name);
    if (!validator) {
      return Object.freeze({
        ok: false,
        issues: Object.freeze([Object.freeze({
          instancePath: '', schemaPath: '', keyword: 'schema',
          message: 'unknown contract component schema',
        })]),
      });
    }
    if (validator(value)) return Object.freeze({ ok: true, value });
    return Object.freeze({
      ok: false,
      issues: Object.freeze((validator.errors ?? []).slice(0, MAX_VALIDATION_ISSUES).map(toIssue)),
    });
  }

  function parse<Key extends Name>(name: Key, value: unknown): Schemas[Key] {
    const result = validate(name, value);
    if (!result.ok) throw new ContractValidationError(name, result.issues);
    return result.value;
  }

  return Object.freeze({ names, validate, parse, ContractValidationError });
}
