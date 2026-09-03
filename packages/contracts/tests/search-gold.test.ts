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
      note: string;
    });

    expect(cases.length).toBeGreaterThan(0);
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length);
    for (const entry of cases) {
      expect(validate(entry), `${entry.id}: ${JSON.stringify(validate.errors)}`).toBe(true);
      expect(entry.query_text).not.toMatch(/Menokin|达肤妍/i);
      expect(entry.note).toContain('合成');
    }
  });
});
