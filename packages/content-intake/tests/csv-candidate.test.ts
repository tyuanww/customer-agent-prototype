import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseWorkbook, createTemplate, writeIssueReport } from '@customer-agent/content-intake';
import { CSV_HEADERS, CSV_STRUCTURE_SHA256, CSV_TEMPLATE_VERSION, parseCsvCandidate, createCsvTemplate, type CsvContext } from '../experiments/csv/candidate.js';
import { INTAKE_POLICY as P, isParseResult } from '../src/policy.js';
import { context as workbookContext, sampleRows } from './fixtures.js';

const context: CsvContext = { ...workbookContext, templateVersion: CSV_TEMPLATE_VERSION };
const faq = () => [...sampleRows[0]!];
const records = () => sampleRows.map((row) => ({ faq: [...row] }));
const codes = (bytes: Buffer, selected = context) => parseCsvCandidate(bytes, selected).issues.map((issue) => issue.code);
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('isolated DRAFT CSV candidate', () => {
  it('consumes the checked-in synthetic CSV and keeps an independent format/provenance boundary', async () => {
    const bytes = await readFile(new URL('../experiments/csv/synthetic-template.csv', import.meta.url));
    const parsed = parseCsvCandidate(bytes, context);
    expect(parsed).toMatchObject({ ok: true, policyVersion: 'intake-csv-v1', templateVersion: 'faq-csv-v1',
      mappingVersion: 'faq-csv-columns-v1', mime: 'text/csv', rawSha256: hash(bytes), structureSha256: hash(Buffer.from(JSON.stringify(CSV_HEADERS))),
      selectedSheets: ['CSV'], runtimeActivated: false, candidateStatus: 'DRAFT' });
    expect(parsed.rows).toHaveLength(2); expect(parsed.questions).toHaveLength(2);
    expect(CSV_STRUCTURE_SHA256).toBe(parsed.structureSha256);
    expect(isParseResult(parsed)).toBe(false);
    expect(await parseWorkbook(bytes, workbookContext)).toMatchObject({ ok: false, rows: [], questions: [] });
  });
  it('roundtrips comma, doubled quotes, CRLF and literal formula-looking business text exactly', () => {
    const row = faq(); row[2] = '=合成,"文本"\r\n下一行\n第三行'; row[1] = ' 合成标题 ';
    const parsed = parseCsvCandidate(createCsvTemplate(context, [{ faq: row }]), context);
    expect(parsed.ok).toBe(true); expect(parsed.rows[0]!.values).toEqual(row);
  });
  it('accepts a UTF-8 BOM without making two different original objects share a raw hash', () => {
    const bytes = createCsvTemplate(context, records());
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]);
    const a = parseCsvCandidate(bytes, context), b = parseCsvCandidate(bom, context);
    expect(a.ok).toBe(true); expect(b.ok).toBe(true); expect(a.rows).toEqual(b.rows);
    expect(a.rawSha256).toBe(hash(bytes)); expect(b.rawSha256).toBe(hash(bom)); expect(a.rawSha256).not.toBe(b.rawSha256);
  });
  it('accepts LF record delimiters and a final record without a trailing newline', () => {
    const row = faq(); row[2] = '纯合成正文';
    const bytes = createCsvTemplate(context, [{ faq: row }]);
    expect(parseCsvCandidate(Buffer.from(bytes.toString().replaceAll('\r\n', '\n').trimEnd()), context).ok).toBe(true);
  });
  it.each(['\r\n', '\n', '\r'])('accepts %j record separators while preserving quoted bare CR', (delimiter) => {
    const row = faq(); row[2] = '合成第一行\r第二行';
    const text = createCsvTemplate(context, [{ faq: row }]).toString().replaceAll('\r\n', delimiter);
    const parsed = parseCsvCandidate(Buffer.from(text), context);
    expect(parsed.ok).toBe(true); expect(parsed.rows[0]!.body).toBe(row[2]);
  });
  it('matches XLSX business rows and question identity/state while collapsing only exact duplicate FAQ fields', async () => {
    const row = faq(); row[7] = '停用';
    const csv = parseCsvCandidate(createCsvTemplate(context, [
      { faq: row, question: ['q-one', '合成问法一', '启用'] }, { faq: row, question: ['q-two', '合成问法二', '停用'] },
    ]), context);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await createTemplate(workbookContext, [row]) as unknown as ExcelJS.Buffer);
    book.getWorksheet('相似问法')!.addRow([row[0], 'q-one', '合成问法一', '启用']);
    book.getWorksheet('相似问法')!.addRow([row[0], 'q-two', '合成问法二', '停用']);
    const xlsx = await parseWorkbook(Buffer.from(await book.xlsx.writeBuffer()), workbookContext);
    expect(csv.ok).toBe(true); expect(xlsx.ok).toBe(true);
    expect(csv.rows).toEqual(xlsx.rows); expect(csv.questions).toEqual(xlsx.questions);
    expect(csv.rows).toHaveLength(1); expect(csv.questions[1]!.state).toBe('停用');
  });
  it('reports actual CSV columns and logical records after quoted multiline text; report reopens without source text', async () => {
    const valid = faq(), invalid = faq(); valid[2] = '私有合成标记\n第二行\n第三行'; invalid[0] = 'faq-next'; invalid[2] = '';
    const parsed = parseCsvCandidate(createCsvTemplate(context, [{ faq: valid }, { faq: invalid }]), context);
    expect(parsed.issues).toEqual([{ code: 'REQUIRED', sheet: 'CSV', row: 3, column: 'H', fix: '补齐必填内容后整批重新上传' }]);
    expect(parsed.rows).toEqual([]); expect(parsed.questions).toEqual([]);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await writeIssueReport(parsed.issues) as unknown as ExcelJS.Buffer);
    expect(book.getWorksheet('校验问题')!.getRow(2).values).toEqual([undefined, 'CSV', '3', 'H', 'REQUIRED', parsed.issues[0]!.fix]);
    expect(JSON.stringify(book.model)).not.toContain('私有合成标记');
  });
  it.each([
    ['conflicting repeated FAQ', () => { const a = faq(), b = faq(); b[2] += '不同'; return [{ faq: a, question: ['q-a', '问法一', '启用'] as const }, { faq: b, question: ['q-b', '问法二', '启用'] as const }]; }, 'CONFLICTING_FAQ'],
    ['repeated FAQ with no question', () => [{ faq: faq() }, { faq: faq() }], 'DUPLICATE_FAQ'],
    ['empty then nonempty question', () => [{ faq: faq() }, { faq: faq(), question: ['q-a', '问法一', '启用'] as const }], 'DUPLICATE_FAQ'],
    ['nonempty then empty question', () => [{ faq: faq(), question: ['q-a', '问法一', '启用'] as const }, { faq: faq() }], 'DUPLICATE_FAQ'],
    ['partial question', () => [{ faq: faq(), question: ['q-a', '', '启用'] as const }], 'INVALID_QUESTION'],
    ['example question ID', () => [{ faq: faq(), question: ['EXAMPLE_q', '问法', '启用'] as const }], 'INVALID_QUESTION'],
    ['duplicate question across entries', () => records().map((r) => ({ ...r, question: ['q-same', '合成问法', '启用'] as const })), 'DUPLICATE_QUESTION'],
  ] as const)('blocks whole batch for %s', (_label, input, code) => {
    const parsed = parseCsvCandidate(createCsvTemplate(context, input()), context);
    expect(parsed.ok).toBe(false); expect(parsed.rows).toEqual([]); expect(parsed.questions).toEqual([]);
    expect(parsed.issues.some((issue) => issue.code === code)).toBe(true);
    if (code === 'DUPLICATE_QUESTION') expect(parsed.issues[0]).toMatchObject({ sheet: 'CSV', row: 3, column: 'U' });
  });
  it.each([
    [0, 'EXAMPLE_01', 'INVALID_ID', 'F'], [7, 'unknown', 'INVALID_STATE', 'M'],
    [8, '2026-02-30T00:00:00Z', 'INVALID_TIME', 'N'], [10, 'wrong family', 'INVALID_FAMILY', 'P'],
    [13, '必要图片', 'UNRESOLVED_MEDIA', 'S'], [14, 'true', 'BRAND_OVERRIDE', 'T'], [2, '过敏请核对', 'ALLERGY_BODY', 'H'],
  ] as const)('reuses the workbook business rule for field %i', (index, value, code, col) => {
    const row = faq(); row[index] = value;
    const parsed = parseCsvCandidate(createCsvTemplate(context, [{ faq: row }]), context);
    expect(parsed.issues).toContainEqual(expect.objectContaining({ code, row: 2, column: col }));
    expect(parsed.rows).toEqual([]);
  });
  it('requires a real activity expiry and a forward time window', () => {
    const selected = { ...context, domain: 'campaign' as const }, row = faq();
    expect(codes(createCsvTemplate(selected, [{ faq: row }]), selected)).toContain('EXPIRY_REQUIRED');
    row[8] = '2028-02-29T12:00:00+08:00'; row[9] = '2028-03-01T00:00:00Z';
    expect(parseCsvCandidate(createCsvTemplate(selected, [{ faq: row }]), selected).ok).toBe(true);
    row[9] = row[8]; expect(codes(createCsvTemplate(selected, [{ faq: row }]), selected)).toContain('INVALID_WINDOW');
  });
  it('checks the registered source on every record rather than trusting the first record', () => {
    const bytes = createCsvTemplate(context, records());
    const altered = bytes.toString().replace(/"synthetic-source"/gu, (match, offset: number) => offset > bytes.toString().indexOf('"synthetic-source"') ? '"other-source"' : match);
    const parsed = parseCsvCandidate(Buffer.from(altered), context);
    expect(parsed.issues).toContainEqual(expect.objectContaining({ code: 'SOURCE_MISMATCH', row: 3, column: 'A' }));
    expect(parsed.rows).toEqual([]);
  });
  it.each([
    ['unknown/reordered header', (s: string) => s.replace('"标题"', '"未知标题"'), 'HEADER_MISMATCH'],
    ['extra header', (s: string) => s.replace('\r\n', ',"extra"\r\n'), 'COLUMN_COUNT'],
    ['short data row', (s: string) => s.replace(/,""\r\n$/u, '\r\n'), 'COLUMN_COUNT'],
    ['long data row', (s: string) => s.replace(/\r\n$/u, ',"extra"\r\n'), 'COLUMN_COUNT'],
    ['unterminated quote', (s: string) => `${s}"broken`, 'INVALID_CSV'],
    ['text after closing quote', (s: string) => s.replace('"faq-001"', '"faq-001"x'), 'INVALID_CSV'],
    ['blank record', (s: string) => `${s}\r\n`, 'COLUMN_COUNT'],
    ['NUL', (s: string) => s.replace('faq-001', 'faq-001\0'), 'NUL_TEXT'],
  ] as const)('rejects malformed CSV %s', (_label, alter, code) => {
    expect(codes(Buffer.from(alter(createCsvTemplate(context, [{ faq: faq() }]).toString())))).toContain(code);
  });
  it('rejects unknown context and invalid UTF-8, empty data, oversize raw input and an XLSX archive', async () => {
    expect(codes(Buffer.from([0xc3, 0x28]))).toContain('INVALID_UTF8');
    expect(codes(Buffer.from([0xff, 0xfe, 0x61, 0x00]))).toContain('INVALID_UTF8');
    expect(codes(Buffer.alloc(0))).toContain('EMPTY_DATA');
    expect(codes(createCsvTemplate(context))).toContain('EMPTY_DATA');
    expect(codes(Buffer.alloc(P.fileBytes + 1))).toContain('FILE_TOO_LARGE');
    expect(codes(await createTemplate(workbookContext, sampleRows))).toContain('INVALID_CSV');
    expect(codes(createCsvTemplate(context), { ...context, templateVersion: 'faq-p1.1' } as unknown as CsvContext)).toContain('INVALID_CONTEXT');
  });
  it('enforces cell text and aggregate text budgets on physical records before duplicate grouping', () => {
    const row = faq(); row[2] = 'x'.repeat(P.cellChars);
    expect(parseCsvCandidate(createCsvTemplate(context, [{ faq: row }]), context).ok).toBe(true);
    row[2] += 'x'; expect(codes(createCsvTemplate(context, [{ faq: row }]))).toContain('CELL_TEXT_LIMIT');
    row[2] = 'x'.repeat(P.cellChars);
    const repeated = Array.from({ length: 100 }, (_, i) => ({ faq: row, question: [`q-${i}`, '问法', '启用'] as const }));
    expect(codes(createCsvTemplate(context, repeated))).toContain('NORMALIZED_TEXT_LIMIT');
  });
  it('bounds a single record before accumulating unbounded cell text', () => {
    const header = createCsvTemplate(context).toString();
    expect(codes(Buffer.from(`${header}"${'x'.repeat(P.cellChars * CSV_HEADERS.length + 2)}"`))).toContain('RECORD_SIZE_LIMIT');
  });
  it('rejects the 24th empty field before consuming later malformed CSV or growing an unbounded record array', () => {
    const header = createCsvTemplate(context).toString();
    const parsed = parseCsvCandidate(Buffer.from(`${header}${','.repeat(24)}"unterminated`), context);
    expect(parsed.issues).toEqual([expect.objectContaining({ code: 'COLUMN_COUNT', sheet: 'CSV', row: 2, column: 'X' })]);
    // With only the permitted field count, the malformed quote is still surfaced.
    expect(codes(Buffer.from(`${header}${','.repeat(22)}"unterminated`))).toContain('INVALID_CSV');
  });
  it('enforces physical record and normalized FAQ + question limits separately', () => {
    const unique = Array.from({ length: P.rows }, (_, i) => { const row = faq(); row[0] = `faq-${i}`; return { faq: row }; });
    expect(parseCsvCandidate(createCsvTemplate(context, unique), context).rows).toHaveLength(P.rows);
    expect(codes(createCsvTemplate(context, [...unique, { faq: faq() }]))).toContain('ROW_LIMIT');
    const withQuestions = unique.slice(0, P.rows / 2).map((r, i) => ({ ...r, question: [`q-${i}`, '问法', '启用'] as const }));
    expect(parseCsvCandidate(createCsvTemplate(context, withQuestions), context).ok).toBe(true);
    expect(codes(createCsvTemplate(context, [...withQuestions, unique[P.rows / 2]!]))).toContain('ROW_LIMIT');
  });
});
