import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertOffRepoIndexPath } from './retrieval-index-store.ts';

export const RETRIEVAL_TELEMETRY_VERSION = 1;
export const RETRIEVAL_TELEMETRY_MAX_EVENTS = 2000;

export type TelemetryImpression = Readonly<{
  scriptId: string;
  rank: number;
  contentHash: string;
}>;

export type TelemetryQuery = Readonly<{
  queryId: string;
  at: string;
  releaseId: string;
  hitStatus: 'hit' | 'no_hit';
  intent: string;
  impressions: readonly TelemetryImpression[];
  adoptedScriptId: string | null;
  outcome: 'adopted' | 'no_hit_exit' | 'dismissed' | 'escalate' | 'timeout' | null;
}>;

export type RetrievalTelemetryDocument = Readonly<{
  version: number;
  events: readonly TelemetryQuery[];
}>;

export type RetrievalTelemetry = Readonly<{
  recordQuery(event: TelemetryQuery): void;
  markAdopted(queryId: string, scriptId: string): void;
  markOutcome(queryId: string, outcome: NonNullable<TelemetryQuery['outcome']>): void;
  snapshot(): RetrievalTelemetryDocument;
}>;

export type NeverHitReport = Readonly<{
  queries: number;
  hits: number;
  noHits: number;
  noHitRate: number;
  catalog: number;
  neverImpressed: readonly Readonly<{ scriptId: string; title: string }>[];
  impressedNeverAdopted: readonly Readonly<{ scriptId: string; title: string; impressions: number }>[];
}>;

const emptyDocument: RetrievalTelemetryDocument = Object.freeze({
  version: RETRIEVAL_TELEMETRY_VERSION,
  events: Object.freeze([]),
});

function writeAtomic(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, body);
  renameSync(tempPath, path);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseImpression(value: unknown): TelemetryImpression | null {
  const row = asRecord(value);
  if (!row) return null;
  const scriptId = Reflect.get(row, 'scriptId');
  const rank = Reflect.get(row, 'rank');
  const contentHash = Reflect.get(row, 'contentHash');
  if (typeof scriptId !== 'string' || scriptId.length < 1) return null;
  if (!Number.isInteger(rank) || Number(rank) < 1 || Number(rank) > 3) return null;
  if (typeof contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(contentHash)) return null;
  return Object.freeze({ scriptId, rank: Number(rank), contentHash });
}

function parseEvent(value: unknown): TelemetryQuery | null {
  const row = asRecord(value);
  if (!row) return null;
  const queryId = Reflect.get(row, 'queryId');
  const at = Reflect.get(row, 'at');
  const releaseId = Reflect.get(row, 'releaseId');
  const hitStatus = Reflect.get(row, 'hitStatus');
  const intent = Reflect.get(row, 'intent');
  const impressionsRaw = Reflect.get(row, 'impressions');
  const adoptedScriptId = Reflect.get(row, 'adoptedScriptId');
  const outcome = Reflect.get(row, 'outcome');
  if (typeof queryId !== 'string' || queryId.length < 1) return null;
  if (typeof at !== 'string' || at.length < 1) return null;
  if (typeof releaseId !== 'string' || releaseId.length < 1) return null;
  if (hitStatus !== 'hit' && hitStatus !== 'no_hit') return null;
  if (typeof intent !== 'string') return null;
  if (!Array.isArray(impressionsRaw)) return null;
  const impressions = impressionsRaw.flatMap((item) => {
    const parsed = parseImpression(item);
    return parsed ? [parsed] : [];
  });
  if (adoptedScriptId !== null && typeof adoptedScriptId !== 'string') return null;
  if (outcome !== null && outcome !== 'adopted' && outcome !== 'no_hit_exit'
    && outcome !== 'dismissed' && outcome !== 'escalate' && outcome !== 'timeout') return null;
  return Object.freeze({
    queryId, at, releaseId, hitStatus, intent, impressions,
    adoptedScriptId: typeof adoptedScriptId === 'string' ? adoptedScriptId : null,
    outcome: outcome === null ? null : outcome,
  });
}

export function parseRetrievalTelemetry(raw: string): RetrievalTelemetryDocument {
  try {
    const value: unknown = JSON.parse(raw);
    const record = asRecord(value);
    if (!record || Reflect.get(record, 'version') !== RETRIEVAL_TELEMETRY_VERSION) return emptyDocument;
    const eventsRaw = Reflect.get(record, 'events');
    if (!Array.isArray(eventsRaw)) return emptyDocument;
    return Object.freeze({
      version: RETRIEVAL_TELEMETRY_VERSION,
      events: Object.freeze(eventsRaw.flatMap((item) => {
        const parsed = parseEvent(item);
        return parsed ? [parsed] : [];
      })),
    });
  } catch {
    return emptyDocument;
  }
}

