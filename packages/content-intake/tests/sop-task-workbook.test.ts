import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseSopTaskWorkbook, SopTaskWorkbookFailure, SOP_TASK_SHEETS, SOP_RESOURCE_FORMAT } from '../src/sop-task-workbook.js';
import { graphImageFixtures, syntheticTaskGraphWorkbook } from './support/sop-task-graph-workbook.js';

describe('registered v1.1 six-table parser', () => {
  it('preserves complete task, confirmation, branch and distinct image records', async () => {
    const parsed = await parseSopTaskWorkbook(await syntheticTaskGraphWorkbook());
    expect(Object.keys(parsed.sheets)).toEqual(SOP_TASK_SHEETS);
    expect(parsed.sheets['执行任务'].filter(row => row.values['记录类型'] === '确认项')).toHaveLength(2);
    expect(parsed.sheets['判断分支'].map(row => row.values['是否无法判断'])).toEqual(['否', '是']);
    expect(parsed.images).toHaveLength(3);
    for (const image of parsed.images) expect(image.bytes).toEqual(graphImageFixtures.get(image.resourceId)!.bytes);
  });

  it('rejects a historical header with exact coordinates', async () => {
    await expect(parseSopTaskWorkbook(await syntheticTaskGraphWorkbook({ wrongHeader: true }))).rejects.toMatchObject({
      issue: { code: 'SOP_MAPPING_REQUIRED', sheet: '执行任务', row: 1, column: 'A' },
    });
  });

  it('blocks independent resource disable with an exact report location until its material and quality contract exists', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await syntheticTaskGraphWorkbook() as unknown as ExcelJS.Buffer);
    const resources = book.getWorksheet('资源与图片')!;
    resources.getCell('H3').value = '停用';
    await expect(parseSopTaskWorkbook(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toMatchObject({
      issue: { code: 'SOP_MAPPING_REQUIRED', sheet: '资源与图片', row: 3, column: 'H' },
    });
  });

  it('retains rich text and refuses formulas outside the explicit image column', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await syntheticTaskGraphWorkbook() as unknown as ExcelJS.Buffer);
    const cell = book.getWorksheet('客户话术')!.getCell('C2');
    cell.value = { richText: [{ text: '合成原文\n' }, { text: '😀保持原字符', font: { bold: true } }] };
    const parsed = await parseSopTaskWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
    expect(parsed.sheets['客户话术'][0]!.values['对客正文']).toBe('合成原文\n😀保持原字符');
    cell.value = { formula: '1+1', result: 2 };
    try {
      await parseSopTaskWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
      throw new Error('Formula was accepted as canonical text');
    } catch (error) {
      expect(error).toBeInstanceOf(SopTaskWorkbookFailure);
      expect(error).toMatchObject({ issue: { code: 'NON_TEXT_CELL', sheet: '客户话术', row: 2, column: 'C' } });
    }
  });

  it('retains explicitly reviewed resource disables for the registered successor rule', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await syntheticTaskGraphWorkbook() as unknown as ExcelJS.Buffer);
    book.getWorksheet('资源与图片')!.getCell('H3').value = '停用';
    const parsed = await parseSopTaskWorkbook(Buffer.from(await book.xlsx.writeBuffer()), SOP_RESOURCE_FORMAT.ruleVersion);
    expect(parsed.sheets['资源与图片'][1]).toMatchObject({ row: 3, values: { 维护状态: '停用' } });
    expect(parsed.images).toHaveLength(3);
  });

  it('still rejects a successor resource disable with unresolved review or another unsupported row kind', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await syntheticTaskGraphWorkbook() as unknown as ExcelJS.Buffer);
    const resources = book.getWorksheet('资源与图片')!;
    resources.getCell('H3').value = '停用';
    resources.getCell('J3').value = '合成待确认项';
    await expect(parseSopTaskWorkbook(Buffer.from(await book.xlsx.writeBuffer()), SOP_RESOURCE_FORMAT.ruleVersion))
      .rejects.toMatchObject({ issue: { code: 'SOP_MAPPING_REQUIRED', sheet: '资源与图片', row: 3 } });
    resources.getCell('J3').value = '';
    const tasks = book.getWorksheet('执行任务')!;
    tasks.getCell(2, tasks.columnCount - 2).value = '停用';
    await expect(parseSopTaskWorkbook(Buffer.from(await book.xlsx.writeBuffer()), SOP_RESOURCE_FORMAT.ruleVersion))
      .rejects.toMatchObject({ code: 'SOP_MAPPING_REQUIRED' });
  });
});
