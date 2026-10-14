import ExcelJS from 'exceljs';
import { inspectArchive } from './archive.js';
import { createFaqTableValidator, validRegisteredContext } from './faq-rules.js';
export { parseCsv, createCsvTemplate, CSV_TEMPLATE_VERSION, CSV_POLICY_VERSION, CSV_MAPPING_VERSION, CSV_HEADERS, CSV_STRUCTURE_SHA256, type CsvContext, type CsvParseResult } from './csv.js';
export { parseFamilyReference } from './faq-rules.js';
export { parseSopWorkbook, tryParseSopAsFaq, createSyntheticSopWorkbook, repairEmptySharedStringMarkers, SOP_POLICY_VERSION, SOP_SHEET_NAMES,
  type SopAttachment, type SopParseContext, type SopParseResult, type SopRow } from './sop.js';
import { FAQ_HEADERS, QUESTION_HEADERS, SOURCE_HEADERS, TEMPLATE_VERSION, INTAKE_POLICY as P,
  IntakeFailure, failedParse, type ParseContext, type ParseResult, type Issue } from './policy.js';
export { FAQ_HEADERS, QUESTION_HEADERS, SOURCE_HEADERS, TEMPLATE_VERSION, INTAKE_POLICY, type ParseContext,
  isParseResult, failedParse, type IntakeParseContext, type ParseResult, type Issue, type FaqRow } from './policy.js';

/** Caller supplies registered source facts; workbook strings can never grant a scope.
 * P1 only validates the standard FAQ shape. Vocabulary, version allocation and publication
 * are server decisions. A blocked workbook returns no partial usable rows. */
export async function parseWorkbook(bytes: Buffer, context: ParseContext): Promise<ParseResult> {
  try {
    if (!context || context.sheet !== 'FAQ' || context.templateVersion !== TEMPLATE_VERSION
      || !validRegisteredContext(context)) return failedParse('INVALID_CONTEXT');
    const { resourceSheets, ...archive } = await inspectArchive(bytes);
    const selected = ['来源', context.sheet, '相似问法'];
    const unsupported = resourceSheets.filter((name) => selected.includes(name));
    if (unsupported.length) return { ...failedParse('UNRESOLVED_MEDIA'), ...archive,
      issues: unsupported.map((sheet) => ({ code: 'UNRESOLVED_MEDIA', sheet, row: 1, column: 'A', fix: '补齐必要文字；媒体正式接入前不能静默排除' })) };
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const issues: Issue[] = [];
    let normalizedTextChars = 0;
    const issue = (code: string, sheet: string, row: number, column: string, fix: string) => {
      issues.push({ code, sheet, row, column, fix });
    };
    const text = (cell: ExcelJS.Cell): string => {
      if (cell.value === null) return '';
      if (typeof cell.value === 'string') {
        normalizedTextChars += cell.value.length;
        if (normalizedTextChars > P.normalizedTextChars) throw new IntakeFailure('NORMALIZED_TEXT_LIMIT');
        if (cell.value.length > P.cellChars) issue('CELL_TEXT_LIMIT', cell.worksheet.name, Number(cell.row), cell.address.replace(/[0-9]+$/u, ''), '缩短单元格');
        return cell.value;
      }
      // Fixed templates deliberately use text cells; formula result caches are untrusted.
      issue('NON_TEXT_CELL', cell.worksheet.name, Number(cell.row), cell.address.replace(/[0-9]+$/u, ''), '改成纯文本；不要使用公式、日期数值或链接对象');
      return '';
    };
    for (const [name, headers] of [['来源', SOURCE_HEADERS], [context.sheet, FAQ_HEADERS], ['相似问法', QUESTION_HEADERS]] as const) {
      const sheet = book.getWorksheet(name);
      if (!sheet) { issue('MISSING_SHEET', name, 1, 'A', '使用完整标准模板'); continue; }
      if (sheet.model.merges?.length) issue('MERGED_CELLS', name, 1, 'A', '取消数据页合并单元格');
      if (resourceSheets.includes(name) || sheet.getImages().length || sheet.getBackgroundImageId() !== undefined) issue('UNRESOLVED_MEDIA', name, 1, 'A', '补齐必要文字；媒体正式接入前不能静默排除');
      if (sheet.columnCount > headers.length) issue('UNKNOWN_COLUMN', name, 1, 'A', '删除规范表之外的列');
      headers.forEach((header, index) => {
        if (text(sheet.getCell(1, index + 1)) !== header) issue('HEADER_MISMATCH', name, 1, sheet.getCell(1, index + 1).address.replace('1', ''), `恢复表头：${header}`);
      });
    }
    const source = book.getWorksheet('来源');
    const expected = [context.sourceId, context.templateVersion, context.brandId, context.scope, context.domain];
    if (context.templateVersion !== TEMPLATE_VERSION || context.sheet !== 'FAQ') issue('TEMPLATE_VERSION', '来源', 2, 'B', '使用支持的模板版本');
    expected.forEach((value, index) => {
      if (source && text(source.getCell(2, index + 1)) !== value) issue('SOURCE_MISMATCH', '来源', 2, source.getCell(2, index + 1).address.replace('2', ''), '下载此登记来源的模板；文件不能改变授权范围');
    });
    if (source && source.rowCount !== 2) issue('SOURCE_SHAPE', '来源', 3, 'A', '每文件仅一个登记来源');
    const validator = createFaqTableValidator(context, issue);
    const column = (index: number) => String.fromCharCode(65 + index);
    book.getWorksheet(context.sheet)?.eachRow((row, number) => {
      if (number === 1) return;
      validator.faq(FAQ_HEADERS.map((_, index) => text(row.getCell(index + 1))), { sheet: context.sheet, row: number, column });
    });
    book.getWorksheet('相似问法')?.eachRow((row, number) => {
      if (number === 1) return;
      validator.question(QUESTION_HEADERS.map((_, index) => text(row.getCell(index + 1))), { sheet: '相似问法', row: number, column });
    });
    const { rows, questions } = validator.finish({ sheet: context.sheet, row: 2, column });
    return { ok: issues.length === 0, policyVersion: P.version, rows: issues.length ? [] : rows, questions: issues.length ? [] : questions, issues,
      excluded: book.worksheets.filter((s) => !selected.includes(s.name)).map((s) => ({ sheet: s.name, rows: s.actualRowCount, images: s.getImages().length + (s.getBackgroundImageId() === undefined ? 0 : 1) })), ...archive };
  } catch (error) {
    return failedParse(error instanceof IntakeFailure ? error.code : 'INVALID_XLSX');
  }
}

