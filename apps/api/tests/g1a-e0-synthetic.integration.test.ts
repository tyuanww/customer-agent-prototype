import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { serializeG1aDelivery, readG1aDelivery, G1A_DELIVERY_PREFIX } from './support/g1a-e0/report-contract.js';
import { jsonLine, jsonLines } from './support/g1a-e0/content-identity.js';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Client } from 'pg';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { describe, expect, it, vi } from 'vitest';
import {
  readG1aEvaluationPackage,
  type G1aEvaluationPackage,
} from './support/g1a-e0/input-package.js';
import { governanceHash } from './support/g1a-e0/content-identity.js';
import { loadG1aEvaluationRelease } from './support/g1a-e0/loader.js';
import {
  runG1aEvaluationPackage,
  runVerifiedG1aEvaluation,
} from './support/g1a-e0/runner.js';
import { createSyntheticG1aE0Package } from './support/g1a-e0/synthetic-package.js';

const describeSyntheticRunner = process.env.CUSTOMER_AGENT_API_G1A_E0_SYNTHETIC === '1'
  ? describe.sequential
  : describe.skip;

async function pg15Roots(): Promise<readonly string[]> {
  return Object.freeze((await readdir(os.tmpdir()))
    .filter((name) => name.startsWith('customer-agent-pg15-'))
    .sort());
}

async function verifiedSyntheticPackage(): Promise<Readonly<{
  input: G1aEvaluationPackage;
  cleanup: () => Promise<void>;
}>> {
  const packageFixture = await createSyntheticG1aE0Package();
  const input = await readG1aEvaluationPackage(packageFixture.inputRoot, {
    expectedManifestSha256: packageFixture.expectedManifestSha256,
    repositoryRoot: path.resolve(import.meta.dirname, '../../..'),
  });
  return Object.freeze({ input, cleanup: packageFixture.cleanup });
}

function withFirstContentItem(
  input: G1aEvaluationPackage,
  mutate: (item: G1aEvaluationPackage['content'][number]) => G1aEvaluationPackage['content'][number],
): G1aEvaluationPackage {
  return Object.freeze({
    ...input,
    content: Object.freeze(input.content.map((item, index) => index === 0 ? mutate(item) : item)),
  });
}

async function loadedRowCount(owner: Client): Promise<number> {
  const result = await owner.query<{ count: number }>(`
    SELECT (
      (SELECT pg_catalog.count(*) FROM public.authoritative_source_versions)
      + (SELECT pg_catalog.count(*) FROM public.intent_taxonomy_versions)
      + (SELECT pg_catalog.count(*) FROM public.semantic_source_assets)
      + (SELECT pg_catalog.count(*) FROM public.content_releases)
      + (SELECT pg_catalog.count(*) FROM public.release_items)
      + (SELECT pg_catalog.count(*) FROM public.content_current)
      + (SELECT pg_catalog.count(*) FROM public.owner_acceptance_records)
      + (SELECT pg_catalog.count(*) FROM public.owner_acceptance_revocations)
    )::integer AS count
  `);
  return result.rows[0]?.count ?? -1;
}

