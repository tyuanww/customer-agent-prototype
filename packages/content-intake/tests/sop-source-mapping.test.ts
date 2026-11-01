import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { parseSopMaintenance, SOP_MAINTENANCE_HEADERS } from '../src/maintenance.js';
import { inspectSyntheticSopSource, SYNTHETIC_SOURCE_CREATOR } from '../src/sop-source-inventory.js';
import { buildSyntheticMappingDraft, createSyntheticMappingReport, createSyntheticMappingWorkbook, decisionsFromSyntheticMapping } from '../src/sop-source-mapping.js';
import { runSyntheticMappingCli } from '../src/sop-source-mapping-cli.js';
import { checkSyntheticSopSourceDraft } from '../src/sop-source-draft.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
type Name = keyof typeof SOP_MAINTENANCE_HEADERS;
vi.setConfig({ testTimeout: 15_000 });

async function sourceWorkbook(withImage = true, secondImage = false): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = SYNTHETIC_SOURCE_CREATOR;
  const sheet = book.addWorksheet('合成原表');
  sheet.getCell('A1').value = '合成😀甲乙';
  sheet.getCell('B1').value = '合成后半';
  sheet.getCell('C1').value = '合成场景';
  sheet.getCell('D1').value = '合成操作';
  sheet.getCell('E1').value = '合成终点';
  if (withImage) {
    const image = book.addImage({ buffer: new Uint8Array(png).buffer, extension: 'png' });
    sheet.addImage(image, 'F1:G2');
    if (secondImage) {
      const tag = Buffer.from('tEXt'), data = Buffer.from('Comment\0synthetic second image');
      const chunk = Buffer.alloc(data.length + 12);
      chunk.writeUInt32BE(data.length); tag.copy(chunk, 4); data.copy(chunk, 8);
      chunk.writeUInt32BE(crc32(Buffer.concat([tag, data])), data.length + 8);
      const second = Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
      const id = book.addImage({ buffer: new Uint8Array(second).buffer, extension: 'png' });
      sheet.addImage(id, 'H1:I2');
    }
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function load(bytes: Buffer): Promise<ExcelJS.Workbook> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(bytes).buffer);
  return book;
}
async function save(book: ExcelJS.Workbook): Promise<Buffer> { return Buffer.from(await book.xlsx.writeBuffer()); }

function find(sheet: ExcelJS.Worksheet, id: string): ExcelJS.Row {
  for (let row = 4; row <= sheet.rowCount; row++) if (sheet.getRow(row).getCell(1).value === id) return sheet.getRow(row);
  throw new Error(`missing synthetic source ${id}`);
}
function target(book: ExcelJS.Workbook, sheetName: Name, key: string, fields: Record<string, string>, note = ''): void {
  const sheet = book.getWorksheet(sheetName);
  if (!sheet) throw new Error('missing target sheet');
  sheet.addRow([key, note, ...SOP_MAINTENANCE_HEADERS[sheetName].filter(header => header !== '维护状态' && header !== '业务确认人').map(header => fields[header] ?? '')]);
}
function map(row: ExcelJS.Row, key: string, field: string, join = ''): void {
  row.getCell(6).value = '使用';
  row.getCell(7).value = key;
  row.getCell(8).value = field;
  row.getCell(9).value = join;
}

async function edited(source: Buffer, options: { withImage?: boolean; withLink?: boolean } = {}): Promise<Buffer> {
  const book = await load(await createSyntheticMappingWorkbook(source));
  const sheet = book.getWorksheet('来源整理');
  if (!sheet) throw new Error('missing mapping sheet');
  const original = find(sheet, 'c:1:A1');
  const second = sheet.addRow(Array.isArray(original.values) ? [...original.values].slice(1) : []);
  original.getCell(5).value = '合成😀';
  second.getCell(5).value = '甲乙';
  map(original, 'KN', '正文', '换行');
  map(second, 'SCRIPT', '对客正文');
  map(find(sheet, 'c:1:B1'), 'KN', '正文', '换行');
  map(find(sheet, 'c:1:C1'), 'SCENE', '场景名称');
  map(find(sheet, 'c:1:D1'), 'TASK1', '操作要求');
  map(find(sheet, 'c:1:E1'), 'TASK2', '操作要求');
  if (options.withImage !== false) map(find(sheet, 'p:1:1:1'), 'IMAGE', '图片');
  target(book, '场景目录', 'SCENE', { 场景编号: 'SC1', 适用范围: '合成范围', 起始任务编号: 'T1', 入口词: '合成' });
  target(book, '执行任务', 'TASK1', { 记录类型: '任务', 任务编号: 'T1', 场景编号: 'SC1', 阶段: '操作', 任务名称: '操作', 任务类型: '操作', 确认项配置: '无确认项', 下一任务编号: 'T2', 关联知识编号: 'K1', 关联资源编号: options.withImage === false ? '' : 'R1', 可见对象: '坐席可读' });
  target(book, '执行任务', 'TASK2', { 记录类型: '任务', 任务编号: 'T2', 场景编号: 'SC1', 阶段: '结束', 任务名称: '结束', 任务类型: '终点', 确认项配置: '无确认项', 可见对象: '坐席可读' });
  target(book, '知识与案例', 'KN', { 知识编号: 'K1', 标题: '合成知识', 可见对象: '坐席可读' });
  target(book, '客户话术', 'SCRIPT', { 话术编号: 'S1', 话术标题: '合成话术' });
  if (options.withImage !== false) target(book, '资源与图片', 'IMAGE', { 资源编号: 'R1', 资源类型: '图片', 资源名称: '合成图片', 可见对象: '坐席可读', 适用范围: '合成范围' });
  if (options.withLink) target(book, '执行任务', 'LINK', { 记录类型: '话术引用', 关联编号: 'L1', 任务编号: 'T1', 话术编号: 'S1', 适用条件: '合成条件', 话术关系: '独立' }, '合成示例手工新增');
  return save(book);
}

