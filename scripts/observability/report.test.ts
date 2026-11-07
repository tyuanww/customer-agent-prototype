import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildSyntheticReportArtifacts,
  checkSyntheticReport,
  writeSyntheticReport,
} from './report.ts';

test('synthetic observability report is deterministic and rebuildable', async () => {
  const first = await buildSyntheticReportArtifacts();
  const second = await buildSyntheticReportArtifacts();
  assert.equal(first.json, second.json);
  assert.equal(first.markdown, second.markdown);

  const report = JSON.parse(first.json) as {
    mode: string;
    latency: Array<{ sampleCount: number; temperature: string; surface: string }>;
    alerts: Array<{ kind: string }>;
    evaluations: { ordinary: { kind: string }; sop: { kind: string } };
  };
  assert.equal(report.mode, 'synthetic-mechanism');
  assert.equal(report.latency.length, 8);
  assert.deepEqual(
    report.latency.map((row) => [row.surface, row.temperature, row.sampleCount]),
    [
      ['dashboard-acceptance', 'cold', 20],
      ['dashboard-acceptance', 'warm', 200],
      ['ordinary-query', 'cold', 20],
      ['ordinary-query', 'warm', 200],
      ['overlay-dispatch', 'cold', 20],
      ['overlay-dispatch', 'warm', 200],
      ['sop-query', 'cold', 20],
      ['sop-query', 'warm', 200],
    ],
  );
  assert.equal(report.evaluations.ordinary.kind, 'ordinary');
  assert.equal(report.evaluations.sop.kind, 'sop');
  assert.deepEqual(new Set(report.alerts.map((alert) => alert.kind)), new Set([
    'budget_breach',
    'unknown_operation',
    'dead_letter_growth',
    'stale_release',
    'release_index_failure',
  ]));
  assert.ok(!first.json.includes('raw question'));
  assert.ok(!first.json.includes('answerText'));
});

test('report command writes and checks the same artifacts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'obs-report-'));
  try {
    const written = await writeSyntheticReport(directory);
    await checkSyntheticReport(directory);
    assert.ok(written.markdown.includes('Synthetic fixtures'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('checked-in generated report is current', async () => {
  await checkSyntheticReport();
});
