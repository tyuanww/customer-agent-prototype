import { readFile } from 'node:fs/promises';
import { Ajv2020 } from 'ajv/dist/2020.js';
import * as formatsModule from 'ajv-formats';
import type { FormatsPlugin } from 'ajv-formats';
import { describe, expect, it } from 'vitest';

const fixtureRoot = new URL('../../../tests/fixtures/search/', import.meta.url);
const addFormats = (formatsModule.default ?? formatsModule) as unknown as FormatsPlugin;

describe('DEV-M1 search gold-set entry contract', () => {
  it('keeps the frozen JSONL shape, synthetic boundary and paired product context', async () => {
    const [schemaSource, goldSource] = await Promise.all([
      readFile(new URL('zh-gold.schema.json', fixtureRoot), 'utf8'),
      readFile(new URL('zh-gold.jsonl', fixtureRoot), 'utf8'),
    ]);
    const schema = JSON.parse(schemaSource) as Record<string, unknown>;
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const cases = goldSource.trim().split('\n').map((line) => JSON.parse(line) as {
      id: string;
      query_text: string;
      platform: 'qianniu' | 'douyin' | 'unknown' | null;
      product_context_type: 'category' | 'sku' | null;
      product_context_ref: string | null;
      expected_any_top3: string[];
      forbidden_script_ids: string[];
      note: string;
    });

    expect(cases).toHaveLength(50);
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length);
    expect(new Set(cases.map((entry) => JSON.stringify([
      entry.query_text,
      entry.platform,
      entry.product_context_type,
      entry.product_context_ref,
    ]))).size).toBe(cases.length);
    for (const [index, entry] of cases.entries()) {
      expect(validate(entry), `${entry.id}: ${JSON.stringify(validate.errors)}`).toBe(true);
      expect(entry.id).toBe(`ZH-${String(index + 1).padStart(3, '0')}`);
      expect(entry.query_text).not.toMatch(/Menokin|达肤妍/i);
      expect(entry.query_text).not.toMatch(/(?:^|\D)1[3-9]\d{9}(?:\D|$)/u);
      expect(entry.note).toContain('合成');
      expect(entry.platform === 'qianniu' || entry.platform === 'douyin').toBe(true);
      expect(entry.product_context_type === null).toBe(entry.product_context_ref === null);
      expect(entry.expected_any_top3.some((id) => entry.forbidden_script_ids.includes(id))).toBe(false);

      if (index < 20) {
        expect(entry.note).toMatch(/^合成正例：/u);
        expect(entry.expected_any_top3.length).toBeGreaterThan(0);
      } else if (index < 32) {
        expect(entry.note).toMatch(/^合成安全负例\/(信息不足|冲突过期|跨平台|错SKU|越权承诺|敏感信息)：/u);
        expect(entry.expected_any_top3).toEqual([]);
      } else {
        expect(entry.note).toMatch(/^合成鲁棒性：/u);
        expect(entry.expected_any_top3.length).toBeGreaterThan(0);
      }
    }

    const safetyClasses = cases.slice(20, 32).map((entry) => entry.note.split(/[/：]/u)[1]);
    for (const safetyClass of ['信息不足', '冲突过期', '跨平台', '错SKU', '越权承诺', '敏感信息']) {
      expect(safetyClasses.filter((value) => value === safetyClass)).toHaveLength(2);
    }
  });
});