it('converts an edited Excel workbook with split, merge, an image and explicit target fields', async () => {
  const source = await sourceWorkbook(), mapping = await edited(source);
  const result = await buildSyntheticMappingDraft(source, mapping);
  expect(result.check).toMatchObject({ sourceCheck: 'needs-review', publishable: false, workbookMatchesMapping: true });
  expect(result.check.reasons).toContain('IMAGE_REVIEW_REQUIRED');
  expect(result.check.counts).toMatchObject({ objects: 6, segments: 7, mapped: 7, pending: 0 });
  const parsed = await parseSopMaintenance(result.draft.workbook);
  expect(parsed.kind).toBe('parsed');
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.document.knowledge[0]?.body).toBe('合成😀\n合成后半');
  expect(parsed.document.scripts[0]?.answerText).toBe('甲乙');
  expect(parsed.document.branches).toEqual([]);
  expect(parsed.document.resources[0]).toMatchObject({ kind: 'image', images: [{ bytes: png }] });
  expect(result.draft.report.ledger.find(item => item.sourceId === 'c:1:A1')?.segments).toEqual([
    expect.objectContaining({ start: 0, end: 3, targets: ['KN.正文'] }),
    expect.objectContaining({ start: 3, end: 5, targets: ['SCRIPT.对客正文'] }),
  ]);
  const report = await load(await createSyntheticMappingReport(source, result.draft, result.check, result.decisions, result.draft.workbook));
  const summary = report.getWorksheet('核对概览');
  expect(summary?.getCell('B2').value).toBe('已覆盖');
  expect(summary?.getCell('B3').value).toBe('未核验');
  expect(summary?.getCell('F7').value).toBe(0);
  const detail = report.getWorksheet('预期来源去向');
  expect(detail?.rowCount).toBe(8);
  expect(detail?.getColumn(7).values).toContain('KN.正文');
  expect(report.getWorksheet('图片归属')?.getCell('D2').value).toBe('R1');
  expect(report.getWorksheet('图片归属')?.getCell('E2').value).toContain('任务 T1');
  expect(report.getWorksheet('图片归属')?.getCell('G2').value).toContain('任务 T1');
  expect(report.getWorksheet('维护稿问题')?.rowCount).toBeGreaterThan(1);
  const fields = report.getWorksheet('预期字段来源');
  const rows = fields?.getSheetValues() ?? [];
  expect(rows).toContainEqual(expect.arrayContaining(['TASK1', '执行任务', '任务名称', '人工填写']));
  expect(rows).toContainEqual(expect.arrayContaining(['KN', '知识与案例', '正文', '来源片段']));
  expect(rows).toContainEqual(expect.arrayContaining(['IMAGE', '资源与图片', '图片', '来源图片']));
});

it('reports source coverage without claiming a business review, even without pictures', async () => {
  const source = await sourceWorkbook(false), mapping = await edited(source, { withImage: false, withLink: true });
  const result = await buildSyntheticMappingDraft(source, mapping);
  expect(result.check).toMatchObject({ status: 'needs-review', sourceCheck: 'needs-review', publishable: false, workbookMatchesMapping: true });
  const report = await load(await createSyntheticMappingReport(source, result.draft, result.check, result.decisions, result.draft.workbook));
  expect(report.getWorksheet('核对概览')?.getCell('B2').value).toBe('已覆盖');
  expect(report.getWorksheet('核对概览')?.getCell('B3').value).toBe('未核验');
});

it.each(['text', 'reorder', 'delete'] as const)('does not carry old review claims after a %s change', async change => {
  const source = await sourceWorkbook(false), book = await load(await edited(source, { withImage: false, withLink: true }));
  const tasks = book.getWorksheet('执行任务'), mapping = book.getWorksheet('来源整理');
  if (!tasks || !mapping) throw new Error('missing sheet');
  if (change === 'text') tasks.getRow(3).getCell(3 + SOP_MAINTENANCE_HEADERS.执行任务.indexOf('任务名称')).value = '合成新名称';
  if (change === 'reorder') {
    const first = tasks.getRow(3), second = tasks.getRow(4);
    const a = Array.isArray(first.values) ? [...first.values].slice(1) : [];
    const b = Array.isArray(second.values) ? [...second.values].slice(1) : [];
    first.values = b; second.values = a;
  }
  if (change === 'delete') tasks.spliceRows(5, 1);
  for (const name of Object.keys(SOP_MAINTENANCE_HEADERS) as Name[]) {
    const sheet = book.getWorksheet(name);
    if (!sheet) throw new Error('missing target sheet');
    const current = SOP_MAINTENANCE_HEADERS[name].filter(header => header !== '维护状态' && header !== '业务确认人');
    const rows = [];
    for (let number = 3; number <= sheet.rowCount; number++) {
      const row = sheet.getRow(number), values = new Map(current.map((header, index) => [header, row.getCell(index + 3).value]));
      rows.push([row.getCell(1).value, row.getCell(2).value, ...SOP_MAINTENANCE_HEADERS[name].map(header =>
        header === '维护状态' ? '待发布' : header === '业务确认人' ? '旧的合成姓名' : values.get(header) ?? '')]);
    }
    sheet.getRow(2).values = ['整理行号', '新增说明', ...SOP_MAINTENANCE_HEADERS[name]];
    rows.forEach((values, index) => { sheet.getRow(index + 3).values = values; });
  }
  mapping.getCell('L1').value = 'sop-synthetic-mapping-workbook-v1';
  const result = await buildSyntheticMappingDraft(source, await save(book));
  const parsed = await parseSopMaintenance(result.draft.workbook);
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.document.tasks.every(task => task.review.state === '草稿' && task.review.confirmerText === '')).toBe(true);
  expect(result.check).toMatchObject({ status: 'needs-review', sourceCheck: 'needs-review', publishable: false });
  const report = await load(await createSyntheticMappingReport(source, result.draft, result.check, result.decisions, result.draft.workbook));
  expect(report.getWorksheet('核对概览')?.getCell('B3').value).toBe('未核验');
});

