import { describe, expect, it } from 'vitest';
import { frozenImportCsv } from '../../src/shared/content-frozen-import';

describe('frozen import csv', () => {
  it('writes contract columns from chinese-mapped product rows', () => {
    const csv = frozenImportCsv(
      [{ scene: '30秒泡泡面膜 · 面膜紫适用人群', script: '亲亲这是话术', domain: 'product' }],
      [{ domain: 'product', source_version_id: 'srcv_stack_product_v1' }],
    );
    expect(csv).toContain('script_id,category,title,answer_text,source_version_id,source_ref,question_text');
    expect(csv).toContain('upl00001,product,');
    expect(csv).toContain('srcv_stack_product_v1,SRC-STACK-PRODUCT');
    expect(csv).toContain('亲亲这是话术');
  });
});
