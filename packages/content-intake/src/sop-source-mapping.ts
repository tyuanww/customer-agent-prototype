import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { SaxesParser } from 'saxes';
import { inspectArchive } from './archive.js';
import { parseSopMaintenance, SOP_MAINTENANCE_HEADERS, type MaintenanceDocument } from './maintenance.js';
import { INTAKE_POLICY as P } from './policy.js';
import { buildSyntheticSopDraft, checkSyntheticSopSourceDraft, SOURCE_DECISIONS_VERSION, type BuiltDraft, type SourceDraftCheck } from './sop-source-draft.js';
import { inspectSyntheticSopImagePreview, inspectSyntheticSopSource, type InspectedSource, type SourceObject } from './sop-source-inventory.js';
import { createSyntheticSourcePreview } from './sop-source-preview.js';

const VERSION = 'sop-synthetic-mapping-workbook-v2';
const LEGACY_VERSION = 'sop-synthetic-mapping-workbook-v1';
const MAPPING_SHEET = '来源整理';
const BATCH_SHEET = '批量整理';
const PREVIEW_FONT = 'Arial';
const WPS_GB2312_CHARSET = 134;
const HEADERS = ['来源编号', '原表', '原位置', '类型', '本段原文', '处理', '目标行号', '目标字段', '合并方式', '处理说明'] as const;
const BATCH_HEADERS = ['原表', '单元格范围', '处理', '目标行号', '目标字段', '合并方式', '处理说明'] as const;
const HELPER_HEADERS = ['整理行号', '新增说明'] as const;
type SheetName = keyof typeof SOP_MAINTENANCE_HEADERS;
type Status = '待确认' | '使用' | '排除';
type Reference = Readonly<{ sourceId: string; start: number; end: number }>;
type DraftRow = { key: string; sheet: SheetName; fields: Record<string, string | { from: Reference[]; separator?: string }>;
  imageSourceId?: string; origin: { kind: 'source' | 'new'; reason: string } };
type MappingDecisions = { version: typeof SOURCE_DECISIONS_VERSION; sourceSha256: string; decisions: unknown[]; rows: DraftRow[] };
type Piece = { sourceId: string; text: string; status: Status; target: string; field: string; join: string; reason: string; row: number; batch: boolean };
type TextTarget = { row: DraftRow; field: string; parts: { reference: Reference; join: string; row: number; batch: boolean; position: readonly [number, number, number] }[]; firstRow: number };
const isReviewClaim = (field: string): boolean => field === '维护状态' || field === '业务确认人';
const editableHeaders = (name: SheetName): readonly string[] => SOP_MAINTENANCE_HEADERS[name].filter(field => !isReviewClaim(field));

function fail(sheet: string, row: number, message: string): never {
  throw new Error(`${sheet}${row ? `第 ${row} 行` : ''}：${message}`);
}

function text(cell: ExcelJS.Cell, sheet: string, row: number): string {
  if (cell.note) return fail(sheet, row, `${cell.address} 不能使用批注，请填写表格中的说明列`);
  if (cell.value === null) return '';
  if (typeof cell.value === 'string') return cell.value;
  return fail(sheet, row, `${cell.address} 只能填写文本，不支持公式、数字或链接`);
}

function sourceLocation(item: SourceObject): string {
  if (item.kind === 'text') return item.cell;
  if (item.kind === 'image' && item.position?.from.row !== undefined && item.position.from.col !== undefined) {
    return `第 ${item.position.from.row + 1} 行，第 ${item.position.from.col + 1} 列`;
  }
  return item.location;
}
function description(item: SourceObject): string {
  if (item.kind === 'text') return item.text;
  if (item.kind === 'unsupported') return item.rawText ?? item.reason;
  return item.reviewWarnings.join('；');
}
function typeLabel(item: SourceObject): string {
  return item.kind === 'text' ? '文字' : item.kind === 'image' ? '图片' : item.kind === 'background' ? '背景图' : '不支持';
}
function status(value: string, row: number): Status {
  if (value === '待确认' || value === '使用' || value === '排除') return value;
  return fail(MAPPING_SHEET, row, '处理只能填写待确认、使用或排除');
}
function expectedHeader(sheet: ExcelJS.Worksheet, rowNumber: number, headers: readonly string[]): void {
  const row = sheet.getRow(rowNumber);
  if (headers.some((header, index) => text(row.getCell(index + 1), sheet.name, rowNumber) !== header)) {
    fail(sheet.name, rowNumber, '表头已改变，请使用原整理表');
  }
}
function cellTexts(row: ExcelJS.Row, count: number, sheet: string): string[] {
  const values: string[] = [];
  for (let column = 1; column <= count; column++) values.push(text(row.getCell(column), sheet, row.number));
  for (let column = count + 1; column <= row.cellCount; column++) {
    if (text(row.getCell(column), sheet, row.number)) fail(sheet, row.number, '请勿在表头之外填写内容');
  }
  return values;
}

async function inspectMappingPreview(bytes: Buffer, imageOnly = false): Promise<InspectedSource> {
  const zip = await JSZip.loadAsync(bytes);
  // The source inspector requires its synthetic marker. Only this in-memory
  // inspection copy receives one; the editable workbook is never rewritten.
  zip.file('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>SOP-SYNTHETIC-ONLY</dc:creator></cp:coreProperties>');
  const copy = await zip.generateAsync({ type: 'nodebuffer' });
  return imageOnly ? inspectSyntheticSopImagePreview(copy) : inspectSyntheticSopSource(copy);
}

