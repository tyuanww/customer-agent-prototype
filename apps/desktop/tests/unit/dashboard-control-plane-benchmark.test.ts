// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { arch, cpus, loadavg, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  DashboardControlPlane,
  FileDashboardOperationStore,
  type DashboardControlPlaneSession,
  type DashboardOperationStore,
  type DashboardStoredOperation,
} from '../../src/main/dashboard-control-plane';

const enabled = process.env.CUSTOMER_AGENT_DASHBOARD_OPERATION_BENCHMARK === '1';
const RUN_COUNT = 5;
const MUTATIONS_PER_RUN = 50;
const READS_PER_RUN = 100;
const RECOVERIES_PER_RUN = 21;
const DASHBOARD_DOMAINS = ['release', 'permissions', 'accounts', 'materials', 'rollback', 'ops-loop'] as const;

type Latency = Readonly<{ p50: number; p95: number; p99: number }>;

type RunReport = Readonly<{
  run: number;
  coldMs: Readonly<{
    acceptance: number;
    readProjection: number;
    statusLookup: number;
    recovery: number;
  }>;
  latencyMs: Readonly<{
    acceptance: Latency;
    readProjection: Latency;
    statusLookup: Latency;
    recovery: Latency;
  }>;
  storeWriteMs: Readonly<Latency & { calls: number }>;
  readCalls: Readonly<{ projection: number; status: number; total: number }>;
  errors: number;
}>;

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function latency(values: readonly number[]): Latency {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  };
}

function median(values: readonly number[]): number {
  return percentile(values, 0.5);
}

