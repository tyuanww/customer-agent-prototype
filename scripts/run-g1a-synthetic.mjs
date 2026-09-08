import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// This CI entry must never inherit a controlled-package selector or real anchors.
for (const [key, value] of Object.entries(process.env)) {
  if (value && (key.startsWith('CUSTOMER_AGENT_G1A_') || key === 'CUSTOMER_AGENT_API_G1A_E0_PACKAGE' || key === 'CUSTOMER_AGENT_G1A_ASSEMBLE')) {
    throw new Error('G1A_CI_REAL_INPUT_ENV_FORBIDDEN');
  }
}
const root = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-e0-ci-'));
try {
  const report = path.join(root,'tests.json');
  const result = spawnSync('pnpm',['--filter','@customer-agent/api','test:g1a:e0:synthetic','--reporter=json',`--outputFile=${report}`],{stdio:'inherit',env:process.env});
  if (result.error || result.signal || result.status !== 0) throw new Error('G1A_CI_SYNTHETIC_FAILED');
  const summary = JSON.parse(readFileSync(report,'utf8'));
  const integration = summary.testResults.filter((entry) => entry.name.endsWith('/g1a-e0-synthetic.integration.test.ts'));
  if (summary.success !== true || summary.numTotalTests < 1 || summary.numPendingTests !== 0
    || integration.length !== 1 || integration[0].assertionResults.length < 10
    || integration[0].assertionResults.some((entry) => entry.status !== 'passed')) throw new Error('G1A_CI_MISSING_OR_SKIPPED_TESTS');
  const comparison = summary.testResults.filter((entry) => entry.name.endsWith('/g1a-comparison.integration.test.ts'));
  if (comparison.length !== 1 || comparison[0].assertionResults.length < 5
    || comparison[0].assertionResults.some((entry) => entry.status !== 'passed')) throw new Error('G1A_CI_COMPARISON_CASE_MISSING');
  for (const scenario of ['all_match','retrieval_miss','safety_failure']) {
    if (!integration[0].assertionResults.some((entry) => entry.fullName.includes(`retains ${scenario} through the actual CLI`))) throw new Error('G1A_CI_DELIVERY_CASE_MISSING');
  }
  console.log(`G1A CI PASS: ${summary.numPassedTests} executed tests; ${integration[0].assertionResults.length} real PG15 synthetic integration cases; no skipped cases; controlled runner disabled.`);
} finally { rmSync(root,{recursive:true,force:true}); }
