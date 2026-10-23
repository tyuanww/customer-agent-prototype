import { createSopTemplate, tryParseSopAsFaq } from '@customer-agent/content-intake';
import { describe, expect, it } from 'vitest';

const scope = { sourceId: 'source', brandId: 'b', shopId: 'shop' };

describe('SOP template', () => {
  it('parses with no issues and no rows when the operator deletes the examples', async () => {
    const parsed = await tryParseSopAsFaq(await createSopTemplate(), scope);
    // Every sheet has the code header, so the header check passes; an empty sheet
    // contributes no rows, and the workbook cannot publish an empty catalog.
    expect(parsed?.parsed.issues.map(issue => issue.code)).toEqual(['EMPTY_DATA']);
  });

  it('writes the header and codes so example rows parse as entries', async () => {
    const parsed = await tryParseSopAsFaq(await createSopTemplate([['第一步：确认订单号']]), scope);
    expect(parsed?.parsed.ok).toBe(true);
    expect(parsed?.rowBindings.map(row => row.businessEntryId)).toEqual(['DEMO-1']);
    expect(parsed?.rowBindings[0]?.answerText).toContain('确认订单号');
  });
});
