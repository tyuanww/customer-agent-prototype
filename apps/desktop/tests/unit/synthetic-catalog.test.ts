import { describe, expect, it } from 'vitest';
import { SYNTHETIC_CATALOG, catalogCategory, catalogLabel, catalogProduct, catalogReferences, isCatalogReference } from '../../src/shared/synthetic-catalog';

describe('synthetic product catalog', () => {
  it('keeps every identifier within the frozen search contract pattern', () => {
    const references = catalogReferences();
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) expect(reference).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    expect(new Set(references).size).toBe(references.length);
  });

  it('maps a scope reference back to the same human label the stack seeds', () => {
    expect(catalogCategory('cat_cleanser')?.label).toBe('洁面');
    expect(catalogProduct('sku_chengyajiemian')?.label).toBe('澄芽氨基酸洁面乳');
    expect(catalogLabel('sku_chengyajiemian')).toBe('澄芽氨基酸洁面乳');
    expect(catalogLabel('unknown_ref')).toBe('unknown_ref');
  });

  it('separates category and sku references so a scope cannot be guessed', () => {
    expect(isCatalogReference('cat_cleanser')).toBe(true);
    expect(isCatalogReference('sku_chengyajiemian')).toBe(true);
    expect(isCatalogReference('cleanser')).toBe(false);
    expect(isCatalogReference('')).toBe(false);
    for (const category of SYNTHETIC_CATALOG) {
      expect(isCatalogReference(category.id)).toBe(true);
      for (const product of category.products) {
        expect(category.id).not.toBe(product.id);
        expect(catalogCategory(product.id)).toBeUndefined();
      }
    }
  });
});
