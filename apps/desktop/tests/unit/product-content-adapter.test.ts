// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type {
  AccessDecision,
  QueryId,
  QueryOutcome,
  ReleaseId,
  Scope,
} from '@customer-agent/unified-contracts';
import {
  ProductContentAdapter,
  type ConnectedQueryClient,
} from '../../src/main/retrieval-content-adapter';

const releaseId = 'rel_synthetic_qry_001' as ReleaseId;
const queryId = 'query_synthetic_001' as QueryId;
const scope = {
  kind: 'source',
  tenantId: 'tenant_synthetic',
  appId: 'app_synthetic',
  brandId: 'brand_synthetic',
  shopId: 'shop_synthetic',
  domain: 'general',
  sourceId: 'source_synthetic',
} as Scope;

function decision(): AccessDecision {
  return {
    userId: 'usr_synthetic_agent' as never,
    role: 'agent',
    state: 'allowed',
    allowedScopes: [{
      scope,
      actions: ['query'],
      validUntil: '2026-11-05T01:00:00.000Z',
    }],
    accessRevision: 1,
    factsVersion: 1,
    revocationGeneration: 0,
    policyVersion: 1,
    storeSetVersion: 1,
    resolvedAt: '2026-11-05T00:00:00.000Z',
    expiresAt: '2026-11-05T01:00:00.000Z',
    denyReason: null,
  };
}

function contentOutcome(
  id: QueryId = queryId,
  copyHandle = 'copy:idx_synthetic:script_synthetic_001:1:aaaa',
  body = '合成发货原文',
): Extract<QueryOutcome, { kind: 'content' }> {
  return {
    kind: 'content',
    queryId: id,
    releaseId,
    candidates: [{
      candidateId: 'script_synthetic_001',
      title: '合成发货',
      body,
      copyHandle,
      rank: 1,
    }],
  };
}

function client(outcome: unknown = contentOutcome()): ConnectedQueryClient {
  return {
    restore: vi.fn(async () => ({ releaseId, decision: decision() })),
    query: vi.fn(async () => outcome),
  };
}

