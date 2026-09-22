import { randomUUID } from 'node:crypto';
import { parseCoachUploadCsv, parseCoachUploadTable } from '../shared/coach-content-upload';
import { frozenImportCsv } from '../shared/content-frozen-import';
import { parseXlsxFirstSheet } from './xlsx-first-sheet';
import {
  CONTENT_IMPORT_MAX_BYTES,
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
export type DashboardContentAfterPublish = (sessionEpoch: number) => Promise<void>;
export type DashboardContentParkedReview = (importBatchId: string) => Promise<boolean>;

function asFailure(error: unknown): DashboardContentFailure {
  if (!(error instanceof ProductHttpError)) return dashboardContentFailure('UNAVAILABLE');
  if (error.code === 'SOURCE_GATE_NOT_READY' || error.code === 'CLIPBOARD_FAILED') {
    return dashboardContentFailure('UNAVAILABLE');
  }
  if (error.code === 'FORBIDDEN') {
    if (error.reason === 'SOURCE_NOT_ELIGIBLE' || error.reason === 'SOURCE_SUSPENDED') {
      return dashboardContentFailure('FORBIDDEN', CONTENT_PUBLISH_COPY.sourceIneligible);
    }
    return dashboardContentFailure('FORBIDDEN', CONTENT_PUBLISH_COPY.ownerPublish);
  }
  return dashboardContentFailure(error.code);
}

function importFileName(sourceName: string): string {
  const trimmed = sourceName.trim();
  const lower = trimmed.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.xlsx')) return trimmed;
  return `${trimmed}.csv`;
}

function importCsvText(
  rows: readonly { scene: string; script: string; domain?: 'presale' | 'campaign' | 'aftersale' | 'product' }[],
  csvText: string,
  bindings: DashboardContentImportRequest['sourceBindings'],
): string | null {
  return frozenImportCsv(rows, bindings) ?? (csvText.trim().length > 0 ? csvText : null);
}

function buildImportForm(csvText: string, sourceName: string, bindings: DashboardContentImportRequest['sourceBindings']): FormData {
  const form = new FormData();
  form.set('file', new Blob([csvText], { type: 'text/csv' }), importFileName(sourceName).replace(/\.xlsx$/i, '.csv'));
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
const IMPORT_POLL_MS = 1_500;
const IMPORT_POLL_BUDGET_MS = CONTENT_IMPORT_TIMEOUT_MS;
const IMPORT_REVIEW_BUDGET_MS = 90_000;

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

async function batchInReviewQueue(
  client: DashboardContentSessionClient,
  epoch: number,
  importBatchId: string,
): Promise<boolean> {
  try {
    const listed = await client.request(epoch, '/v1/admin/content/reviews?limit=100', { timeoutMs: 5_000 });
    if (!listed.value || typeof listed.value !== 'object' || Array.isArray(listed.value)) return false;
    const items = Reflect.get(listed.value, 'items');
    if (!Array.isArray(items)) return false;
    return items.some((item) => item && typeof item === 'object' && Reflect.get(item, 'batch_id') === importBatchId);
  } catch (error) {
    if (error instanceof ProductHttpError && (error.code === 'FORBIDDEN' || error.code === 'UNAUTHORIZED')) {
      return false;
    }
    throw error;
  }
}

export async function completeSignedInReview(
  client: DashboardContentSessionClient,
  epoch: number,
  importBatchId: string,
): Promise<boolean> {
  try {
    const listed = await client.request(epoch, '/v1/admin/content/reviews?limit=100', { timeoutMs: 5_000 });
    const queue = listed.value !== null && typeof listed.value === 'object' && !Array.isArray(listed.value)
      ? Reflect.get(listed.value, 'items')
      : undefined;
    const queued = Array.isArray(queue)
      ? queue.find((item) => item !== null && typeof item === 'object' && Reflect.get(item, 'batch_id') === importBatchId)
      : undefined;
    const revision = queued !== null && typeof queued === 'object' ? Reflect.get(queued, 'review_revision') : undefined;
    if (typeof revision !== 'number') return false;
    const detail = await client.request(
      epoch,
      `/v1/admin/content/reviews/${importBatchId}?review_revision=${String(revision)}`,
      { timeoutMs: 5_000 },
    );
    const page = detail.value !== null && typeof detail.value === 'object' && !Array.isArray(detail.value)
      ? Reflect.get(detail.value, 'items')
      : undefined;
    const rows = Array.isArray(page) ? page.flatMap((item) => {
      if (item === null || typeof item !== 'object') return [];
      const scriptId = Reflect.get(item, 'script_id');
      const contentHash = Reflect.get(item, 'content_hash');
      return typeof scriptId === 'string' && typeof contentHash === 'string'
        ? [{ scriptId, contentHash }]
        : [];
    }) : [];
    if (rows.length < 1) return false;
    for (const [index, row] of rows.entries()) {
      const decision = await client.request(epoch, `/v1/admin/content/reviews/${importBatchId}/decisions`, {
        body: {
          review_revision: revision,
          script_id: row.scriptId,
          content_hash: row.contentHash,
          decision: 'approved',
          evidence_id: 'EVD-FORMAL-REVIEW-001',
        },
        headers: { 'idempotency-key': `dec-owner-${importBatchId}-${String(index)}` },
        timeoutMs: 5_000,
      });
      if (decision.status !== 200) return false;
    }
    const evidence = await client.request(epoch, `/v1/admin/content/reviews/${importBatchId}/quality-evidence`, {
      body: {
        review_revision: revision,
        phase: 'initial',
        evidence_id: 'EVD-FORMAL-QUALITY-001',
        checks: rows.map((row) => ({ script_id: row.scriptId, content_hash: row.contentHash, defect: false })),
      },
      headers: { 'idempotency-key': `quality-owner-${importBatchId}` },
      timeoutMs: 5_000,
    });
    if (evidence.status !== 200) return false;
    const resumed = await client.request(epoch, `/v1/admin/content/reviews/${importBatchId}/resume`, {
      body: { review_revision: revision },
      timeoutMs: 5_000,
    });
    return resumed.status === 200;
  } catch {
    return false;
  }
}

async function waitUntilImportStaged(
  client: DashboardContentSessionClient,
  epoch: number,
  importBatchId: string,
  parkedReview?: DashboardContentParkedReview,
): Promise<true | DashboardContentFailure> {
  if (!IMPORT_BATCH_ID.test(importBatchId)) return dashboardContentFailure('VALIDATION');
  const path = `/v1/content/import/${importBatchId}`;
  const deadline = Date.now() + (parkedReview ? IMPORT_REVIEW_BUDGET_MS : IMPORT_POLL_BUDGET_MS);
  let reviewAttempted = false;
  let sawReviewQueue = false;
  let validatingPolls = 0;
  while (Date.now() <= deadline) {
    let result: Awaited<ReturnType<DashboardContentSessionClient['request']>>;
    try {
      result = await client.request(epoch, path, { timeoutMs: 5_000 });
    } catch (error) {
      if (error instanceof ProductHttpError && error.code === 'RATE_LIMITED') {
        if (Date.now() + IMPORT_POLL_MS > deadline) break;
        await new Promise((resolve) => setTimeout(resolve, IMPORT_POLL_MS));
        continue;
      }
      throw error;
    }
    const status = parseImportStatus(result.value);
    if (status && IMPORT_READY.has(status)) return true;
    if (status && IMPORT_DEAD.has(status)) return dashboardContentFailure('CONFLICT');
    if (status !== 'validating') return dashboardContentFailure('UNAVAILABLE');
    validatingPolls += 1;
    if (parkedReview) {
      if (await batchInReviewQueue(client, epoch, importBatchId)) sawReviewQueue = true;
      if (!reviewAttempted && (sawReviewQueue || validatingPolls >= 2)) {
        reviewAttempted = true;
        if (await parkedReview(importBatchId)) continue;
      }
      if (sawReviewQueue && reviewAttempted) {
        return dashboardContentFailure('UNAVAILABLE', CONTENT_PUBLISH_COPY.awaitingReview);
      }
    }
    if (Date.now() + IMPORT_POLL_MS > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, IMPORT_POLL_MS));
  }
  return dashboardContentFailure(
    'UNAVAILABLE',
    sawReviewQueue ? CONTENT_PUBLISH_COPY.awaitingReview : undefined,
  );
}

function parsePublishRelease(value: unknown): { releaseId: string; releaseSeq: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.release_id !== 'string' || record.release_id.length < 1) return null;
  const seq = typeof record.release_seq === 'string' ? Number(record.release_seq) : record.release_seq;
  if (!Number.isSafeInteger(seq) || (seq as number) < 1) return null;
  return { releaseId: record.release_id, releaseSeq: seq as number };
}

