import { describe, expect, it } from 'vitest';
import { PRODUCT_ERRORS, productFailure } from '../../src/shared/product-session';
import { queryFailure, isProductQueryResult } from '../../src/shared/product-search';
import { PERMISSION_DENIAL_MESSAGE } from '../../src/shared/product-session';

/**
 * PR-A unit: the search door states its two refusals in its own words, and they have to reach
 * the operator as those words rather than as a generic forbidden copy.
 *
 * These cases pin the contract between the API sentence, the desktop failure code, and the
 * preload validator. A change that renamed a code, reworded a sentence, or let the validator
 * reject the new codes would fail here rather than at the window.
 */
describe('search refusal sentences', () => {
  it('carries the server sentence as the failure message', () => {
    const identity = { sessionEpoch: 4, generation: 2 };
    expect(queryFailure('NO_GRANT', identity)).toEqual({
      ok: false,
      code: 'NO_GRANT',
      message: '没有权限，请找人开通。',
      sessionEpoch: 4,
      generation: 2,
    });
    expect(queryFailure('FACTS_EXPIRED', identity)).toEqual({
      ok: false,
      code: 'FACTS_EXPIRED',
      message: '资料资格过期了，请稍后重试。',
      sessionEpoch: 4,
      generation: 2,
    });
  });

  it('keeps the denial sentence identical to the one the workbench shows', () => {
    // Two doors, one sentence. If these ever differ, an operator sees two different reasons
    // for the same refusal depending on which window they are looking at.
    expect(PRODUCT_ERRORS.NO_GRANT).toBe(PERMISSION_DENIAL_MESSAGE);
  });

  it('passes the preload validator for both codes', () => {
    // Preload rejects a failure whose message is not the canonical copy for its code, so the
    // new sentences only work if they are the canonical copy.
    for (const code of ['NO_GRANT', 'FACTS_EXPIRED'] as const) {
      const failure = { ...queryFailure(code, { sessionEpoch: 1, generation: 1 }) };
      expect(isProductQueryResult(failure)).toBe(true);
      expect(failure.message).toBe(PRODUCT_ERRORS[code]);
    }
  });

  it('still rejects a failure whose message was edited in transit', () => {
    const tampered = {
      ok: false as const,
      code: 'NO_GRANT' as const,
      message: '没有权限',
      sessionEpoch: 1,
      generation: 1,
    };
    expect(isProductQueryResult(tampered)).toBe(false);
  });

  it('keeps the two refusal codes distinct from the generic forbidden copy', () => {
    // A code that reused FORBIDDEN would show 当前身份不能执行此操作 and tell the operator the
    // wrong thing: one needs access, the other needs to wait.
    expect(PRODUCT_ERRORS.NO_GRANT).not.toBe(PRODUCT_ERRORS.FORBIDDEN);
    expect(PRODUCT_ERRORS.FACTS_EXPIRED).not.toBe(PRODUCT_ERRORS.FORBIDDEN);
    expect(productFailure('FORBIDDEN').message).toBe('当前身份不能执行此操作');
  });
});
