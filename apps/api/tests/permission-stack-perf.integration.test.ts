import { describe, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Client } from 'pg';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createMockAuthService } from '../src/auth-service.js';
import { createContentReleaseService } from '../src/content-release-service.js';
import { registerContentReleaseRoutes } from '../src/content-release-routes.js';
import { seedContentWriteAuthority } from './support/write-authority.js';

/**
 * Perf probe for the denial path of the write doors. The synthetic intake host does not mount
 * the release routes, so this file stands up the real release routes on a real PG15 database.
 * It prints one JSON line with medians; permission-server-deadline-plan.md caps a denial call
 * at 300 ms.
 *
 * Every sample at one door must return the same non-success status, and that status is printed,
 * so an accepted write can never be reported as a denial latency.
 */
const enabled = process.env.CUSTOMER_AGENT_PERF_PROBE === '1';
const SAMPLES = 20;
const HMAC = Object.freeze({
  currentVersion: 'hmac-idempotency-v1',
  keys: Object.freeze({ 'hmac-idempotency-v1': 'synthetic-perf-idempotency-material-001' }),
});
const LOG_HASH = Object.freeze({ version: 'hmac-log-v1', key: 'synthetic-perf-log-hash-material-0000001' });

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2) : sorted[middle]!;
}

describe.runIf(enabled)('permission stack perf probe', () => {
  it('measures the publish refusal after the source-set read', async () => {
    const harness = new Pg15Harness();
    harness.start();
    let admin: Client | undefined;
    let app: FastifyInstance | undefined;
    try {
      const database = harness.createDatabase('perf_probe');
      admin = await harness.connect(database.config);
      await applyDatabaseMigrations(admin);
      // The agent holds query only, so every write door must refuse it. Seeding the principal,
      // facts, role rule, scope, source and one live query row goes through the shared helper.
      await seedContentWriteAuthority(admin, {
        tenantId: 'tenant-perf', appId: 'app-perf', brandId: 'brand-perf',
        signer: { principalId: 'perf-signer', userId: 'usr_perf_signer', jobId: 'job-perf-director', role: 'director' },
        // One actor per sample, because a burst of refusals from one actor trips the product
        // rate limiter and that 429 would replace the denial latency being measured.
        recipients: Array.from({ length: SAMPLES + 2 }, (_, index) => ({
          principalId: `perf-agent-${index}`,
          userId: `usr_perf_agent_${index}`,
          jobId: `job-perf-agent-${index}`,
          role: 'agent' as const,
        })),
        domains: ['product'],
        actions: ['query'],
        query: true,
      });
      // A staged batch with a real binding, so the publish request reaches the domain gate
      // instead of failing earlier on a missing batch.
      await admin.query(`INSERT INTO public.authoritative_source_versions(
          source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
          use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at, tenant_id)
        VALUES ('srcv_perf_product','SRC-PERF-PRODUCT','product','v1',repeat('ab',32),
          'canonical','ROLE-CONTENT-LEAD','EVD-PERF','synthetic-owner',
          '2020-01-01T00:00:00Z','2099-01-01T00:00:00Z','tenant-perf')`);
      await admin.query(`INSERT INTO public.import_batches(import_batch_id, source_type, source_binding_hash, status, tenant_id)
        VALUES ('perf_staged_batch','csv',repeat('ab',32),'staged','tenant-perf')`);
      await admin.query("SELECT set_config('app.import_binding_write','on',false)");
      await admin.query(`INSERT INTO public.import_batch_source_bindings(import_batch_id, domain, source_version_id)
        VALUES ('perf_staged_batch','product','srcv_perf_product')`);

      // The release service connects as the runtime capability, not as the cluster owner.
      await admin.query('CREATE ROLE perf_runtime LOGIN; GRANT app_runtime TO perf_runtime');
      const connectionString = `postgresql://perf_runtime@localhost/${database.name}?${new URLSearchParams({
        host: harness.socket, port: String(harness.port),
      })}`;
      const release = createContentReleaseService({
        connectionString, poolMax: 4, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000,
      }, HMAC, LOG_HASH);
      const auth = createMockAuthService();
      app = Fastify({ logger: false });
      registerContentReleaseRoutes(app, auth, { service: release });
      await app.ready();
      const tokens = Array.from({ length: SAMPLES + 2 }, (_, index) =>
        auth.createMockSession({ user_id: `usr_perf_agent_${index}`, role: 'agent' }).token);

      const knock = async (index: number) => {
        const response = await app!.inject({
          method: 'POST', url: '/v1/content/publish',
          headers: { authorization: `Bearer ${tokens[index]}`, 'idempotency-key': `perf-publish-${index}`, 'content-type': 'application/json' },
          payload: { import_batch_id: 'perf_staged_batch', title: 'perf', summary: 'perf' },
        });
        return response.statusCode;
      };

      // The route itself caps publish at five calls per minute per process, so twenty samples
      // cannot be taken in a burst. Take four per minute window and let the window roll over;
      // a 429 is the product's own answer, not a denial latency.
      const PER_WINDOW = 4;
      const statuses: number[] = [];
      const elapsed: number[] = [];
      for (let index = 0; index < SAMPLES; index += 1) {
        if (index > 0 && index % PER_WINDOW === 0) {
          const waited = await new Promise<number>(resolve => {
            const started = Date.now();
            setTimeout(() => resolve(Date.now() - started), 61_000);
          });
          if (waited < 60_000) throw new Error('window wait was too short');
        }
        const started = performance.now();
        statuses.push(await knock(index));
        elapsed.push(performance.now() - started);
      }
      const first = statuses[0]!;
      if (statuses.some(status => status !== first)) throw new Error(`mixed statuses ${[...new Set(statuses)].join(',')}`);
      if (first < 400) throw new Error(`the agent was allowed to publish (${first})`);
      console.log(`PERF ${JSON.stringify({ samples: SAMPLES, publishDenial: { status: first, medianMs: median(elapsed) } })}`);
      await release.close();
      await auth.close();
    } finally {
      await app?.close();
      await admin?.end();
      harness.stop();
    }
  }, 900_000);
});
