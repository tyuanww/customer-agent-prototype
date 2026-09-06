import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertExecutableG1aControlledReport } from './support/g1a-e0/evaluate.js';
import { runG1aEvaluationPackage } from './support/g1a-e0/runner.js';

const describeControlledPackage = process.env.CUSTOMER_AGENT_API_G1A_E0_PACKAGE === '1'
  ? describe.sequential
  : describe.skip;

describeControlledPackage('G1A-E0 controlled package runner', () => {
  it('verifies, evaluates, scrubs, and destroys the isolated runtime before returning', async () => {
    const inputRoot = process.env.CUSTOMER_AGENT_G1A_INPUT_ROOT;
    const expectedManifestSha256 = process.env.CUSTOMER_AGENT_G1A_MANIFEST_SHA256;
    if (!inputRoot || !expectedManifestSha256) {
      throw new Error('G1A_INPUT_ROOT_AND_MANIFEST_SHA256_REQUIRED');
    }

    const completed = await runG1aEvaluationPackage({
      inputRoot,
      expectedManifestSha256,
      ...(process.env.CUSTOMER_AGENT_G1A_OWNER_ACCEPTANCE_SHA256 ? { expectedOwnerAcceptanceSha256: process.env.CUSTOMER_AGENT_G1A_OWNER_ACCEPTANCE_SHA256 } : {}),
      ...(process.env.CUSTOMER_AGENT_G1A_OWNER_SUBJECT_HASH ? { expectedOwnerSubjectHash: process.env.CUSTOMER_AGENT_G1A_OWNER_SUBJECT_HASH } : {}),
      repositoryRoot: path.resolve(import.meta.dirname, '../../..'),
    });

    process.stdout.write(`G1A_E0_REPORT ${JSON.stringify(completed)}\n`);
    assertExecutableG1aControlledReport(completed.report);
    expect(completed.report).toMatchObject({
      classification: 'approved_redacted',
      status: 'NOT_SIGNED',
      runner_result: 'EXECUTABLE',
      decision: 'REVIEW_REQUIRED',
      downstream_action_evaluation: 'NOT_EVALUATED',
    });
    expect(completed.runtime).toMatchObject({
      postgres_major: 15,
      transaction_isolation: process.env.CUSTOMER_AGENT_G1A_OWNER_ACCEPTANCE_SHA256 ? 'read committed' : 'repeatable read',
      transaction_read_only: true,
      event_rows_before: 0,
      event_rows_after: 0,
      network_boundary: 'NODE_TCP_FETCH_GUARD_ONLY',
      cleanup_verified: true,
    });
  }, 120_000);
});
