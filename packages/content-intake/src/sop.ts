import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { inspectArchive } from './archive.js';
import { INTAKE_POLICY as P, IntakeFailure, type Issue } from './policy.js';

/**
 * Candidate-only SOP workbook contract. It is deliberately separate from the
 * frozen FAQ parser: SOP rows are reconstructed from the source sheet layout
 * and embedded media is returned as bounded attachment bytes. The API runner
 * does not select this parser until a versioned SOP contract is approved.
 */
export const SOP_POLICY_VERSION = 'sop-xlsx-v1';
export const SOP_SHEET_NAMES = [
  '过敏流程SOP', '少错破SOP', '品质售后SOP', '税收相关规则', '品牌对接资源汇总', '长痘痘SOP',
] as const;
const IMAGE_EXTENSIONS = ['jpeg', 'png', 'gif'] as const;
type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];

export type SopParseContext = Readonly<{
  sourceId: string;
  brandId: string;
  scope: string;
  scopeKind: 'brand' | 'shop';
  selectedSheets: readonly string[];
}>;

export type SopAttachment = Readonly<{
  id: string;
  sheet: string;
  row: number;
  column: number;
  extension: ImageExtension;
  mime: `image/${'jpeg' | 'png' | 'gif'}`;
  bytes: number;
  sha256: string;
  base64: string;
}>;

export type SopRow = Readonly<{
  id: string;
  sheet: string;
  row: number;
  text: string;
  attachmentIds: readonly string[];
}>;

export type SopParseResult = Readonly<{
  ok: boolean;
  policyVersion: typeof SOP_POLICY_VERSION;
  rawSha256: string;
  version: string;
  sourceId: string;
  brandId: string;
  scope: string;
  rows: readonly SopRow[];
  attachments: readonly SopAttachment[];
  issues: readonly Issue[];
  expandedBytes: number;
  mediaCount: number;
}>;

const columnName = (index: number): string => {
  let value = index;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
};

const issueResult = (context: SopParseContext | undefined, rawSha256: string, code: string): SopParseResult => ({
  ok: false,
  policyVersion: SOP_POLICY_VERSION,
  rawSha256,
  version: rawSha256,
  sourceId: context?.sourceId ?? '',
  brandId: context?.brandId ?? '',
  scope: context?.scope ?? '',
  rows: [],
  attachments: [],
  issues: [{ code, sheet: '', row: 0, column: '', fix: '检查文件并重新导出完整 SOP 工作簿后重试' }],
  expandedBytes: 0,
  mediaCount: 0,
});

const validContext = (context: SopParseContext): boolean => Boolean(context)
  && ['brand', 'shop'].includes(context.scopeKind)
  && [context.sourceId, context.brandId, context.scope].every((value) => /^[a-zA-Z0-9_.:-]{1,128}$/u.test(value))
  && context.selectedSheets.length === SOP_SHEET_NAMES.length
  && SOP_SHEET_NAMES.every((name) => context.selectedSheets.includes(name))
  && new Set(context.selectedSheets).size === context.selectedSheets.length;

function cellText(value: ExcelJS.CellValue): string | undefined {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'richText' in value
    && Array.isArray(value.richText) && value.richText.every((part) => typeof part.text === 'string')) {
    return value.richText.map((part) => part.text).join('');
  }
  if (typeof value === 'object' && value !== null && 'text' in value && typeof value.text === 'string') return value.text;
  return undefined;
}

function imageBuffer(image: ExcelJS.Image): Buffer | undefined {
  if (image.buffer) return Buffer.from(image.buffer);
  if (image.base64) return Buffer.from(image.base64.split(',', 2).at(-1) ?? '', 'base64');
  return undefined;
}

const SYNTHETIC_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN5EAAAAASUVORK5CYII=', 'base64');

