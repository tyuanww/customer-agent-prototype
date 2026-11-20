import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SOP_CANDIDATE_CONTRACT_SET_ID, parseContractSchema, validateContractSchema } from '@customer-agent/contracts/sop-candidates';
import { verifySopCandidateContractSet } from '../../../scripts/sop-candidate-contract.mjs';
import { generateContracts } from '../scripts/generate-contracts.mjs';

const upstreamPath = 'contracts/upstream/customer-agent';
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const upstream = path.join(projectRoot, upstreamPath);
const requestId = '00000000-0000-4000-8000-000000000001';
const candidateRef = 'sdc_' + 'a'.repeat(64);

test('W5 built validators accept frozen requests and disclose only the discovery projection', () => {
  const discover = { request_id: requestId, query_text: '这是合成问题🧪', context_generation: 'ctx-1', entitlement_id: 'ordinary-e' };
  assert.equal(parseContractSchema('W5SopCandidateDiscoverRequest', discover), discover);
  assert.equal(validateContractSchema('W5SopCandidateDiscoverRequest', { ...discover, query_text: ' ' }).ok, false);
  assert.equal(validateContractSchema('W5SopCandidateDiscoverRequest', { ...discover, query_text: '测'.repeat(501) }).ok, false);
  assert.equal(validateContractSchema('W5SopCandidateDiscoverRequest', { ...discover, sop_group: 'shipping' }).ok, false);

  const selection = { request_id: requestId, candidate_query_id: requestId, candidate_ref: candidateRef, entitlement_id: 'ordinary-e' };
  assert.equal(parseContractSchema('W5SopCandidateSelectRequest', selection), selection);
  assert.equal(validateContractSchema('W5SopCandidateSelectRequest', { ...selection, candidate_ref: 'local-handle' }).ok, false);

  const candidate = { candidate_ref: candidateRef, label: '配送步骤' };
  const response = { status: 'candidates', request_id: requestId, release_id: 'rel_w5', expires_at: '2026-11-20T00:00:00Z', candidates: [candidate] };
  assert.equal(parseContractSchema('W5SopCandidateDiscoverResponse', response), response);
  assert.equal(validateContractSchema('W5SopCandidateDiscoverResponse', { ...response, candidates: [{ ...candidate, graph: {} }] }).ok, false);
  assert.equal(validateContractSchema('W5SopCandidateDiscoverResponse', { ...response, candidates: [candidate, { ...candidate, label: '其他' }] }).ok, false);
  for (const status of ['ambiguous', 'no_match', 'stale', 'unavailable']) {
    const outcome = { status, request_id: requestId };
    assert.equal(parseContractSchema('W5SopCandidateDiscoverResponse', outcome), outcome);
    assert.equal(validateContractSchema('W5SopCandidateDiscoverResponse', { ...outcome, candidates: [] }).ok, false);
  }
});

test('W5 export refuses manifest, member and installed predecessor drift without upstream access', async () => {
  const { summary, manifest } = verifySopCandidateContractSet();
  assert.equal(summary.contract_set_id, SOP_CANDIDATE_CONTRACT_SET_ID);
  await generateContracts({ projectRoot, profile: 'sopCandidates', check: true });

  const temporary = mkdtempSync(path.join(tmpdir(), 'w5-local-intake-'));
  try {
    const local = path.join(temporary, upstreamPath);
    mkdirSync(local, { recursive: true });
    const candidate = path.join(local, summary.contract_set_id);
    const predecessor = path.join(local, manifest.predecessor.contractSetId);
    cpSync(path.join(upstream, summary.contract_set_id), candidate, { recursive: true });
    mkdirSync(predecessor);
    for (const file of ['contract-set.json', ...Object.keys(manifest.predecessor.sha256)]) {
      cpSync(path.join(upstream, manifest.predecessor.contractSetId, file), path.join(predecessor, file));
    }
    const lock = 'sop-resource-disable-corrected-contract-set.lock.json';
    cpSync(path.join(upstream, lock), path.join(local, lock));
    const verify = () => verifySopCandidateContractSet({ projectRoot: temporary });
    assert.deepEqual(verify().summary, summary);

    for (const [file, diagnostic] of [
      [path.join(candidate, 'contract-set.json'), /W5 manifest SHA-256/],
      [path.join(candidate, 'w5-storage.v1.sql'), /W5 member size/],
      [path.join(predecessor, 'query-transport.v1.json'), /W5 predecessor size/],
    ]) {
      const original = readFileSync(file);
      chmodSync(file, 0o644);
      writeFileSync(file, Buffer.concat([original, Buffer.from('\n')]));
      assert.throws(verify, diagnostic);
      writeFileSync(file, original);
    }
    rmSync(path.join(candidate, 'authorization.v1.json'));
    assert.throws(verify, /W5 contract member set|ENOENT/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