describe('connected product content adapter', () => {
  it('restores current release and QueryAccess scope after a desktop restart', async () => {
    const api = client();
    const adapter = new ProductContentAdapter(api, {
      allows: (value) => value === releaseId,
      subscribe: () => () => {},
    }, vi.fn(), () => new Date('2026-11-05T00:30:00.000Z'));

    await expect(adapter.restore()).resolves.toEqual({ ok: true, releaseId });
    expect(api.restore).toHaveBeenCalledOnce();
    expect(adapter.inspect()).toMatchObject({
      releaseId,
      access: {
        state: 'allowed',
        scopes: [{ scope: { sourceId: 'source_synthetic' }, validUntil: '2026-11-05T01:00:00.000Z' }],
      },
    });
  });

  it('accepts typed content/no-hit/failure but rejects SOP from the ordinary adapter', async () => {
    const content = new ProductContentAdapter(client(), {
      allows: () => true,
      subscribe: () => () => {},
    }, vi.fn(), () => new Date('2026-11-05T00:30:00.000Z'));
    await expect(content.search({ queryId, text: '合成问句' })).resolves.toMatchObject({
      kind: 'content',
      candidates: [{ copyHandle: 'copy:idx_synthetic:script_synthetic_001:1:aaaa' }],
    });

    const noHit = new ProductContentAdapter(client({
      kind: 'no-hit',
      queryId,
      reason: 'no_match',
    }), {
      allows: () => true,
      subscribe: () => () => {},
    }, vi.fn(), () => new Date('2026-11-05T00:30:00.000Z'));
    await expect(noHit.search({ queryId, text: '合成无命中问句' })).resolves.toEqual({
      kind: 'no-hit',
      queryId,
      reason: 'no_match',
    });

    const typedFailure = {
      kind: 'failure' as const,
      queryId,
      failureCode: 'ACCESS_EXPIRED',
      retryable: false,
      message: '登录或权限已过期，请重新登录',
    };
    const failed = new ProductContentAdapter(client(typedFailure), {
      allows: () => true,
      subscribe: () => () => {},
    }, vi.fn(), () => new Date('2026-11-05T00:30:00.000Z'));
    await expect(failed.search({ queryId, text: '合成失败问句' })).resolves.toEqual(typedFailure);

    const sop = new ProductContentAdapter(client({
      kind: 'sop',
      queryId,
      releaseId,
      flow: {
        sopId: 'sop_synthetic',
        title: '合成流程',
        entryStepId: 'step_1',
        steps: [{ stepId: 'step_1', kind: 'terminal', sequence: 1, text: '合成', media: [] }],
        branches: [],
      },
    }), {
      allows: () => true,
      subscribe: () => () => {},
    }, vi.fn(), () => new Date('2026-11-05T00:30:00.000Z'));
    await expect(sop.search({ queryId, text: '合成问句' })).resolves.toMatchObject({
      kind: 'failure',
      failureCode: 'SOP_ROUTE_REJECTED',
    });
  });

  it('copies only an opaque handle from the current typed content outcome', async () => {
    const write = vi.fn();
    const adapter = new ProductContentAdapter(client(), {
      allows: () => true,
      subscribe: () => () => {},
    }, write, () => new Date('2026-11-05T00:30:00.000Z'));
    const outcome = await adapter.search({ queryId, text: '合成问句' });
    if (outcome.kind !== 'content') throw new Error(outcome.kind);
    const handle = outcome.candidates[0]!.copyHandle;

    await expect(adapter.copy({ copyHandle: '合成发货原文' })).resolves.toMatchObject({
      ok: false,
      failureCode: 'COPY_HANDLE_INVALID',
    });
    await expect(adapter.copy({ copyHandle: handle })).resolves.toEqual({ ok: true, copied: true });
    expect(write).toHaveBeenCalledWith('合成发货原文');
  });

  it('propagates platform and product scope through the connected query seam', async () => {
    const api = client();
    const adapter = new ProductContentAdapter(api, {
      allows: () => true,
      subscribe: () => () => {},
    }, vi.fn(), () => new Date('2026-11-05T00:30:00.000Z'));
    await adapter.restore();

    await expect(adapter.search({
      queryId,
      text: '合成问句',
      platform: 'qianniu',
      productContextType: 'sku',
      productContextRef: 'sku_synthetic_current',
    })).resolves.toMatchObject({ kind: 'content' });
    expect(api.query).toHaveBeenCalledWith({
      queryId,
      text: '合成问句',
      expectedReleaseId: releaseId,
      platform: 'qianniu',
      productContextType: 'sku',
      productContextRef: 'sku_synthetic_current',
    });
  });

  it('keeps Q2 current when an older Q1 finishes last', async () => {
    const q1 = 'query_synthetic_001' as QueryId;
    const q2 = 'query_synthetic_002' as QueryId;
    let finishQ1!: (value: QueryOutcome) => void;
    let finishQ2!: (value: QueryOutcome) => void;
    const api: ConnectedQueryClient = {
      restore: vi.fn(async () => ({ releaseId, decision: decision() })),
      query: vi.fn(({ queryId: id }) => new Promise<QueryOutcome>((resolve) => {
        if (id === q1) finishQ1 = resolve;
        else finishQ2 = resolve;
      })),
    };
    const write = vi.fn();
    const adapter = new ProductContentAdapter(api, {
      allows: () => true,
      subscribe: () => () => {},
    }, write, () => new Date('2026-11-05T00:30:00.000Z'));
    await adapter.restore();

    const first = adapter.search({ queryId: q1, text: '合成旧查询' });
    const second = adapter.search({ queryId: q2, text: '合成新查询' });
    finishQ2(contentOutcome(q2, 'copy:q2', '合成 Q2 原文'));
    await expect(second).resolves.toMatchObject({ kind: 'content', queryId: q2 });
    finishQ1(contentOutcome(q1, 'copy:q1', '合成 Q1 原文'));
    await first;

    await expect(adapter.copy({ copyHandle: 'copy:q2' })).resolves.toEqual({ ok: true, copied: true });
    expect(write).toHaveBeenCalledWith('合成 Q2 原文');
    await expect(adapter.copy({ copyHandle: 'copy:q1' })).resolves.toMatchObject({
      ok: false,
      failureCode: 'COPY_HANDLE_INVALID',
    });
  });

  it('fails closed without a synthetic fallback after a connected API failure', async () => {
    const api: ConnectedQueryClient = {
      restore: vi.fn(async () => ({ releaseId, decision: decision() })),
      query: vi.fn(async () => { throw new Error('connected service unavailable'); }),
    };
    const adapter = new ProductContentAdapter(api, {
      allows: () => true,
      subscribe: () => () => {},
    }, vi.fn(), () => new Date('2026-11-05T00:30:00.000Z'));

    await expect(adapter.search({ queryId, text: '什么时候发货' })).resolves.toEqual({
      kind: 'failure',
      queryId,
      failureCode: 'QUERY_UNAVAILABLE',
      retryable: true,
      message: '查询服务暂不可用，请重试',
    });
  });

  it('rejects a stale release and expired scope before a connected query', async () => {
    const stale = new ProductContentAdapter(client(), {
      allows: (value) => value !== releaseId,
      subscribe: () => () => {},
    }, vi.fn(), () => new Date('2026-11-05T00:30:00.000Z'));
    await expect(stale.restore()).resolves.toMatchObject({
      kind: 'failure',
      failureCode: 'RELEASE_STALE',
    });

    const expired = new ProductContentAdapter(client(), {
      allows: () => true,
      subscribe: () => () => {},
    }, vi.fn(), () => new Date('2026-11-05T02:00:00.000Z'));
    await expect(expired.restore()).resolves.toMatchObject({
      kind: 'failure',
      failureCode: 'ACCESS_EXPIRED',
    });
  });
});