it('accepts only branches explicitly entered by the maintainer', async () => {
  const source = await sourceWorkbook(), book = await load(await edited(source));
  const tasks = book.getWorksheet('执行任务');
  if (!tasks) throw new Error('missing task sheet');
  const task = tasks.getRow(3);
  task.getCell(3 + SOP_MAINTENANCE_HEADERS.执行任务.indexOf('任务类型')).value = '判断';
  task.getCell(3 + SOP_MAINTENANCE_HEADERS.执行任务.indexOf('下一任务编号')).value = '';
  target(book, '执行任务', 'TASK3', { 记录类型: '任务', 任务编号: 'T3', 场景编号: 'SC1', 阶段: '协助', 任务名称: '请求协助',
    任务类型: '终点', 操作要求: '合成协助', 确认项配置: '无确认项', 可见对象: '坐席可读' }, '合成示例由维护者新增');
  target(book, '判断分支', 'B1', { 分支编号: 'B1', 任务编号: 'T1', 选项: '合成选项', 判断依据: '合成判断', 目标任务编号: 'T2',
    是否无法判断: '否', 匹配词: '不设置', 分支顺序: '1' }, '合成示例由维护者新增');
  target(book, '判断分支', 'B2', { 分支编号: 'B2', 任务编号: 'T1', 选项: '无法判断', 判断依据: '补充信息', 目标任务编号: 'T3',
    是否无法判断: '是', 匹配词: '不设置', 分支顺序: '2' }, '合成示例由维护者新增');
  const result = await buildSyntheticMappingDraft(source, await save(book));
  const parsed = await parseSopMaintenance(result.draft.workbook);
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.document.branches).toHaveLength(2);
  expect(parsed.document.branches).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'B1', targetTaskId: 'T2' }),
    expect.objectContaining({ id: 'B2', targetTaskId: 'T3', unableToDetermine: true }),
  ]));
});

it('uses the order of the actual mapping rows when combining different source cells', async () => {
  const source = await sourceWorkbook(), book = await load(await edited(source));
  const sheet = book.getWorksheet('来源整理');
  if (!sheet) throw new Error('missing mapping sheet');
  const a = find(sheet, 'c:1:A1'), b = find(sheet, 'c:1:B1');
  const aValues = Array.isArray(a.values) ? [...a.values].slice(1) : [], bValues = Array.isArray(b.values) ? [...b.values].slice(1) : [];
  a.values = bValues; b.values = aValues;
  const result = await buildSyntheticMappingDraft(source, await save(book));
  const parsed = await parseSopMaintenance(result.draft.workbook);
  if (parsed.kind !== 'parsed') throw new Error(JSON.stringify(parsed.report));
  expect(parsed.document.knowledge[0]?.body).toBe('合成后半\n合成😀');
});

it('applies an explicitly chosen source area to one target while leaving pictures pending', async () => {
  const source = await sourceWorkbook(), book = await load(await createSyntheticMappingWorkbook(source));
  target(book, '知识与案例', 'KN', { 知识编号: 'K1', 标题: '合成知识', 可见对象: '坐席可读' });
  const batch = book.getWorksheet('批量整理');
  if (!batch) throw new Error('missing batch sheet');
  batch.addRow(['合成原表', 'A1:B1', '使用', 'KN', '正文', '换行', '']);
  const result = await buildSyntheticMappingDraft(source, await save(book));
  expect(result.check.counts).toMatchObject({ objects: 6, mapped: 2, pending: 4, imagesNeedingReview: 1 });
  expect(result.draft.report.ledger.find(item => item.sourceId === 'c:1:B1')?.segments[0]?.targets).toEqual(['KN.正文']);
  expect(result.draft.report.ledger.find(item => item.kind === 'image')?.segments[0]?.disposition).toBe('pending');
  const workbook = await load(result.draft.workbook);
  expect(workbook.getWorksheet('知识与案例')?.getCell('C3').value).toBe('合成😀甲乙\n合成后半');
});

it('orders a batch target by original sheet and cell position even if mapping rows or batch rules move', async () => {
  const source = await sourceWorkbook(), book = await load(await createSyntheticMappingWorkbook(source));
  target(book, '知识与案例', 'KN', { 知识编号: 'K1', 标题: '合成知识', 可见对象: '坐席可读' });
  const mapping = book.getWorksheet('来源整理'), batch = book.getWorksheet('批量整理');
  if (!mapping || !batch) throw new Error('missing mapping or batch sheet');
  const a = find(mapping, 'c:1:A1'), b = find(mapping, 'c:1:B1');
  const aValues = Array.isArray(a.values) ? [...a.values].slice(1) : [], bValues = Array.isArray(b.values) ? [...b.values].slice(1) : [];
  a.values = bValues; b.values = aValues;
  batch.addRow(['合成原表', 'B1:B1', '使用', 'KN', '正文', '换行']);
  batch.addRow(['合成原表', 'A1:A1', '使用', 'KN', '正文', '换行']);
  map(find(mapping, 'c:1:C1'), 'KN', '正文', '换行');
  const result = await buildSyntheticMappingDraft(source, await save(book));
  const workbook = await load(result.draft.workbook);
  expect(workbook.getWorksheet('知识与案例')?.getCell('C3').value).toBe('合成😀甲乙\n合成后半\n合成场景');
});

it('orders cells within one batch by source position after mapping rows are swapped', async () => {
  const source = await sourceWorkbook(), book = await load(await createSyntheticMappingWorkbook(source));
  target(book, '知识与案例', 'KN', { 知识编号: 'K1', 标题: '合成知识', 可见对象: '坐席可读' });
  const mapping = book.getWorksheet('来源整理'), batch = book.getWorksheet('批量整理');
  if (!mapping || !batch) throw new Error('missing mapping or batch sheet');
  const a = find(mapping, 'c:1:A1'), b = find(mapping, 'c:1:B1');
  const aValues = Array.isArray(a.values) ? [...a.values].slice(1) : [], bValues = Array.isArray(b.values) ? [...b.values].slice(1) : [];
  a.values = bValues; b.values = aValues;
  batch.addRow(['合成原表', 'A1:B1', '使用', 'KN', '正文', '换行']);
  const result = await buildSyntheticMappingDraft(source, await save(book));
  const workbook = await load(result.draft.workbook);
  expect(workbook.getWorksheet('知识与案例')?.getCell('C3').value).toBe('合成😀甲乙\n合成后半');
});

