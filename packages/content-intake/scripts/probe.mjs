import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import os from 'node:os';
import ExcelJS from 'exceljs';
import { parseWorkbook, writeIssueReport, INTAKE_POLICY } from '../dist/workbook.js';
import { createParseRunner } from '../dist/runner.js';
import { context, fixture, sampleRows } from '../tests/fixtures.ts';

const output = resolve(process.argv[2] ?? fileURLToPath(new URL('../../../.gstack/content-intake-p1', import.meta.url)));
await mkdir(output, { recursive: true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const valid = await fixture(), invalid = await fixture({ missingC3: true });
await writeFile(resolve(output, 'valid.xlsx'), valid);
await writeFile(resolve(output, 'missing-c3.xlsx'), invalid);
const good = await parseWorkbook(await readFile(resolve(output, 'valid.xlsx')), context);
const bad = await parseWorkbook(await readFile(resolve(output, 'missing-c3.xlsx')), context);
assert.equal(good.ok, true); assert.equal(good.rows.length, 2); assert.equal(good.rows[0].body, sampleRows[0][2]);
assert.equal(bad.ok, false); assert.equal(bad.issues.length, 1);
assert.deepEqual({ sheet: bad.issues[0].sheet, row: bad.issues[0].row, column: bad.issues[0].column }, { sheet: 'FAQ', row: 3, column: 'C' });
const report = await writeIssueReport(bad.issues);
await writeFile(resolve(output, 'issues.xlsx'), report);
const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(await readFile(resolve(output, 'issues.xlsx')));
assert.deepEqual(reopened.getWorksheet('校验问题').getRow(2).values.slice(1, 5), ['FAQ', '3', 'C', 'REQUIRED']);

const runner = createParseRunner(), samples = [], histogram = monitorEventLoopDelay({ resolution: 10 });
const inputs = { baseline: await fixture({ count: 500, richExcluded: true }), tenfold: await fixture({ count: 5000, richExcluded: true }) };
histogram.enable();
for (const [name, bytes] of Object.entries(inputs)) {
  for (let i = 0; i < 10; i++) {
    const measured = await runner.parse(bytes, context);
    assert.equal(measured.result.ok, true); assert.equal(measured.result.rows.length, name === 'baseline' ? 500 : 5000);
    assert.equal(measured.networkAttempts, 0);
    samples.push({ input: name, rows: measured.result.rows.length, elapsedMs: measured.elapsedMs,
      maxRssKiB: measured.maxRssKiB, networkAttempts: measured.networkAttempts });
  }
}
const abort = new AbortController();
const pending = runner.parse(inputs.tenfold, context, { signal: abort.signal });
await new Promise((done) => setTimeout(done, 150));
const cancelAt = performance.now(); abort.abort();
const cancelled = await pending, cancelMs = performance.now() - cancelAt;
assert.equal(cancelled.result.issues[0]?.code, 'CANCELLED');
const afterCancel = await runner.parse(valid, context); assert.equal(afterCancel.result.ok, true);
histogram.disable();
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const measurements = Object.fromEntries(Object.keys(inputs).map((name) => {
  const group = samples.filter((s) => s.input === name);
  return [name, { n: group.length, inputSha256: hash(inputs[name]), fileBytes: inputs[name].length,
    p95Ms: percentile(group.map((s) => s.elapsedMs), .95), p99Ms: percentile(group.map((s) => s.elapsedMs), .99), maxRssKiB: Math.max(...group.map((s) => s.maxRssKiB)) }];
}));
const evidence = {
  schema: 'content-intake-p1-probe/1', mode: 'SYNTHETIC_ONLY', generatedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release(), cpu: os.cpus()[0]?.model },
  policy: INTAKE_POLICY, artifacts: [ ['valid.xlsx', valid], ['missing-c3.xlsx', invalid], ['issues.xlsx', report] ].map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: hash(bytes), reopened: true })),
  roundtrip: { validRows: good.rows.length, multilineExact: true, invalidIssues: bad.issues, repairedReimport: afterCancel.result.ok },
  measurements, cancelMs, supervisorEventLoopP99Ms: histogram.percentile(99) / 1e6,
  networkAttempts: samples.reduce((sum, s) => sum + s.networkAttempts, 0), dbQueries: 0,
  limits: ['n=10 per input: tail estimates are sample maxima, not a production SLA', 'Node supervisor measured; Electron Main/utilityProcess and packaged platforms not measured',
    'Network entrypoint instrumentation is not an OS egress sandbox', 'V8 heap bound is not an RSS/Buffer hard limit',
    'No API/DB/Feishu tenant, actual users, real workbooks or production contract intake'],
  samples,
};
await writeFile(resolve(output, 'probe.json'), JSON.stringify(evidence, null, 2) + '\n');
const readback = JSON.parse(await readFile(resolve(output, 'probe.json'), 'utf8'));
assert.equal(readback.artifacts.length, 3); assert.equal(readback.samples.length, 20);
for (const artifact of readback.artifacts) assert.equal(hash(await readFile(resolve(output, artifact.name))), artifact.sha256);
assert.ok(cancelMs <= 2000, `cancel took ${cancelMs}ms`);
assert.ok(evidence.supervisorEventLoopP99Ms <= 100, `supervisor p99 ${evidence.supervisorEventLoopP99Ms}ms`);
console.log(JSON.stringify({ report: resolve(output, 'probe.json'), artifacts: readback.artifacts, measurements, cancelMs, supervisorEventLoopP99Ms: evidence.supervisorEventLoopP99Ms, networkAttempts: evidence.networkAttempts, result: 'PASS_SYNTHETIC' }, null, 2));
