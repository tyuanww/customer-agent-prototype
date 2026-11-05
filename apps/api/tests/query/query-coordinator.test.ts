import { describe, expect, it, vi } from 'vitest';
import type {
  AccessDecision,
  QueryId,
  QueryOutcome,
  ReleaseId,
  ReleaseSnapshot,
  Scope,
  SopFlow,
} from '@customer-agent/unified-contracts';
import { ContentPipeline, type ContentIndexItem } from '../../src/query/content-pipeline.js';
import {
  QueryCoordinator,
  type QueryTelemetryEvent,
} from '../../src/query/query-coordinator.js';
import { createReleaseStore } from '../../src/query/release-snapshot.js';

const now = '2026-11-05T00:30:00.000Z';
const releaseId = 'rel_synthetic_qry_001' as ReleaseId;
const queryId = 'query_synthetic_001' as QueryId;
const sourceScope = {
  kind: 'source',
  tenantId: 'tenant_synthetic',
  appId: 'app_synthetic',
  brandId: 'brand_synthetic',
  shopId: 'shop_synthetic',
  domain: 'general',
  sourceId: 'source_synthetic',
} as Scope;

function snapshot(): ReleaseSnapshot {
  return {
    releaseId,
    sequence: 1,
    publishedAt: '2026-11-05T00:00:00.000Z',
    content: {
      state: 'ready',
      indexId: 'idx_synthetic_content_001',
      indexVersion: 1,
      itemCount: 3,
      indexHash: 'a'.repeat(64),
    },
    sop: {
      state: 'ready',
      indexId: 'idx_synthetic_sop_001',
      indexVersion: 1,
      itemCount: 1,
      indexHash: 'b'.repeat(64),
    },
  };
}

function candidate(index: number): ContentIndexItem {
  return {
    releaseId,
    scriptId: `script_synthetic_${String(index).padStart(3, '0')}`,
    scriptVersion: 1,
    contentHash: String(index).repeat(64).slice(0, 64),
    title: `合成发货时效 ${String(index)}`,
    body: `合成发货原文 ${String(index)}`,
    questionTexts: ['什么时候发货'],
    platformScope: ['qianniu', 'douyin'],
    productScopeType: 'storewide',
    productScopeRefs: [],
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    scope: sourceScope,
  };
}

function access(overrides: Partial<AccessDecision> = {}): AccessDecision {
  return {
    userId: 'usr_synthetic_agent' as never,
    role: 'agent',
    state: 'allowed',
    allowedScopes: [{
      scope: sourceScope,
      actions: ['query'],
      validUntil: '2026-11-06T01:00:00.000Z',
    }],
    accessRevision: 1,
    factsVersion: 1,
    revocationGeneration: 0,
    policyVersion: 1,
    storeSetVersion: 1,
    resolvedAt: '2026-11-05T00:00:00.000Z',
    expiresAt: '2026-11-06T01:00:00.000Z',
    denyReason: null,
    ...overrides,
  };
}

function fixture(options: {
  decision?: AccessDecision;
  current?: ReleaseSnapshot | null;
  contentQuery?: ReturnType<typeof vi.fn>;
  sop?: {
    matches?: (text: string) => boolean;
    query: (input: unknown) => Promise<Extract<QueryOutcome, { kind: 'sop' | 'no-hit' | 'failure' }>>;
  };
} = {}) {
  const releaseRead = vi.fn(async () => options.current === undefined ? snapshot() : options.current);
  const contentPipeline = new ContentPipeline();
  contentPipeline.activate(snapshot(), [candidate(3), candidate(1), candidate(2)]);
  const query = options.contentQuery ?? vi.fn(contentPipeline.query.bind(contentPipeline));
  const telemetry: QueryTelemetryEvent[] = [];
  const coordinator = new QueryCoordinator({
    access: { evaluate: async () => options.decision ?? access() },
    releases: createReleaseStore(releaseRead),
    content: { query: query as ContentPipeline['query'] },
    ...(options.sop === undefined ? {} : { sop: options.sop }),
    telemetry: { record: (event) => telemetry.push(event) },
    now: () => new Date(now),
  });
  return { coordinator, releaseRead, query, telemetry };
}

