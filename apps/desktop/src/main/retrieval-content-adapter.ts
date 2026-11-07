import {
  parseAccessDecision,
  parseQueryOutcome,
  toQueryAccessView,
  type AccessDecision,
  type QueryAccessView,
  type QueryId,
  type QueryOutcome,
  type ReleaseId,
} from '@customer-agent/unified-contracts';
import type { AnnounceGate } from '../shared/product-announce';

export type ConnectedQueryClient = Readonly<{
  restore: () => Promise<Readonly<{
    releaseId: ReleaseId;
    decision: AccessDecision;
  }>>;
  query: (input: Readonly<{
    queryId: QueryId;
    text: string;
    expectedReleaseId: ReleaseId;
  } & ProductQueryContext>) => Promise<unknown>;
}>;

export type ProductQueryContext = Readonly<{
  platform?: 'qianniu' | 'douyin';
  productContextType?: 'category' | 'sku' | null;
  productContextRef?: string | null;
}>;

export type ProductContentSearchInput = Readonly<{
  queryId: QueryId;
  text: string;
} & ProductQueryContext>;

export type ProductContentAdapterFailure = Extract<QueryOutcome, { kind: 'failure' }>;

export type ProductContentRestoreResult =
  | Readonly<{ ok: true; releaseId: ReleaseId }>
  | ProductContentAdapterFailure;

export type ProductContentCopyResult =
  | Readonly<{ ok: true; copied: true }>
  | Readonly<{ ok: false; failureCode: string; message: string }>;

type ContentOutcome = Extract<QueryOutcome, { kind: 'content' }>;

function failure(
  queryId: QueryId,
  failureCode: string,
  retryable: boolean,
  message: string,
): ProductContentAdapterFailure {
  return Object.freeze({ kind: 'failure', queryId, failureCode, retryable, message });
}

function copyFailure(failureCode: string, message: string): ProductContentCopyResult {
  return Object.freeze({ ok: false, failureCode, message });
}

function hasLiveAccess(access: QueryAccessView, now: number): boolean {
  return access.state === 'allowed'
    && now < Date.parse(access.expiresAt)
    && access.scopes.some(({ validUntil }) => now < Date.parse(validUntil));
}

/**
 * Main-process projection for the connected product profile. It accepts only
 * ARC-validated content/no-hit/failure outcomes, stores copy bodies internally,
 * and exposes an opaque handle to the renderer integration seam.
 */
export class ProductContentAdapter {
  private context: Readonly<{
    releaseId: ReleaseId;
    access: QueryAccessView;
  }> | null = null;
  private lastContent: ContentOutcome | null = null;
  private copyBodies = new Map<string, string>();
  private queryGeneration = 0;

