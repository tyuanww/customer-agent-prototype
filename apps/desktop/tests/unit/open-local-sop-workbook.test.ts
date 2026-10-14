import { expect, it, vi } from 'vitest';
import { LOCAL_SOP_WORKBOOK_MAX_BYTES, openLocalSopWorkbook } from '../../src/shared/open-local-sop-workbook';

it('does not call the parser when the file is over the limit', async () => {
  const parse = vi.fn();
  const reply = await openLocalSopWorkbook('big.xlsx', Buffer.alloc(LOCAL_SOP_WORKBOOK_MAX_BYTES + 1), parse);
  expect(reply).toEqual({ ok: false, code: 'INVALID', message: '文件超过 10MB，没有读取。' });
  expect(parse).not.toHaveBeenCalled();
});

it('returns an unpublished preview and hides rows the parser rejected', async () => {
  const accepted = await openLocalSopWorkbook('SOP.xlsx', Buffer.from('ok'), async () => ({
    ok: true,
    rows: [{ sheet: '少错破SOP', row: 2, text: '索要凭证', attachmentIds: ['img'] }],
    issues: [],
  }));
  expect(accepted.ok && accepted.published).toBe(false);
  expect(accepted.ok && accepted.sheets[0]?.lines[0]).toEqual({ row: 2, text: '索要凭证', images: 1 });
  const rejected = await openLocalSopWorkbook('坏表.xlsx', Buffer.from('bad'), async () => ({
    ok: false,
    rows: [{ sheet: '少错破SOP', row: 2, text: '不该出现', attachmentIds: [] }],
    issues: [{ code: 'MISSING_SHEET', sheet: '长痘痘SOP', row: 1, fix: '选择存在的 SOP 工作表' }],
  }));
  expect(rejected.ok && rejected.accepted).toBe(false);
  expect(rejected.ok && rejected.sheets).toEqual([]);
});

it('turns a parser failure into a read error', async () => {
  const reply = await openLocalSopWorkbook('坏.xlsx', Buffer.from('x'), async () => {
    throw new Error('excel');
  });
  expect(reply).toEqual({ ok: false, code: 'INVALID', message: '这个文件读不开。' });
});
