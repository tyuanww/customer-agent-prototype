import type { Client } from 'pg';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { loadG1aEvaluationRelease } from './support/g1a-e0/loader.js';
import { createKeywordBaseline } from './support/g1a-e0/keyword-baseline/backend.js';
import { createSearchBackend } from '../src/search-service.js';
import { createSearchRepository } from '../src/search-repository.js';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { compareG1aDeliveries, KEYWORD_BASELINE_COMMIT } from './support/g1a-e0/comparison-contract.js';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSyntheticG1aE0Package } from './support/g1a-e0/synthetic-package.js';
import { readG1aEvaluationPackage } from './support/g1a-e0/input-package.js';
import { runVerifiedG1aComparison } from './support/g1a-e0/runner.js';
import { readG1aDelivery, serializeG1aDelivery } from './support/g1a-e0/report-contract.js';

const suite = process.env.CUSTOMER_AGENT_API_G1A_E0_SYNTHETIC === '1' ? describe : describe.skip;
suite('same-session G1a comparison', () => {
  it('evaluates both algorithms with one transaction, zero events and verified cleanup', async () => {
    const fixture = await createSyntheticG1aE0Package();
    try {
      const input = await readG1aEvaluationPackage(fixture.inputRoot, {
        expectedManifestSha256: fixture.expectedManifestSha256,
        repositoryRoot: path.resolve(import.meta.dirname, '../../..'),
      });
      const result = await runVerifiedG1aComparison(input);
      const baseline = readG1aDelivery(serializeG1aDelivery(result.baseline), input.manifest_sha256);
      const candidate = readG1aDelivery(serializeG1aDelivery(result.candidate), input.manifest_sha256);
      expect(baseline.runtime).toEqual(candidate.runtime);
      expect(candidate.runtime).toMatchObject({ cleanup_verified: true, event_rows_before: 0, event_rows_after: 0 });
      expect(baseline.report.case_results).toHaveLength(50);
      expect(candidate.report.case_results).toHaveLength(50);
      expect(baseline.report.source_binding_hash).toBe(candidate.report.source_binding_hash);
      expect(baseline.report.raw.backend_errors).toBe(0);
      expect(candidate.report.raw.backend_errors).toBe(0);
      expect(candidate.report.downstream_action_evaluation).toBe('NOT_EVALUATED');
      const baselineOutput = serializeG1aDelivery(result.baseline);
      const candidateOutput = serializeG1aDelivery(result.candidate);
      const identity = { baseline_commit: KEYWORD_BASELINE_COMMIT, candidate_commit: 'c8ed3b7e70adf9b8c58b3fab57895dede4bb0332' };
      const comparison = compareG1aDeliveries(baselineOutput, candidateOutput, input.manifest_sha256, identity, identity.candidate_commit);
      expect(comparison.summary.improved + comparison.summary.regressed + comparison.summary.unchanged).toBe(50);
      expect(comparison.t6_signed).toBe(false);
      expect(() => compareG1aDeliveries(baselineOutput, candidateOutput, input.manifest_sha256,
        { ...identity, candidate_commit: '1'.repeat(40) }, identity.candidate_commit)).toThrow();
      const cli = spawnSync(process.execPath, [path.resolve(import.meta.dirname, '../../../scripts/read-g1a-comparison.mjs'), input.manifest_sha256, identity.candidate_commit], {
        input: JSON.stringify({ baseline: baselineOutput, candidate: candidateOutput, identity }), encoding: 'utf8',
      });
      expect(cli.status, cli.stderr).toBe(0);
      expect(JSON.parse(cli.stdout)).toEqual(comparison);
      const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'g1a-comparison-consumer-'));
      try {
        const outputPath = path.join(outputRoot, 'comparison.json');
        await writeFile(outputPath, cli.stdout, { mode: 0o600, flag: 'wx' });
        expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual(comparison);
      } finally { await rm(outputRoot, { recursive: true }); }
      const mutateDelivery = (change: (value: typeof candidate) => void) => {
        const value = JSON.parse(JSON.stringify(candidate));
        change(value);
        return 'G1A_E0_DELIVERY ' + JSON.stringify(value) + '\n';
      };
      const invalidOutputs = [
        mutateDelivery(value => { Object.assign(value.runtime, { cleanup_verified: false }); }),
        mutateDelivery(value => { Object.assign(value.report.raw, { event_writes: 1 }); }),
        mutateDelivery(value => { Object.assign(value.report, { source_binding_hash: '0'.repeat(64) }); }),
        mutateDelivery(value => { Object.assign(value.report.case_results[0]!, { case_id: value.report.case_results[1]!.case_id }); }),
        mutateDelivery(value => { Object.assign(value.report.case_results[0]!, { expected_downstream_action: 'escalate' }); }),
        mutateDelivery(value => { Object.assign(value.report.raw, { positive_top3_hits: -1 }); }),
      ];
      for (const invalid of invalidOutputs) {
        expect(() => compareG1aDeliveries(baselineOutput, invalid, input.manifest_sha256, identity, identity.candidate_commit)).toThrow();
      }
      expect(() => compareG1aDeliveries(baselineOutput, candidateOutput, input.manifest_sha256,
        { ...identity, untrusted: 'must not be echoed' } as typeof identity, identity.candidate_commit)).toThrow();

      expect(() => compareG1aDeliveries(baselineOutput, candidateOutput, '0'.repeat(64), identity, identity.candidate_commit)).toThrow();
      expect(() => compareG1aDeliveries(baselineOutput, candidateOutput, input.manifest_sha256,
        { ...identity, baseline_commit: '0'.repeat(40) }, identity.candidate_commit)).toThrow();
      const wrongTime = serializeG1aDelivery({ ...result.candidate, runtime: { ...result.candidate.runtime,
        transaction_timestamp: '2020-01-01T00:00:00.000Z' } });
      expect(() => compareG1aDeliveries(baselineOutput, wrongTime, input.manifest_sha256, identity, identity.candidate_commit)).toThrow();

    } finally { await fixture.cleanup(); }
  });
  it.each(['wrapped-query', 'retrieval-miss', 'safety-failure'] as const)(
    'consumes actual PostgreSQL reports for %s without promoting failure to a sign-off', async (mode) => {
      const fixture = await createSyntheticG1aE0Package(new Date(), true, true);
      try {
        const original = await readG1aEvaluationPackage(fixture.inputRoot, {
          expectedManifestSha256: fixture.expectedManifestSha256,
          repositoryRoot: path.resolve(import.meta.dirname, '../../..'),
          expectedOwnerAcceptanceSha256: fixture.expectedOwnerAcceptanceSha256!,
          expectedOwnerSubjectHash: fixture.expectedOwnerSubjectHash!,
        });
        const positive = original.cases.findIndex(row => row.stratum === 'positive');
        const safety = original.cases.findIndex(row => row.stratum === 'safety_negative');
        const index = mode === 'safety-failure' ? safety : positive;
        const originalQuery = original.cases[positive]!.query_text;
        // Test-only package variation: never modifies the frozen fixture files or a real input.
        const input = { ...original, cases: original.cases.map((row, i) => i !== index ? row : {
          ...row, query_text: mode === 'wrapped-query' ? `请问${originalQuery}呢`
            : mode === 'retrieval-miss' ? '合成完全未知的天外物品' : originalQuery,
          platform: original.cases[positive]!.platform,
          product_context_type: original.cases[positive]!.product_context_type,
          product_context_ref: original.cases[positive]!.product_context_ref,
        }) };
        const completed = await runVerifiedG1aComparison(input);
        expect(completed.candidate.runtime.transaction_isolation).toBe('read committed');
        if (mode === 'wrapped-query') {
          expect(completed.baseline.report.case_results[index]!.search_action_correct).toBe(false);
          expect(completed.candidate.report.case_results[index]!.search_action_correct).toBe(true);
        } else if (mode === 'retrieval-miss') {
          expect(completed.candidate.report.case_results[index]!.failure_codes).toContain('EXPECTED_TOP3_MISS');
        } else {
          expect(completed.candidate.report.runner_result).toBe('FAILED');
          expect(completed.candidate.report.failures.some(row => row.code === 'SAFETY_THRESHOLD_MISSED')).toBe(true);
        }
        const identity = { baseline_commit: KEYWORD_BASELINE_COMMIT, candidate_commit: 'c8ed3b7e70adf9b8c58b3fab57895dede4bb0332' };
        const envelope = { baseline: serializeG1aDelivery(completed.baseline), candidate: serializeG1aDelivery(completed.candidate), identity };
        const cli = spawnSync(process.execPath, [path.resolve(import.meta.dirname, '../../../scripts/read-g1a-comparison.mjs'),
          input.manifest_sha256, identity.candidate_commit], { input: JSON.stringify(envelope), encoding: 'utf8' });
        expect(cli.status, cli.stderr).toBe(0);
        const parsed = JSON.parse(cli.stdout);
        expect(parsed.t6_signed).toBe(false);
        expect(parsed.candidate.report.decision).toBe(completed.candidate.report.decision);
        expect(parsed.candidate.report.downstream_action_evaluation).toBe('NOT_EVALUATED');
      } finally { await fixture.cleanup(); }
    });

  it('applies source suspension and owner revocation to both algorithms', async () => {
    const fixture = await createSyntheticG1aE0Package(new Date(), false, true);
    const harness = new Pg15Harness();
    let owner: Client | undefined;
    try {
      const input = await readG1aEvaluationPackage(fixture.inputRoot, { ...fixture,
        repositoryRoot: path.resolve(import.meta.dirname, '../../..') });
      harness.start();
      owner = await harness.connect(harness.createDatabase('comparison_source_gate').config);
      await applyDatabaseMigrations(owner);
      await loadG1aEvaluationRelease(owner, input);
      const repository = createSearchRepository(owner as never);
      const algorithms = [createKeywordBaseline(owner), createSearchBackend({ searchCandidates: repository.search })];
      const row = input.cases.find(row => row.stratum === 'positive')!;
      const request = { normalizedQuery: row.query_text, platform: row.platform,
        productContextType: row.product_context_type, productContextRef: row.product_context_ref, topK: 3 as const };
      for (const algorithm of algorithms) {
        const result = await algorithm.search(request);
        expect(result.ok && result.candidates.length > 0).toBe(true);
      }
      await owner.query('BEGIN');
      await owner.query("SELECT suspend_authoritative_source($1,'SOURCE_REVOKED','EVD-SYNTHETIC-SUSPEND','synthetic_owner','owner')",
        [input.manifest.source_bindings[0]!.source_version_id]);
      for (const algorithm of algorithms) expect(await algorithm.search(request)).toEqual({ ok: false, code: 'SOURCE_GATE_NOT_READY' });
      await owner.query('ROLLBACK');
      await owner.query("SELECT revoke_owner_acceptance('default',$1,'EVD-SYNTHETIC-REVOKE')", [input.owner_acceptance!.record_sha256]);
      for (const algorithm of algorithms) expect(await algorithm.search(request)).toEqual({ ok: false, code: 'SOURCE_GATE_NOT_READY' });
    } finally { await owner?.end(); harness.stop(); await fixture.cleanup(); }
  });

});
