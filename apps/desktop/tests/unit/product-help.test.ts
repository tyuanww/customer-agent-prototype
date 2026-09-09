import { describe, expect, it } from 'vitest';
import {
  ALLOWED_HELP_STATUS,
  FORBIDDEN_HELP_PHRASES,
  SYNTHETIC_HELP_CONTACT,
  SYNTHETIC_HELP_HTML,
  isProductEscalateRequest,
  isProductEscalateResult,
  isProductTerminalRequest,
} from '../../src/shared/product-help';

describe('synthetic help contract', () => {
  it('rejects extra keys and forbids transfer-success copy', () => {
    const identity = { sessionEpoch: 1, generation: 2, queryId: '11111111-1111-4111-8111-111111111111' };
    expect(isProductEscalateRequest({ ...identity, action: 'copy_contact' })).toBe(true);
    expect(isProductEscalateRequest({ ...identity, action: 'open_feishu', extra: true })).toBe(false);
    expect(isProductEscalateRequest({ ...identity, action: 'other' })).toBe(false);
    expect(isProductTerminalRequest({ ...identity, outcome: 'no_hit_exit' })).toBe(true);
    expect(isProductTerminalRequest({ ...identity, outcome: 'adopted' })).toBe(false);
    expect(isProductEscalateResult({
      ok: true, sessionEpoch: identity.sessionEpoch, generation: identity.generation,
      escalateId: 'esc_1', action: 'copy_contact', opened: true, eventStatus: 'recorded',
    })).toBe(true);
    expect(ALLOWED_HELP_STATUS).toEqual(['待核实', '已打开入口', '已复制联系方式']);
    for (const phrase of FORBIDDEN_HELP_PHRASES) {
      expect(SYNTHETIC_HELP_CONTACT).not.toContain(phrase);
      expect(SYNTHETIC_HELP_HTML).not.toContain(phrase);
      expect(ALLOWED_HELP_STATUS.join('')).not.toContain(phrase);
    }
  });
});
