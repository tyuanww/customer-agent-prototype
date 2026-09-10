import { describe, expect, it } from 'vitest';
import {
  CATALOG_SCOPE_MESSAGES,
  catalogCategories,
  catalogIsConsistent,
  catalogSkus,
  resolveCatalogScope,
} from '../../src/renderer/features/search/catalog-scope';
import { productCatalogEntries } from '../../src/shared/product-catalog';

describe('catalog scope', () => {
  const entries = productCatalogEntries();

  it('keeps category and sku parent links intact', () => {
    expect(catalogIsConsistent(entries)).toBe(true);
    expect(catalogCategories(entries).map((entry) => entry.id)).toEqual([
      'cat_cleanser', 'cat_essence', 'cat_sunscreen', 'cat_mask',
    ]);
    expect(catalogSkus(entries, 'cat_cleanser').map((entry) => entry.id)).toEqual(['sku_chengyajiemian']);
  });

  it('rejects a sku whose parent is missing instead of guessing storewide', () => {
    expect(catalogIsConsistent([
      { type: 'sku', id: 'sku_orphan', label: '孤儿款', parentId: 'cat_missing' },
    ])).toBe(false);
    expect(resolveCatalogScope({
      entries: [], productType: 'sku', categoryId: 'cat_cleanser', skuId: 'sku_chengyajiemian',
    })).toEqual({ ok: false, message: CATALOG_SCOPE_MESSAGES.missing });
  });

  it('returns the catalog id as the search ref and refuses unknown picks', () => {
    expect(resolveCatalogScope({
      entries, productType: '', categoryId: '', skuId: '',
    })).toEqual({ ok: true, productContextType: null, productContextRef: null });
    expect(resolveCatalogScope({
      entries, productType: 'category', categoryId: 'cat_cleanser', skuId: '',
    })).toEqual({ ok: true, productContextType: 'category', productContextRef: 'cat_cleanser' });
    expect(resolveCatalogScope({
      entries, productType: 'sku', categoryId: 'cat_cleanser', skuId: 'sku_chengyajiemian',
    })).toEqual({ ok: true, productContextType: 'sku', productContextRef: 'sku_chengyajiemian' });
    expect(resolveCatalogScope({
      entries, productType: 'sku', categoryId: 'cat_essence', skuId: 'sku_chengyajiemian',
    })).toEqual({ ok: false, message: CATALOG_SCOPE_MESSAGES.unknown });
  });
});
