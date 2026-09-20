import { randomUUID } from 'node:crypto';
import { parseCoachUploadCsv } from '../shared/coach-content-upload';
import {
  CONTENT_IMPORT_TIMEOUT_MS,
  CONTENT_PUBLISH_COPY,
  contentPublishGate,
  dashboardContentFailure,
  isDashboardContentImportRequest,
  isDashboardContentPublishRequest,
  type DashboardContentFailure,
  type DashboardContentImportRequest,
  type DashboardContentImportResult,
  type DashboardContentPublishResult,
  type DashboardContentSessionResult,
} from '../shared/dashboard-content';
import { ProductHttpError } from './product-http';
import type { ProductSession } from './product-session';

export type DashboardContentSessionClient = Pick<ProductSession, 'view' | 'request'>;

function asFailure(error: unknown): DashboardContentFailure {
  if (!(error instanceof ProductHttpError)) return dashboardContentFailure('UNAVAILABLE');
  if (error.code === 'SOURCE_GATE_NOT_READY' || error.code === 'CLIPBOARD_FAILED') {
    return dashboardContentFailure('UNAVAILABLE');
  }
  return dashboardContentFailure(error.code);
}

function importFileName(sourceName: string): string {
  const trimmed = sourceName.trim();
  const lower = trimmed.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.xlsx')) return trimmed;
  return `${trimmed}.csv`;
}

function buildImportForm(csvText: string, sourceName: string, bindings: DashboardContentImportRequest['sourceBindings']): FormData {
  const form = new FormData();
  form.set('file', new Blob([csvText], { type: 'text/csv' }), importFileName(sourceName));
  form.set(
    'source_bindings',
    JSON.stringify(bindings.map((binding) => ({
      domain: binding.domain,
      source_version_id: binding.source_version_id,
    }))),
  );
  return form;
}

const IMPORT_BATCH_ID = /^imp_[A-Za-z0-9_-]{1,128}$/;
const IMPORT_READY = new Set(['staged', 'publishing', 'published']);
const IMPORT_DEAD = new Set(['failed', 'rolled_back']);
const IMPORT_POLL_MS = 200;
const IMPORT_POLL_BUDGET_MS = CONTENT_IMPORT_TIMEOUT_MS;

function parseImportBatchId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.import_batch_id !== 'string' || !IMPORT_BATCH_ID.test(record.import_batch_id)) return null;
  if (record.status !== 'validating') return null;
  return record.import_batch_id;
}

function parseImportStatus(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = (value as Record<string, unknown>).status;
  return typeof status === 'string' ? status : null;
}

async function waitUntilImportStaged(
  client: DashboardContentSessionClient,
  epoch: number,
  importBatchId: string,
): Promise<true | DashboardContentFailure> {
  if (!IMPORT_BATCH_ID.test(importBatchId)) return dashboardContentFailure('VALIDATION');
  const path = `/v1/content/import/${importBatchId}`;
  const deadline = Date.now() + IMPORT_POLL_BUDGET_MS;
  while (Date.now() <= deadline) {
    const result = await client.request(epoch, path, { timeoutMs: 5_000 });
    const status = parseImportStatus(result.value);
    if (status && IMPORT_READY.has(status)) return true;
    if (status && IMPORT_DEAD.has(status)) return dashboardContentFailure('CONFLICT');
    if (status !== 'validating') return dashboardContentFailure('UNAVAILABLE');
    if (Date.now() + IMPORT_POLL_MS > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, IMPORT_POLL_MS));
  }
  return dashboardContentFailure('UNAVAILABLE');
}

function parsePublishRelease(value: unknown): { releaseId: string; releaseSeq: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.release_id !== 'string' || record.release_id.length < 1) return null;
  const seq = typeof record.release_seq === 'string' ? Number(record.release_seq) : record.release_seq;
  if (!Number.isSafeInteger(seq) || (seq as number) < 1) return null;
  return { releaseId: record.release_id, releaseSeq: seq as number };
}

export function dashboardContentSession(
  session: DashboardContentSessionClient | null,
): DashboardContentSessionResult {
  if (!session) {
    return Object.freeze({ ok: true, enabled: false, signedIn: false, role: null });
  }
  const view = session.view();
  return Object.freeze({
    ok: true,
    enabled: view.enabled,
    signedIn: view.signedIn,
    role: view.signedIn ? view.role : null,
  });
}

