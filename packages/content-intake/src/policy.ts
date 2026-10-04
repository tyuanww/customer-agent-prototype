/** P1 experiment policy. Budgets bound allocation before ExcelJS loads the archive.
 * These are synthetic probe limits, not production capacity or an OS RSS limit. */
export const INTAKE_POLICY = Object.freeze({
  version: 'p1-synthetic-1', fileBytes: 10 * 1024 * 1024, expandedBytes: 50 * 1024 * 1024,
  zipEntries: 512, rows: 5000, columns: 32, cells: 200_000, cellChars: 32_767,
  sharedStrings: 100_000, mediaCount: 100, mediaBytes: 20 * 1024 * 1024,
  // Count expanded selected-cell text, including repeated shared-string references.
  // Leaves room for duplicate row fields and JSON escapes inside the output budget.
  normalizedTextChars: 3_000_000,
  oneMediaBytes: 5 * 1024 * 1024, timeoutMs: 30_000, outputBytes: 50 * 1024 * 1024,
});

export const FAQ_HEADERS = [
  '条目编号', '标题', '标准话术', '商品编号', '场景编号', '分类', '适用说明', '状态',
  '生效时间', '失效时间', '对应通用条目', '内部说明', '风险提示', '附件说明', '品牌不可覆盖',
] as const;
export const QUESTION_HEADERS = ['条目编号', '问法编号', '问法', '状态'] as const;
export const SOURCE_HEADERS = ['sourceId', 'templateVersion', 'brandId', 'scope', 'domain'] as const;
export const TEMPLATE_VERSION = 'faq-p1.1';
export type ParseContext = Readonly<{
  sourceId: string; brandId: string; scope: string; domain: 'product' | 'campaign' | 'presale' | 'aftersale';
  sheet: 'FAQ'; templateVersion: typeof TEMPLATE_VERSION;
}>;
export type Issue = Readonly<{ code: string; sheet: string; row: number; column: string; fix: string }>;
export type FaqRow = Readonly<{
  id: string; title: string; body: string; state: '启用' | '停用'; values: readonly string[];
}>;
export type ParseResult = Readonly<{
  ok: boolean; policyVersion: string; rows: readonly FaqRow[]; issues: readonly Issue[];
  questions: readonly Readonly<{ entryId: string; id: string; text: string; state: string }>[];
  excluded: readonly Readonly<{ sheet: string; rows: number; images: number }>[];
  expandedBytes: number; mediaCount: number;
}>;

export class IntakeFailure extends Error {
  constructor(readonly code: string) { super(code); }
}
export function failedParse(code: string): ParseResult {
  return { ok: false, policyVersion: INTAKE_POLICY.version, rows: [], questions: [],
    issues: [{ code, sheet: '', row: 0, column: '', fix: '检查文件或重新导出标准模板后重试' }],
    excluded: [], expandedBytes: 0, mediaCount: 0 };
}

/** Process stdout is an untrusted boundary too: validate shape and whole-batch semantics
 * before returning it to a caller. No partial rows may escape with blocking issues. */
export function isParseResult(value: unknown): value is ParseResult {
  const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const text = (v: unknown): v is string => typeof v === 'string' && v.length <= INTAKE_POLICY.cellChars;
  const count = (v: unknown, max: number): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
  if (!object(value) || typeof value.ok !== 'boolean' || value.policyVersion !== INTAKE_POLICY.version
    || !Array.isArray(value.rows) || !Array.isArray(value.questions) || !Array.isArray(value.issues) || !Array.isArray(value.excluded)
    || value.rows.length + value.questions.length > INTAKE_POLICY.rows || value.issues.length > INTAKE_POLICY.cells
    || value.excluded.length > INTAKE_POLICY.zipEntries || !count(value.expandedBytes, INTAKE_POLICY.expandedBytes)
    || !count(value.mediaCount, INTAKE_POLICY.mediaCount) || value.ok !== (value.issues.length === 0)
    || (!value.ok && (value.rows.length !== 0 || value.questions.length !== 0)) || (value.ok && value.rows.length === 0)) return false;
  return value.rows.every((r) => object(r) && text(r.id) && text(r.title) && text(r.body) && (r.state === '启用' || r.state === '停用')
      && Array.isArray(r.values) && r.values.length === FAQ_HEADERS.length && r.values.every(text))
    && value.questions.every((q) => object(q) && text(q.entryId) && text(q.id) && text(q.text) && (q.state === '启用' || q.state === '停用'))
    && value.issues.every((i) => object(i) && text(i.code) && text(i.sheet) && text(i.column) && text(i.fix) && count(i.row, INTAKE_POLICY.rows + 1))
    && value.excluded.every((s) => object(s) && text(s.sheet) && count(s.rows, INTAKE_POLICY.rows + 1) && count(s.images, INTAKE_POLICY.cells));
}
