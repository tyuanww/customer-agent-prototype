import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { listUsageLog, type UsageSourceRow } from '../../src/shared/usage-log-csv';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const rows: UsageSourceRow[] = [
  { id: '1', askedAt: '2026-10-13T01:00:00.000Z', agent: '坐席甲', question: '退货多久', scriptTitle: '退货时效', result: 'copied', snapshotStale: false, consented: true },
  { id: '2', askedAt: '2026-10-13T02:00:00.000Z', agent: '坐席乙', question: '尺码怎么选', scriptTitle: '尺码', result: 'viewed', snapshotStale: false },
  { id: '3', askedAt: '2026-10-13T03:00:00.000Z', agent: '坐席甲', question: '改地址', scriptTitle: null, result: 'miss', snapshotStale: false, consented: false },
  { id: '4', askedAt: '2026-10-13T04:00:00.000Z', agent: '坐席丙', question: null, scriptTitle: null, result: 'viewed', snapshotStale: false },
];

it('registers the usage channels before the legacy-only branch', () => {
  const main = readFileSync(resolve(desktopRoot, 'src/main/main.ts'), 'utf8');
  const handler = readFileSync(resolve(desktopRoot, 'src/main/usage-log-ipc.ts'), 'utf8');
  const call = main.indexOf('registerUsageLogIpc(');
  expect(call).toBeGreaterThan(0);
  expect(main.indexOf('registerUsageLogIpc(', call + 1)).toBe(-1);
  expect(main).not.toMatch(/if \(!productProfile\??\.contentIntake\)[\s\S]{0,80}registerUsageLogIpc\(/);
  expect(handler).toContain('usageReplyFromSources(usageMount, readUsageRows, readRemoteUsage, filter)');
  expect(main).toContain("'/v1/events/usage'");
  expect(handler).toContain('usageExportPreviewCounts(current.rows)');
  expect(main).toContain('bindUsageFeed');
  expect(main).toContain('setUsageMount');
});

it('filters the shipped list by result and query and does not invent rows when the source is absent', () => {
  expect(listUsageLog(null, { result: 'miss', query: '', cursor: null })).toEqual({
    ok: false, code: 'UNAVAILABLE', message: '使用记录还不能在这里看。',
  });
  const misses = listUsageLog(rows, { result: 'miss', query: '', cursor: null });
  expect(misses.ok).toBe(true);
  if (!misses.ok) return;
  expect(misses.rows.map((row) => row.id)).toEqual(['3']);
  expect(misses.rows.some((row) => row.result === 'copied')).toBe(false);
  const byAgent = listUsageLog(rows, { result: '', query: '坐席乙', cursor: null });
  expect(byAgent.ok && byAgent.rows.map((row) => row.question)).toEqual(['尺码怎么选']);
  const byQuestion = listUsageLog(rows, { result: 'copied', query: '退货', cursor: null });
  expect(byQuestion.ok && byQuestion.rows.map((row) => row.id)).toEqual(['1']);
  const hidden = listUsageLog(rows, { result: 'miss', query: '坐席乙', cursor: null });
  expect(hidden.ok && hidden.rows).toEqual([]);
  expect(hidden.ok && hidden.canExport).toBe(true);
  const redacted = listUsageLog(rows, { result: '', query: '已脱敏', cursor: null });
  expect(redacted.ok && redacted.rows).toEqual([]);
});