describeSyntheticRunner('G1A-E0 full synthetic substitute', () => {
  it('rejects direct owner-load tampering atomically and fences revoked or suspended content', async () => {
    const fixture = await createSyntheticG1aE0Package(new Date(), false, true);
    const harness = new Pg15Harness();
    let owner: Client | undefined;
    try {
      const input = await readG1aEvaluationPackage(fixture.inputRoot, { ...fixture,
        repositoryRoot: path.resolve(import.meta.dirname, '../../..') });
      harness.start();
      owner = await harness.connect(harness.createDatabase('owner_load').config);
      await applyDatabaseMigrations(owner);
      const first = input.content[0]!;
      const binding = input.manifest.source_bindings.find((b) => b.domain === first.domain)!;
      const changed = { ...first, answer_text: '已更改但未重新批准的纯合成内容' };
      const rehashed = { ...changed, content_hash: governanceHash(changed, binding.source_ref) };
      for (const invalid of [
        withFirstContentItem(input, () => rehashed),
        withFirstContentItem(input, (item) => ({ ...item, script_version: 2 })),
        withFirstContentItem(input, (item) => ({ ...item, has_conflict: true })),
        { ...input, content: input.content.slice(1) },
        { ...input, content: [...input.content, { ...first, script_id: 'script_synthetic_extra' }] },
        { ...input, owner_acceptance: { ...input.owner_acceptance!, expected_owner_subject_hash: '0'.repeat(64) } },
      ]) {
        await expect(loadG1aEvaluationRelease(owner, invalid)).rejects.toMatchObject({ name: 'G1aLoadError' });
        expect(await loadedRowCount(owner)).toBe(0);
      }
      await loadG1aEvaluationRelease(owner, input);
      const search = () => owner!.query("SELECT * FROM public.search_recommendable_scripts('qianniu',NULL,NULL)");
      expect((await search()).rowCount).toBeGreaterThan(0);
      await owner.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      expect((await search()).rowCount).toBe(0);
      await owner.query('ROLLBACK');
      await owner.query('BEGIN');
      await owner.query("SELECT suspend_authoritative_source($1,'SOURCE_REVOKED','EVD-SYNTHETIC-SUSPEND','synthetic_owner','owner')", [binding.source_version_id]);
      expect((await search()).rowCount).toBe(0);
      await owner.query('ROLLBACK');
      expect((await search()).rowCount).toBeGreaterThan(0);
      await owner.query("SELECT revoke_owner_acceptance('default',$1,'EVD-SYNTHETIC-REVOKE')", [input.owner_acceptance!.record_sha256]);
      expect((await search()).rowCount).toBe(0);
    } finally { await owner?.end(); harness.stop(); await fixture.cleanup(); }
  }, 120_000);

  it('evaluates an owner-anchored package with read-committed fences, zero events and cleanup', async () => {
    const before = await pg15Roots();
    const fixture = await createSyntheticG1aE0Package(new Date(), true, true);
    try {
      const completed = await runG1aEvaluationPackage({ ...fixture,
        repositoryRoot: path.resolve(import.meta.dirname, '../../..') });
      expect(completed.report).toMatchObject({ status: 'NOT_SIGNED', decision: 'NOT_EVALUATED',
        denominator: 50, raw: { positive_top3_hits: 20, safety_no_hits: 12,
          robustness_search_action_correct: 18, forbidden_violations: 0, backend_errors: 0, event_writes: 0 }, failures: [] });
      expect(completed.runtime).toMatchObject({ transaction_isolation: 'read committed',
        transaction_read_only: true, event_rows_before: 0, event_rows_after: 0, cleanup_verified: true });
      expect(await pg15Roots()).toEqual(before);
    } finally { await fixture.cleanup(); }
  }, 120_000);

  it.each([false, true])('verifies an off-repo package and cleans the isolated PG15 runtime (shared workbook: %s)', async (sharedWorkbook) => {
    const packageFixture = await createSyntheticG1aE0Package(new Date(), sharedWorkbook);
    try {
      const completed = await runG1aEvaluationPackage({
        inputRoot: packageFixture.inputRoot,
        expectedManifestSha256: packageFixture.expectedManifestSha256,
        repositoryRoot: path.resolve(import.meta.dirname, '../../..'),
      });

      expect(completed.report).toMatchObject({
        status: 'NOT_SIGNED',
        runner_result: 'EXECUTABLE',
        decision: 'NOT_EVALUATED',
        search_action_result: 'NOT_EVALUATED',
        business_accuracy_claim: 'NOT_EVALUATED',
        downstream_action_evaluation: 'NOT_EVALUATED',
        denominator: 50,
        strata: {
          positive: { total: 20, search_action_correct: 20 },
          safety_negative: { total: 12, search_action_correct: 12 },
          robustness: { total: 18, search_action_correct: 18 },
        },
        raw: {
          positive_top3_hits: 20,
          safety_no_hits: 12,
          robustness_search_action_correct: 18,
          forbidden_violations: 0,
          backend_errors: 0,
          event_writes: 0,
          process_guard_attempts: 0,
        },
        failures: [],
      });
      expect(completed.runtime).toMatchObject({
        postgres_major: 15,
        transaction_isolation: 'repeatable read',
        transaction_read_only: true,
        event_rows_before: 0,
        event_rows_after: 0,
        cleanup_verified: true,
      });
    } finally {
      await packageFixture.cleanup();
    }
  }, 120_000);

  it('destroys the isolated PG15 runtime when frozen evaluation time is invalid', async () => {
    const packageFixture = await createSyntheticG1aE0Package();
    const before = await pg15Roots();
    try {
      const verified = await readG1aEvaluationPackage(packageFixture.inputRoot, {
        expectedManifestSha256: packageFixture.expectedManifestSha256,
        repositoryRoot: path.resolve(import.meta.dirname, '../../..'),
      });
      const invalid = Object.freeze({
        ...verified,
        cases: Object.freeze(verified.cases.map((testCase) => Object.freeze({
          ...testCase,
          as_of: '2020-01-01T00:00:00.000Z',
        }))),
      });

      await expect(runVerifiedG1aEvaluation(invalid)).rejects.toMatchObject({
        code: 'G1A_RUNTIME_TIME_INVALID',
      });
      expect(await pg15Roots()).toEqual(before);
    } finally {
      await packageFixture.cleanup();
    }
  }, 120_000);

  it('rolls back the complete load on governance, question, and source-gate failures', async () => {
    const packageFixture = await verifiedSyntheticPackage();
    const harness = new Pg15Harness();
    let owner: Client | undefined;
    try {
      harness.start();
      const database = harness.createDatabase('g1a_load_rollback');
      owner = await harness.connect(database.config);
      await applyDatabaseMigrations(owner);

      const duplicateDomain = Object.freeze({
        ...packageFixture.input,
        manifest: Object.freeze({
          ...packageFixture.input.manifest,
          source_bindings: Object.freeze([
            ...packageFixture.input.manifest.source_bindings,
            Object.freeze({
              ...packageFixture.input.manifest.source_bindings[0]!,
              source_version_id: 'srcv_synthetic_duplicate_domain',
            }),
          ]),
        }),
      });
      await expect(loadG1aEvaluationRelease(owner, duplicateDomain)).rejects.toMatchObject({
        code: 'G1A_LOAD_CONTRACT_INVALID',
      });
      expect(await loadedRowCount(owner)).toBe(0);

      const governanceMismatch = withFirstContentItem(packageFixture.input, (item) => Object.freeze({
        ...item,
        content_hash: 'f'.repeat(64),
      }));
      await expect(loadG1aEvaluationRelease(owner, governanceMismatch)).rejects.toMatchObject({
        code: 'G1A_LOAD_GOVERNANCE_HASH_MISMATCH',
      });
      expect(await loadedRowCount(owner)).toBe(0);

      const questionMismatch = withFirstContentItem(packageFixture.input, (item) => Object.freeze({
        ...item,
        questions: Object.freeze(item.questions.map((question, index) => index === 0
          ? Object.freeze({ ...question, question_hash: 'f'.repeat(64) })
          : question)),
      }));
      await expect(loadG1aEvaluationRelease(owner, questionMismatch)).rejects.toMatchObject({
        code: 'G1A_LOAD_CONTRACT_INVALID',
      });
      expect(await loadedRowCount(owner)).toBe(0);

      const sourceGateMismatch = Object.freeze({
        ...packageFixture.input,
        manifest: Object.freeze({
          ...packageFixture.input.manifest,
          source_binding_hash: 'f'.repeat(64),
        }),
      });
      await expect(loadG1aEvaluationRelease(owner, sourceGateMismatch)).rejects.toMatchObject({
        code: 'G1A_LOAD_SOURCE_GATE_NOT_READY',
      });
      expect(await loadedRowCount(owner)).toBe(0);
    } finally {
      await owner?.end();
      harness.stop();
      await packageFixture.cleanup();
    }
  }, 120_000);

  it('destroys the isolated runtime when loading fails before evaluation', async () => {
    const packageFixture = await verifiedSyntheticPackage();
    const before = await pg15Roots();
    try {
      const invalid = withFirstContentItem(packageFixture.input, (item) => Object.freeze({
        ...item,
        content_hash: 'f'.repeat(64),
      }));
      await expect(runVerifiedG1aEvaluation(invalid)).rejects.toMatchObject({
        code: 'G1A_LOAD_GOVERNANCE_HASH_MISMATCH',
      });
      expect(await pg15Roots()).toEqual(before);
    } finally {
      await packageFixture.cleanup();
    }
  }, 120_000);
});