it('uses original workbook sheet order when batch rules span multiple sheets', async () => {
  const original = await load(await sourceWorkbook());
  original.addWorksheet('合成次表').getCell('A1').value = '合成次表第一项';
  const source = await save(original), book = await load(await createSyntheticMappingWorkbook(source));
  target(book, '知识与案例', 'KN', { 知识编号: 'K1', 标题: '合成知识', 可见对象: '坐席可读' });
  const batch = book.getWorksheet('批量整理');
  if (!batch) throw new Error('missing batch sheet');
  batch.addRow(['合成次表', 'A1:A1', '使用', 'KN', '正文', '换行']);
  batch.addRow(['合成原表', 'A1:A1', '使用', 'KN', '正文', '换行']);
  const result = await buildSyntheticMappingDraft(source, await save(book));
  const workbook = await load(result.draft.workbook);
  expect(workbook.getWorksheet('知识与案例')?.getCell('C3').value).toBe('合成😀甲乙\n合成次表第一项');
});

it('rejects batch rectangles that intersect only in an empty source cell', async () => {
  const original = await load(await sourceWorkbook()), originalSheet = original.getWorksheet('合成原表');
  if (!originalSheet) throw new Error('missing source sheet');
  originalSheet.getCell('A3').value = '合成第三行';
  const source = await save(original), book = await load(await createSyntheticMappingWorkbook(source));
  target(book, '知识与案例', 'K1', { 知识编号: 'K1', 标题: '合成知识一', 可见对象: '坐席可读' });
  target(book, '知识与案例', 'K2', { 知识编号: 'K2', 标题: '合成知识二', 可见对象: '坐席可读' });
  const batch = book.getWorksheet('批量整理');
  if (!batch) throw new Error('missing batch sheet');
  batch.addRow(['合成原表', 'A1:A2', '使用', 'K1', '正文', '换行']);
  batch.addRow(['合成原表', 'A2:A3', '使用', 'K2', '正文', '换行']);
  await expect(decisionsFromSyntheticMapping(source, await save(book))).rejects.toThrow('批量范围重叠');
  batch.getCell('B4').value = 'A3:A3';
  await expect(decisionsFromSyntheticMapping(source, await save(book))).resolves.toBeDefined();
});

it('reports a source SHA mismatch before checking preview images', async () => {
  const original = await sourceWorkbook(), mapping = await createSyntheticMappingWorkbook(original);
  const other = await load(original), sheet = other.getWorksheet('合成原表');
  if (!sheet) throw new Error('missing source sheet');
  sheet.getCell('A1').value = '另一份合成原表';
  await expect(decisionsFromSyntheticMapping(await save(other), mapping)).rejects.toThrow('原表 SHA-256 与整理表记录不一致');
});