function cap(events: readonly TelemetryQuery[]): TelemetryQuery[] {
  return events.length <= RETRIEVAL_TELEMETRY_MAX_EVENTS
    ? [...events]
    : events.slice(events.length - RETRIEVAL_TELEMETRY_MAX_EVENTS);
}

export function summarizeNeverHit(
  catalog: readonly Readonly<{ scriptId: string; title: string }>[],
  events: readonly TelemetryQuery[],
): NeverHitReport {
  const impressed = new Map<string, number>();
  const adopted = new Set<string>();
  let hits = 0;
  let noHits = 0;
  for (const event of events) {
    if (event.hitStatus === 'hit') hits += 1;
    else noHits += 1;
    for (const row of event.impressions) {
      impressed.set(row.scriptId, (impressed.get(row.scriptId) ?? 0) + 1);
    }
    if (event.adoptedScriptId) adopted.add(event.adoptedScriptId);
  }
  const neverImpressed = catalog
    .filter((row) => !impressed.has(row.scriptId))
    .map((row) => Object.freeze({ scriptId: row.scriptId, title: row.title }));
  const impressedNeverAdopted = catalog
    .filter((row) => impressed.has(row.scriptId) && !adopted.has(row.scriptId))
    .map((row) => Object.freeze({
      scriptId: row.scriptId,
      title: row.title,
      impressions: impressed.get(row.scriptId) ?? 0,
    }));
  const queries = events.length;
  return Object.freeze({
    queries,
    hits,
    noHits,
    noHitRate: queries === 0 ? 0 : noHits / queries,
    catalog: catalog.length,
    neverImpressed: Object.freeze(neverImpressed),
    impressedNeverAdopted: Object.freeze(impressedNeverAdopted),
  });
}

export function createFileTelemetry(path: string, repoRoot: string): RetrievalTelemetry {
  const indexPath = assertOffRepoIndexPath(path, repoRoot);
  const read = (): TelemetryQuery[] => {
    if (!existsSync(indexPath)) return [];
    return [...parseRetrievalTelemetry(readFileSync(indexPath, 'utf8')).events];
  };
  const write = (events: readonly TelemetryQuery[]): void => {
    writeAtomic(indexPath, `${JSON.stringify({
      version: RETRIEVAL_TELEMETRY_VERSION,
      events: cap(events),
    })}\n`);
  };
  return Object.freeze({
    recordQuery(event: TelemetryQuery): void {
      const events = read().filter((row) => row.queryId !== event.queryId);
      events.push(event);
      write(events);
    },
    markAdopted(queryId: string, scriptId: string): void {
      write(read().map((row) => (
        row.queryId === queryId
          ? { ...row, adoptedScriptId: scriptId, outcome: 'adopted' as const }
          : row
      )));
    },
    markOutcome(queryId: string, outcome: NonNullable<TelemetryQuery['outcome']>): void {
      write(read().map((row) => (
        row.queryId === queryId ? { ...row, outcome } : row
      )));
    },
    snapshot(): RetrievalTelemetryDocument {
      return Object.freeze({
        version: RETRIEVAL_TELEMETRY_VERSION,
        events: Object.freeze(read()),
      });
    },
  });
}

export function noopRetrievalTelemetry(): RetrievalTelemetry {
  let events: TelemetryQuery[] = [];
  return Object.freeze({
    recordQuery(event: TelemetryQuery): void {
      events = cap([...events.filter((row) => row.queryId !== event.queryId), event]);
    },
    markAdopted(queryId: string, scriptId: string): void {
      events = events.map((row) => (
        row.queryId === queryId ? { ...row, adoptedScriptId: scriptId, outcome: 'adopted' as const } : row
      ));
    },
    markOutcome(queryId: string, outcome: NonNullable<TelemetryQuery['outcome']>): void {
      events = events.map((row) => (row.queryId === queryId ? { ...row, outcome } : row));
    },
    snapshot(): RetrievalTelemetryDocument {
      return Object.freeze({ version: RETRIEVAL_TELEMETRY_VERSION, events: Object.freeze([...events]) });
    },
  });
}

export function defaultTelemetryPath(): string {
  const explicit = (process.env.CUSTOMER_AGENT_RETRIEVAL_TELEMETRY ?? '').trim();
  if (explicit.length > 0) return explicit;
  const hydrate = (process.env.CUSTOMER_AGENT_HYDRATE_INDEX ?? '').trim();
  if (hydrate.length === 0) return '';
  return join(dirname(hydrate), 'retrieval-telemetry.json');
}

function desktopRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
}

export function loadRetrievalTelemetryStore(
  repoRoot = desktopRepoRoot(),
): RetrievalTelemetry {
  const path = defaultTelemetryPath();
  if (path.length === 0) return noopRetrievalTelemetry();
  try {
    return createFileTelemetry(path, repoRoot);
  } catch {
    return noopRetrievalTelemetry();
  }
}