async function previewTheme(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes), file = zip.file('xl/theme/theme1.xml');
  if (!file) return fail('图片盘点预览', 0, '主题无法核对');
  const parser = new SaxesParser({ xmlns: true }), colors = new Map<string, string>();
  const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  let depth = 0, part = '', partDepth = 0;
  parser.on('doctype', () => { throw new Error('UNSUPPORTED_XML'); });
  parser.on('opentag', tag => {
    depth++;
    if (tag.uri === drawing && (tag.local === 'dk1' || tag.local === 'lt1')) {
      if (part || colors.has(tag.local)) fail('图片盘点预览', 0, '主题无法核对');
      part = tag.local; partDepth = depth;
    } else if (part && depth > partDepth) {
      if (depth !== partDepth + 1 || tag.uri !== drawing || !['sysClr', 'srgbClr'].includes(tag.local) || colors.has(part)) {
        fail('图片盘点预览', 0, '主题颜色无法核对');
      }
      const attribute = (name: string): string | undefined => Object.values(tag.attributes).find(item => item.uri === '' && item.local === name)?.value;
      const value = attribute('val'), fallback = attribute('lastClr');
      if (!value || (tag.local === 'sysClr' && !fallback)) fail('图片盘点预览', 0, '主题颜色无法核对');
      colors.set(part, JSON.stringify([tag.local, value, fallback ?? '']));
    }
  });
  parser.on('closetag', () => { if (part && depth === partDepth) part = ''; depth--; });
  parser.write(await file.async('string')).close();
  if (!colors.has('dk1') || !colors.has('lt1')) return fail('图片盘点预览', 0, '主题颜色无法核对');
  return JSON.stringify([colors.get('dk1'), colors.get('lt1')]);
}

function previewLabelStyle(cell: ExcelJS.Cell): string {
  const font = cell.font ?? {}, alignment = cell.alignment ?? {};
  return JSON.stringify(stable({
    color: font.color ?? null, size: font.size ?? 11, bold: !!font.bold, italic: !!font.italic,
    underline: font.underline || false, strike: !!font.strike, outline: !!font.outline, vertAlign: font.vertAlign ?? '',
    fill: cell.fill ?? null, numberFormat: cell.numFmt ?? 'General',
    alignment: { horizontal: alignment.horizontal ?? '', vertical: alignment.vertical ?? '', wrapText: !!alignment.wrapText,
      shrinkToFit: !!alignment.shrinkToFit, indent: alignment.indent ?? 0,
      readingOrder: alignment.readingOrder ?? '', textRotation: alignment.textRotation ?? 0 },
  }));
}

function setPreviewLabelFont(sheet: ExcelJS.Worksheet): void {
  for (let row = 1; row <= sheet.rowCount; row++) {
    for (let column = 1; column <= 7; column++) {
      const cell = sheet.getRow(row).getCell(column);
      if (cell.value === null) continue;
      const font = { ...cell.font, name: PREVIEW_FONT };
      delete font.scheme;
      delete font.charset;
      cell.font = font;
    }
  }
}

