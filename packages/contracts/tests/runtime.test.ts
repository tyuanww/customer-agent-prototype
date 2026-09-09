import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_PROVENANCE,
  ContractValidationError,
  contractSchemaNames,
  parseContractSchema,
  validateContractSchema,
  type ContractSchemaName,
} from '../src/index.js';
import { OPENAPI_RUNTIME_SCHEMA_DOCUMENT } from '../src/generated/runtime-schema.generated.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validSearchRequest = Object.freeze({
  query_id: '5a5d8ff9-a23e-4c04-b902-64d0e33502cf',
  parent_query_id: null,
  interaction_reason: 'original',
  query_text: '退款进度',
  collection_mode: 'synthetic',
  detected_platform: 'qianniu',
  platform: 'qianniu',
  platform_source: 'manual',
  product_context_type: null,
  product_context_ref: null,
  top_k: 3,
});
const duplicateSourceBindings = Object.freeze([
  Object.freeze({ domain: 'presale', source_version_id: 'srcv_a' }),
  Object.freeze({ domain: 'presale', source_version_id: 'srcv_b' }),
]);
const duplicateSourceBindingStatuses = Object.freeze([
  Object.freeze({ domain: 'presale', source_version_id: 'srcv_a', source_ref: 'SRC-A' }),
  Object.freeze({ domain: 'presale', source_version_id: 'srcv_b', source_ref: 'SRC-B' }),
]);

