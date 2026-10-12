import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const READINESS_SCHEMA = 'customer-agent-contract-set/v7';
export const READINESS_LOCK = 'readiness-contract-set.lock.json';
export const READINESS_SOURCE = 'business-docs/01-客服Agent项目/30-开发-进行中/content-intake-readiness-successor-v1';
export const READINESS_APPROVAL = 'business-docs/01-客服Agent项目/90-评审/2026-10-12_就绪边界后继合同批准.json';
export const READINESS_MEMBERS = Object.freeze({ upgrade:'upgrade.v1.sql', assembly:'assembly.v1.json', installation:'installation.v1.json', predecessor:'predecessor-lock.v1.json', provenance:'provenance.v1.json', approval:'approval.v1.json' });
const VERSIONS = { openapi:'1.24.0', schema:'1.29', migration:'0041', exportProfile:'content-intake-readiness-successor-v1' };
const CANDIDATE_KEYS = { 'openapi.candidate.yaml':'openapi','schema.candidate.sql':'database','upgrade.candidate.sql':'upgrade', 'assembly.candidate.json':'assembly','installation.candidate.json':'installation','predecessor-lock.json':'predecessor','manifest.json':'provenance' };
const PREDECESSOR = 'cs-ai-c11-openapi-1.24.0-schema-1.28-379b793811ed';
const SEPARATOR = '\n-- EXACT schema.v1.28 predecessor above; DRAFT schema.v1.29 delta below.\n';
export const hashBytes = value => createHash('sha256').update(value).digest('hex');

/** Verifies semantic links after the common envelope has checked every physical
 * member. It never interprets bundle paths as executable instructions. */
export function verifyReadinessReferences(directory, manifest) {
  const sources = Object.fromEntries(Object.entries(READINESS_MEMBERS).map(([key,file])=>[key,readFileSync(path.join(directory,file),'utf8')]));
  const approval=JSON.parse(sources.approval), provenance=JSON.parse(sources.provenance), installation=JSON.parse(sources.installation);
  assert.equal(approval.schema,'customer-agent-readiness-successor-approval/v1'); assert.equal(approval.status,'APPROVED');
  assert.deepEqual(approval.versions,VERSIONS);
  for(const k of ['freezeApproved','exportApproved','intakeApproved','syntheticOnly']) assert.equal(approval[k],true,k);
  for(const k of ['runtimeActivated','productionConsumerReady']) assert.equal(approval[k],false,k);
  assert.deepEqual(Object.keys(approval.artifacts).sort(),Object.keys(CANDIDATE_KEYS).sort());
  for(const [name,key] of Object.entries(CANDIDATE_KEYS)) assert.equal(approval.artifacts[name],(manifest[key]??manifest.readiness[key]).sha256,'Readiness approval hash mismatch');
  assert.equal(approval.approvedCandidateManifestSha256,manifest.readiness.provenance.sha256);
  assert.deepEqual(provenance.proposedVersions,VERSIONS); assert.deepEqual(installation.proposal,VERSIONS);
  assert.equal(installation.predecessor.migrationCount,40); assert.equal(installation.predecessor.newDatabaseBootstrap,false);
  assert.deepEqual(Object.keys(provenance.artifacts).sort(),Object.keys(CANDIDATE_KEYS).filter(k=>!['predecessor-lock.json','manifest.json'].includes(k)).sort());
  for(const [name,entry] of Object.entries(provenance.artifacts)) {
    const descriptor=manifest[CANDIDATE_KEYS[name]]??manifest.readiness[CANDIDATE_KEYS[name]];
    assert.equal(entry.sha256,descriptor.sha256); assert.equal(entry.bytes,descriptor.bytes);
  }
  const predecessor=JSON.parse(sources.predecessor), assembly=JSON.parse(sources.assembly);
  assert.equal(predecessor.contractSetId,PREDECESSOR); assert.equal(assembly.predecessorContractSetId,PREDECESSOR);
  assert.equal(installation.predecessor.contractSetId,PREDECESSOR);
  assert.equal(predecessor.migrations.length,40); assert.match(predecessor.manifestSha256,/^[a-f0-9]{64}$/);
  predecessor.migrations.forEach((m,i)=>{
    assert.equal(m.position,i+1); assert.match(m.id,new RegExp(`^${String(i+1).padStart(4,'0')}_[a-z0-9_]+$`));
    assert.equal(m.file,`${m.id}.sql`); assert.match(m.sha256,/^[a-f0-9]{64}$/); assert.ok(Number.isSafeInteger(m.bytes)&&m.bytes>0);
  });
  assert.deepEqual(assembly.predecessorArtifacts, {
    openapi:{file:'openapi.v1.yaml',sha256:manifest.openapi.sha256},
    database:{file:'schema-v1.28.sql',sha256:'c676b8a580e51f6a0cc2ce0b25919fb9aec2b5e470076461131ea233972e6c69'},
  });
  assert.deepEqual(assembly.composition, {
    openapi:{operation:'exact-reuse',predecessor:'openapi',sha256:manifest.openapi.sha256},
    database:{operation:'concat',predecessor:'database',separatorUtf8:SEPARATOR,delta:'upgrade.candidate.sql',deltaSha256:manifest.readiness.upgrade.sha256,sha256:manifest.database.sha256},
  });
  return Object.freeze(sources);
}

/** Composition only accepts an already verified, installed predecessor snapshot.
 * No disk/network path from assembly metadata is followed. */
export function composeReadiness(manifest,sources,predecessor) {
  assert.equal(predecessor?.contract_set_id,PREDECESSOR,'Readiness requires exact verified predecessor');
  const assembly=JSON.parse(sources.assembly);
  assert.equal(hashBytes(predecessor.openapi_source),assembly.predecessorArtifacts.openapi.sha256,'Readiness OpenAPI predecessor drift');
  assert.equal(hashBytes(predecessor.database_source),assembly.predecessorArtifacts.database.sha256,'Readiness schema predecessor drift');
  assert.equal(hashBytes(sources.upgrade),manifest.readiness.upgrade.sha256,'Readiness upgrade drift');
  const database_source=predecessor.database_source+SEPARATOR+sources.upgrade, openapi_source=predecessor.openapi_source;
  for(const [key,bytes] of [['openapi',openapi_source],['database',database_source]]) {
    assert.equal(hashBytes(bytes),manifest[key].sha256,`Readiness reconstructed ${key} hash mismatch`);
    assert.equal(Buffer.byteLength(bytes),manifest[key].bytes);
  }
  return {openapi_source,database_source};
}