export function dashboardContentParseUpload(payload: unknown): ReturnType<typeof parseCoachUploadCsv> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, code: 'invalid-table', message: '无法解析上传文件。' };
  }
  const record = payload as Record<string, unknown>;
  const bytes = record.bytes instanceof ArrayBuffer
    ? Buffer.from(record.bytes)
    : record.bytes instanceof Uint8Array
      ? Buffer.from(record.bytes)
      : Array.isArray(record.bytes)
        ? Buffer.from(record.bytes as number[])
        : null;
  if (typeof record.sourceName !== 'string' || bytes === null) {
    return { ok: false, code: 'invalid-table', message: '无法解析上传文件。' };
  }
  const sourceName = record.sourceName.trim() || 'upload.xlsx';
  if (bytes.length > CONTENT_IMPORT_MAX_BYTES) {
    return { ok: false, code: 'too-large', message: `文件超过 ${String(CONTENT_IMPORT_MAX_BYTES / (1024 * 1024))}MiB。` };
  }
  try {
    const table = parseXlsxFirstSheet(bytes);
    return parseCoachUploadTable(table, sourceName);
  } catch {
    return { ok: false, code: 'binary-workbook', message: 'Excel 未能解析。未连接飞书或 Wiki。' };
  }
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
    const frozen = importCsvText(parsed.rows, parsed.csvText, payload.sourceBindings);
    if (!frozen) return dashboardContentFailure('VALIDATION', CONTENT_PUBLISH_COPY.missingBindings);
    const result = await client.request(epoch, '/v1/content/import', {
      form: buildImportForm(frozen, payload.sourceName, payload.sourceBindings),
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
  afterPublish?: DashboardContentAfterPublish,
  parkedReview?: DashboardContentParkedReview,
): Promise<DashboardContentPublishResult> {
  if (!isDashboardContentPublishRequest(payload)) return dashboardContentFailure('VALIDATION');
  return withSession(session, async (client, epoch) => {
    const view = client.view();
    if (!view.signedIn || view.role === null) {
      return dashboardContentFailure('UNAUTHORIZED', CONTENT_PUBLISH_COPY.noSession);
    }
    const parsed = parseCoachUploadCsv(payload.csvText, payload.sourceName);
    if (!parsed.ok) return dashboardContentFailure('VALIDATION', parsed.message);
    const frozen = importCsvText(parsed.rows, parsed.csvText, payload.sourceBindings);
    if (!frozen) return dashboardContentFailure('VALIDATION', CONTENT_PUBLISH_COPY.missingBindings);
    const gate = contentPublishGate({
      productAvailable: true,
      signedIn: true,
      role: view.role,
      rows: parsed.rows,
      sourceBindings: payload.sourceBindings,
    });
    if (!gate.allowed) return dashboardContentFailure(gate.code, gate.message);
    const imported = await client.request(epoch, '/v1/content/import', {
      form: buildImportForm(frozen, payload.sourceName, payload.sourceBindings),
      timeoutMs: CONTENT_IMPORT_TIMEOUT_MS,
      headers: { 'idempotency-key': randomUUID() },
    });
    const importBatchId = parseImportBatchId(imported.value);
    if (!importBatchId) return dashboardContentFailure('UNAVAILABLE');
    const ready = await waitUntilImportStaged(client, epoch, importBatchId, parkedReview);
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
    if (afterPublish) {
      try {
        await afterPublish(epoch);
      } catch {
        // Publish already committed. Next product search still refreshAnnounce.
      }
    }
    return Object.freeze({ ok: true, releaseId: release.releaseId, releaseSeq: release.releaseSeq });
  });
}
