import { createSyntheticSopWorkbook, tryParseSopAsFaq } from '@customer-agent/content-intake';
import { describe, expect, it } from 'vitest';

const scope = { sourceId: 'source', brandId: 'b', shopId: 'shop' };
const rows = (...entries: readonly [string, string][]) => entries.map(([code, text]) => ({ code, text }));

/** Identity is the code the operator writes, not the row it happens to sit on. */
describe('SOP entry codes', () => {
  it('keeps every entry on the same code, with the same text, when a row is inserted above it', async () => {
    const before = await tryParseSopAsFaq((await createSyntheticSopWorkbook({
      firstSheetRows: rows(['A-1', '过敏答案A'], ['A-2', '过敏答案B']),
    })).bytes, scope);
    const after = await tryParseSopAsFaq((await createSyntheticSopWorkbook({
      firstSheetRows: rows(['A-0', '新插入答案'], ['A-1', '过敏答案A'], ['A-2', '过敏答案B']),
    })).bytes, scope);
    const text = (parsed: NonNullable<typeof before>) => new Map(parsed.rowBindings.map(row => [row.businessEntryId, row.answerText]));
    const a = text(before!), b = text(after!);
    const codes = (map: Map<string, string>) => [...map.keys()].filter(code => code.startsWith('A-')).sort();
    expect(codes(a)).toEqual(['A-1', 'A-2']);
    expect(codes(b)).toEqual(['A-0', 'A-1', 'A-2']);
    expect(a.get('A-1')).toBe(b.get('A-1'));
    expect(a.get('A-2')).toBe(b.get('A-2'));
    // The physical row moved; identity and text did not follow it.
    expect(before!.rowBindings.find(row => row.businessEntryId === 'A-1')!.rowId).toBe('sop:过敏流程SOP:2');
    expect(after!.rowBindings.find(row => row.businessEntryId === 'A-1')!.rowId).toBe('sop:过敏流程SOP:3');
  });

  it('refuses a blank code instead of inventing one from the row position', async () => {
    const parsed = await tryParseSopAsFaq((await createSyntheticSopWorkbook({ firstSheetRows: rows(['', '没有编码']) })).bytes, scope);
    expect(parsed?.parsed.ok).toBe(false);
    expect(parsed?.parsed.issues.map(issue => issue.code)).toContain('MISSING_ENTRY_CODE');
  });

  it('refuses a duplicate code across sheets', async () => {
    const parsed = await tryParseSopAsFaq((await createSyntheticSopWorkbook({
      firstSheetRows: rows(['DUP-1', '第一条'], ['DUP-1', '第二条']),
    })).bytes, scope);
    expect(parsed?.parsed.ok).toBe(false);
    expect(parsed?.parsed.issues.map(issue => issue.code)).toContain('ENTRY_CODE_DUPLICATE');
  });

  it('keeps the header row out of the catalog', async () => {
    const parsed = await tryParseSopAsFaq((await createSyntheticSopWorkbook()).bytes, scope);
    expect(parsed!.parsed.rows.map(row => row.body)).not.toContain('答案');
  });
});
