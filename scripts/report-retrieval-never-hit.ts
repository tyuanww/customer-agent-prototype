#!/usr/bin/env node
/**
 * Report scripts in the off-repo hydrate catalog that desktop retrieval
 * never impressed, plus no-hit rate. Does not print answer text. Does not
 * call leftover /v1/search. Does not start the synthetic stack.
 *
 *   pnpm retrieval:never-hit
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defaultStackWritePath } from '../apps/desktop/src/main/packaged-retrieval-paths.ts';
import {
  defaultTelemetryPath,
  parseRetrievalTelemetry,
  summarizeNeverHit,
} from '../apps/desktop/src/main/retrieval-telemetry-store.ts';

const hydratePath = process.env.CUSTOMER_AGENT_HYDRATE_INDEX?.trim()
  || defaultStackWritePath('retrieval-hydrate.json');
const telemetryPath = defaultTelemetryPath() || resolve(dirname(hydratePath), 'retrieval-telemetry.json');

function hydrateRefs(): readonly { scriptId: string; title: string }[] {
  if (!existsSync(hydratePath)) return [];
  try {
    const raw: unknown = JSON.parse(readFileSync(hydratePath, 'utf8'));
    if (!raw || typeof raw !== 'object') return [];
    const scripts = Reflect.get(raw, 'scripts');
    if (!Array.isArray(scripts)) return [];
    const out: Array<{ scriptId: string; title: string }> = [];
    for (const item of scripts) {
      if (!item || typeof item !== 'object') continue;
      const scriptId = Reflect.get(item, 'scriptId');
      const title = Reflect.get(item, 'title');
      if (typeof scriptId !== 'string' || typeof title !== 'string') continue;
      out.push({ scriptId, title });
    }
    return out;
  } catch {
    return [];
  }
}

const events = existsSync(telemetryPath)
  ? parseRetrievalTelemetry(readFileSync(telemetryPath, 'utf8')).events
  : [];
const report = summarizeNeverHit(hydrateRefs(), events);
console.log(JSON.stringify({
  hydrate: hydratePath,
  telemetry: telemetryPath,
  queries: report.queries,
  hits: report.hits,
  noHits: report.noHits,
  noHitRate: report.noHitRate,
  catalog: report.catalog,
  neverImpressed: report.neverImpressed.length,
  impressedNeverAdopted: report.impressedNeverAdopted.length,
  neverImpressedSample: report.neverImpressed.slice(0, 20),
  impressedNeverAdoptedSample: report.impressedNeverAdopted.slice(0, 20),
}));
