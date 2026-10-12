import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { createFaqTableValidator, validRegisteredContext } from './faq-rules.js';
import { FAQ_HEADERS, SOURCE_HEADERS, INTAKE_POLICY as P, IntakeFailure,
  type Issue, type ParseResult } from './policy.js';

export { CSV_TEMPLATE_VERSION, CSV_POLICY_VERSION, CSV_MAPPING_VERSION, CSV_HEADERS, CSV_STRUCTURE_SHA256,
  type CsvContext } from './policy.js';
import { CSV_TEMPLATE_VERSION, CSV_POLICY_VERSION, CSV_MAPPING_VERSION, CSV_HEADERS, CSV_STRUCTURE_SHA256,
  type CsvContext } from './policy.js';
export type CsvParseResult = ParseResult & Readonly<{
  policyVersion: typeof CSV_POLICY_VERSION; rawSha256: string; mime: 'text/csv';
  templateVersion: typeof CSV_TEMPLATE_VERSION; mappingVersion: typeof CSV_MAPPING_VERSION;
  structureSha256: string; selectedSheets: readonly ['CSV'];
}>;

const column = (index: number) => String.fromCharCode(65 + index);
const faqColumn = (index: number) => column(index + SOURCE_HEADERS.length);
const questionColumn = (index: number) => column([5, 20, 21, 22][index]!);
const sourceFields = (context: CsvContext) => [context.sourceId, context.templateVersion, context.brandId, context.scope, context.domain];

class CsvFieldFailure extends IntakeFailure {
  constructor(code: string, readonly row: number, readonly column: string) { super(code); }
}

/** Decode original CSV bytes inside the bounded parser process, never a Main/HTTP loop.
 * Source strings cannot grant rights. Hashes bind the original bytes, including BOM.
 * Rows refer to logical CSV records (header is 1), not physical lines inside quoted text. */
