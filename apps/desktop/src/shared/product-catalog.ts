import { exactKeys, productFailure, type ProductFailure } from './product-session';
import { SYNTHETIC_CATALOG, type SyntheticCategory } from './synthetic-catalog';

/**
 * Read-only projection of the synthetic product catalog for the query UI.
 *
 * The renderer must not hardcode category/SKU ids or labels: it asks main for
 * this list and sends back the id it was given. That keeps the display name and
 * the backend `product_scope_ref` provably the same record, so a candidate's
 * scope always resolves to something the agent can recognise.
 *
 * The payload contains no session, credential or customer data, so it is
 * readable before login; the channel is still sender-gated like every other
 * product capability.
 */
export type ProductCatalogEntry = Readonly<{
  type: 'category' | 'sku';
  id: string;
  label: string;
  /** Owning category id for a `sku` entry; null for a `category` entry. */
  parentId: string | null;
}>;

export type ProductCatalogResult =
  | Readonly<{ ok: true; entries: ProductCatalogEntry[] }>
  | ProductFailure;

/** Flattened, renderer-friendly form of `SYNTHETIC_CATALOG`. */
export function productCatalogEntries(): ProductCatalogEntry[] {
  const entries: ProductCatalogEntry[] = [];
  for (const category of SYNTHETIC_CATALOG) {
    entries.push(Object.freeze({ type: 'category', id: category.id, label: category.label, parentId: null }));
    for (const product of category.products) {
      entries.push(Object.freeze({ type: 'sku', id: product.id, label: product.label, parentId: category.id }));
    }
  }
  return entries;
}

export function catalogFailure(code: ProductFailure['code']): ProductCatalogResult {
  return productFailure(code);
}

const ENTRY_KEYS = ['type', 'id', 'label', 'parentId'];

export function isProductCatalogResult(value: unknown): value is ProductCatalogResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    return exactKeys(record, ['ok', 'sessionEpoch', 'code', 'message'])
      && typeof record.code === 'string'
      && record.message === productFailure(record.code as ProductFailure['code']).message;
  }
  if (record.ok !== true || !exactKeys(record, ['ok', 'entries']) || !Array.isArray(record.entries)) return false;
  return record.entries.every((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const item = entry as Record<string, unknown>;
    return exactKeys(item, ENTRY_KEYS)
      && (item.type === 'category' || item.type === 'sku')
      && typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(item.id)
      && typeof item.label === 'string' && item.label.length > 0 && item.label.length <= 128
      && (item.parentId === null || (typeof item.parentId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(item.parentId)));
  });
}

export type ProductCatalogApi = {
  list(): Promise<ProductCatalogResult>;
};

export type { SyntheticCategory };
