import { describe, expect, it } from 'vitest';
import {
  CONTENT_PUBLISH_COPY,
  STACK_SOURCE_BINDINGS,
  STACK_SOURCE_REFS,
  bindingsForRows,
  contentPublishGate,
  isDashboardContentImportRequest,
  isDashboardContentPublishRequest,
  isDashboardContentSessionResult,
  rowCoachPublishable,
  rowRequiresOwner,
} from '../../src/shared/dashboard-content';

const productRow = { scene: '洁面用量确认', script: '先确认产品版本', domain: 'product' as const };
const campaignRow = { scene: '满赠规则说明', script: '不承诺库存', domain: 'campaign' as const };
const aftersaleRow = { scene: '售后质量升级', script: '记录必要证据', domain: 'aftersale' as const };
const allergyRow = { scene: '过敏了怎么办', script: '先停用并观察', domain: 'product' as const };
const compensationRow = { scene: '赔付说明', script: '不承诺赔付金额', domain: 'campaign' as const };
const unlabeledRow = { scene: '洁面用量确认', script: '先确认产品版本' };
const presaleRow = { scene: '发货时效', script: '付款后发出', domain: 'presale' as const };

describe('content publish role gate', () => {
  it('maps draft domains onto the synthetic-stack registered source versions', () => {
    expect(bindingsForRows([productRow])).toEqual([
      { domain: 'product', source_version_id: 'srcv_stack_product_v1' },
    ]);
    expect(bindingsForRows([productRow, aftersaleRow]).map((binding) => binding.domain).sort()).toEqual([
      'aftersale',
      'product',
    ]);
    expect(bindingsForRows([unlabeledRow])).toEqual([]);
    expect(STACK_SOURCE_BINDINGS).toHaveLength(4);
    expect(STACK_SOURCE_REFS).toEqual({
      srcv_stack_presale_v1: 'SRC-STACK-PRESALE',
      srcv_stack_campaign_v1: 'SRC-STACK-CAMPAIGN',
      srcv_stack_aftersale_v1: 'SRC-STACK-AFTERSALE',
      srcv_stack_product_v1: 'SRC-STACK-PRODUCT',
    });
  });

  it('requires owner for aftersale domain and 过敏/赔付 text', () => {
    expect(rowRequiresOwner(aftersaleRow)).toBe(true);
    expect(rowRequiresOwner(allergyRow)).toBe(true);
    expect(rowRequiresOwner(compensationRow)).toBe(true);
    expect(rowRequiresOwner(productRow)).toBe(false);
    expect(rowRequiresOwner(campaignRow)).toBe(false);
    expect(rowCoachPublishable(productRow)).toBe(true);
    expect(rowCoachPublishable(presaleRow)).toBe(false);
    expect(rowCoachPublishable(unlabeledRow)).toBe(false);
  });

  it('blocks missing product session, unsigned-in users, and empty drafts', () => {
    expect(contentPublishGate({
      productAvailable: false, signedIn: false, role: null, rows: [productRow],
    })).toEqual({ allowed: false, code: 'UNAVAILABLE', message: CONTENT_PUBLISH_COPY.noProduct });
    expect(contentPublishGate({
      productAvailable: true, signedIn: false, role: null, rows: [productRow],
    })).toEqual({ allowed: false, code: 'UNAUTHORIZED', message: CONTENT_PUBLISH_COPY.noSession });
    expect(contentPublishGate({
      productAvailable: true, signedIn: true, role: 'owner', rows: [],
    })).toEqual({ allowed: false, code: 'VALIDATION', message: CONTENT_PUBLISH_COPY.noDraft });
  });

  it('never allows agent to publish', () => {
    expect(contentPublishGate({
      productAvailable: true, signedIn: true, role: 'agent', rows: [productRow],
    })).toEqual({ allowed: false, code: 'FORBIDDEN', message: CONTENT_PUBLISH_COPY.agent });
    expect(contentPublishGate({
      productAvailable: true, signedIn: true, role: 'agent', rows: [],
    })).toEqual({ allowed: false, code: 'FORBIDDEN', message: CONTENT_PUBLISH_COPY.agent });
  });

  it('allows coach only for labeled product/campaign without 过敏/赔付', () => {
    const bindings = [{ domain: 'product' as const, source_version_id: 'srcv_a' }];
    expect(contentPublishGate({
      productAvailable: true, signedIn: true, role: 'coach', rows: [productRow, campaignRow],
      sourceBindings: bindings,
    })).toEqual({ allowed: true });
    expect(contentPublishGate({
      productAvailable: true, signedIn: true, role: 'coach', rows: [productRow],
    })).toEqual({ allowed: false, code: 'VALIDATION', message: CONTENT_PUBLISH_COPY.missingBindings });
    expect(contentPublishGate({
      productAvailable: true, signedIn: true, role: 'coach', rows: [aftersaleRow],
    })).toEqual({ allowed: false, code: 'FORBIDDEN', message: CONTENT_PUBLISH_COPY.sensitive });
    expect(contentPublishGate({
      productAvailable: true, signedIn: true, role: 'coach', rows: [productRow, allergyRow],
    })).toEqual({ allowed: false, code: 'FORBIDDEN', message: CONTENT_PUBLISH_COPY.sensitive });
    expect(contentPublishGate({
      productAvailable: true, signedIn: true, role: 'coach', rows: [compensationRow],
    })).toEqual({ allowed: false, code: 'FORBIDDEN', message: CONTENT_PUBLISH_COPY.sensitive });
    expect(contentPublishGate({
      productAvailable: true, signedIn: true, role: 'coach', rows: [unlabeledRow],
    })).toEqual({ allowed: false, code: 'FORBIDDEN', message: CONTENT_PUBLISH_COPY.coachScope });
    expect(contentPublishGate({
      productAvailable: true, signedIn: true, role: 'coach', rows: [presaleRow],
    })).toEqual({ allowed: false, code: 'FORBIDDEN', message: CONTENT_PUBLISH_COPY.coachScope });
  });

  it('allows owner to publish restricted drafts', () => {
    expect(contentPublishGate({
      productAvailable: true, signedIn: true, role: 'owner', rows: [aftersaleRow, allergyRow],
      sourceBindings: [{ domain: 'aftersale', source_version_id: 'srcv_a' }],
    })).toEqual({ allowed: true });
    expect(contentPublishGate({
      productAvailable: true, signedIn: true, role: 'owner', rows: [aftersaleRow],
    })).toEqual({ allowed: false, code: 'VALIDATION', message: CONTENT_PUBLISH_COPY.missingBindings });
  });

  it('accepts the dashboard content session projection without credentials', () => {
    expect(isDashboardContentSessionResult({
      ok: true, enabled: true, signedIn: true, role: 'coach',
    })).toBe(true);
    expect(isDashboardContentSessionResult({
      ok: true, enabled: false, signedIn: false, role: null,
    })).toBe(true);
    expect(isDashboardContentSessionResult({
      ok: true, enabled: true, signedIn: true, role: 'coach', access_token: 'secret',
    })).toBe(false);
  });

  it('rejects import/publish payloads that invent extra fields', () => {
    expect(isDashboardContentImportRequest({
      sourceName: 'draft.csv',
      csvText: 'scene,script\n洁面,先确认版本\n',
      sourceBindings: [{ domain: 'product', source_version_id: 'srcv_product_v1' }],
    })).toBe(true);
    expect(isDashboardContentImportRequest({
      sourceName: 'draft.csv',
      csvText: 'scene,script\n洁面,先确认版本\n',
      sourceBindings: [{ domain: 'product', source_version_id: 'not-a-source' }],
    })).toBe(false);
    expect(isDashboardContentPublishRequest({
      sourceName: 'draft.csv',
      csvText: 'scene,script,domain\n洁面,先确认版本,product\n',
      rows: [productRow],
      title: '工作台草稿',
      summary: null,
      sourceBindings: [],
    })).toBe(true);
  });
});
