import ExcelJS from 'exceljs';
import { inspectArchive } from './archive.js';
import { FAQ_HEADERS, QUESTION_HEADERS, SOURCE_HEADERS, TEMPLATE_VERSION, INTAKE_POLICY as P,
  IntakeFailure, failedParse, type ParseContext, type ParseResult, type Issue, type FaqRow } from './policy.js';
export { FAQ_HEADERS, QUESTION_HEADERS, SOURCE_HEADERS, TEMPLATE_VERSION, INTAKE_POLICY, type ParseContext,
  isParseResult, type ParseResult, type Issue, type FaqRow } from './policy.js';

const stableId = (value: string) => /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/u.test(value) && !value.startsWith('EXAMPLE_');
function validTime(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:Z|([+-])(\d{2}):(\d{2}))$/u.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second, , offsetHour = '0', offsetMinute = '0'] = parts;
  // Date.parse normalizes impossible calendar days; compare the local date separately.
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() + 1 === Number(month)
    && date.getUTCDate() === Number(day) && Number(hour) < 24 && Number(minute) < 60
    && Number(second) < 60 && Number(offsetHour) < 24 && Number(offsetMinute) < 60;
}

/** Caller supplies registered source facts; workbook strings can never grant a scope.
 * P1 only validates the standard FAQ shape. Vocabulary, version allocation and publication
 * are server decisions. A blocked workbook returns no partial usable rows. */
export async function parseWorkbook(bytes: Buffer, context: ParseContext): Promise<ParseResult> {
  try {
    if (!context || context.sheet !== 'FAQ' || context.templateVersion !== TEMPLATE_VERSION
      || !['product', 'campaign', 'presale', 'aftersale'].includes(context.domain)
      || ![context.sourceId, context.brandId, context.scope].every((s) => typeof s === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/u.test(s))) return failedParse('INVALID_CONTEXT');
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
    const rows: FaqRow[] = [], ids = new Set<string>();
    book.getWorksheet(context.sheet)?.eachRow((row, number) => {
      if (number === 1) return;
      const values = FAQ_HEADERS.map((_, index) => text(row.getCell(index + 1)));
      const [id = '', title = '', body = ''] = values;
      for (const [value, column] of [[id, 'A'], [title, 'B'], [body, 'C']]) {
        if (!value?.trim()) issue('REQUIRED', context.sheet, number, column!, '补齐必填内容后整批重新上传');
      }
      if (id && !stableId(id)) issue('INVALID_ID', context.sheet, number, 'A', '写回合法稳定编号，示例编号不能入库');
      if (ids.has(id)) issue('DUPLICATE_ID', context.sheet, number, 'A', '每条内容只保留一行');
      ids.add(id);
      const state = values[7];
      if (state !== '启用' && state !== '停用') issue('INVALID_STATE', context.sheet, number, 'H', '明确填写启用或停用');
      for (const index of [8, 9]) {
        const value = values[index]!;
        if (value && !validTime(value)) issue('INVALID_TIME', context.sheet, number, index === 8 ? 'I' : 'J', '填写真实日历日期与带时区的 ISO 时间');
      }
      if (context.domain === 'campaign' && !values[9]) issue('EXPIRY_REQUIRED', context.sheet, number, 'J', '活动必须填写失效时间');
      if (values[8] && values[9] && Date.parse(values[8]) >= Date.parse(values[9])) issue('INVALID_WINDOW', context.sheet, number, 'J', '失效时间须晚于生效时间');
      if (![ '', 'true', 'false'].includes(values[14]!) || (values[14] === 'true' && context.scope !== 'brand')) issue('BRAND_OVERRIDE', context.sheet, number, 'O', '只有品牌通用来源可设置不可覆盖');
      if ([title, body].some((value) => value.includes('过敏')) && (!body.includes('停手') || !body.includes('确认'))) issue('ALLERGY_BODY', context.sheet, number, 'C', '正文同时包含停手与确认；标题不代替正文');
      if (values[13]) issue('UNRESOLVED_MEDIA', context.sheet, number, 'N', '明确必要文字与媒体；P1 不认定附件已导入');
      rows.push({ id, title, body, state: state === '停用' ? '停用' : '启用', values });
    });
    const questionIds = new Set<string>();
    const questions: { entryId: string; id: string; text: string; state: string }[] = [];
    book.getWorksheet('相似问法')?.eachRow((row, number) => {
      if (number === 1) return;
      const values = QUESTION_HEADERS.map((_, index) => text(row.getCell(index + 1)));
      if (!ids.has(values[0]!) || !stableId(values[1]!) || !values[2]?.trim() || !['启用', '停用'].includes(values[3]!)) issue('INVALID_QUESTION', '相似问法', number, 'A', '核对条目引用、合法非示例问法编号、问法及状态');
      if (questionIds.has(values[1]!)) issue('DUPLICATE_QUESTION', '相似问法', number, 'B', '问法编号必须唯一');
      questionIds.add(values[1]!);
      questions.push({ entryId: values[0]!, id: values[1]!, text: values[2]!, state: values[3]! });
    });
    if (rows.length === 0) issue('EMPTY_DATA', context.sheet, 2, 'A', '空表不能清库；保留原发布版本');
    if (rows.length + questionIds.size > P.rows) issue('ROW_LIMIT', context.sheet, P.rows + 1, 'A', '拆分登记来源，重新生成审核材料');
    return { ok: issues.length === 0, policyVersion: P.version, rows: issues.length ? [] : rows, questions: issues.length ? [] : questions, issues,
      excluded: book.worksheets.filter((s) => !selected.includes(s.name)).map((s) => ({ sheet: s.name, rows: s.actualRowCount, images: s.getImages().length + (s.getBackgroundImageId() === undefined ? 0 : 1) })), ...archive };
  } catch (error) {
    return failedParse(error instanceof IntakeFailure ? error.code : 'INVALID_XLSX');
  }
}

/** Produces a real workbook, with examples kept outside selected business sheets. */
export async function createTemplate(context: ParseContext, rows: readonly (readonly string[])[] = []): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.created = new Date('2026-10-04T00:00:00Z'); book.modified = book.created;
  book.addWorksheet('说明').addRow(['P1 合成模板；来源范围由服务端登记；任何缺行都不代表下架。']);
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
