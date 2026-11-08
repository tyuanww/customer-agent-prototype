import {
  parseAccessDecision,
  parseQueryOutcome,
  toQueryAccessView,
  type QueryAccessView,
  type QueryId,
  type QueryOutcome,
  type ReleaseId,
  type ReleaseSnapshot,
} from '@customer-agent/unified-contracts';
import type {
  ContentPipeline,
  ContentPipelineQuery,
  ContentPipelineResult,
} from './content-pipeline.js';
import {
  ReleaseSnapshotError,
  type ReleaseStore,
} from './release-snapshot.js';

export type QueryRoute = 'content' | 'sop' | 'auto';

export type QueryAccessEvaluator = Readonly<{
  evaluate: (input: Readonly<{ queryId: QueryId }>) => Promise<unknown>;
}>;

export type QueryRequest = Readonly<{
  queryId: QueryId;
  text: string;
  route: QueryRoute;
  expectedReleaseId?: ReleaseId;
  releaseLeaseExpiresAt?: string;
  signal?: AbortSignal;
  platform?: 'qianniu' | 'douyin';
  productContextType?: 'category' | 'sku' | null;
  productContextRef?: string | null;
}>;

export type QueryExecutionContext = Readonly<{
  queryId: QueryId;
  text: string;
  access: QueryAccessView;
  snapshot: ReleaseSnapshot;
  signal?: AbortSignal;
}>;

export type SopPipeline = Readonly<{
  matches?: (text: string) => boolean;
  query: (
    input: QueryExecutionContext,
  ) => Promise<Extract<QueryOutcome, { kind: 'sop' | 'no-hit' | 'failure' }>>;
}>;

export type QueryTelemetryEvent = Readonly<{
  queryId: QueryId;
  releaseId: ReleaseId | null;
  outcomeKind: QueryOutcome['kind'];
  failureCode: string | null;
  candidates: readonly Readonly<{
    candidateId: string;
    rank: number;
  }>[];
}>;

export type QueryTelemetry = Readonly<{
  record: (event: QueryTelemetryEvent) => void;
}>;

type QueryCoordinatorDependencies = Readonly<{
  access: QueryAccessEvaluator;
  releases: ReleaseStore;
  content: Pick<ContentPipeline, 'query'>;
  sop?: SopPipeline;
  telemetry?: QueryTelemetry;
  now?: () => Date;
}>;

function failure(
  queryId: QueryId,
  failureCode: string,
  retryable: boolean,
  message: string,
): Extract<QueryOutcome, { kind: 'failure' }> {
  return Object.freeze({ kind: 'failure', queryId, failureCode, retryable, message });
}

function noHit(
  queryId: QueryId,
  reason: string,
): Extract<QueryOutcome, { kind: 'no-hit' }> {
  return Object.freeze({ kind: 'no-hit', queryId, reason });
}

function validTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasLiveAccess(access: QueryAccessView, now: number): boolean {
  return access.state === 'allowed'
    && now < Date.parse(access.expiresAt)
    && access.scopes.some(({ validUntil }) => {
      const until = validTime(validUntil);
      return until !== null && now < until;
    });
}

function raceAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return work;
  if (signal.aborted) return Promise.reject(new DOMException('Query cancelled', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const cancel = (): void => reject(new DOMException('Query cancelled', 'AbortError'));
    signal.addEventListener('abort', cancel, { once: true });
    void work.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', cancel);
    });
  });
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function contentMissReason(reason: Extract<ContentPipelineResult, { ok: false }>['reason']): string {
  return reason;
}

function validateSopResult(
  value: unknown,
  request: QueryRequest,
  snapshot: ReleaseSnapshot,
): Extract<QueryOutcome, { kind: 'sop' | 'no-hit' | 'failure' }> {
  const parsed = parseQueryOutcome(value);
  if (parsed.kind === 'content') {
    return failure(
      request.queryId,
      'PIPELINE_VARIANT_INVALID',
      false,
      '查询路由返回了错误的结果类型',
    );
  }
  if (parsed.queryId !== request.queryId) {
    return failure(request.queryId, 'PIPELINE_RESULT_INVALID', false, '查询结果绑定无效');
  }
  if (parsed.kind === 'sop' && parsed.releaseId !== snapshot.releaseId) {
    return failure(request.queryId, 'RELEASE_STALE', true, '内容版本已变化，请重新查询');
  }
  return parsed;
}

/**
 * Sole owner of ordinary/SOP dispatch and the pre-ranking access boundary.
 * Content and SOP pipelines only receive a validated access view, current
 * release and already-resolved route.
 */
export class QueryCoordinator {
  constructor(private readonly dependencies: QueryCoordinatorDependencies) {}

  private now(): number {
    return (this.dependencies.now?.() ?? new Date()).valueOf();
  }

  private record(
    request: QueryRequest,
    outcome: QueryOutcome,
    releaseId: ReleaseId | null,
  ): void {
    try {
      this.dependencies.telemetry?.record({
        queryId: request.queryId,
        releaseId,
        outcomeKind: outcome.kind,
        failureCode: outcome.kind === 'failure' ? outcome.failureCode : null,
        candidates: outcome.kind === 'content'
          ? outcome.candidates.map((candidate) => Object.freeze({
              candidateId: candidate.candidateId,
              rank: candidate.rank,
            }))
          : [],
      });
    } catch {
      // Telemetry is observational and never changes a query outcome.
    }
  }

