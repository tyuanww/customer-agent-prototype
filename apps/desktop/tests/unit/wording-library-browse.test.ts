import { describe, expect, it } from 'vitest';
import type { DashboardWordingEntry } from '../../src/shared/dashboard-wording';
import {
  WORDING_PAGE_SIZE,
  paginateWording,
  wordingPublishedCsv,
} from '../../src/shared/wording-library-browse';

function entry(partial: Partial<DashboardWordingEntry> & Pick<DashboardWordingEntry, 'scriptId' | 'title'>): DashboardWordingEntry {
  return {
    domain: 'product',
    scene: '怎么用',
    answerPreview: '先打湿',
    platform: '千牛',
    version: 'rel_18',
    effectiveWindow: '当前发布',
    risk: 'low',
    lifecycle: 'published',
    lifecycleLabel: '已发布',
    ownerRole: '当前发布',
    dataClass: 'local-catalog',
    ...partial,
  };
}

describe('paginateWording', () => {
  it('keeps a single page for short lists', () => {
    const page = paginateWording(['a', 'b'], 1, 20);
    expect(page).toEqual({ page: 1, pageCount: 1, slice: ['a', 'b'] });
  });

  it('clamps out-of-range pages and slices twenty by default', () => {
    const items = Array.from({ length: 25 }, (_, index) => index + 1);
    expect(paginateWording(items, 1).slice).toHaveLength(WORDING_PAGE_SIZE);
    expect(paginateWording(items, 2).slice).toEqual([21, 22, 23, 24, 25]);
    expect(paginateWording(items, 99).page).toBe(2);
    expect(paginateWording(items, 0).page).toBe(1);
  });

  it('falls back to the default size and keeps an empty list on one page', () => {
    expect(paginateWording(['a', 'b'], 1, 0)).toEqual({ page: 1, pageCount: 1, slice: ['a', 'b'] });
    expect(paginateWording(['a', 'b'], 1, -4).slice).toEqual(['a', 'b']);
    expect(paginateWording([], 9)).toEqual({ page: 1, pageCount: 1, slice: [] });
  });
});

describe('wordingPublishedCsv', () => {
  it('writes a header, published rows, and escaped commas', () => {
    const csv = wordingPublishedCsv([
      entry({ scriptId: 'a', title: '洁面, 用法', answerPreview: '先说"打湿"' }),
      entry({ scriptId: 'b', title: '防晒' }),
    ]);
    expect(csv.startsWith('script_id,domain,title,')).toBe(true);
    expect(csv).toContain('"洁面, 用法"');
    expect(csv).toContain('""打湿""');
    expect(csv).toContain('b,product,防晒,');
    expect(csv).toContain('\r\n');
  });

  it('quotes newlines and omits non-published rows', () => {
    const csv = wordingPublishedCsv([
      entry({ scriptId: 'a', title: '换行\n标题', answerPreview: '回车\r正文' }),
      {
        ...entry({ scriptId: 'draft', title: '未发布草稿' }),
        lifecycle: 'draft',
      },
    ]);
    expect(csv).toContain('"换行\n标题"');
    expect(csv).toContain('"回车\r正文"');
    expect(csv).not.toContain('未发布草稿');
    expect(csv).not.toContain('draft');
    expect(wordingPublishedCsv([])).toBe(
      'script_id,domain,title,scene,answer,platform,version,effective_window,owner\r\n',
    );
  });
});
