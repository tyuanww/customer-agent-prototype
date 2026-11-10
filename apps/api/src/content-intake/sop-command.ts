import { validateContractSchema, type components } from './contract-view.js';
import { IntakeRejection } from './transaction.js';

type C = components['schemas'];
export type QuerySelection =
  | { kind: 'legacy-request'; request: C['IntakeEntitlementRequest'] }
  | { kind: 'current-entitlement'; entitlementId: string };
export type OpenProof = { kind: 'legacy-inferred' }
  | { kind: 'explicit-ready-query'; queryRequestId: string };

export function querySelection(request: C['MenokinSopQuerySopQueryRequest']): QuerySelection {
  if ('entitlement_id' in request) return { kind: 'current-entitlement', entitlementId: request.entitlement_id };
  const selection = validateContractSchema('IntakeEntitlementRequest', {
    shopId: request.shop_id, contextGeneration: 1, releaseId: null,
    productIds: request.product_context && request.product_context.type !== 'storewide' ? [request.product_context.ref] : [],
    scenarioIds: [],
  });
  if (!selection.ok) throw new IntakeRejection('SCOPE_DENIED', 'FORBIDDEN');
  return { kind: 'legacy-request', request: selection.value };
}

export function assertQuerySelection(request: C['MenokinSopQuerySopQueryRequest'],
  selected: Pick<C['IntakeEntitlementRequest'], 'shopId' | 'productIds'>): void {
  const product = request.product_context;
  if (request.shop_id !== selected.shopId || product && (product.type === 'storewide'
    ? selected.productIds.length !== 0 : !selected.productIds.includes(product.ref))) {
    throw new IntakeRejection('SCOPE_DENIED', 'FORBIDDEN');
  }
}

export function openingProof(request: C['IntakeSopActionCheck']): OpenProof {
  return 'queryRequestId' in request && request.queryRequestId !== null
    ? { kind: 'explicit-ready-query', queryRequestId: request.queryRequestId }
    : { kind: 'legacy-inferred' };
}
