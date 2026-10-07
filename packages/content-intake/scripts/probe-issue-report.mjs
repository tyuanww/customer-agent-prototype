import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { createTemplate, FAQ_HEADERS, INTAKE_POLICY, isParseResult, parseWorkbook, QUESTION_HEADERS, writeIssueReport } from '../dist/workbook.js';

// Exercise real parser-produced coordinates/recovery text; never manufacture an
// Issue[] at the worker JSON-output limit and call that a report-size bound.
const output = resolve(process.argv[2] ?? fileURLToPath(new URL(
  `../../../.gstack/content-intake-issue-report/${new Date().toISOString().replace(/[:.]/g, '-')}/`, import.meta.url)));
await mkdir(output, { recursive: true });
const context = { sourceId: 'synthetic-budget-source', brandId: 'synthetic-brand', scope: 'shop-a', scopeKind: 'shop',
  domain: 'campaign', sheet: 'FAQ', templateVersion: 'faq-p1.1' };
const reportBudget = 8 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const measurements = [];
for (const includeQuestions of [false, true]) {
  const name = includeQuestions ? 'aggregate-row-limit' : 'max-faq-rows';
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await createTemplate(context));
  const faq = workbook.getWorksheet('FAQ'), questions = workbook.getWorksheet('相似问法');
  for (let row = 0; row < INTAKE_POLICY.rows; row++) {
    // Numeric cells produce both NON_TEXT_CELL and applicable row validation
    // errors. Values never enter the report; all recovery text is parser-owned.
    faq.addRow(FAQ_HEADERS.map(() => 1));
    if (includeQuestions) questions.addRow(QUESTION_HEADERS.map(() => 1));
  }
  const input = Buffer.from(await workbook.xlsx.writeBuffer());
  assert.ok(input.length <= INTAKE_POLICY.fileBytes);
  const parseStart = performance.now();
  const result = await parseWorkbook(input, context);
  const parseMs = performance.now() - parseStart;
  assert.equal(isParseResult(result), true);
  assert.equal(result.ok, false);
  assert.deepEqual(result.rows, []); assert.deepEqual(result.questions, []);
  assert.equal(result.issues.length, INTAKE_POLICY.rows * 21 - 1
    + (includeQuestions ? INTAKE_POLICY.rows * 6 : 0));
  assert.equal(result.issues.some(issue => issue.code === 'ROW_LIMIT'), includeQuestions);
  assert.ok(result.expandedBytes <= INTAKE_POLICY.expandedBytes);
  const writeStart = performance.now();
  const report = await writeIssueReport(result.issues);
  const writeMs = performance.now() - writeStart;
  await writeFile(resolve(output, `${name}.xlsx`), input);
  await writeFile(resolve(output, `${name}-issues.xlsx`), report);
  const readback = new ExcelJS.Workbook();
  await readback.xlsx.load(await readFile(resolve(output, `${name}-issues.xlsx`)));
  const sheet = readback.getWorksheet('校验问题');
  assert.deepEqual(sheet.getRow(1).values.slice(1), ['工作表', '行', '列', '错误码', '修正建议']);
  assert.equal(sheet.rowCount, result.issues.length + 1);
  for (const [index, issue] of result.issues.entries()) {
    assert.deepEqual(sheet.getRow(index + 2).values.slice(1),
      [issue.sheet, String(issue.row), issue.column, issue.code, issue.fix]);
  }
  assert.ok(report.length <= reportBudget, `${name} report exceeds desktop download budget`);
  measurements.push({ name, faqRows: INTAKE_POLICY.rows, questionRows: includeQuestions ? INTAKE_POLICY.rows : 0,
    aggregateRowLimitExceeded: includeQuestions, inputBytes: input.length, inputSha256: hash(input),
    expandedBytes: result.expandedBytes, issues: result.issues.length, reportBytes: report.length,
    reportSha256: hash(report), allReportRowsReadBack: true, parseMs, writeMs,
    budgetHeadroomRatio: reportBudget / report.length });
}
const evidence = { schema: 'content-intake-issue-report-probe/v1', mode: 'SYNTHETIC_ONLY',
  generatedAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, arch: process.arch },
  parserPolicy: INTAKE_POLICY, desktopReportBudgetBytes: reportBudget, measurements,
  conclusion: 'Both actual parser-produced issue reports fit the proposed 8 MiB download limit and round-trip without omitted rows.',
  limits: ['Dense error samples at the FAQ row limit and the per-sheet coordinate limit; not a mathematical maximum for every accepted XLSX.',
    'The second workbook intentionally exceeds the aggregate business row limit but stays inside archive/cell limits and must yield a complete failure report.',
    'The 50 MiB worker JSON-output budget is not used as an XLSX response budget.',
    'No customer workbook, account, Feishu, network, API or database is used.'] };
await writeFile(resolve(output, 'probe.json'), JSON.stringify(evidence, null, 2) + '\n');
const saved = JSON.parse(await readFile(resolve(output, 'probe.json'), 'utf8'));
assert.equal(saved.measurements.length, 2);
for (const sample of saved.measurements) {
  assert.equal(hash(await readFile(resolve(output, `${sample.name}-issues.xlsx`))), sample.reportSha256);
}
console.log(JSON.stringify({ status: 'PASS_SYNTHETIC', evidence: resolve(output, 'probe.json'),
  desktopReportBudgetBytes: reportBudget, measurements }, null, 2));
