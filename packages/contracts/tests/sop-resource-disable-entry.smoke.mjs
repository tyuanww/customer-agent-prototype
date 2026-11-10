import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as legacy from '@customer-agent/contracts';
import * as unified from '@customer-agent/contracts/sop-unified';
import * as resource from '@customer-agent/contracts/sop-resource-disable';
import { generateContracts } from '../scripts/generate-contracts.mjs';
import { knowledgeFlow, queryRequest, requestId } from './sop-unified.fixtures.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const packageRoot = path.join(root, 'packages/contracts');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const request = { ...queryRequest, entitlement_id: 'synthetic-entitlement' };
const action = {
  entitlementId: 'synthetic-entitlement', releaseId: 'synthetic-release', contextGeneration: 1,
  key: knowledgeFlow.header.key, graphDigest: 'a'.repeat(64), nodeId: 'task-a',
  action: 'open', edgeId: null, entry: null, continuationId: `sct_${'b'.repeat(64)}`, queryRequestId: requestId,
};

function valid(name, value) {
  const result = resource.validateContractSchema(name, value);
  assert.equal(result.ok, true, JSON.stringify(result));
}

function rejected(name, value) {
  assert.equal(resource.validateContractSchema(name, value).ok, false, name);
}

test('the independent JS export compiles every one of the 306 schemas and preserves older validators', () => {
  assert.equal(resource.contractSchemaNames.length, 306);
  assert.equal(unified.contractSchemaNames.length, 128);
  assert.equal(legacy.contractSchemaNames.length, 246);
  for (const name of resource.contractSchemaNames) {
    assert.doesNotThrow(() => resource.validateContractSchema(name, null), name);
  }
  assert.notEqual(resource.ContractValidationError, unified.ContractValidationError);
  valid('MenokinSopQuerySopQueryRequest', request);
  rejected('MenokinSopQuerySopQueryRequest', queryRequest);
  assert.equal(unified.validateContractSchema('MenokinSopQuerySopQueryRequest', queryRequest).ok, true);
  assert.equal(unified.validateContractSchema('MenokinSopQuerySopQueryRequest', request).ok, false);
});

test('open requires the query UUID and other actions require null', () => {
  valid('IntakeSopActionCheck', action);
  rejected('IntakeSopActionCheck', { ...action, queryRequestId: null });
  rejected('IntakeSopActionCheck', { ...action, queryRequestId: 'not-a-uuid' });
  const { queryRequestId: _queryRequestId, ...missing } = action;
  rejected('IntakeSopActionCheck', missing);
  for (const operation of ['observe', 'back', 'next', 'choose', 'copy']) {
    const value = {
      ...action, action: operation, queryRequestId: null,
      edgeId: ['next', 'choose'].includes(operation) ? 'edge-a' : null,
      entry: operation === 'copy' ? { sourceId: 'synthetic-faq', businessEntryId: 'entry-a', scriptVersion: 1 } : null,
    };
    valid('IntakeSopActionCheck', value);
    rejected('IntakeSopActionCheck', { ...value, queryRequestId: requestId });
  }
});

test('Unicode scalar inputs preserve Chinese and emoji while rejecting NUL and lone surrogates', () => {
  for (const text of ['合成查询', '🦊😀', '中文😀合成']) {
    valid('MenokinSopQuerySopQueryRequest', { ...request, query_text: text, context_generation: text, product_context: { type: 'sku', ref: text } });
  }
  for (const text of ['bad\u0000value', '\uD800', '\uDFFF']) {
    rejected('MenokinSopQuerySopQueryRequest', { ...request, query_text: text });
    rejected('MenokinSopQuerySopQueryRequest', { ...request, context_generation: text });
    rejected('MenokinSopQuerySopQueryRequest', { ...request, product_context: { type: 'sku', ref: text } });
  }
  rejected('MenokinSopQuerySopQueryRequest', { ...request, entitlement_id: '' });
  rejected('MenokinSopQuerySopQueryRequest', { ...request, userId: 'forged' });
});

test('independent codegen preserves all ten older outputs byte for byte and checks the real five artifacts', async () => {
  const older = [
    ...['', 'sop-unified/'].flatMap(directory => ['openapi.generated.ts', 'runtime-schema.generated.ts', 'provenance.generated.ts', 'codegen-manifest.generated.json'].map(file => `src/generated/${directory}${file}`)),
    'openapi/bundle.generated.yaml', 'openapi/sop-unified/bundle.generated.yaml',
  ];
  const before = older.map(file => hash(readFileSync(path.join(packageRoot, file))));
  const generated = await generateContracts({ projectRoot: root, profile: 'sopResourceDisable', check: true });
  assert.equal(generated.schema_count, 306);
  assert.equal(generated.files.length, 5);
  assert.deepEqual(older.map(file => hash(readFileSync(path.join(packageRoot, file)))), before);
  assert.equal(resource.CONTRACT_PROVENANCE.contract_set_id, generated.contract_set_id);
  assert.equal(resource.CONTRACT_PROVENANCE.runtime_activated, false);
  for (const descriptor of Object.values(resource.CONTRACT_PROVENANCE.artifacts)) {
    const bytes = readFileSync(path.join(root, descriptor.path));
    assert.equal(bytes.length, descriptor.bytes);
    assert.equal(hash(bytes), descriptor.sha256);
  }
});

test('TypeScript consumers resolve the independent source entry and enforce new fields', () => {
  const directory = mkdtempSync(path.join(packageRoot, 'tests/.sop-resource-consumer-'));
  const compiler = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  const file = path.join(directory, 'consumer.ts');
  const options = [compiler, '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', file];
  const imports = `import type { components } from '@customer-agent/contracts/sop-resource-disable';\nimport { queryRequest } from '../sop-unified.fixtures.js';\n`;
  try {
    writeFileSync(file, `${imports}const value: components['schemas']['MenokinSopQuerySopQueryRequest'] = {...queryRequest, entitlement_id: 'synthetic-entitlement'}; void value;\n`);
    execFileSync(process.execPath, options, { cwd: packageRoot, stdio: 'pipe' });
    writeFileSync(file, `${imports}const value: components['schemas']['MenokinSopQuerySopQueryRequest'] = queryRequest; void value;\n`);
    const result = spawnSync(process.execPath, options, { cwd: packageRoot, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /entitlement_id/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