it('retains archive limits and rejects unknown orphaned picture objects during focused preview inspection', async () => {
  const source = await sourceWorkbook(), mapping = await createSyntheticMappingWorkbook(source);
  const zip = await JSZip.loadAsync(mapping);
  zip.file('xl/media/unrelated.png', png);
  await expect(decisionsFromSyntheticMapping(source, await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow('图片对象无法可靠核对');
  const book = await load(mapping), sheet = book.getWorksheet('来源整理');
  if (!sheet) throw new Error('missing mapping sheet');
  sheet.getCell('E4').value = '合'.repeat(32_768);
  await expect(decisionsFromSyntheticMapping(source, await save(book))).rejects.toThrow('CELL_TEXT_LIMIT');
});

it('rejects overlapping batch rules and does not infer branch fields', async () => {
  const source = await sourceWorkbook(), book = await load(await createSyntheticMappingWorkbook(source));
  target(book, '知识与案例', 'KN', { 知识编号: 'K1', 标题: '合成知识', 可见对象: '坐席可读' });
  target(book, '判断分支', 'B1', { 分支编号: 'B1' }, '合成新增');
  const batch = book.getWorksheet('批量整理');
  if (!batch) throw new Error('missing batch sheet');
  batch.addRow(['合成原表', 'A1:B1', '使用', 'KN', '正文', '换行']);
  batch.addRow(['合成原表', 'A1:A1', '使用', 'KN', '正文', '换行']);
  await expect(decisionsFromSyntheticMapping(source, await save(book))).rejects.toThrow('范围重叠');
  batch.spliceRows(4, 1);
  batch.getCell('D3').value = 'B1'; batch.getCell('E3').value = '选项';
  await expect(decisionsFromSyntheticMapping(source, await save(book))).rejects.toThrow('只能指定已有记录的正文');
});

it('refuses a batch area that cuts through a merged source cell', async () => {
  const sourceBook = await load(await sourceWorkbook()), sheet = sourceBook.getWorksheet('合成原表');
  if (!sheet) throw new Error('missing source sheet');
  sheet.mergeCells('A1:A2');
  const source = await save(sourceBook), book = await load(await createSyntheticMappingWorkbook(source));
  target(book, '知识与案例', 'KN', { 知识编号: 'K1', 标题: '合成知识', 可见对象: '坐席可读' });
  const batch = book.getWorksheet('批量整理');
  if (!batch) throw new Error('missing batch sheet');
  batch.addRow(['合成原表', 'A1:A1', '使用', 'KN', '正文', '换行']);
  await expect(decisionsFromSyntheticMapping(source, await save(book))).rejects.toThrow('截断了原表合并单元格');
  batch.getCell('B3').value = 'A1:A2';
  await expect(decisionsFromSyntheticMapping(source, await save(book))).resolves.toBeDefined();
});

it.each(['missing', 'changed', 'separator', 'duplicate-image', 'unknown-target', 'formula', 'merged', 'pasted-image', 'comment', 'preview-label', 'preview-anchor'] as const)(
  'rejects %s instead of silently losing or guessing a mapping', async failure => {
    const source = await sourceWorkbook(), book = await load(await edited(source));
    const sheet = book.getWorksheet('来源整理');
    if (!sheet) throw new Error('missing mapping sheet');
    if (failure === 'missing') sheet.spliceRows(find(sheet, 'c:1:E1').number, 1);
    if (failure === 'changed') find(sheet, 'c:1:A1').getCell(5).value = '合成';
    if (failure === 'separator') find(sheet, 'c:1:B1').getCell(9).value = '';
    if (failure === 'duplicate-image') {
      const image = find(sheet, 'p:1:1:1');
      sheet.addRow(Array.isArray(image.values) ? [...image.values].slice(1) : []);
    }
    if (failure === 'unknown-target') find(sheet, 'c:1:B1').getCell(7).value = 'UNKNOWN';
    if (failure === 'formula') find(sheet, 'c:1:B1').getCell(5).value = { formula: '"合成后半"', result: '合成后半' };
    if (failure === 'merged') sheet.mergeCells('F4:G4');
    if (failure === 'pasted-image') {
      const id = book.addImage({ buffer: new Uint8Array(png).buffer, extension: 'png' });
      sheet.addImage(id, 'J4:K5');
    }
    if (failure === 'comment') find(sheet, 'c:1:B1').getCell(5).note = '合成批注';
    if (failure === 'preview-label') {
      const preview = book.getWorksheet('图片盘点预览');
      if (!preview) throw new Error('missing image preview');
      preview.getCell('E4').value = preview.getCell('E3').value;
      preview.getCell('E3').value = null;
    }
    if (failure === 'preview-anchor') {
      const preview = book.getWorksheet('图片盘点预览'), image = preview?.getImages()[0];
      if (!image) throw new Error('missing preview image');
      image.range.tl.nativeRow++;
    }
    await expect(decisionsFromSyntheticMapping(source, await save(book))).rejects.toThrow();
  },
);

it('rejects a preview picture whose source crop is no longer known', async () => {
  const source = await sourceWorkbook(), zip = await JSZip.loadAsync(await edited(source));
  const drawing = zip.file('xl/drawings/drawing1.xml');
  if (!drawing) throw new Error('missing synthetic drawing');
  const xml = await drawing.async('string');
  expect(xml).toContain('<a:stretch>');
  zip.file('xl/drawings/drawing1.xml', xml.replace('<a:stretch>', '<a:srcRect l="1000"/><a:stretch>'));
  await expect(decisionsFromSyntheticMapping(source, await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow('图片对象无法可靠核对');
});

it('rejects a right-to-left image preview instead of assuming the picture display matches', async () => {
  const source = await sourceWorkbook(), book = await load(await createSyntheticMappingWorkbook(source));
  const preview = book.getWorksheet('图片盘点预览');
  if (!preview) throw new Error('missing preview');
  preview.views = [{ state: 'normal', rightToLeft: true }];
  await expect(decisionsFromSyntheticMapping(source, await save(book))).rejects.toThrow('从右向左的图片预览无法核对');
});

it('writes a fixed explicit font on every visible picture-preview label', async () => {
  const source = await sourceWorkbook(), book = await load(await createSyntheticMappingWorkbook(source));
  const sheet = book.getWorksheet('图片盘点预览');
  if (!sheet) throw new Error('missing picture preview');
  for (let row = 1; row <= sheet.rowCount; row++) {
    for (let column = 1; column <= 7; column++) {
      const cell = sheet.getRow(row).getCell(column);
      if (cell.value !== null) {
        expect(cell.font.name).toBe('Arial');
        expect(cell.font.scheme).toBeUndefined();
        expect(cell.font.charset).toBeUndefined();
      }
    }
  }
});

it.each(['Webdings', 'Wingdings', 'UnverifiedFont', 'theme-scheme', 'symbol-charset', 'unknown-charset'] as const)(
  'rejects a whole picture-preview row with an unverified display font: %s', async variant => {
    const source = await sourceWorkbook(), book = await load(await edited(source));
    const sheet = book.getWorksheet('图片盘点预览');
    if (!sheet) throw new Error('missing picture preview');
    for (const column of [1, 2, 4, 5, 6, 7]) {
      const cell = sheet.getRow(3).getCell(column);
      if (cell.value === null) continue;
      const font = { ...cell.font, name: variant === 'theme-scheme' || variant.endsWith('-charset') ? 'Arial' : variant };
      if (variant === 'theme-scheme') font.scheme = 'minor';
      else delete font.scheme;
      if (variant === 'symbol-charset') font.charset = 2;
      else if (variant === 'unknown-charset') font.charset = 42;
      else delete font.charset;
      cell.font = font;
    }
    let error = 'accepted';
    try { await decisionsFromSyntheticMapping(source, await save(book)); } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
    expect(error).toContain('图片盘点预览');
  },
);

it('reads a WPS-saved synthetic mapping without treating it as reviewed', async () => {
  const source = await readFile(new URL('./fixtures/sop-wps-synthetic-source.xlsx', import.meta.url));
  const mapping = await readFile(new URL('./fixtures/sop-wps-synthetic-saved.xlsx', import.meta.url));
  const book = await load(mapping);
  expect(book.getWorksheet('图片盘点预览')?.getCell('E3').font).toMatchObject({ name: 'Arial', charset: 134 });
  expect(book.getWorksheet('来源整理')?.getCell('J4').value).toBe('合成演示核对');
  const result = await buildSyntheticMappingDraft(source, mapping);
  expect(result.check).toMatchObject({ sourceCheck: 'needs-review', publishable: false, workbookMatchesMapping: true });
  expect(result.decisions.decisions).toContainEqual(expect.objectContaining({
    sourceId: 'c:1:A1', segments: expect.arrayContaining([expect.objectContaining({ reason: '合成演示核对' })]),
  }));
  const report = await load(await createSyntheticMappingReport(source, result.draft, result.check, result.decisions, result.draft.workbook));
  expect(report.getWorksheet('核对概览')?.getCell('B3').value).toBe('未核验');
  expect(report.getWorksheet('核对概览')?.getCell('B14').value).toBe('待核对');
});

it('rejects Webdings even when the WPS charset is retained', async () => {
  const source = await readFile(new URL('./fixtures/sop-wps-synthetic-source.xlsx', import.meta.url));
  const book = await load(await readFile(new URL('./fixtures/sop-wps-synthetic-saved.xlsx', import.meta.url)));
  const sheet = book.getWorksheet('图片盘点预览');
  if (!sheet) throw new Error('missing picture preview');
  sheet.getRow(3).eachCell(cell => { cell.font = { ...cell.font, name: 'Webdings' }; });
  const modified = await save(book);
  expect((await load(modified)).getWorksheet('图片盘点预览')?.getCell('E3').font).toMatchObject({ name: 'Webdings', charset: 134 });
  await expect(decisionsFromSyntheticMapping(source, modified)).rejects.toThrow('图片盘点预览第 3 行：预览标签须使用明确的 Arial');
});

it('accepts an explicit non-theme font scheme', async () => {
  const source = await sourceWorkbook(), book = await load(await edited(source));
  const sheet = book.getWorksheet('图片盘点预览');
  if (!sheet) throw new Error('missing picture preview');
  sheet.getCell('E3').font = { ...sheet.getCell('E3').font, scheme: 'none' };
  await expect(decisionsFromSyntheticMapping(source, await save(book))).resolves.toBeDefined();
});

it('keeps the source text in one editable place and rejects duplicate previews', async () => {
  const source = await sourceWorkbook(), book = await load(await edited(source));
  expect(book.getWorksheet('文字盘点预览')).toBeUndefined();
  book.addWorksheet('文字盘点预览').getCell('C3').value = '伪造的合成预览';
  await expect(decisionsFromSyntheticMapping(source, await save(book))).rejects.toThrow('存在未识别的工作表');
});

it.each(['id-color', 'hash-color', 'hidden-number-format', 'tiny-font', 'font-family', 'missing-reference-font', 'alignment', 'conditional-format', 'merge'] as const)(
  'rejects an unreadable picture identity or uncertain preview presentation: %s', async variant => {
    const source = await sourceWorkbook(), book = await load(await edited(source));
    const sheet = book.getWorksheet('图片盘点预览');
    if (!sheet) throw new Error('missing picture preview');
    if (variant === 'id-color') sheet.getCell('E3').font = { color: { argb: 'FFFFFFFF' } };
    if (variant === 'hash-color') sheet.getCell('F3').font = { color: { argb: 'FFFFFFFF' } };
    if (variant === 'hidden-number-format') sheet.getCell('E3').numFmt = ';;;';
    if (variant === 'tiny-font') sheet.getCell('E3').font = { size: 1 };
    if (variant === 'font-family') sheet.getCell('E3').font = { ...sheet.getCell('E3').font, name: 'Wingdings' };
    if (variant === 'missing-reference-font') {
      const font = { ...sheet.getCell('A3').font };
      delete font.name;
      sheet.getCell('A3').font = font;
      sheet.getCell('E3').font = { ...sheet.getCell('E3').font, name: 'Wingdings' };
    }
    if (variant === 'alignment') sheet.getCell('E3').alignment = { textRotation: 90 };
    if (variant === 'merge') sheet.mergeCells('C3:C4');
    if (variant === 'conditional-format') sheet.addConditionalFormatting({ ref: 'E3', rules: [
      { type: 'expression', priority: 1, formulae: ['TRUE'], style: { font: { color: { argb: 'FFFFFFFF' } } } },
    ] });
    await expect(decisionsFromSyntheticMapping(source, await save(book))).rejects.toThrow('图片盘点预览');
  },
);

it('rejects an altered theme that can hide the picture labels', async () => {
  const source = await sourceWorkbook(), zip = await JSZip.loadAsync(await edited(source));
  const theme = zip.file('xl/theme/theme1.xml');
  if (!theme) throw new Error('missing theme');
  const original = await theme.async('string');
  expect(original).toContain('lastClr="000000"');
  zip.file('xl/theme/theme1.xml', original.replace('lastClr="000000"', 'lastClr="FFFFFF"'));
  await expect(decisionsFromSyntheticMapping(source, await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow('主题');
});

it('marks an unverified picture transform for review without claiming business approval', async () => {
  const source = await sourceWorkbook(), zip = await JSZip.loadAsync(await edited(source));
  const drawing = zip.file('xl/drawings/drawing1.xml');
  if (!drawing) throw new Error('missing drawing');
  const xml = await drawing.async('string');
  expect(xml).toContain('<a:off x="0" y="0"/>');
  zip.file('xl/drawings/drawing1.xml', xml.replace('<a:off x="0" y="0"/>', '<a:off x="9000000" y="9000000"/>'));
  const result = await buildSyntheticMappingDraft(source, await zip.generateAsync({ type: 'nodebuffer' }));
  const report = await load(await createSyntheticMappingReport(source, result.draft, result.check, result.decisions, result.draft.workbook));
  expect(report.getWorksheet('核对概览')?.getSheetValues()).toContainEqual(expect.arrayContaining(['图片预览变换', '待核对']));
  expect(report.getWorksheet('图片归属')?.getCell('H2').value).toContain('预览绘图变换未核对');
  expect(report.getWorksheet('核对概览')?.getCell('B3').value).toBe('未核验');
  expect(result.check).toMatchObject({ sourceCheck: 'needs-review', publishable: false });
});

it('describes matching ZIP parts without claiming byte-for-byte file identity', async () => {
  const source = await sourceWorkbook(), result = await buildSyntheticMappingDraft(source, await edited(source));
  const zip = await JSZip.loadAsync(result.draft.workbook);
  const rewritten = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', comment: 'synthetic metadata' });
  expect(rewritten.equals(result.draft.workbook)).toBe(false);
  const check = await checkSyntheticSopSourceDraft({ source, decisions: result.decisions, workbook: rewritten });
  expect(check.workbookMatchesMapping).toBe(true);
  const report = await load(await createSyntheticMappingReport(source, result.draft, check, result.decisions, rewritten));
  expect(report.getWorksheet('核对概览')?.getCell('B5').value).toBe('是（工作簿内各文件内容一致）');
  expect(report.getWorksheet('核对概览')?.getCell('B3').value).toBe('未核验');
});

it('stops when two picture labels move while their differently hashed images remain in place', async () => {
  const source = await sourceWorkbook(true, true), book = await load(await createSyntheticMappingWorkbook(source));
  const preview = book.getWorksheet('图片盘点预览');
  if (!preview) throw new Error('missing preview');
  const first = preview.getRow(3), second = preview.getRow(4);
  const a = Array.isArray(first.values) ? [...first.values].slice(1) : [];
  const b = Array.isArray(second.values) ? [...second.values].slice(1) : [];
  first.values = b; second.values = a;
  await expect(decisionsFromSyntheticMapping(source, await save(book))).rejects.toThrow('图片、来源编号、摘要或锚点已改变');
});

it('keeps pending and excluded parts visible in the coverage report', async () => {
  const source = await sourceWorkbook(), book = await load(await edited(source));
  const sheet = book.getWorksheet('来源整理');
  if (!sheet) throw new Error('missing mapping sheet');
  const image = find(sheet, 'p:1:1:1');
  image.getCell(6).value = '待确认';
  image.getCell(7).value = ''; image.getCell(8).value = '';
  const resource = book.getWorksheet('资源与图片');
  if (!resource) throw new Error('missing resource sheet');
  resource.spliceRows(3, 1);
  const original = find(sheet, 'c:1:B1');
  original.getCell(6).value = '排除'; original.getCell(7).value = ''; original.getCell(8).value = '';
  original.getCell(9).value = ''; original.getCell(10).value = '合成重复项';
  find(sheet, 'c:1:A1').getCell(9).value = '';
  const result = await buildSyntheticMappingDraft(source, await save(book));
  expect(result.check.counts).toMatchObject({ pending: 1, excluded: 1 });
  expect(result.check.sourceCheck).toBe('needs-review');
  const report = await load(await createSyntheticMappingReport(source, result.draft, result.check, result.decisions, result.draft.workbook));
  expect(report.getWorksheet('预期来源去向')?.getColumn(8).values).toContain('合成重复项');
});

it('detects later editing of the generated maintenance workbook', async () => {
  const source = await sourceWorkbook(), result = await buildSyntheticMappingDraft(source, await edited(source));
  const changed = await load(result.draft.workbook);
  const scene = changed.getWorksheet('场景目录');
  if (!scene) throw new Error('missing scene sheet');
  scene.getCell('B3').value = '合成改动';
  const check = await checkSyntheticSopSourceDraft({ source, decisions: result.decisions, workbook: await save(changed) });
  expect(check).toMatchObject({ workbookMatchesMapping: false, sourceCheck: 'needs-review', publishable: false });
  expect(check.reasons).toContain('WORKBOOK_CHANGED');
});

it('distinguishes metadata-only rewrites from changed formatting without granting review', async () => {
  const source = await sourceWorkbook(), result = await buildSyntheticMappingDraft(source, await edited(source));
  const zip = await JSZip.loadAsync(result.draft.workbook), core = zip.file('docProps/core.xml');
  if (!core) throw new Error('missing metadata');
  zip.file('docProps/core.xml', (await core.async('string')).replace('2000-01-01T00:00:00Z', '2001-01-01T00:00:00Z'));
  const rewritten = await zip.generateAsync({ type: 'nodebuffer' });
  const checked = await checkSyntheticSopSourceDraft({ source, decisions: result.decisions, workbook: rewritten });
  expect(checked.workbookMatchesMapping).toBe(false);
  const report = await load(await createSyntheticMappingReport(source, result.draft, checked, result.decisions, rewritten));
  expect(report.getWorksheet('核对概览')?.getCell('B5').value).toBe('已比对内容及格式一致（视图未核对）');
  expect(report.getWorksheet('核对概览')?.getCell('B3').value).toBe('未核验');
  expect(checked).toMatchObject({ sourceCheck: 'needs-review', publishable: false });
  const formatted = await load(result.draft.workbook), scene = formatted.getWorksheet('场景目录');
  if (!scene) throw new Error('missing scene');
  scene.getCell('B3').font = { bold: true };
  const changed = await save(formatted);
  const check = await checkSyntheticSopSourceDraft({ source, decisions: result.decisions, workbook: changed });
  const changedReport = await load(await createSyntheticMappingReport(source, result.draft, check, result.decisions, changed));
  expect(changedReport.getWorksheet('核对概览')?.getCell('B5').value).toBe('已比对内容及图片一致，格式和视图待核对');
  const changedTheme = await JSZip.loadAsync(result.draft.workbook), theme = changedTheme.file('xl/theme/theme1.xml');
  if (!theme) throw new Error('missing synthetic theme');
  changedTheme.file('xl/theme/theme1.xml', `${await theme.async('string')}\n`);
  const themed = await changedTheme.generateAsync({ type: 'nodebuffer' });
  const themeCheck = await checkSyntheticSopSourceDraft({ source, decisions: result.decisions, workbook: themed });
  const themeReport = await load(await createSyntheticMappingReport(source, result.draft, themeCheck, result.decisions, themed));
  expect(themeReport.getWorksheet('核对概览')?.getCell('B5').value).toBe('已比对内容及图片一致，格式和视图待核对');
});

it('labels sheet views as unchecked when an otherwise unchanged sheet becomes right-to-left', async () => {
  const source = await sourceWorkbook(), result = await buildSyntheticMappingDraft(source, await edited(source));
  const changed = await load(result.draft.workbook), sheet = changed.getWorksheet('场景目录');
  if (!sheet) throw new Error('missing scene');
  sheet.views = [{ state: 'normal', rightToLeft: true }];
  const current = await save(changed), zip = await JSZip.loadAsync(current);
  const worksheet = zip.file('xl/worksheets/sheet1.xml');
  if (!worksheet) throw new Error('missing worksheet XML');
  expect(await worksheet.async('string')).toContain('rightToLeft="1"');
  const check = await checkSyntheticSopSourceDraft({ source, decisions: result.decisions, workbook: current });
  const report = await load(await createSyntheticMappingReport(source, result.draft, check, result.decisions, current));
  expect(report.getWorksheet('核对概览')?.getCell('B5').value).toBe('已比对内容及格式一致（视图未核对）');
  expect(report.getWorksheet('核对概览')?.getCell('C12').value).toContain('视图');
  expect(check).toMatchObject({ sourceCheck: 'needs-review', publishable: false });
});

it('shows current script conditions and confirmation items in the maintenance report', async () => {
  const source = await sourceWorkbook(), book = await load(await edited(source, { withLink: true }));
  const editingTasks = book.getWorksheet('执行任务');
  if (!editingTasks) throw new Error('missing task sheet');
  editingTasks.getRow(3).getCell(3 + SOP_MAINTENANCE_HEADERS.执行任务.indexOf('确认项配置')).value = '有确认项';
  target(book, '执行任务', 'REQ', { 记录类型: '确认项', 任务编号: 'T1', 确认项编号: 'C1', 确认项文字: '原合成确认', 确认项顺序: '1' }, '合成新增');
  const result = await buildSyntheticMappingDraft(source, await save(book));
  const changed = await load(result.draft.workbook), tasks = changed.getWorksheet('执行任务');
  if (!tasks) throw new Error('missing generated tasks');
  const column = (name: (typeof SOP_MAINTENANCE_HEADERS.执行任务)[number]) => 1 + SOP_MAINTENANCE_HEADERS.执行任务.indexOf(name);
  const link = tasks.getRows(3, tasks.rowCount - 2)?.find(row => row.getCell(column('记录类型')).value === '话术引用');
  const requirement = tasks.getRows(3, tasks.rowCount - 2)?.find(row => row.getCell(column('记录类型')).value === '确认项');
  if (!link || !requirement) throw new Error('missing explicit link or requirement');
  link.getCell(column('适用条件')).value = '更新后的合成条件';
  requirement.getCell(column('确认项文字')).value = '更新后的合成确认';
  const current = await save(changed);
  const check = await checkSyntheticSopSourceDraft({ source, decisions: result.decisions, workbook: current });
  const report = await load(await createSyntheticMappingReport(source, result.draft, check, result.decisions, current));
  const rows = report.getWorksheet('当前实际维护稿')?.getSheetValues() ?? [];
  expect(rows).toContainEqual(expect.arrayContaining(['话术引用', 'L1', 'S1', '更新后的合成条件', '独立', 'T1']));
  expect(rows).toContainEqual(expect.arrayContaining(['确认项', 'C1', '更新后的合成确认', 'T1', 1]));
  expect(report.getWorksheet('核对概览')?.getCell('B5').value).toBe('否');
  expect(report.getWorksheet('核对概览')?.getCell('C13').value).toContain('其他字段未逐项展示');
  expect(check).toMatchObject({ sourceCheck: 'needs-review', publishable: false });
});

it('reports the current image owner separately from the original expected owner', async () => {
  const source = await sourceWorkbook(), result = await buildSyntheticMappingDraft(source, await edited(source));
  const changed = await load(result.draft.workbook), tasks = changed.getWorksheet('执行任务');
  if (!tasks) throw new Error('missing tasks');
  const resourceColumn = 1 + SOP_MAINTENANCE_HEADERS.执行任务.indexOf('关联资源编号');
  tasks.getRow(3).getCell(resourceColumn).value = '';
  tasks.getRow(4).getCell(resourceColumn).value = 'R1';
  const current = await save(changed);
  const check = await checkSyntheticSopSourceDraft({ source, decisions: result.decisions, workbook: current });
  const report = await load(await createSyntheticMappingReport(source, result.draft, check, result.decisions, current));
  expect(report.getWorksheet('图片归属')?.getCell('E2').value).toBe('任务 T1');
  expect(report.getWorksheet('图片归属')?.getCell('G2').value).toBe('任务 T2');
  expect(report.getWorksheet('核对概览')?.getCell('B5').value).toBe('否');
  expect(report.getWorksheet('核对概览')?.getCell('B3').value).toBe('未核验');
});

it('does not report an unparseable maintenance workbook as a confirmed edit', async () => {
  const source = await sourceWorkbook(), mapping = await createSyntheticMappingWorkbook(source);
  const result = await buildSyntheticMappingDraft(source, mapping);
  expect(result.check.maintenance.status).toBe('invalid');
  const report = await load(await createSyntheticMappingReport(source, result.draft, result.check, result.decisions, result.draft.workbook));
  expect(report.getWorksheet('核对概览')?.getCell('B5').value).toBe('无法确认');
});

it('runs the file-based prepare, edit, build and verify workflow without a JSON editing step', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'synthetic-sop-mapping-'));
  const sourcePath = join(directory, 'source.xlsx'), mappingPath = join(directory, 'mapping.xlsx'), output = join(directory, 'output');
  const source = await sourceWorkbook();
  await writeFile(sourcePath, source);
  expect(await runSyntheticMappingCli(['prepare', sourcePath, mappingPath])).toBe(0);
  expect(await inspectSyntheticSopSource(source)).toMatchObject({ inventory: { publishable: false } });
  await writeFile(mappingPath, await edited(source));
  expect(await runSyntheticMappingCli(['build', sourcePath, mappingPath, output])).toBe(3);
  const workbookPath = join(output, '合成维护稿.xlsx');
  expect((await parseSopMaintenance(await readFile(workbookPath))).kind).toBe('parsed');
  const report = await load(await readFile(join(output, '合成核对结果.xlsx')));
  expect(report.getWorksheet('核对概览')?.getCell('B2').value).toBe('已覆盖');
  expect(await runSyntheticMappingCli(['verify', sourcePath, mappingPath, workbookPath, join(directory, 'recheck.xlsx')])).toBe(3);
  await expect(runSyntheticMappingCli(['prepare', sourcePath, mappingPath])).rejects.toThrow();
});