describe('generated customer-agent runtime contracts', () => {
  it('keeps generated artifacts byte-for-byte reproducible', () => {
    expect(() => execFileSync(
      process.execPath,
      ['scripts/generate-contracts.mjs', '--check'],
      { cwd: packageRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    )).not.toThrow();
  });

  it('binds validators to the verified inactive contract set', () => {
    expect(CONTRACT_PROVENANCE).toMatchObject({
      contract_set_id: 'cs-ai-c11-openapi-1.13.0-schema-1.16-6f7d18e59f2e',
      source_git_sha: '6f7d18e59f2e8b510daa23a3d606163227350a40',
      openapi_sha256: 'c3c14659261ed01ff4f0c187026601844f59d3cd26be605a34f647bc130cc94c',
      database_sha256: '0db44d4d44e968b24e90dda8bcd26a077dd33395ff5a31efb38d085254d4c44f',
      intake_status: 'VERIFIED_NOT_ACTIVATED',
      runtime_activated: false,
    });
    const runtimeDefinitions = (OPENAPI_RUNTIME_SCHEMA_DOCUMENT as {
      $defs: Record<string, unknown>;
    }).$defs;
    expect(contractSchemaNames).toHaveLength(150);
    expect(CONTRACT_PROVENANCE.component_schema_count).toBe(150);
    expect(Object.keys(runtimeDefinitions)).toEqual([...contractSchemaNames]);
    expect(runtimeDefinitions).toMatchObject({
      FileImportRequest: {
        properties: { source_bindings: { 'x-unique-by': 'domain' } },
      },
      FeishuImportRequest: {
        properties: { source_bindings: { 'x-unique-by': 'domain' } },
      },
      ImportStatusResponseBase: {
        properties: { source_bindings: { 'x-unique-by': 'domain' } },
      },
    });
  });

  it('compiles every generated component schema on demand', () => {
    expect(() => {
      for (const name of contractSchemaNames) {
        validateContractSchema(name, null);
      }
    }).not.toThrow();
  });

  it('rejects repeated quality identities while allowing distinct tuples', () => {
    const item = { script_id: 'SYN-A', content_hash: 'a'.repeat(64), defect: false };
    const envelope = { review_revision: 'b'.repeat(64), phase: 'initial', evidence_id: 'EVD-SYNTHETIC' };
    for (const other of [{ ...item, content_hash: 'c'.repeat(64) }, { ...item, script_id: 'SYN-B' }]) {
      expect(validateContractSchema('QualityEvidence', { ...envelope, checks: [item, other] }).ok).toBe(true);
    }
    const result = validateContractSchema('QualityEvidence', { ...envelope, checks: [item, { ...item, defect: true }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.keyword).toBe('x-unique-by');
  });

  it('accepts a contract-valid search request' , () => {
    expect(validateContractSchema('SearchRequest', validSearchRequest)).toEqual({
      ok: true,
      value: validSearchRequest,
    });
  });

  it.each([
    ['unknown fields', { ...validSearchRequest, unexpected: 'forbidden' }],
    ['an original request with a parent', {
      ...validSearchRequest,
      parent_query_id: '68cc44fb-3d14-4860-a765-e882754d66d7',
    }],
    ['an unpaired product context', {
      ...validSearchRequest,
      product_context_type: 'category',
      product_context_ref: null,
    }],
  ])('rejects %s without mutating the payload', (_label, payload) => {
    const before = structuredClone(payload);
    const result = validateContractSchema('SearchRequest', payload);

    expect(result.ok).toBe(false);
    expect(payload).toEqual(before);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(JSON.stringify(result.issues)).not.toContain('退款进度');
    }
  });

  it('enforces the adoption discriminated union', () => {
    expect(validateContractSchema('AdoptionEventRequest', {
      query_id: validSearchRequest.query_id,
      outcome: 'adopted',
      chosen_rank: 1,
      chosen_script_id: 'script-001',
      push_method: 'clipboard',
    }).ok).toBe(true);

    expect(validateContractSchema('AdoptionEventRequest', {
      query_id: validSearchRequest.query_id,
      outcome: 'adopted',
      chosen_rank: null,
      chosen_script_id: null,
      push_method: null,
    }).ok).toBe(false);
  });

  it.each([
    ['FileImportRequest', {
      file: 'fixture.csv',
      source_bindings: duplicateSourceBindings,
    }],
    ['FeishuImportRequest', {
      source_type: 'feishu_api',
      source_bindings: duplicateSourceBindings,
    }],
    ['ImportStatusResponseBase', {
      import_batch_id: 'batch-001',
      status: 'validating',
      base_release_id: null,
      source_binding_hash: 'a'.repeat(64),
      source_bindings: duplicateSourceBindingStatuses,
      error_report: null,
      staged_count: 0,
      clean_count: 0,
      quarantined_count: 0,
      quality_gate_passed: false,
      quality_review: null,
      preview: [],
    }],
  ] as const)('rejects duplicate source domains in %s', (schemaName, payload) => {
    const result = validateContractSchema(schemaName as ContractSchemaName, payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({ keyword: 'x-unique-by' }));
    }
  });

  it('fails closed for unknown runtime schema names and bounds diagnostics', () => {
    const unknown = validateContractSchema('MissingSchema' as ContractSchemaName, {});
    expect(unknown).toEqual({
      ok: false,
      issues: [{
        instancePath: '',
        schemaPath: '',
        keyword: 'schema',
        message: 'unknown contract component schema',
      }],
    });

    const invalid = validateContractSchema('SearchRequest', {
      ...validSearchRequest,
      ...Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`extra_${index}`, index])),
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.issues.length).toBeLessThanOrEqual(16);
    }
  });

  it('returns valid payloads from strict parse boundaries', () => {
    expect(parseContractSchema('SearchRequest', validSearchRequest)).toBe(validSearchRequest);
  });

  it('throws a scrubbed typed error at strict parse boundaries', () => {
    expect(() => parseContractSchema('SearchRequest', {
      ...validSearchRequest,
      query_text: '',
    })).toThrow(ContractValidationError);

    let caught: unknown;
    try {
      parseContractSchema('SearchRequest', {
        ...validSearchRequest,
        query_text: 'secret-body',
        unexpected: 'secret-body',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContractValidationError);
    expect(JSON.stringify(caught)).not.toContain('secret-body');
  });
});
