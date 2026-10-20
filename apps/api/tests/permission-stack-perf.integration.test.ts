import { describe, it } from 'vitest';

/**
 * Perf probe for the permission stack. HTTP only, so the same file also runs against a trunk
 * checkout that has no authorization_sources plumbing. It prints one JSON line with medians
 * and the refusal code each door actually returned; the gates come from
 * permission-server-deadline-plan.md, which caps a denial call at 300 ms.
 *
 * The probe never asserts a specific code it did not observe. It requires every sample at one
 * door to return the same non-success status, so a measurement cannot report the latency of an
 * accepted write as a denial latency, and it prints that status for the operator to read.
 */
const enabled = process.env.CUSTOMER_AGENT_PERF_PROBE === '1';
const SAMPLES = 20;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2) : sorted[middle]!;
}

type Door = { readonly elapsed: number[]; readonly statuses: number[] };

function door(): Door {
  return { elapsed: [], statuses: [] };
}

async function knock(target: Door, work: () => Promise<Response>): Promise<void> {
  const started = performance.now();
  const response = await work();
  target.elapsed.push(performance.now() - started);
  target.statuses.push(response.status);
}

function verdict(name: string, target: Door): { status: number; medianMs: number } {
  const first = target.statuses[0];
  if (first === undefined) throw new Error(`${name} produced no sample`);
  if (target.statuses.some(status => status !== first)) {
    throw new Error(`${name} returned mixed statuses: ${[...new Set(target.statuses)].join(',')}`);
  }
  if (first < 400) throw new Error(`${name} was accepted (${first}); a denial latency needs a refusal`);
  return { status: first, medianMs: median(target.elapsed) };
}

async function timeIt(work: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await work();
  return performance.now() - started;
}

describe.runIf(enabled)('permission stack perf probe', () => {
  it('measures the job read and one refusal per write door', async () => {
    const { createIntakeSyntheticHost } = await import('./support/intake-synthetic-host.js');
    const host = await createIntakeSyntheticHost({ prepareCandidate: false, profile: 'purpose-runtime' });
    try {
      // Warm-up, so the first sample does not pay for a cold pool or a cold plan cache.
      for (let index = 0; index < 3; index += 1) await host.requestAs('director', '/v1/auth/job');

      const job: number[] = [];
      for (let index = 0; index < SAMPLES; index += 1) {
        job.push(await timeIt(() => host.requestAs('director', '/v1/auth/job')));
      }

      // The agent holds query only, so every write door has to refuse it.
      const publish = door();
      for (let index = 0; index < SAMPLES; index += 1) {
        await knock(publish, () => host.requestAs('agent', '/v1/content/publish', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': `perf-publish-${index}` },
          body: JSON.stringify({ import_batch_id: 'perf_missing_batch', title: 'perf', summary: 'perf' }),
        }));
      }

      const importDoor = door();
      for (let index = 0; index < SAMPLES; index += 1) {
        await knock(importDoor, () => host.requestAs('agent', '/v1/content/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': `perf-import-${index}` },
          body: JSON.stringify({ source_type: 'feishu_api', source_bindings: [{ domain: 'product', source_version_id: 'srcv_perf' }] }),
        }));
      }

      const rollback = door();
      for (let index = 0; index < SAMPLES; index += 1) {
        await knock(rollback, () => host.requestAs('agent', '/v1/content/rollback', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': `perf-rollback-${index}` },
          body: JSON.stringify({ target_release_id: 'rel_perf_missing', title: 'perf', summary: 'perf' }),
        }));
      }

      console.log(`PERF ${JSON.stringify({
        samples: SAMPLES,
        jobMedianMs: median(job),
        publishDenial: verdict('publish denial', publish),
        importDenial: verdict('import denial', importDoor),
        rollbackDenial: verdict('rollback denial', rollback),
      })}`);
    } finally {
      await host.close();
    }
  }, 300_000);
});