/** One synthetic six-sheet workbook with text and a same-row PNG. Not a real customer file. */
export async function createSyntheticSopWorkbook(): Promise<{ bytes: Buffer; png: Buffer }> {
  const book = new ExcelJS.Workbook();
  for (const [index, name] of SOP_SHEET_NAMES.entries()) {
    const sheet = book.addWorksheet(name);
    sheet.addRow(['答案']);
    if (index < 3) sheet.getCell('A2').value = `${name}合成文字`;
  }
  const imageId = book.addImage({ buffer: SYNTHETIC_PNG as unknown as ExcelJS.Buffer, extension: 'png' });
  book.getWorksheet(SOP_SHEET_NAMES[0])!.addImage(imageId, { tl: { col: 1, row: 1 }, ext: { width: 8, height: 8 } });
  return { bytes: Buffer.from(await book.xlsx.writeBuffer()), png: SYNTHETIC_PNG };
}

/** Map a six-sheet SOP workbook onto the existing FAQ row shape and keep image bytes. */
export async function tryParseSopAsFaq(bytes: Buffer, scope: Readonly<{ sourceId: string; brandId: string; shopId: string | null }>): Promise<{ parsed: import('./policy.js').ParseResult; previews: readonly { bytes: Buffer; mime: `image/${'jpeg' | 'png' | 'gif'}` }[] } | null> {
  const book = new ExcelJS.Workbook();
  try { await book.xlsx.load(bytes as unknown as ExcelJS.Buffer); } catch { return null; }
  if (!SOP_SHEET_NAMES.every(name => book.getWorksheet(name))) return null;
  const sop = await parseSopWorkbook(bytes, {
    sourceId: scope.sourceId, brandId: scope.brandId, scope: scope.shopId ?? scope.brandId,
    scopeKind: scope.shopId === null ? 'brand' : 'shop', selectedSheets: SOP_SHEET_NAMES,
  });
  if (!sop.ok) {
    return { parsed: { ok: false, policyVersion: P.version, rows: [], questions: [], issues: sop.issues, excluded: [], expandedBytes: 0, mediaCount: sop.attachments.length }, previews: [] };
  }
  const rows = sop.rows.map((row, index) => {
    const id = `sop${index + 1}`;
    return { id, title: row.sheet, body: row.text, state: '启用' as const, values: [id, row.sheet, row.text, '', '', '分类', '', '启用', '', '', '', '', '', '', 'false'] };
  });
  return {
    parsed: { ok: rows.length > 0, policyVersion: P.version, rows, questions: [], issues: rows.length ? [] : [{ code: 'EMPTY_DATA', sheet: SOP_SHEET_NAMES[0], row: 2, column: 'A', fix: '补一行文字答案' }], excluded: [], expandedBytes: 0, mediaCount: sop.attachments.length },
    previews: sop.attachments.map(item => ({ bytes: Buffer.from(item.base64, 'base64'), mime: item.mime })),
  };
}

