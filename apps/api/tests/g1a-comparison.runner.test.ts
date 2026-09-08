import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readG1aEvaluationPackage } from './support/g1a-e0/input-package.js';
import { runVerifiedG1aComparison } from './support/g1a-e0/runner.js';
import { serializeG1aDelivery } from './support/g1a-e0/report-contract.js';
import { compareG1aDeliveries, KEYWORD_BASELINE_COMMIT } from './support/g1a-e0/comparison-contract.js';

const suite = process.env.CUSTOMER_AGENT_G1A_COMPARISON === '1' ? describe.sequential : describe.skip;
suite('controlled same-session comparison', () => {
  it('verifies the candidate and input before constructing the runtime', async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
    const candidate = process.env.CUSTOMER_AGENT_G1A_CANDIDATE_SHA;
    const inputRoot = process.env.CUSTOMER_AGENT_G1A_INPUT_ROOT;
    const manifest = process.env.CUSTOMER_AGENT_G1A_MANIFEST_SHA256;
    if (!candidate || !/^[a-f0-9]{40}$/.test(candidate) || !inputRoot || !manifest) throw new Error('G1A_COMPARISON_CONFIGURATION_REQUIRED');
    const verifyCandidate = () => {
      if (git('rev-parse', 'HEAD') !== candidate || git('status', '--porcelain') !== '') throw new Error('G1A_COMPARISON_CANDIDATE_CHANGED');
      const baselineRoot = path.join(import.meta.dirname, 'support/g1a-e0/keyword-baseline');
      const pin = JSON.parse(readFileSync(path.join(baselineRoot, 'provenance.json'), 'utf8'));
      if (pin.source_commit !== KEYWORD_BASELINE_COMMIT) throw new Error('G1A_COMPARISON_BASELINE_CHANGED');
      for (const name of ['search-text.ts', 'search-repository.ts', 'search-service.ts']) {
        const hash = createHash('sha256').update(readFileSync(path.join(baselineRoot, name))).digest('hex');
        if (hash !== pin.files[name]?.vendored_sha256) throw new Error('G1A_COMPARISON_BASELINE_CHANGED');
      }
    };
    verifyCandidate();
    const input = await readG1aEvaluationPackage(inputRoot, {
      repositoryRoot, expectedManifestSha256: manifest,
      ...(process.env.CUSTOMER_AGENT_G1A_OWNER_ACCEPTANCE_SHA256 ? { expectedOwnerAcceptanceSha256: process.env.CUSTOMER_AGENT_G1A_OWNER_ACCEPTANCE_SHA256 } : {}),
      ...(process.env.CUSTOMER_AGENT_G1A_OWNER_SUBJECT_HASH ? { expectedOwnerSubjectHash: process.env.CUSTOMER_AGENT_G1A_OWNER_SUBJECT_HASH } : {}),
    });
    const completed = await runVerifiedG1aComparison(input);
    verifyCandidate();
    const envelope = { baseline: serializeG1aDelivery(completed.baseline), candidate: serializeG1aDelivery(completed.candidate),
      identity: { baseline_commit: KEYWORD_BASELINE_COMMIT, candidate_commit: candidate } };
    const comparison = compareG1aDeliveries(envelope.baseline, envelope.candidate, manifest, envelope.identity, candidate);
    expect(comparison.summary.total).toBe(50);
    process.stdout.write(`G1A_COMPARISON_DELIVERY ${JSON.stringify(envelope)}\n`);
  }, 180_000);
});