export function parseCsv(bytes: Buffer, context: CsvContext): CsvParseResult {
  const provenance = {
    policyVersion: CSV_POLICY_VERSION, rawSha256: createHash('sha256').update(bytes).digest('hex'),
    mime: 'text/csv', templateVersion: CSV_TEMPLATE_VERSION, mappingVersion: CSV_MAPPING_VERSION,
    structureSha256: CSV_STRUCTURE_SHA256, selectedSheets: ['CSV'],
    excluded: [], expandedBytes: 0, mediaCount: 0,
  } as const;
  const issues: Issue[] = [];
  const issue = (code: string, sheet: string, row: number, col: string, fix: string) => issues.push({ code, sheet, row, column: col, fix });
  let logicalRecord = 0;
  try {
    if (!context || context.templateVersion !== CSV_TEMPLATE_VERSION || !validRegisteredContext(context)) throw new IntakeFailure('INVALID_CONTEXT');
    if (bytes.length > P.fileBytes) throw new IntakeFailure('FILE_TOO_LARGE');
    if (bytes.subarray(0, 2).equals(Buffer.from('PK'))) throw new IntakeFailure('INVALID_CSV');
    let decoded: string;
    try { decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new IntakeFailure('INVALID_UTF8'); }
    if (decoded.includes('\0')) throw new IntakeFailure('NUL_TEXT');
    const expected = sourceFields(context);
    const validator = createFaqTableValidator(context, issue);
    const groups = new Map<string, { values: readonly string[]; hasQuestions: boolean }>();
    let normalizedTextChars = 0, cells = 0;
    // on_record validates as records arrive and returns null so the synchronous API
    // does not retain a second full decoded table. The original input is capped first.
    parse(decoded, { bom: true, columns: false, skip_empty_lines: false,
      // csv-parse invokes cast before pushing each field into its record array.
      // max_record_size alone does not bound millions of empty comma fields.
      cast(value: string, info) {
        const row = logicalRecord + 1;
        if (row > P.rows + 1) throw new CsvFieldFailure('ROW_LIMIT', row, 'A');
        if (typeof info.column !== 'number' || info.column >= CSV_HEADERS.length) throw new CsvFieldFailure('COLUMN_COUNT', row, 'X');
        cells++;
        if (cells > P.cells) throw new CsvFieldFailure('CELL_LIMIT', row, column(info.column));
        normalizedTextChars += value.length;
        if (normalizedTextChars > P.normalizedTextChars) throw new CsvFieldFailure('NORMALIZED_TEXT_LIMIT', row, column(info.column));
        if (value.length > P.cellChars) issue('CELL_TEXT_LIMIT', 'CSV', row, column(info.column), '缩短单元格');
        return value; // Retain text literally, without the library's built-in scalar casts.
      },
      relax_column_count: false, relax_quotes: false, record_delimiter: ['\r\n', '\n', '\r'],
      max_record_size: P.cellChars * CSV_HEADERS.length,
      on_record(record: string[]) {
        logicalRecord++;
        if (logicalRecord > P.rows + 1) throw new IntakeFailure('ROW_LIMIT');
        if (record.length !== CSV_HEADERS.length) throw new IntakeFailure('COLUMN_COUNT');
        if (logicalRecord === 1) {
          CSV_HEADERS.forEach((header, index) => {
            if (record[index] !== header) issue('HEADER_MISMATCH', 'CSV', 1, column(index), `恢复表头：${header}`);
          });
          return null;
        }
        expected.forEach((value, index) => {
          if (record[index] !== value) issue('SOURCE_MISMATCH', 'CSV', logicalRecord, column(index), '下载此登记来源的模板；文件不能改变授权范围');
        });
        const values = record.slice(5, 20), id = values[0]!;
        const hasQuestions = record.slice(20).some((value) => value !== '');
        const previous = groups.get(id);
        if (!previous) {
          groups.set(id, { values, hasQuestions });
          validator.faq(values, { sheet: 'CSV', row: logicalRecord, column: faqColumn });
        } else {
          if (!values.every((value, index) => value === previous.values[index])) issue('CONFLICTING_FAQ', 'CSV', logicalRecord, 'F', '同一条目重复填写的十五个 FAQ 字段须完全一致');
          if (!hasQuestions || !previous.hasQuestions) issue('DUPLICATE_FAQ', 'CSV', logicalRecord, 'F', '无问法条目只保留一行；有问法时每行填写一条完整问法');
        }
        if (hasQuestions) validator.question([id, ...record.slice(20)], { sheet: 'CSV', row: logicalRecord, column: questionColumn });
        return null;
      },
    });
    const { rows, questions } = validator.finish({ sheet: 'CSV', row: 2, column: faqColumn });
    return { ...provenance, ok: issues.length === 0, rows: issues.length ? [] : rows, questions: issues.length ? [] : questions, issues };
  } catch (error) {
    const code = error instanceof IntakeFailure ? error.code
      : error && typeof error === 'object' && 'code' in error && error.code === 'CSV_RECORD_INCONSISTENT_FIELDS_LENGTH' ? 'COLUMN_COUNT'
      : error && typeof error === 'object' && 'code' in error && error.code === 'CSV_MAX_RECORD_SIZE' ? 'RECORD_SIZE_LIMIT' : 'INVALID_CSV';
    return { ...provenance, ok: false, rows: [], questions: [], issues: [{ code, sheet: 'CSV',
      row: error instanceof CsvFieldFailure ? error.row : logicalRecord + (error instanceof IntakeFailure ? 0 : 1),
      column: error instanceof CsvFieldFailure ? error.column : 'A', fix: '检查文件或重新导出标准 CSV 模板后重试' }] };
  }
}

/** Standard source-bound template. A repeated FAQ row represents one additional question.
 * Every cell is quoted; values are preserved, never converted to formulas or normalized. */
export function createCsvTemplate(context: CsvContext, records: readonly Readonly<{
  faq: readonly string[]; question?: readonly [id: string, text: string, state: string];
}>[] = []): Buffer {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const rows: readonly (readonly string[])[] = [CSV_HEADERS, ...records.map(({ faq, question }) => {
    if (faq.length !== FAQ_HEADERS.length) throw new IntakeFailure('COLUMN_COUNT');
    return [...sourceFields(context), ...faq, ...(question ?? ['', '', ''])];
  })];
  return Buffer.from(`${rows.map((row) => row.map(quote).join(',')).join('\r\n')}\r\n`, 'utf8');
}
