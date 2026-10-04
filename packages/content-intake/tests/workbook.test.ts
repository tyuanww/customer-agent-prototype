import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { parseWorkbook, createTemplate, writeIssueReport, INTAKE_POLICY as P } from '@customer-agent/content-intake';
import { createParseRunner } from '@customer-agent/content-intake/runner';
import { context, fixture, sampleRows } from './fixtures.js';
import { isParseResult, failedParse } from '../src/policy.js';

async function edit(change: (book: ExcelJS.Workbook) => void) {
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await fixture() as unknown as ExcelJS.Buffer);
  change(book); return Buffer.from(await book.xlsx.writeBuffer());
}
async function editZip(change: (zip: JSZip) => Promise<void> | void) {
  const zip = await JSZip.loadAsync(await fixture()); await change(zip);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
describe('P1 mature XLSX parser and real output roundtrip', () => {
  it('consumes generated template and preserves Chinese multi-line answers exactly', async () => {
    const result = await parseWorkbook(await fixture(), context);
    expect(result.ok).toBe(true); expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.body).toBe(sampleRows[0]![2]);
    expect(result.excluded.map((s) => s.sheet)).toEqual(['说明', '虚构示例']);
  });
  it('only missing C3 yields one actionable error; report reopens and fixing the workbook succeeds', async () => {
    const result = await parseWorkbook(await fixture({ missingC3: true }), context);
    expect(result.rows).toEqual([]);
    expect(result.issues).toEqual([{ code: 'REQUIRED', sheet: 'FAQ', row: 3, column: 'C', fix: '补齐必填内容后整批重新上传' }]);
    const report = new ExcelJS.Workbook(); await report.xlsx.load(await writeIssueReport(result.issues) as unknown as ExcelJS.Buffer);
    expect(report.getWorksheet('校验问题')!.getRow(2).values).toEqual([undefined, 'FAQ', '3', 'C', 'REQUIRED', result.issues[0]!.fix]);
    expect((await parseWorkbook(await fixture(), context)).ok).toBe(true);
  });
  it('handles six sheets and reports excluded merged/image resources without dropping selected media silently', async () => {
    const result = await parseWorkbook(await fixture({ richExcluded: true }), context);
    expect(result.ok).toBe(true); expect(result.mediaCount).toBe(1);
    expect(result.excluded.at(-1)).toMatchObject({ sheet: '内部资源（合成排除）', images: 8 });
    const selectedImage = await edit((book) => {
      const imageId = book.addImage({ base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN5EAAAAASUVORK5CYII=', extension: 'png' });
      book.getWorksheet('FAQ')!.addImage(imageId, 'D2:E3');
    });
    expect((await parseWorkbook(selectedImage, context)).issues.some((i) => i.code === 'UNRESOLVED_MEDIA')).toBe(true);
  });
  it.each([
    ['formula', (book: ExcelJS.Workbook) => { book.getWorksheet('FAQ')!.getCell('C2').value = { formula: '1+1', result: 2 }; }, 'NON_TEXT_CELL'],
    ['merged', (book: ExcelJS.Workbook) => { book.getWorksheet('FAQ')!.mergeCells('B2:C2'); }, 'MERGED_CELLS'],
    ['duplicate ID', (book: ExcelJS.Workbook) => { book.getWorksheet('FAQ')!.getCell('A3').value = 'faq-001'; }, 'DUPLICATE_ID'],
    ['header', (book: ExcelJS.Workbook) => { book.getWorksheet('FAQ')!.getCell('C1').value = '标题'; }, 'HEADER_MISMATCH'],
    ['wrong source', (book: ExcelJS.Workbook) => { book.getWorksheet('来源')!.getCell('A2').value = 'different-source'; }, 'SOURCE_MISMATCH'],
    ['allergy body', (book: ExcelJS.Workbook) => { book.getWorksheet('FAQ')!.getCell('B2').value = '过敏：停手确认'; }, 'ALLERGY_BODY'],
    ['oversize text', (book: ExcelJS.Workbook) => { book.getWorksheet('FAQ')!.getCell('C2').value = 'a'.repeat(P.cellChars + 1); }, 'CELL_TEXT_LIMIT'],
    ['impossible date', (book: ExcelJS.Workbook) => { book.getWorksheet('FAQ')!.getCell('I2').value = '2026-02-30T00:00:00Z'; }, 'INVALID_TIME'],
    ['normalized hour', (book: ExcelJS.Workbook) => { book.getWorksheet('FAQ')!.getCell('I2').value = '2026-10-04T24:00:00Z'; }, 'INVALID_TIME'],
    ['example question ID', (book: ExcelJS.Workbook) => { book.getWorksheet('相似问法')!.addRow(['faq-001', 'EXAMPLE_01', '合成问法', '启用']); }, 'INVALID_QUESTION'],
    ['invalid question ID', (book: ExcelJS.Workbook) => { book.getWorksheet('相似问法')!.addRow(['faq-001', 'invalid id', '合成问法', '启用']); }, 'INVALID_QUESTION'],
    ['excluded column definition', (book: ExcelJS.Workbook) => { book.getWorksheet('说明')!.getColumn(P.columns + 1).width = 20; }, 'COORDINATE_LIMIT'],
    ['selected background image', (book: ExcelJS.Workbook) => { const id = book.addImage({ base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN5EAAAAASUVORK5CYII=', extension: 'png' }); book.getWorksheet('FAQ')!.addBackgroundImage(id); }, 'UNRESOLVED_MEDIA'],
  ] as const)('blocks the whole workbook for %s', async (_label, mutate, code) => {
    const result = await parseWorkbook(await edit(mutate), context);
    expect(result.ok).toBe(false); expect(result.rows).toEqual([]);
    expect(result.issues.some((i) => i.code === code)).toBe(true);
  });
  it('rejects empty data, invalid bytes and file budget +1', async () => {
    expect((await parseWorkbook(await createTemplate(context), context)).issues[0]?.code).toBe('EMPTY_DATA');
    expect((await parseWorkbook(Buffer.from('fake.xlsx'), context)).ok).toBe(false);
    expect((await parseWorkbook(Buffer.alloc(P.fileBytes + 1), context)).issues[0]?.code).toBe('FILE_TOO_LARGE');
  });
  it('retains questions, explicit deactivation and literal formula-looking text without evaluation', async () => {
    const bytes = await edit((book) => {
      book.getWorksheet('相似问法')!.addRow(['faq-001', 'question-01', '另一种合成问法', '启用']);
      book.getWorksheet('FAQ')!.getCell('H2').value = '停用'; book.getWorksheet('FAQ')!.getCell('C2').value = '=1+1';
    });
    const result = await parseWorkbook(bytes, context);
    expect(result.ok).toBe(true); expect(result.questions[0]?.id).toBe('question-01');
    expect(result.rows[0]).toMatchObject({ state: '停用', body: '=1+1' });
  });
  it('accepts a real leap day and the last permitted column definition', async () => {
    const bytes = await edit((book) => {
      book.getWorksheet('FAQ')!.getCell('I2').value = '2028-02-29T12:00:00+08:00';
      book.getWorksheet('说明')!.getColumn(P.columns).width = 20;
    });
    expect((await parseWorkbook(bytes, context)).ok).toBe(true);
  });
  it('does not create an allergy keyword by joining the title and body', async () => {
    const bytes = await edit((book) => {
      book.getWorksheet('FAQ')!.getCell('B2').value = '合成：经过';
      book.getWorksheet('FAQ')!.getCell('C2').value = '敏感咨询的虚构示例';
    });
    expect((await parseWorkbook(bytes, context)).ok).toBe(true);
  });
  it('bounds repeated shared-string expansion before allocating the serialized result', async () => {
    const rows = Array.from({ length: 160 }, (_, index) => {
      const row = [...sampleRows[0]!]; row[0] = `amplified-${index}`; row[2] = 'x'.repeat(P.cellChars); return row;
    });
    const bytes = await createTemplate(context, rows);
    expect(bytes.length).toBeLessThan(P.fileBytes);
    const direct = await parseWorkbook(bytes, context);
    expect(direct.issues[0]?.code).toBe('NORMALIZED_TEXT_LIMIT'); expect(direct.rows).toEqual([]);
    expect((await createParseRunner().parse(bytes, context)).result).toEqual(direct);
  });
  it.each([P.cellChars, P.cellChars + 1])('bounds total rich-text cell length across fragments at %i characters', async (length) => {
    const bytes = await edit((book) => {
      book.getWorksheet('说明')!.getCell('A1').value = { richText: [{ text: 'a'.repeat(16_500) }, { text: 'b'.repeat(length - 16_500) }] };
    });
    const result = await parseWorkbook(bytes, context);
    expect(result.ok).toBe(length <= P.cellChars);
    if (!result.ok) expect(result.issues[0]?.code).toBe('CELL_TEXT_LIMIT');
  });
  it.each([
    ['sparse dimensions', async (zip: JSZip) => { const name = 'xl/worksheets/sheet3.xml'; zip.file(name, (await zip.file(name)!.async('string')).replace(/ref="A1:O3"/u, 'ref="A1:XFD1048576"')); }, 'COORDINATE_LIMIT'],
    ['external reference', (zip: JSZip) => { zip.file('xl/_rels/external.xml.rels', '<Relationships><Relationship TargetMode="External" Target="https://synthetic.example/"/></Relationships>'); }, 'EXTERNAL_RESOURCE'],
    ['external target without mode', (zip: JSZip) => { zip.file('xl/_rels/external.xml.rels', '<Relationships><Relationship Target="https://synthetic.example/"/></Relationships>'); }, 'EXTERNAL_RESOURCE'],
    ['noncanonical external mode', (zip: JSZip) => { zip.file('xl/_rels/external.xml.rels', '<Relationships><Relationship TargetMode="external" Target="local"/></Relationships>'); }, 'EXTERNAL_RESOURCE'],
    ['duplicate cell', async (zip: JSZip) => { const name = 'xl/worksheets/sheet3.xml'; zip.file(name, (await zip.file(name)!.async('string')).replace('</row>', '<c r="A1" t="inlineStr"><is><t>条目编号</t></is></c></row>')); }, 'AMBIGUOUS_COORDINATE'],
    ['unresolved drawing reference', async (zip: JSZip) => { const name = 'xl/worksheets/sheet3.xml'; zip.file(name, (await zip.file(name)!.async('string')).replace('</worksheet>', '<drawing r:id="missing"/></worksheet>')); }, 'UNRESOLVED_MEDIA'],
    ['macro', (zip: JSZip) => { zip.file('xl/vbaProject.bin', 'synthetic'); }, 'ACTIVE_CONTENT'],
    ['doctype', (zip: JSZip) => { zip.file('xl/extra.xml', '<!DOCTYPE x><x/>'); }, 'ACTIVE_CONTENT'],
    ['oversize CDATA', (zip: JSZip) => { zip.file('xl/extra.xml', `<x><![CDATA[${'a'.repeat(P.cellChars + 1)}]]></x>`); }, 'CELL_TEXT_LIMIT'],
    ['entry count', (zip: JSZip) => { for (let i = 0; i <= P.zipEntries; i++) zip.file(`extra-${i}.txt`, ''); }, 'ZIP_ENTRY_LIMIT'],
    ['expanded bytes', (zip: JSZip) => { zip.file('xl/padding.txt', '0'.repeat(P.expandedBytes + 1)); }, 'EXPANDED_LIMIT'],
  ] as const)('rejects %s before ExcelJS object-model allocation', async (_label, mutate, code) => {
    expect((await parseWorkbook(await editZip(mutate), context)).issues[0]?.code).toBe(code);
  });
  it('accepts the row budget and refuses one additional data row', async () => {
    expect((await parseWorkbook(await fixture({ count: P.rows }), context)).rows).toHaveLength(P.rows);
    expect((await parseWorkbook(await fixture({ count: P.rows + 1 }), context)).issues[0]?.code).toBe('COORDINATE_LIMIT');
  }, 20_000);
  it('rejects central/local ZIP name disagreement before the second parser can reinterpret it', async () => {
    const bytes = Buffer.from(await fixture());
    const name = Buffer.from('xl/worksheets/sheet3.xml');
    const localName = bytes.indexOf(name);
    expect(localName).toBeGreaterThan(0);
    Buffer.from('xl/worksheets/sheet9.xml').copy(bytes, localName);
    expect((await parseWorkbook(bytes, context)).issues[0]?.code).toBe('ZIP_NAME_MISMATCH');
  });
  it('rejects noncanonical part aliases before ZIP normalization can collapse them', async () => {
    const bytes = await editZip((zip) => { zip.file('xl/./alias.xml', '<x/>'); });
    expect((await parseWorkbook(bytes, context)).issues[0]?.code).toBe('UNSAFE_ZIP_PATH');
  });
});

describe('P1 isolated process lifecycle', () => {
  it('rejects malformed process results and blocking issues accompanied by usable rows', async () => {
    const valid = await parseWorkbook(await fixture(), context), failed = failedParse('SYNTHETIC');
    expect(isParseResult(valid)).toBe(true); expect(isParseResult(failed)).toBe(true);
    for (const result of [{ ...valid, questions: undefined }, { ...valid, issues: failed.issues },
      { ...failed, rows: valid.rows }, { ...valid, rows: [{ ...valid.rows[0], body: 123 }] },
      { ...valid, rows: [{ ...valid.rows[0], state: ['启用'] }] },
      { ...valid, questions: [{ entryId: 'faq-001', id: 'q-1', text: '合成问法', state: ['启用'] }] }]) expect(isParseResult(result)).toBe(false);
  });
  it('returns identical normalized rows in direct preflight and isolated server-style reparse', async () => {
    const bytes = await fixture(), direct = await parseWorkbook(bytes, context);
    const isolated = await createParseRunner().parse(bytes, context);
    expect(isolated.result).toEqual(direct); expect(isolated.maxRssKiB).toBeGreaterThan(0); expect(isolated.networkAttempts).toBe(0);
  });
  it('cancels one active job, rejects a second, then actually parses the next job without late resurrection', async () => {
    const bytes = await fixture({ count: P.rows }), runner = createParseRunner(), abort = new AbortController();
    const pending = runner.parse(bytes, context, { signal: abort.signal });
    expect((await runner.parse(bytes, context)).result.issues[0]?.code).toBe('BUSY');
    const start = performance.now(); abort.abort();
    expect((await pending).result.issues[0]?.code).toBe('CANCELLED'); expect(performance.now() - start).toBeLessThan(2000);
    expect((await runner.parse(await fixture(), context)).result.ok).toBe(true);
  }, 20_000);
  it('kills a timed-out process and leaves the runner reusable', async () => {
    const runner = createParseRunner();
    expect((await runner.parse(await fixture(), context, { timeoutMs: 1 })).result.issues[0]?.code).toBe('TIMEOUT');
    expect((await runner.parse(await fixture(), context)).result.ok).toBe(true);
  });
});