describeSyntheticRunner('PG15 to safe delivery and durable consumer', () => {
  it('does not emit a delivery when the real PG cleanup reports failure', async () => {
    const before = await pg15Roots();
    const fixture = await createSyntheticG1aE0Package(new Date(),true,true);
    const stop = Pg15Harness.prototype.stop;
    const failedStop = vi.spyOn(Pg15Harness.prototype,'stop').mockImplementation(function (this: Pg15Harness) {
      stop.call(this);
      throw new Error('synthetic cleanup failure after resource removal');
    });
    let emitted = '';
    try {
      await expect((async () => {
        const completed = await runG1aEvaluationPackage({...fixture,repositoryRoot:path.resolve(import.meta.dirname,'../../..')});
        emitted = serializeG1aDelivery(completed);
      })()).rejects.toThrow('G1A_RUNTIME_CLEANUP_FAILED');
      expect(emitted).toBe('');
    } finally { failedStop.mockRestore(); await fixture.cleanup(); }
    expect(await pg15Roots()).toEqual(before);
  },120_000);

  it.each(['all_match','retrieval_miss','safety_failure'] as const)('retains %s through the actual CLI consumer and private readback', async (scenario) => {
    const before = await pg15Roots();
    const fixture = await createSyntheticG1aE0Package(new Date(),true,true);
    const outputRoot = await mkdtemp(path.join(os.tmpdir(),'g1a-delivery-'));
    try {
      const input = await readG1aEvaluationPackage(fixture.inputRoot,{...fixture,repositoryRoot: path.resolve(import.meta.dirname,'../../..')});
      const cases = structuredClone(input.cases);
      const expectations = structuredClone(input.expectations);
      const positive = cases.find((row) => row.stratum === 'positive')!;
      if (scenario === 'retrieval_miss') Object.assign(positive,{ query_text: 'syntheticnomatchingphraseabcdef' });
      if (scenario === 'safety_failure') {
        const safety = cases.find((row) => row.stratum === 'safety_negative')!;
        Object.assign(safety,{ query_text: positive.query_text,platform: positive.platform,product_context_type: positive.product_context_type,product_context_ref: positive.product_context_ref });
        Object.assign(expectations.find((row) => row.case_id === safety.case_id)!,{
          forbidden_script_ids: expectations.find((row) => row.case_id === positive.case_id)!.acceptable_script_ids });
      }
      // Only this fresh synthetic fixture exercises the controlled grading branch.
      // This is not real content, an approval or a retry of any controlled run.
      const manifest = structuredClone(input.manifest);
      Object.assign(manifest,{ classification: 'approved_redacted' });
      for (const [name, rows] of [['cases.jsonl',cases],['expectations.jsonl',expectations]] as const) {
        const bytes = jsonLines(rows);
        await writeFile(path.join(fixture.inputRoot,name),bytes);
        Object.assign(manifest.files,{ [name]: { sha256: createHash('sha256').update(bytes).digest('hex'),bytes: Buffer.byteLength(bytes),records: rows.length } });
      }
      const manifestBytes = jsonLine(manifest);
      await writeFile(path.join(fixture.inputRoot,'manifest.json'),manifestBytes);
      const anchor = createHash('sha256').update(manifestBytes).digest('hex');
      const completed = await runG1aEvaluationPackage({...fixture,expectedManifestSha256:anchor,repositoryRoot:path.resolve(import.meta.dirname,'../../..')});
      const line = serializeG1aDelivery(completed);
      const consumer = spawnSync(process.execPath,['scripts/read-g1a-delivery.mjs',anchor],{
        cwd: path.resolve(import.meta.dirname,'../../..'),input:line,encoding:'utf8' });
      expect(consumer.status,consumer.stderr).toBe(0);
      const destination = path.join(outputRoot,'delivery.json');
      await writeFile(destination,consumer.stdout,{mode:0o600,flag:'wx'});
      expect((await stat(destination)).mode & 0o777).toBe(0o600);
      const delivery = readG1aDelivery(G1A_DELIVERY_PREFIX + (await readFile(destination,'utf8')).trim(),anchor);
      expect(delivery.report.case_results).toHaveLength(50);
      expect(delivery.report.raw).toEqual(completed.report.raw);
      expect(delivery.runtime).toMatchObject({postgres_major:15,transaction_isolation:'read committed',transaction_read_only:true,cleanup_verified:true,event_rows_before:0,event_rows_after:0});
      expect(delivery.report.raw.positive_top3_hits).toBe(scenario === 'retrieval_miss' ? 19 : 20);
      expect(delivery.report.raw.safety_no_hits).toBe(scenario === 'safety_failure' ? 11 : 12);
      expect(delivery.report.runner_result).toBe(scenario === 'safety_failure' ? 'FAILED' : 'EXECUTABLE');
      await expect(writeFile(destination,'overwrite',{flag:'wx'})).rejects.toMatchObject({code:'EEXIST'});
      const duplicate = spawnSync(process.execPath,['scripts/read-g1a-delivery.mjs',anchor],{cwd:path.resolve(import.meta.dirname,'../../..'),input:line+line,encoding:'utf8'});
      expect(duplicate.status).toBe(1); expect(duplicate.stdout).toBe(''); expect(duplicate.stderr).not.toContain(anchor);
    } finally { await fixture.cleanup(); await rm(outputRoot,{recursive:true,force:true}); }
    expect(await pg15Roots()).toEqual(before);
  },120_000);
});
