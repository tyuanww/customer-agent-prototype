import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parse } from 'yaml';
import * as legacy from '@customer-agent/contracts';
import * as unified from '@customer-agent/contracts/sop-unified';
import { buildGeneratedArtifacts, generateContracts, sopUnifiedDocument } from '../scripts/generate-contracts.mjs';
import {
  entryRef, faqEntry, knowledgeFlow, permission, queryRequest, queryResponses, ready, readyDigest, scriptFlow,
} from './sop-unified.fixtures.ts';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(packageRoot, '../..');
const upstream = path.join(projectRoot, 'contracts/upstream/customer-agent');
const sourceLock = JSON.parse(readFileSync(path.join(upstream, 'sop-unified-corrected-contract-set.lock.json'), 'utf8'));
const contractId = sourceLock.contract_set_id;
const sourceSha = sourceLock.source_git_sha;
const sourceManifest = JSON.parse(readFileSync(path.join(upstream, contractId, 'contract-set.json'), 'utf8'));
const sourcePath = path.join(upstream, contractId, 'openapi.v1.yaml');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function checkRejected(name, value) {
  const before = structuredClone(value);
  const result = unified.validateContractSchema(name, value);
  assert.equal(result.ok, false, name);
  assert.deepEqual(value, before);
  assert.ok(result.issues.length > 0 && result.issues.length <= 16);
  assert.ok(!JSON.stringify(result.issues).includes('forged-sensitive-value'));
  assert.throws(() => unified.parseContractSchema(name, value), unified.ContractValidationError);
}

test('public SOP unified entry compiles every component and preserves both registries', () => {
  assert.equal(unified.contractSchemaNames.length, 79);
  assert.equal(legacy.contractSchemaNames.length, 246);
  assert.notEqual(unified.ContractValidationError, legacy.ContractValidationError);
  for (const name of unified.contractSchemaNames) assert.doesNotThrow(() => unified.validateContractSchema(name, null));
  for (const name of legacy.contractSchemaNames) assert.doesNotThrow(() => legacy.validateContractSchema(name, null));
  assert.equal(legacy.contractSchemaNames.includes('IntakeSopFlowDefinition'), false);
  for (const name of ['IntakeCandidatePage', 'IntakeMaterial', 'IntakeSnapshot', 'IntakeQualitySubmission']) {
    assert.ok(unified.contractSchemaNames.includes(name));
  }
  checkRejected('SearchRequest', {});
  assert.equal(legacy.validateContractSchema('MenokinSopQuerySopReadyResult', ready.result).ok, false);
  assert.equal(unified.validateContractSchema('__proto__', {}).ok, false);
  assert.equal(legacy.validateContractSchema('IntakePublishedEntry', faqEntry).ok, true);
  assert.equal(legacy.validateContractSchema('IntakePublishedEntry', { ...faqEntry, userId: 'forged' }).ok, false);
});

test('public entry accepts complete knowledge-only and script graphs with the schema-derived four states', () => {
  assert.deepEqual(unified.parseContractSchema('IntakeSopFlowDefinition', knowledgeFlow), knowledgeFlow);
  assert.deepEqual(unified.parseContractSchema('IntakeSopFlowDefinition', scriptFlow), scriptFlow);
  assert.equal(unified.validateContractSchema('MenokinSopQuerySopQueryRequest', queryRequest).ok, true);
  for (const response of queryResponses) {
    assert.deepEqual(unified.parseContractSchema('MenokinSopQuerySopQueryResponse', response), response);
    assert.equal(readyDigest(response), response.status === 'ready' ? ready.result.graph_digest : null);
  }
  for (const risk of ['low', 'medium', 'high', 'critical']) {
    const response = { ...ready, result: {
      ...ready.result, flow: scriptFlow,
      entries: [{ sourceId: entryRef.sourceId, entry: faqEntry }],
      permissions: [{ ...permission, risk_level: risk }],
    } };
    assert.equal(unified.validateContractSchema('MenokinSopQuerySopQueryResponse', response).ok, true);
  }
});

