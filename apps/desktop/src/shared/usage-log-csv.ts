import type { UsageLogFilter, UsageLogReply, UsageLogResult, UsageLogRow } from './dashboard-usage-log';
import { WORKBENCH_EMPTY } from './workbench-empty';

/** A usage row plus the consent flag the export filter needs. Missing consent is not exportable. */
export type UsageSourceRow = UsageLogRow & { consented?: boolean };

const RESULT_LABEL: Record<UsageLogResult, string> = {
  copied: '已复制',
  viewed: '仅查看',
  miss: '未命中',
};

export function usageRowIsExportable(row: UsageSourceRow): boolean {
  return row.question !== null && row.consented === true;
}

/** Export preview counts. A row that is both redacted and without consent is counted once, as redacted. */
export function usageExportPreviewCounts(rows: readonly UsageSourceRow[]): {
  exportable: number;
  redacted: number;
  withoutConsent: number;
} {
  let exportable = 0;
  let redacted = 0;
  let withoutConsent = 0;
  for (const row of rows) {
    if (row.question === null) redacted += 1;
    else if (row.consented !== true) withoutConsent += 1;
    else exportable += 1;
  }
  return { exportable, redacted, withoutConsent };
}

/** Rows the usage list shows. An empty result or query keeps every row. */
export function selectUsageLogRows(
  rows: readonly UsageSourceRow[],
  filter: Partial<UsageLogFilter> | null | undefined,
): UsageSourceRow[] {
  const result = filter?.result ?? '';
  const query = typeof filter?.query === 'string' ? filter.query.trim() : '';
  return rows.filter((row) => {
    if (result !== '' && row.result !== result) return false;
    if (query === '') return true;
    return (row.question ?? '').includes(query) || row.agent.includes(query);
  });
}

const USAGE_PAGE_SIZE = 50;

/** The list reply the main handler returns. A missing source does not invent rows. */
export function listUsageLog(
  source: readonly UsageSourceRow[] | null,
  filter: Partial<UsageLogFilter> | null | undefined,
): UsageLogReply {
  if (source === null) return { ok: false, code: 'UNAVAILABLE', message: WORKBENCH_EMPTY.usageUnmounted };
  const selected = selectUsageLogRows(source, filter);
  const cursor = filter?.cursor ?? null;
  const found = cursor ? selected.findIndex((row) => row.id === cursor) : -1;
  const offset = cursor ? (found >= 0 ? found : selected.length) : 0;
  const rows = selected.slice(offset, offset + USAGE_PAGE_SIZE);
  const next = selected[offset + USAGE_PAGE_SIZE];
  return {
    ok: true,
    rows,
    nextCursor: next ? next.id : null,
    canExport: source.some(usageRowIsExportable),
  };
}

function csvCell(value: string): string {
  const guarded = /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}

/** Stable CSV body. Redacted and without-consent rows are omitted. */
export function serializeUsageLogCsv(rows: readonly UsageSourceRow[]): string {
  const header = ['时间', '坐席', '客户问题', '命中话术', '结果'];
  const lines = [header.join(',')];
  for (const row of rows) {
    if (!usageRowIsExportable(row) || row.question === null) continue;
    lines.push([
      row.askedAt,
      row.agent,
      row.question,
      row.scriptTitle ?? '',
      RESULT_LABEL[row.result],
    ].map(csvCell).join(','));
  }
  return `\uFEFF${lines.join('\n')}\n`;
}

export function aggregateUsage(rows: readonly UsageSourceRow[]): {
  use: number;
  miss: number;
  rate: string;
} {
  const use = rows.filter((row) => row.result !== 'miss').length;
  const miss = rows.filter((row) => row.result === 'miss').length;
  const total = use + miss;
  const rate = total === 0 ? '暂无记录' : `${((use / total) * 100).toFixed(1)}%`;
  return { use, miss, rate };
}

export type UsageRankRow = { name: string; total: number; extra: string };

/** Usage ranking from the same rows the CSV writer receives. Misses stay out of this list. */
export function rankUsageRows(rows: readonly UsageSourceRow[], view: 'script' | 'person'): UsageRankRow[] {
  if (view === 'person') {
    const people = new Map<string, { total: number; scripts: Map<string, number> }>();
    for (const row of rows) {
      if (row.result === 'miss') continue;
      const bucket = people.get(row.agent) ?? { total: 0, scripts: new Map() };
      bucket.total += 1;
      if (row.scriptTitle) bucket.scripts.set(row.scriptTitle, (bucket.scripts.get(row.scriptTitle) ?? 0) + 1);
      people.set(row.agent, bucket);
    }
    return [...people.entries()].map(([name, bucket]) => {
      const top = [...bucket.scripts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))[0];
      return { name, total: bucket.total, extra: top ? top[0] : '—' };
    }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'zh'));
  }
  const scripts = new Map<string, { total: number; people: Set<string> }>();
  for (const row of rows) {
    if (row.result === 'miss' || !row.scriptTitle) continue;
    const bucket = scripts.get(row.scriptTitle) ?? { total: 0, people: new Set<string>() };
    bucket.total += 1;
    bucket.people.add(row.agent);
    scripts.set(row.scriptTitle, bucket);
  }
  return [...scripts.entries()].map(([name, bucket]) => ({
    name,
    total: bucket.total,
    extra: [...bucket.people].join('、'),
  })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'zh'));
}

export type MissRankRow = { question: string; count: number; latest: string };

/** Miss ranking from the same rows. A suppressed question stays 「已脱敏」. */
export function rankMissRows(rows: readonly UsageSourceRow[]): MissRankRow[] {
  const grouped = new Map<string, { count: number; latest: string }>();
  for (const row of rows) {
    if (row.result !== 'miss') continue;
    const question = row.question === null ? '已脱敏' : row.question;
    const bucket = grouped.get(question) ?? { count: 0, latest: row.askedAt };
    bucket.count += 1;
    if (row.askedAt > bucket.latest) bucket.latest = row.askedAt;
    grouped.set(question, bucket);
  }
  return [...grouped.entries()]
    .map(([question, bucket]) => ({ question, count: bucket.count, latest: bucket.latest }))
    .sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest));
}

export type UsageTrendPoint = { day: string; use: number; miss: number };

/** Daily use and miss counts. The day is the local calendar day of askedAt. */
export function trendFromUsage(rows: readonly UsageSourceRow[]): UsageTrendPoint[] {
  const days = new Map<string, { use: number; miss: number }>();
  for (const row of rows) {
    const parsed = new Date(row.askedAt);
    const day = Number.isFinite(parsed.getTime())
      ? `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
      : row.askedAt.slice(0, 10);
    const bucket = days.get(day) ?? { use: 0, miss: 0 };
    if (row.result === 'miss') bucket.miss += 1;
    else bucket.use += 1;
    days.set(day, bucket);
  }
  return [...days.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, bucket]) => ({ day, use: bucket.use, miss: bucket.miss }));
}
