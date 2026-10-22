import ExcelJS from 'exceljs';
import JSZip from 'jszip';
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
/** The registered SOP source tuple (0038_menokin_sop_domain_v1_27). A SOP source
 * declares this tuple instead of the FAQ template/rule pair, so the registry —
 * not a filename, MIME or sheet list from the client — selects the parser. */
export { SOP_TEMPLATE_VERSION } from './policy.js';
export const SOP_RULE_VERSION = 'sop-not-imported';
export const SOP_MAPPING_VERSION = 'not-imported';
export const SOP_STRUCTURE_SHA256 = '55db62261cb6eee8bb0327ffb4bf8eac1f30a667e6821f640431d4be47c3a925';
const IMAGE_EXTENSIONS = ['jpeg', 'png', 'gif'] as const;
type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];

/** The workbook column that carries a row's stable identity. The header row is
 * row 1 on every sheet; a sheet without this column is refused rather than
 * falling back to position, because position silently rewrites published text. */
export const SOP_ENTRY_CODE_HEADER = '条目编码';
const ENTRY_CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
export const isEntryCode = (value: string): boolean => ENTRY_CODE.test(value);

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
  /** Stable business identity the operator writes in the workbook. Position is
   * not identity: inserting a row above must not renumber every entry below it. */
  code: string;
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
  versionKind: 'declared' | 'sha256';
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
  versionKind: 'sha256',
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

function richTextParts(value: { richText?: readonly { text?: unknown }[] }): string | undefined {
  if (!Array.isArray(value.richText) || !value.richText.every((part) => typeof part.text === 'string')) return undefined;
  return value.richText.map((part) => part.text as string).join('');
}

function cellText(value: ExcelJS.CellValue): string | undefined {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'object' || value === null) return undefined;
  if ('richText' in value) return richTextParts(value);
  if ('text' in value) {
    if (typeof value.text === 'string') return value.text;
    if (value.text && typeof value.text === 'object' && 'richText' in value.text) return richTextParts(value.text);
  }
  return undefined;
}

/** WPS and Feishu exports put an empty `<t/>` before rich-text runs. ExcelJS then
 * tries to assign `richText` onto that empty string and refuses the workbook. */
export function repairEmptySharedStringMarkers(xml: string): string {
  return xml.replace(
    /<((?:[\w.-]+):)?si\b([^>]*)>\s*<(?:[\w.-]+:)?t(?:\s[^>]*?)?(?:\/>|>\s*<\/(?:[\w.-]+:)?t>)(?=\s*<(?:[\w.-]+:)?r\b)/g,
    '<$1si$2>',
  );
}

async function workbookBytesForExcel(bytes: Buffer): Promise<Buffer> {
  if (bytes.length > P.fileBytes) throw new IntakeFailure('FILE_TOO_LARGE');
  await inspectArchive(bytes, { allowExternalHyperlinks: true });
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file('xl/sharedStrings.xml');
  if (!entry) return bytes;
  const xml = await entry.async('string');
  const repaired = repairEmptySharedStringMarkers(xml);
  if (repaired === xml) return bytes;
  zip.file('xl/sharedStrings.xml', repaired);
  const repairedBytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  if (repairedBytes.length > P.fileBytes) throw new IntakeFailure('FILE_TOO_LARGE');
  await inspectArchive(repairedBytes, { allowExternalHyperlinks: true });
  return repairedBytes;
}

function imageBuffer(image: ExcelJS.Image): Buffer | undefined {
  if (image.buffer) return Buffer.from(image.buffer);
  if (image.base64) return Buffer.from(image.base64.split(',', 2).at(-1) ?? '', 'base64');
  return undefined;
}

const SYNTHETIC_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN5EAAAAASUVORK5CYII=', 'base64');

/** A blank workbook the business fills in. Row 1 is the header and every data row
 * must carry its own code, because the code — not the row number — is the entry's
 * identity. `samples` are written as example rows the operator deletes. */