  constructor(
    private readonly client: ConnectedQueryClient,
    private readonly announce: AnnounceGate,
    private readonly writeClipboard: (text: string) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  inspect(): Readonly<{
    releaseId: ReleaseId | null;
    access: QueryAccessView | null;
    copyHandleCount: number;
  }> {
    return Object.freeze({
      releaseId: this.context?.releaseId ?? null,
      access: this.context?.access ?? null,
      copyHandleCount: this.copyBodies.size,
    });
  }

  async restore(): Promise<ProductContentRestoreResult> {
    const generation = ++this.queryGeneration;
    this.clearOutcome();
    return this.restoreContext(generation);
  }

  private async restoreContext(generation: number): Promise<ProductContentRestoreResult> {
    const queryId = 'restore' as QueryId;
    try {
      const restored = await this.client.restore();
      const decision = parseAccessDecision(restored.decision);
      const access = toQueryAccessView(decision);
      if (generation !== this.queryGeneration) {
        return failure(queryId, 'QUERY_SUPERSEDED', true, '已有更新的查询');
      }
      if (!hasLiveAccess(access, this.now().valueOf())) {
        this.clear();
        return failure(queryId, 'ACCESS_EXPIRED', false, '登录或权限已过期，请重新登录');
      }
      if (!this.announce.allows(restored.releaseId)) {
        this.clear();
        return failure(queryId, 'RELEASE_STALE', true, '内容版本已变化，请重新查询');
      }
      this.context = Object.freeze({
        releaseId: restored.releaseId,
        access,
      });
      this.lastContent = null;
      this.copyBodies.clear();
      return Object.freeze({ ok: true, releaseId: restored.releaseId });
    } catch {
      if (generation === this.queryGeneration) this.clear();
      return failure(queryId, 'QUERY_UNAVAILABLE', true, '查询服务暂不可用，请重试');
    }
  }

  async search(input: ProductContentSearchInput): Promise<QueryOutcome | ProductContentAdapterFailure> {
    const generation = ++this.queryGeneration;
    this.clearOutcome();
    try {
      if (this.context === null) {
        const restored = await this.restoreContext(generation);
        if (generation !== this.queryGeneration) {
          return failure(input.queryId, 'QUERY_SUPERSEDED', true, '已有更新的查询');
        }
        if ('kind' in restored && restored.kind === 'failure') {
          return failure(input.queryId, restored.failureCode, restored.retryable, restored.message);
        }
      }
      const context = this.context;
      if (context === null) {
        return failure(input.queryId, 'QUERY_UNAVAILABLE', true, '查询服务暂不可用，请重试');
      }
      if (!hasLiveAccess(context.access, this.now().valueOf())) {
        this.clear();
        return failure(input.queryId, 'ACCESS_EXPIRED', false, '登录或权限已过期，请重新登录');
      }
      if (!this.announce.allows(context.releaseId)) {
        this.clear();
        return failure(input.queryId, 'RELEASE_STALE', true, '内容版本已变化，请重新查询');
      }
      const response = await this.client.query({
        queryId: input.queryId,
        text: input.text,
        expectedReleaseId: context.releaseId,
        ...(input.platform === undefined ? {} : { platform: input.platform }),
        ...(input.productContextType === undefined
          ? {}
          : { productContextType: input.productContextType }),
        ...(input.productContextRef === undefined
          ? {}
          : { productContextRef: input.productContextRef }),
      });
      if (generation !== this.queryGeneration) {
        return failure(input.queryId, 'QUERY_SUPERSEDED', true, '已有更新的查询');
      }
      const parsed = parseQueryOutcome(response);
      if (parsed.kind === 'sop') {
        this.clearOutcome();
        return failure(input.queryId, 'SOP_ROUTE_REJECTED', false, '普通查询不能返回售后流程');
      }
      if (parsed.kind === 'content') {
        if (parsed.queryId !== input.queryId || parsed.releaseId !== context.releaseId) {
          this.clearOutcome();
          return failure(input.queryId, 'QUERY_OUTCOME_INVALID', false, '查询结果绑定无效');
        }
        this.lastContent = parsed;
        this.copyBodies = new Map(parsed.candidates.map((candidate) => [candidate.copyHandle, candidate.body]));
      } else {
        this.clearOutcome();
      }
      return parsed;
    } catch {
      if (generation !== this.queryGeneration) {
        return failure(input.queryId, 'QUERY_SUPERSEDED', true, '已有更新的查询');
      }
      this.clearOutcome();
      return failure(input.queryId, 'QUERY_UNAVAILABLE', true, '查询服务暂不可用，请重试');
    }
  }

  async copy(input: Readonly<{
    copyHandle: string;
    placeholderValues?: Partial<Record<'order_id' | 'date', string>>;
  }>): Promise<ProductContentCopyResult> {
    try {
      const context = this.context;
      if (context === null
        || this.lastContent === null
        || !hasLiveAccess(context.access, this.now().valueOf())
        || !this.announce.allows(context.releaseId)) {
        this.clearOutcome();
        return copyFailure('STALE', '查询结果已失效，请重新查询');
      }
      const body = this.copyBodies.get(input.copyHandle);
      if (body === undefined) return copyFailure('COPY_HANDLE_INVALID', '复制凭据无效，请重新查询');
      const text = body.replace(/\{(订单号|日期)\}/gu, (_match, key: string) => (
        input.placeholderValues?.[key === '订单号' ? 'order_id' : 'date'] ?? ''
      ));
      if (/[{}]/u.test(text)) return copyFailure('VALIDATION', '请先填写完整信息');
      this.writeClipboard(text);
      return Object.freeze({ ok: true, copied: true });
    } catch {
      return copyFailure('CLIPBOARD_FAILED', '复制失败，请重试');
    }
  }

  private clearOutcome(): void {
    this.lastContent = null;
    this.copyBodies.clear();
  }

  private clear(): void {
    this.context = null;
    this.clearOutcome();
  }
}