async function runBenchmark(run: number): Promise<RunReport> {
  const directory = await mkdtemp(join(tmpdir(), `dashboard-operation-benchmark-${String(run)}-`));
  const path = join(directory, 'operations.json');
  const fileStore = new FileDashboardOperationStore(path);
  const storeWrite: number[] = [];
  const store: DashboardOperationStore = {
    read: fileStore.read.bind(fileStore),
    async write(records: readonly DashboardStoredOperation[]) {
      const started = performance.now();
      await fileStore.write(records);
      storeWrite.push(performance.now() - started);
    },
  };
  let epoch = 1;
  const session: DashboardControlPlaneSession = {
    view: () => ({
      ok: true,
      enabled: true,
      signedIn: true,
      sessionEpoch: epoch,
      userId: 'synthetic-benchmark-user',
      role: 'owner',
    }),
    request: async () => ({ value: {} }),
  };
  const plane = new DashboardControlPlane({
    session,
    store,
    access: {
      read: async () => ({
        sessionEpoch: epoch,
        accessRevision: 17,
        expiresAt: '2099-01-01T00:00:00.000Z',
        grants: 'open',
        accounts: 'open',
        denyReason: null,
      }),
    },
    releaseInvalidation: async () => undefined,
  });
  const readProjection: number[] = [];
  const statusLookup: number[] = [];
  const acceptance: number[] = [];
  const recovery: number[] = [];
  let errors = 0;

  const mutate = async (index: number, record = true) => {
    const domain = DASHBOARD_DOMAINS[index % DASHBOARD_DOMAINS.length]!;
    const started = performance.now();
    let acceptedAt: number | null = null;
    const stop = plane.subscribe(() => {
      if (acceptedAt !== null) return;
      if (plane.currentSync().some((view) => (
        view.domain === domain
        && (view.state === 'accepted' || view.state === 'running')
      ))) acceptedAt = performance.now();
    });
    try {
      await plane.submit({
        domain,
        command: 'content-manage',
        capability: `${domain}:benchmark`,
        intent: { benchmark: index },
        execute: async () => ({ kind: 'committed', resultRef: `result-${String(index)}` }),
      });
      if (acceptedAt === null) throw new Error('acceptance projection was not observed');
      if (record) acceptance.push(acceptedAt - started);
    } catch {
      errors += 1;
    } finally {
      stop();
    }
  };

  try {
    for (let index = 0; index < 20; index += 1) {
      await mutate(index, false);
      await plane.current();
      plane.currentSync();
    }
    storeWrite.length = 0;

    for (let index = 0; index < MUTATIONS_PER_RUN; index += 1) {
      const projectionStarted = performance.now();
      plane.currentSync();
      readProjection.push(performance.now() - projectionStarted);

      const statusStarted = performance.now();
      await plane.current();
      statusLookup.push(performance.now() - statusStarted);

      await mutate(20 + index);
    }
    const measuredStoreWrite = [...storeWrite];

    plane.registerRecovery('release', async () => ({ kind: 'committed', resultRef: 'recovered' }));
    for (let index = 0; index < 20; index += 1) {
      await plane.submit({
        domain: 'release',
        command: 'publish',
        capability: 'release:publish',
        intent: { benchmarkUnknown: index },
        execute: async () => ({ kind: 'unknown' }),
      });
      const started = performance.now();
      await plane.recover('release');
      recovery.push(performance.now() - started);
    }

    await plane.submit({
      domain: 'materials',
      command: 'import',
      capability: 'materials:import',
      intent: { benchmarkStaleRecovery: true },
      execute: async () => ({ kind: 'unknown' }),
    });
    epoch += 1;
    plane.registerRecovery('materials', async () => ({ kind: 'committed', resultRef: 'stale-recovered' }));
    const staleStarted = performance.now();
    const stale = await plane.recover('materials');
    recovery.push(performance.now() - staleStarted);

    expect(readProjection).toHaveLength(MUTATIONS_PER_RUN);
    expect(statusLookup).toHaveLength(MUTATIONS_PER_RUN);
    expect(readProjection.length + statusLookup.length).toBe(READS_PER_RUN);
    expect(acceptance).toHaveLength(MUTATIONS_PER_RUN);
    expect(recovery).toHaveLength(RECOVERIES_PER_RUN);
    expect(stale?.state).toBe('committed');
    expect(errors).toBe(0);

    return {
      run,
      coldMs: {
        acceptance: acceptance[0] ?? 0,
        readProjection: readProjection[0] ?? 0,
        statusLookup: statusLookup[0] ?? 0,
        recovery: recovery[0] ?? 0,
      },
      latencyMs: {
        acceptance: latency(acceptance),
        readProjection: latency(readProjection),
        statusLookup: latency(statusLookup),
        recovery: latency(recovery),
      },
      storeWriteMs: {
        ...latency(measuredStoreWrite),
        calls: measuredStoreWrite.length,
      },
      readCalls: {
        projection: readProjection.length,
        status: statusLookup.length,
        total: readProjection.length + statusLookup.length,
      },
      errors,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

it.skipIf(!enabled)('measures five runs of 100 interleaved reads across 50 mutations', async () => {
  const runs: RunReport[] = [];
  for (let run = 1; run <= RUN_COUNT; run += 1) runs.push(await runBenchmark(run));

  const summary = Object.fromEntries(
    (['acceptance', 'readProjection', 'statusLookup', 'recovery'] as const).map((metric) => [
      metric,
      {
        p50: median(runs.map((run) => run.latencyMs[metric].p50)),
        p95: median(runs.map((run) => run.latencyMs[metric].p95)),
        p99: median(runs.map((run) => run.latencyMs[metric].p99)),
      },
    ]),
  );
  const report = {
    environment: {
      node: process.version,
      platform: platform(),
      arch: arch(),
      kernel: release(),
      cpus: cpus().length,
      memoryBytes: totalmem(),
      loadAverage: loadavg(),
    },
    method: {
      runs: RUN_COUNT,
      warmupMutationsPerRun: 20,
      mutationsPerRun: MUTATIONS_PER_RUN,
      interleavedReadsPerRun: READS_PER_RUN,
      recoveriesPerRun: RECOVERIES_PER_RUN,
      store: 'FileDashboardOperationStore',
      concurrency: 1,
    },
    summary,
    runs,
    errors: runs.reduce((total, run) => total + run.errors, 0),
    limiter: 'single Node event loop, serialized FileDashboardOperationStore snapshots and fsync per transition',
  };

  const reportPath = process.env.CUSTOMER_AGENT_DASHBOARD_OPERATION_BENCHMARK_OUT;
  if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.info(`DASHBOARD_OPERATION_BENCHMARK ${JSON.stringify(report)}`);

  for (const run of runs) {
    expect(run.errors).toBe(0);
    expect(run.readCalls.total).toBe(READS_PER_RUN);
    expect(run.latencyMs.acceptance.p95).toBeLessThanOrEqual(300);
    expect(run.latencyMs.readProjection.p95).toBeLessThanOrEqual(300);
    expect(run.latencyMs.statusLookup.p95).toBeLessThanOrEqual(300);
  }
}, 120_000);
