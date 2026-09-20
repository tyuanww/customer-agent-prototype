import type { DashboardWordingEntry } from './dashboard-wording';

export const WORDING_PAGE_SIZE = 20;

export type WordingPage<T> = Readonly<{
  page: number;
  pageCount: number;
  slice: readonly T[];
}>;

export function paginateWording<T>(
  items: readonly T[],
  page: number,
  pageSize: number = WORDING_PAGE_SIZE,
): WordingPage<T> {
  const size = pageSize < 1 ? WORDING_PAGE_SIZE : pageSize;
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = (safePage - 1) * size;
  return Object.freeze({
    page: safePage,
    pageCount,
    slice: items.slice(start, start + size),
  });
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function wordingPublishedCsv(entries: readonly (Pick<DashboardWordingEntry, 'scriptId' | 'domain' | 'title' | 'scene' | 'answerPreview' | 'platform' | 'version' | 'effectiveWindow' | 'ownerRole'> & { lifecycle: string })[]): string {
  const header = [
    'script_id',
    'domain',
    'title',
    'scene',
    'answer',
    'platform',
    'version',
    'effective_window',
    'owner',
  ];
  const lines = [header.join(',')];
  for (const entry of entries) {
    if (entry.lifecycle !== 'published') continue;
    lines.push(
      [
        entry.scriptId,
        entry.domain,
        entry.title,
        entry.scene,
        entry.answerPreview,
        entry.platform,
        entry.version,
        entry.effectiveWindow,
        entry.ownerRole,
      ].map(csvCell).join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
