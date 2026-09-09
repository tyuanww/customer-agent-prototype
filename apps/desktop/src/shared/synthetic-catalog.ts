/**
 * Synthetic product catalog — the single source of truth for the local
 * synthetic stack and the desktop client.
 *
 * Display label and backend identifier are one record, so the renderer never
 * invents a second naming scheme and every `product_scope_refs` value the
 * backend returns resolves to something a human can pick.
 *
 * Identifiers are limited to `[A-Za-z0-9_-]{1,128}` because that is what the
 * frozen search contract accepts for `product_context_ref`. Category and SKU
 * ids are disjoint; `storewide` content declares no reference at all.
 *
 * Consumed by:
 *   - `scripts/synthetic-stack/` (seed import rows and self-check)
 *   - desktop main (read-only projection for the renderer dropdown)
 * Renderer code must not hardcode ids or labels.
 */

export type SyntheticProduct = Readonly<{ id: string; label: string }>;

export type SyntheticCategory = Readonly<{
  id: string;
  label: string;
  products: readonly SyntheticProduct[];
}>;

export const SYNTHETIC_CATALOG: readonly SyntheticCategory[] = Object.freeze([
  Object.freeze({
    id: 'cat_cleanser',
    label: '洁面',
    products: Object.freeze([
      Object.freeze({ id: 'sku_chengyajiemian', label: '澄芽氨基酸洁面乳' }),
    ]),
  }),
  Object.freeze({
    id: 'cat_essence',
    label: '精华',
    products: Object.freeze([
      Object.freeze({ id: 'sku_wuyujinghua', label: '雾屿舒缓精华' }),
    ]),
  }),
  Object.freeze({
    id: 'cat_sunscreen',
    label: '防晒',
    products: Object.freeze([
      Object.freeze({ id: 'sku_yuebaifangshai', label: '月白清透防晒乳' }),
    ]),
  }),
  Object.freeze({
    id: 'cat_mask',
    label: '面膜',
    products: Object.freeze([
      Object.freeze({ id: 'sku_luzhimianmo', label: '露芷修护面膜' }),
    ]),
  }),
]);

const REFERENCE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function catalogCategory(id: string): SyntheticCategory | undefined {
  return SYNTHETIC_CATALOG.find((category) => category.id === id);
}

export function catalogProduct(id: string): SyntheticProduct | undefined {
  for (const category of SYNTHETIC_CATALOG) {
    const product = category.products.find((candidate) => candidate.id === id);
    if (product) return product;
  }
  return undefined;
}

/** Label for a scope reference, or the raw id when it is not in the catalog. */
export function catalogLabel(id: string): string {
  return catalogCategory(id)?.label ?? catalogProduct(id)?.label ?? id;
}

export function isCatalogReference(value: string): boolean {
  return REFERENCE_PATTERN.test(value)
    && (catalogCategory(value) !== undefined || catalogProduct(value) !== undefined);
}

/**
 * Every reference the stack may hand to the search contract. Fails closed when
 * an edit would produce an identifier the frozen contract rejects, so the stack
 * self-check catches it instead of a query failing later.
 */
export function catalogReferences(): readonly string[] {
  const references: string[] = [];
  for (const category of SYNTHETIC_CATALOG) {
    references.push(category.id);
    for (const product of category.products) references.push(product.id);
  }
  const invalid = references.filter((reference) => !REFERENCE_PATTERN.test(reference));
  if (invalid.length > 0) throw new Error(`Synthetic catalog has contract-invalid identifiers: ${invalid.join(', ')}`);
  if (new Set(references).size !== references.length) throw new Error('Synthetic catalog identifiers must be unique');
  return Object.freeze(references);
}
