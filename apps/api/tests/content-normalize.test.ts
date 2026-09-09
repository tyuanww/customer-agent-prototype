import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { parseImportFile, sampleScriptIds, utcTimestampText } from '../src/content-normalize.js';

const CSV = Buffer.from([
  'script_id,category,title,answer_text,source_version_id,source_ref,question_text,risk_level,has_conflict',
  'shipping-001,presale,发货时效,您好订单将发出,srcv_t3_presale_v1,SRC-T3-PRESALE,什么时候发货,low,false',
  '',
].join('\n'));

function zipCsv(name: string, csv: Buffer): Buffer {
  const compressed = deflateRawSync(csv);
  const nameBytes = Buffer.from(name);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(csv.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  return Buffer.concat([header, nameBytes, compressed]);
}

describe('content import normalization', () => {
  const defaults = { intentTaxonomyVersion: 'itax_synthetic_t3_v1', intentId: 'intent_synthetic_t3_shipping' };

  it('parses CSV into DEC-042 staging rows without review self-assertion', () => {
    const rows = parseImportFile(CSV, 'csv', defaults);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.script_id).toBe('shipping-001');
    expect(rows[0]?.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows[0])).not.toMatch(/review_mode|quality_gate_passed|primary_reviewer/);
    expect(sampleScriptIds(rows, 'ab'.repeat(32), 1)).toContain('shipping-001');
  });

  it('reads a bounded xlsx zip that carries a csv member', () => {
    const payload = zipCsv('xl/scripts.csv', CSV);
    const rows = parseImportFile(payload, 'excel', defaults);
    expect(rows[0]?.title).toBe('发货时效');
  });

  it('serializes timestamps with six UTC microsecond digits', () => {
    expect(utcTimestampText(new Date('2026-09-09T01:02:03.123Z'))).toBe('2026-09-09T01:02:03.123000Z');
  });

  it('rejects an xlsx zip member that is not stored or deflated', () => {
    const nameBytes = Buffer.from('xl/scripts.csv');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(9, 8);
    header.writeUInt32LE(4, 18);
    header.writeUInt32LE(4, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    expect(() => parseImportFile(Buffer.concat([header, nameBytes, Buffer.from('abcd')]), 'excel', defaults))
      .toThrow('UNSUPPORTED_FORMAT');
  });

  it('defaults absent scope columns to a single platform storewide row', () => {
    const rows = parseImportFile(CSV, 'csv', defaults);
    expect(rows[0]?.platform_scope).toEqual(['qianniu']);
    expect(rows[0]?.product_scope_type).toBe('storewide');
    expect(rows[0]?.product_scope_refs).toEqual([]);
  });

  it('reads optional platform and product scope columns into the governance hash', () => {
    const scoped = Buffer.from([
      'script_id,category,title,answer_text,source_version_id,source_ref,question_text,platform_scope,product_scope_type,product_scope_refs',
      'sku-001,product,澄芽洁面用法,合成正文,srcv_t3_product_v1,SRC-T3-PRODUCT,澄芽洁面怎么用,qianniu|douyin,sku,cat_cleanser|sku_chengyajiemian',
      '',
    ].join('\n'));
    const rows = parseImportFile(scoped, 'csv', defaults);
    expect(rows[0]?.platform_scope).toEqual(['qianniu', 'douyin']);
    expect(rows[0]?.product_scope_type).toBe('sku');
    expect(rows[0]?.product_scope_refs).toEqual(['cat_cleanser', 'sku_chengyajiemian']);
    const unscoped = parseImportFile(CSV, 'csv', defaults);
    expect(rows[0]?.content_hash).not.toBe(unscoped[0]?.content_hash);
  });

  it('fails closed on invalid scope columns instead of ignoring them', () => {
    const header = 'script_id,category,title,answer_text,source_version_id,source_ref,question_text';
    const base = 'sku-001,product,澄芽洁面用法,合成正文,srcv_t3_product_v1,SRC-T3-PRODUCT,澄芽洁面怎么用';
    const cases: readonly (readonly [string, string])[] = [
      ['platform_scope', `${header},platform_scope\n${base},taobao\n`],
      ['platform_scope duplicate', `${header},platform_scope\n${base},qianniu|qianniu\n`],
      ['product_scope_type', `${header},product_scope_type\n${base},global\n`],
      ['storewide refs', `${header},product_scope_type,product_scope_refs\n${base},storewide,cat_cleanser\n`],
      ['empty sku refs', `${header},product_scope_type,product_scope_refs\n${base},sku,\n`],
    ];
    for (const [label, csv] of cases) {
      expect(() => parseImportFile(Buffer.from(csv), 'csv', defaults), label)
        .toThrow('CONTENT_CONTRACT_INVALID');
    }
  });

  it('reads declared placeholder keys and requires them to match the body', () => {
    const header = 'script_id,category,title,answer_text,source_version_id,source_ref,question_text';
    const withPlaceholder = `${header},placeholder_keys\n`
      + 'order-001,presale,订单查询,您的订单号是 {订单号}，请稍候。,srcv_t3_presale_v1,SRC-T3-PRESALE,查订单,order_id\n';
    const rows = parseImportFile(Buffer.from(withPlaceholder), 'csv', defaults);
    expect(rows[0]?.placeholder_keys).toEqual(['order_id']);

    const undeclared = `${header}\norder-001,presale,订单查询,您的订单号是 {订单号}。,srcv_t3_presale_v1,SRC-T3-PRESALE,查订单\n`;
    expect(() => parseImportFile(Buffer.from(undeclared), 'csv', defaults)).toThrow('CONTENT_CONTRACT_INVALID');
    const mismatched = `${header},placeholder_keys\norder-001,presale,订单查询,没有占位符。,srcv_t3_presale_v1,SRC-T3-PRESALE,查订单,order_id\n`;
    expect(() => parseImportFile(Buffer.from(mismatched), 'csv', defaults)).toThrow('CONTENT_CONTRACT_INVALID');
    const unknownKey = `${header},placeholder_keys\norder-001,presale,订单查询,正文,srcv_t3_presale_v1,SRC-T3-PRESALE,查订单,phone\n`;
    expect(() => parseImportFile(Buffer.from(unknownKey), 'csv', defaults)).toThrow('CONTENT_CONTRACT_INVALID');
  });

  it('requires a bounded effective window for campaign rows', () => {
    const header = 'script_id,category,title,answer_text,source_version_id,source_ref,question_text';
    const base = 'campaign-001,campaign,满赠,活动期间满 299 赠旅行装。,srcv_t3_campaign_v1,SRC-T3-CAMPAIGN,满赠怎么参加';
    expect(() => parseImportFile(Buffer.from(`${header}\n${base}\n`), 'csv', defaults))
      .toThrow('CONTENT_CONTRACT_INVALID');
    const bounded = parseImportFile(
      Buffer.from(`${header},effective_from,effective_to\n${base},2026-01-01T00:00:00Z,2099-12-31T00:00:00Z\n`),
      'csv', defaults,
    );
    expect(bounded[0]?.effective_to).toBe('2099-12-31T00:00:00.000000Z');
    const inverted = `${header},effective_from,effective_to\n${base},2099-01-01T00:00:00Z,2026-01-01T00:00:00Z\n`;
    expect(() => parseImportFile(Buffer.from(inverted), 'csv', defaults)).toThrow('CONTENT_CONTRACT_INVALID');
  });
});