export async function createSopTemplate(samples: readonly (readonly string[])[] = []): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  for (const [index, name] of SOP_SHEET_NAMES.entries()) {
    const sheet = book.addWorksheet(name);
    sheet.getCell('A1').value = SOP_ENTRY_CODE_HEADER;
    sheet.getCell('B1').value = '答案';
    sheet.getCell('A1').font = { bold: true };
    sheet.getCell('B1').font = { bold: true };
    sheet.getColumn(1).width = 18;
    sheet.getColumn(2).width = 60;
    // Only the first sheet carries examples; the rest stay empty so an untouched
    // sheet cannot look like content the operator meant to publish.
    if (index === 0) {
      samples.forEach((cells, offset) => {
        // Row 1 is the header; examples start at row 2 and must not overwrite it.
        sheet.getCell(offset + 2, 1).value = `DEMO-${offset + 1}`;
        cells.forEach((value, cell) => { sheet.getCell(offset + 2, cell + 2).value = value; });
      });
    }
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

/** One synthetic six-sheet workbook with text and a same-row PNG. Not a real customer file. */
export async function createSyntheticSopWorkbook(options: { omitLastTextRow?: boolean; imageOnLastTextRow?: boolean; imageOnFinalRow?: boolean; sameImageOnLastTextRow?: boolean; omitFirstImage?: boolean; replaceFirstImage?: boolean; textSuffix?: string; declaredVersion?: string; tailRows?: number; tailImageStart?: number; tailImageCount?: number; firstSheetRows?: readonly { code: string; text: string }[] } = {}): Promise<{ bytes: Buffer; png: Buffer }> {
  const book = new ExcelJS.Workbook();
  if (options.tailRows !== undefined && (!Number.isInteger(options.tailRows) || options.tailRows < 1 || options.tailRows > 501)) throw new Error('SYNTHETIC_TAIL_ROWS');
  const imageStart = options.tailImageStart ?? 0, imageCount = options.tailImageCount ?? 0;
  if (!Number.isInteger(imageStart) || !Number.isInteger(imageCount) || imageStart < 0 || imageCount < 0 || imageCount > 100
    || imageStart + imageCount > (options.tailRows ?? 0)) throw new Error('SYNTHETIC_TAIL_IMAGES');
  for (const [index, name] of SOP_SHEET_NAMES.entries()) {
    const sheet = book.addWorksheet(name);
    // Row 1 is the header on every sheet; the code column is what makes a row's
    // identity survive an insertion above it.
    sheet.addRow([SOP_ENTRY_CODE_HEADER, '答案']);
    const lastSheet = index === SOP_SHEET_NAMES.length - 1;
    // Without explicit rows this fixture numbers by physical row, which is fine
    // for a single version. A caller that inserts a row must pass codes, because
    // a row-derived code would move with the insertion and prove nothing.
    const explicit = index === 0 ? options.firstSheetRows : undefined;
    const writeRow = (row: number, text: string) => {
      sheet.getCell(row, 1).value = `${index + 1}-${row}`;
      sheet.getCell(row, 2).value = text;
    };
    if (explicit) {
      explicit.forEach((entry, offset) => {
        sheet.getCell(offset + 2, 1).value = entry.code;
        sheet.getCell(offset + 2, 2).value = entry.text;
      });
    } else if (index < 3) writeRow(2, `${name}合成文字${options.textSuffix ?? ''}`);
    if (lastSheet && options.tailRows !== undefined) {
      for (let row = 0; row < options.tailRows; row++) writeRow(row + 2, `合成规模答案${row + 1}`);
    }
    if (index === 0 && options.declaredVersion !== undefined) { sheet.getCell('D1').value = '版本'; sheet.getCell('D2').value = options.declaredVersion; }
  }
  const imageId = book.addImage(options.replaceFirstImage
    ? { buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') as unknown as ExcelJS.Buffer, extension: 'gif' }
    : { buffer: SYNTHETIC_PNG as unknown as ExcelJS.Buffer, extension: 'png' });
  for (let row = imageStart; row < imageStart + imageCount; row++) {
    book.getWorksheet(SOP_SHEET_NAMES.at(-1)!)!.addImage(imageId, { tl: { col: 1, row: row + 1 }, ext: { width: 8, height: 8 } });
  }
  if (!options.omitFirstImage) book.getWorksheet(SOP_SHEET_NAMES[0])!.addImage(imageId, { tl: { col: 1, row: 1 }, ext: { width: 8, height: 8 } });
  if (options.sameImageOnLastTextRow) {
    book.getWorksheet(SOP_SHEET_NAMES[2])!.addImage(imageId, { tl: { col: 1, row: 1 }, ext: { width: 8, height: 8 } });
  }
  if (options.imageOnLastTextRow || options.imageOnFinalRow) {
    const secondImage = book.addImage({ buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') as unknown as ExcelJS.Buffer, extension: 'gif' });
    book.getWorksheet(SOP_SHEET_NAMES[options.imageOnFinalRow ? 5 : 2])!.addImage(secondImage, { tl: { col: 1, row: options.imageOnFinalRow ? 0 : 1 }, ext: { width: 8, height: 8 } });
  }
  return { bytes: Buffer.from(await book.xlsx.writeBuffer()), png: SYNTHETIC_PNG };
}

const refIds = (value: string): string[] => value ? value.split(',').map(part => part.trim()).filter(Boolean) : [];

/** Map a six-sheet SOP workbook onto the existing FAQ row shape and keep image bytes. */
export async function tryParseSopAsFaq(bytes: Buffer, scope: Readonly<{ sourceId: string; brandId: string; shopId: string | null }>): Promise<{ contentVersion: { kind: 'declared' | 'sha256'; value: string }; parsed: import('./policy.js').ParseResult; rowBindings: readonly { rowId: string; businessEntryId: string; title: string; answerText: string }[]; previews: readonly { bytes: Buffer; mime: `image/${'jpeg' | 'png' | 'gif'}`; rowId: string; sheet: string; row: number; column: number; ordinal: number; productRefIds: readonly string[]; scenarioRefIds: readonly string[]; familySourceId: string }[] } | null> {
  const sop = await parseSopWorkbook(bytes, {
    sourceId: scope.sourceId, brandId: scope.brandId, scope: scope.shopId ?? scope.brandId,
    scopeKind: scope.shopId === null ? 'brand' : 'shop', selectedSheets: SOP_SHEET_NAMES,
  });
  if (sop.issues.some((issue) => issue.code === 'MISSING_SHEET' || issue.code === 'INVALID_XLSX')) return null;
  if (!sop.ok) {
    return { contentVersion: { kind: sop.versionKind, value: sop.version }, parsed: { ok: false, policyVersion: P.version, rows: [], questions: [], issues: sop.issues, excluded: [], expandedBytes: 0, mediaCount: sop.attachments.length }, rowBindings: [], previews: [] };
  }
  const shaped = sop.rows.map((row) => {
    // The operator's code is the identity. A position-derived id renumbered every
    // entry below an inserted row, which silently rewrote published answers.
    const id = row.code;
    const values = [id, row.sheet, row.text, '', '', '分类', '', '启用', '', '', '', '', '', '', 'false'];
    const family = values[10] ?? '';
    return {
      faq: { id, title: row.sheet, body: row.text, state: '启用' as const, values },
      rowId: `sop:${row.sheet}:${row.row}`,
      productRefIds: refIds(values[3] ?? ''),
      scenarioRefIds: refIds(values[4] ?? ''),
      familySourceId: family.includes('/') ? family.split('/')[0] ?? '' : '',
    };
  });
  const rows = shaped.map(item => item.faq);
  const applicability = new Map(shaped.map(item => [item.rowId, item]));
  return {
    contentVersion: { kind: sop.versionKind, value: sop.version },
    parsed: { ok: rows.length > 0, policyVersion: P.version, rows, questions: [], issues: rows.length ? [] : [{ code: 'EMPTY_DATA', sheet: SOP_SHEET_NAMES[0], row: 2, column: 'A', fix: '补一行文字答案' }], excluded: [], expandedBytes: 0, mediaCount: sop.attachments.length },
    rowBindings: shaped.map(item => ({ rowId: item.rowId, businessEntryId: item.faq.id, title: item.faq.title, answerText: item.faq.body })),
    previews: sop.attachments.map((item, index) => {
      const rowId = `sop:${item.sheet}:${item.row}`;
      const refs = applicability.get(rowId);
      return {
        bytes: Buffer.from(item.base64, 'base64'), mime: item.mime, rowId,
        sheet: item.sheet, row: item.row, column: item.column,
        ordinal: sop.attachments.slice(0, index).filter(other => other.sheet === item.sheet && other.row === item.row).length + 1,
        productRefIds: refs?.productRefIds ?? [],
        scenarioRefIds: refs?.scenarioRefIds ?? [],
        familySourceId: refs?.familySourceId ?? '',
      };
    }),
  };
}

/** Parse a six-sheet SOP workbook using row text plus same-row image attachments. */
export async function parseSopWorkbook(bytes: Buffer, context: SopParseContext): Promise<SopParseResult> {
  const rawSha256 = createHash('sha256').update(bytes).digest('hex');
  if (!validContext(context)) return issueResult(context, rawSha256, 'INVALID_CONTEXT');
  try {
    const forExcel = await workbookBytesForExcel(bytes);
    const archive = await inspectArchive(forExcel, { allowExternalHyperlinks: true });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(forExcel as unknown as ExcelJS.Buffer);
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
    const seenCodes = new Set<string>();
    for (const name of selected) {
      const sheet = book.getWorksheet(name)!;
      let codeColumn = 0;
      for (let column = 1; column <= Math.min(sheet.columnCount, P.columns); column++) {
        if (cellText(sheet.getCell(1, column).value) === SOP_ENTRY_CODE_HEADER) { codeColumn = column; break; }
      }
      if (!codeColumn) {
        issue('MISSING_ENTRY_CODE_HEADER', name, 1, 'A', '第一行表头必须包含「条目编码」列，为每行填写稳定编码');
        continue;
      }
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
      const byRow = new Map<number, { values: string[]; code: string }>();
      sheet.eachRow((row, rowNumber) => {
        // Row 1 is the header on every sheet. Treating it as content published a
        // template instruction as if it were an answer.
        if (rowNumber === 1) return;
        const values: string[] = [];
        let code = '';
        for (let column = 1; column <= Math.min(sheet.columnCount, P.columns); column++) {
          const value = cellText(row.getCell(column).value);
          if (value === undefined) {
            issue('NON_TEXT_CELL', name, rowNumber, columnName(column), 'SOP 文字必须是纯文本或富文本；移除公式、日期和数值单元格');
            continue;
          }
          if (column === codeColumn) {
            if (value !== '') code = value.trim();
            continue;
          }
          if (value !== '') {
            normalizedTextChars += value.length;
            if (normalizedTextChars > P.normalizedTextChars) throw new IntakeFailure('NORMALIZED_TEXT_LIMIT');
            if (value.length > P.cellChars) issue('CELL_TEXT_LIMIT', name, rowNumber, columnName(column), '缩短单元格');
            values.push(value);
          }
        }
        if (!code && !values.length) return;
        if (!code) {
          issue('MISSING_ENTRY_CODE', name, rowNumber, columnName(codeColumn), '每行必须填写条目编码；编码是这一行的稳定身份');
          return;
        }
        if (!isEntryCode(code)) {
          issue('ENTRY_CODE_INVALID', name, rowNumber, columnName(codeColumn), '条目编码只能用字母、数字和 . _ : -，且以字母或数字开头，最长 64');
          return;
        }
        byRow.set(rowNumber, { values, code });
      });
      for (const [, entry] of byRow) {
        if (entry.code && seenCodes.has(entry.code)) {
          issue('ENTRY_CODE_DUPLICATE', name, 1, 'A', '条目编码在整册内必须唯一');
        }
        seenCodes.add(entry.code);
      }

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

      for (const [row, entry] of byRow) {
        const attachmentIds = rowAttachments.get(row) ?? [];
        rows.push({ id: `sop:${name}:${row}`, code: entry.code, sheet: name, row, text: entry.values.join('\n'), attachmentIds });
      }
      for (const [row, attachmentIds] of rowAttachments) {
        if (!byRow.has(row)) issue('IMAGE_WITHOUT_TEXT', name, row, 'A', '图片所在行必须补齐文字答案后再导入');
        else if (attachmentIds.length > 0 && !byRow.get(row)!.values.join('\n').trim()) issue('IMAGE_WITHOUT_TEXT', name, row, 'A', '图片所在行必须补齐文字答案后再导入');
      }
    }
    if (versionValues.size > 1) issue('VERSION_CONFLICT', selected[0]!, 1, 'A', '所有工作表的版本字段必须一致');
    const version = versionValues.values().next().value ?? rawSha256;
    if (rows.length === 0) issue('EMPTY_DATA', selected[0]!, 1, 'A', 'SOP 工作簿不能清空已发布内容');
    const ok = issues.length === 0;
    return { ok, policyVersion: SOP_POLICY_VERSION, rawSha256, version, versionKind: versionValues.size ? 'declared' : 'sha256',
      sourceId: context.sourceId, brandId: context.brandId, scope: context.scope,
      rows: ok ? rows : [], attachments: ok ? attachments : [], issues,
      ...archive };
  } catch (error) {
    return issueResult(context, rawSha256, error instanceof IntakeFailure ? error.code : 'INVALID_XLSX');
  }
}
