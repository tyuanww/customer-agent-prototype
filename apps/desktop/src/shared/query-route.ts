import { SYNTHETIC_CATALOG } from './synthetic-catalog.ts';

export const ROUTE_INTENTS = ['shipping', 'address', 'product', 'aftersale', 'campaign', 'other'] as const;
export type RouteIntent = (typeof ROUTE_INTENTS)[number];

export type QueryRoute = Readonly<{
  intent: RouteIntent;
  match: 'storewide' | 'campaign' | 'category' | 'sku';
  productContextType: 'category' | 'sku' | null;
  productContextRef: string | null;
}>;

function includesLabel(query: string, label: string): boolean {
  const needle = label.trim();
  return needle.length > 0 && query.includes(needle);
}

function productMention(query: string): QueryRoute | null {
  const products = SYNTHETIC_CATALOG.flatMap((category) => (
    category.products.map((product) => ({ categoryId: category.id, product }))
  )).sort((left, right) => right.product.label.length - left.product.label.length);
  for (const { product } of products) {
    if (includesLabel(query, product.label)) {
      return Object.freeze({
        intent: 'product',
        match: 'sku',
        productContextType: 'sku',
        productContextRef: product.id,
      });
    }
  }
  const categories = [...SYNTHETIC_CATALOG].sort((left, right) => right.label.length - left.label.length);
  for (const category of categories) {
    if (includesLabel(query, category.label)) {
      return Object.freeze({
        intent: 'product',
        match: 'category',
        productContextType: 'category',
        productContextRef: category.id,
      });
    }
  }
  return null;
}

export function routeQuery(queryText: string, intent: RouteIntent): QueryRoute {
  const query = queryText.trim();
  if (intent === 'campaign') {
    return Object.freeze({
      intent,
      match: 'campaign',
      productContextType: null,
      productContextRef: null,
    });
  }
  if (intent === 'product') {
    return productMention(query) ?? Object.freeze({
      intent,
      match: 'storewide',
      productContextType: null,
      productContextRef: null,
    });
  }
  return Object.freeze({
    intent,
    match: 'storewide',
    productContextType: null,
    productContextRef: null,
  });
}