test('public entry rejects missing digest, extra fields, forged identity and unclassified risk', () => {
  const { graph_digest: _digest, ...missingDigest } = ready.result;
  checkRejected('MenokinSopQuerySopQueryResponse', { ...ready, result: missingDigest });
  checkRejected('MenokinSopQuerySopReadyResult', missingDigest);
  checkRejected('MenokinSopQuerySopQueryRequest', { ...queryRequest, userId: 'forged-sensitive-value' });
  checkRejected('MenokinSopQuerySopQueryResponse', { ...ready, userId: 'forged-sensitive-value' });
  checkRejected('MenokinSopQuerySopQueryResponse', { ...ready, result: { ...ready.result, extra: true } });
  checkRejected('MenokinSopQuerySopEntryPermission', { ...permission, risk_level: 'unclassified' });
  checkRejected('MenokinSopQuerySopQueryResponse', { ...ready, result: {
    ...ready.result, permissions: [{ ...permission, risk_level: 'unclassified' }],
  } });
  const node = knowledgeFlow.nodes[0];
  checkRejected('IntakeSopNode', { ...node, body: { ...node.body, extra: true } });
  checkRejected('IntakeSopNode', { ...node, body: { ...node.body, scripts: undefined } });
  checkRejected('IntakeSopNode', { ...node, body: { ...node.body, requirements: [
    { id: 'a', label: 'first', ordinal: 1 }, { id: 'b', label: 'duplicate', ordinal: 1 },
  ] } });
  checkRejected('IntakeSopNode', { ...node, body: { ...node.body, requirements: [
    { id: 'a', label: 'gap', ordinal: 2 },
  ] } });
  checkRejected('IntakeSopFlowDefinition', { ...knowledgeFlow, nodes: [{ ...node, body: {
    ...node.body, knowledge: [{ id: 'knowledge-a', title: '合成知识', body: '合成说明', audience: 'coach' }],
  } }] });
});

test('SOP media uses the full owner binding and enforces required entry branches', () => {
  const binding = {
    resourceId: 'resource-a', objectId: 'object-a', sha256: 'b'.repeat(64), mime: 'image/png', bytes: 1,
    required: true, alt: '合成图片', flowKey: knowledgeFlow.header.key, ordinal: 1,
    graphTarget: { kind: 'knowledge', id: 'knowledge-a' }, audience: 'agent',
    applicability: { productRefs: [], scenarioRefs: [] },
  };
  const validated = unified.validateContractSchema('IntakeSopMedia', binding);
  assert.equal(validated.ok, true, JSON.stringify(validated));
  checkRejected('IntakeSopMedia', { ...binding, graphTarget: undefined });
  checkRejected('IntakeSopMedia', { ...binding, entry: entryRef });
  assert.equal(unified.validateContractSchema('MenokinSopQuerySopQueryResponse', { ...ready, result: {
    ...ready.result, media: [{ binding, preview_handle: 'synthetic-preview', expires_at: '2026-11-09T01:00:00Z' }],
  } }).ok, true);
});

