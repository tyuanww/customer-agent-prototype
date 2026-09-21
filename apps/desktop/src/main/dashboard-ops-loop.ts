import { randomUUID } from 'node:crypto';
import { parseContractSchema } from '@customer-agent/contracts';
import {
  dashboardOpsFailure,
  OPS_LOOP_COPY,
  SOP_UPLOAD_MAX_BYTES,
  sopAllergyStepNeedsStopCopy,
  sopCsvAllergyStopMissing,
  type DashboardOpsFailure,
  type DashboardRetrievalMetrics,
  type DashboardScriptMutation,
  type DashboardSoftwareCatalog,
  type DashboardSopCatalog,
  type DashboardSopImport,
  type DashboardSopNode,
  type RetrievalWindow,
} from '../shared/dashboard-ops-loop';
import { ProductHttpError } from './product-http';
import type { ProductSession } from './product-session';

export type DashboardOpsSessionClient = Pick<ProductSession, 'view' | 'request'>;

function toDashboardSopNode(parsed: {
  node_id: string;
  parent_node_id: string | null;
  title: string;
  body: string;
  sort_key: number;
  version: number;
  lifecycle: DashboardSopNode['lifecycle'];
}): DashboardSopNode {
  return Object.freeze({
    nodeId: parsed.node_id,
    parentNodeId: parsed.parent_node_id,
    title: parsed.title,
    body: parsed.body,
    sortKey: parsed.sort_key,
    version: parsed.version,
    lifecycle: parsed.lifecycle,
  });
}

function asFailure(error: unknown): DashboardOpsFailure {
  if (!(error instanceof ProductHttpError)) return dashboardOpsFailure('UNAVAILABLE');
  if (error.code === 'GONE') return dashboardOpsFailure('NOT_FOUND');
  if (error.code === 'SOURCE_GATE_NOT_READY' || error.code === 'CLIPBOARD_FAILED' || error.code === 'STALE' || error.code === 'CANCELLED') {
    return dashboardOpsFailure('UNAVAILABLE');
  }
  return dashboardOpsFailure(error.code, error.message);
}

async function withSession<T>(
  session: DashboardOpsSessionClient | null,
  roles: readonly string[],
  work: (client: DashboardOpsSessionClient, epoch: number) => Promise<T | DashboardOpsFailure>,
): Promise<T | DashboardOpsFailure> {
  if (!session) return dashboardOpsFailure('UNAVAILABLE', OPS_LOOP_COPY.noProduct);
  const view = session.view();
  if (!view.enabled) return dashboardOpsFailure('UNAVAILABLE', OPS_LOOP_COPY.noProduct);
  if (!view.signedIn || view.role === null) {
    return dashboardOpsFailure('UNAUTHORIZED', OPS_LOOP_COPY.noSession);
  }
  if (!roles.includes(view.role)) return dashboardOpsFailure('FORBIDDEN', OPS_LOOP_COPY.forbidden);
  try {
    return await work(session, view.sessionEpoch);
  } catch (error) {
    return asFailure(error);
  }
}

export async function dashboardRetrievalMetrics(
  session: DashboardOpsSessionClient | null,
  window: RetrievalWindow,
): Promise<DashboardRetrievalMetrics | DashboardOpsFailure> {
  return withSession(session, ['coach', 'owner'], async (client, epoch) => {
    const result = await client.request(epoch, `/v1/metrics/retrieval?window=${window}`);
    const parsed = parseContractSchema('RetrievalMetrics', result.value);
    return Object.freeze({
      ok: true as const,
      noHitRate: parsed.no_hit_rate,
      copyCompleteRate: parsed.copy_complete_rate,
      openTaskCount: parsed.open_task_count,
      currentReleaseScriptCount: parsed.current_release_script_count,
      window: parsed.window,
      releaseId: parsed.release_id,
    });
  });
}

