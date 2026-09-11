// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadHydrateCatalog } from '../../src/main/hydrate-catalog';

const valid = {
  releaseId: 'rel-synthetic-001',
  scripts: [{
    scriptId: 'script-synthetic-001',
    scriptVersion: 1,
    contentHash: 'a'.repeat(64),
    title: '合成发货',
    category: 'presale',
    answerText: '合成订单 {订单号}',
    platformScope: ['qianniu'],
    productScopeType: 'storewide',
    productScopeRefs: [],
    effectiveFrom: '2026-01-01T00:00:00Z',
    effectiveTo: null,
    intentTaxonomyVersion: 'itax_synthetic_v1',
    intentId: 'intent_synthetic_shipping',
    riskLevel: 'low',
    riskCategories: [],
    hasConflict: false,
    placeholderKeys: ['order_id'],
  }],
};

function writeIndex(body: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'hydrate-catalog-'));
  const file = join(dir, 'hydrate.json');
  writeFileSync(file, `${JSON.stringify(body)}\n`);
  return file;
}

describe('hydrate catalog parser', () => {
  it('hydrates a fully typed snapshot row', () => {
    const catalog = loadHydrateCatalog(writeIndex(valid));
    expect(catalog?.releaseId).toBe('rel-synthetic-001');
    const [candidate] = catalog?.hydrate([{
      scriptId: 'script-synthetic-001', title: '合成发货', questionText: '', answerText: '', score: 1,
    }]) ?? [];
    expect(candidate).toMatchObject({
      rank: 1,
      category: 'presale',
      product_scope_type: 'storewide',
      risk_categories: [],
      placeholder_keys: ['order_id'],
    });
  });

  it('keeps an empty catalog when the snapshot parses but no row is valid', () => {
    const catalog = loadHydrateCatalog(writeIndex({
      releaseId: 'rel-synthetic-001',
      scripts: [{ scriptId: 'bad', category: 'not-a-category' }],
    }));
    expect(catalog?.releaseId).toBe('rel-synthetic-001');
    expect(catalog?.hydrate([{
      scriptId: 'bad', title: 'x', questionText: '', answerText: '', score: 1,
    }])).toEqual([]);
  });

  it('skips rows whose unions do not match the search candidate contract', () => {
    const catalog = loadHydrateCatalog(writeIndex({
      releaseId: 'rel-synthetic-001',
      scripts: [
        { ...valid.scripts[0], category: 'not-a-category' },
        { ...valid.scripts[0], scriptId: 'ok', category: 'presale' },
      ],
    }));
    expect(catalog?.candidate('script-synthetic-001')).toBeNull();
    expect(catalog?.candidate('ok')?.script_id).toBe('ok');
  });

  it('returns null for missing or invalid snapshots and hydrates every ranked match', () => {
    expect(loadHydrateCatalog('')).toBeNull();
    expect(loadHydrateCatalog(join(tmpdir(), 'hydrate-missing.json'))).toBeNull();
    const invalid = writeIndex({ scripts: [] });
    writeFileSync(invalid, '{not json');
    expect(loadHydrateCatalog(invalid)).toBeNull();
    expect(loadHydrateCatalog(writeIndex({ scripts: valid.scripts }))).toBeNull();
    const catalog = loadHydrateCatalog(writeIndex({
      releaseId: 'rel-synthetic-001',
      scripts: [1, 2, 3, 4].map((index) => ({
        ...valid.scripts[0],
        scriptId: `script-synthetic-00${index}`,
      })),
    }));
    const hydrated = catalog?.hydrate([1, 2, 3, 4].map((index) => ({
      scriptId: `script-synthetic-00${index}`, title: '合成发货', questionText: '', answerText: '', score: 4 - index,
    })) ) ?? [];
    expect(hydrated.map((row) => row.script_id)).toEqual([
      'script-synthetic-001', 'script-synthetic-002', 'script-synthetic-003', 'script-synthetic-004',
    ]);
  });

  it('drops rows whose content hash or answer text fail the copy contract', () => {
    const catalog = loadHydrateCatalog(writeIndex({
      releaseId: 'rel-synthetic-001',
      scripts: [
        { ...valid.scripts[0], scriptId: 'bad-hash', contentHash: 'not-a-hash' },
        { ...valid.scripts[0], scriptId: 'empty-answer', answerText: '   ' },
        { ...valid.scripts[0], scriptId: 'ok' },
      ],
    }));
    expect(catalog?.releaseId).toBe('rel-synthetic-001');
    expect(catalog?.candidate('bad-hash')).toBeNull();
    expect(catalog?.candidate('empty-answer')).toBeNull();
    expect(catalog?.candidate('ok')?.script_id).toBe('ok');
  });
});
