import { randomUUID } from 'node:crypto';
import type { QueryResult, QueryResultRow } from 'pg';

export type IterationTaskCause = 'content_gap' | 'ranking' | 'stale';

export type IterationSignalClient = Readonly<{
  query: <R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ) => Promise<Pick<QueryResult<R>, 'rows' | 'rowCount'>>;
}>;

export type OpenIterationSignalInput = Readonly<{
  clusterKey: string;
  signalId: string;
  cause: IterationTaskCause;
  queryId: string;
  suggestedScriptIds: readonly string[];
}>;

const CLUSTER_KEY_MAX = 512;
const SIGNAL_ID_MAX = 128;
const SCRIPT_ID_MAX = 128;

export function clipIterationToken(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max);
}

export function noHitClusterKey(input: Readonly<{
  platform: string;
  productContextType: 'category' | 'sku' | null;
  productContextRef: string | null;
}>): string {
  const type = input.productContextType ?? 'none';
  const ref = input.productContextRef && input.productContextRef.trim().length > 0
    ? input.productContextRef.trim()
    : 'storewide';
  return clipIterationToken(`no_hit:${type}:${ref}:${input.platform}`, CLUSTER_KEY_MAX);
}

export function rankingClusterKey(skippedScriptId: string): string {
  return clipIterationToken(`top1_skipped:${skippedScriptId.trim()}`, CLUSTER_KEY_MAX);
}

export function staleClusterKey(scriptId: string): string {
  return clipIterationToken(`stale:${scriptId.trim()}`, CLUSTER_KEY_MAX);
}

export function candidateIsExpired(effectiveTo: string | null, nowMs: number): boolean {
  if (effectiveTo === null) return false;
  const expiresAt = Date.parse(effectiveTo);
  return Number.isFinite(expiresAt) && nowMs >= expiresAt;
}

export async function openSignalsFromRecordedSearch(
  client: IterationSignalClient,
  input: Readonly<{
    queryId: string;
    platform: string;
    productContextType: 'category' | 'sku' | null;
    productContextRef: string | null;
    candidates: readonly Readonly<{ script_id: string; effective_to: string | null }>[];
    nowMs?: number;
  }>,
): Promise<void> {
  if (input.candidates.length === 0) {
    const clusterKey = noHitClusterKey(input);
    await openIterationSignal(client, {
      clusterKey,
      signalId: clusterKey,
      cause: 'content_gap',
      queryId: input.queryId,
      suggestedScriptIds: [],
    });
    return;
  }
  const nowMs = input.nowMs ?? Date.now();
  for (const candidate of input.candidates) {
    if (!candidateIsExpired(candidate.effective_to, nowMs)) continue;
    const clusterKey = staleClusterKey(candidate.script_id);
    await openIterationSignal(client, {
      clusterKey,
      signalId: clusterKey,
      cause: 'stale',
      queryId: input.queryId,
      suggestedScriptIds: [candidate.script_id],
    });
  }
}

export async function openIterationSignal(
  client: IterationSignalClient,
  input: OpenIterationSignalInput,
): Promise<boolean> {
  const clusterKey = clipIterationToken(input.clusterKey, CLUSTER_KEY_MAX);
  const signalId = clipIterationToken(input.signalId, SIGNAL_ID_MAX);
  const queryId = input.queryId.trim();
  if (clusterKey.length < 1 || signalId.length < 1 || queryId.length < 1) return false;
  const suggested = Object.freeze(input.suggestedScriptIds
    .map((scriptId) => clipIterationToken(scriptId, SCRIPT_ID_MAX))
    .filter((scriptId) => scriptId.length > 0)
    .slice(0, 50));
  const existing = await client.query(
    `SELECT 1 FROM public.iteration_tasks
     WHERE cluster_key = $1 AND status IN ('open', 'in_progress')
     LIMIT 1`,
    [clusterKey],
  );
  if ((existing.rowCount ?? existing.rows.length) > 0) return false;
  const taskId = `itask_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
  await client.query(
    `INSERT INTO public.iteration_tasks (
      task_id, signal_id, cluster_key, sample_query_ids, suspected_cause,
      suggested_script_ids, status, version
    ) VALUES ($1, $2, $3, $4, $5, $6, 'open', 1)`,
    [taskId, signalId, clusterKey, [queryId], input.cause, [...suggested]],
  );
  return true;
}