export async function dashboardSopCatalog(
  session: DashboardOpsSessionClient | null,
): Promise<DashboardSopCatalog | DashboardOpsFailure> {
  return withSession(session, ['coach', 'owner'], async (client, epoch) => {
    const result = await client.request(epoch, '/v1/sop/catalog');
    const parsed = parseContractSchema('SopCatalogResponse', result.value);
    return Object.freeze({
      ok: true as const,
      productSessionId: parsed.product_session_id,
      items: Object.freeze(parsed.items.map((item) => toDashboardSopNode(item))),
    });
  });
}

export async function dashboardSopImport(
  session: DashboardOpsSessionClient | null,
  csvText: string,
): Promise<DashboardSopImport | DashboardOpsFailure> {
  if (typeof csvText !== 'string' || csvText.trim().length < 1 || csvText.length > SOP_UPLOAD_MAX_BYTES) {
    return dashboardOpsFailure('VALIDATION');
  }
  if (sopCsvAllergyStopMissing(csvText)) {
    return dashboardOpsFailure('VALIDATION', OPS_LOOP_COPY.allergyStop);
  }
  return withSession(session, ['coach', 'owner'], async (client, epoch) => {
    const form = new FormData();
    form.append('file', new Blob([csvText], { type: 'text/csv' }), 'sop.csv');
    const result = await client.request(epoch, '/v1/sop/import', {
      form,
      headers: { 'idempotency-key': randomUUID() },
    });
    const parsed = parseContractSchema('SopImportAccepted', result.value);
    return Object.freeze({
      ok: true as const,
      productSessionId: parsed.product_session_id,
      nodeCount: parsed.node_count,
    });
  });
}

export async function dashboardSopPatch(
  session: DashboardOpsSessionClient | null,
  payload: unknown,
): Promise<DashboardSopNode | DashboardOpsFailure> {
  if (!payload || typeof payload !== 'object') return dashboardOpsFailure('VALIDATION');
  const record = payload as Record<string, unknown>;
  const nodeId = record.nodeId;
  const expectedVersion = record.expectedVersion;
  if (typeof nodeId !== 'string' || !Number.isInteger(expectedVersion)) {
    return dashboardOpsFailure('VALIDATION');
  }
  if (typeof record.title === 'string' && typeof record.body === 'string'
    && sopAllergyStepNeedsStopCopy(record.title, record.body)) {
    return dashboardOpsFailure('VALIDATION', OPS_LOOP_COPY.allergyStop);
  }
  return withSession(session, ['coach', 'owner'], async (client, epoch) => {
    const result = await client.request(
      epoch,
      `/v1/sop/nodes/${encodeURIComponent(nodeId)}`,
      {
        method: 'PATCH',
        headers: { 'idempotency-key': randomUUID() },
        body: {
          expected_version: expectedVersion,
          ...(typeof record.title === 'string' ? { title: record.title } : {}),
          ...(typeof record.body === 'string' ? { body: record.body } : {}),
          ...(Number.isInteger(record.sortKey) ? { sort_key: record.sortKey } : {}),
        },
      },
    );
    const parsed = parseContractSchema('SopNode', result.value);
    return toDashboardSopNode(parsed);
  });
}

export async function dashboardSopDelete(
  session: DashboardOpsSessionClient | null,
  payload: unknown,
): Promise<DashboardSopNode | DashboardOpsFailure> {
  if (!payload || typeof payload !== 'object') return dashboardOpsFailure('VALIDATION');
  const record = payload as Record<string, unknown>;
  const nodeId = record.nodeId;
  const expectedVersion = record.expectedVersion;
  if (typeof nodeId !== 'string' || !Number.isInteger(expectedVersion)) {
    return dashboardOpsFailure('VALIDATION');
  }
  return withSession(session, ['owner'], async (client, epoch) => {
    const result = await client.request(
      epoch,
      `/v1/sop/nodes/${encodeURIComponent(nodeId)}`,
      {
        method: 'DELETE',
        headers: { 'idempotency-key': randomUUID() },
        body: { expected_version: expectedVersion },
      },
    );
    const parsed = parseContractSchema('SopNode', result.value);
    return toDashboardSopNode(parsed);
  });
}

