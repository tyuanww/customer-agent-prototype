import { describe, expect, it } from 'vitest';
import { isImeComposing, shouldSubmitOnEnter } from '../../src/renderer/lib/ime';

describe('IME enter guard', () => {
  it('does not submit while composing or when the keyCode is 229', () => {
    expect(shouldSubmitOnEnter({ key: 'Enter', isComposing: true })).toBe(false);
    expect(shouldSubmitOnEnter({ key: 'Enter', nativeEvent: { isComposing: true } })).toBe(
      false,
    );
    expect(shouldSubmitOnEnter({ key: 'Enter', keyCode: 229 })).toBe(false);
    expect(isImeComposing({ key: 'Enter', keyCode: 229 })).toBe(true);
  });

  it('submits a normal Enter after composition has ended', () => {
    expect(shouldSubmitOnEnter({ key: 'Enter', isComposing: false, keyCode: 13 })).toBe(true);
    expect(shouldSubmitOnEnter({ key: 'Escape' })).toBe(false);
  });
});
