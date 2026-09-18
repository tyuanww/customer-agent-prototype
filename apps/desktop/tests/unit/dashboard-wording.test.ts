// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listDashboardWording } from '../../src/main/dashboard-wording';

const previousHydrate = process.env.CUSTOMER_AGENT_HYDRATE_INDEX;
const previousIndex = process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX;

afterEach(() => {
  if (previousHydrate === undefined) delete process.env.CUSTOMER_AGENT_HYDRATE_INDEX;
  else process.env.CUSTOMER_AGENT_HYDRATE_INDEX = previousHydrate;
  if (previousIndex === undefined) delete process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX;
  else process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX = previousIndex;
});

describe('dashboard wording catalog', () => {
  it('prefers the larger local index over a small hydrate snapshot', () => {
    const root = mkdtempSync(join(tmpdir(), 'dash-wording-'));
    const hydrate = join(root, 'retrieval-hydrate.json');
    const index = join(root, 'retrieval-index.json');
    writeFileSync(hydrate, `${JSON.stringify({
      version: 1,
      releaseId: 'rel_seed',
      scripts: [{
        scriptId: 'seed-1',
        scriptVersion: 1,
        contentHash: 'a'.repeat(64),
        title: '种子发货',
        category: 'presale',
        answerText: '三到五天到',
        platformScope: ['qianniu'],
        productScopeType: 'storewide',
        productScopeRefs: [],
        effectiveFrom: '2026-01-01T00:00:00Z',
        effectiveTo: null,
        intentTaxonomyVersion: 'itax',
        intentId: 'intent',
        riskLevel: 'low',
        riskCategories: [],
        hasConflict: false,
        placeholderKeys: [],
        questionText: '什么时候发货',
      }],
    })}\n`);
    writeFileSync(index, `${JSON.stringify({
      version: 1,
      source: 'local-feishu-import',
      scripts: [
        { scriptId: 'mn-1', title: '洁面用法', questionText: '怎么用', answerText: '先打湿再打圈', category: 'product' },
        { scriptId: 'mn-2', title: '满赠', questionText: '活动规则', answerText: '满赠不叠加', category: 'campaign' },
      ],
    })}\n`);
    process.env.CUSTOMER_AGENT_HYDRATE_INDEX = hydrate;
    process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX = index;
    const result = listDashboardWording();
    expect(result.total).toBe(2);
    expect(result.releaseId).toBe('rel_seed');
    expect(result.entries.map((entry) => entry.scriptId)).toEqual(['mn-1', 'mn-2']);
    expect(result.entries[0]).toMatchObject({
      domain: 'product',
      lifecycle: 'published',
      dataClass: 'local-catalog',
    });
  });

  it('returns an empty catalog when both off-repo files are missing', () => {
    process.env.CUSTOMER_AGENT_HYDRATE_INDEX = join(tmpdir(), 'missing-hydrate.json');
    process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX = join(tmpdir(), 'missing-index.json');
    expect(listDashboardWording()).toMatchObject({ ok: true, total: 0, entries: [] });
  });

  it('ignores catalog files inside the git worktree', () => {
    const inside = join(process.cwd(), 'apps/desktop/package.json');
    process.env.CUSTOMER_AGENT_HYDRATE_INDEX = inside;
    process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX = inside;
    expect(listDashboardWording()).toMatchObject({ ok: true, total: 0, entries: [] });
  });
});
