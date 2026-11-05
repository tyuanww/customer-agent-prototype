import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import type { components } from '@customer-agent/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseAccessEvaluator } from '../src/access/database.js';
import { projectQueryAccess, type AccessEvaluator } from '../src/access/evaluator.js';
import { createGrants, previewGrants } from '../src/content-intake/authority.js';
import { createIntakePurposePool, type IntakePurposePool } from '../src/content-intake/runtime-pool.js';
import { principal, type IntakeTransaction } from '../src/content-intake/transaction.js';
import {
  createAuthorizationFixture,
  type AuthorizationFixture,
} from './support/authorization-sources-fixture.js';

const enabled = process.env.CUSTOMER_AGENT_ACL_BENCHMARK === '1';
const overlay = fileURLToPath(new URL(
  '../../../packages/database/overlays/0082_access_evaluator.sql',
  import.meta.url,
));
const REQUESTS = 500;
const WARMUPS = 20;
const CONCURRENCY = 20;

type Sample = Readonly<{
  action: string;
  scopes: number;
  coldMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errors: number;
  concurrency: number;
  poolMax: number;
}>;

function percentile(values: readonly number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1);
  return Math.round(sorted[index]! * 1_000) / 1_000;
}

async function parallel(requests: number, work: (index: number) => Promise<void>): Promise<number> {
  let cursor = 0;
  let errors = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= requests) return;
      try {
        await work(index);
      } catch {
        errors += 1;
      }
    }
  }));
  return errors;
}

function transaction(client: PoolClient): IntakeTransaction {
  return Object.assign(client, {
    validUntil() {},
    beforeCommit() {},
  }) as IntakeTransaction;
}

