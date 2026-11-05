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

function contentOutcome(): Extract<QueryOutcome, { kind: 'content' }> {
  return {
    kind: 'content',
    queryId,
    releaseId,
    candidates: [{
      candidateId: 'script_synthetic_001',
      title: '合成发货',
      body: '合成发货原文',
      copyHandle: 'copy:idx_synthetic:script_synthetic_001:1:aaaa',
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
