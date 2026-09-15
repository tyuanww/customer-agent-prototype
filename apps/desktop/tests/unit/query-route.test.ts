import { describe, expect, it } from 'vitest';
import { routeQuery } from '../../src/shared/query-route';

describe('query route', () => {
  it('keeps shipping, address, aftersale, and other on storewide', () => {
    for (const intent of ['shipping', 'address', 'aftersale', 'other'] as const) {
      expect(routeQuery('什么时候发货', intent)).toMatchObject({
        match: 'storewide', productContextType: null, productContextRef: null,
      });
    }
  });

  it('routes campaign intent without a SKU pick', () => {
    expect(routeQuery('会员日积分怎么兑', 'campaign')).toMatchObject({
      match: 'campaign', productContextType: null, productContextRef: null,
    });
  });

  it('binds a product mention to the catalog SKU and otherwise stays storewide', () => {
    expect(routeQuery('澄芽氨基酸洁面乳怎么用', 'product')).toMatchObject({
      match: 'sku', productContextType: 'sku', productContextRef: 'sku_chengyajiemian',
    });
    expect(routeQuery('洁面怎么用', 'product')).toMatchObject({
      match: 'category', productContextType: 'category', productContextRef: 'cat_cleanser',
    });
    expect(routeQuery('这个怎么用呀', 'product')).toMatchObject({
      match: 'storewide', productContextType: null, productContextRef: null,
    });
  });
});
