// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { arch, cpus, loadavg, platform, release, totalmem } from 'node:os';
import { expect, it } from 'vitest';
import {
  DashboardControlPlane,
  FileDashboardOperationStore,
  type DashboardControlPlaneSession,
  type DashboardOperationStore,
  type DashboardStoredOperation,
} from '../../src/main/dashboard-control-plane';

const enabled = process.env.CUSTOMER_AGENT_DASHBOARD_OPERATION_BENCHMARK === '1';

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

it.skipIf(!enabled)('measures durable Dashboard operation reads and mutations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-operation-benchmark-'));
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

    for (let index = 0; index < 50; index += 1) {
      for (let read = 0; read < 2; read += 1) {
        const started = performance.now();
        plane.currentSync();
        readProjection.push(performance.now() - started);
      }
      for (let read = 0; read < 2; read += 1) {
        const started = performance.now();
        await plane.current();
        statusLookup.push(performance.now() - started);
      }
      await mutate(20 + index);
    }
    const measuredStoreWrite = [...storeWrite];

    plane.registerRecovery('release', async () => ({ kind: 'committed', resultRef: 'recovered' }));
    for (let index = 0; index < 20; index += 1) {
      await plane.submit({
        domain: 'release',
        command: 'publish',
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
      intent: { benchmarkStaleRecovery: true },
      execute: async () => ({ kind: 'unknown' }),
    });
    epoch += 1;
    plane.registerRecovery('materials', async () => ({ kind: 'committed', resultRef: 'stale-recovered' }));
    const staleStarted = performance.now();
    const stale = await plane.recover('materials');
    recovery.push(performance.now() - staleStarted);

    expect(readProjection).toHaveLength(100);
    expect(acceptance).toHaveLength(50);
    expect(statusLookup).toHaveLength(100);
    expect(recovery).toHaveLength(21);
    expect(stale?.state).toBe('committed');
    expect(errors).toBe(0);

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
      input: {
        persistedMutations: 50,
        warmupMutations: 20,
        interleavedReadCalls: readProjection.length + statusLookup.length,
        readProjectionCalls: readProjection.length,
        statusLookupCalls: statusLookup.length,
        recoveryCalls: recovery.length,
        store: 'FileDashboardOperationStore',
        concurrency: 1,
      },
      coldMs: {
        acceptance: acceptance[0],
        readProjection: readProjection[0],
        statusLookup: statusLookup[0],
        recovery: recovery[0],
      },
      latencyMs: {
        acceptance: {
          p50: percentile(acceptance, 0.5),
          p95: percentile(acceptance, 0.95),
          p99: percentile(acceptance, 0.99),
        },
        readProjection: {
          p50: percentile(readProjection, 0.5),
          p95: percentile(readProjection, 0.95),
          p99: percentile(readProjection, 0.99),
        },
        statusLookup: {
          p50: percentile(statusLookup, 0.5),
          p95: percentile(statusLookup, 0.95),
          p99: percentile(statusLookup, 0.99),
        },
        recovery: {
          p50: percentile(recovery, 0.5),
          p95: percentile(recovery, 0.95),
          p99: percentile(recovery, 0.99),
        },
      },
      storeWriteMs: {
        calls: measuredStoreWrite.length,
        p50: percentile(measuredStoreWrite, 0.5),
        p95: percentile(measuredStoreWrite, 0.95),
        p99: percentile(measuredStoreWrite, 0.99),
      },
      errors,
      limiter: 'single Node event loop, serialized FileDashboardOperationStore snapshots and fsync per transition',
    };
    const reportPath = process.env.CUSTOMER_AGENT_DASHBOARD_OPERATION_BENCHMARK_OUT;
    if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.info(`DASHBOARD_OPERATION_BENCHMARK ${JSON.stringify(report)}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const DASHBOARD_DOMAINS = ['release', 'permissions', 'accounts', 'materials', 'rollback', 'ops-loop'] as const;