/** Produces a real workbook, with examples kept outside selected business sheets. */
export async function createTemplate(context: Omit<ParseContext, 'scopeKind'>, rows: readonly (readonly string[])[] = []): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.created = new Date('2026-10-04T00:00:00Z'); book.modified = book.created;
  const instructions = book.addWorksheet('说明');
  instructions.addRow(['P1 合成模板；来源范围由服务端登记；任何缺行都不代表下架。']);
  instructions.addRow(['K列“对应通用条目”：仅店铺来源可填写 sourceId/businessEntryId，用一个 / 分隔其他通用来源编号和条目编号；品牌来源须留空。两段均以英文字母或数字开头，最多128字符，仅含英文字母、数字、_、.、:、-，不得使用 EXAMPLE_ 示例编号或空格。留空表示无关联（已有条目则取消关联）；缺行仍保留原条目。目标是否存在及发布冲突由服务端核验。']);
  const source = book.addWorksheet('来源'); source.addRow([...SOURCE_HEADERS]);
  source.addRow([context.sourceId, context.templateVersion, context.brandId, context.scope, context.domain]);
  const faq = book.addWorksheet('FAQ'); faq.addRow([...FAQ_HEADERS]);
  for (const row of rows) faq.addRow([...row]);
  book.addWorksheet('相似问法').addRow([...QUESTION_HEADERS]);
  book.addWorksheet('虚构示例').addRow(['EXAMPLE_01', '此页不导入']);
  return Buffer.from(await book.xlsx.writeBuffer());
}

/** Only coordinates and recovery instructions are exported; raw untrusted text is omitted. */
export async function writeIssueReport(issues: readonly Issue[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('校验问题');
  sheet.addRow(['工作表', '行', '列', '错误码', '修正建议']);
  issues.forEach((i) => sheet.addRow([i.sheet, String(i.row), i.column, i.code, i.fix]));
  return Buffer.from(await book.xlsx.writeBuffer());
}