describe('QueryCoordinator', () => {
  it('resolves access before the release store or ranking', async () => {
    const query = vi.fn();
    const f = fixture({
      decision: access({
        state: 'denied',
        allowedScopes: [],
        denyReason: 'POLICY_DENIED',
      }),
      contentQuery: query,
    });

    await expect(f.coordinator.query({
      queryId,
      text: '合成发货时效',
      route: 'content',
    })).resolves.toMatchObject({
      kind: 'failure',
      failureCode: 'ACCESS_DENIED',
      retryable: false,
    });
    expect(f.releaseRead).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed on stale release identity, release lease expiry, and access expiry', async () => {
    const f = fixture();
    await expect(f.coordinator.query({
      queryId,
      text: '合成发货时效',
      route: 'content',
      expectedReleaseId: 'rel_synthetic_qry_old' as ReleaseId,
    })).resolves.toMatchObject({ kind: 'failure', failureCode: 'RELEASE_STALE' });
    await expect(f.coordinator.query({
      queryId,
      text: '合成发货时效',
      route: 'content',
      expectedReleaseId: releaseId,
      releaseLeaseExpiresAt: '2026-11-05T00:20:00.000Z',
    })).resolves.toMatchObject({ kind: 'failure', failureCode: 'RELEASE_LEASE_EXPIRED' });

    const expired = fixture({
      decision: access({ expiresAt: '2026-11-05T00:20:00.000Z' }),
    });
    await expect(expired.coordinator.query({
      queryId,
      text: '合成发货时效',
      route: 'content',
    })).resolves.toMatchObject({ kind: 'failure', failureCode: 'ACCESS_EXPIRED' });
    expect(expired.query).not.toHaveBeenCalled();
  });

  it('returns content, no-hit, cancellation, and stable failure variants', async () => {
    const f = fixture();
    await expect(f.coordinator.query({
      queryId,
      text: '合成发货时效',
      route: 'content',
    })).resolves.toMatchObject({
      kind: 'content',
      queryId,
      releaseId,
      candidates: [
        { candidateId: 'script_synthetic_001', rank: 1 },
        { candidateId: 'script_synthetic_002', rank: 2 },
        { candidateId: 'script_synthetic_003', rank: 3 },
      ],
    });
    await expect(f.coordinator.query({
      queryId: 'query_synthetic_002' as QueryId,
      text: '完全无关问题',
      route: 'content',
    })).resolves.toMatchObject({
      kind: 'no-hit',
      reason: 'no_match',
    });

    const controller = new AbortController();
    controller.abort();
    await expect(f.coordinator.query({
      queryId: 'query_synthetic_003' as QueryId,
      text: '合成发货时效',
      route: 'content',
      signal: controller.signal,
    })).resolves.toMatchObject({
      kind: 'failure',
      failureCode: 'QUERY_CANCELLED',
      retryable: true,
    });

    const broken = fixture({
      contentQuery: vi.fn(async () => { throw new Error('private ranking failure'); }),
    });
    await expect(broken.coordinator.query({
      queryId,
      text: '合成发货时效',
      route: 'content',
    })).resolves.toEqual({
      kind: 'failure',
      queryId,
      failureCode: 'PIPELINE_FAILED',
      retryable: true,
      message: '查询暂不可用，请重试',
    });
  });

  it('ignores a content result that arrives after cancellation', async () => {
    let finish!: (result: Awaited<ReturnType<ContentPipeline['query']>>) => void;
    const delayed = vi.fn(() => new Promise<Awaited<ReturnType<ContentPipeline['query']>>>((resolve) => {
      finish = resolve;
    }));
    const f = fixture({ contentQuery: delayed });
    const controller = new AbortController();
    const started = vi.fn();
    delayed.mockImplementation(() => new Promise<Awaited<ReturnType<ContentPipeline['query']>>>((resolve) => {
      finish = resolve;
      started();
    }));
    const pending = f.coordinator.query({
      queryId,
      text: '合成发货时效',
      route: 'content',
      signal: controller.signal,
    });
    while (!started.mock.calls.length) await Promise.resolve();
    controller.abort();
    await expect(pending).resolves.toMatchObject({
      kind: 'failure',
      failureCode: 'QUERY_CANCELLED',
    });
    finish({
      ok: true,
      content: {
        kind: 'content',
        queryId,
        releaseId,
        candidates: [{
          candidateId: 'late',
          title: 'late',
          body: 'late',
          copyHandle: 'copy:late',
          rank: 1,
        }],
      },
    });
    await expect(pending).resolves.toMatchObject({ kind: 'failure', failureCode: 'QUERY_CANCELLED' });
  });

  it('owns discriminated ordinary/SOP dispatch without changing the outward union', async () => {
    const flow: SopFlow = {
      sopId: 'sop_synthetic_001',
      title: '合成流程',
      entryStepId: 'step_1',
      steps: [{ stepId: 'step_1', kind: 'terminal', sequence: 1, text: '合成步骤', media: [] }],
      branches: [],
    };
    const sopQuery = vi.fn(async () => ({
      kind: 'sop' as const,
      queryId,
      releaseId,
      flow,
    }));
    const content = vi.fn(async (input: { queryId: QueryId }) => ({
      ok: true as const,
      content: {
        kind: 'content' as const,
        queryId: input.queryId,
        releaseId,
        candidates: [{
          candidateId: 'script_synthetic_001',
          title: '合成发货',
          body: '合成发货原文 1',
          copyHandle: 'copy:synthetic',
          rank: 1 as const,
        }],
      },
    }));
    const f = fixture({
      sop: { matches: (text) => text.includes('过敏'), query: sopQuery },
      contentQuery: content,
    });

    await expect(f.coordinator.query({
      queryId,
      text: '合成过敏售后怎么处理',
      route: 'auto',
    })).resolves.toMatchObject({ kind: 'sop', releaseId, flow: { sopId: 'sop_synthetic_001' } });
    expect(sopQuery).toHaveBeenCalledOnce();
    expect(content).not.toHaveBeenCalled();

    await expect(f.coordinator.query({
      queryId: 'query_synthetic_002' as QueryId,
      text: '合成发货时效',
      route: 'content',
    })).resolves.toMatchObject({ kind: 'content' });
    expect(content).toHaveBeenCalledOnce();
  });

  it('records query, release, candidate IDs, ranks, and outcomes without question or answer text', async () => {
    const f = fixture();
    await f.coordinator.query({
      queryId,
      text: '顾客原始问句不应进入遥测',
      route: 'content',
    });
    await f.coordinator.query({
      queryId: 'query_synthetic_002' as QueryId,
      text: '另一个不应记录的原始问句',
      route: 'content',
    });

    expect(f.telemetry).toEqual([
      {
        queryId,
        releaseId,
        outcomeKind: 'no-hit',
        failureCode: null,
        candidates: [],
      },
      {
        queryId: 'query_synthetic_002',
        releaseId,
        outcomeKind: 'no-hit',
        failureCode: null,
        candidates: [],
      },
    ]);
    expect(JSON.stringify(f.telemetry)).not.toContain('顾客原始问句');
    expect(JSON.stringify(f.telemetry)).not.toContain('合成发货原文');
  });
});
