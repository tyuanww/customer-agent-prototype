import ExcelJS from 'exceljs';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { buildSyntheticMappingDraft, createSyntheticMappingWorkbook, decisionsFromSyntheticMapping } from '../src/sop-source-mapping.js';
import { SYNTHETIC_SOURCE_CREATOR } from '../src/sop-source-inventory.js';
import { SOP_MAINTENANCE_HEADERS } from '../src/maintenance.js';

it('runs the synthetic 1201-object workbook through the file-based batch workflow', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sop-batch-synthetic-'));
  try {
    const output = join(directory, 'demo');
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../scripts/sop-source-mapping-batch-demo.mjs', import.meta.url)), output]);
    const result: unknown = JSON.parse(await readFile(join(output, '合成填写项统计.json'), 'utf8'));
    expect(result).toMatchObject({ sourceObjects: 1201, textObjects: 1200, imageObjects: 1, sourceAreas: 6,
      batchFields: 36, targetFields: 50, pictureFields: 3, entries: 89 });
    const source = await readFile(join(output, '1201合成原表.xlsx'));
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(join(output, '1201合成整理表-已填写.xlsx'));
    const batch = book.getWorksheet('批量整理');
    if (!batch) throw new Error('missing batch sheet');
    for (let row = 3; row <= 8; row++) batch.getRow(row).getCell(4).value = 'KN1';
    await expect(decisionsFromSyntheticMapping(source, Buffer.from(await book.xlsx.writeBuffer()))).rejects.toThrow('最多使用 1000');
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60_000);


it.each([
  { count: 1095, chars: 1500 },
  { count: 1820, chars: 12 },
])('handles $count synthetic source texts of $chars characters without recounting duplicated mapping text', async ({ count, chars }) => {
  const sourceBook = new ExcelJS.Workbook();
  sourceBook.creator = SYNTHETIC_SOURCE_CREATOR;
  const sourceSheet = sourceBook.addWorksheet('合成原表');
  for (let index = 1; index <= count; index++) {
    sourceSheet.getCell(`A${index}`).value = `${'合'.repeat(chars - 8)}${String(index).padStart(8, '0')}`;
  }
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const image = sourceBook.addImage({ buffer: new Uint8Array(png).buffer, extension: 'png' });
  sourceSheet.addImage(image, 'B1:C2');
  const source = Buffer.from(await sourceBook.xlsx.writeBuffer());
  const mapping = new ExcelJS.Workbook();
  await mapping.xlsx.load(new Uint8Array(await createSyntheticMappingWorkbook(source)).buffer);
  const target = mapping.getWorksheet('知识与案例'), batch = mapping.getWorksheet('批量整理');
  if (!target || !batch) throw new Error('missing synthetic mapping sheets');
  const fields: Record<string, string> = { 知识编号: 'K1', 标题: '合成知识', 可见对象: '坐席可读' };
  target.addRow(['KN', '', ...SOP_MAINTENANCE_HEADERS.知识与案例.filter(header => header !== '维护状态' && header !== '业务确认人').map(header => fields[header] ?? '')]);
  batch.addRow(['合成原表', 'A1:A15', '使用', 'KN', '正文', '换行']);
  const mappingBytes = Buffer.from(await mapping.xlsx.writeBuffer());
  const result = await buildSyntheticMappingDraft(source, mappingBytes);
  expect(result.decisions.decisions).toHaveLength(count + 1);
  expect(result.check.counts).toMatchObject({ objects: count + 1, mapped: 15, pending: count - 14 });
  expect(result.check).toMatchObject({ sourceCheck: 'needs-review', publishable: false });
  const generated = new ExcelJS.Workbook();
  await generated.xlsx.load(new Uint8Array(result.draft.workbook).buffer);
  const actual = generated.getWorksheet('知识与案例')?.getCell('C3').value;
  const expected = Array.from({ length: 15 }, (_, i) => sourceSheet.getCell(`A${i + 1}`).value).join('\n');
  expect(actual).toBe(expected);
}, 120_000);


it('keeps the unknown-object budget when unrelated target cells are outside the text inventory', async () => {
  const sourceBook = new ExcelJS.Workbook();
  sourceBook.creator = SYNTHETIC_SOURCE_CREATOR;
  sourceBook.addWorksheet('合成原表').getCell('A1').value = '合成来源';
  const source = Buffer.from(await sourceBook.xlsx.writeBuffer());
  const mapping = new ExcelJS.Workbook();
  await mapping.xlsx.load(new Uint8Array(await createSyntheticMappingWorkbook(source)).buffer);
  const target = mapping.getWorksheet('知识与案例');
  if (!target) throw new Error('missing target sheet');
  for (let index = 0; index < 20_001; index++) target.getCell(Math.floor(index / 4) + 1, index % 4 + 1).value = 42;
  await expect(decisionsFromSyntheticMapping(source, Buffer.from(await mapping.xlsx.writeBuffer()))).rejects.toThrow('SOURCE_OBJECT_LIMIT');
}, 60_000);
