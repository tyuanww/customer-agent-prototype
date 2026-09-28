import { describe, expect, it } from 'vitest';
import { frozenImportCsv } from '../../src/shared/content-frozen-import';

describe('frozen import csv', () => {
  it('writes contract columns from chinese-mapped product rows', () => {
    const csv = frozenImportCsv(
      [{ scene: '30秒泡泡面膜 · 面膜紫适用人群', script: '亲亲这是话术', domain: 'product' }],
      [{ domain: 'product', source_version_id: 'srcv_stack_product_v1' }],
    );
    expect(csv).toContain('script_id,category,title,answer_text,source_version_id,source_ref,question_text');
    expect(csv).toMatch(/upl[0-9a-f]{16},product,/u);
    expect(csv).toContain('srcv_stack_product_v1,SRC-STACK-PRODUCT');
    expect(csv).toContain('亲亲这是话术');
  });

  it('derives a stable identity from content, not from row position', () => {
    const bindings = [{ domain: 'product' as const, source_version_id: 'srcv_stack_product_v1' }];
    const rowA = { scene: '面膜紫适用人群', script: '亲亲这是话术', domain: 'product' as const };
    const rowB = { scene: '面膜紫功效', script: '亲亲这有功效', domain: 'product' as const };
    const idFor = (csv: string, scene: string): string =>
      csv.split('\n').find((line) => line.includes(scene))!.split(',')[0]!;
    // Same content at a different ordinal keeps its identity.
    expect(idFor(frozenImportCsv([rowB, rowA], bindings)!, rowA.scene))
      .toBe(idFor(frozenImportCsv([rowA], bindings)!, rowA.scene));
    // The classic collision: two different tables both hash their row 1 to the same id.
    expect(idFor(frozenImportCsv([rowA], bindings)!, rowA.scene))
      .not.toBe(idFor(frozenImportCsv([rowB], bindings)!, rowB.scene));
    // Re-importing the same table twice is byte-identical.
    expect(frozenImportCsv([rowA, rowB], bindings)).toBe(frozenImportCsv([rowA, rowB], bindings));
    // Identical content in one batch collapses to one identity rather than duplicating it.
    expect(frozenImportCsv([rowA, rowA], bindings)!.split('\n').length).toBe(3);
  });

  it('returns null when rows, domains, bindings, or stack refs are missing', () => {
    const product = { scene: '面膜紫适用人群', script: '亲亲这是话术', domain: 'product' as const };
    const binding = { domain: 'product' as const, source_version_id: 'srcv_stack_product_v1' };
    expect(frozenImportCsv([], [binding])).toBeNull();
    expect(frozenImportCsv([product], [])).toBeNull();
    expect(frozenImportCsv([{ scene: '面膜紫适用人群', script: '亲亲这是话术' }], [binding])).toBeNull();
    expect(frozenImportCsv([product], [{ domain: 'presale', source_version_id: 'srcv_stack_presale_v1' }])).toBeNull();
    expect(frozenImportCsv([product], [{ domain: 'product', source_version_id: 'srcv_not_in_stack_v1' }])).toBeNull();
  });

  it('quotes csv cells and stamps campaign windows plus content ids', () => {
    const csv = frozenImportCsv(
      [
        { scene: '满赠,规则', script: '说"不承诺"库存', domain: 'campaign' },
        { scene: '面膜紫适用人群', script: '亲亲这是话术', domain: 'product' },
      ],
      [
        { domain: 'campaign', source_version_id: 'srcv_stack_campaign_v1' },
        { domain: 'product', source_version_id: 'srcv_stack_product_v1' },
      ],
    );
    expect(csv).toContain('"满赠,规则"');
    expect(csv).toContain('"说""不承诺""库存"');
    expect(csv).toContain('srcv_stack_campaign_v1,SRC-STACK-CAMPAIGN');
    expect(csv).toContain('2026-01-01T00:00:00Z');
    expect(csv).toContain('2099-12-31T00:00:00Z');
    const campaignLine = csv?.split('\n').find((line) => line.includes('srcv_stack_campaign_v1'));
    expect(campaignLine).toMatch(/^upl[0-9a-f]{16},campaign,/u);
    const productLine = csv?.split('\n').find((line) => line.includes('srcv_stack_product_v1'));
    expect(productLine).toMatch(/qianniu,storewide,,,,\n?$/u);
    expect(productLine).not.toContain('2026-01-01');
  });
});
