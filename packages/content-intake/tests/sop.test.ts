import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createSyntheticSopWorkbook, parseSopWorkbook, tryParseSopAsFaq, SOP_POLICY_VERSION, SOP_SHEET_NAMES, type SopParseContext } from '@customer-agent/content-intake';

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN5EAAAAASUVORK5CYII=';
const context: SopParseContext = {
  sourceId: 'synthetic-sop-source', brandId: 'synthetic-brand', scope: 'shop-a', scopeKind: 'shop',
  selectedSheets: SOP_SHEET_NAMES,
};

async function fixture(options: { imageOnly?: boolean; extraSheet?: boolean; version?: string } = {}): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  for (const name of SOP_SHEET_NAMES) {
    const sheet = book.addWorksheet(name);
    sheet.getCell('A1').value = options.version && name === SOP_SHEET_NAMES[0] ? '版本' : `合成 SOP ${name}`;
    sheet.getCell('B1').value = options.version && name === SOP_SHEET_NAMES[0] ? options.version : '步骤文字';
    if (options.version && name === SOP_SHEET_NAMES[0]) sheet.getCell('A2').value = options.version;
    else sheet.getCell('A2').value = options.imageOnly && name === SOP_SHEET_NAMES[0] ? '' : '同一行的合成答案';
    sheet.getCell('B2').value = options.imageOnly && name === SOP_SHEET_NAMES[0] ? '' : '保留列顺序\n保留单元格换行';
    if (name === SOP_SHEET_NAMES[0] && !options.imageOnly) sheet.getCell('C2').value = { text: '外部说明标签', hyperlink: 'https://synthetic.example/' };
  }
  const imageId = book.addImage({ base64: ONE_PIXEL_PNG, extension: 'png' });
  book.getWorksheet(SOP_SHEET_NAMES[0])!.addImage(imageId, 'D2:E3');
  book.getWorksheet(SOP_SHEET_NAMES[0])!.addImage(imageId, 'E2:F3');
  if (options.extraSheet) book.addWorksheet('未登记页').getCell('A1').value = '合成额外页';
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe('candidate SOP workbook parser', () => {
  it('normalizes row text and attaches every image anchored on that row', async () => {
    const result = await parseSopWorkbook(await fixture(), context);
    expect(result.ok).toBe(true);
    expect(result.policyVersion).toBe(SOP_POLICY_VERSION);
    expect(result.version).toBe(result.rawSha256); expect(result.versionKind).toBe('sha256');
    expect(result.rows.find((row) => row.sheet === SOP_SHEET_NAMES[0] && row.row === 2)).toMatchObject({
      text: '同一行的合成答案\n保留列顺序\n保留单元格换行\n外部说明标签',
      attachmentIds: [`sop:${SOP_SHEET_NAMES[0]}:2:1`, `sop:${SOP_SHEET_NAMES[0]}:2:2`],
    });
    expect(result.attachments).toHaveLength(2);
    expect(result.attachments.every((attachment) => attachment.base64.length > 0 && attachment.row === 2)).toBe(true);
  });

  it('uses an explicit version cell when a sheet exposes the exact version header', async () => {
    const result = await parseSopWorkbook(await fixture({ version: 'sop-version-synthetic-1' }), context);
    expect(result.ok).toBe(true);
    expect(result.version).toBe('sop-version-synthetic-1'); expect(result.versionKind).toBe('declared');
  });

  it.each([false,true])('preserves the sole parser version through the FAQ adapter: declared=%s', async declared => {
    const bytes = await fixture(declared ? { version: 'sop-adapter-version' } : {});
    const result = await tryParseSopAsFaq(bytes, { sourceId: context.sourceId, brandId: context.brandId, shopId: context.scope });
    expect(result?.parsed.ok).toBe(true);
    const parsed = await parseSopWorkbook(bytes, context);
    expect(result?.contentVersion).toEqual({ kind: declared ? 'declared' : 'sha256', value: parsed.version });
  });

  it('rejects an image-only row and returns no usable partial data', async () => {
    const result = await parseSopWorkbook(await fixture({ imageOnly: true }), context);
    expect(result.ok).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.attachments).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'IMAGE_WITHOUT_TEXT', row: 2 }));
  });

  it('rejects an unregistered sheet instead of silently dropping it', async () => {
    const result = await parseSopWorkbook(await fixture({ extraSheet: true }), context);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_SHEET', sheet: '未登记页' }));
  });
});

it('builds bounded synthetic media windows with stable row identities across smaller successors', async () => {
  const first = await createSyntheticSopWorkbook({ omitFirstImage: true, tailRows: 501, tailImageStart: 401, tailImageCount: 100 });
  const next = await createSyntheticSopWorkbook({ omitFirstImage: true, tailRows: 401, tailImageStart: 301, tailImageCount: 100 });
  const scope = { sourceId: context.sourceId, brandId: context.brandId, shopId: context.scope };
  const a = (await tryParseSopAsFaq(first.bytes, scope))!, b = (await tryParseSopAsFaq(next.bytes, scope))!;
  expect(a.parsed.ok).toBe(true); expect(b.parsed.ok).toBe(true);
  expect(a.previews).toHaveLength(100); expect(b.previews).toHaveLength(100);
  expect(b.rowBindings).toEqual(a.rowBindings.slice(0, b.rowBindings.length));
  expect(a.previews[0]?.row).toBe(403); expect(b.previews.at(-1)?.row).toBe(402);
  await expect(createSyntheticSopWorkbook({ tailRows: 502 })).rejects.toThrow('SYNTHETIC_TAIL_ROWS');
});