/** The preview is evidence only while its labels, image bytes and anchors match. */
async function validateImagePreview(source: InspectedSource, bytes: Buffer, actual: ExcelJS.Workbook): Promise<void> {
  const expectedBytes = await createSyntheticSourcePreview(source);
  const expectedBook = new ExcelJS.Workbook();
  await expectedBook.xlsx.load(new Uint8Array(expectedBytes).buffer);
  const expectedSheet = expectedBook.getWorksheet('图片盘点预览'), sheet = actual.getWorksheet('图片盘点预览');
  if (!expectedSheet || !sheet || sheet.state !== 'visible') fail('图片盘点预览', 0, '图片预览缺失或隐藏，请重新生成');
  setPreviewLabelFont(expectedSheet);
  if (sheet.views.some(view => view.rightToLeft)) fail('图片盘点预览', 0, '从右向左的图片预览无法核对，请恢复原视图');
  const model = sheet.model;
  if ((model.merges ?? []).length || sheet.autoFilter || !('conditionalFormattings' in model)
    || !Array.isArray(model.conditionalFormattings) || model.conditionalFormattings.length) {
    fail('图片盘点预览', 0, '预览的合并、筛选或条件格式无法核对，请重新生成');
  }
  if (await previewTheme(expectedBytes) !== await previewTheme(bytes)) fail('图片盘点预览', 0, '主题颜色已改变，请重新生成并核对');
  const [expected, current] = await Promise.all([inspectMappingPreview(expectedBytes, true), inspectMappingPreview(bytes, true)]);
  const canonical = (value: InspectedSource): string[] => value.inventory.objects.flatMap(item => {
    if (item.kind === 'unsupported' && (item.sheet === '图片盘点预览'
      || (!item.sheet && /^xl\/(?:drawings|media)\//u.test(item.location)))) fail('图片盘点预览', 0, '图片对象无法可靠核对');
    if (item.sheet !== '图片盘点预览') return [];
    if (item.kind === 'text') return [JSON.stringify(['文字', item.cell, item.text])];
    if (item.kind === 'image') return [JSON.stringify(['图片', item.position, item.sha256, item.extension, item.width, item.height])];
    return fail('图片盘点预览', 0, '图片预览包含不支持的对象');
  }).sort();
  if (JSON.stringify(canonical(expected)) !== JSON.stringify(canonical(current))) {
    fail('图片盘点预览', 0, '图片、来源编号、摘要或锚点已改变，请重新生成并核对');
  }
  for (let column = 1; column <= 7; column++) {
    const before = expectedSheet.getColumn(column), after = sheet.getColumn(column);
    if (before.width !== after.width || !!before.hidden !== !!after.hidden) fail('图片盘点预览', 0, '预览列的显示方式已改变');
  }
  for (let row = 1; row <= expectedSheet.rowCount; row++) {
    const before = expectedSheet.getRow(row), after = sheet.getRow(row);
    if (before.height !== after.height || !!before.hidden !== !!after.hidden) fail('图片盘点预览', row, '预览行的显示方式已改变');
    for (let column = 1; column <= 7; column++) {
      const label = before.getCell(column);
      const currentLabel = after.getCell(column);
      if (label.value !== null && (previewLabelStyle(label) !== previewLabelStyle(currentLabel)
        || currentLabel.font?.name !== PREVIEW_FONT
        || (currentLabel.font?.scheme !== undefined && currentLabel.font.scheme !== 'none')
        || (currentLabel.font?.charset !== undefined && currentLabel.font.charset !== WPS_GB2312_CHARSET))) {
        fail('图片盘点预览', row, '预览标签须使用明确的 Arial 字体及原有显示格式，请重新生成并核对');
      }
    }
  }
}

type WorkbookComparison = 'exact' | 'equivalent' | 'format-unverified' | 'different' | 'unverifiable';
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
function formatSnapshot(book: ExcelJS.Workbook): string | null {
  const sheets: unknown[] = [];
  for (const sheet of book.worksheets) {
    const model = sheet.model;
    if (!('conditionalFormattings' in model) || !Array.isArray(model.conditionalFormattings)
      || !('tables' in model) || !Array.isArray(model.tables) || !('dataValidations' in model)
      || !model.dataValidations || typeof model.dataValidations !== 'object' || Array.isArray(model.dataValidations)
      || !('sheetProtection' in model) || model.conditionalFormattings.length || model.tables.length
      || Object.keys(model.dataValidations).length || model.sheetProtection || model.autoFilter) return null;
    const rows: unknown[] = [], cells: unknown[] = [];
    let hasNotes = false;
    sheet.eachRow(row => {
      if (row.height !== undefined || row.hidden || row.outlineLevel || Object.keys(row.model?.style ?? {}).length) {
        rows.push([row.number, row.height ?? null, !!row.hidden, row.outlineLevel ?? 0, row.model?.style]);
      }
      row.eachCell({ includeEmpty: true }, cell => {
        if (cell.note) hasNotes = true;
        if (cell.value !== null || Object.keys(cell.style).length) cells.push([cell.address, cell.style]);
      });
    });
    if (hasNotes) return null;
    const columns = Array.from({ length: P.columns }, (_, index) => {
      const column = sheet.getColumn(index + 1);
      return [column.width ?? null, !!column.hidden, column.outlineLevel ?? 0, column.style];
    });
    sheets.push({ name: sheet.name, state: sheet.state, defaultRowHeight: sheet.properties.defaultRowHeight,
      defaultColWidth: sheet.properties.defaultColWidth, rows, cells, columns });
  }
  return JSON.stringify(stable(sheets));
}
function contentSnapshot(value: InspectedSource): string | null {
  if (value.inventory.objects.some(item => item.kind === 'unsupported')) return null;
  const objects = value.inventory.objects.map(item => {
    if (item.kind === 'text') return ['text', item.sheet, item.cell, item.text];
    if (item.kind === 'image' || item.kind === 'background') return [item.kind, item.sheet, item.position, item.sha256, item.extension, item.width, item.height];
    return [];
  }).map(item => JSON.stringify(stable(item))).sort();
  return JSON.stringify(stable({ sheets: value.inventory.sheets, objects }));
}

async function sameFormatAssets(expected: Buffer, current: Buffer): Promise<boolean> {
  const [before, after] = await Promise.all([JSZip.loadAsync(expected), JSZip.loadAsync(current)]);
  const paths = (zip: JSZip): string[] => Object.keys(zip.files).filter(name => name === 'xl/styles.xml'
    || /^xl\/theme\/[^/]+\.xml$/u.test(name)).sort();
  const first = paths(before), second = paths(after);
  if (JSON.stringify(first) !== JSON.stringify(second)) return false;
  for (const path of first) {
    const a = before.file(path), b = after.file(path);
    if (!a || !b || !(await a.async('nodebuffer')).equals(await b.async('nodebuffer'))) return false;
  }
  return true;
}

/** Advisory comparison only. It never promotes the existing source or business check. */
async function compareCurrentWorkbook(expected: Buffer, current: Buffer, check: SourceDraftCheck): Promise<WorkbookComparison> {
  if (check.workbookMatchesMapping) return 'exact';
  if (check.maintenance.status === 'invalid' || (await parseSopMaintenance(expected)).kind === 'invalid') return 'unverifiable';
  try {
    const [before, after] = await Promise.all([inspectMappingPreview(expected), inspectMappingPreview(current)]);
    const first = contentSnapshot(before), second = contentSnapshot(after);
    if (!first || !second) return 'unverifiable';
    if (first !== second) return 'different';
    const beforeBook = new ExcelJS.Workbook(), afterBook = new ExcelJS.Workbook();
    await beforeBook.xlsx.load(new Uint8Array(expected).buffer);
    await afterBook.xlsx.load(new Uint8Array(current).buffer);
    const beforeFormat = formatSnapshot(beforeBook), afterFormat = formatSnapshot(afterBook);
    if (!beforeFormat || !afterFormat) return 'unverifiable';
    if (beforeFormat !== afterFormat) return 'format-unverified';
    return await sameFormatAssets(expected, current) ? 'equivalent' : 'format-unverified';
  } catch {
    return 'unverifiable';
  }
}

/** Creates a synthetic-only editing view. The original source remains authoritative. */
export async function createSyntheticMappingWorkbook(sourceBytes: Buffer): Promise<Buffer> {
  const source = await inspectSyntheticSopSource(sourceBytes);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(await createSyntheticSourcePreview(source)).buffer);
  const redundantPreview = book.getWorksheet('文字盘点预览');
  if (redundantPreview) book.removeWorksheet(redundantPreview.id);
  const imagePreview = book.getWorksheet('图片盘点预览');
  if (!imagePreview) throw new Error('MISSING_PREVIEW_SHEET');
  setPreviewLabelFont(imagePreview);
  const mapping = book.addWorksheet(MAPPING_SHEET);
  book.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 1, visibility: 'visible' }];
  mapping.addRow(['仅合成演示，不能上传或发布。黄色单元格可编辑。']);
  mapping.getCell('L1').value = VERSION;
  mapping.getCell('M1').value = source.inventory.sourceSha256;
  mapping.getColumn(12).hidden = true;
  mapping.getColumn(13).hidden = true;
  mapping.addRow(['拆分请复制整行，按顺序修改本段原文。采用时填写目标行号和字段。多段合并必须选同一种方式。']);
  mapping.addRow([...HEADERS]);
  [20, 15, 22, 10, 40, 12, 15, 16, 14, 28].forEach((width, i) => { mapping.getColumn(i + 1).width = width; });
  mapping.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }];
  mapping.getRow(1).font = { bold: true, color: { argb: 'FF7A3B00' } };
  mapping.getRow(3).font = { bold: true };
  for (const item of source.inventory.objects) {
    const row = mapping.addRow([item.id, item.sheet, sourceLocation(item), typeLabel(item),
      item.kind === 'text' ? item.text : '', '待确认', '', '', '', '']);
    row.height = 42;
    row.alignment = { vertical: 'top', wrapText: true };
    for (let column = 5; column <= 10; column++) row.getCell(column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4CC' } };
    row.getCell(6).dataValidation = { type: 'list', allowBlank: false, formulae: ['"待确认,使用,排除"'], showErrorMessage: true };
    row.getCell(9).dataValidation = { type: 'list', allowBlank: true, formulae: ['"直接连接,换行,空格"'], showErrorMessage: true };
  }
  mapping.autoFilter = { from: 'A3', to: `J${Math.max(3, mapping.rowCount)}` };
  const batch = book.addWorksheet(BATCH_SHEET);
  batch.addRow(['按原表区域批量指定文字去向；图片、不支持的对象和判断分支仍需逐项处理。']);
  batch.addRow([...BATCH_HEADERS]);
  [20, 24, 14, 18, 20, 16, 36].forEach((width, index) => { batch.getColumn(index + 1).width = width; });
  batch.views = [{ state: 'frozen', ySplit: 2 }];
  batch.getRow(2).font = { bold: true };
  for (const name of Object.keys(SOP_MAINTENANCE_HEADERS) as SheetName[]) {
    const sheet = book.addWorksheet(name);
    sheet.addRow(['每条记录填写唯一的英文整理行号。人工审核在正式审核环节完成。']);
    sheet.addRow([...HELPER_HEADERS, ...editableHeaders(name)]);
    sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 2 }];
    sheet.getRow(2).font = { bold: true };
    sheet.getColumn(1).width = 16;
    sheet.getColumn(2).width = 28;
    for (let column = 3; column <= editableHeaders(name).length + 2; column++) sheet.getColumn(column).width = 20;
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

