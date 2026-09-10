import type { ProductCatalogEntry } from '@shared/product-catalog';

export const CATALOG_SCOPE_MESSAGES = {
  loading: '合成商品目录加载中，请稍候。未猜测商品，未扩大为全店。',
  missing: '合成商品目录不可用，无法按品类或具体款查询。未猜测商品，未扩大为全店。',
  inconsistent: '合成商品目录配置不一致，无法按品类或具体款查询。未猜测商品，未扩大为全店。',
  pickCategory: '请选择品类后再查询。未猜测商品，未扩大为全店。',
  pickSku: '请选择具体款后再查询。未猜测商品，未扩大为全店。',
  unknown: '所选商品不在当前合成目录中，请重新选择。未猜测商品，未扩大为全店。',
} as const;

export function catalogCategories(entries: readonly ProductCatalogEntry[]): ProductCatalogEntry[] {
  return entries.filter((entry) => entry.type === 'category' && entry.parentId === null);
}

export function catalogSkus(entries: readonly ProductCatalogEntry[], categoryId: string): ProductCatalogEntry[] {
  return entries.filter((entry) => entry.type === 'sku' && entry.parentId === categoryId);
}

export function catalogIsConsistent(entries: readonly ProductCatalogEntry[]): boolean {
  const categories = new Set(catalogCategories(entries).map((entry) => entry.id));
  if (entries.some((entry) => entry.type === 'sku') && categories.size === 0) return false;
  return entries.every((entry) => (
    entry.type === 'category'
      ? entry.parentId === null
      : typeof entry.parentId === 'string' && categories.has(entry.parentId)
  ));
}

export type CatalogLoadStatus = 'loading' | 'ready' | 'missing' | 'failed' | 'inconsistent';

export function catalogStatusMessage(status: CatalogLoadStatus): string {
  if (status === 'ready') return '';
  if (status === 'inconsistent') return CATALOG_SCOPE_MESSAGES.inconsistent;
  if (status === 'loading') return CATALOG_SCOPE_MESSAGES.loading;
  return CATALOG_SCOPE_MESSAGES.missing;
}

export function resolveCatalogScope(input: {
  entries: readonly ProductCatalogEntry[];
  productType: 'all' | '' | 'category' | 'sku';
  categoryId: string;
  skuId: string;
}): { ok: true; productContextType: 'category' | 'sku' | null; productContextRef: string | null }
  | { ok: false; message: string } {
  if (input.productType === 'all' || input.productType === '') return { ok: true, productContextType: null, productContextRef: null };
  if (input.entries.length === 0) return { ok: false, message: CATALOG_SCOPE_MESSAGES.missing };
  if (!catalogIsConsistent(input.entries)) return { ok: false, message: CATALOG_SCOPE_MESSAGES.inconsistent };
  if (input.productType === 'category') {
    if (!input.categoryId) return { ok: false, message: CATALOG_SCOPE_MESSAGES.pickCategory };
    const category = input.entries.find((entry) => entry.type === 'category' && entry.id === input.categoryId);
    if (!category) return { ok: false, message: CATALOG_SCOPE_MESSAGES.unknown };
    return { ok: true, productContextType: 'category', productContextRef: category.id };
  }
  if (!input.categoryId) return { ok: false, message: CATALOG_SCOPE_MESSAGES.pickCategory };
  if (!input.skuId) return { ok: false, message: CATALOG_SCOPE_MESSAGES.pickSku };
  const sku = input.entries.find((entry) => entry.type === 'sku' && entry.id === input.skuId);
  if (!sku || sku.parentId !== input.categoryId) return { ok: false, message: CATALOG_SCOPE_MESSAGES.unknown };
  return { ok: true, productContextType: 'sku', productContextRef: sku.id };
}
