import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client, ClientConfig } from 'pg';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createSearchRepository } from '../src/search-repository.js';
import { createSearchBackend, type SearchBackend } from '../src/search-service.js';
import {
  readSyntheticG1aCases,
  runSyntheticG1a,
  seedSyntheticG1aRelease,
} from './support/synthetic-g1a.js';

const describeRunner = process.env.CUSTOMER_AGENT_API_G1A_RUNNER === '1'
  ? describe.sequential
  : describe.skip;

describeRunner('DEV-M1 synthetic G1a runner', () => {
  let harness: Pg15Harness;
  let database: Readonly<{ name: string; config: ClientConfig }>;
  let owner: Client;
  let runtime: Client;
  let backend: SearchBackend;

  beforeAll(async () => {
    harness = new Pg15Harness();
    harness.start();
    database = harness.createDatabase('g1a_runner');
    owner = await harness.connect(database.config);
    await applyDatabaseMigrations(owner);
    await owner.query('CREATE ROLE g1a_synthetic_runtime LOGIN');
    await owner.query('GRANT app_runtime TO g1a_synthetic_runtime');
    await seedSyntheticG1aRelease(owner);
    runtime = await harness.connect({ ...database.config, user: 'g1a_synthetic_runtime' });
    const repository = createSearchRepository(runtime as never);
    backend = createSearchBackend({ searchCandidates: repository.search });
  }, 120_000);

  afterAll(async () => {
    await runtime?.end();
    await owner?.end();
    harness?.stop();
  }, 60_000);

  it('executes the frozen 20 + 12 + 18 denominator without claiming a signed threshold', async () => {
    const fixture = await readSyntheticG1aCases();
    const report = await runSyntheticG1a(backend, fixture);

    process.stdout.write(`G1A_SYNTHETIC_RUNNER_REPORT ${JSON.stringify(report)}\n`);

    expect(report).toMatchObject({
      status: 'NOT_SIGNED',
      runner_result: 'EXECUTABLE',
      business_accuracy_claim: 'NOT_EVALUATED',
      denominator: 50,
      strata: {
        positive: { total: 20, correct: 20 },
        safety_negative: { total: 12, correct: 12 },
        robustness: { total: 18, correct: 18 },
      },
      raw: {
        expected_hit_total: 38,
        hit_at_3_count: 38,
        expected_no_hit_total: 12,
        no_hit_count: 12,
        forbidden_violations: 0,
        backend_errors: 0,
      },
      failures: [],
    });
  });
});