function readTargetRows(book: ExcelJS.Workbook): Map<string, DraftRow> {
  const result = new Map<string, DraftRow>();
  const version = book.getWorksheet(MAPPING_SHEET)?.getCell('L1').value;
  for (const name of Object.keys(SOP_MAINTENANCE_HEADERS) as SheetName[]) {
    const sheet = book.getWorksheet(name);
    if (!sheet) fail(name, 0, '缺少目标工作表');
    const fieldsToRead: readonly string[] = version === LEGACY_VERSION ? SOP_MAINTENANCE_HEADERS[name] : editableHeaders(name);
    const headers = [...HELPER_HEADERS, ...fieldsToRead];
    expectedHeader(sheet, 2, headers);
    if ((sheet.model.merges ?? []).length) fail(name, 0, '目标工作表不能使用合并单元格');
    if (sheet.getImages().length) fail(name, 0, '请通过来源整理表指定图片，不要在目标表直接插图');
    for (let number = 3; number <= sheet.rowCount; number++) {
      const cells = cellTexts(sheet.getRow(number), headers.length, name);
      if (cells.every(value => value === '')) continue;
      const key = (cells[0] ?? '').trim(), note = cells[1] ?? '';
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(key) || result.has(key)) fail(name, number, '整理行号须为唯一英文或数字编号');
      const fields: DraftRow['fields'] = { 维护状态: '草稿' };
      fieldsToRead.forEach((header, i) => { const value = cells[i + 2] ?? ''; if (value && !isReviewClaim(header)) fields[header] = value; });
      if (fields['图片']) fail(name, number, '图片列留空，在来源整理表选择图片去向');
      result.set(key, { key, sheet: name, fields, origin: { kind: 'new', reason: note } });
      if (result.size > P.rows) fail(name, number, '目标记录过多');
    }
  }
  return result;
}