/** Parse a six-sheet SOP workbook using row text plus same-row image attachments. */
export async function parseSopWorkbook(bytes: Buffer, context: SopParseContext): Promise<SopParseResult> {
  const rawSha256 = createHash('sha256').update(bytes).digest('hex');
  if (!validContext(context)) return issueResult(context, rawSha256, 'INVALID_CONTEXT');
  try {
    const archive = await inspectArchive(bytes, { allowExternalHyperlinks: true });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const issues: Issue[] = [];
    const issue = (code: string, sheet: string, row: number, column: string, fix: string) => {
      issues.push({ code, sheet, row, column, fix });
    };
    const selected = [...context.selectedSheets];
    const actual = book.worksheets.map((sheet) => sheet.name);
    for (const name of selected) if (!book.getWorksheet(name)) issue('MISSING_SHEET', name, 1, 'A', '选择存在的 SOP 工作表');
    for (const name of actual) if (!selected.includes(name)) issue('UNKNOWN_SHEET', name, 1, 'A', '确认工作表范围后再导入；不会静默排除未登记工作表');
    if (issues.length) return { ...issueResult(context, rawSha256, issues[0]!.code), ...archive, issues };

    const rows: SopRow[] = [];
    const attachments: SopAttachment[] = [];
    let normalizedTextChars = 0;
    const versionValues = new Set<string>();
    for (const name of selected) {
      const sheet = book.getWorksheet(name)!;
      for (let column = 1; column <= Math.min(sheet.columnCount, P.columns); column++) {
        const header = cellText(sheet.getCell(1, column).value);
        if (header !== '版本' && header !== '版本号') continue;
        for (let row = 2; row <= sheet.actualRowCount; row++) {
          const candidate = cellText(sheet.getCell(row, column).value);
          if (candidate === undefined) {
            issue('NON_TEXT_CELL', name, row, columnName(column), '版本字段必须是纯文本');
          } else if (candidate.trim()) {
            versionValues.add(candidate);
          }
        }
      }
      const byRow = new Map<number, string[]>();
      sheet.eachRow((row, rowNumber) => {
        const values: string[] = [];
        for (let column = 1; column <= Math.min(sheet.columnCount, P.columns); column++) {
          const value = cellText(row.getCell(column).value);
          if (value === undefined) {
            issue('NON_TEXT_CELL', name, rowNumber, columnName(column), 'SOP 文字必须是纯文本或富文本；移除公式、日期和数值单元格');
            continue;
          }
          if (value !== '') {
            normalizedTextChars += value.length;
            if (normalizedTextChars > P.normalizedTextChars) throw new IntakeFailure('NORMALIZED_TEXT_LIMIT');
            if (value.length > P.cellChars) issue('CELL_TEXT_LIMIT', name, rowNumber, columnName(column), '缩短单元格');
            values.push(value);
          }
        }
        if (values.length) byRow.set(rowNumber, values);
      });

      const rowAttachments = new Map<number, string[]>();
      for (const [index, entry] of sheet.getImages().entries()) {
        const row = Math.floor(entry.range.tl.row) + 1;
        const column = Math.floor(entry.range.tl.col) + 1;
        const image = book.getImage(Number(entry.imageId));
        const buffer = imageBuffer(image);
        const extension = image.extension;
        if (!buffer || !IMAGE_EXTENSIONS.includes(extension)) {
          issue('MEDIA_UNAVAILABLE', name, row, columnName(column), '图片必须是受支持的内嵌 PNG/JPEG/GIF，且能被完整读取');
          continue;
        }
        const id = `sop:${name}:${row}:${index + 1}`;
        const attachment: SopAttachment = {
          id, sheet: name, row, column, extension,
          mime: `image/${extension === 'jpeg' ? 'jpeg' : extension}`,
          bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex'),
          base64: buffer.toString('base64'),
        };
        if (buffer.length > P.oneMediaBytes) issue('MEDIA_LIMIT', name, row, columnName(column), '压缩图片后重新导出');
        attachments.push(attachment);
        const linked = rowAttachments.get(row) ?? [];
        linked.push(id); rowAttachments.set(row, linked);
      }

      for (const [row, values] of byRow) {
        const attachmentIds = rowAttachments.get(row) ?? [];
        rows.push({ id: `sop:${name}:${row}`, sheet: name, row, text: values.join('\n'), attachmentIds });
      }
      for (const [row, attachmentIds] of rowAttachments) {
        if (!byRow.has(row)) issue('IMAGE_WITHOUT_TEXT', name, row, 'A', '图片所在行必须补齐文字答案后再导入');
        else if (attachmentIds.length > 0 && !byRow.get(row)!.join('\n').trim()) issue('IMAGE_WITHOUT_TEXT', name, row, 'A', '图片所在行必须补齐文字答案后再导入');
      }
    }
    if (versionValues.size > 1) issue('VERSION_CONFLICT', selected[0]!, 1, 'A', '所有工作表的版本字段必须一致');
    const version = versionValues.values().next().value ?? rawSha256;
    if (rows.length === 0) issue('EMPTY_DATA', selected[0]!, 1, 'A', 'SOP 工作簿不能清空已发布内容');
    const ok = issues.length === 0;
    return { ok, policyVersion: SOP_POLICY_VERSION, rawSha256, version,
      sourceId: context.sourceId, brandId: context.brandId, scope: context.scope,
      rows: ok ? rows : [], attachments: ok ? attachments : [], issues,
      ...archive };
  } catch (error) {
    return issueResult(context, rawSha256, error instanceof IntakeFailure ? error.code : 'INVALID_XLSX');
  }
}