export async function dashboardScriptPatch(
  session: DashboardOpsSessionClient | null,
  payload: unknown,
): Promise<DashboardScriptMutation | DashboardOpsFailure> {
  if (!payload || typeof payload !== 'object') return dashboardOpsFailure('VALIDATION');
  const record = payload as Record<string, unknown>;
  const scriptId = record.scriptId;
  const expectedVersion = record.expectedVersion;
  const title = record.title;
  const answerText = record.answerText;
  const effectiveFrom = record.effectiveFrom;
  if (typeof scriptId !== 'string' || !Number.isInteger(expectedVersion)
    || typeof title !== 'string' || typeof answerText !== 'string'
    || typeof effectiveFrom !== 'string') {
    return dashboardOpsFailure('VALIDATION');
  }
  return withSession(session, ['owner'], async (client, epoch) => {
    const result = await client.request(
      epoch,
      `/v1/content/scripts/${encodeURIComponent(scriptId)}`,
      {
        method: 'PATCH',
        headers: { 'idempotency-key': randomUUID() },
        body: {
          expected_version: expectedVersion,
          title,
          answer_text: answerText,
          effective_from: effectiveFrom,
          effective_to: record.effectiveTo ?? null,
        },
      },
    );
    const parsed = parseContractSchema('ScriptMutationResponse', result.value);
    return Object.freeze({
      ok: true as const,
      scriptId: parsed.script_id,
      mutationId: parsed.mutation_id,
      reviewStatus: 'pending_review' as const,
    });
  });
}

export async function dashboardScriptDelete(
  session: DashboardOpsSessionClient | null,
  payload: unknown,
): Promise<DashboardScriptMutation | DashboardOpsFailure> {
  if (!payload || typeof payload !== 'object') return dashboardOpsFailure('VALIDATION');
  const record = payload as Record<string, unknown>;
  const scriptId = record.scriptId;
  const expectedVersion = record.expectedVersion;
  if (typeof scriptId !== 'string' || !Number.isInteger(expectedVersion)) {
    return dashboardOpsFailure('VALIDATION');
  }
  return withSession(session, ['owner'], async (client, epoch) => {
    const result = await client.request(
      epoch,
      `/v1/content/scripts/${encodeURIComponent(scriptId)}`,
      {
        method: 'DELETE',
        headers: { 'idempotency-key': randomUUID() },
        body: { expected_version: expectedVersion },
      },
    );
    const parsed = parseContractSchema('ScriptMutationResponse', result.value);
    return Object.freeze({
      ok: true as const,
      scriptId: parsed.script_id,
      mutationId: parsed.mutation_id,
      reviewStatus: 'pending_review' as const,
    });
  });
}

export async function dashboardSoftwareCatalog(
  session: DashboardOpsSessionClient | null,
): Promise<DashboardSoftwareCatalog | DashboardOpsFailure> {
  return withSession(session, ['owner'], async (client, epoch) => {
    const listPromise = client.request(epoch, '/v1/software/releases');
    const currentPromise = client.request(epoch, '/v1/software/releases/current').then((currentResult) => {
      const item = parseContractSchema('SoftwareRelease', currentResult.value);
      return Object.freeze({
        version: item.version,
        platform: item.platform,
        sha256: item.sha256,
        downloadUrl: item.download_url,
        createdAt: item.created_at,
        signed: item.signed,
      });
    }).catch((error: unknown) => {
      if (error instanceof ProductHttpError && error.code === 'GONE') return null;
      throw error;
    });
    const [list, current] = await Promise.all([listPromise, currentPromise]);
    const parsed = parseContractSchema('SoftwareReleaseList', list.value);
    return Object.freeze({
      ok: true as const,
      items: Object.freeze(parsed.items.map((item) => Object.freeze({
        version: item.version,
        platform: item.platform,
        sha256: item.sha256,
        downloadUrl: item.download_url,
        createdAt: item.created_at,
        signed: item.signed,
      }))),
      current,
    });
  });
}