function readPieces(book: ExcelJS.Workbook, source: InspectedSource): Map<string, Piece[]> {
  const sheet = book.getWorksheet(MAPPING_SHEET);
  if (!sheet) fail(MAPPING_SHEET, 0, '缺少来源整理表');
  const version = text(sheet.getCell('L1'), sheet.name, 1);
  if (version !== VERSION && version !== LEGACY_VERSION) fail(sheet.name, 1, '整理表版本不受支持，请重新生成');
  if (text(sheet.getCell('M1'), sheet.name, 1) !== source.inventory.sourceSha256) {
    fail(sheet.name, 1, '原表 SHA-256 与整理表记录不一致，请使用生成整理表时的原工作簿');
  }
  expectedHeader(sheet, 3, HEADERS);
  if ((sheet.model.merges ?? []).length) fail(sheet.name, 0, '来源整理表不能使用合并单元格');
  if (sheet.getImages().length) fail(sheet.name, 0, '请使用图片盘点预览，不要在来源整理表直接插图');
  const byId = new Map(source.inventory.objects.map(item => [item.id, item]));
  const pieces = new Map<string, Piece[]>();
  if (sheet.rowCount > P.rows + source.inventory.objects.length + 3) fail(sheet.name, 0, '来源整理行数超限');
  for (let number = 4; number <= sheet.rowCount; number++) {
    const cells = cellTexts(sheet.getRow(number), HEADERS.length, sheet.name);
    if (cells.every(value => value === '')) continue;
    const id = cells[0] ?? '', item = byId.get(id);
    if (!item) fail(sheet.name, number, '来源编号不存在或已更改');
    if (cells[1] !== item.sheet || cells[2] !== sourceLocation(item) || cells[3] !== typeLabel(item)) {
      fail(sheet.name, number, '原表、位置或类型已改变，请从原表重新生成');
    }
    const part: Piece = { sourceId: id, text: cells[4] ?? '', status: status((cells[5] ?? '').trim(), number),
      target: (cells[6] ?? '').trim(), field: (cells[7] ?? '').trim(), join: (cells[8] ?? '').trim(), reason: cells[9] ?? '', row: number, batch: false };
    if (part.status === '使用' && (!part.target || !part.field)) fail(sheet.name, number, '使用时须填写目标行号和目标字段');
    if (part.status !== '使用' && (part.target || part.field || part.join)) fail(sheet.name, number, '待确认或排除的来源不能填写去向或合并方式');
    if (part.status === '排除' && !part.reason.trim()) fail(sheet.name, number, '排除时须填写处理说明');
    if (item.kind !== 'text' && part.text) fail(sheet.name, number, '非文字来源不能填写本段原文');
    if (item.kind === 'unsupported' && part.status === '使用') fail(sheet.name, number, '不支持的来源只能待确认或说明后排除');
    const list = pieces.get(id) ?? [];
    list.push(part);
    pieces.set(id, list);
  }
  for (const item of source.inventory.objects) {
    const list = pieces.get(item.id);
    if (!list?.length) fail(sheet.name, 0, `缺少来源 ${item.sheet} ${sourceLocation(item)}，请恢复该行`);
    if (item.kind !== 'text' && list.length !== 1) fail(sheet.name, list[0]?.row ?? 0, '图片或不支持的来源不可重复');
    if (item.kind === 'text' && (list.some(part => !part.text.length) || list.map(part => part.text).join('') !== item.text)) {
      fail(sheet.name, list[0]?.row ?? 0, '各段原文按行顺序拼接后必须与原文完全一致');
    }
  }
  return pieces;
}

type Rect = { left: number; right: number; top: number; bottom: number };
function rectangle(value: string, row: number): Rect {
  const match = /^([A-Z]+)([1-9][0-9]*)(?::([A-Z]+)([1-9][0-9]*))?$/u.exec(value);
  if (!match) fail(BATCH_SHEET, row, '范围使用 A1 或 A1:B20 格式');
  const column = (name: string): number => [...name].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0);
  const left = column(match[1] ?? ''), right = column(match[3] ?? match[1] ?? '');
  const top = Number(match[2]), bottom = Number(match[4] ?? match[2]);
  if (left < 1 || right < left || right > P.columns || top < 1 || bottom < top || bottom > P.rows + 1) {
    fail(BATCH_SHEET, row, '范围超出工作表支持的行列或顺序错误');
  }
  return { left, right, top, bottom };
}
const intersects = (a: Rect, b: Rect): boolean => a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
const contains = (outer: Rect, inner: Rect): boolean => outer.left <= inner.left && outer.right >= inner.right && outer.top <= inner.top && outer.bottom >= inner.bottom;
const BATCH_FIELDS: Partial<Record<SheetName, readonly string[]>> = {
  执行任务: ['操作要求'], 客户话术: ['对客正文'], 知识与案例: ['正文'], 资源与图片: ['资源内容'],
};

function applyBatchRules(book: ExcelJS.Workbook, source: InspectedSource, rows: Map<string, DraftRow>, pieces: Map<string, Piece[]>): void {
  const sheet = book.getWorksheet(BATCH_SHEET);
  if (!sheet) {
    if (book.getWorksheet(MAPPING_SHEET)?.getCell('L1').value === LEGACY_VERSION) return;
    fail(BATCH_SHEET, 0, '缺少批量整理表');
  }
  expectedHeader(sheet, 2, BATCH_HEADERS);
  if ((sheet.model.merges ?? []).length || sheet.getImages().length) fail(BATCH_SHEET, 0, '批量表不能合并单元格或插入图片');
  const areas: { sheet: string; rect: Rect }[] = [];
  for (let number = 3; number <= sheet.rowCount; number++) {
    const cells = cellTexts(sheet.getRow(number), BATCH_HEADERS.length, sheet.name);
    if (cells.every(value => value === '')) continue;
    const [name = '', address = '', action = '', key = '', field = '', join = '', reason = ''] = cells.map(value => value.trim());
    const inputSheet = source.inventory.sheets.find(item => item.name === name);
    if (!inputSheet) fail(sheet.name, number, '原表不存在');
    const area = rectangle(address, number);
    if (areas.some(previous => previous.sheet === name && intersects(previous.rect, area))) {
      fail(sheet.name, number, '批量范围重叠，请调整区域');
    }
    areas.push({ sheet: name, rect: area });
    for (const merge of inputSheet.merges) {
      const merged = rectangle(merge, number);
      if (intersects(area, merged) && !contains(area, merged)) fail(sheet.name, number, '范围截断了原表合并单元格，请完整选择合并区域');
    }
    if (action !== '使用' && action !== '排除') fail(sheet.name, number, '批量处理只能选择使用或排除');
    if (action === '排除' && (!reason || key || field || join)) fail(sheet.name, number, '批量排除须填写说明，且不能填写去向');
    if (action === '使用') {
      const target = rows.get(key);
      if (!target || !(BATCH_FIELDS[target.sheet] ?? []).includes(field)) fail(sheet.name, number, '批量使用只能指定已有记录的正文或操作要求字段');
      if (!['直接连接', '换行', '空格'].includes(join)) fail(sheet.name, number, '批量使用须明确合并方式');
    }
    const selected = source.inventory.objects.filter(item => item.kind === 'text' && item.sheet === name
      && contains(area, rectangle(item.cell, number)));
    if (!selected.length) fail(sheet.name, number, '范围中没有可整理的文字');
    for (const item of selected) {
      const list = pieces.get(item.id), part = list?.[0];
      if (!part || list?.length !== 1 || part.status !== '待确认') fail(sheet.name, number, '批量范围重叠，或包含已经拆分、处理的文字');
      part.status = action; part.target = key; part.field = field; part.join = join; part.reason = reason; part.batch = true;
    }
  }
}

