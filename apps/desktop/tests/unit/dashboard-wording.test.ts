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
  it('prefers the hydrate snapshot over a larger local index', () => {
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
    expect(result.total).toBe(1);
    expect(result.releaseId).toBe('rel_seed');
    expect(result.entries.map((entry) => entry.scriptId)).toEqual(['seed-1']);
    expect(result.catalogRefreshedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.matchesLease).toBe(false);
    expect(result.entries[0]).toMatchObject({
      domain: 'presale',
      lifecycle: 'published',
      ownerRole: '本机话术库',
      dataClass: 'local-catalog',
      scriptVersion: 1,
      effectiveFrom: '2026-01-01T00:00:00Z',
      effectiveTo: null,
    });
  });

  it('keeps hydrate scriptVersion only for integers >= 1 and index rows at null', () => {
    const root = mkdtempSync(join(tmpdir(), 'dash-wording-'));
    const hydrate = join(root, 'retrieval-hydrate.json');
    const index = join(root, 'retrieval-index.json');
    writeFileSync(hydrate, `${JSON.stringify({
      releaseId: 'rel_seed',
      scripts: [{
        scriptId: 'seed-1',
        scriptVersion: 0,
        title: '种子发货',
        category: 'presale',
        answerText: '三到五天到',
        questionText: '什么时候发货',
        effectiveFrom: '2026-01-01T00:00:00Z',
        effectiveTo: '2026-12-31T00:00:00Z',
      }],
    })}\n`);
    process.env.CUSTOMER_AGENT_HYDRATE_INDEX = hydrate;
    process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX = join(root, 'missing-index.json');
    expect(listDashboardWording().entries[0]).toMatchObject({
      scriptVersion: null,
      effectiveFrom: '2026-01-01T00:00:00Z',
      effectiveTo: '2026-12-31T00:00:00Z',
    });

    writeFileSync(index, `${JSON.stringify({
      version: 1,
      scripts: [
        { scriptId: 'mn-1', title: '洁面用法', questionText: '怎么用', answerText: '先打湿再打圈', category: 'product' },
      ],
    })}\n`);
    process.env.CUSTOMER_AGENT_HYDRATE_INDEX = join(root, 'missing-hydrate.json');
    process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX = index;
    expect(listDashboardWording().entries[0]).toMatchObject({
      scriptId: 'mn-1',
      scriptVersion: null,
      effectiveFrom: null,
      effectiveTo: null,
    });
  });

  it('labels hydrate rows without an effective-from as 本机目录', () => {
    const root = mkdtempSync(join(tmpdir(), 'dash-wording-'));
    const hydrate = join(root, 'retrieval-hydrate.json');
    writeFileSync(hydrate, `${JSON.stringify({
      releaseId: 'rel_seed',
      scripts: [{ scriptId: 'seed-1', title: '过敏了怎么办', questionText: '过敏了怎么办', answerText: '先安抚', category: 'aftersale' }],
    })}\n`);
    process.env.CUSTOMER_AGENT_HYDRATE_INDEX = hydrate;
    process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX = join(root, 'missing-index.json');
    const result = listDashboardWording();
    expect(result.entries[0]).toMatchObject({ ownerRole: '本机话术库', effectiveWindow: '本机目录' });
  });

  it('returns an empty catalog when both off-repo files are missing', () => {
    process.env.CUSTOMER_AGENT_HYDRATE_INDEX = join(tmpdir(), 'missing-hydrate.json');
    process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX = join(tmpdir(), 'missing-index.json');
    expect(listDashboardWording()).toMatchObject({ ok: true, total: 0, entries: [] });
  });

  it('prefers the in-memory announce snapshot over a stale hydrate file', () => {
    const root = mkdtempSync(join(tmpdir(), 'dash-wording-'));
    const hydrate = join(root, 'retrieval-hydrate.json');
    writeFileSync(hydrate, `${JSON.stringify({
      releaseId: 'rel_old',
      scripts: [{ scriptId: 'old-1', title: '旧稿', questionText: '旧问', answerText: '旧答', category: 'product' }],
    })}\n`);
    process.env.CUSTOMER_AGENT_HYDRATE_INDEX = hydrate;
    process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX = join(root, 'missing-index.json');
    const result = listDashboardWording({
      releaseId: 'rel_25',
      items: [{
        script_id: 'live-1',
        script_version: 3,
        content_hash: 'b'.repeat(64),
        title: '新稿',
        category: 'campaign',
        answer_text: '新答',
        platform_scope: ['qianniu'],
        product_scope_type: 'storewide',
        product_scope_refs: [],
        effective_from: '2026-09-28T00:00:00Z',
        effective_to: null,
        intent_taxonomy_version: 'itax',
        intent_id: 'intent',
        risk_level: 'low',
        risk_categories: [],
        has_conflict: false,
        placeholder_keys: [],
        questions: [{ question_text: '新问' }],
      }],
    });
    expect(result.releaseId).toBe('rel_25');
    expect(result.entries).toHaveLength(1);
    expect(result.matchesLease).toBe(true);
    expect(result.entries[0]).toMatchObject({
      scriptId: 'live-1',
      domain: 'campaign',
      scene: '新问',
      ownerRole: '当前发布',
      dataClass: 'current-release',
      scriptVersion: 3,
    });
  });

  it('ignores catalog files inside the git worktree', () => {
    const inside = join(process.cwd(), 'apps/desktop/package.json');
    process.env.CUSTOMER_AGENT_HYDRATE_INDEX = inside;
    process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX = inside;
    expect(listDashboardWording()).toMatchObject({ ok: true, total: 0, entries: [] });
  });
});
