import { INTAKE_POLICY as P, type FaqRow, type ParseContext, type ParseResult } from './policy.js';

type RuleContext = Pick<ParseContext, 'sourceId' | 'scopeKind' | 'domain'>;
/** Adapters retain source coordinates. Index is zero-based within FAQ/question fields. */
export type RowLocation = { sheet: string; row: number; column(index: number): string };
type AddIssue = (code: string, sheet: string, row: number, column: string, fix: string) => void;

const stableId = (value: string) => /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/u.test(value) && !value.startsWith('EXAMPLE_');
type FamilyReference = { familySourceId: string; familyBusinessEntryId: string }
  | { familySourceId: null; familyBusinessEntryId: null };
/** K accepts exactly sourceId/businessEntryId, without trimming or alternate separators.
 * Empty text clears both fields. Null means invalid syntax or local source scope;
 * target existence, brand and overlap are checked by the publication owner. */
export function parseFamilyReference(value: string, context: Pick<ParseContext, 'sourceId' | 'scopeKind'>): FamilyReference | null {
  if (context.scopeKind !== 'brand' && context.scopeKind !== 'shop') return null;
  if (value === '') return { familySourceId: null, familyBusinessEntryId: null };
  const parts = value.split('/');
  if (context.scopeKind !== 'shop' || parts.length !== 2 || !parts.every(stableId) || parts[0] === context.sourceId) return null;
  return { familySourceId: parts[0]!, familyBusinessEntryId: parts[1]! };
}
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

/** Shared row-set rules; format adapters own decoding, budgets, headers and provenance.
 * Call each FAQ before its questions. The format adapter must suppress all returned
 * rows/questions when any issue was emitted, including its own format issues. */
export function createFaqTableValidator(context: RuleContext, issue: AddIssue) {
  const rows: FaqRow[] = [], ids = new Set<string>(), questionIds = new Set<string>();
  const questions: ParseResult['questions'][number][] = [];
  return {
    faq(values: readonly string[], location: RowLocation) {
      const [id = '', title = '', body = ''] = values;
      for (const [index, value] of [id, title, body].entries()) {
        if (!value.trim()) issue('REQUIRED', location.sheet, location.row, location.column(index), '补齐必填内容后整批重新上传');
      }
      if (id && !stableId(id)) issue('INVALID_ID', location.sheet, location.row, location.column(0), '写回合法稳定编号，示例编号不能入库');
      if (ids.has(id)) issue('DUPLICATE_ID', location.sheet, location.row, location.column(0), '每条内容只保留一行');
      ids.add(id);
      const state = values[7];
      if (state !== '启用' && state !== '停用') issue('INVALID_STATE', location.sheet, location.row, location.column(7), '明确填写启用或停用');
      for (const index of [8, 9]) {
        const value = values[index]!;
        if (value && !validTime(value)) issue('INVALID_TIME', location.sheet, location.row, location.column(index), '填写真实日历日期与带时区的 ISO 时间');
      }
      if (context.domain === 'campaign' && !values[9]) issue('EXPIRY_REQUIRED', location.sheet, location.row, location.column(9), '活动必须填写失效时间');
      if (values[8] && values[9] && Date.parse(values[8]) >= Date.parse(values[9])) issue('INVALID_WINDOW', location.sheet, location.row, location.column(9), '失效时间须晚于生效时间');
      if (!parseFamilyReference(values[10]!, context)) issue('INVALID_FAMILY', location.sheet, location.row, location.column(10), '仅店铺来源可填写其他来源的 sourceId/businessEntryId；两段须为合法非示例稳定编号，留空取消关联');
      if (![ '', 'true', 'false'].includes(values[14]!) || (values[14] === 'true' && context.scopeKind !== 'brand')) issue('BRAND_OVERRIDE', location.sheet, location.row, location.column(14), '只有品牌通用来源可设置不可覆盖');
      if ([title, body].some((value) => value.includes('过敏')) && (!body.includes('停手') || !body.includes('确认'))) issue('ALLERGY_BODY', location.sheet, location.row, location.column(2), '正文同时包含停手与确认；标题不代替正文');
      if (values[13]) issue('UNRESOLVED_MEDIA', location.sheet, location.row, location.column(13), '明确必要文字与媒体；P1 不认定附件已导入');
      rows.push({ id, title, body, state: state === '停用' ? '停用' : '启用', values });
    },
    question(values: readonly string[], location: RowLocation) {
      if (!ids.has(values[0]!) || !stableId(values[1]!) || !values[2]?.trim() || !['启用', '停用'].includes(values[3]!)) issue('INVALID_QUESTION', location.sheet, location.row, location.column(0), '核对条目引用、合法非示例问法编号、问法及状态');
      if (questionIds.has(values[1]!)) issue('DUPLICATE_QUESTION', location.sheet, location.row, location.column(1), '问法编号必须唯一');
      questionIds.add(values[1]!);
      questions.push({ entryId: values[0]!, id: values[1]!, text: values[2]!, state: values[3]! });
    },
    finish(location: RowLocation): Pick<ParseResult, 'rows' | 'questions'> {
      if (rows.length === 0) issue('EMPTY_DATA', location.sheet, 2, location.column(0), '空表不能清库；保留原发布版本');
      if (rows.length + questionIds.size > P.rows) issue('ROW_LIMIT', location.sheet, P.rows + 1, location.column(0), '拆分登记来源，重新生成审核材料');
      return { rows, questions };
    },
  };
}

/** XLSX and future format adapters share the same registered-source constraints. */
export function validRegisteredContext(context: Pick<ParseContext, 'sourceId' | 'brandId' | 'scope' | 'scopeKind' | 'domain'>): boolean {
  return !!context && ['brand', 'shop'].includes(context.scopeKind)
    && (context.scopeKind !== 'brand' || context.scope === 'brand')
    && ['product', 'campaign', 'presale', 'aftersale'].includes(context.domain)
    && [context.sourceId, context.brandId, context.scope].every((s) => typeof s === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/u.test(s));
}