/** Converts edited cells into the existing decision format without guessing destinations. */
export async function decisionsFromSyntheticMapping(sourceBytes: Buffer, mappingBytes: Buffer): Promise<MappingDecisions> {
  const source = await inspectSyntheticSopSource(sourceBytes);
  await inspectArchive(mappingBytes);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(mappingBytes).buffer);
  const allowed = new Set([MAPPING_SHEET, BATCH_SHEET, '图片盘点预览', ...Object.keys(SOP_MAINTENANCE_HEADERS)]);
  if (book.worksheets.some(sheet => !allowed.has(sheet.name))) fail('整理表', 0, '存在未识别的工作表');
  const pieces = readPieces(book, source);
  await validateImagePreview(source, mappingBytes, book);
  const rows = readTargetRows(book);
  applyBatchRules(book, source, rows, pieces);
  const sheetOrder = new Map(source.inventory.sheets.map((sheet, index) => [sheet.name, index]));
  const targets = new Map<string, TextTarget>();
  const decisions: unknown[] = [];
  for (const item of source.inventory.objects) {
    const list = pieces.get(item.id);
    if (!list) throw new Error('SOURCE_INTERNAL_ERROR');
    let cursor = 0;
    const segments: { start: number; end: number; disposition: 'mapped' | 'pending' | 'excluded'; reason: string }[] = [];
    for (const part of list) {
      const size = item.kind === 'text' ? Array.from(part.text).length : 1;
      const reference = { sourceId: item.id, start: cursor, end: cursor + size };
      cursor += size;
      const disposition = part.status === '使用' ? 'mapped' : part.status === '排除' ? 'excluded' : 'pending';
      segments.push({ start: reference.start, end: reference.end, disposition, reason: part.reason });
      if (part.status !== '使用') continue;
      const row = rows.get(part.target);
      if (!row) fail(MAPPING_SHEET, part.row, '目标行号不存在');
      if (!editableHeaders(row.sheet).includes(part.field)) fail(MAPPING_SHEET, part.row, '目标字段不属于可整理的目标字段');
      if (row.fields[part.field]) fail(MAPPING_SHEET, part.row, '目标字段已手填，不能同时使用来源');
      row.origin.kind = 'source';
      if (item.kind === 'text') {
        if (part.field === '图片') fail(MAPPING_SHEET, part.row, '文字不能映射到图片字段');
        const key = JSON.stringify([row.key, part.field]);
        const target = targets.get(key) ?? { row, field: part.field, parts: [], firstRow: part.row };
        const sourceSheet = sheetOrder.get(item.sheet), position = rectangle(item.cell, part.row);
        if (sourceSheet === undefined) throw new Error('SOURCE_INTERNAL_ERROR');
        target.parts.push({ reference, join: part.join, row: part.row, batch: part.batch,
          position: [sourceSheet, position.top, position.left] });
        targets.set(key, target);
      } else if (item.kind === 'image' || item.kind === 'background') {
        if (row.sheet !== '资源与图片' || part.field !== '图片' || row.imageSourceId || part.join) {
          fail(MAPPING_SHEET, part.row, '图片须独占一条资源记录的图片字段');
        }
        row.imageSourceId = item.id;
      }
    }
    decisions.push(item.kind === 'text' ? { sourceId: item.id, segments }
      : { sourceId: item.id, disposition: segments[0]?.disposition, reason: segments[0]?.reason });
  }
  const separators = new Map([['直接连接', ''], ['换行', '\n'], ['空格', ' ']]);
  for (const target of targets.values()) {
    if (target.parts.some(part => part.batch)) {
      target.parts.sort((a, b) => a.position[0] - b.position[0] || a.position[1] - b.position[1]
        || a.position[2] - b.position[2] || a.reference.start - b.reference.start);
    } else target.parts.sort((a, b) => a.row - b.row);
    const join = target.parts[0]?.join ?? '', refs = target.parts.map(part => part.reference);
    if (refs.length > 1000) fail(MAPPING_SHEET, target.firstRow, '单个目标字段最多使用 1000 个来源片段，请拆成多条记录');
    if ((refs.length > 1 && (!separators.has(join) || target.parts.some(part => part.join !== join)))
      || (refs.length === 1 && join && !separators.has(join))) fail(MAPPING_SHEET, target.firstRow, '合并的各段须选择相同的合并方式');
    target.row.fields[target.field] = refs.length > 1
      ? { from: refs, separator: separators.get(join) ?? '' } : { from: refs };
  }
  for (const row of rows.values()) if (row.origin.kind === 'new' && !row.origin.reason.trim()) {
    fail(row.sheet, 0, `新增记录 ${row.key} 缺少新增说明`);
  }
  return { version: SOURCE_DECISIONS_VERSION, sourceSha256: source.inventory.sourceSha256, decisions, rows: [...rows.values()] };
}

export async function buildSyntheticMappingDraft(source: Buffer, mapping: Buffer): Promise<{ draft: BuiltDraft; check: SourceDraftCheck; decisions: MappingDecisions }> {
  const decisions = await decisionsFromSyntheticMapping(source, mapping);
  const draft = await buildSyntheticSopDraft(source, decisions);
  const check = await checkSyntheticSopSourceDraft({ source, decisions, workbook: draft.workbook });
  return { draft, check, decisions };
}