describe.skipIf(!enabled)('AccessEvaluator benchmark', () => {
  let fixture: AuthorizationFixture;
  let pool: IntakePurposePool;
  let evaluator: AccessEvaluator;
  let policyVersion = 1;

  beforeAll(async () => {
    fixture = await createAuthorizationFixture('access_evaluator_benchmark');
    await fixture.admin.query('BEGIN');
    try {
      await fixture.admin.query(readFileSync(overlay, 'utf8'));
      await fixture.admin.query("CREATE ROLE access_benchmark_business LOGIN NOINHERIT");
      await fixture.admin.query('GRANT intake_business TO access_benchmark_business');
      await fixture.admin.query('SET CONSTRAINTS ALL DEFERRED');

      for (const [id, userId, jobId] of [
        ['bench-one-allow', 'user-bench-one-allow', 'job-director'],
        ['bench-one-deny', 'user-bench-one-deny', 'job-agent'],
        ['bench-hundred-allow', 'user-bench-hundred-allow', 'job-director'],
        ['bench-hundred-deny', 'user-bench-hundred-deny', 'job-agent'],
      ] as const) {
        await fixture.admin.query(`INSERT INTO backend_identity.subject_bindings(
            binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
          VALUES ($1,'synthetic','tenant-menokin',$1,$2,repeat('7a',32),true,'owner')`, [id, userId]);
        await fixture.admin.query(`INSERT INTO content_intake.principals(
            principal_id,user_id,tenant_id,app_id,identity_scope,person_key,current_facts_version)
          VALUES ($1,$2,'tenant-menokin','app-customer-agent','confirmed-synthetic',$1,1)`, [id, userId]);
        await fixture.admin.query(`INSERT INTO content_intake.principal_facts(
            principal_id,facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest)
          VALUES ($1,1,ARRAY['dept-a'],$2,true,statement_timestamp()-interval '1 second',
            statement_timestamp()+interval '4 minutes',repeat('7b',32))`, [id, jobId]);
      }

      await fixture.admin.query(`
        INSERT INTO content_intake.scopes(scope_id,tenant_id,app_id,brand_id,domain)
        SELECT 'scope-bench-'||n,'tenant-menokin','app-customer-agent','brand-bench-'||n,'product'
        FROM generate_series(1,100) n`);
      await fixture.admin.query(`
        INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode)
        SELECT 'source-bench-'||n,'scope-bench-'||n,1,'v2-preview'
        FROM generate_series(1,100) n`);
      await fixture.admin.query(`
        INSERT INTO content_intake.source_mappings(
          source_id,version,template_version,rule_version,mapping_version,structure_digest)
        SELECT 'source-bench-'||n,1,'faq-p1.1','intake-p1.1','faq-map',repeat('7c',32)
        FROM generate_series(1,100) n`);
      await fixture.admin.query(`
        INSERT INTO content_intake.store_set_members(
          tenant_id,app_id,version,scope_id,source_id,content_valid_until)
        SELECT 'tenant-menokin','app-customer-agent',1,'scope-bench-'||n,'source-bench-'||n,
          clock_timestamp()+interval '1 day'
        FROM generate_series(1,100) n`);
      await fixture.admin.query(`
        INSERT INTO content_intake.grants(
          grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,
          starts_at,expires_at,reason,steward_id)
        SELECT 'alloc-bench-'||n,'allocation','signer','signer','tenant-menokin','app-customer-agent',
          'scope-bench-'||n,'query',clock_timestamp()-interval '2 minutes',
          clock_timestamp()+interval '2 days','合成基准分配','signer'
        FROM generate_series(1,100) n`);
      const current = await fixture.admin.query<{ policy_version: string }>(
        `SELECT version::text AS policy_version FROM content_intake.policy_versions
         WHERE tenant_id='tenant-menokin' AND app_id='app-customer-agent'`,
      );
      policyVersion = Number(current.rows[0]?.policy_version);
      await fixture.admin.query(`
        INSERT INTO content_intake.grants(
          grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,
          starts_at,expires_at,revoked_at,reason,steward_id,parent_grant_id,policy_version,store_set_version)
        SELECT 'business-bench-allow-'||n,'business','signer','bench-hundred-allow',
          'tenant-menokin','app-customer-agent','scope-bench-'||n,'source-bench-'||n,'query',
          clock_timestamp()-interval '1 minute',clock_timestamp()+interval '10 minutes',NULL,
          '合成基准查询','signer','alloc-bench-'||n,$1,1
        FROM generate_series(1,100) n`, [policyVersion]);
      await fixture.admin.query(`
        INSERT INTO content_intake.grants(
          grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,
          starts_at,expires_at,reason,steward_id)
        SELECT 'alloc-issuer-bench-'||n,'allocation','bench-hundred-allow','bench-hundred-allow',
          'tenant-menokin','app-customer-agent','scope-bench-'||n,'query',
          clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '2 days',
          '合成基准签发分配','bench-hundred-allow'
        FROM generate_series(1,100) n`);
      await fixture.admin.query(`INSERT INTO content_intake.grants(
          grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,
          starts_at,expires_at,reason,steward_id,parent_grant_id,policy_version,store_set_version)
        VALUES ('business-bench-one-allow','business','signer','bench-one-allow',
          'tenant-menokin','app-customer-agent','scope-product','source-a','query',
          clock_timestamp()-interval '1 minute',clock_timestamp()+interval '10 minutes',
          '合成基准单范围查询','signer','grant-alloc-query',$1,1)`, [policyVersion]);
      await fixture.admin.query(`INSERT INTO content_intake.grants(
          grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,
          starts_at,expires_at,reason,steward_id)
        VALUES ('alloc-issuer-one','allocation','bench-one-allow','bench-one-allow',
          'tenant-menokin','app-customer-agent','scope-product','query',
          clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '2 days',
          '合成基准单范围签发分配','bench-one-allow')`);
      await fixture.admin.query(`
        INSERT INTO content_intake.grants(
          grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,
          starts_at,expires_at,revoked_at,reason,steward_id,parent_grant_id,policy_version,store_set_version)
        SELECT 'business-bench-deny-'||n,'business','signer','bench-hundred-deny',
          'tenant-menokin','app-customer-agent','scope-bench-'||n,'source-bench-'||n,'query',
          clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '10 minutes',
          clock_timestamp()-interval '1 minute','合成基准撤权','signer','alloc-bench-'||n,$1,1
        FROM generate_series(1,100) n`, [policyVersion]);
      await fixture.admin.query(`
        INSERT INTO content_intake.grants(
          grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,
          starts_at,expires_at,revoked_at,reason,steward_id,parent_grant_id,policy_version,store_set_version)
        VALUES ('business-bench-one-deny','business','signer','bench-one-deny',
          'tenant-menokin','app-customer-agent','scope-bench-1','source-bench-1','query',
          clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '10 minutes',
          clock_timestamp()-interval '1 minute','合成基准单范围撤权','signer','alloc-bench-1',$1,1)`,
      [policyVersion]);
      await fixture.admin.query('COMMIT');
    } catch (error) {
      await fixture.admin.query('ROLLBACK');
      throw error;
    }
    pool = createIntakePurposePool({
      ...fixture.database.config,
      user: 'access_benchmark_business',
      max: CONCURRENCY,
    }, 'business');
    evaluator = createDatabaseAccessEvaluator(pool);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await fixture?.close();
  }, 60_000);

  async function withTransaction<T>(work: (tx: IntakeTransaction) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    const tx = transaction(client);
    let failed = false;
    try {
      await client.query('BEGIN');
      const value = await work(tx);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      failed = true;
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release(failed);
    }
  }

  function grantBatch(operationId: string, scopes: number): components['schemas']['IntakeGrantBatch'] {
    return {
      operationId,
      issuerFactsVersion: 1,
      policyVersion,
      items: Array.from({ length: scopes }, (_, index) => ({
        kind: 'business',
        recipientPrincipalId: 'director',
        recipientFactsVersion: 1,
        action: 'query' as const,
        scope: {
          tenantId: 'tenant-menokin',
          appId: 'app-customer-agent',
          brandId: index === 0 && scopes === 1 ? 'brand-a' : `brand-bench-${index + 1}`,
          shopId: null,
          domain: 'product',
          sourceId: index === 0 && scopes === 1 ? 'source-a' : `source-bench-${index + 1}`,
        },
        startsAt: new Date(Date.now() - 1_000).toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        reason: '合成基准授予',
      })),
    };
  }

  async function measure(
    action: string,
    scopes: number,
    work: (index: number) => Promise<void>,
  ): Promise<Sample> {
    for (let index = 0; index < WARMUPS; index += 1) await work(index);
    const coldStart = performance.now();
    await work(WARMUPS);
    const coldMs = performance.now() - coldStart;
    const samples: number[] = [];
    const errors = await parallel(REQUESTS, async (index) => {
      const start = performance.now();
      await work(index + WARMUPS + 1);
      samples.push(performance.now() - start);
    });
    return {
      action,
      scopes,
      coldMs: Math.round(coldMs * 1_000) / 1_000,
      p50Ms: percentile(samples, 0.50),
      p95Ms: percentile(samples, 0.95),
      p99Ms: percentile(samples, 0.99),
      errors,
      concurrency: CONCURRENCY,
      poolMax: CONCURRENCY,
    };
  }

  it('measures allowed, denied, preview, and commit at one and one hundred scopes', async () => {
    const samples: Sample[] = [];
    for (const [scopes, userId, expected] of [
      [1, 'user-bench-one-allow', 'allowed'],
      [1, 'user-bench-one-deny', 'denied'],
      [100, 'user-bench-hundred-allow', 'allowed'],
      [100, 'user-bench-hundred-deny', 'denied'],
    ] as const) {
      samples.push(await measure(`read-${expected}`, scopes, async () => {
        const evaluation = await evaluator.evaluate(userId);
        expect(projectQueryAccess(evaluation.decision!, evaluation.actionReasons.query).state)
          .toBe(expected);
      }));
    }

    for (const scopes of [1, 100] as const) {
      const preview = grantBatch(`benchmark-preview-${scopes}`, scopes);
      const issuerPrincipalId = scopes === 1 ? 'bench-one-allow' : 'bench-hundred-allow';
      samples.push(await measure('grant-preview', scopes, async () => {
        await withTransaction(async (tx) => {
          const issuer = await principal(tx, { id: issuerPrincipalId });
          await previewGrants(tx, issuer, preview);
        });
      }));
      samples.push(await measure('grant-commit', scopes, async (index) => {
        await withTransaction(async (tx) => {
          const issuer = await principal(tx, { id: issuerPrincipalId });
          await createGrants(tx, issuer, grantBatch(`benchmark-commit-${scopes}-${index}`, scopes));
        });
      }));
    }

    expect(samples.every((sample) => sample.errors === 0)).toBe(true);
    console.log(`ACL_BENCHMARK ${JSON.stringify({
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        database: 'PostgreSQL 15 isolated',
      },
      requests: REQUESTS,
      warmups: WARMUPS,
      concurrency: CONCURRENCY,
      coldState: 'warm pool, first measured operation after 20 warmups',
      limiter: '20 concurrent callers; intake business pool max 20',
      samples,
    })}`);
  }, 900_000);
});
