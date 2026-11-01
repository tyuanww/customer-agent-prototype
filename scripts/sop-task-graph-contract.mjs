import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { READINESS_SOURCE } from './readiness-contract.mjs';

export const TASK_GRAPH_SCHEMA = 'customer-agent-contract-set/v9';
export const TASK_GRAPH_LOCK = 'sop-task-graph-contract-set.lock.json';
export const TASK_GRAPH_CANDIDATE_ID = 'resume-v3';
export const TASK_GRAPH_SOURCE = 'business-docs/01-客服Agent项目/30-开发-进行中/content-intake-sop-task-graph-v3';
export const TASK_GRAPH_CANDIDATE = 'business-docs/01-客服Agent项目/30-开发-进行中/sop-task-graph-resume-candidate';
export const TASK_GRAPH_HISTORY_CANDIDATE = 'business-docs/01-客服Agent项目/30-开发-进行中/sop-task-graph-candidate';
export const TASK_GRAPH_APPROVAL = 'business-docs/01-客服Agent项目/90-评审/2026-10-29_SOP图文流程实施批准.json';
export const TASK_GRAPH_HISTORY = '44dc1c30f0c85249c16ff05757f1595e1a453aef';
export const TASK_GRAPH_MEMBERS = Object.freeze({
  storage: ['storage.v3.sql', '3'],
  installation: ['installation.v3.json', '3'],
  provenance: ['provenance.v3.json', '3'],
  predecessor: ['predecessor-lock.v3.json', '3'],
  shapes: ['shapes.v3.json', '3'],
  rules: ['rules.v3.json', '3'],
  approval: ['approval.v3.json', '1'],
});