test('generated public types compile positives and reject negative consumers', () => {
  const directory = mkdtempSync(path.join(packageRoot, 'tests/.sop-unified-consumer-'));
  const compiler = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  const file = path.join(directory, 'consumer.ts');
  const options = [compiler, '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', file];
  const imports = `import type { components, operations } from '@customer-agent/contracts/sop-unified';\nimport { ready, permission, queryRequest } from '../sop-unified.fixtures.js';\n`;
  try {
    writeFileSync(file, `${imports}
      const response: components['schemas']['MenokinSopQuerySopQueryResponse'] = ready;
      const request: operations['querySop']['requestBody']['content']['application/json'] = queryRequest;
      void [response, request];
    `);
    execFileSync(process.execPath, options, { cwd: packageRoot, stdio: 'pipe' });
    for (const [source, diagnostic] of [
      ["const missing: components['schemas']['MenokinSopQuerySopReadyResult'] = { flow: ready.result.flow, entries: [], media: [], permissions: [] };", /graph_digest/],
      ["const risk: components['schemas']['MenokinSopQuerySopEntryPermission'] = { ...permission, risk_level: 'unclassified' };", /unclassified/],
      ["const forged: components['schemas']['MenokinSopQuerySopQueryRequest'] = { ...queryRequest, userId: 'forged' };", /userId/],
      ["const extra: components['schemas']['MenokinSopQuerySopReadyResult'] = { ...ready.result, extra: true };", /extra/],
    ]) {
      writeFileSync(file, imports + source);
      const result = spawnSync(process.execPath, options, { cwd: packageRoot, encoding: 'utf8' });
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.match(result.stdout, diagnostic);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('codegen binds actual source and every referenced schema with deterministic artifact bytes', async () => {
  const generated = await generateContracts({ projectRoot, check: true });
  const provenance = unified.CONTRACT_PROVENANCE;
  assert.equal(provenance.contract_set_id, contractId);
  assert.equal(provenance.source_git_sha, sourceSha);
  assert.equal(provenance.runtime_activated, false);
  assert.equal(sourceManifest.schema, 'customer-agent-contract-set/v11');
  assert.equal(sourceManifest.openapi.version, '1.29.1');
  assert.equal(provenance.source_artifacts.openapi.bytes, readFileSync(sourcePath).length);
  assert.deepEqual(provenance.source_artifacts, {
    openapi: sourceManifest.openapi, database: sourceManifest.database, ...sourceManifest.sopUnified,
  });
  assert.equal(Object.keys(provenance.source_artifacts).length + 1, 14);
  assert.equal(provenance.source_artifacts.openapi.sha256, hash(readFileSync(sourcePath)));
  assert.equal(provenance.source_manifest.sha256, hash(readFileSync(path.join(upstream, contractId, 'contract-set.json'))));
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'src/generated/sop-unified/codegen-manifest.generated.json'), 'utf8'));
  for (const descriptor of Object.values(manifest.artifacts)) {
    const bytes = readFileSync(path.join(projectRoot, descriptor.path));
    assert.equal(hash(bytes), descriptor.sha256);
    assert.equal(bytes.length, descriptor.bytes);
    assert.ok(generated.files.includes(descriptor.path));
  }
  const actual = parse(readFileSync(sourcePath, 'utf8'));
  const projected = parse(readFileSync(path.join(packageRoot, 'openapi/sop-unified/bundle.generated.yaml'), 'utf8'));
  assert.deepEqual(projected.paths['/v1/sop/query'], actual.paths['/v1/sop/query']);
  for (const [group, entries] of Object.entries(projected.components)) {
    for (const [name, schema] of Object.entries(entries)) assert.deepEqual(schema, actual.components[group][name]);
  }
  assert.deepEqual(Object.keys(projected.components.schemas).sort(), [...unified.contractSchemaNames]);
  assert.ok(projected.components.responses.MenokinSopQuerySopBlocked);
  assert.ok(projected.components.securitySchemes.ProductSession);
  const broken = structuredClone(actual);
  delete broken.components.schemas.IntakeSopKnowledge;
  assert.throws(() => sopUnifiedDocument(broken), /Unresolved.*IntakeSopKnowledge/);
  const missingResponse = structuredClone(actual);
  delete missingResponse.components.responses.MenokinSopQuerySopBlocked;
  assert.throws(() => sopUnifiedDocument(missingResponse), /Unresolved.*MenokinSopQuerySopBlocked/);
  broken.components.schemas.IntakeSopKnowledge = { $ref: './untrusted.yaml#/Knowledge' };
  assert.throws(() => sopUnifiedDocument(broken), /Unsupported.*untrusted/);
});

test('accepted corrected source negotiates its manifest ID at every intake request and response header', () => {
  const api = parse(readFileSync(sourcePath, 'utf8'));
  const proof = JSON.parse(readFileSync(path.join(upstream, contractId, sourceManifest.sopUnified.negotiation.file), 'utf8'));
  const changes = [];
  const invalid = [
    'cs-ai-c11-openapi-1.29.0-schema-1.33-33fc543523b9',
    'cs-ai-c11-openapi-1.28.0-schema-1.32-0123456789ab',
    'menokin-sop-query-v1', contractId.slice(0, -12), `${contractId}-extra`,
  ];
  const pointer = value => value.replaceAll('~', '~0').replaceAll('/', '~1');
  const check = (schema, location) => {
    assert.equal(schema.type, 'string');
    const matcher = new RegExp(schema.pattern);
    assert.equal(matcher.test(contractId), true, location);
    for (const value of invalid) assert.equal(matcher.test(value), false, location);
    changes.push({ pointer: location, before: proof.fromPattern, after: schema.pattern });
  };
  let requests = 0;
  let responses = 0;
  for (const [route, item] of Object.entries(api.paths)) {
    if (!route.startsWith('/v1/intake/')) continue;
    for (const [method, operation] of Object.entries(item)) {
      if (!['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].includes(method)) continue;
      const base = `/paths/${pointer(route)}/${method}`;
      const index = operation.parameters.findIndex(parameter => parameter.name === 'X-Intake-Contract-Set');
      assert.ok(index >= 0, base);
      const parameter = operation.parameters[index];
      assert.equal(parameter.in, 'header');
      assert.equal(parameter.required, true);
      check(parameter.schema, `${base}/parameters/${index}/schema/pattern`);
      requests += 1;
      for (const [status, response] of Object.entries(operation.responses)) {
        const header = response.headers?.['X-Intake-Contract-Set'];
        if (!header) continue;
        check(header.schema, `${base}/responses/${pointer(status)}/headers/X-Intake-Contract-Set/schema/pattern`);
        responses += 1;
      }
    }
  }
  assert.equal(requests, 52);
  assert.equal(responses, 496);
  const byPointer = (left, right) => left.pointer.localeCompare(right.pointer);
  assert.deepEqual(changes.toSorted(byPointer), proof.changedHeaders.toSorted(byPointer));
  assert.equal(api['x-contract-set-negotiation'].successorContractSetId, 'deployment-manifest-exact-id');
});

test('normal generation is idempotent and rejects output, source, lock and membership drift', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sop-unified-codegen-'));
  try {
    cpSync(path.join(projectRoot, 'contracts'), path.join(directory, 'contracts'), { recursive: true });
    cpSync(path.join(projectRoot, 'packages/database/migrations'), path.join(directory, 'packages/database/migrations'), { recursive: true });
    writeFileSync(path.join(directory, 'package.json'), readFileSync(path.join(projectRoot, 'package.json')));
    const first = await generateContracts({ projectRoot: directory });
    const readArtifacts = () => new Map(first.files.map((file) => [file, readFileSync(path.join(directory, file))]));
    const firstBytes = readArtifacts();
    await generateContracts({ projectRoot: directory });
    assert.deepEqual(readArtifacts(), firstBytes);
    await generateContracts({ projectRoot: directory, check: true });
    const output = path.join(directory, 'packages/contracts/src/generated/sop-unified/openapi.generated.ts');
    const original = readFileSync(output);
    writeFileSync(output, '// drift\n');
    await assert.rejects(generateContracts({ projectRoot: directory, check: true }), /Generated contract drift/);
    await generateContracts({ projectRoot: directory });
    assert.deepEqual(readFileSync(output), original);
    const unknown = path.join(path.dirname(output), 'unexpected.ts');
    writeFileSync(unknown, '');
    await assert.rejects(generateContracts({ projectRoot: directory, check: true }), /member drift/);
    rmSync(unknown);
    const source = path.join(directory, 'contracts/upstream/customer-agent', contractId, 'openapi.v1.yaml');
    const sourceBytes = readFileSync(source);
    chmodSync(source, 0o644);
    writeFileSync(source, Buffer.concat([sourceBytes, Buffer.from('\n')]));
    await assert.rejects(generateContracts({ projectRoot: directory, check: true }), /size|hash|bytes|SHA|mismatch/i);
    writeFileSync(source, sourceBytes);
    const lockPath = path.join(directory, 'contracts/upstream/customer-agent/sop-unified-corrected-contract-set.lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    writeFileSync(lockPath, JSON.stringify({ ...lock, source_git_sha: '0'.repeat(40) }));
    await assert.rejects(buildGeneratedArtifacts({ projectRoot: directory }), /lock|mismatch/i);
    await assert.rejects(generateContracts({ projectRoot: directory, check: true }), /lock|mismatch/i);
    rmSync(lockPath);
    await assert.rejects(buildGeneratedArtifacts({ projectRoot: directory }), /SOP corrected unified lock is missing/);
    await assert.rejects(generateContracts({ projectRoot: directory, check: true }), /SOP corrected unified lock is missing/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