  async query(request: QueryRequest): Promise<QueryOutcome> {
    let releaseId: ReleaseId | null = null;
    let outcome: QueryOutcome;
    try {
      if (request.signal?.aborted) {
        outcome = failure(request.queryId, 'QUERY_CANCELLED', true, '查询已取消');
      } else if (request.text.trim().length === 0) {
        outcome = failure(request.queryId, 'VALIDATION', false, '请输入客户问题');
      } else {
        const decision = parseAccessDecision(
          await raceAbort(this.dependencies.access.evaluate({ queryId: request.queryId }), request.signal),
        );
        const access = toQueryAccessView(decision);
        if (access.state !== 'allowed') {
          outcome = failure(request.queryId, 'ACCESS_DENIED', false, '没有查询权限');
        } else if (!hasLiveAccess(access, this.now())) {
          outcome = failure(request.queryId, 'ACCESS_EXPIRED', false, '登录或权限已过期，请重新登录');
        } else {
          const snapshot = await raceAbort(this.dependencies.releases.current(), request.signal);
          if (snapshot === null) {
            outcome = failure(request.queryId, 'RELEASE_UNAVAILABLE', true, '内容版本暂不可用，请重试');
          } else {
            releaseId = snapshot.releaseId;
            const leaseUntil = request.releaseLeaseExpiresAt === undefined
              ? null
              : validTime(request.releaseLeaseExpiresAt);
            const postReadNow = this.now();
            if (!hasLiveAccess(access, postReadNow)) {
              outcome = failure(request.queryId, 'ACCESS_EXPIRED', false, '登录或权限已过期，请重新登录');
            } else if (request.expectedReleaseId !== undefined && request.expectedReleaseId !== snapshot.releaseId) {
              outcome = failure(request.queryId, 'RELEASE_STALE', true, '内容版本已变化，请重新查询');
            } else if (request.releaseLeaseExpiresAt !== undefined && leaseUntil === null) {
              outcome = failure(request.queryId, 'VALIDATION', false, '内容版本租约无效');
            } else if (leaseUntil !== null && postReadNow >= leaseUntil) {
              outcome = failure(request.queryId, 'RELEASE_LEASE_EXPIRED', true, '内容版本租约已过期，请重新查询');
            } else {
              const sopSelected = request.route === 'sop'
                || (request.route === 'auto' && this.dependencies.sop?.matches?.(request.text) === true);
              if (sopSelected) {
                if (this.dependencies.sop === undefined) {
                  outcome = failure(request.queryId, 'SOP_UNAVAILABLE', false, '该问题需要售后流程，但当前版本尚不可用');
                } else {
                  const value = await raceAbort(this.dependencies.sop.query({
                    queryId: request.queryId,
                    text: request.text,
                    access,
                    snapshot,
                    ...(request.signal === undefined ? {} : { signal: request.signal }),
                  }), request.signal);
                  outcome = validateSopResult(value, request, snapshot);
                }
              } else if (snapshot.content.state !== 'ready') {
                outcome = noHit(request.queryId, 'release_empty');
              } else {
                const pipelineInput: ContentPipelineQuery = {
                  queryId: request.queryId,
                  text: request.text,
                  snapshot,
                  access,
                  ...(request.signal === undefined ? {} : { signal: request.signal }),
                  ...(request.platform === undefined ? {} : { platform: request.platform }),
                  ...(request.productContextType === undefined
                    ? {}
                    : { productContextType: request.productContextType }),
                  ...(request.productContextRef === undefined
                    ? {}
                    : { productContextRef: request.productContextRef }),
                };
                const result = await raceAbort(this.dependencies.content.query(pipelineInput), request.signal);
                if (result.ok) {
                  const parsed = parseQueryOutcome(result.content);
                  if (parsed.kind !== 'content'
                    || parsed.queryId !== request.queryId
                    || parsed.releaseId !== snapshot.releaseId) {
                    outcome = failure(request.queryId, 'PIPELINE_RESULT_INVALID', false, '查询结果绑定无效');
                  } else {
                    outcome = parsed;
                  }
                } else if (result.reason === 'release_mismatch') {
                  outcome = failure(request.queryId, 'RELEASE_STALE', true, '内容版本已变化，请重新查询');
                } else if (result.reason === 'cancelled') {
                  outcome = failure(request.queryId, 'QUERY_CANCELLED', true, '查询已取消');
                } else {
                  outcome = noHit(request.queryId, contentMissReason(result.reason));
                }
              }
            }
          }
        }
      }
    } catch (error) {
      if (isAbort(error) || request.signal?.aborted === true) {
        outcome = failure(request.queryId, 'QUERY_CANCELLED', true, '查询已取消');
      } else if (error instanceof ReleaseSnapshotError) {
        outcome = failure(request.queryId, 'RELEASE_INVALID', true, '内容版本暂不可用，请重试');
      } else {
        outcome = failure(request.queryId, 'PIPELINE_FAILED', true, '查询暂不可用，请重试');
      }
    }
    this.record(request, outcome, releaseId);
    return outcome;
  }
}
