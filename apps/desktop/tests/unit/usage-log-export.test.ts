import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { saveUsageLogCsv } from '../../src/main/usage-log-export';
import { usageExportPreviewCounts, type UsageSourceRow } from '../../src/shared/usage-log-csv';

const rows: UsageSourceRow[] = [
  { id: '1', askedAt: '2026-10-13T01:02:03.000Z', agent: '坐席甲', question: '退货多久', scriptTitle: '退货时效', result: 'copied', snapshotStale: false, consented: true },
  { id: '2', askedAt: '2026-10-13T02:00:00.000Z', agent: '坐席乙', question: null, scriptTitle: null, result: 'viewed', snapshotStale: false },
  { id: '3', askedAt: '2026-10-13T03:00:00.000Z', agent: '坐席丙', question: '未同意的问题', scriptTitle: '保修多久', result: 'miss', snapshotStale: false, consented: false },
];

it('writes the same CSV bytes twice and drops redacted and without-consent rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'usage-log-'));
  const first = join(dir, 'a.csv');
  const second = join(dir, 'b.csv');
  expect(saveUsageLogCsv(first, rows)).toEqual({ written: 1 });
  expect(saveUsageLogCsv(second, rows)).toEqual({ written: 1 });
  const a = readFileSync(first);
  const b = readFileSync(second);
  expect(Buffer.compare(a, b)).toBe(0);
  const text = a.toString('utf8');
  expect(text).toContain('退货多久');
  expect(text).not.toContain('未同意的问题');
  expect(text.split('\n').filter((line) => line.length > 0)).toHaveLength(2);
  const both: UsageSourceRow = {
    id: '4', askedAt: '2026-10-13T04:00:00.000Z', agent: '坐席丁', question: null, scriptTitle: null,
    result: 'viewed', snapshotStale: false, consented: false,
  };
  expect(usageExportPreviewCounts([...rows, both])).toEqual({ exportable: 1, redacted: 2, withoutConsent: 1 });
  const out = process.env.USAGE_CSV_DIR;
  if (out) {
    saveUsageLogCsv(join(out, 'usage-a.csv'), rows);
    saveUsageLogCsv(join(out, 'usage-b.csv'), rows);
  }
});