export const TASK_GRAPH_VERSIONS = Object.freeze({ openapi: '1.27.0', database: 'schema.v1.32', profile: 'content-intake-sop-task-graph-v3' });
const ARTIFACTS = Object.freeze({
  'openapi.candidate.yaml': 'openapi', 'schema.candidate.sql': 'database',
  'storage.candidate.sql': 'storage', 'installation.candidate.json': 'installation',
});
const SOURCES = Object.freeze({
  'predecessor.source.json': 'predecessor', 'shapes.source.json': 'shapes',
  'rules.source.json': 'rules', 'storage.source.sql': 'storage',
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const keys = value => Object.keys(value ?? {}).sort();
// These are reviewed source bytes, not an approval of a contract or source commit.
// Re-audit the entire import closure before updating any fingerprint.
export const TASK_GRAPH_PRODUCER_HASHES = Object.freeze({
  'build_customer_agent_sop_graph_candidate.mjs': 'cdb432cce7c1118142cd04d460d26504620b1663f47b7f71fb51e723891c2c08',
  'build_customer_agent_sop_task_graph_candidate.mjs': '781450a3db5f71a0fd46e55a5f1f57d5e09a699c7ef6e218d58aa59eb96d780e',
  'build_customer_agent_sop_resume_candidate.mjs': '876d3c3225ce4b95d71dce0da0f1c1bd2a90f97ba8c5db6f8ef29741b454ab49',
});

// Product review must bind an approved source SHA to the manifest and the locally reconstructed proof digest.
// An anchor match does not establish API compatibility or business approval.
const TASK_GRAPH_REVIEWED_REBUILDS = Object.freeze({
  // Bound to the committed governance candidate and the independently
  // reconstructed proof captured on 2026-10-31. A new source commit needs a
  // new review and a new anchor; it cannot reuse this entry by convention.
  '19c532fdf4f46da18666da27fa19d1e3e4d0a490': {
    manifest_sha256: '9ec892c8ef71f055e82559345f9ed9fdf1b62a269453c167c603b11044a597e6',
    proof_sha256: '5acc8c2ccbf957a5616fac8e7945ea4463fe28d83055ebbe089e0f9b857694ed',
  },
});

export function reviewedTaskGraphAnchor(sourceSha) {
  const anchor = Object.hasOwn(TASK_GRAPH_REVIEWED_REBUILDS, sourceSha) ? TASK_GRAPH_REVIEWED_REBUILDS[sourceSha] : null;
  return anchor ? Object.freeze({ ...anchor }) : null;
}

/** Compares bytes with caller-supplied fingerprints; it does not establish their authority. */
export function assertProducerFingerprints(files, fingerprints) {
  assert.deepEqual(keys(files), keys(fingerprints), 'Task graph producer set mismatch');
  for (const [name, expected] of Object.entries(fingerprints)) {
    assert.ok(Buffer.isBuffer(files[name]), `Task graph producer bytes missing: ${name}`);
    assert.equal(hash(files[name]), expected, `Task graph producer fingerprint mismatch: ${name}`);
  }
}

function assertTaskGraphVersions(manifest) {
  assert.equal(manifest.openapi?.version, TASK_GRAPH_VERSIONS.openapi, 'Unsupported task graph OpenAPI version');
  assert.equal(manifest.database?.version, TASK_GRAPH_VERSIONS.database, 'Unsupported task graph database version');
}

/** Check links inside the already hash-verified envelope; none is an executable path. */
export function verifyTaskGraphReferences(directory, manifest) {
  assertTaskGraphVersions(manifest);
  const sources = Object.fromEntries(Object.entries(TASK_GRAPH_MEMBERS)
    .map(([key, [file]]) => [key, readFileSync(path.join(directory, file), 'utf8')]));
  const provenance = JSON.parse(sources.provenance);
  const installation = JSON.parse(sources.installation);
  const predecessor = JSON.parse(sources.predecessor);
  const rules = JSON.parse(sources.rules);
  const approval = JSON.parse(sources.approval);
  const openapi = JSON.parse(readFileSync(path.join(directory, manifest.openapi.file), 'utf8'));
  assert.equal(openapi.info?.version, TASK_GRAPH_VERSIONS.openapi, 'Task graph OpenAPI version mismatch');
  assert.equal(provenance.schema, 'customer-agent-sop-task-graph-review-candidate/v1');
  assert.equal(provenance.status, 'IMPLEMENTATION_APPROVED_CANDIDATE');
  assert.deepEqual(provenance.proposedVersions, TASK_GRAPH_VERSIONS, 'Task graph provenance versions mismatch');
  assert.equal(installation.schema, 'customer-agent-sop-task-graph-installation/v1');
  assert.equal(installation.status, 'CANDIDATE');
  assert.deepEqual(installation.proposedVersions, TASK_GRAPH_VERSIONS, 'Task graph installation versions mismatch');
  assert.equal(installation.runnableMigration, false);
  assert.equal(installation.migrationPosition, null);
  assert.equal(installation.runtimeActivated, false);
  assert.equal(installation.productionConsumerReady, false);
  assert.deepEqual(installation.predecessor, predecessor, 'Task graph installation predecessor mismatch');
  assert.ok(Array.isArray(rules.installation));
  assert.deepEqual(installation.requiredProductWork, rules.installation, 'Task graph installation obligations mismatch');
  assert.equal(approval.schema, 'customer-agent-sop-graph-implementation-approval/v1');
  assert.equal(approval.status, 'APPROVED');
  assert.deepEqual(approval.scope, ['formal-contract-change', 'product-implementation']);
  assert.ok(typeof approval.evidenceId === 'string' && approval.evidenceId.length > 0, 'Task graph approval evidence is missing');
  assert.equal(approval.runtimeActivated, false);
  assert.equal(provenance.approvalEvidenceId, approval.evidenceId);
  assert.equal(provenance.approvalSha256, manifest.sopTaskGraph.approval.sha256, 'Task graph approval hash mismatch');
  assert.equal(provenance.runtimeActivated, false);
  assert.equal(provenance.predecessorGitSha, predecessor.sourceGitSha, 'Task graph predecessor SHA mismatch');
  assert.match(provenance.historicalCandidateGitSha, /^[0-9a-f]{40}$/, 'Task graph historical source SHA is invalid');
  assert.deepEqual(keys(provenance.sources), keys(SOURCES), 'Task graph provenance sources mismatch');
  for (const [name, key] of Object.entries(SOURCES)) {
    assert.equal(provenance.sources[name], manifest.sopTaskGraph[key].sha256, `Task graph source mismatch: ${name}`);
  }
  assert.deepEqual(keys(provenance.artifacts), keys(ARTIFACTS), 'Task graph provenance artifacts mismatch');
  for (const [name, key] of Object.entries(ARTIFACTS)) {
    const descriptor = manifest[key] ?? manifest.sopTaskGraph[key];
    assert.deepEqual(provenance.artifacts[name], { sha256: descriptor.sha256, bytes: descriptor.bytes }, `Task graph artifact mismatch: ${name}`);
  }
  assert.deepEqual(keys(predecessor), ['artifacts', 'contractSetId', 'sourceGitSha']);
  assert.match(predecessor.sourceGitSha, /^[0-9a-f]{40}$/);
  assert.equal(predecessor.contractSetId, `cs-ai-c11-openapi-1.24.0-schema-1.29-${predecessor.sourceGitSha.slice(0, 12)}`);
  assert.deepEqual(keys(predecessor.artifacts), ['openapi.v1.yaml', 'schema-v1.29.sql']);
  for (const [name, reference] of Object.entries(predecessor.artifacts)) {
    assert.deepEqual(keys(reference), ['path', 'sha256']);
    assert.equal(reference.path, `${READINESS_SOURCE}/${name}`, `Task graph predecessor path mismatch: ${name}`);
    assert.match(reference.sha256, /^[0-9a-f]{64}$/);
  }
  return Object.freeze(sources);
}

/** The predecessor is the verified compact v7 snapshot, not a presumed on-disk pair. */
export function verifyTaskGraphPredecessor(manifest, sources, readiness) {
  assertTaskGraphVersions(manifest);
  assert.ok(readiness, 'Task graph requires verified readiness predecessor');
  const predecessor = JSON.parse(sources.predecessor);
  assert.equal(readiness.contract_set_id, predecessor.contractSetId, 'Task graph predecessor contract mismatch');
  assert.equal(readiness.source_git_sha, predecessor.sourceGitSha, 'Task graph predecessor source mismatch');
  for (const [name, key, source] of [
    ['openapi.v1.yaml', 'openapi', readiness.openapi_source],
    ['schema-v1.29.sql', 'database', readiness.database_source],
  ]) {
    const reference = predecessor.artifacts[name];
    const descriptor = readiness.manifest[key];
    assert.equal(descriptor.source_path, reference.path, `Task graph predecessor path drift: ${name}`);
    assert.equal(descriptor.sha256, reference.sha256, `Task graph predecessor hash drift: ${name}`);
    assert.equal(hash(source), reference.sha256, `Task graph predecessor bytes drift: ${name}`);
  }
  const database = `-- schema.v1.32 task-graph resume candidate; cumulative reference only.\n${readiness.database_source}\n-- UNIFIED SOP TASK-GRAPH CANDIDATE STORAGE DELTA\n${sources.storage}`;
  assert.equal(hash(database), manifest.database.sha256, 'Task graph cumulative schema drift');
  assert.equal(Buffer.byteLength(database), manifest.database.bytes, 'Task graph cumulative schema size mismatch');
}