async function withSession<T>(
  session: DashboardContentSessionClient | null,
  work: (client: DashboardContentSessionClient, epoch: number) => Promise<T | DashboardContentFailure>,
): Promise<T | DashboardContentFailure> {
  if (!session) return dashboardContentFailure('UNAVAILABLE', CONTENT_PUBLISH_COPY.noProduct);
  const view = session.view();
  if (!view.enabled) return dashboardContentFailure('UNAVAILABLE', CONTENT_PUBLISH_COPY.noProduct);
  if (!view.signedIn || view.role === null) {
    return dashboardContentFailure('UNAUTHORIZED', CONTENT_PUBLISH_COPY.noSession);
  }
  try {
    return await work(session, view.sessionEpoch);
  } catch (error) {
    return asFailure(error);
  }
}

export async function dashboardContentImport(
  session: DashboardContentSessionClient | null,
  payload: unknown,
): Promise<DashboardContentImportResult> {
  if (!isDashboardContentImportRequest(payload)) return dashboardContentFailure('VALIDATION');
  return withSession(session, async (client, epoch) => {
    const view = client.view();
    if (!view.signedIn || view.role === null) {
      return dashboardContentFailure('UNAUTHORIZED', CONTENT_PUBLISH_COPY.noSession);
    }
    if (view.role === 'agent') return dashboardContentFailure('FORBIDDEN', CONTENT_PUBLISH_COPY.agent);
    if (payload.sourceBindings.length < 1) {
      return dashboardContentFailure('VALIDATION', CONTENT_PUBLISH_COPY.missingBindings);
    }
    const parsed = parseCoachUploadCsv(payload.csvText, payload.sourceName);
    if (!parsed.ok) return dashboardContentFailure('VALIDATION', parsed.message);
    const result = await client.request(epoch, '/v1/content/import', {
      form: buildImportForm(payload.csvText, payload.sourceName, payload.sourceBindings),
      timeoutMs: CONTENT_IMPORT_TIMEOUT_MS,
      headers: { 'idempotency-key': randomUUID() },
    });
    const importBatchId = parseImportBatchId(result.value);
    if (!importBatchId) return dashboardContentFailure('UNAVAILABLE');
    return Object.freeze({ ok: true, importBatchId });
  });
}

export async function dashboardContentPublish(
  session: DashboardContentSessionClient | null,
  payload: unknown,
): Promise<DashboardContentPublishResult> {
  if (!isDashboardContentPublishRequest(payload)) return dashboardContentFailure('VALIDATION');
  return withSession(session, async (client, epoch) => {
    const view = client.view();
    if (!view.signedIn || view.role === null) {
      return dashboardContentFailure('UNAUTHORIZED', CONTENT_PUBLISH_COPY.noSession);
    }
    const parsed = parseCoachUploadCsv(payload.csvText, payload.sourceName);
    if (!parsed.ok) return dashboardContentFailure('VALIDATION', parsed.message);
    const gate = contentPublishGate({
      productAvailable: true,
      signedIn: true,
      role: view.role,
      rows: parsed.rows,
      sourceBindings: payload.sourceBindings,
    });
    if (!gate.allowed) return dashboardContentFailure(gate.code, gate.message);
    const imported = await client.request(epoch, '/v1/content/import', {
      form: buildImportForm(payload.csvText, payload.sourceName, payload.sourceBindings),
      timeoutMs: CONTENT_IMPORT_TIMEOUT_MS,
      headers: { 'idempotency-key': randomUUID() },
    });
    const importBatchId = parseImportBatchId(imported.value);
    if (!importBatchId) return dashboardContentFailure('UNAVAILABLE');
    const ready = await waitUntilImportStaged(client, epoch, importBatchId);
    if (ready !== true) return ready;
    const published = await client.request(epoch, '/v1/content/publish', {
      body: {
        import_batch_id: importBatchId,
        title: payload.title.trim(),
        summary: payload.summary,
      },
      headers: { 'idempotency-key': randomUUID() },
    });
    const release = parsePublishRelease(published.value);
    if (!release) return dashboardContentFailure('UNAVAILABLE');
    return Object.freeze({ ok: true, releaseId: release.releaseId, releaseSeq: release.releaseSeq });
  });
}