/** This report describes coverage and review needs, not business approval. */
export async function createSyntheticMappingReport(sourceBytes: Buffer, draft: BuiltDraft, check: SourceDraftCheck, decisions: MappingDecisions, currentWorkbook: Buffer): Promise<Buffer> {
  const source = await inspectSyntheticSopSource(sourceBytes);
  if (check.sourceSha256 !== source.inventory.sourceSha256 || draft.report.sourceSha256 !== check.sourceSha256
    || createHash('sha256').update(currentWorkbook).digest('hex') !== check.workbookSha256) throw new Error('REPORT_INPUT_MISMATCH');
  const sourceById = new Map(source.inventory.objects.map(item => [item.id, item]));
  const book = new ExcelJS.Workbook(), summary = book.addWorksheet('核对概览'), detail = book.addWorksheet('预期来源去向');
  const reasonLabels: Record<SourceDraftCheck['reasons'][number], string> = {
    WORKBOOK_CHANGED: '维护稿与生成稿的文件内容不同，需查看语义核对', PENDING_SOURCES: '有来源待确认', UNSUPPORTED_SOURCE_OBJECTS: '存在不支持的来源',
    IMAGE_REVIEW_REQUIRED: '图片需核对', MAINTENANCE_NOT_REVIEWED: '维护稿仍需核对',
  };
  const maintenanceStatus = check.maintenance.status === 'invalid' ? '格式有误'
    : check.maintenance.status === 'needs-review' ? '待核对' : '仅模板检查通过';
  const comparison = await compareCurrentWorkbook(draft.workbook, currentWorkbook, check);
  const matchStatus = comparison === 'exact' ? '是（工作簿内各文件内容一致）' : comparison === 'equivalent' ? '已比对内容及格式一致（视图未核对）'
    : comparison === 'format-unverified' ? '已比对内容及图片一致，格式和视图待核对' : comparison === 'different' ? '否' : '无法确认';
  const coverage = check.counts.pending || check.counts.unsupported ? '待处理' : '已覆盖';
  summary.addRows([
    ['仅合成演示，不能上传或发布'],
    ['整理表的来源覆盖', coverage, '覆盖指已指定去向或明确排除'],
    ['业务审核', '未核验', '整理表中的姓名和状态不构成认证审核'],
    ['现有来源核对', check.sourceCheck === 'complete' ? '完成结构核对' : '待核对', '不代表业务审核'],
    ['维护稿与整理选择一致', matchStatus],
    ['来源对象', check.counts.objects, '分段', check.counts.segments],
    ['已使用分段', check.counts.mapped, '已排除分段', check.counts.excluded, '待确认分段', check.counts.pending],
    ['不支持对象', check.counts.unsupported, '图片待核对', check.counts.imagesNeedingReview],
    ['待处理原因', check.reasons.map(reason => reasonLabels[reason]).join('、') || '无'],
    ['维护表检查', maintenanceStatus, '不能代替业务审核'],
    ['来源 SHA-256', check.sourceSha256],
    ['已比对范围', '文字、行列、合并关系、图片摘要与锚点、样式和行列可见性', '视图、打印布局及图片完整解码未核对'],
    ['当前明细展示', '场景、任务、分支、知识、话术、话术引用、确认项和资源的选定字段', '其他字段未逐项展示'],
    ['图片预览变换', draft.report.ledger.some(item => item.kind === 'image' || item.kind === 'background') ? '待核对' : '无图片',
      '预览绘图变换及字体实际渲染未核对，请对照原表确认图片与编号'],
  ]);
  summary.columns = [{ width: 25 }, { width: 70 }, { width: 25 }, { width: 16 }, { width: 18 }, { width: 16 }];
  detail.addRow(['来源编号', '原表', '原位置', '类型', '分段原文或说明', '处理', '目标记录与字段', '排除说明', '图片待核对']);
  detail.views = [{ state: 'frozen', ySplit: 1 }];
  [22, 18, 25, 13, 52, 13, 38, 30, 50].forEach((width, i) => { detail.getColumn(i + 1).width = width; });
  for (const entry of draft.report.ledger) {
    const item = sourceById.get(entry.sourceId);
    if (!item) throw new Error('SOURCE_INTERNAL_ERROR');
    for (const segment of entry.segments) {
      const segmentText = item.kind === 'text' ? Array.from(item.text).slice(segment.start, segment.end).join('') : description(item);
      const row = detail.addRow([entry.sourceId, entry.sheet, sourceLocation(item), typeLabel(item), segmentText,
        segment.disposition === 'mapped' ? '使用' : segment.disposition === 'excluded' ? '排除' : '待确认',
        segment.targets.join('\n'), segment.reason, entry.reviewWarnings.join('；')]);
      row.alignment = { vertical: 'top', wrapText: true };
    }
  }
  detail.autoFilter = { from: 'A1', to: `I${Math.max(1, detail.rowCount)}` };
  detail.getRow(1).font = { bold: true };
  const records = book.addWorksheet('预期目标记录');
  records.addRow(['整理行号', '目标表', '记录类型', '业务编号', '所属任务', '来源方式', '新增说明']);
  records.columns = [{ width: 20 }, { width: 18 }, { width: 18 }, { width: 24 }, { width: 24 }, { width: 16 }, { width: 40 }];
  for (const row of draft.report.targets) records.addRow([row.key, row.sheet, row.recordType, row.businessId,
    row.parentTaskId, row.origin === 'source' ? '使用来源' : '人工新增', row.reason]);
  const fields = book.addWorksheet('预期字段来源');
  fields.addRow(['整理行号', '目标表', '目标字段', '来源方式', '来源编号或人工说明']);
  fields.columns = [{ width: 20 }, { width: 18 }, { width: 22 }, { width: 18 }, { width: 55 }];
  for (const row of decisions.rows) {
    for (const [field, value] of Object.entries(row.fields)) {
      if (isReviewClaim(field)) continue;
      fields.addRow([row.key, row.sheet, field, typeof value === 'string' ? '人工填写' : '来源片段',
        typeof value === 'string' ? row.origin.reason || '由整理人员填写' : value.from.map(ref => ref.sourceId).join('、')]);
    }
    if (row.imageSourceId) fields.addRow([row.key, row.sheet, '图片', '来源图片', row.imageSourceId]);
  }
  const issues = book.addWorksheet('维护稿问题');
  issues.addRow(['维护稿工作表', '维护稿行', '维护稿列', '需要处理']);
  issues.columns = [{ width: 22 }, { width: 16 }, { width: 16 }, { width: 64 }];
  for (const issue of check.maintenance.issues) issues.addRow([issue.sheet, issue.row || '', issue.column, issue.fix]);
  const expected = await parseSopMaintenance(draft.workbook), actual = await parseSopMaintenance(currentWorkbook);
  const actualRows = book.addWorksheet('当前实际维护稿');
  actualRows.addRow(['记录类型', '编号', '当前名称或话术编号', '当前正文或操作', '当前关联资源', '当前目标', '当前适用条件', '当前话术关系', '所属任务', '当前确认配置或顺序']);
  actualRows.columns = [{ width: 16 }, { width: 20 }, { width: 30 }, { width: 60 }, { width: 30 }, { width: 22 },
    { width: 40 }, { width: 16 }, { width: 20 }, { width: 24 }];
  if (actual.kind === 'invalid') actualRows.addRow(['无法读取', '', '维护稿结构无效，请先修复']);
  else {
    for (const row of actual.document.scenes) actualRows.addRow(['场景', row.id, row.title, '', '', row.startTaskId]);
    for (const row of actual.document.tasks) actualRows.addRow(['任务', row.id, row.title, row.instruction, row.resourceIds.join('、'), row.kind === 'action' ? row.nextTaskId : '', '', '', '',
      row.requirements.kind === 'none' ? '无确认项' : row.requirements.kind === 'specified' ? '有确认项' : '待确认']);
    for (const row of actual.document.branches) actualRows.addRow(['分支', row.id, row.label, row.criterion, '', row.targetTaskId]);
    for (const row of actual.document.knowledge) actualRows.addRow(['知识', row.id, row.title, row.body, row.resourceIds.join('、')]);
    for (const row of actual.document.scripts) actualRows.addRow(['话术', row.id, row.title, row.answerText, row.resourceIds.join('、')]);
    for (const row of actual.document.scriptLinks) actualRows.addRow(['话术引用', row.id ?? '旧关联（无独立编号）', row.scriptId, '', '', '', row.condition, row.relationship, row.taskId]);
    for (const row of actual.document.requirements) actualRows.addRow(['确认项', row.id, row.label, '', '', '', '', '', row.taskId, row.ordinal ?? '未明确']);
    for (const row of actual.document.resources) actualRows.addRow(['资源', row.id, row.title, row.content, row.kind === 'image' ? row.images.map(image => image.sha256).join('、') : '']);
  }
  const owners = (document: MaintenanceDocument, resource: string): string => [
    ...document.tasks.filter(row => row.resourceIds.includes(resource)).map(row => `任务 ${row.id}`),
    ...document.knowledge.filter(row => row.resourceIds.includes(resource)).map(row => `知识 ${row.id}`),
    ...document.scripts.filter(row => row.resourceIds.includes(resource)).map(row => `话术 ${row.id}`),
  ].join('、') || '尚未关联任务、知识或话术';
  const images = book.addWorksheet('图片归属');
  images.addRow(['来源编号', '原表', '原位置', '预期资源', '预期关联', '当前实际资源', '当前实际关联', '待核对']);
  images.columns = [{ width: 22 }, { width: 18 }, { width: 25 }, { width: 20 }, { width: 32 }, { width: 24 }, { width: 32 }, { width: 55 }];
  for (const entry of draft.report.ledger.filter(item => item.kind === 'image' || item.kind === 'background')) {
    const segment = entry.segments[0], target = segment?.targets[0] ?? '';
    const key = target.endsWith('.图片') ? target.slice(0, -3) : '';
    const resource = draft.report.targets.find(row => row.key === key)?.businessId ?? '';
    const item = sourceById.get(entry.sourceId);
    if (!item) throw new Error('SOURCE_INTERNAL_ERROR');
    const expectedOwners = expected.kind === 'invalid' ? '预期维护稿结构无效'
      : resource ? owners(expected.document, resource) : '尚未指定去向';
    const currentResource = actual.kind === 'parsed' ? actual.document.resources.find(row => row.id === resource) : undefined;
    const actualResource = actual.kind === 'invalid' ? '无法读取当前维护稿' : !resource ? '尚未指定预期资源'
      : !currentResource ? '当前缺少该资源' : currentResource.kind !== 'image' ? '当前资源不是图片'
      : !currentResource.images.some(image => image.sha256 === entry.mediaSha256) ? '当前图片摘要不匹配' : currentResource.id;
    const actualOwners = actual.kind === 'parsed' && currentResource?.kind === 'image'
      && currentResource.images.some(image => image.sha256 === entry.mediaSha256) ? owners(actual.document, currentResource.id) : '无法确认';
    images.addRow([entry.sourceId, entry.sheet, sourceLocation(item), resource, expectedOwners, actualResource, actualOwners,
      [...entry.reviewWarnings, '预览绘图变换未核对，字体实际渲染未验证，请对照原表确认图片与编号'].join('；')]);
  }
  for (const sheet of [records, fields, issues, actualRows, images]) {
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
